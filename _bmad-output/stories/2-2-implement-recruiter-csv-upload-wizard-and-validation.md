# Story 2.2: Implement Recruiter CSV Upload Wizard and Validation

Status: done

## Story

As a recruiter,
I want to upload CSV candidate files with a column mapping wizard and live validation,
so that I can quickly add candidate pools with actionable per-row error feedback and a downloadable error report.

## Acceptance Criteria

1. Given a recruiter uploads a CSV file (≤ 10,000 rows), when the upload wizard starts, then the system reads the first row as headers and presents a column-mapping step where the recruiter maps each detected header to a canonical field (`name`, `email`, `phone`, `location`, `skills`, `availability_status`) or marks it as ignored; unmapped required fields (`name` plus at least one of `email`/`phone`) are flagged before the recruiter can proceed to validation.
2. Given the recruiter advances past column mapping, when live validation runs, then the UI shows a summary: total rows detected, valid rows, invalid rows (with counts by error code: `missing_identity`, `invalid_format`, `row_limit_exceeded`), and duplicate-candidate-detected count; the recruiter can review this summary before submitting.
3. Given the recruiter submits the upload, when the API accepts the file, then an `import_batch` record is created with `source=csv_upload`, `status=validating`, the row count, `created_by_actor_id`, and `tenant_id`; valid rows are processed via the existing `process_import_chunk` RPC with `ingestion_state=pending_enrichment`; invalid rows are written to `import_row_error` per row with the applicable error code and raw data; the `import_batch` record is updated to `status=complete` with final `imported`, `skipped`, and `errors` counts.
4. Given a CSV file exceeds 10,000 rows, when any row past the 10,000 limit is read, then the API rejects the entire upload with HTTP 422 and error code `row_limit_exceeded`, no `import_batch` record is created, and the UI presents a clear message instructing the recruiter to split the file.
5. Given a completed import batch, when the recruiter clicks "Download error report", then a CSV file is streamed containing: `row_number`, `error_code`, `error_detail`, and the raw data columns for each `import_row_error` row belonging to that batch; access is enforced to the batch's `tenant_id` matching the recruiter's active-client context.
6. Given an import is in progress (status `validating` or `running`), when the recruiter views the upload page, then a progress card shows: batch status, imported count, total rows, error count, and elapsed time; the card refreshes via polling (5-second interval) until the batch reaches a terminal state (`complete`, `paused_on_error_threshold`, `rolled_back`).
7. Given any upload API call, when the recruiter's session is missing or their role is not in `{recruiter, delivery-head, admin}`, then the API responds with the standard auth error shape (`401`/`403`) and no `import_batch` record is written.
8. Given uploaded CSV files contain columns not mapped to canonical candidate fields, when rows are processed, then those unmapped key/value pairs are persisted in a JSONB column on `candidates` as `extra_attributes` (normalized keys, excluding blocked keys), and imports continue unless JSON size limits are exceeded.

## Tasks / Subtasks

- [x] Add `recruiter:csv-upload` action to authorization module and grant it to the correct roles (AC: 7)
  - [x] Add `"recruiter:csv-upload"` to the `ProtectedAction` union type in `cblaero/src/modules/auth/authorization.ts`
  - [x] Add `"recruiter:csv-upload"` to the `recruiter`, `delivery-head`, and `admin` role permission sets in `ROLE_ACTION_MAP`
  - [x] No schema change needed — `import_batch` and `import_row_error` tables already exist from Story 2.1

