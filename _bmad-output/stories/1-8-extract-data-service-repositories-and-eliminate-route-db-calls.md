# Story 1.8: Extract Data Service Repositories and Eliminate Route DB Calls

Status: done

## Story

As a platform engineer,
I want all database access routed through dedicated repository functions,
so that route handlers are decoupled from the DB schema and query logic is reusable, testable, and consistent.

## Acceptance Criteria

1. **Given** any API route handler in `src/app/api/`
   **When** the route needs to read or write data
   **Then** it calls a named repository/module function — never `getSupabaseAdminClient()` directly

2. **Given** the `import_batch` table
   **When** any operation (create, update status, list by tenant, get by ID) is needed
   **Then** it goes through `ImportBatchRepository` with typed functions

3. **Given** the `candidate_submissions` table
   **When** any operation (insert submission, check dedup by message_id, list by batch) is needed
   **Then** it goes through `SubmissionRepository` with typed functions

4. **Given** cross-client confirmation token logic (issue, verify, consume)
   **When** a candidate route needs cross-client confirmation
   **Then** it calls functions from `modules/auth/cross-client-confirmation.ts` — not inline JWT logic

5. **Given** all existing tests
   **When** the refactor is complete
   **Then** all tests pass, no regressions, TypeScript compiles clean

6. **Given** the repository pattern
   **When** running in test mode (`shouldUseInMemoryPersistenceForTests()`)
   **Then** new repositories support in-memory mode with `seed*ForTest()` and `clear*ForTest()` functions

## Tasks / Subtasks

- [x] Create `ImportBatchRepository` (AC: 2, 6)
  - [x] Create `src/features/candidate-management/infrastructure/import-batch-repository.ts`
  - [x] Extract functions: `createImportBatch()`, `getImportBatchById()`, `updateImportBatch()`, `listImportBatchesByTenant()`
  - [x] Add in-memory test mode with seed/clear helpers
  - [x] Add types: `ImportBatch`, `ImportBatchStatus`

- [x] Create `SubmissionRepository` (AC: 3, 6)
  - [x] Create `src/features/candidate-management/infrastructure/submission-repository.ts`
  - [x] Extract functions: `insertSubmission()`, `findSubmissionByMessageId()`, `listSubmissionsByBatch()`
  - [x] Add in-memory test mode with seed/clear helpers
  - [x] Add types: `CandidateSubmission`

- [x] Move cross-client confirmation logic to auth module (AC: 4)
  - [x] Create `src/modules/auth/cross-client-confirmation.ts`
  - [x] Move `issueCrossClientConfirmationToken()`, `verifyCrossClientConfirmationToken()`, `consumeCrossClientConfirmationToken()` from candidates/route.ts
  - [x] Move in-memory token tracking and DB-backed consumption logic
  - [x] Export from `modules/auth/index.ts`

- [x] Refactor route handlers to use repositories (AC: 1)
  - [x] `app/api/internal/recruiter/resume-upload/route.ts` — use `ImportBatchRepository` + `SubmissionRepository`
  - [x] `app/api/internal/recruiter/resume-upload/[batchId]/route.ts` — use `SubmissionRepository`
  - [x] `app/api/internal/recruiter/resume-upload/[batchId]/confirm/route.ts` — use `ImportBatchRepository` + `SubmissionRepository`
  - [x] `app/api/internal/recruiter/csv-upload/route.ts` — use `ImportBatchRepository`
  - [x] `app/api/internal/admin/import-batches/route.ts` — use `ImportBatchRepository`
  - [x] `app/api/internal/admin/import-batches/[batchId]/route.ts` — use `ImportBatchRepository`
  - [x] `app/api/internal/candidates/route.ts` — use auth/cross-client-confirmation
  - [x] `app/api/internal/jobs/run/route.ts` — use candidate repository for count queries
  - [x] Verify: zero occurrences of `getSupabaseAdminClient()` in `app/api/` directory

- [x] Update `upsertCandidateFromEmailFull` to use `SubmissionRepository` (AC: 3)
  - [x] Replace inline `db.from('candidate_submissions')` calls in `modules/ingestion/index.ts`

