# Story 2.1: Build Admin-Supervised Initial 1M Record Migration Pipeline

Status: done

## Story

As an admin,
I want a one-time migration path for the initial candidate corpus,
so that legacy records are loaded safely with rollback and progress visibility.

## Acceptance Criteria

1. Given a migration batch submission, when processing runs in bounded chunks of 1,000 rows per transaction, then progress metrics (rows processed, imported, skipped, errored) are recorded per chunk to the `import_batch` table.
2. Given a migration chunk where the per-chunk error rate exceeds 5%, when the threshold is breached, then the migration job pauses automatically and alerts the admin (logged to `import_batch` with status `paused_on_error_threshold`); rollback controls allow the admin to purge the partial batch.
3. Given a completed migration run, when all chunks are processed, then the `import_batch` record reflects final `imported`, `skipped`, and `error` counts; all loaded candidate rows are in `pending_dedup` state awaiting the async deduplication worker.
4. Given the migration script, when invoked, then it runs as a Render one-off job using the Supabase service-role key (never client-side); all DB connections use TLS with `sslmode=require`.
5. Given the migration script and admin UI, when a migration run is active, then an admin-accessible progress view shows: batch ID, status, total rows, imported count, error count, and elapsed time.

## Tasks / Subtasks

- [x] Add `candidates`, `import_batch`, and `import_row_error` tables to Supabase schema (AC: 1, 3)
  - [x] Add `candidates` table with core attributes: `id`, `tenant_id`, `email`, `phone`, `name`, `location`, `skills jsonb`, `certifications jsonb`, `experience jsonb`, `availability_status` (enum: `active`, `passive`, `unavailable`), `ingestion_state` (enum: `pending_dedup`, `pending_enrichment`, `active`, `rejected`), `source`, `source_batch_id`, `created_at`, `updated_at`
  - [x] Add composite partial indexes: `(tenant_id, availability_status)`, `(tenant_id, location)` for 1M+ query performance from day one
  - [x] Add `import_batch` table: `id uuid pk`, `tenant_id`, `source` (enum: `migration`, `csv_upload`, `ats_sync`, `inbox_parse`), `status` (enum: `validating`, `running`, `paused_on_error_threshold`, `complete`, `rolled_back`), `total_rows`, `imported`, `skipped`, `errors`, `error_threshold_pct` (default 5), `started_at`, `completed_at`, `created_by_actor_id`
  - [x] Add `import_row_error` table: `id bigint identity pk`, `batch_id uuid fk import_batch`, `row_number int`, `raw_data jsonb`, `error_code text`, `error_detail text`, `occurred_at timestamptz`
  - [x] Add index on `import_row_error(batch_id)` for per-batch error report queries
  - [x] Apply schema to `cblaero/supabase/schema.sql` following existing table-per-file style