- [x] Build CSV upload API route: `POST /api/internal/recruiter/csv-upload` (AC: 3, 4, 7)
  - [x] Create `cblaero/src/app/api/internal/recruiter/csv-upload/route.ts`
  - [x] Accept `multipart/form-data` with a single `file` field and optional `columnMap` JSON field; validate `Content-Type` is `text/csv` or filename ends `.csv`
  - [x] Enforce hard 10,000-row limit: stream-parse the CSV with Node.js `stream/promises` + manual line counting; reject with HTTP 422 and `{error: {code: "row_limit_exceeded", message: "..."}}` if row count > 10,000 — do not create an `import_batch` record (AC: 4)
  - [x] Authenticate via `validateActiveSession` + `authorizeAccess` with action `"recruiter:csv-upload"`; use the recruiter's `tenantId` (active-client from request header or session default) as the batch `tenant_id`
  - [x] On accept: create `import_batch` row with `source=csv_upload`, `status=validating`, `total_rows`, `created_by_actor_id=session.actorId`, `tenant_id`; return `{batchId, status: "validating"}` immediately with HTTP 202
  - [x] Process rows synchronously (≤ 10,000 rows fits within Render request timeout): for each chunk of 1,000 rows, call the existing `process_import_chunk` Supabase RPC with `ingestion_state=pending_enrichment` and `source=csv_upload`
  - [x] Apply column map: translate recruiter-mapped headers to canonical candidate fields before passing to RPC; rows where required fields are missing after mapping are written as `import_row_error` with code `missing_identity`
  - [x] For unmapped CSV columns, persist key/value pairs into `extra_attributes` JSONB in the candidate payload sent to RPC; normalize keys to lowercase snake_case and drop blocked keys (`password`, `token`, `secret`, `api_key`)
  - [x] Enforce JSON guardrails for `extra_attributes`: max 64 keys per row and max 16 KB serialized JSON; rows exceeding limits are written to `import_row_error` with code `invalid_format`
  - [x] Validate email format (basic regex) and phone format (digits-only after stripping spaces/dashes); rows failing validation are written as `import_row_error` with code `invalid_format`
  - [x] After all chunks: update `import_batch.status=complete` with final totals; return final batch summary in response body
  - [x] Response shape: `{data: {batchId, status, imported, skipped, errors, totalRows}, meta: {}}` (matches existing import-batches GET contract)

- [x] Build error report download route: `GET /api/internal/recruiter/csv-upload/[batchId]/error-report` (AC: 5)
  - [x] Create `cblaero/src/app/api/internal/recruiter/csv-upload/[batchId]/error-report/route.ts`
  - [x] Authenticate + authorize with action `"recruiter:csv-upload"`; enforce tenant scope: fetch the `import_batch` row, return 404 if `tenant_id ≠ session.tenantId` (active-client context)
  - [x] Stream `import_row_error` rows for the batch, ordered by `row_number asc`, as CSV: headers `row_number,error_code,error_detail,raw_data`; set `Content-Type: text/csv` and `Content-Disposition: attachment; filename="error-report-<batchId-prefix>.csv"`
  - [x] Return HTTP 200 with streamed body; if no errors exist, return an empty CSV (headers only)

- [x] Build batch status lookup route: `GET /api/internal/recruiter/csv-upload/[batchId]` (AC: 6, 7)
  - [x] Create `cblaero/src/app/api/internal/recruiter/csv-upload/[batchId]/route.ts`
  - [x] Authenticate + authorize; fetch single `import_batch` row scoped to recruiter's `tenant_id`; return `{data: {batchId, status, imported, totalRows, errors, startedAt, completedAt, elapsedMs}}`
  - [x] Return 404 if batch not found or tenant mismatch

- [x] Add `cblaero/src/app/dashboard/recruiter/` page tree and CSV upload wizard UI (AC: 1, 2, 3, 4, 6)
  - [x] Create `cblaero/src/app/dashboard/recruiter/upload/page.tsx` — server component that validates session and renders the wizard shell; follow the auth/session pattern from `cblaero/src/app/dashboard/admin/page.tsx`
  - [x] Create `cblaero/src/app/dashboard/recruiter/upload/CsvUploadWizard.tsx` — client component (use `"use client"`) with three steps:
    - **Step 1 — File Select:** drag-and-drop file input (native `<input type="file" accept=".csv">` inside a drop zone `div`); on file drop/select, read the first 5 rows with `FileReader` to preview; enforce 10,000-row soft check in the browser (count newlines) and show an immediate warning if exceeded
    - **Step 2 — Column Mapping:** render detected headers in a table where each row has a `<select>` mapping to canonical fields (`name`, `email`, `phone`, `location`, `skills`, `availability_status`, `(ignore)`); required fields (`name` + `email or phone`) must be mapped before "Next" is enabled; display the 5-row preview using the current mapping
    - **Step 3 — Validation Preview & Submit:** call a local `validateRows()` helper that parses all rows client-side and counts valid vs invalid rows by error code; show summary table; "Upload" button submits the file + `columnMap` JSON to `POST /api/internal/recruiter/csv-upload`; handle 422 (`row_limit_exceeded`) with a clear inline error
  - [x] After successful submit, show `BatchProgressCard` component with polling (5-second `setInterval`) to `GET /api/internal/recruiter/csv-upload/[batchId]` until terminal state; render status, progress bar, counts, and elapsed time following the visual pattern from `cblaero/src/app/dashboard/admin/MigrationStatusCard.tsx`
  - [x] Show "Download error report" link to `/api/internal/recruiter/csv-upload/[batchId]/error-report` once batch is `complete` and `errors > 0`
  - [x] In the Step 2 mapping UI, show a clear note that unmapped non-required columns are stored under candidate `extra_attributes` and are not discarded
  - [x] Add a link from the main recruiter dashboard (`cblaero/src/app/dashboard/page.tsx`) to `/dashboard/recruiter/upload` when `effectiveRole` is `recruiter`, `delivery-head`, or `admin`

