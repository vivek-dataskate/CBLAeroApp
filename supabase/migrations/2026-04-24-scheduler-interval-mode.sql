-- Adds optional rolling-interval mode to schedule_definitions.
-- When interval_minutes is set, the scheduler computes next_run_at as
--   (last completed_at) + interval_minutes
-- regardless of cron_expression. This gives admin-edited cadences like
-- "Every 24 hours" true rolling semantics instead of cron's wall-clock anchoring.
-- When interval_minutes is NULL, cron_expression remains authoritative.

alter table cblaero_app.schedule_definitions
  add column if not exists interval_minutes integer null;

alter table cblaero_app.schedule_definitions
  drop constraint if exists schedule_definitions_interval_minutes_positive;

alter table cblaero_app.schedule_definitions
  add constraint schedule_definitions_interval_minutes_positive
  check (interval_minutes is null or interval_minutes > 0);
