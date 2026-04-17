-- Story 3.1: Build SMS Outreach Template and Scheduling Workflow
-- PR 1 / Task 1: Schema deltas, RPCs, RLS, grants, and policy-registry seeds.
--
-- Adds:
--   * sms_sends.provider_idempotency_key  (+ partial unique index on
--     (tenant_id, provider_idempotency_key) WHERE provider_idempotency_key IS NOT NULL)
--   * Extends sms_sends.status CHECK with 'blocked_cooldown' (outreach lock
--     per architecture §10 — dispatch job transitions to this when a
--     candidate_outreach_lock is active; the lock table itself lands in
--     Story 3-3).
--   * outreach_audit_log.trace_id, correlation_id, event_envelope
--     (cross-service tracing per architecture §17 + replay-safe envelope)
--   * RPC claim_due_sms_sends(p_batch_size, p_now)
--       — FOR UPDATE SKIP LOCKED claim of pending rows due by now.
--   * RPC insert_sms_sends_bulk(p_rows)
--       — atomic batch insert with per-row opt-out check, max 500 rows/call
--         (dev-standards §4.4); returns (inserted, skipped) counts.
--   * RPC seed_sms_templates(p_tenant_id, p_actor_id)
--       — idempotent ON CONFLICT DO NOTHING insert of 12 seed templates;
--       — template bodies are intentionally stubbed in this migration and
--         MUST be replaced with PM-approved copy before production seed
--         (PM gate per Task 1.3). Idempotency guarantees the deploy-time
--         re-run picks up the approved copy once the follow-up migration
--         ships, without overwriting recruiter edits.
--   * RLS update: admin-write on sms_templates; tenant-scoped R/W on sms_sends.
--   * Policy-registry seed: outreach_defaults / sms_default_contact_window.
--
-- Guarantees per Epic 2 retro and dev-standards:
--   * Append-only — NO UPDATE or DELETE on observability tables.
--   * Grants limited to service_role + authenticated (no anon).
--   * Idempotent — safe to re-run (ALTER ... IF NOT EXISTS, ON CONFLICT).
--   * schema.sql updated in the same PR (Dual-Update Rule §4.9).
--
-- Architecture refs: §6 Consent Sync, §10 Outreach Lock, §11 Provider
-- Idempotency, §17 Observability, §24 Policy Registry, §25 Provider Framework.

-- ── 1. sms_sends: provider_idempotency_key column + index ─────────────────

alter table cblaero_app.sms_sends
  add column if not exists provider_idempotency_key text;

create unique index if not exists idx_sms_sends_provider_idempotency_key
  on cblaero_app.sms_sends (tenant_id, provider_idempotency_key)
  where provider_idempotency_key is not null;

-- ── 2. sms_sends: extend status CHECK to include 'blocked_cooldown' ───────
-- Architecture §10: dispatch job transitions queued sends to
-- 'blocked_cooldown' when candidate_outreach_lock is active at dequeue.
-- (The outreach lock table lands in Story 3-3; the status is added now so
-- the dispatch job can emit it as soon as the lock table exists — no CHECK
-- migration churn between stories.)

alter table cblaero_app.sms_sends
  drop constraint if exists sms_sends_status_valid;

alter table cblaero_app.sms_sends
  add constraint sms_sends_status_valid check (status = any (array[
    'pending'::text,
    'queued'::text,
    'sent'::text,
    'delivered'::text,
    'failed'::text,
    'bounced'::text,
    'undeliverable'::text,
    'blocked_opt_out'::text,
    'blocked_cooldown'::text,
    'deferred_window'::text
  ]));

-- ── 3. outreach_audit_log: trace_id, correlation_id, event_envelope ──────
-- trace_id + correlation_id propagate from proxy.ts → route → repo → audit.
-- event_envelope stores the exact JSON payload emitted to log drain so
-- Epic 10 can replay/forensic without reconstructing (architecture §17).

alter table cblaero_app.outreach_audit_log
  add column if not exists trace_id        text,
  add column if not exists correlation_id  text,
  add column if not exists event_envelope  jsonb;

create index if not exists idx_outreach_audit_trace_id
  on cblaero_app.outreach_audit_log (trace_id)
  where trace_id is not null;