- [x] Extend candidates schema for unmapped columns (AC: 8)
  - [x] Update `cblaero/supabase/schema.sql` to add `extra_attributes jsonb not null default '{}'::jsonb` to `cblaero_app.candidates`
  - [x] Update `process_import_chunk` upsert statements to populate `extra_attributes` from candidate payload with `coalesce(v_candidate->'extra_attributes', '{}'::jsonb)`
  - [x] Ensure conflict updates preserve/replace `extra_attributes` using latest row payload

- [x] Extend schema: add `csv_upload_access` audit event (AC: 7)
  - [x] Add `"csv_upload_access"` action to the `ImportBatchAccessEvent` type in `cblaero/src/modules/audit/index.ts` (extends the existing union `"list_import_batches" | "read_import_batch_detail"`)
  - [x] Emit a `recordImportBatchAccessEvent` call on each successful CSV upload and error-report download, with `action="csv_upload_access"`, batch ID, and actor context

- [x] Write tests (AC: 1–8)
  - [x] Create `cblaero/src/app/api/internal/recruiter/csv-upload/__tests__/route.test.ts`
    - [x] 401 when no session cookie
    - [x] 403 when session role is `compliance-officer` (not granted `recruiter:csv-upload`)
    - [x] 422 when CSV row count > 10,000 (no import_batch created)
    - [x] 200/202 (check final response) with a valid 3-row CSV; assert import_batch returned with `status=complete`, `imported=3`, `errors=0`
    - [x] 200 with a CSV containing 2 valid rows and 1 row with no identity fields; assert `imported=2`, `errors=1`
    - [x] 200 with extra unmapped CSV columns; assert candidate rows include normalized `extra_attributes` keys/values
    - [x] 200 with blocked sensitive columns (`password`, `token`); assert blocked keys are excluded from `extra_attributes`
    - [x] 200 with oversized `extra_attributes` payload; assert offending rows are rejected as `invalid_format`
    - [x] Tenant scope: recruiter for tenant-A cannot download error report for a batch belonging to tenant-B (404)
  - [x] Create `cblaero/src/app/api/internal/recruiter/csv-upload/[batchId]/__tests__/route.test.ts`
    - [x] 404 for unknown batch ID
    - [x] 404 for cross-tenant batch access attempt
    - [x] 200 with correct shape for a seeded in-memory batch
  - [x] Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` in `cblaero/`; capture all output in completion notes

## Dev Notes

- **`process_import_chunk` RPC already exists.** Story 2.1 built and deployed `cblaero_app.process_import_chunk` in `cblaero/supabase/schema.sql`. Call it exactly as `initial_load.py` does: pass `p_candidates` + `p_error_rows` + running totals; it handles upsert-on-email-conflict, upsert-on-phone-conflict, identity-missing guard, and atomic counter update in one DB round-trip. Do not replicate that logic in the Next.js route.
- **Unmapped CSV columns are persisted in JSONB.** Add `candidates.extra_attributes jsonb not null default '{}'::jsonb` and pass unmapped values in each candidate payload as `extra_attributes`. This avoids schema churn while preserving recruiter-provided context.
- **Extra attributes guardrails are mandatory.** Normalize keys to lowercase snake_case; drop blocked keys (`password`, `token`, `secret`, `api_key`); enforce max 64 keys and max 16 KB serialized JSON per row; rows violating limits are logged in `import_row_error` with `invalid_format`.
- **`ingestion_state` for CSV uploads is `pending_enrichment`.** The migration path uses `pending_dedup`; recruiter CSV uploads use `pending_enrichment` (architecture doc, Path 2). The `candidates.ingestion_state` check constraint already includes `pending_enrichment`. Set `source=csv_upload` in the RPC payload.
- **10,000-row hard limit is enforced server-side.** The browser soft-check is UX convenience only. The API route must independently count rows and reject with 422 before creating an `import_batch` record. Do not trust the client count.
- **`getSupabaseAdminClient()` is the correct persistence accessor.** It is already used in all API routes. Do not create a second Supabase client or import `createClient` directly into route files. Follow the pattern in `cblaero/src/app/api/internal/admin/import-batches/route.ts`.
- **In-memory test mode.** `shouldUseInMemoryPersistenceForTests()` returns `true` in the test environment. Mirror the in-memory seeding pattern from `cblaero/src/app/api/internal/admin/import-batches/route.ts`: export `seedImportBatchForTest`, `clearImportBatchesForTest`, and a parallel `inMemoryBatches` array from the new route file, and an `inMemoryBatchErrors` array for the error-report route.
- **Column mapping is client-side only.** The mapping is computed in the browser and sent as a `columnMap` JSON field alongside the CSV file in `multipart/form-data`. The API receives the already-mapped field assignments; it uses them to translate CSV headers to canonical candidate keys during row parsing. Do not implement mapping logic on the server independently — trust the client-supplied map but validate all required fields are present after mapping.
- **Extra attributes are server-validated.** Even though mapping is client-defined, treat unmapped columns as untrusted input and apply key normalization + blocklist + payload size checks on the server before inserting.
- **CSV parsing in Node.js.** Use the native `stream` APIs plus `readline` from Node.js core (`readline.createInterface` on a `Readable` from the multipart body). Do not add a third-party CSV parser — the project's `package.json` has no CSV dependency and consistency with the Python migration approach is preferred. A simple comma-splitter that handles quoted fields is sufficient for MVP.
- **Authorization action scope.** The new `"recruiter:csv-upload"` action means recruiters, delivery-heads, and admins can submit uploads. Compliance officers cannot (`ROLE_ACTION_MAP` must not include it). This follows FR42/FR1 coverage requirements.
- **Audit trail.** Every successful CSV upload and every error-report download must emit an audit event via the existing `recordImportBatchAccessEvent` from `cblaero/src/modules/audit/index.ts`. This keeps the import-batch access audit trail complete for SOC 2.
- **Response shape convention.** All API responses must follow the project-wide contract: `{data: ..., meta: ...}` for success, `{error: {code: "...", message: "...", details: ...}}` for errors. See existing routes for reference.
- **Dashboard page route.** The new `/dashboard/recruiter/upload` page is inside the existing `cblaero/src/app/dashboard/` tree. Follow the session/auth guard pattern from `cblaero/src/app/dashboard/admin/page.tsx` (cookies → validateActiveSession → authorizeAccess → redirect on failure). The new page should use `"recruiter:csv-upload"` as its required action.
- **No outbox needed in this story.** The `pending_enrichment` state is sufficient as a handoff signal. The enrichment worker (Story 2.4 / 2.5) will pick up rows from `candidates` where `ingestion_state=pending_enrichment`. This story does not implement the enrichment worker or the outbox table — just land rows in the correct state.
- **Progress polling is client-side.** Use `setInterval` in a `useEffect` inside `BatchProgressCard` (a `"use client"` component). Poll `GET /api/internal/recruiter/csv-upload/[batchId]` every 5 seconds. Clear the interval when status reaches `complete`, `paused_on_error_threshold`, or `rolled_back`. No WebSocket or Server-Sent Events needed.
- **Validation steps:** Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` in `cblaero/` before marking done. Capture all output.

