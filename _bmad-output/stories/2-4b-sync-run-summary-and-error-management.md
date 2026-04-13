# Story 2.4b: Sync Run Summary and Error Management

Status: done

## Story

As an admin,
I want to see batch-level sync run summaries on the dashboard with the ability to drill into individual errors per run,
so that I can understand which ingestion runs failed and why without scrolling through thousands of individual error rows.

## Acceptance Criteria

1. **Given** any ingestion job (Ceipal, email, OneDrive, dedup, digest) runs
   **When** the job completes (success or failure)
   **Then** a `sync_runs` row exists with the domain source name (e.g. `'ceipal'`, not `'CeipalIngestionJob'`), status (complete/failed), started_at, completed_at, and accurate succeeded/failed/total counts

2. **Given** an error recorded during a tracked job run
   **When** `recordSyncFailure()` is called with a `runId`
   **Then** the `sync_errors` row has a `run_id` FK linking it to the parent `sync_runs` row

3. **Given** `createSyncRun()` fails (e.g. Supabase down)
   **When** an ingestion job starts
   **Then** the job proceeds normally with null `runId` — ingestion is not blocked, errors are recorded without `run_id`

4. **Given** the admin dashboard page
   **When** it renders
   **Then** a SyncRunSummaryCard shows current month's sync runs (source, time, duration, succeeded, failed, total, status) ordered latest first

5. **Given** a month boundary (e.g. April → May)
   **When** the admin views the dashboard in the new month
   **Then** only the new month's runs appear — previous month's runs are not shown

6. **Given** a sync run row with `failed > 0`
   **When** the row renders on the summary card
   **Then** a "View Errors" link navigates to `/dashboard/admin/sync-errors?runId=xxx`

7. **Given** a sync run row with `failed = 0`
   **When** the row renders on the summary card
   **Then** no "View Errors" link is shown

8. **Given** the sync errors detail page with a valid `runId`
   **When** errors load
   **Then** they are grouped by error type (message pattern) with count per group, and each group is collapsible (collapsed by default)

9. **Given** an error group header on the detail page
   **When** it is clicked
   **Then** it expands to show individual errors (record_id, timestamp) and collapses on second click

10. **Given** the sync errors detail page without a `runId` param
    **When** the page loads
    **Then** it shows "Select a run from the admin dashboard" with a link back

11. **Given** the admin dashboard
    **When** no sync runs exist for the current month
    **Then** the summary card shows "No sync runs this month"

12. **Given** a job that finds zero items to process (e.g. 0 Ceipal applicants, 0 OneDrive files)
    **When** the job completes via early return
    **Then** the `sync_runs` row has status `'complete'` with succeeded=0, failed=0, total=0

13. **Given** `sync_runs` and `sync_errors` rows older than 30 days
    **When** the auto-prune runs (on each `recordSyncFailure()` call)
    **Then** both old `sync_runs` and old `sync_errors` rows are deleted — no orphaned runs with missing error details

## Tasks

- [x] Task 1: Create `sync_runs` table and add `run_id` FK to `sync_errors`
  - File: `supabase/schema.sql`
  - Action: Add `sync_runs` table (id uuid PK default gen_random_uuid(), source text not null, status text not null default 'running', started_at timestamptz not null default now(), completed_at timestamptz, succeeded int not null default 0, failed int not null default 0, total int not null default 0). Add `run_id uuid references cblaero_app.sync_runs(id)` nullable column to `sync_errors`. Index on `sync_runs(started_at desc)` and `sync_errors(run_id)`. Grants: `grant select, insert, update on sync_runs to service_role` and `grant select on sync_runs to authenticated`. No grants to `anon`. Add UPDATE grant on `sync_errors` to `service_role` (for `run_id` column).
  - Notes: Apply via Supabase MCP `apply_migration`. No RLS needed — API routes enforce admin access via `withAuth()`.

