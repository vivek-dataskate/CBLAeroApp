# Story 2-7a: Scheduler Admin Dashboard

Status: done

## Story

As a platform admin,
I want to view, control, and trigger all scheduled jobs from the dashboard,
so that I can manage recurring job cadences, run any job on demand, and monitor scheduler health without Supabase access or Render configuration changes.

## Acceptance Criteria

1. **Given** an admin views the admin dashboard **When** the Scheduler Status card loads **Then** it shows all 7 registered jobs with: job key, human-readable name, human-readable schedule (e.g. "Every 15 minutes", "Daily at 2:00 AM UTC"), enabled/paused state, next scheduled run, last run time, and last run status (completed/failed/skipped). The schedule column is read-only (cron expressions are code-defined, not admin-editable). Raw cron is visible as a tooltip on hover.

2. **Given** an admin clicks "Run now" on any job **When** the request is submitted **Then** the scheduler immediately backdates `next_run_at` to the past, triggering execution on the next scheduler poll (within 15 min), and a success toast confirms the action.

3. ~~**Given** an admin changes a job's cron expression **When** the validated update is saved **Then** a new `policy_versions` row is created for that job's policy family/key.~~ **REMOVED**: Cron expressions are code-defined in `registerIngestionJobs()` and synced to DB on scheduler bootstrap. The PATCH endpoint still supports `cron_expression` for programmatic use but the UI no longer exposes inline cron editing to prevent code/DB drift.

4. **Given** an admin toggles a job's enabled state **When** saved **Then** `schedule_definitions.enabled` is updated; disabled jobs are skipped by `claim_due_schedules()` with no further runs until re-enabled.

5. **Given** an admin sets a specific `next_run_at` override **When** saved **Then** the job runs at exactly that time (once), then resumes its normal cron schedule.

6. **Given** any scheduler admin action **When** performed **Then** it is scoped to the admin's `activeClientId` tenant and rejected with 403 if the session role is not `admin`.

## Tasks / Subtasks

- [x] Task 1: API — Read endpoint
  - [x] 1.1 Create `GET /api/internal/admin/scheduler/definitions` route.
  - [x] 1.2 Use `withAuth` with `action: 'admin:view-scheduler'` (add to auth module allowlist).
  - [x] 1.3 Query `schedule_definitions` joined with latest `schedule_runs` per definition (left join, order by `requested_at desc`, limit 1).
  - [x] 1.4 Return array of `ScheduleDefinitionSummary`: `{ id, job_key, name, cron_expression, enabled, next_run_at, last_claimed_at, last_run?: { status, started_at, completed_at, error_message } }`.
  - [x] 1.5 Scope query to `tenant_id = activeClientId` from the session.

- [x] Task 2: API — Mutation endpoints
  - [x] 2.1 Create `PATCH /api/internal/admin/scheduler/definitions/[id]` route with `withAuth({ action: 'admin:manage-scheduler' })`.
  - [x] 2.2 Accept body: `{ cron_expression?: string, enabled?: boolean, next_run_at?: string }`. All fields optional, at least one required.
  - [x] 2.3 Validate `cron_expression` using `calculateNextRunAt` — return 400 if invalid.
  - [x] 2.4 Validate `next_run_at` is a valid ISO8601 future date if provided.
  - [x] 2.5 If `cron_expression` changes: call `createPolicyVersionForCronChange()` from `scheduler.ts` (extract it as a standalone exported function), update `cron_expression` and `next_run_at` and `policy_version_id` in DB.
  - [x] 2.6 If only `enabled` changes: update `enabled` only.
  - [x] 2.7 If `next_run_at` override: set `next_run_at` directly (used for ad-hoc "run now" with `now() - interval '1 second'`).
  - [x] 2.8 Scope all mutations to `tenant_id` from session — reject with 403 if `id` belongs to a different tenant.
  - [x] 2.9 Return updated definition row on success.

- [x] Task 3: API — Ad-hoc trigger endpoint
  - [x] 3.1 Create `POST /api/internal/admin/scheduler/definitions/[id]/trigger` with `withAuth({ action: 'admin:manage-scheduler' })`.
  - [x] 3.2 Sets `next_run_at = now() - interval '1 second'` and `last_claimed_at = null` on the definition.
  - [x] 3.3 Immediately calls `scheduler.runDueJobs()` then `scheduler.processOutbox()` in-process (same as the jobs route) so the job executes synchronously in this request.
  - [x] 3.4 Returns `{ status: 'ok', outcomes: [...] }` from the scheduler run.
  - [x] 3.5 Scope to session tenant, reject 403 on mismatch.

- [x] Task 4: Extract `createPolicyVersionForCronChange` as a public export
  - [x] 4.1 In `src/modules/ingestion/scheduler.ts`, move `createPolicyVersionForCronChange()` from a private class method to a top-level exported function so the PATCH route can call it without instantiating `GlobalScheduler`.
  - [x] 4.2 Update `ensureScheduleDefinitions()` to call the extracted function (same logic, no behaviour change).