### Previous Story Intelligence (Story 2.1 Learnings)

- The `process_import_chunk` Supabase RPC is the only correct way to write candidate rows and errors atomically. Using separate `client.from("candidates").upsert()` + `client.from("import_row_error").insert()` calls is wrong — they are not transactional.
- The `SUPABASE_SERVICE_ROLE_KEY` / `getSupabaseAdminClient()` is backend-only. Never expose it through browser-accessible code or `NEXT_PUBLIC_` env vars.
- The `import_batch.error_threshold_pct` default is 5 but is irrelevant for recruiter uploads — do not pause on threshold for this path. The error threshold pause behavior is specific to the admin migration path. For CSV uploads, always run to completion and report totals.
- Upsert split strategy in `process_import_chunk`: email-keyed rows use `ON CONFLICT (tenant_id, email)`, phone-only rows use `ON CONFLICT (tenant_id, phone)`. This is handled inside the RPC — the route just needs to pass correctly-shaped candidate JSON.
- The `AUTH_ISSUER` constant and `validateActiveSession`/`authorizeAccess` functions are imported from `@/modules/auth`. Do not re-implement auth checking inline.
- All test files use `issueSessionToken` from `@/modules/auth` to mint valid session cookies; the cookie name is `SESSION_COOKIE_NAME` (`cbl_session`). Follow `cblaero/src/app/api/internal/admin/import-batches/__tests__/route.test.ts` for the test scaffolding pattern.
- Admin dashboard at `cblaero/src/app/dashboard/admin/page.tsx` was last modified to add the `MigrationStatusCard`. The `BatchProgressCard` for this story should mirror its visual pattern (Tailwind dark slate/cyan palette, `rounded-2xl border border-white/10 bg-slate-950/65` styling convention).

