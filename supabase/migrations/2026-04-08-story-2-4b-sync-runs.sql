-- Story 2.4b: Sync run summary tracking
create table if not exists cblaero_app.sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  succeeded int not null default 0,
  failed int not null default 0,
  total int not null default 0,
  error_message text
);

create index if not exists idx_sync_runs_started_at
  on cblaero_app.sync_runs (started_at desc);

-- Add run_id FK to sync_errors (nullable — errors can exist without a run)
-- ON DELETE SET NULL: when a sync_run is pruned, orphaned errors keep their data with null run_id
alter table cblaero_app.sync_errors
  add column if not exists run_id uuid references cblaero_app.sync_runs(id) on delete set null;

create index if not exists idx_sync_errors_run_id
  on cblaero_app.sync_errors (run_id);

-- Grants for sync_runs (revoke Supabase defaults first, then grant minimal)
revoke insert, update, delete on cblaero_app.sync_runs from anon, authenticated;
grant select, insert, update on cblaero_app.sync_runs to service_role;
grant select on cblaero_app.sync_runs to authenticated;

-- Tighten sync_errors grants — revoke write access from anon/authenticated
-- (Story 2.3 over-granted INSERT to all roles; only service_role should write)
revoke insert, update, delete on cblaero_app.sync_errors from anon, authenticated;
grant select on cblaero_app.sync_errors to authenticated;
grant insert, update, delete on cblaero_app.sync_errors to service_role;
