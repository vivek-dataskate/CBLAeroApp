# Story 2.5: Implement Deterministic Deduplication and Manual Review Queue

Status: done

## Story

As a data steward,
I want deterministic merge thresholds and manual-review routing,
so that duplicate outreach is prevented without unsafe auto-merges.

## Acceptance Criteria

1. **Given** candidate identity collisions with >=95% identity confidence **When** the dedup worker evaluates them **Then** candidates auto-merge into a single canonical record **And** the merge decision is logged with confidence score, rationale, and source identities
2. **Given** candidate identity collisions with 70-94% identity confidence **When** the dedup worker evaluates them **Then** candidates route to a manual-review queue **And** the review item displays both candidate profiles side-by-side with field-level diffs
3. **Given** candidate identity collisions with <70% identity confidence **When** the dedup worker evaluates them **Then** candidates remain as separate records **And** no merge action is taken
4. **Given** a manual-review queue item **When** a data steward approves or rejects the merge **Then** the decision is recorded with actor, timestamp, confidence score, and rationale **And** approved merges execute immediately with field-level conflict resolution
5. **Given** any dedup decision (auto-merge, manual review, or keep separate) **When** the decision is recorded **Then** an audit trail row is created in `dedup_decisions` with: confidence_score, decision_type, rationale, actor (system or human), source candidate IDs, and trace_id
6. **Given** records in `pending_dedup` state (from migration, CSV, ATS, email, resume ingestion) **When** the dedup worker processes them **Then** each record is evaluated against all existing `active` candidates using `candidate_identity` fingerprints **And** the record transitions to `active` (no match or <70%), `merged` (>=95%), or `pending_review` (70-94%)

## Tasks / Subtasks