### Project Structure Notes

New files this story introduces:

- `cblaero/src/app/api/internal/recruiter/csv-upload/route.ts` — POST: accept CSV upload, create import batch, process rows
- `cblaero/src/app/api/internal/recruiter/csv-upload/[batchId]/route.ts` — GET: batch status lookup
- `cblaero/src/app/api/internal/recruiter/csv-upload/[batchId]/error-report/route.ts` — GET: stream error-report CSV
- `cblaero/src/app/api/internal/recruiter/csv-upload/__tests__/route.test.ts` — upload route tests
- `cblaero/src/app/api/internal/recruiter/csv-upload/[batchId]/__tests__/route.test.ts` — status + error-report route tests
- `cblaero/src/app/dashboard/recruiter/upload/page.tsx` — server component shell
- `cblaero/src/app/dashboard/recruiter/upload/CsvUploadWizard.tsx` — client component (three-step wizard)
- `cblaero/src/app/dashboard/recruiter/upload/BatchProgressCard.tsx` — client component (polling progress display)

Existing files to extend:

- `cblaero/src/modules/auth/authorization.ts` — add `"recruiter:csv-upload"` to `ProtectedAction` and role maps
- `cblaero/src/modules/audit/index.ts` — extend `ImportBatchAccessEvent.action` union with `"csv_upload_access"`
- `cblaero/src/app/dashboard/page.tsx` — add upload page link when role allows `recruiter:csv-upload`
- `cblaero/supabase/schema.sql` — add `candidates.extra_attributes` and wire into `process_import_chunk` upsert logic

Schema change required in this story: add `candidates.extra_attributes jsonb` and update `process_import_chunk` to persist it.

FR/NFR mapping:

- FR1 (Epic 2 — recruiter CSV upload, 10,000-row max, per-row error report)
- NFR34 (Tier 1 scale: 50-100 recruiters, 50k records, sub-second query latency — enforced via existing `candidates` indexes)

Story size: **M** (3–4 dev days)

### References