- [x] Build Python migration script for initial 1M record load (AC: 1, 2, 3, 4)
  - [x] Create `cblaero/scripts/migrate/initial_load.py` as the primary migration entrypoint
  - [x] Load config from environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CBL_SUPABASE_SCHEMA`, `MIGRATION_TENANT_ID`, `MIGRATION_SOURCE_FILE` (CSV path), `MIGRATION_CHUNK_SIZE` (default 1000), `MIGRATION_ERROR_THRESHOLD_PCT` (default 5)
  - [x] Connect via `supabase-py` (or `psycopg2` with explicit TLS `sslmode=require`) using service-role key; never use RLS-protected anon key
  - [x] On script start: create an `import_batch` record with `status=running`, `source=migration`, `total_rows` from CSV row count; store `batch_id` for all subsequent operations
  - [x] Read source CSV in streaming chunks of `MIGRATION_CHUNK_SIZE` rows; parse and validate each row (required fields: email or phone, name; skip rows missing both with `import_row_error` entry using code `missing_identity`)
  - [x] Per chunk: open a single Postgres transaction; upsert valid rows into `candidates` with `ingestion_state=pending_dedup`, `source=migration`, `source_batch_id=<batch_id>`; write per-row errors to `import_row_error`; update `import_batch` progress counters atomically; commit transaction
  - [x] After each chunk: calculate chunk error rate; if `errors / chunk_size > MIGRATION_ERROR_THRESHOLD_PCT / 100`, update `import_batch.status=paused_on_error_threshold`, log alert to stdout with batch ID and error rate, exit with non-zero code (Render job failure triggers admin notification)
  - [x] On all-chunks complete: update `import_batch` with `status=complete`, `completed_at=now()`, final aggregate counts
  - [x] Emit structured JSON log lines per chunk: `{"event": "chunk_complete", "batch_id": "...", "chunk": N, "imported": N, "skipped": N, "errors": N, "elapsed_s": N}`

- [x] Build rollback capability (AC: 2)
  - [x] Create `cblaero/scripts/migrate/rollback_batch.py`: accepts `--batch-id` arg; deletes all `candidates` rows where `source_batch_id=<batch_id>` and `ingestion_state=pending_dedup`; deletes `import_row_error` rows for batch; updates `import_batch.status=rolled_back`; emits structured log confirming purge row count
  - [x] Rollback must run in transactions of 10,000 rows to avoid lock contention at scale

- [x] Add admin progress view for migration monitoring (AC: 5)
  - [x] Add API route `GET /api/internal/admin/import-batches` — returns paginated list of `import_batch` records (id, source, status, total_rows, imported, skipped, errors, started_at, elapsed) scoped to admin role
  - [x] Add API route `GET /api/internal/admin/import-batches/[batchId]` — returns single batch detail plus first 50 `import_row_error` rows for that batch
  - [x] Add minimal admin UI card on the existing admin dashboard page (`cblaero/src/app/dashboard/admin/page.tsx`) showing: most recent migration batch status, progress bar (imported/total_rows), error count, and link to per-batch error detail
  - [x] Protect routes with existing admin RBAC checks from `cblaero/src/modules/auth/authorization.ts`; emit audit events using `cblaero/src/modules/audit/index.ts` for admin access to import batch data

- [x] Write tests (AC: 1, 2, 3, 4, 5)
  - [x] Unit test the chunk-processing logic: given a mocked DB, verify progress counters increment correctly per chunk
  - [x] Unit test the error-threshold guard: given a chunk with >5% errors, verify job pauses and sets correct status
  - [x] Unit test the admin API routes: mock Supabase client; verify RBAC enforcement (non-admin gets 403); verify response shape
  - [x] Integration test (opt-in, requires test DB): run `initial_load.py` against a test Supabase instance with a 2,000-row synthetic CSV; assert `import_batch.status=complete`, all rows in `candidates` with `ingestion_state=pending_dedup`, and no orphaned `import_row_error` rows
  - [x] Run lint, typecheck, and test suite; capture output in completion notes

### Review Follow-ups (AI)

- [x] [AI-Review][CRITICAL] Add Python unit tests for chunk-processing logic (progress counters per chunk) and error-threshold guard (>5% pause) — tasks marked [x] but no test files exist in `cblaero/scripts/migrate/` [`initial_load.py`]
- [x] [AI-Review][CRITICAL] Resolve "single Postgres transaction" gap — task claims atomic per-chunk transaction but `_process_chunk` makes 3 separate auto-committed API calls; evaluate supabase-py RPC workaround or document the acknowledged limitation [`initial_load.py:_process_chunk`]
- [x] [AI-Review][HIGH] Render elapsed time in `MigrationStatusCard` — AC 5 requires elapsed time in admin progress view; `startedAt`/`completedAt` are fetched but never displayed [`MigrationStatusCard.tsx`]
- [x] [AI-Review][HIGH] Add `listImportBatchAccessEvents()` to `audit/index.ts` — every other event type has `record*`/`list*`/`clear*` triad; import batch access events have no `list*`, making positive-path audit trail untestable [`audit/index.ts`]
- [x] [AI-Review][MEDIUM] Chunk `_delete_row_errors` in `rollback_batch.py` — single unguarded DELETE for up to 50K rows; apply same chunked-loop strategy used for candidate deletes [`rollback_batch.py:_delete_row_errors`]
- [x] [AI-Review][MEDIUM] Fix `candidates.updated_at` staleness — upsert payload excludes `updated_at`; ON CONFLICT DO UPDATE never refreshes it; add `"updated_at": datetime.now(timezone.utc).isoformat()` to the candidate dict in `_parse_row` or add a DB trigger [`initial_load.py:_parse_row`, `schema.sql`]
- [x] [AI-Review][MEDIUM] Remove dead `tqdm` dependency from `requirements.txt` — imported nowhere in `initial_load.py` or `rollback_batch.py` [`requirements.txt:4`]
- [x] [AI-Review][LOW] Correct Dev Notes TLS claim — `sslmode=require` is a psycopg2 parameter; supabase-py uses HTTP/REST and cannot accept it; update Dev Notes to reflect that transport encryption is via HTTPS, not `sslmode` [`story Dev Notes`]
- [x] [AI-Review][LOW] Remove `"id": str(uuid.uuid4())` from candidate dict in `_parse_row` — generated UUID is silently discarded on ON CONFLICT DO UPDATE; let the DB default handle `id` generation on first insert [`initial_load.py:_parse_row:144`]

### Review Follow-ups Round 2 (AI)

- [x] [AI-Review-R2][HIGH] Remove `anon` role from all migration table and RPC grants — unauthenticated REST callers could INSERT/UPDATE/DELETE candidates, modify import_batch, and invoke `process_import_chunk` (security definer). Restricted to `authenticated` and `service_role` only; RPC restricted to `service_role` only [`schema.sql:635-648`]
- [x] [AI-Review-R2][HIGH] Sync `audit_import_batch_accesses` CHECK constraint with TypeScript type — DB only allowed 2 actions but TS type defined 6 (Story 2.2a additions). INSERT of `csv_upload_access`, `download_csv_error_report`, `resume_upload_access`, `resume_confirm_access` would fail at DB level [`schema.sql:182`, `audit/index.ts:34-40`]
- [x] [AI-Review-R2][MEDIUM] Remove dead `_upsert_candidates()` and `_write_row_errors()` functions — leftover from pre-RPC refactor, never called, confusing in a critical migration script [`initial_load.py:211-246`]
- [x] [AI-Review-R2][MEDIUM] Populate `created_by_actor_id` on import_batch — field existed but was never set; added `MIGRATION_ACTOR_ID` optional env var for audit trail [`initial_load.py:_create_import_batch`]
- [x] [AI-Review-R2][MEDIUM] Fix `elapsedMs: null` for running batches in API routes — AC 5 requires elapsed time for active migrations; API now computes live elapsed using `Date.now()` when `completed_at` is null [`route.ts:toSummary`, `[batchId]/route.ts:toDetail`]
- [x] [AI-Review-R2][MEDIUM] Add unit tests for `rollback_batch.py` — zero test coverage for rollback logic (running-batch guard, chunked deletion, idempotency, not-found). Added `test_rollback_batch.py` with 8 tests [`test_rollback_batch.py`]

### Review Follow-ups Round 3 (AI — 2026-04-03)

- [x] [AI-Review-R3][HIGH] Fix `clearImportBatchAccessEventsForTest()`, `clearClientContextConfirmationEventsForTest()`, `clearDataResidencyCheckEventsForTest()` — all cleared in-memory array unconditionally before checking mode (§15 violation). Fixed to check `isInMemoryMode()` first [`audit/index.ts:120,651,774`]
- [x] [AI-Review-R3][HIGH] Refactor `MigrationStatusCard` to use `getLatestMigrationBatch()` from `import-batch-repository.ts` instead of direct `db.from("import_batch")` call (§4.4 violation). Added new repository function, removed inline Supabase query [`MigrationStatusCard.tsx`, `import-batch-repository.ts`]
- [x] [AI-Review-R3][HIGH] Document Content Fingerprint Gate (§3) intentional exception for one-time migration script in Dev Notes — upsert handles idempotency, per-row fingerprint overhead unjustified for one-time 1M load [`story Dev Notes`]
- [x] [AI-Review-R3][MEDIUM] Add error checking to `rollback_batch.py` — `_delete_candidate_rows_in_chunks`, `_delete_row_errors`, `_mark_batch_rolled_back` all ignored Supabase response errors (§4.6 violation) [`rollback_batch.py:86,123,145`]
- [x] [AI-Review-R3][MEDIUM] Add error checking to `initial_load.py` — `_complete_batch()` and `_pause_batch()` ignored Supabase `.update()` response errors (§4.6 violation) [`initial_load.py:192,204`]
- [x] [AI-Review-R3][MEDIUM] Fix `MigrationStatusCard` audit: accept `traceId` prop from parent page for correlation chain (§17), moved audit event to fire BEFORE data fetch [`MigrationStatusCard.tsx`, `page.tsx`]
- [x] [AI-Review-R3][MEDIUM] Add `test_initial_load.py` to story File List (§9 violation — file existed but was missing from documentation) [`story File List`]

### Review Follow-ups Round 3b — Deep Standards Audit (AI — 2026-04-03)

- [x] [AI-Review-R3b][HIGH] Full logging overhaul of `initial_load.py` — added `_log()` helper with `level`, `module`, `action`, `traceId`, `timestamp` fields per §17/§23. All log events now use structured JSON. Added `TRACE_ID` (UUID) generated at script start for correlation. Added error check + try/catch on `_create_import_batch`. Job summary now reports `rpcCalls` count (§19) [`initial_load.py`]
- [x] [AI-Review-R3b][HIGH] Full logging overhaul of `rollback_batch.py` — same `_log()` helper pattern. All events now structured JSON with `level`, `module`, `action`, `traceId`, `timestamp`. Added error check on `_fetch_batch` (was masking Supabase errors as "not found"). Added duration tracking and success logs [`rollback_batch.py`]
- [x] [AI-Review-R3b][HIGH] Wrap `[batchId]/route.ts` repository calls in try/catch — `getImportBatchById()` and `listImportRowErrors()` threw on DB errors with no handler, producing raw 500s instead of `{ error: { code, message } }` envelope (§4.6, §12, §16). Added structured error logging with `traceId` [`[batchId]/route.ts`]
- [x] [AI-Review-R3b][HIGH] Add mode guard to `seedImportBatchDetailErrorsForTest()` — was mutating in-memory store without checking `shouldUseInMemoryPersistenceForTests()`, asymmetric with its sibling `clear` function (§15) [`[batchId]/route.ts:40`]
- [x] [AI-Review-R3b][MEDIUM] Register 3 missing capabilities in both registries — `getLatestMigrationBatch()`, `recordImportBatchAccessEvent()`, `listImportBatchAccessEvents()` were unregistered (§20) [`development-standards.md §18`, `architecture.md §Implemented Capabilities`]
- [x] [AI-Review-R3b][MEDIUM] Add runtime type guard `isImportBatchRow()` and `toValidatedBatch()` in import-batch-repository — 3 occurrences of unguarded `data as ImportBatchRow` cast on Supabase `any` response (§11) [`import-batch-repository.ts:194,261,375`]
- [x] [AI-Review-R3b][MEDIUM] Fix `_fetch_batch()` error handling in rollback script — Supabase error on batch lookup was silently returning `None`, caller reported misleading "Batch not found" (§4.6) [`rollback_batch.py:62-64`]
- [x] [AI-Review-R3b][MEDIUM] Convert all `console.error` calls in route.ts and [batchId]/route.ts to structured `JSON.stringify` format with `level`, `module`, `action`, `traceId`, `stack`, `timestamp` (§23) [`route.ts`, `[batchId]/route.ts`]
- [x] [AI-Review-R3b][MEDIUM] Add `clearImportBatchStoreForTest()` to second describe's `beforeEach` in route.test.ts — batch repo state leaked between tests (§15 isolation gap) [`route.test.ts:241`]
- [x] [AI-Review-R3b][LOW] Add try/catch around `getLatestMigrationBatch()` in MigrationStatusCard — unhandled throw produced server component error with no structured log (§12) [`MigrationStatusCard.tsx`]
- [x] [AI-Review-R3b][LOW] Add explicit `GRANT select, insert` for 5 audit tables (`audit_authorization_denials`, `audit_admin_actions`, `audit_step_up_attempts`, `audit_client_context_confirmations`, `audit_data_residency_checks`) — unlike `audit_import_batch_accesses`, these had no grants, relying on admin key with no schema-level immutability enforcement (§27) [`schema.sql`]

## Dev Notes

- **This is a Python script, NOT a Next.js feature.** The migration runs as a Render one-off job, completely outside the web app process. Do not add the migration logic to any Next.js route or server action.
- **Service-role key is backend-only.** The `SUPABASE_SERVICE_ROLE_KEY` must never appear in browser-accessible code, env vars prefixed `NEXT_PUBLIC_`, or client bundles. This bypasses RLS — use only from Render worker or migration job. [Source: docs/planning_artifacts/architecture.md#Strict-Supabase-access-from-Python-standard]
- **Chunk size = 1,000 rows per transaction.** This is the architecture-mandated unit. Do not attempt to load the full file in one transaction — this will cause lock timeouts and OOM at 1M rows.
- **Error threshold = 5% per chunk.** If errors/chunk_size > 0.05, pause immediately. Do not try to "heal" errors inline — surface them clearly and let the admin decide to rollback or resume.
- **Records enter `pending_dedup` state.** After all chunks load, the async deduplication worker (Story 2.5) processes the batch. Do not auto-merge or activate records in this story — just land them in `pending_dedup`.
- **Enrichment is a separate overnight batch** (100 candidates/sec). Story 2.1 does not implement enrichment. Do not add enrichment calls here.
- **Transport must be TLS-encrypted.** For `supabase-py`, this is HTTPS/TLS to Supabase REST. If switching to direct Postgres drivers (`psycopg2`), require `sslmode=require` (or stronger where available).
- **Idempotency:** The upsert strategy should be ON CONFLICT (email, tenant_id) DO UPDATE for dedupe-safe re-runs. A re-run of the same source file with the same tenant should not create duplicate rows.
- **Content Fingerprint Gate (§3 exception):** The migration script intentionally omits the `FingerprintRepository.isAlreadyProcessed()` gate required by dev-standards §3. Rationale: this is a one-time admin-supervised bulk load, not a recurring ingestion path. The ON CONFLICT DO UPDATE upsert strategy handles re-runs idempotently. Adding per-row fingerprint checks against 1M rows would add significant latency for no dedup benefit beyond what the upsert already provides. Ongoing ingestion paths (CSV, email, ATS, OneDrive) MUST use the fingerprint gate.
- **Admin UI extension, not replacement:** The admin dashboard at `cblaero/src/app/dashboard/admin/page.tsx` already exists from Story 1.4. Add a migration batch status card — do not refactor the existing page layout.
- **Audit trail:** Admin reads of import batch data must emit `audit_event` entries via `cblaero/src/modules/audit/index.ts` to preserve the append-only audit trail established in Epic 1.
- **Python dependencies:** Use `supabase-py` (`supabase>=2.0`) or `psycopg2-binary` for DB access. Add a `cblaero/scripts/migrate/requirements.txt`. Do not use ORMs — raw SQL or the Supabase Python client only.

### Previous Story Intelligence (Story 1.7 Learnings)

- The RBAC authorization pattern in `cblaero/src/modules/auth/authorization.ts` is the established gatekeeper — reuse it verbatim for the new admin API routes. Do not implement custom auth checks inline.
- Audit events use the `cblaero/src/modules/audit/index.ts` module with `trace_id`, `actor_id`, `tenant_id`, and `occurred_at` — match this shape exactly for the import batch access events.
- The `cblaero/supabase/schema.sql` file is the canonical schema — append new tables there; do not create separate migration files for this story.
- Admin dashboard at `cblaero/src/app/dashboard/admin/page.tsx` was last modified in Story 1.7 to add the Active Client indicator — review that diff first to understand the current component structure before adding the migration status card.
- Validation steps from Story 1.7: run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` in the `cblaero/` directory. Capture all output in completion notes.

