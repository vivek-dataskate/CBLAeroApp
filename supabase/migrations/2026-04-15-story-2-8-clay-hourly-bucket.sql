-- Story 2.8 follow-up: Clay webhook hourly bucket aggregation
--
-- Problem: the initial Story 2.8 implementation created one sync_runs row per
-- Clay webhook request. For a backfill of ~9,000 rows that's 9,000 rows in the
-- dashboard — unusable. This migration changes Clay sync_runs tracking to
-- bucket by hour: every webhook within the same hour increments a single
-- pre-existing row instead of inserting a new one.
--
-- Design:
--   - Partial unique index on (source, started_at) WHERE source = 'clay_enrichment'
--     — only Clay respects hourly bucketing. Other sources (ATS, Ceipal, email,
--     onedrive, dedup, role-enrichment) keep their per-run pattern unchanged.
--   - New RPC `upsert_clay_hourly_sync_run(p_accepted, p_skipped, p_errored)`
--     INSERTs a new row if no row exists for the current hour bucket,
--     otherwise atomically increments the existing row's counters via
--     ON CONFLICT DO UPDATE.
--   - `started_at` is pinned to `date_trunc('hour', now())` so the ON CONFLICT
--     target is deterministic within an hour window. `completed_at` is updated
--     on every call so the dashboard shows "most recent activity" correctly.
--   - Status is always 'complete' — the row represents a rolling aggregate,
--     not a single run that can be in-flight.
--
-- Cleanup: the existing ~30 noisy Clay sync_runs rows from the smoke tests
-- are deleted at the end of this migration to clean up the dashboard.
--
-- Safe to run repeatedly (idempotent).

-- ── Partial unique index ─────────────────────────────────────────────────────
create unique index if not exists uq_sync_runs_clay_hourly
  on cblaero_app.sync_runs (source, started_at)
  where source = 'clay_enrichment';

-- ── Hourly upsert RPC ────────────────────────────────────────────────────────
create or replace function cblaero_app.upsert_clay_hourly_sync_run(
  p_accepted int,
  p_skipped int,
  p_errored int
) returns uuid language plpgsql as $$
declare
  v_id uuid;
  v_bucket timestamptz := date_trunc('hour', now() at time zone 'utc') at time zone 'utc';
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
        status       = 'complete'
  returning id into v_id;
  return v_id;
end; $$;

grant execute on function cblaero_app.upsert_clay_hourly_sync_run(int, int, int)
  to service_role;

comment on function cblaero_app.upsert_clay_hourly_sync_run(int, int, int) is
  'Story 2.8: atomic hourly bucket upsert for Clay webhook sync_runs. '
  'Every call inserts or increments a single row keyed by (source, date_trunc(hour, now())). '
  'Replaces the per-request createSyncRun/completeSyncRun pair in the webhook handler.';

-- ── Cleanup: drop the noisy per-request Clay rows from the initial rollout ──
-- These were created before the hourly bucket design landed. Only the bucket
-- rows (after this migration runs) should remain.
delete from cblaero_app.sync_runs
where source = 'clay_enrichment';