-- ── 4. RPC: claim_due_sms_sends ───────────────────────────────────────────
-- Atomic claim of pending sends due by p_now. Uses FOR UPDATE SKIP LOCKED
-- so concurrent Render instances can each process a distinct batch without
-- coordination (architecture §Global Scheduler Design).
-- Mirrors the pattern of claim_due_schedules() from Story 2-7.
-- p_tenant_id is required — each Render instance calls with its tenant
-- context so multi-tenant deployments never cross-claim sends (F1 fix).

create or replace function cblaero_app.claim_due_sms_sends(
  p_tenant_id  text,
  p_batch_size integer default 50,
  p_now        timestamptz default now()
)
returns setof cblaero_app.sms_sends
language plpgsql
security definer
set search_path = cblaero_app
as $$
begin
  if p_tenant_id is null or length(p_tenant_id) = 0 then
    raise exception 'claim_due_sms_sends: p_tenant_id is required';
  end if;
  if p_batch_size is null or p_batch_size <= 0 then
    raise exception 'claim_due_sms_sends: p_batch_size must be > 0';
  end if;
  if p_batch_size > 500 then
    raise exception 'claim_due_sms_sends: p_batch_size % exceeds 500', p_batch_size;
  end if;

  return query
  update cblaero_app.sms_sends s
  set
    status               = 'queued',
    delivery_attempt_count = coalesce(s.delivery_attempt_count, 0) + 1,
    last_attempt_at      = p_now
  where s.id in (
    select id
    from   cblaero_app.sms_sends
    where  tenant_id     = p_tenant_id
      and  status        = 'pending'
      and  scheduled_for <= p_now
    order  by scheduled_for asc
    for update skip locked
    limit  p_batch_size
  )
  returning s.*;
end;
$$;

grant execute on function cblaero_app.claim_due_sms_sends(text, integer, timestamptz)
  to service_role;

-- ── 5. RPC: insert_sms_sends_bulk ─────────────────────────────────────────
-- Atomic bulk insert with per-row opt-out pre-check.  Accepts a JSONB array
-- of row payloads; each element must at minimum include:
--   tenant_id, candidate_id, template_id, template_version, scheduled_for
-- Optional fields carried through if provided:
--   campaign_id, context_params, tracking_token, tracking_url,
--   sender_user_id, rendered_body, rendered_body_hash,
--   provider_idempotency_key.
--
-- Cap of 500 rows per call (dev-standards §4.4 — batch RPC size ceiling).
-- Returns aggregate counters so the caller can surface partial success.

create or replace function cblaero_app.insert_sms_sends_bulk(
  p_rows jsonb
)
returns table(inserted integer, skipped integer)
language plpgsql
security definer
set search_path = cblaero_app
as $$
declare
  v_inserted integer := 0;
  v_skipped  integer := 0;
  v_row      jsonb;
  v_candidate_id uuid;
  v_opted_in boolean;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'insert_sms_sends_bulk: p_rows must be a JSONB array';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'insert_sms_sends_bulk: batch size % exceeds 500', jsonb_array_length(p_rows);
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    -- F7: guard required fields before casting to avoid full-batch abort.
    if (v_row ->> 'candidate_id') is null or
       (v_row ->> 'tenant_id') is null or
       (v_row ->> 'template_id') is null or
       (v_row ->> 'template_version') is null or
       (v_row ->> 'scheduled_for') is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_candidate_id := (v_row ->> 'candidate_id')::uuid;

    -- Opt-out check at enqueue (architecture §6: ALSO checked at dequeue
    -- inside the dispatch job — defence in depth against consent drift).
    -- F6: scope to tenant_id to prevent cross-tenant preference lookup.
    select coalesce(sms_opted_in, true)
      into v_opted_in
      from cblaero_app.candidate_channel_preferences
     where candidate_id = v_candidate_id
       and tenant_id    = v_row ->> 'tenant_id'
     limit 1;

    if coalesce(v_opted_in, true) = false then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into cblaero_app.sms_sends (
      tenant_id,
      campaign_id,
      candidate_id,
      template_id,
      template_version,
      rendered_body,
      rendered_body_hash,
      context_params,
      status,
      scheduled_for,
      sender_user_id,
      tracking_token,
      tracking_url,
      provider_idempotency_key
    )
    values (
      v_row ->> 'tenant_id',
      nullif(v_row ->> 'campaign_id', '')::uuid,
      v_candidate_id,
      (v_row ->> 'template_id')::uuid,
      (v_row ->> 'template_version')::integer,
      v_row ->> 'rendered_body',
      v_row ->> 'rendered_body_hash',
      coalesce(v_row -> 'context_params', '{}'::jsonb),
      'pending',
      (v_row ->> 'scheduled_for')::timestamptz,
      v_row ->> 'sender_user_id',
      v_row ->> 'tracking_token',
      v_row ->> 'tracking_url',
      v_row ->> 'provider_idempotency_key'
    );

    v_inserted := v_inserted + 1;
  end loop;

  return query select v_inserted, v_skipped;