- [x] Task 2: Add run tracking functions to sync-error-repository
  - File: `src/features/candidate-management/infrastructure/sync-error-repository.ts`
  - Action: Add `SyncRun` type: `{ id: string; source: string; status: string; startedAt: string; completedAt: string | null; succeeded: number; failed: number; total: number }`. Add `createSyncRun(source: string): Promise<string | null>` — inserts row, returns id. Returns null on failure (never throws — run tracking must not block ingestion). Add `completeSyncRun(runId: string, counts: { succeeded: number; failed: number; total: number }): Promise<void>` — sets status='complete', completed_at=now(), counts. No-op if runId is null. Add `failSyncRun(runId: string, error: string): Promise<void>` — sets status='failed', completed_at=now(). No-op if runId is null. Add `listSyncRunsCurrentMonth(): Promise<SyncRun[]>` — selects runs where `started_at >= date_trunc('month', now())` ordered by started_at desc. Add `listSyncErrorsByRun(runId: string): Promise<SyncError[]>` — selects all errors where run_id matches, ordered by occurred_at desc. Update `recordSyncFailure()` signature to accept optional `runId?: string` — include `run_id` in insert when provided (still fire-and-forget). Extend the existing 30-day prune to also delete old `sync_runs` rows alongside `sync_errors`.
  - Notes: `createSyncRun` returns `null` on failure so callers don't need try/catch. `completeSyncRun`/`failSyncRun` silently no-op on null `runId`.

- [x] Task 3: Update ingestion jobs to create/complete sync runs
  - File: `src/modules/ingestion/jobs.ts`
  - Action: For each of the 5 job classes:
    (a) At the top of `run()`, call `const runId = await createSyncRun(SOURCE_NAME)` where SOURCE_NAME is the domain source string (not `this.name`): `'ceipal'` for CeipalIngestionJob, `'email'` for EmailIngestionJob, `'onedrive'` for OneDriveResumePollerJob, `'dedup'` for DedupWorkerJob, `'saved_search_digest'` for SavedSearchDigestJob.
    (b) Pass `runId` (which may be null) as 4th argument to `recordSyncFailure()` calls that are directly in the job's scope. Note: `EmailIngestionJob` per-email errors happen inside the parser callback — these stay untracked (null `run_id`). Only the top-level polling error gets the `runId`.
    (c) In a `finally` block, call `completeSyncRun(runId, { succeeded, failed, total })`. For `SavedSearchDigestJob`: add local counter variables (`let succeeded = 0; let failed = 0;`) since they don't currently exist — increment in the per-search loop.
    (d) For early returns (e.g., CeipalIngestionJob with 0 applicants, OneDriveResumePollerJob with 0 files): still call `completeSyncRun(runId, { succeeded: 0, failed: 0, total: 0 })` so the run shows as complete with zero counts.
    (e) In the top-level `catch`, call `failSyncRun(runId, error.message)`.
  - Notes: Don't change the `SchedulerJob` interface — run tracking is internal. `runId` may be null if `createSyncRun` failed — all downstream calls no-op on null. OneDrive parallel chunks: capture `runId` in outer scope.

- [x] Task 4: Create sync runs list API
  - File: `src/app/api/internal/admin/sync-runs/route.ts` (new)
  - Action: `GET` handler with `withAuth({ action: 'admin:view-sync-runs' })`. Calls `listSyncRunsCurrentMonth()`. Returns `{ data: SyncRun[] }`.
  - Notes: Follows existing admin API pattern from `ai-usage/route.ts`.

- [x] Task 5: Create sync errors by run API
  - File: `src/app/api/internal/admin/sync-errors/route.ts` (new)
  - Action: `GET` handler with `withAuth({ action: 'admin:view-sync-errors' })`. Reads `runId` from `?runId=xxx` query param (required). Calls `listSyncErrorsByRun(runId)`. Returns `{ data: SyncError[] }`.
  - Notes: Returns 400 if `runId` not provided.

- [x] Task 6: Create SyncRunSummaryCard component
  - File: `src/app/dashboard/admin/SyncRunSummaryCard.tsx` (new)
  - Action: "use client" component. Fetches `GET /api/internal/admin/sync-runs` on mount. Renders a card with header "Sync Runs — {Month Year}" (e.g. "Sync Runs — April 2026"). Table rows: Source label, Started (relative time e.g. "2h ago"), Duration (e.g. "45s"), Succeeded (green), Failed (red, 0 = gray), Total, Status badge (complete=green, failed=red, running=blue). "View Errors" link on rows with `failed > 0` → `/dashboard/admin/sync-errors?runId=xxx`. Empty state: "No sync runs this month." Loading state: spinner. Follow dashboard-ui-standards.md: rounded-xl card, text-sm body, cbl-navy/cbl-blue accents, text-xs section header.
  - Notes: Self-fetching client component. Read-only — no dismiss/delete buttons.

