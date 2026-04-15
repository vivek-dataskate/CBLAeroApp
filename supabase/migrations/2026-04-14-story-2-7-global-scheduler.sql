-- Story 2.7: Global Scheduler Control Plane
-- Tables, RPCs, and policy seeds for the DB-backed recurring job scheduler.
-- Run after schema.sql has been applied (policy_registry and policy_versions must exist).

-- ── schedule_definitions ─────────────────────────────────────────────────────
-- One row per (tenant, job_key) pair.  The scheduler upserts these on each boot
-- and claims due rows atomically via claim_due_schedules().

create table if not exists cblaero_app.schedule_definitions (
  id                bigint generated always as identity primary key,
  tenant_id         text        not null,
  name              text        not null,
  job_key           text        not null,
  cron_expression   text        not null,
  policy_version_id bigint      references cblaero_app.policy_versions(id) on delete set null,
  enabled           boolean     not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_claimed_at   timestamptz,
  next_run_at       timestamptz not null
);

create index if not exists idx_schedule_definitions_tenant_next_run
  on cblaero_app.schedule_definitions (tenant_id, next_run_at);

create unique index if not exists idx_schedule_definitions_tenant_job_key
  on cblaero_app.schedule_definitions (tenant_id, job_key);

alter table cblaero_app.schedule_definitions enable row level security;

create policy schedule_definitions_read on cblaero_app.schedule_definitions
  for select using (true);

grant select on cblaero_app.schedule_definitions to authenticated, service_role;
grant all    on cblaero_app.schedule_definitions to service_role;

-- ── schedule_runs ─────────────────────────────────────────────────────────────
-- Audit record per claimed schedule execution.  Policy version is re-resolved at
-- claim time so every run carries the policy that was in effect when it executed.

create table if not exists cblaero_app.schedule_runs (
  id                    uuid        primary key default gen_random_uuid(),
  schedule_definition_id bigint     not null references cblaero_app.schedule_definitions(id) on delete cascade,
  tenant_id             text        not null,
  policy_version_id     bigint      references cblaero_app.policy_versions(id) on delete set null,
  requested_at          timestamptz not null default now(),
  claimed_at            timestamptz,
  started_at            timestamptz,
  completed_at          timestamptz,
  status                text        not null default 'pending'
                          constraint schedule_runs_status_valid
                          check (status in ('pending','claimed','started','completed','failed','skipped')),
  result_payload        jsonb,
  error_message         text,
  worker_id             text
);

create index if not exists idx_schedule_runs_definition_id
  on cblaero_app.schedule_runs (schedule_definition_id);

create index if not exists idx_schedule_runs_tenant_id
  on cblaero_app.schedule_runs (tenant_id);

alter table cblaero_app.schedule_runs enable row level security;

create policy schedule_runs_read on cblaero_app.schedule_runs
  for select using (true);

grant select on cblaero_app.schedule_runs to authenticated, service_role;
grant all    on cblaero_app.schedule_runs to service_role;

-- ── outbox_events ─────────────────────────────────────────────────────────────
-- Durable dispatch record.  runDueJobs() writes here; processOutbox() claims and
-- executes.  Decouples scheduler from worker execution (AC 3).

create table if not exists cblaero_app.outbox_events (
  id              uuid        primary key default gen_random_uuid(),
  job_key         text        not null,
  tenant_id       text        not null,
  schedule_run_id uuid        references cblaero_app.schedule_runs(id) on delete set null,
  payload         jsonb,
  status          text        not null default 'pending'
                    constraint outbox_events_status_valid
                    check (status in ('pending','processing','completed','failed')),
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,
  completed_at    timestamptz,
  error_message   text
);

create index if not exists idx_outbox_events_pending
  on cblaero_app.outbox_events (tenant_id, created_at) where status = 'pending';

create index if not exists idx_outbox_events_schedule_run
  on cblaero_app.outbox_events (schedule_run_id);

alter table cblaero_app.outbox_events enable row level security;

create policy outbox_events_read on cblaero_app.outbox_events
  for select using (true);

grant select on cblaero_app.outbox_events to authenticated, service_role;
grant all    on cblaero_app.outbox_events to service_role;