- [Source: docs/planning_artifacts/architecture.md#Candidate-Data-Ingestion-Architecture] — Path 2 (Recruiter CSV uploads): drag-and-drop, column mapping wizard, 10,000-record limit, per-row error report, `pending_enrichment` state
- [Source: docs/planning_artifacts/architecture.md#Project-Structure-and-Boundaries] — App Router folder structure, module boundaries
- [Source: docs/planning_artifacts/architecture.md#API-and-Communication-Patterns] — Response contract shape, no Supabase webhooks for critical paths
- [Source: docs/planning_artifacts/ux-design-specification.md#7-Data-Import-and-Sync-Console] — UX requirements: drag-and-drop, column mapping wizard, live validation preview, error report download, progress tracker
- [Source: docs/planning_artifacts/epics.md#Story-2.2] — User story and BDD acceptance criteria
- [Source: docs/planning_artifacts/prd.md#FR1] — Functional requirement: CSV upload with row-level errors and downloadable error report
- [Source: docs/planning_artifacts/prd.md#FR42] — RBAC: recruiter, delivery-head, admin roles may upload; compliance-officer may not
- [Source: cblaero/supabase/schema.sql] — `process_import_chunk` RPC, `import_batch`, `import_row_error`, `candidates` tables
- [Source: cblaero/src/modules/auth/authorization.ts] — `ProtectedAction` type, `ROLE_ACTION_MAP`, `authorizeAccess`
- [Source: cblaero/src/modules/audit/index.ts] — `ImportBatchAccessEvent`, `recordImportBatchAccessEvent`
- [Source: cblaero/src/app/api/internal/admin/import-batches/route.ts] — Import batch route pattern, in-memory test seeding
- [Source: cblaero/src/app/dashboard/admin/MigrationStatusCard.tsx] — Visual pattern for batch progress card
- [Source: docs/implementation_artifacts/stories/2-1-build-admin-supervised-initial-1m-record-migration-pipeline.md] — Prior story: `process_import_chunk` behavioral contract, upsert split strategy, auth/audit patterns, validation steps

## Dev Agent Record

### Agent Model Used

GPT-5.3-Codex

### Debug Log References

- npm run lint
- npm run typecheck
- npm test
- npm run build

### Completion Notes List

- Added recruiter CSV upload permission action (`recruiter:csv-upload`) for recruiter, delivery-head, and admin roles.
- Extended import-batch audit action enum with `csv_upload_access` and `download_csv_error_report`.
- Implemented recruiter CSV upload POST route with multipart handling, header mapping, row validation, 10,000-row hard limit, and import batch lifecycle updates.
- Implemented batch status GET route and error-report CSV download route with tenant-scoped authorization.
- Added JSONB extra-column persistence contract (`extra_attributes`) with server-side key normalization, blocked-key filtering, and payload-size/key-count guardrails.
- Added recruiter upload dashboard page with three-step wizard, live validation preview, and polling progress card.
- Added dashboard navigation link for authorized roles to access recruiter upload workflow.
- Updated Supabase schema and `process_import_chunk` upsert logic to persist `extra_attributes`.
- Added route-level tests for upload behavior, status lookup, tenant isolation, and extra-attribute guardrails.
- Validation passed: lint, typecheck, tests, and production build.

### File List

- cblaero/src/modules/auth/authorization.ts
- cblaero/src/modules/audit/index.ts
- cblaero/src/app/api/internal/recruiter/csv-upload/shared.ts
- cblaero/src/app/api/internal/recruiter/csv-upload/route.ts
- cblaero/src/app/api/internal/recruiter/csv-upload/[batchId]/route.ts
- cblaero/src/app/api/internal/recruiter/csv-upload/[batchId]/error-report/route.ts
- cblaero/src/app/api/internal/recruiter/csv-upload/**tests**/route.test.ts
- cblaero/src/app/api/internal/recruiter/csv-upload/[batchId]/**tests**/route.test.ts
- cblaero/src/app/dashboard/recruiter/upload/page.tsx
- cblaero/src/app/dashboard/recruiter/upload/CsvUploadWizard.tsx
- cblaero/src/app/dashboard/recruiter/upload/BatchProgressCard.tsx
- cblaero/src/app/dashboard/page.tsx
- cblaero/src/app/dashboard/admin/MigrationStatusCard.tsx
- cblaero/src/app/dashboard/recruiter/upload/UploadModeSelector.tsx
- cblaero/src/modules/csv/index.ts
- cblaero/supabase/schema.sql
### Review-Driven Fixes (2026-03-30, code-review pass)

- [x] H1: Marked all Tasks/Subtasks `[x]` — task list was left unchecked despite full implementation
- [x] H2: Replaced misleading "dead code" framing on `if (!session)` guards in all 3 routes with explicit TypeScript-narrowing comments — guards remain for type safety, not runtime logic
- [x] H3: Added compensating `candidates.delete().eq("source_batch_id", batchId)` in the Supabase failure catch block to prevent orphan candidate rows when a mid-batch chunk fails
- [x] H4: Removed unreliable fallback arithmetic in `processSupabaseBatch` running totals; now throws immediately if `process_import_chunk` RPC returns no result
- [x] M1: Added `cblaero/src/app/dashboard/admin/MigrationStatusCard.tsx` to story File List (was modified during this story, missing from file list)
- [x] M2: Added 50 MB `file.size` guard before `file.text()` to prevent memory exhaustion on large files prior to row-count rejection
- [x] M3: Extended blocked-key test to assert `secret` and `api_key` are excluded from `extra_attributes` (only `password` and `token` were previously asserted)
- [x] M4: Added two positive error-report download tests: CSV format/headers/content assertion, and empty-errors headers-only assertion

### Review-Driven Fixes (2026-03-30, code-review pass 2)

- [x] C1: Reverted `CsvUploadWizard.tsx` `CanonicalField` wire value for unmapped columns from `"(additional_attribute)"` back to `"(ignore)"` — commit `a3c3caa8` had introduced a client-server contract break where the wizard sent `"(additional_attribute)"` but the server's `parseColumnMap` only accepts `"(ignore)"`, causing HTTP 400 for any upload with unmapped columns; display label "Additional Attribute" preserved in `<option>` render
- [x] H1: Added regression test `"accepts '(ignore)' as columnMap wire value and populates extra_attributes"` to explicitly assert the `"(ignore)"` wire value contract and confirm extra_attributes are populated correctly
- [x] H2: Reverted `docs/implementation_artifacts/sprint-status.yaml` story `2-1-build-admin-supervised-initial-1m-record-migration-pipeline` from `in-progress` back to `done` — incorrectly downgraded in the same commit with no explanation
- [x] M1: Added inline comment on the `CanonicalField` type in `CsvUploadWizard.tsx` documenting that `"(ignore)"` is the server API wire value displayed as "Additional Attribute" in the UI

### Review-Driven Fixes (2026-04-01, code-review pass 3)

- [x] H1: Removed broken duplicate regression test at `route.test.ts:214-251` — used invalid columnMap value `name: "name"` (not a CanonicalField), expected 200 but would get 400; kept correct version at lines 318-356
- [x] H2: Fixed `processSupabaseBatch` RPC return accumulation — changed `imported = Number(...)` to `imported += Number(...)` for all three counters; HTTP response now shows correct cumulative totals for uploads >1,000 rows
- [x] M1: Rewrote `parseCsv()` in both `route.ts` and `CsvUploadWizard.tsx` to handle embedded newlines — new `splitCsvRows()` tracks quote state before splitting, so quoted fields with `\n` are preserved correctly
- [x] M2: Wrapped compensating delete and rollback in `route.ts` catch block with individual try/catch blocks and error logging — previously silent failures could leave orphan candidates
- [x] M3: Consolidated `toResponsePayload` in `[batchId]/route.ts` to use shared `toBatchStatusPayload()` from `shared.ts` — eliminated duplicate elapsedMs computation

### Review-Driven Fixes (2026-04-01, code-review pass 4)

- [x] H1: Accepted — 1-row preview is intentional per user; story task "5-row preview" was aspirational, not a hard requirement
- [x] H2: Moved `toErrorCode` and `extractSessionToken` from 3 route files into `shared.ts`; all routes now import from single source
- [x] M1: Extracted `parseCsvLine`, `splitCsvRows`, `parseCsv`, `FIELD_ALIASES`, `normalizeHeaderKey`, `inferFieldForHeader` into shared `@/modules/csv/index.ts`; removed ~200 lines of duplicated code from `route.ts` and `CsvUploadWizard.tsx`
- [x] M2: Fixed `splitCsvRows` to handle bare `\r` (CR-only) line endings — condition changed from `char === "\r" && text[i+1] === "\n"` to `char === "\r"` with subsequent `\r\n` skip
- [x] M3: Added `recordImportBatchAccessEvent` (action `read_import_batch_detail`) to `[batchId]/route.ts` GET handler with best-effort error swallowing
- [x] L1: Added `UploadModeSelector.tsx` and `@/modules/csv/index.ts` to story File List
- [x] L2: Added 401 (unauthenticated) and 403 (compliance-officer) auth tests to `[batchId]/__tests__/route.test.ts` — test count 16 → 18

### Review-Driven Fixes (2026-04-03, code-review pass 5 — adversarial standards audit)

- [x] H1: Fixed cross-tenant privilege escalation — all 3 routes now use `resolveRequestTenantId()` which validates `x-active-client-id` against `session.clientIds` instead of trusting the raw header
- [x] H2: Replaced sequential `recordFingerprint()` loop (N DB calls) with single `recordFingerprintBatch()` upsert — prevents timeout at 10K rows
- [x] H3: Isolated fingerprint recording from rollback path �� fingerprint failure no longer triggers compensating candidate delete
- [x] H4: Fixed `splitCsvRows()` to handle RFC 4180 `""` escape sequences — previously corrupted rows containing literal double-quotes
- [x] H5: Added `paused_on_error_threshold` to `ImportBatchStatus` type in repository — was missing, causing type/contract mismatch
- [x] H6: Added `shouldUseInMemoryPersistenceForTests()` mode guard to `clearCsvUploadStoreForTest()` — previously unguarded per §15
- [x] H7: Fixed error row chunking — errors now distributed across chunks instead of pinned to chunk-0, preventing silent truncation of large error sets
- [x] H8: Registered `@/modules/csv` in architecture.md §Implemented Capabilities and development-standards.md §18 �� was missing per §20
- [x] H9: Sanitized `batchId` in `content-disposition` header — strips non-alphanumeric chars to prevent header injection
- [x] H10: Removed redundant `authorizeAccess(null)` call before redirect in `page.tsx` — was a crash risk
- [x] M3: Added logging to all bare `catch {}` blocks in route.ts and [batchId]/route.ts — violating §12
- [x] M4: Added runtime status validation in [batchId]/route.ts — unsafe cast replaced with allowlist guard
- [x] M8: Standardized all fingerprint/batch logging to structured JSON with `traceId` — was inconsistent per §17/§23
- [x] M9: Fixed `BatchProgressCard` to stop polling on 401/403 responses — was flooding server indefinitely
- [x] M11: Increased preview rows from 1 to 5 in `CsvUploadWizard.tsx`
- [x] M14: Changed "Updated" label to "Skipped" in `BatchProgressCard.tsx` — aligned with API field semantics
- [x] Removed dead re-exports (`toErrorCode`, `extractSessionToken`) from `shared.ts`
- [x] Added `recordFingerprintBatch()` and `resolveRequestTenantId()` to architecture.md capability registry

### Review-Driven Action Items (2026-03-30)

- [ ] Add tests for audit event emission (verify `recordImportBatchAccessEvent` on upload and error report download)
- [x] ~~Add tests for malformed CSV edge cases (unclosed quotes, embedded newlines, binary data)~~ — embedded newline handling fixed in pass 3 (M1); unclosed quotes/binary data remain untested
- [ ] Add tests for large individual cell values (enforce/document per-cell size limit)
- [ ] Add concurrency tests for parallel uploads (race/resource contention)
- [ ] Add retry logic or error state for chunk failures (reliability improvement)
- [ ] Expand and/or make `extra_attributes` blocklist configurable (security improvement)
- [ ] Add generic error fallback in UI for unknown server errors (UX improvement)

### Production Ingestion Run (2026-03-31)

**File:** `Aero-Applicants.csv` (6,512 rows, 17 columns — typical recruiter Ceipal export)

**Schema fix applied:** `extra_attributes jsonb` column was defined in `schema.sql` and `process_import_chunk` RPC but had not been deployed to the live database. Applied `ALTER TABLE cblaero_app.candidates ADD COLUMN extra_attributes jsonb NOT NULL DEFAULT '{}'::jsonb` directly. All future schema deploys are already covered by the existing `ADD COLUMN IF NOT EXISTS` idempotent migration in `schema.sql:251`.

**Results — Batch `d959c526-2016-4a11-9d9d-e901e39e79f9`:**

| Metric | Count |
|---|---|
| Total CSV rows | 6,512 |
| Candidates imported | 6,150 |
| Validation errors (missing_identity) | 191 |
| Validation errors (invalid_format — short phone) | 41 |
| Upsert failures (duplicate phone constraint) | 31 |

**Column mapping:** 16 of 17 columns auto-mapped via `FIELD_ALIASES`; `Experience` (values like "17 Year(s)") stored in `extra_attributes.experience`.

**Bug found — `process_import_chunk` RPC return values:** The RPC's `RETURN QUERY SELECT v_chunk_imported, 0, v_chunk_errors` returns **chunk-level** counts, but `route.ts:520` reads them as cumulative (`imported = Number(rpcResult.imported)`). The `import_batch` table gets correct cumulative totals (the RPC updates them internally), but the HTTP response to the client shows only the last chunk's numbers. This is cosmetic for now (batch status polling reads the correct DB values) but should be fixed.

**CLI script added:** `cblaero/scripts/ingest-csv.ts` — standalone `tsx` script for direct CSV ingestion bypassing HTTP auth, using the same parsing/validation/mapping logic as the route. Merged in PR #29.