- [x] Write/update tests (AC: 5, 6)
  - [x] Unit tests for `ImportBatchRepository` (CRUD, in-memory mode)
  - [x] Unit tests for `SubmissionRepository` (insert, dedup, in-memory mode)
  - [x] Unit tests for cross-client confirmation functions
  - [x] Verify all existing route tests still pass

- [x] Register new capabilities in architecture.md and development-standards.md §18 (AC: 1)

## Dev Notes

### Architecture Compliance

This story implements the "Data Service" layer from architecture.md §Service Boundary Architecture. The key rule: **route handlers must NEVER call `getSupabaseAdminClient()` directly**.

### Files to grep for violations after completion
```bash
# Should return ZERO matches when done:
grep -r "getSupabaseAdminClient" cblaero/src/app/api/ --include="*.ts"
```

### Existing patterns to follow
- `candidate-repository.ts` — the gold standard. Dual persistence (Supabase + in-memory), typed functions, row mappers, test helpers.
- `saved-search-repository.ts` — same pattern for saved searches.

### What already exists (MODIFY, do not recreate)
- `modules/ingestion/index.ts` — has `upsertCandidateFromEmailFull` with inline submission inserts
- `app/api/internal/candidates/route.ts` lines 179-261 — cross-client JWT logic to extract
- All route handlers listed in Tasks

### References

- [Source: docs/planning_artifacts/development-standards.md — §4 Database Access, §14 Dead Code, §18 Reusability, §20 Capability Registry]
- [Source: docs/planning_artifacts/architecture.md — Service Boundary Architecture, Implemented Capabilities Registry]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

### Completion Notes List

- Created `ImportBatchRepository` with 8 functions: create, get, update, list, processImportChunk, listImportRowErrors, deleteImportBatchCandidates, plus seed/clear test helpers. Full dual persistence (Supabase + in-memory).
- Created `SubmissionRepository` with 8 functions: insert, findByMessageId, listByBatch, listByBatchIds, updateCandidateIds, countFailed, uploadResumeToStorage, plus seed/clear test helpers.
- Extracted cross-client confirmation JWT logic (issue/verify/consume + replay prevention) from candidates/route.ts to `modules/auth/cross-client-confirmation.ts` with clearForTest helper.
- Added 3 functions to `candidate-repository.ts`: `findCandidateIdsByEmails`, `countCandidatesBySource`, `getLastCandidateUpdateBySource`.
- Refactored 9 route handlers + 2 additional routes (csv-upload/[batchId], csv-upload/[batchId]/error-report) to use repositories. Zero `getSupabaseAdminClient()` calls remain in `app/api/`.
- Updated `upsertCandidateFromEmailFull` in ingestion module to use `findSubmissionByMessageId` and `insertSubmission` from SubmissionRepository.
- Updated existing test mocks in ingestion.test.ts and admin/import-batches test to work with new repository imports.
- Added 23 new tests: 7 for ImportBatchRepository, 9 for SubmissionRepository, 7 for cross-client confirmation.
- All 208 tests pass, TypeScript compiles clean. Zero regressions.
- Registered 17 new capabilities in architecture.md and development-standards.md §18.

### Review Follow-ups (AI)