-- ── claim_due_schedules RPC ───────────────────────────────────────────────────
-- Atomic claim using FOR UPDATE SKIP LOCKED.  Prevents duplicate claims across
-- concurrent Render instances.  Called by GlobalScheduler.runDueJobs().

create or replace function cblaero_app.claim_due_schedules(
  p_tenant_id      text,
  p_now            timestamptz,
  p_stale_threshold timestamptz,
  p_limit          integer default 20
)
returns setof cblaero_app.schedule_definitions
language plpgsql
security definer
set search_path = cblaero_app
as $$
begin
  return query
  update cblaero_app.schedule_definitions
  set
    last_claimed_at = p_now,
    updated_at      = p_now
  where id in (
    select id
    from   cblaero_app.schedule_definitions
    where  tenant_id       = p_tenant_id
      and  enabled         = true
      and  next_run_at    <= p_now
      and  (last_claimed_at is null or last_claimed_at < p_stale_threshold)
    order  by next_run_at asc
    for update skip locked
    limit  p_limit
  )
  returning *;
end;
$$;

grant execute on function cblaero_app.claim_due_schedules(text, timestamptz, timestamptz, integer)
  to service_role;

-- ── claim_pending_outbox_events RPC ──────────────────────────────────────────
-- Atomic outbox claim using FOR UPDATE SKIP LOCKED.  Called by
-- GlobalScheduler.processOutbox().  p_schedule_run_id (optional) scopes
-- the claim to a single run's outbox events (used by the admin trigger endpoint).

create or replace function cblaero_app.claim_pending_outbox_events(
  p_tenant_id       text,
  p_now             timestamptz,
  p_limit           integer default 20,
  p_schedule_run_id uuid    default null
)
returns setof cblaero_app.outbox_events
language plpgsql
security definer
set search_path = cblaero_app
as $$
begin
  return query
  update cblaero_app.outbox_events
  set
    status     = 'processing',
    claimed_at = p_now
  where id in (
    select id
    from   cblaero_app.outbox_events
    where  tenant_id = p_tenant_id
      and  status    = 'pending'
      and  (p_schedule_run_id is null or schedule_run_id = p_schedule_run_id)
    order  by created_at asc
    for update skip locked
    limit  p_limit
  )
  returning *;
end;
$$;

grant execute on function cblaero_app.claim_pending_outbox_events(text, timestamptz, integer, uuid)
  to service_role;

-- ── Policy registry seeds ─────────────────────────────────────────────────────
-- Ingestion schedule cadences (versioned via policy_versions so cron changes
-- are auditable — AC 2).  Availability refresh cadence was seeded in 2-6.

insert into cblaero_app.policy_registry (family, key, description) values
  ('ingestion_schedules', 'ceipal_sync',        'Ceipal ATS ingestion cron cadence'),
  ('ingestion_schedules', 'email_sync',          'Email inbox ingestion cron cadence'),
  ('ingestion_schedules', 'onedrive_sync',       'OneDrive resume poller cron cadence'),
  ('ingestion_schedules', 'saved_search_digest', 'Saved search digest cron cadence'),
  ('ingestion_schedules', 'dedup',               'Dedup worker cron cadence'),
  ('ingestion_schedules', 'role_enrichment',     'Role deduction enrichment cron cadence')
on conflict (family, key) do nothing;

insert into cblaero_app.policy_versions (policy_id, value, effective_from, created_by_actor_id)
select r.id,
       jsonb_build_object('cron_expression', v.cron),
       now(),
       'system'
from (values
  ('ingestion_schedules', 'ceipal_sync',        '0 2 * * *'),
  ('ingestion_schedules', 'email_sync',          '*/15 * * * *'),
  ('ingestion_schedules', 'onedrive_sync',       '0 * * * *'),
  ('ingestion_schedules', 'saved_search_digest', '0 6 * * *'),
  ('ingestion_schedules', 'dedup',               '*/15 * * * *'),
  ('ingestion_schedules', 'role_enrichment',     '0 3 * * *')
) as v(family, key, cron)
join cblaero_app.policy_registry r on r.family = v.family and r.key = v.key
where not exists (
  select 1
  from   cblaero_app.policy_versions pv
  where  pv.policy_id = r.id
);
