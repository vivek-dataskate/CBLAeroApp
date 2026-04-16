-- Story 2.8 code review follow-up — 2026-04-16
--
-- Applies review-triggered fixes to the Clay webhook hourly bucket RPC:
--
-- P13: simplify `v_bucket` double time-zone conversion — `date_trunc('hour',
--      now())` is equivalent to the previous `date_trunc('hour', now() at
--      time zone 'utc') at time zone 'utc'` expression (both yield a
--      timestamptz rounded to the top of the current UTC hour, because
--      `now()` returns timestamptz and `date_trunc` preserves the type).
--      The double conversion was harmless but obscured intent.
--
-- P12 (SQL half): the RPC is generalized to accept a zero-count initial call
--      so the webhook can upsert-or-fetch the bucket row id at START of
--      request, use that id as the `runId` for `recordSyncFailure` calls,
--      then re-invoke the RPC at END with real counts. The ON CONFLICT
--      behavior is unchanged — calling with zero counts on an existing row
--      is a no-op increment and still returns the existing row id. On a
--      fresh hour bucket, the first call creates the row with counts=0 and
--      returns the new id.
--
-- Safe to re-run (create or replace function is idempotent).

create or replace function cblaero_app.upsert_clay_hourly_sync_run(
  p_accepted int,
  p_skipped int,
  p_errored int
) returns uuid language plpgsql as $$
declare
  v_id uuid;
  -- P13: simplified — date_trunc already returns timestamptz when given one
  v_bucket timestamptz := date_trunc('hour', now());
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
  'Safe to call with zero counts at request start to obtain the bucket row id '
  'for linking sync_run_errors to the bucket — follow-up call with real counts '
  'increments the same row. Replaces the per-request createSyncRun/completeSyncRun '
  'pair in the webhook handler.';
