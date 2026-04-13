# Story 1.11: Implement Content Fingerprint Gate for All Ingestion Paths

Status: done

## Story

As a platform engineer,
I want a centralized content fingerprint service that every ingestion path must call before any expensive processing,
so that redundant LLM extraction calls, enrichment API calls, and unnecessary database upserts are eliminated across CSV, PDF, email, ATS, and OneDrive ingestion.

## Acceptance Criteria

1. **Given** a `content_fingerprints` table exists in the database
   **When** any ingestion path receives input (file, email, CSV row, ATS record)
   **Then** a content fingerprint is computed and checked via `FingerprintRepository.isAlreadyProcessed()` BEFORE any LLM call, enrichment API call, or database upsert

2. **Given** a PDF resume that has already been processed (SHA-256 match in `content_fingerprints`)
   **When** the same PDF is uploaded again via resume-upload or OneDrive poller
   **Then** the system skips LLM extraction entirely, logs a structured skip event, and returns the existing candidate linkage

3. **Given** a CSV batch upload with 10,000 rows
   **When** the batch is processed
   **Then** fingerprints for the tenant are pre-loaded into an in-memory `Set<string>` at batch start, and per-row checks use the set (no per-row DB lookups)

4. **Given** an email with `message_id` already in `content_fingerprints`
   **When** the email ingestion job encounters it
   **Then** the system skips `upsertCandidateFromEmailFull()` entirely (no LLM, no DB)

5. **Given** a Ceipal ATS sync returning applicants already fingerprinted as `ats_external_id`
   **When** `batchUpsertCandidatesFromATS()` processes them
   **Then** known applicants are filtered out before the upsert call, reducing DB round-trips

6. **Given** any ingestion path that successfully processes new content
   **When** processing completes
   **Then** `recordFingerprint()` is called with the `candidate_id` linkage and `status: 'processed'`

7. **Given** any ingestion path where processing fails
   **When** the failure is caught
   **Then** `recordFingerprint()` is called with `status: 'failed'` so the content is retried on the next run

8. **Given** a fingerprint skip event
   **When** the skip occurs
   **Then** a structured JSON log is emitted: `{ event: 'fingerprint_hit', type, source, tenantId, hash: hash.slice(0,12) }`

9. **Given** all existing tests (208+ tests)
   **When** the fingerprint gate is wired into all paths
   **Then** zero test regressions occur and TypeScript compiles clean

## Tasks / Subtasks