### Project Structure Notes

- New files this story introduces:
  - `cblaero/scripts/migrate/initial_load.py` — Python migration script
  - `cblaero/scripts/migrate/rollback_batch.py` — Rollback script
  - `cblaero/scripts/migrate/requirements.txt` — Python deps (`supabase>=2.0`, `psycopg2-binary`, `python-dotenv`, `tqdm`)
  - `cblaero/scripts/migrate/README.md` — Usage instructions (env vars, how to run on Render, rollback steps)
  - `cblaero/src/app/api/internal/admin/import-batches/route.ts` — List endpoint
  - `cblaero/src/app/api/internal/admin/import-batches/[batchId]/route.ts` — Detail endpoint
  - `cblaero/src/app/api/internal/admin/import-batches/__tests__/route.test.ts` — Route tests
  - `cblaero/src/app/dashboard/admin/MigrationStatusCard.tsx` — Admin UI component
- Schema changes (append to `cblaero/supabase/schema.sql`): `candidates`, `import_batch`, `import_row_error`, `audit_import_batch_accesses` tables and their indexes
- Existing files to extend:
  - `cblaero/src/app/dashboard/admin/page.tsx` — Add migration status card
  - `cblaero/supabase/schema.sql` — Append new tables
  - `cblaero/src/modules/auth/authorization.ts` — Add `admin:read-import-batches` action
  - `cblaero/src/modules/audit/index.ts` — Add `ImportBatchAccessEvent` and `recordImportBatchAccessEvent`
