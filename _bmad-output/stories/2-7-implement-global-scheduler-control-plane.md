# Story 2.7: Implement Global Scheduler Control Plane

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform engineer,
I want one auditable scheduler for recurring business jobs,
so that ATS syncs, inbox scans, refresh sweeps, and future digests do not rely on per-worker timers.

## Acceptance Criteria

1. **Given** due recurring business schedules **When** the scheduler claims work **Then** it emits outbox jobs idempotently and records schedule-run history with tenant and policy version context.
2. **Given** a scheduler job definition change **When** the update is saved **Then** the change creates a new policy version and applies only to subsequent schedule runs.
3. **Given** a job execution request from the scheduler **When** the job runs **Then** the worker remains an event-driven consumer and does not own the business-level timer logic.
4. **Given** the Render server has cold-started **When** the scheduler dispatches a due job **Then** the scheduler validates server readiness before job execution to avoid transient fetch failures.
5. **Given** a scheduler claim conflict across instances **When** two schedulers attempt the same run **Then** only one run is recorded and the duplicate is discarded or retried safely.

## Tasks / Subtasks

- [ ] Task 1: Schema and scheduling persistence
  - [ ] 1.1 Add `schedule_definitions` table to `supabase/schema.sql` with fields: `id`, `tenant_id`, `name`, `job_key`, `cron_expression`, `policy_version_id`, `enabled`, `created_at`, `updated_at`, `last_claimed_at`, `next_run_at`.
  - [ ] 1.2 Add `schedule_runs` table to `supabase/schema.sql` with fields: `id`, `schedule_definition_id`, `tenant_id`, `policy_version_id`, `requested_at`, `claimed_at`, `started_at`, `completed_at`, `status`, `result_payload`, `error_message`, `worker_id`.
  - [ ] 1.3 Add DB constraints and indexes for `tenant_id`, `next_run_at`, and `schedule_definition_id`.
  - [ ] 1.4 Add `policy_registry` / `policy_versions` support if not already present, including `refresh_cadences` family for future scheduler policy management.

- [ ] Task 2: Scheduler engine implementation
  - [ ] 2.1 Implement `GlobalScheduler` in `cblaero/src/modules/ingestion/scheduler.ts` with a claim-based loop that reads due `schedule_definitions` rows and inserts locked `schedule_runs` entries.
  - [ ] 2.2 Use Postgres advisory locks or `SELECT ... FOR UPDATE SKIP LOCKED` to prevent duplicate claims across instances.
  - [ ] 2.3 Ensure `schedule_runs` captures `policy_version_id` at claim time and persists run metadata for audit.
  - [ ] 2.4 Emit outbox jobs from scheduler claims, not from individual worker timers.
  - [ ] 2.5 Ensure worker job implementations are event-driven consumers of jobs created by the scheduler rather than owning their own timers.

- [ ] Task 3: Job definitions and registration
  - [ ] 3.1 Create or extend scheduler jobs for: `EmailIngestionJob`, `CeipalIngestionJob`, `OneDriveResumePollerJob`, `SavedSearchDigestJob`, and `CandidateAvailabilityRefreshJob`.
  - [ ] 3.2 Verify `registerIngestionJobs(scheduler)` in `cblaero/src/modules/ingestion/jobs.ts` uses the same job registration pattern for all scheduler-backed jobs.
  - [ ] 3.3 Add `job_key` and scheduling metadata to every job definition.

- [ ] Task 4: Cold-start readiness and Render reliability
  - [ ] 4.1 Implement a server readiness probe before dispatching due jobs when the scheduler starts or after long idle periods.
  - [ ] 4.2 Preferred implementation: in-process scheduler loop inside the Next.js server to avoid HTTP round-trips and cold-start failures.
  - [ ] 4.3 If external dispatch is used, the first step of every schedule run must be a health-check probe.

- [ ] Task 5: Policy versioning and cadence control
  - [ ] 5.1 Store scheduler cadence and job configuration in `policy_versions` so schedule behavior is versioned and auditable.
  - [ ] 5.2 Implement `schedule_definitions.policy_version_id` and resolve the effective policy version at claim time.
  - [ ] 5.3 Add initial `policy_registry` row for `refresh_cadences` if not present.

- [ ] Task 6: Observability and fallback
  - [ ] 6.1 Add structured scheduler logs for `{ schedule_definition_id, tenant_id, policy_version_id, outcome, duration_ms }`.
  - [ ] 6.2 Add run history query support for debugging failed schedule runs.
  - [ ] 6.3 Add retry or safe failure handling for transient worker errors.

- [ ] Task 7: Tests
  - [ ] 7.1 Unit tests for scheduler claim semantics and `schedule_runs` audit events.
  - [ ] 7.2 Integration tests for `GlobalScheduler` in a DB-backed test fixture using `FOR UPDATE SKIP LOCKED` or advisory lock behavior.
  - [ ] 7.3 Regression test for cold-start probe behavior.

## Dev Notes

- The scheduler is the single source of truth for recurring business work. It must not be implemented as a per-job timer inside individual workers.
- `schedule_definitions` drives recurrence; `schedule_runs` records each execution and the policy version in effect.
- Workers should remain event-driven consumers of scheduler-issued jobs, preserving the existing Render-friendly design.
- Use database claim semantics to enforce single-run ownership across instances and prevent schedule run duplication.
- Cold-start handling is required for Render free tier; prefer in-process scheduling or a lightweight health probe before running any job.
- The architecture must support future expansion of admin-managed cadence policies and multi-tenant schedule isolation.

### References

- [Source: docs/planning_artifacts/epics.md#story-2.7-implement-global-scheduler-control-plane](../planning_artifacts/epics.md)
- [Source: docs/planning_artifacts/architecture.md](../planning_artifacts/architecture.md)
- [Source: cblaero/src/modules/ingestion/jobs.ts](../../cblaero/src/modules/ingestion/jobs.ts)
- [Source: src/bmm/workflows/4-implementation/create-story/template.md](../../src/bmm/workflows/4-implementation/create-story/template.md)

## Dev Agent Record

### Agent Model Used

Raptor mini (Preview)

### Debug Log References


### Completion Notes List


### File List

- `docs/implementation_artifacts/stories/2-7-implement-global-scheduler-control-plane.md`