- [x] [AI-Review][HIGH] `updateSubmissionCandidateIds` did not check `.error` on Supabase update responses — silent data loss [submission-repository.ts:272-280] — FIXED: collect and throw errors
- [x] [AI-Review][HIGH] Jobs route auth bypassed when `CBL_JOBS_SECRET` unset — §13 violation [jobs/run/route.ts:13] — FIXED: reject with 500 when secret not configured
- [x] [AI-Review][MEDIUM] All `clear*ForTest()` functions skipped `shouldUseInMemoryPersistenceForTests()` check — §15 violation [import-batch-repository.ts:118, submission-repository.ts:112, cross-client-confirmation.ts:162, admin/[batchId]/route.ts:52] — FIXED: added mode guard
- [x] [AI-Review][MEDIUM] `ImportBatchSource` exported with no external consumer — §14 dead code [import-batch-repository.ts:17] — FIXED: removed export keyword
- [x] [AI-Review][MEDIUM] Route-level `ImportRowErrorRow` type duplicated repository's `ImportRowError` with backwards snake_case conversion [admin/[batchId]/route.ts:13-20,122-129,150-156] — FIXED: use `ImportRowError` from repository, removed type + conversion
- [ ] [AI-Review][LOW] `uploadResumeToStorage` hardcodes `contentType: "application/pdf"` — won't handle .docx/.doc [submission-repository.ts:303]
- [ ] [AI-Review][LOW] `processImportChunk` in-memory mode ignores `totalImported/Skipped/Errors` params — test/prod divergence [import-batch-repository.ts:314-321]

### Change Log

- 2026-04-03: Code review — fixed 5 issues (2 HIGH, 3 MEDIUM); 2 LOW deferred. All 208 tests pass, TS clean.
- 2026-04-02: Story 1.8 implemented — repository pattern extraction, route handler refactoring, cross-client confirmation module extraction, capability registration.

### File List

src/features/candidate-management/infrastructure/import-batch-repository.ts (new — ImportBatch repository with CRUD, RPC wrapper, row error listing)
src/features/candidate-management/infrastructure/submission-repository.ts (new — CandidateSubmission repository with insert, dedup, listing, storage upload)
src/features/candidate-management/infrastructure/__tests__/import-batch-repository.test.ts (new — 7 unit tests for ImportBatchRepository)
src/features/candidate-management/infrastructure/__tests__/submission-repository.test.ts (new — 9 unit tests for SubmissionRepository)
src/modules/auth/cross-client-confirmation.ts (new — JWT issue/verify/consume extracted from candidates route)
src/modules/auth/index.ts (modified — added cross-client-confirmation export)
src/modules/__tests__/cross-client-confirmation.test.ts (new — 7 unit tests for cross-client confirmation)
src/features/candidate-management/infrastructure/candidate-repository.ts (modified — added findCandidateIdsByEmails, countCandidatesBySource, getLastCandidateUpdateBySource)
src/modules/ingestion/index.ts (modified — replaced inline candidate_submissions calls with SubmissionRepository)
src/app/api/internal/recruiter/resume-upload/route.ts (modified — uses ImportBatchRepository + SubmissionRepository)
src/app/api/internal/recruiter/resume-upload/[batchId]/route.ts (modified — uses ImportBatchRepository + SubmissionRepository)
src/app/api/internal/recruiter/resume-upload/[batchId]/confirm/route.ts (modified — uses repositories + processImportChunk + findCandidateIdsByEmails)
src/app/api/internal/recruiter/csv-upload/route.ts (modified — uses ImportBatchRepository + processImportChunk)
src/app/api/internal/recruiter/csv-upload/[batchId]/route.ts (modified — uses ImportBatchRepository)
src/app/api/internal/recruiter/csv-upload/[batchId]/error-report/route.ts (modified — uses ImportBatchRepository + listImportRowErrors)
src/app/api/internal/admin/import-batches/route.ts (modified — uses listImportBatchesByTenant)
src/app/api/internal/admin/import-batches/[batchId]/route.ts (modified — uses getImportBatchById + listImportRowErrors)
src/app/api/internal/candidates/route.ts (modified — uses auth/cross-client-confirmation module)
src/app/api/internal/jobs/run/route.ts (modified — uses countCandidatesBySource + getLastCandidateUpdateBySource)
src/app/api/internal/admin/import-batches/__tests__/route.test.ts (modified — updated imports to use repository seed/clear)
src/app/api/internal/recruiter/resume-upload/[batchId]/__tests__/route.test.ts (modified — added repository store clearing)
src/modules/__tests__/ingestion.test.ts (modified — added submission repository mocks)
docs/planning_artifacts/architecture.md (modified — registered 17 new capabilities)
docs/planning_artifacts/development-standards.md (modified — updated §18 utility table and repository status table)