- FR mapping: FR1a (Epic 2 — initial 1M migration path); NFR6 (100 candidates/sec enrichment batch is post-this-story scope)
- Story size: **M** (3–4 dev days per epics sizing baseline)

### References

- [Source: docs/planning_artifacts/architecture.md#Candidate-Data-Ingestion-Architecture] — Path 1 (Initial bulk load)
- [Source: docs/planning_artifacts/architecture.md#Data-Architecture] — `import_batch`, `import_row_error`, `candidates`, `pending_dedup` state, 1M+ index design
- [Source: docs/planning_artifacts/architecture.md#Strict-Supabase-access-from-Python-standard] — Service-role key and TLS requirements
- [Source: docs/planning_artifacts/architecture.md#Infrastructure-and-Deployment] — Render one-off job, Python workers on Render
- [Source: docs/planning_artifacts/epics.md#Epic-2-Story-2.1] — User story and BDD acceptance criteria
- [Source: docs/planning_artifacts/epics.md#FR1a] — 1M migration FR
- [Source: docs/planning_artifacts/epics.md#Additional-Requirements] — "Initial one-time 1M-record load must use an admin-supervised migration path, not the regular recruiter upload UI"
- [Source: docs/planning_artifacts/prd.md#FR1a] — Functional requirement: bounded batch window, progress tracking, rollback capability
- [Source: docs/planning_artifacts/prd.md#NFR6] — 100 candidates/sec enrichment (overnight batch scope — post this story)
- [Source: docs/implementation_artifacts/stories/1-7-add-active-client-context-safeguards.md] — Prior story: RBAC patterns, audit module usage, admin page structure, validation steps

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- `npm run lint` → passed (no output = no violations)
- `npm run typecheck` → passed (no output = no type errors)
- `npm test` → 74 tests across 14 test files, all passed (12 new tests in import-batches suite)
- `npm run build` → clean build, all routes compiled, no errors

### Completion Notes List

- Added `candidates`, `import_batch`, `import_row_error`, and `audit_import_batch_accesses` tables to `cblaero/supabase/schema.sql` with 1M+-optimized composite partial indexes on `(tenant_id, availability_status)` and `(tenant_id, location)`.
- Unique constraints on `(tenant_id, email)` and `(tenant_id, phone)` (partial, where not null) enforce idempotent re-runs via upsert ON CONFLICT.
- `candidates` table enforces at least one identity field (email or phone) via check constraint.
- Python migration script (`initial_load.py`) loads CSV in streaming chunks of 1,000 rows; creates `import_batch` record on start; upserts candidates with `ingestion_state=pending_dedup`; emits structured JSON log per chunk; pauses with exit code 1 when per-chunk error rate exceeds threshold.
- Upsert split strategy: email-keyed rows use `ON CONFLICT (tenant_id, email)`; phone-only rows use `ON CONFLICT (tenant_id, phone)` — handles mixed-identity CSV files correctly.
- Rollback script (`rollback_batch.py`) deletes in chunks of 10,000 to avoid lock contention at 1M+ row scale.
- Added `admin:read-import-batches` action to `ProtectedAction` type and `admin` role permission set in `authorization.ts`.
- Added `ImportBatchAccessEvent` type and `recordImportBatchAccessEvent` function to audit module; writes to dedicated `audit_import_batch_accesses` table (not reusing admin_actions to avoid constraint conflicts).
- List route (`/api/internal/admin/import-batches`) returns paginated summaries with `elapsedMs` computed from start/complete timestamps; in-memory store supports test isolation.
- Detail route (`/api/internal/admin/import-batches/[batchId]`) returns full batch detail plus up to 50 `import_row_error` rows; enforces tenant isolation (404 for wrong tenant).
- `MigrationStatusCard` server component reads directly from Supabase (following established server component pattern) and emits audit event via `recordImportBatchAccessEvent`.
- Admin dashboard page extended with `MigrationStatusCard` above `AdminGovernanceConsole`; `actorId` passed for audit trail.
- 12 new tests in import-batches suite covering: 401 unauthenticated, 403 non-admin roles (recruiter, compliance-officer), empty list, tenant-scoped list, elapsedMs computation, null elapsedMs for in-progress, 404 not found, 404 cross-tenant isolation, batch detail with row errors.
- All 74 tests pass (0 regressions), lint clean, typecheck clean, production build clean.

**Code Review Fixes (post-review pass):**
- Extracted `_process_chunk()` in `initial_load.py` — eliminates ~70 lines of duplicated final-chunk code (M2).
- Fixed error double-counting on upsert failure: introduced `candidate_rows` parallel list so only the rows actually attempted in the upsert get `upsert_failure` error entries; parse-failed rows are no longer duplicated (H1).
- Added comment documenting why `total_skipped` is always 0 (ON CONFLICT DO UPDATE strategy has no skip path) (L1).
- Added explicit post-auth `session` narrowing in both `route.ts` and `[batchId]/route.ts` to satisfy strict TypeScript null checks while preserving existing auth behavior.
- Added running-batch guard to `rollback_batch.py`: exits with error if `status=running` to prevent concurrent delete races with the active migration writer (M3).
- Added comment in `MigrationStatusCard.tsx` noting "View detail" links to JSON API endpoint (MVP intentional; replace when detail UI page is built) (L2).
- Added Python unit test module `cblaero/scripts/migrate/test_initial_load.py` to validate chunk imported/error counting and >5% error-threshold guard behavior.
- Added `listImportBatchAccessEvents()` to `cblaero/src/modules/audit/index.ts` for testable import-batch access audit retrieval parity with other event families.
- Hardened `recordImportBatchAccessEvent()` and `clearImportBatchAccessEventsForTest()` to handle persistent-store errors explicitly (no silent audit-write failures).
- Rendered elapsed time in `MigrationStatusCard.tsx` (running or completed batches) to satisfy AC 5 display requirements.
- Replaced multi-call chunk writes with a single SQL RPC transaction (`process_import_chunk`) so candidate upsert, error writes, and progress counter updates are atomic per chunk.
- Implemented row-level conflict isolation inside `process_import_chunk` so one conflicting candidate no longer fails the full chunk.
- Updated migration docs to reflect single-RPC per-chunk transaction semantics.

**Code Review Fixes (review pass 2 — 2026-04-01):**
- [H1] SECURITY: Removed `anon` role from all DB grants on `candidates`, `import_batch`, `import_row_error`, `audit_import_batch_accesses` tables; restricted `process_import_chunk` RPC grant to `service_role` only. Unauthenticated Supabase REST callers can no longer directly manipulate migration data.
- [H2] Updated `audit_import_batch_accesses.action` CHECK constraint to include Story 2.2a actions (`csv_upload_access`, `download_csv_error_report`, `resume_upload_access`, `resume_confirm_access`) — constraint was out of sync with TypeScript type, causing DB-level write failures for newer audit events.
- [M1] Removed dead functions `_upsert_candidates()` and `_write_row_errors()` from `initial_load.py` — leftover from pre-RPC refactor, never called.
- [M2] Added `MIGRATION_ACTOR_ID` env var support; `_create_import_batch()` now populates `created_by_actor_id` for audit trail.
- [M3] Fixed `elapsedMs` in both API routes (`route.ts`, `[batchId]/route.ts`) to compute live elapsed time for running batches using `Date.now()` instead of returning `null`. Updated corresponding test.
- [M4] Added `cblaero/scripts/migrate/test_rollback_batch.py` with 9 unit tests covering: batch not found, running-batch guard, already-rolled-back idempotency, chunked candidate deletion, chunked error deletion, and zero-row edge cases.

### File List

- cblaero/supabase/schema.sql
- cblaero/scripts/migrate/initial_load.py
- cblaero/scripts/migrate/rollback_batch.py
- cblaero/scripts/migrate/requirements.txt
- cblaero/scripts/migrate/test_initial_load.py
- cblaero/scripts/migrate/test_rollback_batch.py
- cblaero/scripts/migrate/README.md
- cblaero/src/modules/auth/authorization.ts
- cblaero/src/modules/audit/index.ts
- cblaero/src/app/api/internal/admin/import-batches/route.ts
- cblaero/src/app/api/internal/admin/import-batches/[batchId]/route.ts
- cblaero/src/app/api/internal/admin/import-batches/__tests__/route.test.ts
- cblaero/src/app/dashboard/admin/MigrationStatusCard.tsx
- cblaero/src/app/dashboard/admin/page.tsx
- cblaero/src/features/candidate-management/infrastructure/import-batch-repository.ts
- docs/implementation_artifacts/stories/2-1-build-admin-supervised-initial-1m-record-migration-pipeline.md