- [x] Task 5: Dashboard — SchedulerStatusCard component
  - [x] 5.1 Create `src/app/dashboard/admin/SchedulerStatusCard.tsx` as a `"use client"` component following the exact same pattern as `SyncRunSummaryCard.tsx`.
  - [x] 5.2 On mount, `GET /api/internal/admin/scheduler/definitions` and render a table with columns: Job, Schedule, Status, Last Run, Next Run, Actions.
  - [x] 5.3 Status badge: `completed` → green, `failed` → red, `skipped` → yellow, `claimed/started` → blue, `—` (never run) → gray.
  - [x] 5.4 "Run now" button per row: calls `POST /api/internal/admin/scheduler/definitions/[id]/trigger`, shows spinner, displays toast on result.
  - [x] 5.5 "Pause" / "Enable" toggle button: calls `PATCH` with `{ enabled: false/true }`, refreshes row.
  - [x] 5.6 Schedule column displays human-readable labels via `cronToHuman()` (e.g. "Every 15 minutes", "Daily at 2:00 AM UTC"). Raw cron shown as tooltip. Read-only — no inline editing.
  - [x] 5.7 "Set next run" button: opens a datetime input. On save, calls `PATCH` with `{ next_run_at: ... }`.
  - [x] 5.8 All mutations refresh the card on success. Show row-level error on failure (don't clear the whole card).
  - [x] 5.9 Follow brand standards: Poppins font, navy `#1a174d` headings, blue `#1d87c8` action buttons, white card background.

- [x] Task 6: Wire card into admin dashboard page
  - [x] 6.1 Import `SchedulerStatusCard` in `src/app/dashboard/admin/page.tsx`.
  - [x] 6.2 Added above the sync runs / AI costs two-column section.
  - [x] 6.3 No server-side data fetching needed — card is fully client-side like `SyncRunSummaryCard`.

- [x] Task 7: Auth allowlist
  - [x] 7.1 Added `'admin:view-scheduler'` and `'admin:manage-scheduler'` to the admin role and `ProtectedAction` type in `src/modules/auth/authorization.ts`.

## Dev Notes

### Existing Patterns to Follow

- **Auth middleware**: all admin API routes use `withAuth(handler, { action: '...' })` from `@/modules/auth` — see `src/app/api/internal/admin/sync-runs/route.ts` for the exact pattern.
- **Client component pattern**: `SyncRunSummaryCard.tsx` is the reference implementation — same file structure, same `useEffect`/`useState` pattern, same error/loading states, same pagination approach.
- **DB client**: use `getSupabaseAdminClient()` from `@/modules/persistence` for all server-side DB access.
- **Active client scoping**: extract `activeClientId` from the session for all queries — see `AdminGovernanceConsole.tsx` for how the admin page passes it.
- **PATCH route pattern**: see `src/app/api/internal/admin/governance/route.ts` for how admin PATCH routes validate input and return 400/403/200.

### Exported function from scheduler.ts (Task 4)

Extract this from the `GlobalScheduler` class into a standalone export:

```typescript
export async function createPolicyVersionForCronChange(
  policyFamily: string,
  policyKey: string,
  newCronExpression: string,
): Promise<number | null>
```

The PATCH route imports it directly — no `GlobalScheduler` instantiation needed in the API route.

### Cron validation in the PATCH route

```typescript
import { calculateNextRunAt } from '@/modules/ingestion/scheduler';

try {
  const nextRunAt = calculateNextRunAt(cronExpression);
  // valid — use nextRunAt in the DB update
} catch {
  return NextResponse.json({ error: { code: 'INVALID_CRON', message: 'Invalid cron expression' } }, { status: 400 });
}
```

### DB query for GET (Task 1.3)

```sql
select
  sd.*,
  sr.status     as last_run_status,
  sr.started_at as last_run_started_at,
  sr.completed_at as last_run_completed_at,
  sr.error_message as last_run_error
from cblaero_app.schedule_definitions sd
left join lateral (
  select * from cblaero_app.schedule_runs
  where schedule_definition_id = sd.id
  order by requested_at desc
  limit 1
) sr on true
where sd.tenant_id = $1
order by sd.job_key;
```

Use via Supabase JS:
```typescript
const { data } = await db
  .from('schedule_definitions')
  .select(`*, schedule_runs(status, started_at, completed_at, error_message)`)
  // Note: Supabase doesn't support lateral joins via JS client — use .rpc() with a raw SQL function
  // OR fetch definitions + latest run separately and merge in application code
```

Recommended: fetch `schedule_definitions` then for each, fetch the latest `schedule_runs` row — 2 queries, simple, no RPC needed at this scale (max 20 definitions).

### Table columns and data shape

```typescript
type ScheduleDefinitionSummary = {
  id: number;
  job_key: string;
  name: string;
  cron_expression: string;
  enabled: boolean;
  next_run_at: string;
  last_claimed_at: string | null;
  last_run: {
    status: string;
    started_at: string | null;
    completed_at: string | null;
    error_message: string | null;
  } | null;
};
```

### Security constraints

- All routes require admin session — `withAuth` rejects unauthenticated requests.
- Tenant isolation: every DB read/write filters by `tenant_id` from session, not from the request body.
- The trigger endpoint calls `GlobalScheduler` in-process with `registerIngestionJobs()` — same as the machine-auth jobs route, but gated by session auth instead of bearer token.

### Files to create

- `src/app/api/internal/admin/scheduler/definitions/route.ts` (GET)
- `src/app/api/internal/admin/scheduler/definitions/[id]/route.ts` (PATCH)
- `src/app/api/internal/admin/scheduler/definitions/[id]/trigger/route.ts` (POST)
- `src/app/dashboard/admin/SchedulerStatusCard.tsx`

### Files to modify

- `src/modules/ingestion/scheduler.ts` — extract `createPolicyVersionForCronChange` as public export
- `src/app/dashboard/admin/page.tsx` — add `<SchedulerStatusCard />`
- Auth module — add new action strings to admin allowlist

### References

- `src/app/api/internal/admin/sync-runs/route.ts` — auth pattern
- `src/app/dashboard/admin/SyncRunSummaryCard.tsx` — client component pattern
- `src/app/dashboard/admin/AdminGovernanceConsole.tsx` — PATCH mutation pattern
- `src/modules/ingestion/scheduler.ts` — `GlobalScheduler`, `calculateNextRunAt`, `createPolicyVersionForCronChange`
- `docs/dashboard-ui-standards.md` — brand/layout requirements
- `_bmad-output/stories/2-7-implement-global-scheduler-control-plane.md` — parent story

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6

### Completion Notes List

- Implemented all 7 tasks in a single session with no regressions (pre-existing Supabase integration test failures confirmed unchanged by baseline comparison).
- `createPolicyVersionForCronChange` extracted as standalone exported async function at bottom of `scheduler.ts`; private class method now delegates to it.
- PATCH route includes a `JOB_POLICY_MAP` to resolve policyFamily/policyKey from job_key — required to create versioned policy entry on cron change (AC 3).
- Trigger endpoint calls `GlobalScheduler` + `registerIngestionJobs()` in-process using session auth, not machine bearer token.
- `SchedulerStatusCard` uses React fragment key workaround for sibling error/detail rows per definition.
- The dashboard card shows: job name + key, human-readable schedule (read-only, `cronToHuman()`), status badge, last run time, editable next run (datetime-local input), Run now + Pause/Enable buttons. Inline cron editing removed 2026-04-16 — schedules are code-defined only.
- Admin dashboard sections wrapped in `CollapsibleCard` component (2026-04-16) for cleaner multi-section layout.

### Post-Ship Bug Fix — claim guard blocking re-claims (2026-04-16)

**Symptom:** Jobs completed successfully but "Next Run" showed "overdue" indefinitely. The scheduler tick ran every 10 minutes but could not re-claim completed jobs.

**Root cause:** `updateScheduleDefinitionNextRun()` in `scheduler.ts` advanced `next_run_at` but did NOT clear `last_claimed_at`. The `claim_due_schedules()` RPC guards against duplicate claims via `last_claimed_at IS NULL OR last_claimed_at < p_stale_threshold` (15-minute threshold). With a 10-minute tick interval, the claim was never stale enough to be re-claimed.

**Fix:** Set `last_claimed_at = null` when updating `next_run_at` after job completion. Added error logging to the previously silent DB update. Also cleared stuck `last_claimed_at` values directly in production DB.

**Why this wasn't seen with old per-job Render cron jobs:** The old pattern bypassed `claim_due_schedules()` entirely — each Render cron called the job directly via `/api/internal/jobs/run?job=<key>`. The claim guard only applies to the GlobalScheduler's `runDueJobs()` flow.

### File List

- `_bmad-output/stories/2-7a-scheduler-admin-dashboard.md` (new)
- `src/app/api/internal/admin/scheduler/definitions/route.ts` (new)
- `src/app/api/internal/admin/scheduler/definitions/[id]/route.ts` (new)
- `src/app/api/internal/admin/scheduler/definitions/[id]/trigger/route.ts` (new)
- `src/app/dashboard/admin/SchedulerStatusCard.tsx` (new)
- `src/modules/auth/authorization.ts` (modified — added admin:view-scheduler, admin:manage-scheduler)
- `src/modules/ingestion/scheduler.ts` (modified — extracted createPolicyVersionForCronChange as public export)
- `src/app/dashboard/admin/page.tsx` (modified — added SchedulerStatusCard)
- `_bmad-output/sprint-status.yaml` (modified)