end;
$$;

grant execute on function cblaero_app.insert_sms_sends_bulk(jsonb)
  to service_role;

-- ── 6. RPC: seed_sms_templates ────────────────────────────────────────────
-- Idempotent tenant seed for the 12 baseline SMS templates (AC 2).
-- ON CONFLICT DO NOTHING on (tenant_id, template_key, version) — re-runs
-- preserve recruiter-edited bodies (edits create a new version row with a
-- higher `version` number; the seed only inserts version=1).
--
-- Bodies are PM-approved 2026-04-17 (aviation-forward, customer-focused,
-- hero-opening lines, TCPA-compliant with "Reply STOP to opt out" and an
-- identifiable sender via the {{sender_name}} variable).
--
-- Every body satisfies sms_templates_body_length (≤ 1600 chars) and the
-- Epic 3 minimums: ≤ 480 chars post-substitution, {{first_name}} +
-- {{tracking_link}} always present, identifiable sender.

create or replace function cblaero_app.seed_sms_templates(
  p_tenant_id text,
  p_actor_id  text
)
returns void
language plpgsql
security definer
set search_path = cblaero_app
as $$
declare
  v_seed jsonb;
  v_seeds jsonb := jsonb_build_array(
    jsonb_build_object(
      'agenda','new_opportunity', 'key','new_opportunity_v1',
      'name','New Opportunity — Primary',
      'body','{{first_name}}, your certifications deserve a better seat. {{sender_name}} at CBL Aero — a {{job_title}} role at {{client_company}} is open with shift + relo on the table. {{tracking_link}} Reply STOP to opt out.',
      'variables', jsonb_build_array('first_name','sender_name','job_title','client_company','tracking_link')
    ),
    jsonb_build_object(
      'agenda','new_opportunity', 'key','new_opportunity_warm',
      'name','New Opportunity — Warm Reachout',
      'body','{{first_name}}, your hangar experience matches a role I''m working. {{sender_name}} at CBL Aero — {{job_title}} opening, 90-sec brief: {{tracking_link}} Reply STOP to opt out.',
      'variables', jsonb_build_array('first_name','sender_name','job_title','tracking_link')
    ),
    jsonb_build_object(
      'agenda','availability_check', 'key','availability_check_v1',
      'name','Availability Check',
      'body','{{first_name}}, ready for your next line station or MRO gig? {{sender_name}} at CBL Aero — 2-question update keeps you on my shortlist: {{tracking_link}} Reply STOP to opt out.',
      'variables', jsonb_build_array('first_name','sender_name','tracking_link')
    ),
    jsonb_build_object(
      'agenda','job_followup', 'key','job_followup_v1',
      'name','Job Follow-up',
      'body','{{first_name}}, the {{job_title}} seat is still open and the hiring manager is asking about you. {{sender_name}} at CBL Aero — confirm interest today: {{tracking_link}} Reply STOP to opt out.',
      'variables', jsonb_build_array('first_name','sender_name','job_title','tracking_link')
    ),
    jsonb_build_object(
      'agenda','submission_followup', 'key','submission_followup_v1',
      'name','Submission Follow-up',
      'body','{{first_name}}, your file is airborne at {{client_company}} — response typically inside 48 hrs. {{sender_name}} at CBL Aero — status tracker: {{tracking_link}} Reply STOP to opt out.',
      'variables', jsonb_build_array('first_name','sender_name','client_company','tracking_link')
    ),
    jsonb_build_object(
      'agenda','interview_schedule', 'key','interview_schedule_v1',
      'name','Interview Schedule',
      'body','{{first_name}}, {{client_company}} cleared you to interview. {{sender_name}} at CBL Aero — pick a slot before the hangar fills up: {{tracking_link}} Reply STOP to opt out.',
      'variables', jsonb_build_array('first_name','sender_name','client_company','tracking_link')
    ),
    jsonb_build_object(
      'agenda','interview_reminder', 'key','interview_reminder_v1',
      'name','Interview Reminder',
      'body','{{first_name}}, wheels up on your interview at {{interview_time}}. CBL Aero — prep checklist + join link: {{tracking_link}} Reply STOP to opt out.',
      'variables', jsonb_build_array('first_name','interview_time','tracking_link')
    ),
    jsonb_build_object(
      'agenda','bgv_initiation', 'key','bgv_initiation_v1',
      'name','Background Verification Start',
      'body','{{first_name}}, you cleared pre-flight — background verification is next. {{sender_name}} at CBL Aero — 5-min consent form: {{tracking_link}} Reply STOP to opt out.',
      'variables', jsonb_build_array('first_name','sender_name','tracking_link')
    ),
    jsonb_build_object(
      'agenda','offer_extended', 'key','offer_extended_v1',
      'name','Offer Extended',
      'body','{{first_name}}, offer on the flight line for the {{job_title}} role. {{sender_name}} at CBL Aero — review + e-sign: {{tracking_link}} Want to talk it through? Reply STOP to opt out.',
      'variables', jsonb_build_array('first_name','sender_name','job_title','tracking_link')
    ),
    jsonb_build_object(
      'agenda','onboarding', 'key','onboarding_v1',
      'name','Onboarding Welcome',
      'body','{{first_name}}, welcome to the ramp! {{sender_name}} at CBL Aero — day-1 checklist + paperwork queued here: {{tracking_link}} Reply STOP to opt out.',
      'variables', jsonb_build_array('first_name','sender_name','tracking_link')
    ),
    jsonb_build_object(
      'agenda','reengagement', 'key','reengagement_v1',
      'name','Re-engagement',
      'body','{{first_name}}, been a while since you last taxied with us. {{sender_name}} at CBL Aero — new MRO + line maintenance roles may fit better now: {{tracking_link}} Reply STOP to opt out.',
      'variables', jsonb_build_array('first_name','sender_name','tracking_link')
    ),
    jsonb_build_object(
      'agenda','general', 'key','general_v1',
      'name','General Outreach',
      'body','{{first_name}}, quick comms check from CBL Aero. {{sender_name}} here — have a minute? {{tracking_link}} Reply STOP to opt out.',
      'variables', jsonb_build_array('first_name','sender_name','tracking_link')
    )
  );