- [x] Task 7: Create sync errors detail page
  - File: `src/app/dashboard/admin/sync-errors/page.tsx` (new)
  - Action: "use client" page component. Reads `runId` from URL search params. Fetches `GET /api/internal/admin/sync-errors?runId=xxx`. Renders:
    **Run info bar:** source, date, succeeded/failed/total as compact badges.
    **Error groups:** Group errors by message pattern (first 60 chars) with count per group. Each group is a collapsible row — collapsed by default, click to expand individual errors (record_id, timestamp). Compact layout: text-sm body, tight py-2 padding.
    **Zero errors:** Show "No errors in this run" success message.
    Standard dashboard layout: navy header with breadcrumbs (Dashboard / Admin / Sync Errors), Sign Out right, dark footer. Follow dashboard-ui-standards.md.
  - Notes: Read-only — no action buttons. If no `runId` param, show "Select a run from the admin dashboard" with link back.

- [x] Task 8: Update admin dashboard to use SyncRunSummaryCard
  - File: `src/app/dashboard/admin/page.tsx`
  - Action: Replace `<SyncErrorStatusCard errors={syncErrors} />` with `<SyncRunSummaryCard />`. Remove `listRecentSyncErrors()` import and call from server-side data fetching. Remove `syncErrors` variable and related try/catch. Remove sync error count from quick links bar — the card handles this now.
  - Notes: The admin page gets simpler — one less server-side data fetch. Keep `SyncErrorStatusCard.tsx` file (don't delete — zero-risk approach).

## Dev Notes

### Dependencies
- Story 2.4a (Dashboard UI Standardization) — UI must follow the established dashboard standards
- `withAuth()` must support `admin:view-sync-runs` and `admin:view-sync-errors` actions

### Design Decisions
- **Read-only UI** — no dismiss, no retry, no destructive actions
- **Current month only** — auto-rotates, previous months fall off the summary card
- **`createSyncRun()` returns null on failure** — never blocks ingestion
- **Domain source names** (`'ceipal'`, `'email'`, `'onedrive'`) not job class names (`this.name`)
- **Errors-only detail page** — no candidate listing (time-window query was unreliable)
- **30-day prune covers both tables** — no orphaned runs with missing error details
- **Grants restricted** — `service_role` for writes, `authenticated` for SELECT only, no `anon`
- **Fire-and-forget `run_id`** — if FK insert fails silently, error still exists with null `run_id`, not lost
- **Email parser errors stay untracked** — per-email failures happen inside parser callback, only top-level polling failure gets `runId`. The `failed` count comes from the parser's return value.

### Codebase Context
- Sync errors persisted via `recordSyncFailure()` in `sync-error-repository.ts` — fire-and-forget
- 5 job classes in `src/modules/ingestion/jobs.ts` — all implement `SchedulerJob` interface
- Jobs triggered via `POST /api/internal/jobs/run` with Bearer token auth
- Admin page is server-rendered, sub-components are client components
- `sync_errors` table also used as KV store (markers) — `run_id` must be nullable

### Files to Create/Modify
- `supabase/schema.sql` — sync_runs table + run_id FK
- `src/features/candidate-management/infrastructure/sync-error-repository.ts` — run tracking functions
- `src/modules/ingestion/jobs.ts` — wire run tracking into all 5 jobs
- `src/app/api/internal/admin/sync-runs/route.ts` (new)
- `src/app/api/internal/admin/sync-errors/route.ts` (new)
- `src/app/dashboard/admin/SyncRunSummaryCard.tsx` (new)
- `src/app/dashboard/admin/sync-errors/page.tsx` (new)
- `src/app/dashboard/admin/page.tsx` — swap SyncErrorStatusCard for SyncRunSummaryCard

### Testing Strategy

**Unit Tests:**
- `sync-error-repository.ts`: Test `createSyncRun` (returns id on success, null on failure), `completeSyncRun` (updates counts/status, no-ops on null), `failSyncRun`, `listSyncRunsCurrentMonth` (filters by month), `listSyncErrorsByRun`, updated `recordSyncFailure` with `runId` param, 30-day prune covers both tables
- `jobs.ts`: Test that each job calls `createSyncRun` at start with correct domain source name, passes `runId` to `recordSyncFailure`, calls `completeSyncRun` in finally block, handles null `runId` gracefully, calls `completeSyncRun` with zero counts on early returns

**Integration Tests (manual):**
- Trigger each job via `/api/internal/jobs/run`, verify `sync_runs` row created with correct source name
- Visit admin dashboard, verify SyncRunSummaryCard shows the run
- Click "View Errors" on a failed run, verify detail page loads with grouped errors
- Verify runs from previous months don't appear
- Verify a job still works when `createSyncRun` is simulated to fail

### Adversarial Review Findings Addressed

| Finding | Resolution |
|---|---|
| F1 (Critical): Candidate time-window query broken | Removed — detail page is errors-only |
| F2 (Critical): SavedSearchDigestJob missing counters | Task 3c explicitly adds counter variables |
| F3 (High): 30-day prune orphans sync_runs | Prune covers both tables (Task 2) |
| F4 (High): No RLS, grants too broad | Grants restricted to service_role + authenticated SELECT (Task 1) |
| F5 (High): Fire-and-forget run_id may not persist | Accepted — errors still exist with null run_id |
| F6 (High): Job name vs source name mismatch | Uses domain source names (Task 3a) |
| F7 (Medium): Missing candidate index | Removed — no candidate query |
| F8 (Medium): Early returns leave runs as 'running' | completeSyncRun with zero counts (Task 3d, AC 12) |
| F9 (Medium): Email parser errors untracked | Accepted — documented in Dev Notes |
| F10 (Medium): createSyncRun failure aborts job | Returns null, all downstream no-ops (Task 2, AC 3) |
| F11 (Low): AC tested wrong thing | Removed, replaced with clearer ACs |
| F12 (Low): Missing UPDATE grant | Added to Task 1 |

## Senior Developer Review (AI)

**Review Date:** 2026-04-08
**Review Outcome:** Changes Requested (8 findings — all fixed)

### Action Items

- [x] [HIGH] H1: `failSyncRun` error parameter dead code — added `error_message` column to `sync_runs`, stored in failSyncRun [sync-error-repository.ts:170, schema.sql]
- [x] [HIGH] H2: FK missing ON DELETE SET NULL — prune could FK-violate on concurrent calls [schema.sql:1608]
- [x] [HIGH] H3: Original `sync_errors` grants give `anon` INSERT — revoked overly-broad grants [schema.sql:1274]
- [x] [MED] M1: SavedSearchDigestJob skipped searches create phantom gap in counts [jobs.ts:580]
- [x] [MED] M2: `listSyncRunsCurrentMonth` uses server-local TZ for month boundary [sync-error-repository.ts:193]
- [x] [MED] M3: New capabilities not registered in architecture.md / dev-standards.md §18
- [x] [MED] M4: Prune fires on failed inserts — gated behind `!dbErr` [sync-error-repository.ts:63]
- [x] [LOW] L1: SyncRunSummaryCard has no error state in UI — fetch failure shows misleading empty state

### Additional Enhancements (User Request)
- [x] Stack traces persisted: `recordSyncFailure` now stores `err.stack`, `failSyncRun` stores full trace
- [x] Clickable rows on SyncRunSummaryCard expand to show full debug info (run ID, timestamps, error/stack trace)
- [x] Clickable rows on sync errors detail page expand to show full error metadata and stack trace

### Second Review (Sonnet) — 2026-04-08
**Review Outcome:** Changes Requested (4H, 6M, 1L — all fixed)

- [x] [HIGH] H1: SyncRunSummaryCard grid-inside-td breaks column alignment — rewrote with proper tr/td + Fragment
- [x] [HIGH] H2: sync-errors/page.tsx missing Suspense boundary for useSearchParams — added Suspense wrapper
- [x] [HIGH] H3: sync-errors/page.tsx no HTTP error handling on fetch — added r.ok check + fetchError state
- [x] [HIGH] H4: listSyncErrorsByRun has no LIMIT — added .limit(500)
- [x] [MED] M1: listSyncRunsCurrentMonth has no LIMIT — added .limit(200)
- [x] [MED] M2: sync-errors/page.tsx non-unique React key on error groups — changed to index-based key
- [x] [MED] M3: sync-errors/page.tsx expanded detail in same td prevents text selection — separate tr for detail
- [x] [MED] M4: SyncRunSummaryCard empty state py-8 should be py-16 per UI standards
- [x] [MED] M5: OneDrive skipped files counted in total but not succeeded — added skipped counter
- [x] [MED] M6: No UUID validation on runId API param — added UUID regex validation
- [x] [LOW] L1: Clarified duplicate import in index.ts with comment (re-export + local import both needed)

## Dev Agent Record

### Implementation Plan
- Created `sync_runs` table with proper grants (service_role write, authenticated read-only, no anon)
- Added `run_id` nullable FK to `sync_errors` for linking errors to parent runs
- Added 6 new repository functions: `createSyncRun`, `completeSyncRun`, `failSyncRun`, `listSyncRunsCurrentMonth`, `listSyncErrorsByRun`, plus updated `recordSyncFailure` with optional `runId` param
- Extended 30-day prune to cover both `sync_errors` and `sync_runs` tables
- Wired sync run tracking into all 5 job classes with domain source names
- Added `admin:view-sync-runs` and `admin:view-sync-errors` to ProtectedAction type and admin role
- Created two new admin API routes following existing `ai-usage` pattern
- Built SyncRunSummaryCard (self-fetching client component) with table, status badges, relative times, "View Errors" links
- Built sync errors detail page with collapsible error groups, breadcrumb navigation, dashboard-ui-standards compliance
- Replaced SyncErrorStatusCard with SyncRunSummaryCard on admin dashboard, removed server-side sync error fetch

### Completion Notes
All 8 tasks completed. TypeScript compiles cleanly (`tsc --noEmit` exit code 0). All acceptance criteria addressed:
- AC1-3: Sync runs created/completed/failed with domain source names, null-safe
- AC4-5: SyncRunSummaryCard shows current month runs, auto-rotates monthly
- AC6-7: "View Errors" link only on rows with failed > 0
- AC8-9: Error groups collapsible, collapsed by default
- AC10: No runId param shows redirect message
- AC11: Empty state "No sync runs this month"
- AC12: Early returns complete with zero counts
- AC13: 30-day prune covers both tables

## File List

| File | Action |
|------|--------|
| `cblaero/supabase/schema.sql` | Modified — added sync_runs table, run_id FK, indexes, grants |
| `cblaero/src/features/candidate-management/infrastructure/sync-error-repository.ts` | Modified — added SyncRun type, 5 new functions, updated recordSyncFailure, extended prune |
| `cblaero/src/modules/ingestion/index.ts` | Modified — added re-exports for new sync run functions |
| `cblaero/src/modules/ingestion/jobs.ts` | Modified — wired sync run tracking into all 5 job classes |
| `cblaero/src/modules/auth/authorization.ts` | Modified — added admin:view-sync-runs and admin:view-sync-errors actions |
| `cblaero/src/app/api/internal/admin/sync-runs/route.ts` | New — GET endpoint for listing current month sync runs |
| `cblaero/src/app/api/internal/admin/sync-errors/route.ts` | New — GET endpoint for listing errors by run |
| `cblaero/src/app/dashboard/admin/SyncRunSummaryCard.tsx` | New — self-fetching client component for sync run table |
| `cblaero/src/app/dashboard/admin/sync-errors/page.tsx` | New — error detail page with collapsible groups |
| `cblaero/src/app/dashboard/admin/page.tsx` | Modified — replaced SyncErrorStatusCard with SyncRunSummaryCard, removed server-side fetch |
| `docs/planning_artifacts/architecture.md` | Modified — registered 5 new sync run capabilities + SyncRunSummaryCard in capability registry |
| `docs/planning_artifacts/development-standards.md` | Modified — registered sync run tracking in §18 utility table |

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-04-08 | Story created from quick-spec with adversarial review (12 findings addressed) | Dev Agent |
| 2026-04-08 | Implementation complete — all 8 tasks done, tsc clean | Dev Agent |
| 2026-04-08 | Code review: 8 findings (3H, 4M, 1L) — all fixed. Added error_message column, ON DELETE SET NULL, revoked anon grants, UTC month boundary, capability registration, stack traces, clickable row debug panels | Review Agent |
| 2026-04-08 | 2nd code review (Sonnet): 11 findings (4H, 6M, 1L) — all fixed. Proper table layout, Suspense boundary, fetch error handling, query limits, UUID validation, OneDrive skip counting | Review Agent |