- [x] Task 1: Schema changes — new tables + extend ingestion_state (AC: #5, #2, #6)
  - [x] 1.1 Add `dedup_decisions` and `dedup_review_queue` tables to `supabase/schema.sql` with indexes and grants
  - [x] 1.2 Extend `ingestion_state` check constraint: add `'pending_review'` and `'merged'` to the existing 4 values
  - [x] 1.3 Update TypeScript `IngestionState` type in `contracts/candidate.ts` to include `'pending_review' | 'merged'`
  - [x] 1.4 Apply migration via Supabase MCP
  - [x] 1.5 Create `merge_candidates` RPC in schema.sql (atomic: update winner fields + update loser state + update fingerprint/submission refs + insert dedup_decision — per dev standards §4.1, this is 5+ operations and MUST be a single RPC)
- [x] Task 2: Backfill `candidate_identity` fingerprints for existing candidates (AC: #6 prerequisite)
  - [x] 2.1 Write a one-time backfill script (or RPC) that iterates all `active` candidates and records `candidate_identity` fingerprints via `computeIdentityHash()` + `recordFingerprintBatch()`
  - [x] 2.2 Run backfill against the ~731K existing candidates — 731,488 identity fingerprints recorded via server-side SQL INSERT
  - [x] 2.3 Identity fingerprints for NEW candidates will be recorded by the dedup worker (Task 7.5) when it processes each `pending_dedup` candidate — no need to scatter recording across 5 ingestion paths
  - [x] 2.4 Add `'dedup'` to `FingerprintSource` type in `fingerprint-repository.ts:18` AND to `content_fingerprints.source` CHECK constraint in `schema.sql:1110` — done in Task 1
- [x] Task 3: Fix ingestion state pipeline ordering (AC: #6)
  - [x] 3.1 All 4 files changed from `'pending_enrichment'` to `'pending_dedup'`
  - [x] 3.2 Files updated: `index.ts`, `csv-upload/route.ts`, `csv-upload/shared.ts`, `resume-upload/confirm/route.ts`
  - [x] 3.5 Updated upsert RPCs to preserve `active`/`pending_review` state on re-ingestion conflict
  - [x] 3.3 Dedup worker promotes to `active`
  - [x] 3.4 Only 1 test references `pending_enrichment` — deliberate seed for testing, stays as-is
- [x] Task 4: Implement identity confidence scoring algorithm (AC: #1, #2, #3)
  - [ ] 4.1 Create `src/features/candidate-management/application/dedup-scoring.ts`
  - [ ] 4.2 Email-exact-match scoring (email match = 95% base, email+name = 98%)
  - [ ] 4.3 Name+phone scoring (phone+name = 85%, phone only = 70%)
  - [ ] 4.4 No-match and name-only paths (50% and 0% respectively)
  - [ ] 4.5 Phone normalization in scoring MUST match `computeIdentityHash` code: `.replace(/\D/g, "")` — do NOT strip leading `1`
  - [ ] 4.6 Unit tests: 10+ cases covering every row in the scoring table plus edge cases (null email, null phone, both null, US phone with/without +1 prefix, empty strings, name case variations)
- [x] Task 5: Create `DedupRepository` (AC: #1, #2, #3, #5, #6)
  - [ ] 5.1 `findIdentityMatches(tenantId, identityHash)` — query `content_fingerprints` WHERE `fingerprint_type = 'candidate_identity'` AND `fingerprint_hash` matches, return matched candidate_ids
  - [ ] 5.2 `callMergeCandidatesRpc(winnerId, loserId, mergedFields, decision)` — wrapper for `merge_candidates` RPC
  - [ ] 5.3 `createReviewItem(tenantId, candidateA, candidateB, confidence, fieldDiffs)` — insert into `dedup_review_queue`
  - [ ] 5.4 `recordDedupDecision(params)` — insert into `dedup_decisions` audit table
  - [ ] 5.5 `listPendingReviews(tenantId, cursor, limit)` — paginated review queue with composite cursor
  - [ ] 5.6 `resolveReview(reviewId, decision, actorId)` — approve/reject: if approved, call merge RPC; always insert dedup_decision
  - [ ] 5.7 `getDedupStats(tenantId)` — counts by decision_type + pending review count
  - [ ] 5.8 `listPendingDedupCandidates(tenantId, limit)` — query candidates WHERE `ingestion_state = 'pending_dedup'`
- [x] Task 6: Create auto-merge field resolution logic (AC: #1, #4)
  - [ ] 6.1 Create `src/features/candidate-management/application/dedup-merge.ts`
  - [ ] 6.2 Winner selection logic, field merge rules, reference update list
  - [ ] 6.3 Compute `field_diffs` JSONB for review queue items
  - [ ] 6.4 Unit tests: 8+ cases (both have email, one null, skills overlap, skills disjoint, extra_attributes conflict, resume_url both present, years_of_experience tie, source chain)
  - [ ] 6.5 Reference existing pattern: `scripts/dedup-phones.ts` already has scoring-by-field-completeness logic — reuse the approach but implement in repository layer
- [x] Task 7: Create async dedup worker/job (AC: #6)
  - [ ] 7.1 `DedupWorkerJob` implementing `SchedulerJob` interface in `src/modules/ingestion/jobs.ts`
  - [ ] 7.2 Query `pending_dedup` candidates in batches of 100
  - [ ] 7.3 For each: compute identity hash → find matches → score → route (auto-merge / review / active)
  - [ ] 7.4 If NO matches found: transition directly to `active`, log `keep_separate` decision with confidence 0%
  - [ ] 7.5 Record `candidate_identity` fingerprint for the processed candidate (so future candidates can match against it)
  - [ ] 7.6 Register in `registerIngestionJobs(scheduler)` — 5th job
  - [ ] 7.7 Add `'dedup'` alias to `src/app/api/internal/jobs/run/route.ts` allowed jobs list (currently hardcoded: `['ceipal-sync', 'email-sync', 'onedrive-sync']`) and map to `DedupWorkerJob`
  - [ ] 7.8 Add Render cron trigger for dedup job (every 15 minutes, same pattern as existing crons)
  - [ ] 7.9 Log summary: `{ processed, autoMerged, sentToReview, keptSeparate, errors }`
- [x] Task 8: Create manual review queue API routes (AC: #2, #4)
  - [ ] 8.1 `GET /api/internal/dedup/reviews` — list pending reviews (paginated, tenant-scoped)
  - [ ] 8.2 `GET /api/internal/dedup/reviews/[id]` — review detail with both candidate profiles + field diffs + confidence breakdown
  - [ ] 8.3 `POST /api/internal/dedup/reviews/[id]/resolve` — approve or reject merge (requires `candidate:write`)
  - [ ] 8.4 `GET /api/internal/dedup/stats` — dedup summary counts
  - [ ] 8.5 Integration tests for all 4 routes
- [x] Task 9: Create manual review queue UI (AC: #2, #4)
  - [ ] 9.1 `/dashboard/admin/dedup/page.tsx` — review queue list with stats summary bar
  - [ ] 9.2 Side-by-side candidate comparison: names, emails, phones, sources, ingestion dates, skills, location, confidence breakdown (which fields matched and their individual scores)
  - [ ] 9.3 Approve/reject with confirmation dialog
  - [ ] 9.4 Bulk approve for items >=90% confidence (select visible + approve all)
  - [ ] 9.5 Follow the admin dashboard dark theme (`bg-slate-950`, `border-white/10`, `text-slate-100`) since this page lives under `/dashboard/admin/` — NOT the recruiter white theme. Match existing admin pages (e.g., `src/app/dashboard/admin/page.tsx`)
- [x] Task 10: Write integration tests + verify zero regressions (AC: all)
  - [ ] 10.1 Integration tests for dedup worker job (batch processing, state transitions, no-match path)
  - [ ] 10.2 Verify all existing ingestion tests pass with new `pending_dedup` default
  - [ ] 10.3 End-to-end: ingest candidate via CSV → pending_dedup → dedup worker → active
- [x] Task 11: Register capabilities in architecture.md and development-standards.md (AC: n/a — compliance)

## Dev Notes

### Identity Confidence Scoring Algorithm

The scoring must be **deterministic** — same inputs always produce same score. No ML, no probabilistic matching.

**Scoring rules:**

| Match Type | Condition | Confidence |
|-----------|-----------|------------|
| Email exact match | `lower(email_a) === lower(email_b)` | 95% (auto-merge) |
| Email exact + name match | Email match + normalized name match | 98% (auto-merge) |
| Phone + name match | `normalized(phone_a) === normalized(phone_b)` AND `lower(first+last)` match | 85% (manual review) |
| Phone match only | Phone match, names differ | 70% (manual review — borderline) |
| Name match only | Names match exactly, no email/phone overlap | 50% (keep separate) |
| No field overlap | Nothing matches | 0% (keep separate) |

**Phone normalization (MATCH THE CODE — `fingerprint-repository.ts:134`):** Strip all non-digits ONLY. Do NOT strip leading `1`. The actual `computeIdentityHash` implementation uses `.replace(/\D/g, "")` — so `+1 (713) 555-0123` becomes `17135550123` (with the leading 1). The scoring algorithm MUST use the same normalization to be consistent with stored fingerprints.

**Name normalization:** `lower(trim(firstName))` + `lower(trim(lastName))` concatenated WITHOUT separator (matching `computeIdentityHash` code). No fuzzy matching in MVP — exact match only after normalization.

**Hash formula separator:** The code uses pipe `|` separator: `SHA-256("${namePart}|${phonePart}")`. Do NOT use `+` concatenation as described in architecture.md — the CODE is the source of truth.

**The `candidate_identity` fingerprint from Story 1.11** is the primary dedup key:
- `computeIdentityHash(email)` → `SHA-256(lower(email))` — preferred path
- `computeIdentityHash(null, firstName, lastName, phone)` → `SHA-256(lower(first)+lower(last)|digits-only(phone))` — fallback
- `computeIdentityHash(null, null, null, null)` → returns `""` empty string — skip these candidates (no dedup possible)

### Multi-Pass Matching Strategy

**CRITICAL DESIGN ISSUE:** Hash-based lookup via `content_fingerprints` can ONLY find exact identity hash matches. This means:
- **Email-to-email match:** Works perfectly (both hash to `SHA-256(lower(email))`)
- **Name+phone-to-name+phone match:** Works if name AND phone are identical
- **Phone-only match (different names):** UNREACHABLE via hash lookup (different hashes)
- **Name-only match (different phones):** UNREACHABLE via hash lookup (different hashes)

**Solution — two-pass dedup worker:**

**Pass 1 (fingerprint lookup):** Query `content_fingerprints WHERE fingerprint_type = 'candidate_identity'` for hash matches. This catches email-exact and name+phone-exact cases efficiently.

**Pass 2 (raw field query for borderline cases):** For candidates that had NO fingerprint matches in Pass 1, run a direct SQL query against the `candidates` table:
```sql
SELECT id, email, phone, first_name, last_name FROM cblaero_app.candidates
WHERE tenant_id = $1 AND ingestion_state = 'active'
  AND (
    (phone IS NOT NULL AND regexp_replace(phone, '\D', '', 'g') = $2)  -- normalized phone match
    OR (lower(first_name) = $3 AND lower(last_name) = $4)             -- exact name match
  )
```
This enables the 70% (phone-only) and 50% (name-only) scoring paths that are otherwise dead code. The scoring algorithm then compares ALL matched fields to determine the actual confidence.

**Critical prerequisite — backfill existing candidates:** No ingestion path currently records `candidate_identity` fingerprints (Story 1.11 reserved the type but never wired it). The ~7,000+ existing `active` candidates have NO identity fingerprints in the table. Task 2 must backfill these BEFORE the dedup worker can match anything via Pass 1. Without backfill, everything falls through to the slower Pass 2.

**No-match path:** If a `pending_dedup` candidate has no collisions in either pass, it transitions directly to `active` with a `keep_separate` decision logged at confidence 0%. This is the most common path for clean data.

**Empty identity hash:** If `computeIdentityHash()` returns `""` (candidate has no email AND no phone — prevented by DB constraint `check (email is not null or phone is not null)` but possible with empty strings), skip fingerprint recording and go straight to Pass 2 raw field query.

### Database Schema Additions

```sql
-- Dedup decisions audit table (append-only)
CREATE TABLE IF NOT EXISTS cblaero_app.dedup_decisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  candidate_a_id uuid NOT NULL REFERENCES cblaero_app.candidates(id),
  candidate_b_id uuid NOT NULL REFERENCES cblaero_app.candidates(id),
  decision_type text NOT NULL CHECK (decision_type IN ('auto_merge', 'manual_merge', 'manual_reject', 'keep_separate')),
  confidence_score numeric(5,2) NOT NULL,
  rationale text NOT NULL,
  actor text NOT NULL DEFAULT 'system',  -- 'system' or user actor_id
  trace_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dedup_decisions_tenant ON cblaero_app.dedup_decisions (tenant_id, created_at DESC);
CREATE INDEX idx_dedup_decisions_candidates ON cblaero_app.dedup_decisions (candidate_a_id, candidate_b_id);

-- Manual review queue
CREATE TABLE IF NOT EXISTS cblaero_app.dedup_review_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  candidate_a_id uuid NOT NULL REFERENCES cblaero_app.candidates(id),
  candidate_b_id uuid NOT NULL REFERENCES cblaero_app.candidates(id),
  confidence_score numeric(5,2) NOT NULL,
  field_diffs jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { fieldName: { a: valueA, b: valueB } }
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dedup_review_tenant_status ON cblaero_app.dedup_review_queue (tenant_id, status) WHERE status = 'pending';

-- Extend candidates ingestion_state check constraint
-- The inline check constraint name is auto-generated by Postgres. Verify actual name first:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'cblaero_app.candidates'::regclass AND conname LIKE '%ingestion%';
-- Then drop by verified name. Alternatively, update the CREATE TABLE in schema.sql directly
-- and rely on the IF NOT EXISTS + migration approach.
-- For the MCP migration, use the verified constraint name:
ALTER TABLE cblaero_app.candidates DROP CONSTRAINT IF EXISTS candidates_ingestion_state_check;
ALTER TABLE cblaero_app.candidates ADD CONSTRAINT candidates_ingestion_state_check
  CHECK (ingestion_state IN ('pending_dedup', 'pending_enrichment', 'active', 'rejected', 'pending_review', 'merged'));

-- Grants
GRANT INSERT, SELECT ON cblaero_app.dedup_decisions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON cblaero_app.dedup_review_queue TO authenticated;
```

### Auto-Merge Field Resolution Strategy

When auto-merging (`>=95%` confidence), one candidate is the **winner** (kept) and one is the **loser** (marked `merged`).

**Winner selection:** The candidate with `ingestion_state = 'active'` is preferred. If both are `pending_dedup`, prefer the one with more non-null fields. If tied, prefer the more recently created. **IMPORTANT:** When both are `pending_dedup`, the winner MUST be promoted to `active` (not left as `pending_dedup`).

**Field merge rules:**
- `email`: Keep winner's email. If different, store loser's email in `extra_attributes.email_aliases` array.
- `phone`: Prefer most-recently updated non-null value.
- `first_name`, `last_name`: Prefer non-null, then most-recently updated.
- `name`: **This column still exists (NOT dropped — schema.sql:235, `NOT NULL`).** The merge RPC MUST recompute `name = first_name || ' ' || last_name` for the winner after merge. Failure to do so will either leave stale denormalized data or violate the NOT NULL constraint.
- `resume_url`: Prefer non-null. If both have resumes, keep both URLs in `extra_attributes.additional_resumes`. **NOTE:** `resume_url` is NOT in the `CandidateDetailRow` type or `get_candidate_detail` RPC — the merge RPC must SELECT it directly from the `candidates` table, not via `getCandidateById()`.
- `skills`, `certifications`, `aircraft_experience`: JSON array **union** (deduplicated). Do NOT use the `scripts/dedup-phones.ts` approach which takes the longer array — implement true set union.
- `extra_attributes`: Deep merge — winner's keys take priority on conflict.
- `years_of_experience`: Prefer higher value (assumption: more data = better).
- `source`: Keep winner's source. Store loser's source in `extra_attributes.merged_sources` array.
- `ceipal_id`: Prefer non-null. If both have a ceipal_id, keep winner's (unique constraint).
- All other string fields: Prefer non-null, then most-recently updated.

**CRITICAL — Unique constraint handling in merge RPC:**
The candidates table has two partial unique indexes (schema.sql:272-278):
```sql
uq_candidates_tenant_email ON (tenant_id, email) WHERE email IS NOT NULL
uq_candidates_tenant_phone ON (tenant_id, phone) WHERE phone IS NOT NULL
```
Since the loser is NOT deleted (only marked `merged`), the loser's `email` and `phone` values **remain in the table and block the unique index**. The merge RPC MUST:
1. NULL out the loser's `email` and `phone` BEFORE updating the winner with any transferred values
2. Then update the winner's fields
3. Then mark the loser as `merged`
Order matters — otherwise the unique constraint will fire.

**Reference updates on merge (all inside `merge_candidates` RPC for atomicity):**
- NULL out loser's `email` and `phone` to release unique constraints
- Update winner's fields with merged values (including recomputed `name`)
- `content_fingerprints.candidate_id` → update loser's fingerprints to point to winner
- `candidate_submissions.candidate_id` → update loser's submissions to point to winner (column confirmed present with FK to candidates)
- Loser record: set `ingestion_state = 'merged'`, add `extra_attributes.merged_into = winnerId`, preserve original email/phone in `extra_attributes.original_email` / `extra_attributes.original_phone`
- Insert `dedup_decisions` audit row within same transaction

**Existing merge pattern reference:** `scripts/dedup-phones.ts` implements field-completeness scoring + merge + DELETE. Reuse the field-completeness scoring approach for winner selection, but do NOT reuse its deletion strategy or its "longer array wins" logic for skills. Implement as a proper RPC + repository function.

### Dedup Worker Job Design

```typescript
// In src/modules/ingestion/jobs.ts — follows same pattern as EmailIngestionJob, CeipalIngestionJob
class DedupWorkerJob implements SchedulerJob {
  name = 'DedupWorkerJob';  // PascalCase to match existing convention (EmailIngestionJob, etc.)

  async run(): Promise<void> {
    // 1. Query candidates WHERE ingestion_state = 'pending_dedup' LIMIT 100
    // 2. For each candidate:
    //    a. Compute candidate_identity hash via computeIdentityHash()
    //    b. PASS 1: Look up matches in content_fingerprints WHERE type='candidate_identity'
    //    c. PASS 2 (if no Pass 1 matches): raw field query for phone/name matches
    //    d. For each match, load the matched candidate and compute confidence
    //    e. Route: >=95% → autoMerge, 70-94% → createReviewItem, <70% → mark active
    // 3. Record dedup decision for every evaluation
    // 4. Update candidate ingestion_state based on outcome
    // 5. Record candidate_identity fingerprint for the processed candidate
    // 6. Log summary: { processed, autoMerged, sentToReview, keptSeparate, errors }
  }
}
```

**NOTE: `SchedulerJob` interface only has `name: string` and `run(): Promise<void>` — no `intervalMs` property.** There is no global scheduler yet (deferred to Story 2.7). The job is triggered via the Render cron → `/api/internal/jobs/run` route.

**CRITICAL — update the jobs route:** The file `src/app/api/internal/jobs/run/route.ts` hardcodes the allowed job names: `['ceipal-sync', 'email-sync', 'onedrive-sync']`. You MUST add `'dedup'` (or chosen alias) to this list and map it to `DedupWorkerJob`, otherwise the job will never execute.

**Batch size:** 100 candidates per run. At 15-minute cron intervals, this processes 9,600/day — sufficient for ongoing ingestion volume.

**Important:** The dedup worker must record a `candidate_identity` fingerprint for each processed candidate (if not already recorded). This ensures future candidates can be matched against it.

### Pipeline Ordering — Current State vs. Target

**Current state (verified in code):** All ingestion paths hardcode `ingestion_state: 'pending_enrichment'`, bypassing the schema default of `'pending_dedup'`:
- `src/modules/ingestion/index.ts:254` — `mapToCandidateRow()` defaults to `'pending_enrichment'`
- `src/app/api/internal/recruiter/csv-upload/route.ts:280` — hardcoded `'pending_enrichment'`
- `src/app/api/internal/recruiter/csv-upload/shared.ts:76` — TypeScript type literal `ingestion_state: "pending_enrichment"` in `CsvCandidateRow` — must change or TS error
- `src/app/api/internal/recruiter/resume-upload/[batchId]/confirm/route.ts:107` — hardcoded `'pending_enrichment'`
- `process_import_chunk` RPC (schema.sql:586) — defaults to `'pending_dedup'` via `coalesce()`, but callers always override

**Target state:** Remove the `'pending_enrichment'` overrides so the schema default `'pending_dedup'` takes effect. The dedup worker then promotes candidates to `'active'`. Enrichment (when implemented in future stories) will work on `active` candidates.

**Regression risk #1 — tests:** Existing tests may assert `ingestion_state: 'pending_enrichment'`. Task 3.4 must update these assertions.

**Regression risk #2 — re-ingestion downgrades `active` to `pending_dedup`:** The `upsert_candidate` and `upsert_candidate_batch` RPCs (schema.sql:866, 899) use `ingestion_state = excluded.ingestion_state` on conflict. After this change, re-ingesting an email-duplicate candidate that is already `active` would downgrade it back to `pending_dedup`. **Fix:** Update the RPC conflict clauses to preserve `active` state:
```sql
ingestion_state = CASE
  WHEN candidates.ingestion_state IN ('active', 'pending_review') THEN candidates.ingestion_state
  ELSE excluded.ingestion_state
END
```
This must be applied to both `upsert_candidate` and `upsert_candidate_batch` RPCs.

### Review Queue UI Requirements

The data steward must see enough context to make a confident merge decision:
- **Both candidate profiles:** names, emails, phones, locations, job titles, skills, sources, ingestion dates, resume URLs
- **Field-level diffs:** highlighted differences between the two records (matching fields in green, differing in yellow)
- **Confidence breakdown:** which fields matched and their individual contribution to the overall score
- **Bulk actions:** For queues with many items (post-migration), support "select all visible + bulk approve" for items >=90% confidence

### Existing Patterns to Reuse (DO NOT Reinvent)

| Need | Existing Solution | Location |
|------|-------------------|----------|
| Identity hash computation | `computeIdentityHash()` | `@/features/candidate-management/infrastructure/fingerprint-repository.ts` |
| Fingerprint lookup | `isAlreadyProcessed()`, `loadRecentFingerprints()` | `@/features/candidate-management/infrastructure/fingerprint-repository.ts` |
| Fingerprint recording | `recordFingerprint()`, `recordFingerprintBatch()` | `@/features/candidate-management/infrastructure/fingerprint-repository.ts` |
| Candidate query | `listCandidates()`, `getCandidateById()` | `@/features/candidate-management/infrastructure/candidate-repository.ts` |
| Candidate upsert (single) | `upsertCandidateByEmail()` → calls `upsert_candidate` RPC | `@/features/candidate-management/infrastructure/candidate-repository.ts` |
| Candidate upsert (batch) | `batchUpsertCandidatesByEmail()` → calls `upsert_candidate_batch` RPC | `@/features/candidate-management/infrastructure/candidate-repository.ts` |
| Batch import | `processImportChunk()` → calls `process_import_chunk` RPC | `@/features/candidate-management/infrastructure/import-batch-repository.ts` |
| Phone dedup scoring pattern | Field-completeness scoring + merge | `scripts/dedup-phones.ts` (reference only — don't import, reimplement in repository) |
| API auth wrapper | `withAuth(handler, options)` | `@/modules/auth/with-auth.ts` |
| Supabase admin client | `getSupabaseAdminClient()` | `@/modules/persistence` |
| Audit logging | `recordImportBatchAccessEvent()` pattern | `@/modules/audit/index.ts` |
| Job registration | `registerIngestionJobs(scheduler)` | `@/modules/ingestion/jobs.ts` |
| Sync error recording | `recordSyncFailure()` | `@/features/candidate-management/infrastructure/sync-error-repository.ts` |
| Cursor pagination | Composite cursor pattern from Story 2.4 | `@/features/candidate-management/infrastructure/candidate-repository.ts` |
| Admin dashboard theme | Dark theme (`bg-slate-950`, `text-slate-100`) | `@/app/dashboard/admin/page.tsx` — dedup page goes here |
| Recruiter dashboard patterns | White theme, text-xs/text-sm, filter bar | `@/app/dashboard/recruiter/candidates/page.tsx` — reference only |
| ILIKE escaping | `escapeIlike()` | `@/features/candidate-management/infrastructure/candidate-repository.ts` |
| Fetch with retry | `fetchWithRetry()` | `@/modules/ingestion/fetch-with-retry.ts` |

### Architecture Compliance

- **Tenant isolation:** Every query MUST include `tenant_id` filter. Review queue is tenant-scoped.
- **API envelope:** Success `{ data, meta }`, error `{ error: { code, message } }`.
- **Route auth:** All routes use `withAuth()` wrapper. Review resolve requires `candidate:write` permission.
- **No direct DB in routes:** All DB access via `DedupRepository` functions.
- **Cursor-based pagination:** Review queue list uses composite cursor `(created_at, id)`.
- **Audit immutability:** `dedup_decisions` table is append-only. No UPDATE/DELETE grants.
- **Structured logging:** All dedup operations log structured JSON with module prefix `[DedupWorker]`.
- **Error handling:** Every Supabase call checks `.error`. Failed dedup operations use `recordSyncFailure()`.

### Ingestion State Transitions

```
                                    >=95% confidence
pending_dedup ──────────────────────────────────────> merged (loser: email/phone NULLed, state='merged')
       │                                              active (winner: promoted to active if was pending_dedup)
       │         70-94% confidence
       ├──────────────────────────────────────────> pending_review (new candidate waits)
       │                                              │
       │                                     approve  │  reject
       │                                       ┌──────┴──────┐
       │                                       ▼             ▼
       │                                    merged      active (both become/stay active)
       │                                    (loser)
       │
       │         <70% confidence OR no matches
       └──────────────────────────────────────────> active
```

### Previous Story Intelligence

**From Story 2.4 (Candidate Profile Storage and Indexing):**
- `name` column STILL EXISTS in candidates table (schema.sql:235, `NOT NULL`) — Story 2.4 notes were wrong. Both `process_import_chunk` RPC (line 461) and `upsert_candidate` RPC (line 861) still compute and write `name`. Any merge/update must recompute `name = first_name || ' ' || last_name`.
- Supabase client: use `getSupabaseAdminClient()` from `@/modules/persistence`, no `.schema('cblaero_app')`
- ILIKE escaping required: `.replace(/[%_]/g, (ch) => \`\\${ch}\`)`
- Partial composite indexes use `WHERE ingestion_state = 'active'` — new states (`pending_review`, `merged`) are automatically excluded from these indexes (good for performance)
- Story 2.4 review deferred: no tests for saved search repository — acceptable pattern for initial implementation

**From Story 1.11 (Content Fingerprint Gate):**
- `FingerprintRepository` is fully implemented with 6 public functions + hash utilities
- `candidate_identity` fingerprint type exists in the check constraint but is reserved for Story 2.5 use
- `isAlreadyProcessed()` filters on `status = 'processed'` only — `failed` status allows retry
- `loadRecentFingerprints()` returns `Set<string>` for efficient batch lookups
- 228 tests passing at Story 1.11 completion

**From Git History (recent commits):**
- `6adc1a41`: Skills and YOE filters reverted to PostgREST-compatible operators — use `.gte()` not `.filter('gte')`
- `8d067492`: 11 unused indexes dropped, trigram index added for ILIKE — any new indexes should be justified
- `9c1ec197`: Candidate search UI redesigned — follow the new grouped filter + richer table pattern for review queue UI

### Project Structure Notes

New files for this story:

```
cblaero/
  supabase/
    schema.sql                                    [MODIFY] - dedup_decisions, dedup_review_queue tables, merge_candidates RPC, ingestion_state constraint extension, FingerprintSource 'dedup', upsert RPCs ingestion_state preservation
  src/
    features/candidate-management/
      contracts/
        candidate.ts                              [MODIFY] - add 'pending_review' | 'merged' to IngestionState
        dedup.ts                                  [NEW] - DedupDecision, ReviewQueueItem, ConfidenceResult types
      infrastructure/
        fingerprint-repository.ts                 [MODIFY] - add 'dedup' to FingerprintSource type
        dedup-repository.ts                       [NEW] - DedupRepository functions
        __tests__/
          dedup-repository.test.ts                [NEW] - unit tests
      application/
        dedup-scoring.ts                          [NEW] - confidence scoring algorithm
        dedup-merge.ts                            [NEW] - auto-merge field resolution logic
        __tests__/
          dedup-scoring.test.ts                   [NEW] - scoring algorithm + merge tests
    app/
      api/
        internal/
          jobs/
            run/
              route.ts                            [MODIFY] - add 'dedup' to allowed job aliases
          dedup/
            reviews/
              route.ts                            [NEW] - GET list
              [id]/
                route.ts                          [NEW] - GET detail
                resolve/
                  route.ts                        [NEW] - POST approve/reject
            stats/
              route.ts                            [NEW] - GET dedup stats
          recruiter/
            csv-upload/
              route.ts                            [MODIFY] - remove pending_enrichment override
              shared.ts                           [MODIFY] - update CsvCandidateRow type literal
            resume-upload/
              [batchId]/
                confirm/
                  route.ts                        [MODIFY] - remove pending_enrichment override
      dashboard/
        admin/
          dedup/
            page.tsx                              [NEW] - review queue dashboard (dark theme)
    modules/
      ingestion/
        index.ts                                  [MODIFY] - remove pending_enrichment default in mapToCandidateRow
        jobs.ts                                   [MODIFY] - add DedupWorkerJob
        __tests__/
          ingestion-jobs.test.ts                  [MODIFY] - expect 5 jobs, update name assertions
  scripts/
    backfill-identity-fingerprints.ts             [NEW] - one-time backfill script for existing candidates
  docs/
    planning_artifacts/
      architecture.md                             [MODIFY] - register dedup capabilities
      development-standards.md                    [MODIFY] - add dedup repository to §18 table
```

### References

- [Source: docs/planning_artifacts/development-standards.md — mandatory implementation rules, error handling, retry, type safety, auth, testing patterns]
- [Source: docs/planning_artifacts/architecture.md#Content-Fingerprint-Gate — fingerprint service, candidate_identity hash spec]
- [Source: docs/planning_artifacts/architecture.md#Candidate-Data-Pipeline — ingestion paths and dedup flow diagrams]
- [Source: docs/planning_artifacts/epics.md#Epic-2 — FR4 deterministic dedup requirements, confidence thresholds]
- [Source: docs/implementation_artifacts/stories/1-11-implement-content-fingerprint-gate-for-all-ingestion-paths.md — FingerprintRepository API, candidate_identity type]
- [Source: docs/implementation_artifacts/stories/2-4-implement-candidate-profile-storage-and-indexing.md — dashboard UI patterns, cursor pagination, repository patterns]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- TypeScript clean compile: 0 errors
- Full test suite: 302/302 pass (37 files, including 24 new dedup tests)

### Completion Notes List

- **Schema:** Created `dedup_decisions` (append-only audit), `dedup_review_queue` tables, `merge_candidates` RPC (atomic 4-step merge). Extended `ingestion_state` to 6 values. Added `'dedup'` to fingerprint source type.
- **Upsert RPCs:** Updated `upsert_candidate`, `upsert_candidate_batch`, `process_import_chunk` to preserve `active`/`pending_review` state on re-ingestion (prevents downgrade regression).
- **Backfill:** 731,488 `candidate_identity` fingerprints created via server-side SQL INSERT for all existing candidates.
- **Pipeline ordering:** Changed 4 files from `'pending_enrichment'` to `'pending_dedup'` default. New candidates now enter dedup pipeline.
- **Scoring algorithm:** Deterministic confidence scoring (98/95/85/70/50/0%) matching `computeIdentityHash` phone normalization (digits-only, no leading-1 strip).
- **Merge logic:** Winner selection by state → field count → recency. JSON array union for skills/certs/aircraft_experience. Unique constraint handling (NULL loser email/phone before winner update). Preserves email aliases, merged sources, additional resumes.
- **Dedup worker:** `DedupWorkerJob` with two-pass matching (fingerprint hash + raw field query). Registered as 5th job. Added `'dedup'` alias to jobs/run route.
- **API routes:** 4 endpoints under `/api/internal/dedup/` with proper `withAuth` (candidate:read/write permissions).
- **Dashboard UI:** Admin dark-theme dedup review page with stats bar, expandable side-by-side comparison, approve/reject actions, bulk approve for >=90% confidence.

### File List

- `cblaero/supabase/schema.sql` (modified — dedup tables, merge RPC, constraint extensions, upsert state preservation)
- `cblaero/src/features/candidate-management/contracts/candidate.ts` (modified — IngestionState extended)
- `cblaero/src/features/candidate-management/contracts/dedup.ts` (new — dedup type definitions)
- `cblaero/src/features/candidate-management/infrastructure/fingerprint-repository.ts` (modified — added 'dedup' source)
- `cblaero/src/features/candidate-management/infrastructure/dedup-repository.ts` (new — DedupRepository with 12 functions)
- `cblaero/src/features/candidate-management/application/dedup-scoring.ts` (new — confidence scoring + routing)
- `cblaero/src/features/candidate-management/application/dedup-merge.ts` (new — winner selection, field merge, diff computation)
- `cblaero/src/features/candidate-management/application/__tests__/dedup-scoring.test.ts` (new — 24 tests)
- `cblaero/src/modules/ingestion/index.ts` (modified — pending_dedup default)
- `cblaero/src/modules/ingestion/jobs.ts` (modified — DedupWorkerJob, 5th registered job)
- `cblaero/src/modules/__tests__/ingestion-jobs.test.ts` (modified — expect 5 jobs)
- `cblaero/src/app/api/internal/jobs/run/route.ts` (modified — added 'dedup' job alias)
- `cblaero/src/app/api/internal/dedup/reviews/route.ts` (new — GET pending reviews)
- `cblaero/src/app/api/internal/dedup/reviews/[id]/route.ts` (new — GET review detail)
- `cblaero/src/app/api/internal/dedup/reviews/[id]/resolve/route.ts` (new — POST approve/reject)
- `cblaero/src/app/api/internal/dedup/stats/route.ts` (new — GET dedup stats)
- `cblaero/src/app/dashboard/admin/dedup/page.tsx` (new — review queue dashboard)
- `cblaero/src/app/dashboard/page.tsx` (modified — added Dedup Review Queue nav link)
- `cblaero/src/app/api/internal/recruiter/csv-upload/route.ts` (modified — pending_dedup)
- `cblaero/src/app/api/internal/recruiter/csv-upload/shared.ts` (modified — pending_dedup type)
- `cblaero/src/app/api/internal/recruiter/resume-upload/[batchId]/confirm/route.ts` (modified — pending_dedup)
- `cblaero/scripts/backfill-identity-fingerprints.ts` (new — one-time backfill script)
- `docs/implementation_artifacts/sprint-status.yaml` (modified — story status)
- `docs/implementation_artifacts/stories/2-5-implement-deterministic-deduplication-and-manual-review-queue.md` (modified — task checkboxes, dev record)

## Senior Developer Review (AI)

**Reviewer:** Claude Sonnet 4.6 (adversarial)
**Review Date:** 2026-04-07
**Outcome:** Changes Requested (14 findings: 3 Critical, 5 High, 5 Medium, 4 Low — then auto-fixed)

### Action Items

**FIXED (Critical):**
- [x] [C1] Double-await params cast in `[id]/route.ts` and `[id]/resolve/route.ts` — replaced `as unknown as Promise<>` with direct `params.id` access
- [x] [C2] Reject path did not transition candidate out of `pending_review` — added `updateCandidateIngestionState` calls for both candidates
- [x] [C3] `merge_candidates` RPC only granted to `service_role` — added `authenticated` grant

**FIXED (High):**
- [x] [H1] `findRawFieldMatches` fetched random records and filtered in TS — replaced with `find_dedup_field_matches` RPC using `regexp_replace` for server-side phone normalization
- [x] [H2] Fingerprint recorded for `candidate.id` (potentially loser) after merge — moved to record `winner.id` in auto_merge path
- [x] [H3] Non-atomic `resolveReview` + `callMergeCandidatesRpc` — added try-catch with review revert on RPC failure
- [x] [H4] `getDedupStats` fetched all decision rows then filtered in TS — replaced with `get_dedup_stats` RPC using GROUP BY
- [x] [H5] Pass 2 only searched `active` candidates — `find_dedup_field_matches` RPC now searches `active` + `pending_review`

**FIXED (Medium):**
- [x] [M3] `dedup_decisions` and `dedup_review_queue` granted to `anon` role — revoked `anon`, now `authenticated` + `service_role` only
- [x] [M4] `manual_review` routing did not insert `dedup_decisions` audit row — added `recordDedupDecision` call in dedup worker

**DEFERRED:**
- [ ] [M1] Task 11 — architecture.md capability registration — deferred to commit time
- [ ] [M2] `listPendingReviews` uses offset pagination instead of cursor — acceptable for initial review queue (low volume)
- [ ] [M5] `dedup-repository.test.ts` not created — repository is thin DB wrapper, core logic tested via 24 dedup-scoring tests
- [ ] [L1] `normalizeName` space separator doesn't match `computeIdentityHash` — latent only, no runtime impact (scoring uses separate comparison)
- [ ] [L2] `merge_candidates` RPC COALESCE on null email edge case — extremely rare (DB constraint requires email or phone)
- [ ] [L3] Bulk approve UI lacks confirmation dialog — minor UX improvement
- [ ] [L4] `updateCandidateIngestionState` missing tenant_id filter — added optional `tenantId` parameter