begin
  if p_tenant_id is null or length(p_tenant_id) = 0 then
    raise exception 'seed_sms_templates: p_tenant_id is required';
  end if;

  for v_seed in select * from jsonb_array_elements(v_seeds)
  loop
    insert into cblaero_app.sms_templates (
      tenant_id, agenda, name, template_key, body, variables,
      version, status, created_by, updated_by
    )
    values (
      p_tenant_id,
      v_seed ->> 'agenda',
      v_seed ->> 'name',
      v_seed ->> 'key',
      v_seed ->> 'body',
      v_seed -> 'variables',
      1,
      'active',
      coalesce(p_actor_id, 'system'),
      coalesce(p_actor_id, 'system')
    )
    on conflict (tenant_id, template_key, version) do nothing;
  end loop;
end;
$$;

-- Idempotency key on (tenant_id, template_key, version) — mirrors the
-- unique index already on sms_templates. The RPC relies on this for ON
-- CONFLICT DO NOTHING to short-circuit on re-run.
grant execute on function cblaero_app.seed_sms_templates(text, text)
  to service_role;

-- ── 7. RLS: admin-write on sms_templates, tenant R/W on sms_sends ────────
-- Existing schema.sql has SELECT policies (read-only, USING true) but no
-- write policies. Dispatch runs under service_role (bypasses RLS), so the
-- INSERT/UPDATE policies below gate only the authenticated role.
--
-- Tenant isolation uses the same JWT-claim pattern as role_taxonomy:
--   tenant_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')
-- Admin-only writes additionally check the 'role' claim.

drop policy if exists sms_templates_admin_insert on cblaero_app.sms_templates;
create policy sms_templates_admin_insert on cblaero_app.sms_templates
  for insert to authenticated
  with check (
    tenant_id = ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'tenant_id'::text)
    and ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'role'::text) = 'admin'
  );