- [x] **Task 1: Create `content_fingerprints` table** (AC: #1)
  - [x] 1.1 Add migration SQL to `cblaero/supabase/schema.sql` — table, unique index, grants
  - [x] 1.2 Apply migration to Supabase via MCP `apply_migration`

- [x] **Task 2: Create `FingerprintRepository`** (AC: #1, #6, #7)
  - [x] 2.1 Create `src/features/candidate-management/infrastructure/fingerprint-repository.ts`
  - [x] 2.2 Implement `computeFileHash(content: Buffer): string` — SHA-256 hex digest
  - [x] 2.3 Implement `computeIdentityHash(email?, firstName?, lastName?, phone?): string` — normalized SHA-256
  - [x] 2.4 Implement `computeRowHash(email?, firstName?, lastName?, phone?): string` — alias for CSV rows
  - [x] 2.5 Implement `isAlreadyProcessed(tenantId, type, hash): Promise<boolean>` — single-row lookup
  - [x] 2.6 Implement `recordFingerprint(tenantId, type, hash, source, candidateId?, metadata?, status?): Promise<void>` — upsert
  - [x] 2.7 Implement `loadRecentFingerprints(tenantId, type, days?): Promise<Set<string>>` — batch pre-load for CSV/ATS
  - [x] 2.8 Add dual persistence (Supabase + in-memory) following `import-batch-repository.ts` pattern
  - [x] 2.9 Add `seedFingerprintsForTest()` and `clearFingerprintsForTest()` helpers

- [x] **Task 3: Create `FingerprintRepository` tests** (AC: #1-#8)
  - [x] 3.1 Create `src/features/candidate-management/infrastructure/__tests__/fingerprint-repository.test.ts`
  - [x] 3.2 Test `computeFileHash` returns consistent SHA-256 for same content
  - [x] 3.3 Test `computeIdentityHash` normalizes and returns consistent hash (case-insensitive, phone normalized)
  - [x] 3.4 Test `isAlreadyProcessed` returns false for unknown hash, true for recorded hash
  - [x] 3.5 Test `recordFingerprint` stores and is retrievable
  - [x] 3.6 Test `loadRecentFingerprints` returns Set with correct hashes
  - [x] 3.7 Test `recordFingerprint` with `status: 'failed'` does not block retry (isAlreadyProcessed returns false)
  - [x] 3.8 Test in-memory persistence mode works identically

- [x] **Task 4: Wire into PDF Resume Upload** (AC: #2)
  - [x] 4.1 In `src/app/api/internal/recruiter/resume-upload/route.ts` — after `Buffer.from(arrayBuffer)` (line ~140), compute `computeFileHash(buffer)` and call `isAlreadyProcessed('file_sha256', hash)`
  - [x] 4.2 If duplicate: skip `extractCandidateFromDocument()` and `uploadResumeToStorage()`, return skip status in `ResumeFileResult`
  - [x] 4.3 On success: call `recordFingerprint()` after extraction completes
  - [x] 4.4 On failure: call `recordFingerprint()` with `status: 'failed'`

- [x] **Task 5: Wire into OneDrive Resume Poller** (AC: #2)
  - [x] 5.1 In `src/modules/ingestion/jobs.ts` `OneDriveResumePollerJob.run()` — after `this.downloadFile(file.downloadUrl)` (line ~160), compute file hash and check
  - [x] 5.2 If duplicate: skip `extractCandidateFromDocument()`, log skip, continue to next file
  - [x] 5.3 On success: call `recordFingerprint()` after extraction + DB persist
  - [x] 5.4 On failure: call `recordFingerprint()` with `status: 'failed'`

- [x] **Task 6: Wire into Email Ingestion** (AC: #4)
  - [x] 6.1 In `src/modules/ingestion/jobs.ts` `EmailIngestionJob.run()` — before `upsertCandidateFromEmailFull(record)` (line ~30), check `isAlreadyProcessed('email_message_id', record.id)`
  - [x] 6.2 If duplicate: skip `upsertCandidateFromEmailFull()` entirely, log skip
  - [x] 6.3 On success: call `recordFingerprint()` inside `upsertCandidateFromEmailFull()` after DB persist
  - [x] 6.4 This replaces the existing `loadProcessedMessageIds()` approach with the centralized fingerprint gate

- [x] **Task 7: Wire into CSV Upload** (AC: #3)
  - [x] 7.1 In `src/app/api/internal/recruiter/csv-upload/route.ts` — after `prepareRows()` (line ~578), call `loadRecentFingerprints(tenantId, 'csv_row_hash')` to pre-load set
  - [x] 7.2 For each prepared candidate row, compute `computeRowHash(email, firstName, lastName, phone)` and check against pre-loaded set
  - [x] 7.3 Filter out known rows before passing to `processImportChunk()`
  - [x] 7.4 After successful chunk processing: batch-record fingerprints for all new rows

- [x] **Task 8: Wire into ATS/Ceipal Sync** (AC: #5)
  - [x] 8.1 In `src/modules/ingestion/jobs.ts` `CeipalIngestionJob.run()` — after `candidates = applicants.map(mapCeipalApplicantToCandidate)` (line ~87), call `loadRecentFingerprints(tenantId, 'ats_external_id')` to pre-load set
  - [x] 8.2 Filter `candidates` array to exclude those with known `ceipal:{applicant_id}` fingerprints
  - [x] 8.3 Pass only new candidates to `batchUpsertCandidatesFromATS()`
  - [x] 8.4 After successful upsert: batch-record fingerprints for inserted candidates

- [x] **Task 9: Register capability in architecture.md** (AC: #9)
  - [x] 9.1 Add `FingerprintRepository` to Implemented Capabilities Registry under "Database Operations"
  - [x] 9.2 Update Fingerprint Service status from "Planned" to "Complete" in service boundary table

- [x] **Task 10: Verify zero regressions** (AC: #9)
  - [x] 10.1 Run full test suite — all 228 tests pass (20 new fingerprint tests added)
  - [x] 10.2 Run TypeScript compilation — zero errors
  - [x] 10.3 Verify structured skip logs appear in test output for fingerprint hits

## Dev Notes

### Architecture Compliance

- **Architectural Rule #5 (new):** Every ingestion path must check the content fingerprint gate before any expensive processing. This story IMPLEMENTS that rule.
- **Architectural Rule #1:** Route handlers must NEVER call `getSupabaseAdminClient()` directly. The `FingerprintRepository` follows the repository pattern from Story 1.8 — routes call repository functions.
- **Development Standards §3:** The "Content Fingerprint Gate (Mandatory First Step)" section defines the exact fingerprint types and computation methods. Follow it exactly.

### Gold Standard Patterns to Follow

- **Repository pattern:** Follow `import-batch-repository.ts` and `submission-repository.ts` from Story 1.8:
  - Typed functions with clear names
  - Dual persistence (Supabase + in-memory for tests) using `shouldUseInMemoryPersistenceForTests()`
  - `seed*ForTest()` and `clear*ForTest()` helpers
  - Row mapper functions for DB → domain type conversion
- **Hash computation:** Use Node.js `crypto.createHash('sha256').update(input).digest('hex')` — no external dependencies

### Fingerprint Type Reference

| Type | Hash Input | Used By |
|------|-----------|---------|
| `file_sha256` | `SHA-256(raw file bytes)` | PDF resume upload, OneDrive poller |
| `email_message_id` | Graph API `message.id` (as-is, not hashed) | Email ingestion |
| `csv_row_hash` | `SHA-256(lower(email)\|lower(first+last)\|phone)` | CSV upload |
| `ats_external_id` | `ceipal:{applicant_id}` (as-is, not hashed) | Ceipal ATS sync |
| `candidate_identity` | `SHA-256(lower(email))` or `SHA-256(lower(first+last)+normalized(phone))` | Future use (Story 2.5) |

### Critical Implementation Notes

1. **SHA-256 is NOT for security — it's for content identity.** Hex digest output. No salt needed.
2. **`email_message_id` and `ats_external_id` are stored as-is** (not hashed) because they're already unique identifiers. The `fingerprint_hash` column stores the raw value for these types.
3. **`loadRecentFingerprints()` default window: 30 days.** This bounds memory for large tenants. False negatives (missed cache hit) fall through to the unique constraint — no data loss, just a redundant DB call.
4. **Failed fingerprints (`status: 'failed'`) must NOT block retry.** `isAlreadyProcessed()` must filter on `status = 'processed'` only.
5. **The fingerprint check must be the FIRST operation** in each path — before storage upload, before LLM extraction, before DB upsert. The only exception is the CSV path where rows must be prepared first (parsing is cheap).
6. **Existing `loadProcessedMessageIds()` in EmailIngestionJob (line 26)** can be replaced by `loadRecentFingerprints(tenantId, 'email_message_id')` for consistency, but both can coexist during transition.

### Exact Insertion Points per Path

| Path | File | Insert After | Insert Before | Check Type |
|------|------|-------------|---------------|------------|
| PDF Resume | `resume-upload/route.ts` | `Buffer.from(arrayBuffer)` ~L140 | `uploadResumeToStorage()` ~L142 | Per-file `file_sha256` |
| OneDrive | `ingestion/jobs.ts` | `this.downloadFile()` ~L160 | `extractCandidateFromDocument()` ~L181 | Per-file `file_sha256` |
| Email | `ingestion/jobs.ts` | `for (const record of records)` ~L29 | `upsertCandidateFromEmailFull()` ~L30 | Per-record `email_message_id` |
| CSV | `csv-upload/route.ts` | `prepareRows()` ~L578 | batch processing `try` block ~L579 | Batch pre-load + per-row `csv_row_hash` |
| ATS/Ceipal | `ingestion/jobs.ts` | `applicants.map(...)` ~L87 | `batchUpsertCandidatesFromATS()` ~L88 | Batch pre-load + per-record `ats_external_id` |

### Validation Commands

```bash
# Verify FingerprintRepository exists and exports expected functions
grep -r "isAlreadyProcessed\|recordFingerprint\|computeFileHash\|computeIdentityHash\|loadRecentFingerprints" cblaero/src/features/candidate-management/infrastructure/fingerprint-repository.ts

# Verify all 5 ingestion paths call isAlreadyProcessed or loadRecentFingerprints
grep -r "isAlreadyProcessed\|loadRecentFingerprints" cblaero/src/app/api/internal/recruiter/csv-upload/route.ts cblaero/src/app/api/internal/recruiter/resume-upload/route.ts cblaero/src/modules/ingestion/jobs.ts

# Verify fingerprint_hit structured log exists in all paths
grep -r "fingerprint_hit" cblaero/src/

# Verify content_fingerprints table exists in schema
grep "content_fingerprints" cblaero/supabase/schema.sql
```

### Project Structure Notes

- New file: `src/features/candidate-management/infrastructure/fingerprint-repository.ts` — follows existing repo pattern in same directory
- New file: `src/features/candidate-management/infrastructure/__tests__/fingerprint-repository.test.ts` — follows existing test pattern
- Modified: `supabase/schema.sql` — new table + index + grants
- Modified: 3 route files + 1 jobs file (5 ingestion paths total)
- No new dependencies — uses Node.js built-in `crypto` module only

### References

- [Source: docs/planning_artifacts/architecture.md#Content Fingerprint Gate — full design with table schema, service interface, pipeline integration order]
- [Source: docs/planning_artifacts/development-standards.md#Content Fingerprint Gate (Mandatory First Step) — mandatory implementation rules per ingestion type]
- [Source: docs/planning_artifacts/architecture.md#Architectural Rules — Rule #5 mandates fingerprint check before expensive processing]
- [Source: docs/planning_artifacts/architecture.md#Migration Path — Story 1.11 scope and priority]
- [Source: docs/implementation_artifacts/stories/1-8-extract-data-service-repositories-and-eliminate-route-db-calls.md — gold standard repository pattern, dual persistence, test helpers]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Full test suite: 228/228 passing (20 new fingerprint tests)
- TypeScript compilation: zero errors
- Structured `fingerprint_hit` logs confirmed in test output for CSV and resume upload paths

### Completion Notes List

- Created `content_fingerprints` table with unique index on (tenant_id, fingerprint_type, fingerprint_hash) and applied to Supabase
- Implemented `FingerprintRepository` with 6 public functions + 3 hash utilities, dual persistence (Supabase + in-memory), test helpers
- Wired fingerprint gate into all 5 ingestion paths: PDF resume upload, OneDrive poller, email ingestion, CSV upload, ATS/Ceipal sync
- Email ingestion: replaced `loadProcessedMessageIds()` (queried `candidate_submissions`) with centralized `loadRecentFingerprints('email_message_id')` from fingerprint table
- CSV upload: batch pre-loads fingerprints into Set, filters before `processImportChunk`
- ATS/Ceipal: batch pre-loads fingerprints, filters before `batchUpsertCandidatesFromATS`
- Added `'skipped'` to `FileStatus` type for resume upload duplicate handling
- Updated 3 test files to clear fingerprint store in `beforeEach`; added fingerprint repository mock to ingestion-jobs test
- Registered 6 new capabilities in architecture.md Implemented Capabilities Registry
- Updated Fingerprint Service status to "Complete" in service boundary table

### Change Log

- 2026-04-03: Story 1.11 implemented — centralized content fingerprint gate for all ingestion paths
- 2026-04-03: Code review — 7 HIGH, 5 MEDIUM, 5 LOW findings. All HIGH and MEDIUM fixed:
  - H1: Fixed `.ceipal_id` → `.ceipalId` (wrong field name blocked all Ceipal syncs)
  - H2: Added safety comment for OneDrive delete-on-fingerprint-hit (fingerprint only recorded after storage success)
  - H3/H4: CSV and Ceipal now only record fingerprints when `errors === 0`
  - H5: Added `shouldUseInMemoryPersistenceForTests()` guard to `clearFingerprintsForTest()`
  - H6/H7: `isAlreadyProcessed` and `recordFingerprint` now throw on DB errors instead of swallowing
  - M1: Deferred to future batch optimization story (sequential recording acceptable for MVP volumes)
  - M2: Replaced hardcoded `'cbl-aero'` with exported `DEFAULT_TENANT_ID` constant in all job classes
  - M3: Added `recordFingerprint({ status: 'failed' })` to resume-upload outer catch block
  - M4: `loadRecentFingerprints` now throws on error + has 100K row limit with warning
  - M5: `computeIdentityHash` returns empty string for all-null inputs

### File List

- `cblaero/supabase/schema.sql` — added `content_fingerprints` table, indexes, grants
- `cblaero/src/features/candidate-management/infrastructure/fingerprint-repository.ts` — **NEW** — FingerprintRepository with hash utilities, CRUD, batch load, dual persistence
- `cblaero/src/features/candidate-management/infrastructure/__tests__/fingerprint-repository.test.ts` — **NEW** — 20 unit tests
- `cblaero/src/app/api/internal/recruiter/resume-upload/route.ts` — wired fingerprint gate before LLM extraction
- `cblaero/src/app/api/internal/recruiter/resume-upload/shared.ts` — added `'skipped'` to FileStatus union
- `cblaero/src/app/api/internal/recruiter/csv-upload/route.ts` — wired fingerprint gate with batch pre-load
- `cblaero/src/modules/ingestion/jobs.ts` — wired fingerprint gate into EmailIngestionJob, CeipalIngestionJob, OneDriveResumePollerJob
- `cblaero/src/app/api/internal/recruiter/csv-upload/__tests__/route.test.ts` — added fingerprint store cleanup
- `cblaero/src/app/api/internal/recruiter/resume-upload/[batchId]/__tests__/route.test.ts` — added fingerprint store cleanup
- `cblaero/src/modules/__tests__/ingestion-jobs.test.ts` — added fingerprint repository mocks
- `docs/planning_artifacts/architecture.md` — Content Fingerprint Gate section, Rule #5, service table, capabilities registry, migration path
- `docs/planning_artifacts/development-standards.md` — Content Fingerprint Gate mandatory standard in §3
- `docs/implementation_artifacts/sprint-status.yaml` — Story 1.11 status tracking
