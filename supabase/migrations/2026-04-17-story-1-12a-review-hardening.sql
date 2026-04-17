-- Story 1-12a — Provider framework review-hardening migration
--
-- Addresses several findings from the combined 1-12 + 1-12a Opus 4-layer
-- code review:
--
--   M-4: Add `next_attempt_at` to `webhook_events` and update the pending
--        index so `claimBatch` can respect exponential backoff rather than
--        re-claiming failed events on the next scheduler tick.
--
--   M-13: Add an `updated_at` refresh trigger to `provider_routing_policies`
--         so a manual UPDATE of mode/reason doesn't leave `updated_at` stale.
--
--   L-6:  Document the retention intent for `provider_health_events`. No
--         age-out is applied automatically — this doc-level comment marks
--         the column a future ops cron should target.
--
-- Safe to run repeatedly.

-- ================================================================
-- M-4: webhook_events.next_attempt_at
-- ================================================================

alter table cblaero_app.webhook_events
  add column if not exists next_attempt_at timestamptz;

-- Replace the old pending-drain index with one that also orders by
-- next_attempt_at so claimBatch can filter "where next_attempt_at is null or
-- next_attempt_at <= now()".
drop index if exists cblaero_app.idx_webhook_events_pending;

create index if not exists idx_webhook_events_pending
  on cblaero_app.webhook_events (status, next_attempt_at, created_at)
  where status in ('pending', 'failed');

comment on column cblaero_app.webhook_events.next_attempt_at is
  'Earliest time the processor should re-claim this event. NULL means immediately '
  'eligible (pending rows). Set by WebhookProcessor.markFailed based on the '
  'exponential-backoff schedule. Review patch M-4 / Decision 3C resolution.';

-- ================================================================
-- M-13: provider_routing_policies.updated_at trigger
-- ================================================================

create or replace function cblaero_app.touch_provider_routing_policies_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_provider_routing_policies_updated_at
  on cblaero_app.provider_routing_policies;

create trigger trg_provider_routing_policies_updated_at
  before update on cblaero_app.provider_routing_policies
  for each row
  execute function cblaero_app.touch_provider_routing_policies_updated_at();

comment on trigger trg_provider_routing_policies_updated_at
  on cblaero_app.provider_routing_policies is
  'Refreshes updated_at on every UPDATE (manual operator change or '
  'system-driven mode transition). Review patch M-13.';

-- ================================================================
-- M-7: content_fingerprints.fingerprint_type namespaced per provider
-- ================================================================
-- Adds `clay_profile_id` and `ceipal_applicant_id` so each outbound
-- provider can have its own fingerprint namespace instead of relying on a
-- hash-prefix convention within `ats_external_id`. Existing rows with
-- `ats_external_id` remain valid under the expanded constraint.

alter table cblaero_app.content_fingerprints
  drop constraint if exists content_fingerprints_fingerprint_type_check;

alter table cblaero_app.content_fingerprints
  add constraint content_fingerprints_fingerprint_type_check
  check (fingerprint_type in (
    'file_sha256',
    'email_message_id',
    'csv_row_hash',
    'ats_external_id',
    'candidate_identity',
    'clay_profile_id',
    'ceipal_applicant_id'
  ));

-- Backfill existing Clay + Ceipal fingerprints to the namespaced types so
-- the first post-migration run of CeipalIngestionJob / the Clay webhook
-- keeps seeing existing fingerprints as "already processed" (no
-- re-ingestion storm).
update cblaero_app.content_fingerprints
   set fingerprint_type = 'clay_profile_id'
 where fingerprint_type = 'ats_external_id'
   and fingerprint_hash like 'clay:%';

update cblaero_app.content_fingerprints
   set fingerprint_type = 'ceipal_applicant_id'
 where fingerprint_type = 'ats_external_id'
   and fingerprint_hash like 'ceipal:%';

-- ================================================================
-- M-8: Clay hourly sync_runs status reflects real outcomes
-- ================================================================
-- Previously always wrote `status='complete'`, so the 2-4b admin dashboard
-- filter on `status='failed'` silently missed Clay outages. Replace the
-- function so status tracks `errored > succeeded` after aggregation.

create or replace function cblaero_app.upsert_clay_hourly_sync_run(
  p_accepted int,
  p_skipped int,
  p_errored int
) returns uuid language plpgsql as $$
declare
  v_id uuid;
  v_bucket timestamptz := date_trunc('hour', now());
  v_final_succeeded int;
  v_final_failed int;
  v_final_total int;
begin
  insert into cblaero_app.sync_runs (
    source, status, started_at, completed_at,
    succeeded, failed, total
  ) values (
    'clay_enrichment', 'complete', v_bucket, now(),
    p_accepted, p_errored, p_accepted + p_skipped + p_errored
  )
  on conflict (source, started_at) where source = 'clay_enrichment' do update
    set succeeded    = cblaero_app.sync_runs.succeeded + excluded.succeeded,
        failed       = cblaero_app.sync_runs.failed + excluded.failed,
        total        = cblaero_app.sync_runs.total + excluded.total,
        completed_at = now(),
        -- Review patch M-8: flip to 'failed' when the bucket's aggregate
        -- errored rows exceed accepted; UI drill-down can now filter on
        -- status='failed' to surface Clay outages.
        status       = case
          when cblaero_app.sync_runs.failed + excluded.failed
               > cblaero_app.sync_runs.succeeded + excluded.succeeded
            then 'failed'
          else 'complete'
        end
  returning id, succeeded, failed, total into v_id, v_final_succeeded, v_final_failed, v_final_total;
  -- Suppress unused-variable warnings: we read these to document intent even
  -- though only v_id is returned.
  perform v_final_succeeded + v_final_failed + v_final_total;
  return v_id;
end; $$;

-- ================================================================
-- L-6: provider_health_events retention marker
-- ================================================================

comment on table cblaero_app.provider_health_events is
  'Append-only log of provider health transitions for audit (architecture.md §19). '
  'Retention: 90 days. Ops cron should DELETE rows older than now() - interval ''90 days''; '
  'no automatic age-out is wired today. Review patch L-6.';