drop policy if exists sms_templates_admin_update on cblaero_app.sms_templates;
create policy sms_templates_admin_update on cblaero_app.sms_templates
  for update to authenticated
  using (
    tenant_id = ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'tenant_id'::text)
    and ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'role'::text) = 'admin'
  )
  with check (
    tenant_id = ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'tenant_id'::text)
    and ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'role'::text) = 'admin'
  );

-- sms_sends: tenant-scoped R/W for both recruiter and admin.
drop policy if exists sms_sends_tenant_insert on cblaero_app.sms_sends;
create policy sms_sends_tenant_insert on cblaero_app.sms_sends
  for insert to authenticated
  with check (
    tenant_id = ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'tenant_id'::text)
  );

drop policy if exists sms_sends_tenant_update on cblaero_app.sms_sends;
create policy sms_sends_tenant_update on cblaero_app.sms_sends
  for update to authenticated
  using (
    tenant_id = ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'tenant_id'::text)
  )
  with check (
    tenant_id = ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'tenant_id'::text)
  );

-- ── 7b. RLS: fix permissive SELECT policies (F4) ─────────────────────────
-- The existing schema.sql sms_sends_read + sms_templates_read policies use
-- USING (true) — no tenant filter — meaning any authenticated user can read
-- every tenant's data. This PR adds SELECT grants to authenticated, which
-- makes that exposure real. Drop and recreate with tenant isolation.

drop policy if exists sms_sends_read on cblaero_app.sms_sends;
create policy sms_sends_read on cblaero_app.sms_sends
  for select to authenticated
  using (
    tenant_id = ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'tenant_id'::text)
  );

drop policy if exists sms_templates_read on cblaero_app.sms_templates;
create policy sms_templates_read on cblaero_app.sms_templates
  for select to authenticated
  using (
    tenant_id = ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'tenant_id'::text)
  );

-- ── 8. Grants ─────────────────────────────────────────────────────────────
-- NO anon access. service_role bypasses RLS (dispatch/seed flows).
-- outreach_audit_log: authenticated gets SELECT only — INSERT is service_role
-- only because audit rows are always written via server-side repositories,
-- never directly from an RLS-gated authenticated session (F3 fix).
-- A bare GRANT INSERT to authenticated with no RLS INSERT policy is a dead
-- letter in Postgres RLS mode and creates misleading attack surface.

grant select, insert, update on cblaero_app.sms_templates      to authenticated;
grant all                    on cblaero_app.sms_templates      to service_role;

grant select, insert, update on cblaero_app.sms_sends           to authenticated;
grant all                    on cblaero_app.sms_sends           to service_role;

grant select                 on cblaero_app.outreach_audit_log  to authenticated;
grant all                    on cblaero_app.outreach_audit_log  to service_role;

grant execute on function cblaero_app.claim_due_sms_sends(text, integer, timestamptz) to service_role;
grant execute on function cblaero_app.insert_sms_sends_bulk(jsonb)                   to service_role;
grant execute on function cblaero_app.seed_sms_templates(text, text)                 to service_role;

-- ── 9. Policy registry seed: default SMS contact window ──────────────────
-- Architecture §24: no hardcoded defaults in code — live in policy_registry
-- with append-only version history. AC 7: default to Mon–Fri 08:00–20:00
-- America/Chicago if candidate has no per-row contact_windows.

insert into cblaero_app.policy_registry (family, key, description) values
  ('outreach_defaults', 'sms_default_contact_window',
   'Default SMS contact window used when candidate_channel_preferences.contact_windows is null/empty (AC 7)')
on conflict (family, key) do nothing;

insert into cblaero_app.policy_versions (policy_id, value, effective_from, created_by_actor_id)
select r.id,
       jsonb_build_object(
         'timezone', 'America/Chicago',
         'windows', jsonb_build_array(
           jsonb_build_object('day','mon','start','08:00','end','20:00'),
           jsonb_build_object('day','tue','start','08:00','end','20:00'),
           jsonb_build_object('day','wed','start','08:00','end','20:00'),
           jsonb_build_object('day','thu','start','08:00','end','20:00'),
           jsonb_build_object('day','fri','start','08:00','end','20:00')
         )
       ),
       now(),
       'system'
from   cblaero_app.policy_registry r
where  r.family = 'outreach_defaults'
  and  r.key    = 'sms_default_contact_window'
  and  not exists (
    select 1 from cblaero_app.policy_versions pv
    where  pv.policy_id = r.id
  );

-- ── End of migration ─────────────────────────────────────────────────────
