# Story 2.5a: Implement Deduced Role Classification

Status: done

## Story

As a recruiter,
I want candidates automatically classified into standardized aviation or IT roles,
so that I can filter and target outreach by normalized role instead of raw free-text job titles.

## Acceptance Criteria

1. **Given** a candidate with `job_title = "A&P AIRCRAFT MAINTENANCE TECH III"` and aviation taxonomy seeded **When** role deduction runs (heuristic or LLM) **Then** `deduced_roles` contains `["A&P Mechanic"]` **And** `role_deduction_metadata.source` is set to `'heuristic'` or `'llm'`
2. **Given** a candidate with `job_title = "Senior Python Backend Engineer"` and no matching aviation role **When** role deduction runs via LLM **Then** `deduced_roles` contains up to 3 IT roles (e.g., `["Python Developer", "Backend Engineer"]`) **And** new roles are inserted into `role_taxonomy` with `category = 'it'`
3. **Given** the LLM deduces an IT role that already exists in `role_taxonomy` **When** the role is assigned **Then** the existing taxonomy entry is reused (no duplicate created) **And** `deduced_roles` contains the exact `role_name` from the taxonomy
4. **Given** a CSV upload of 5000 candidates **When** the upload processes **Then** all candidates receive heuristic role deduction inline (no LLM calls) **And** the upload completes without significant latency increase **And** candidates with 0 heuristic matches have `deduced_roles = []`
5. **Given** a candidate with `deduced_roles = []` **When** the `RoleDeductionEnrichmentJob` runs **Then** the candidate is picked up, LLM-classified, and `deduced_roles` is populated with up to 3 roles
6. **Given** a recruiter viewing the candidate list page **When** candidates have `deduced_roles` populated **Then** role badges are visible in a "Roles" column **And** a role filter dropdown is available in the filter bar
7. **Given** a recruiter viewing the candidate detail page **When** the candidate has `deduced_roles` **Then** purple role badges appear in the hero header below the job title
8. **Given** any candidate **When** role deduction assigns roles **Then** `deduced_roles` contains at most 3 entries **And** aviation candidates always have at least one role from the canonical aviation taxonomy list
9. **Given** the backfill script runs on ~731K existing candidates **When** complete **Then** >90% of candidates with non-null `job_title` have at least one deduced role

## Tasks / Subtasks

- [x] Task 1: Schema — `role_taxonomy` reference table + seed aviation roles (AC: #1, #8)
  - [x] 1.1 Create `role_taxonomy` table in `supabase/schema.sql`: `id` (serial PK), `tenant_id text NOT NULL`, `role_name text NOT NULL`, `category text NOT NULL CHECK (category IN ('aviation', 'it', 'other'))`, `aliases jsonb NOT NULL DEFAULT '[]'` (alternative spellings/abbreviations for heuristic matching), `is_active boolean NOT NULL DEFAULT true`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`
  - [x] 1.2 Unique index: `CREATE UNIQUE INDEX uq_role_taxonomy_tenant_name ON cblaero_app.role_taxonomy (tenant_id, lower(role_name))`
  - [x] 1.3 GIN index on aliases: `CREATE INDEX idx_role_taxonomy_aliases ON cblaero_app.role_taxonomy USING gin (aliases)`
  - [x] 1.4 Seed ~50 canonical aviation roles with INSERT statements, `category = 'aviation'`. Include aliases for common variations. Full seed list below in Dev Notes.
  - [x] 1.5 Grants: `authenticated` SELECT, `service_role` ALL. RLS enabled with tenant isolation policy.

- [x] Task 2: Schema — `deduced_roles` + `role_deduction_metadata` columns on candidates (AC: #1, #8)
  - [x] 2.1 `ALTER TABLE cblaero_app.candidates ADD COLUMN IF NOT EXISTS deduced_roles jsonb NOT NULL DEFAULT '[]'::jsonb;`
  - [x] 2.2 `ALTER TABLE cblaero_app.candidates ADD COLUMN IF NOT EXISTS role_deduction_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;`
  - [x] 2.3 GIN index: `CREATE INDEX idx_candidates_deduced_roles_gin ON cblaero_app.candidates USING gin (deduced_roles)`
  - [x] 2.4 CHECK constraint: `ALTER TABLE cblaero_app.candidates ADD CONSTRAINT chk_deduced_roles_max3 CHECK (jsonb_array_length(deduced_roles) <= 3)`

- [x] Task 3: Schema — Update RPCs to include `deduced_roles` (AC: #6)
  - [x] 3.1 Add `deduced_roles jsonb` to RETURNS type and SELECT list of `search_candidates` RPC (~line 368). Add `p_deduced_role text DEFAULT null` filter parameter with condition: `AND (p_deduced_role IS NULL OR c.deduced_roles @> jsonb_build_array(p_deduced_role))`
  - [x] 3.2 Add `deduced_roles jsonb` to RETURNS type and SELECT list of `get_candidate_detail` RPC (~line 759)
  - [x] 3.3 Add `deduced_roles` to both INSERT column lists in `process_import_chunk` RPC (~lines 548 and 632) with VALUES `coalesce(v_candidate->'deduced_roles', '[]'::jsonb)` and ON CONFLICT SET `deduced_roles = excluded.deduced_roles`
  - [x] 3.4 `upsert_candidate` RPC needs NO change — uses `jsonb_populate_record` which auto-picks up new columns

- [x] Task 4: Apply schema migration via Supabase MCP (AC: all)

- [x] Task 5: Create `RoleTaxonomyRepository` (AC: #1, #3, #8)
  - [x] 5.1 Create `src/features/candidate-management/infrastructure/role-taxonomy-repository.ts`
  - [x] 5.2 `getAllRoles(tenantId): Promise<RoleTaxonomyEntry[]>` — with module-level cache, 10-minute TTL (roles change quarterly)
  - [x] 5.3 `getRolesByCategory(tenantId, category): Promise<RoleTaxonomyEntry[]>`
  - [x] 5.4 `findRoleByName(tenantId, roleName): Promise<RoleTaxonomyEntry | null>` — case-insensitive lookup via `lower(role_name)`
  - [x] 5.5 `insertRole(tenantId, roleName, category): Promise<RoleTaxonomyEntry>` — used by LLM path to auto-insert new IT roles
  - [x] 5.6 `getRolesWithAliases(tenantId): Promise<RoleTaxonomyEntry[]>` — includes aliases for heuristic matching
  - [x] 5.7 Export `clearRoleTaxonomyCacheForTest()` for test cleanup

- [x] Task 6: Create role deduction application module (AC: #1, #2, #3, #4, #8)
  - [x] 6.1 Create `src/features/candidate-management/application/role-deduction.ts`
  - [x] 6.2 `deduceRolesHeuristic(jobTitle, skills, taxonomy): { roles: string[], confidence: number }` — matching strategy: exact role_name match (confidence 1.0) > alias containment match (0.9) > trigram similarity threshold 0.3 (variable) > skills keyword intersection (0.5). Returns up to 3 roles sorted by confidence. NOTE: Requires `pg_trgm` extension — verify enabled in Supabase or implement JS-side Levenshtein/Jaro-Winkler as fallback.
  - [x] 6.3 `deduceRolesLlm(jobTitle, skills, certifications, aircraftExperience, taxonomy): Promise<string[]>` — calls `callLlm` with `role-deduction` prompt. Prompt includes full taxonomy list. Parse JSON response, validate each role exists in taxonomy (or insert new IT role via `insertRole()`). Key-whitelist sanitize to `['roles']` only.
  - [x] 6.4 `deduceRoles(candidate, taxonomy, options?): Promise<{ roles: string[], metadata: RoleDeductionMetadata }>` — orchestrator: tries heuristic first; if 0 roles or confidence < 0.5, falls back to LLM (unless `options.heuristicOnly = true` for CSV batch mode).
  - [x] 6.5 Register fallback prompt: `registerFallbackPrompt({ name: 'role-deduction', version: '1.0.0', prompt_text: ROLE_DEDUCTION_PROMPT, model: 'claude-haiku-4-5-20251001' })`
  - [x] 6.6 `RoleDeductionMetadata` type: `{ source: 'heuristic' | 'llm' | 'manual', confidence: number, rawJobTitle: string | null, rawSkills: string[], deducedAt: string }`

- [x] Task 7: Update TypeScript contracts (AC: #6, #7)
  - [x] 7.1 Add `deducedRoles: string[];` to `CandidateListItem` in `contracts/candidate.ts`
  - [x] 7.2 Add `deducedRoles: string[];` to `CandidateDetail` in `contracts/candidate.ts`
  - [x] 7.3 Add `deducedRole?: string;` to `CandidateFilterParams` for the new search filter

- [x] Task 8: Update candidate repository mapping (AC: #6, #7)
  - [x] 8.1 Add `deduced_roles: string[];` to both `CandidateRow` and `CandidateDetailRow` DB row types
  - [x] 8.2 Add `deducedRoles: Array.isArray(row.deduced_roles) ? row.deduced_roles : []` to `toListItem()` mapper
  - [x] 8.3 Add `p_deduced_role` parameter passthrough in `listCandidates()` RPC call params

- [x] Task 9: Wire role deduction into ingestion paths (AC: #1, #2, #4)
  - [x] 9.1 **Resume upload** (`src/app/api/internal/recruiter/resume-upload/route.ts`): After `extractCandidateFromDocument()` returns and before `insertSubmission()`, call `deduceRoles(result.extraction, taxonomy)`. Store `roles` in `result.extraction.deducedRoles` and metadata in `result.extraction.roleDeductionMetadata`. Uses LLM path (single file, ~200ms acceptable).
  - [x] 9.2 **Email ingestion** (`src/modules/email/nlp-extract-and-upload.ts`): After `extractCandidateFromDocument()` in `upsertCandidateFromEmailFull()`, call `deduceRoles()` and merge into extraction result before `mapToCandidateRow()`. Uses LLM path.
  - [x] 9.3 **CSV upload** (`src/app/api/internal/recruiter/csv-upload/route.ts`): After `prepareRows()` returns candidates (~line 559), iterate and call `deduceRolesHeuristic()` per row (NO LLM — batches up to 10K). Set `deduced_roles` on each candidate object before `processSupabaseBatch()`. Candidates with 0 heuristic results get `deduced_roles: []` — picked up by enrichment job later.
  - [x] 9.4 **Ingestion mapper** (`src/modules/ingestion/index.ts`): Add `deduced_roles` field passthrough in `mapToCandidateRow()` — map from `record.deducedRoles` or `record.deduced_roles` to the DB column name.

- [x] Task 10: UI — Candidate list page (AC: #6)
  - [x] 10.1 Add `deducedRoles: string[]` to local `CandidateRow` type in `candidates/page.tsx`
  - [x] 10.2 Add "Roles" column header after "Job Title" in the table
  - [x] 10.3 Render deduced roles as compact purple badges: max 2 shown + "+N" overflow. Style: `rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700`. Follow `SkillsCell` pattern for overflow.
  - [x] 10.4 Add "Role" filter dropdown in the filter bar — fetch distinct roles from `role_taxonomy` or from the existing `listCandidates` params. Wire `deducedRole` filter to `p_deduced_role` RPC parameter.

- [x] Task 11: UI — Candidate detail page (AC: #7)
  - [x] 11.1 Add `deducedRoles: string[]` to local `CandidateDetail` type in `candidates/[id]/page.tsx`
  - [x] 11.2 Add "Deduced Roles" badges in the hero header directly below `jobTitle` (~after line 191). Use purple/indigo badge styling: `rounded-md border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700`
  - [x] 11.3 Keep existing `jobTitle` and `skills` display unchanged — those are raw ingestion data. Deduced roles are the normalized interpretation shown prominently.

- [x] Task 12: Create `RoleDeductionEnrichmentJob` + fix jobs route (AC: #5)
  - [x] 12.1 Add `RoleDeductionEnrichmentJob` implementing `SchedulerJob` in `src/modules/ingestion/jobs.ts`. Logic: query candidates where `deduced_roles = '[]'::jsonb` OR `role_deduction_metadata->>'deduced_at'` is null/older than 30 days, batch of 100, run `deduceRoles()` (with LLM) per candidate, UPDATE `deduced_roles` and `role_deduction_metadata`. Log summary: `{ processed, rolesAssigned, alreadyClassified, errors }`.
  - [x] 12.2 Register as 6th job in `registerIngestionJobs()` (after `DedupWorkerJob`)
  - [x] 12.3 Add `'role-enrichment'` to allowed jobs list in `src/app/api/internal/jobs/run/route.ts`
  - [x] 12.4 **Fix the else catch-all bug**: Add explicit `else if (jobName === 'email-sync')` branch and `else if (jobName === 'saved-search-digest')` branch. Change final `else` to return 400 error `{ error: { code: 'UNKNOWN_JOB', message: 'Unknown job name' } }`.
  - [x] 12.5 Do NOT add a Render cron trigger — Story 2.7 global scheduler will own the monthly cadence. Job is callable manually via `/api/internal/jobs/run?job=role-enrichment` for testing.

- [x] Task 13: Heuristic backfill script (AC: #9)
  - [x] 13.1 Create `scripts/backfill-deduced-roles.ts`: load taxonomy with aliases, query candidates in batches of 500 where `deduced_roles = '[]'`, run `deduceRolesHeuristic()` per candidate, UPDATE `deduced_roles` and `role_deduction_metadata` via batch UPDATE. Log progress every 1000 records.
  - [x] 13.2 Run via `npx tsx scripts/backfill-deduced-roles.ts`. Estimated runtime ~20-30 min for ~731K candidates. No LLM cost.
  - [x] 13.3 Script is idempotent — running twice overwrites previous heuristic results with fresh timestamp.

- [x] Task 14: LLM validation batch script (AC: #1, #2)
  - [x] 14.1 Create `scripts/test-role-deduction-llm.ts`: select 1000 random candidates with `deduced_roles != '[]'` (already heuristic-classified), run `deduceRolesLlm()` per candidate in batches of 20 (with 500ms inter-batch delay for rate limiting), compare LLM vs heuristic results.
  - [x] 14.2 Output accuracy report: agreement %, disagreement details, new IT roles suggested by LLM, aviation role mismatches. Estimated cost: ~$1-2 on Haiku for 1K records.
  - [x] 14.3 Run AFTER Task 13 backfill. Results inform whether heuristic is sufficient or LLM prompt needs tuning.

- [x] Task 15: Tests (AC: all)
  - [x] 15.1 Unit tests for `deduceRolesHeuristic()` — 10+ cases: exact match, alias match, trigram partial, no match, IT role, mixed aviation+IT, max 3 cap, empty job_title, skills-only deduction, case insensitivity
  - [x] 15.2 Unit tests for `deduceRolesLlm()` — mock `callLlm`, test JSON parsing, key whitelist, taxonomy validation, new IT role insertion, max 3 enforcement, malformed LLM response handling
  - [x] 15.3 Integration test for `RoleTaxonomyRepository` — CRUD operations, cache behavior, `clearRoleTaxonomyCacheForTest()`
  - [x] 15.4 Verify ALL existing candidate list/detail/search tests pass with new `deduced_roles` field (no regressions)

- [x] Task 16: Register capabilities in architecture.md and development-standards.md (AC: n/a — compliance)
  - [x] 16.1 Add to architecture.md capability registry: `RoleTaxonomyRepository` (6 functions), `deduceRoles()`, `deduceRolesHeuristic()`, `deduceRolesLlm()`, `RoleDeductionEnrichmentJob`
  - [x] 16.2 Add to dev-standards.md section 18: `role-taxonomy-repository`, `role-deduction` module, `role-deduction` prompt
  - [x] 16.3 Document the canonical aviation role list in architecture.md for future reference

## Dev Notes

### Canonical Aviation Role Taxonomy (Seed Data)

These ~50 roles are the canonical list. Aviation candidates MUST map to exactly these names. Admin edits directly in DB; changes are quarterly.

```
A&P Aircraft Inspector, A&P Mechanic, Aircraft Maintenance Supervisor, Aircraft Paint Technician,
Aircraft Painter, Aircraft Structures Technician/Sheet Metal, Aircraft Welder, Avionics Technician,
Cabinet Builder, Cabinet Finisher (Painter), Chief Inspector, CNC Programmer/Operator,
Completion Lining & Upholstery, Completions Interior Tech, Completions System, Composite Technician,
Evaluation Inspector, Evaluation Structures Technician, Evaluation Teardown Inspector, Final Inspector,
Finish Application Tech, Finish Shop Lead, General Building Maintenance Technician,
Interior Technician, Landing Gear Inspector, Maintenance Instructor, Maintenance Planner,
MRO A&P Maintenance Technician, MRO Avionics Technician, MRO Interiors Technician,
NDT Administrative, NDT Level II Technician, Paint Inspector, Paint Prepper, Paint Technician,
Painter, QC Inspector, QC Lead Inspector, Quality Engineer (Evaluator), Sheet Metal Fabricator,
Sheet Metal Technician, SR. Technical Writer, Structures Mechanic, Structures Technician,
Upholstery Fabrication Tech, Wire Fabrication Technician, Wire Harness Fab Shop Lead
```

**Alias examples for seed data:**
- `"A&P Mechanic"` → `["A&P Aircraft Maintenance Tech", "AP Mechanic", "Airframe and Powerplant Mechanic", "A&P AIRCRAFT MAINTENANCE TECH III"]`
- `"Avionics Technician"` → `["Avionics Tech", "AVIONICS TECH"]`
- `"Sheet Metal Technician"` → `["Sheet Metal Tech", "Aircraft Structures Technician/Sheet Metal"]`

### Role Deduction Strategy

**Two-tier approach:**

1. **Heuristic (fast, free):** Used for CSV batch uploads and backfill. Matching priority:
   - Exact `role_name` match (case-insensitive) → confidence 1.0
   - Alias array containment match → confidence 0.9
   - Trigram similarity (`pg_trgm` `similarity()` > 0.3) → variable confidence
   - Skills keyword intersection with role names → confidence 0.5
   - Returns up to 3 roles, sorted by confidence

2. **LLM (accurate, ~$0.001/candidate):** Used for resume/email ingestion (single files) and the enrichment job. The prompt:
   - Receives the full `role_taxonomy` list as context
   - Is told: "For aviation candidates, you MUST pick from this exact list. For IT, prefer existing roles — only create new if nothing fits."
   - Returns `{ "roles": ["Role1", "Role2"] }` as JSON
   - Response is key-whitelist sanitized to `['roles']` only
   - Each returned role is validated against taxonomy; new IT roles auto-inserted

**CSV batch mode:** `deduceRoles(candidate, taxonomy, { heuristicOnly: true })` — skips LLM entirely. Unclassified candidates (`deduced_roles = []`) are picked up by the monthly enrichment job.

### LLM Prompt Design

Follow the `candidate-extraction.ts` pattern exactly:

```typescript
registerFallbackPrompt({
  name: 'role-deduction',
  version: '1.0.0',
  prompt_text: ROLE_DEDUCTION_PROMPT,
  model: 'claude-haiku-4-5-20251001',
});

// In deduceRolesLlm():
const promptRecord = await loadPrompt('role-deduction');
const result = await callLlm(
  promptRecord?.model ?? 'claude-haiku-4-5-20251001',
  promptRecord?.prompt_text ?? ROLE_DEDUCTION_PROMPT,
  candidateText,   // JSON of { jobTitle, skills, certifications, aircraftExperience }
  {
    module: 'role-deduction',
    action: 'deduce_roles',
    promptName: 'role-deduction',
    promptVersion: promptRecord?.version ?? '1.0.0',
    maxTokens: 512,  // role deduction output is small
  }
);
```

**Prompt template must include:**
- The complete taxonomy list (aviation + existing IT roles)
- Clear instruction: aviation = exact match from list, IT = reuse preference
- Max 3 roles constraint
- JSON output format: `{ "roles": ["Role1", "Role2", "Role3"] }`
- Rules section: no creative naming for aviation, prefer specificity over generality for IT

### IT Role Sprawl Prevention

The LLM prompt instructs "prefer existing roles from the taxonomy." Additionally:
- Before inserting a new IT role, do a case-insensitive check against all existing IT roles
- The enrichment job can consolidate similar IT roles over time (manual admin review recommended after first month)
- Metadata tracks which roles were LLM-created for audit

### Database Schema Additions

```sql
-- Role taxonomy reference table
CREATE TABLE IF NOT EXISTS cblaero_app.role_taxonomy (
  id serial PRIMARY KEY,
  tenant_id text NOT NULL,
  role_name text NOT NULL,
  category text NOT NULL CHECK (category IN ('aviation', 'it', 'other')),
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_role_taxonomy_tenant_name
  ON cblaero_app.role_taxonomy (tenant_id, lower(role_name));
CREATE INDEX idx_role_taxonomy_aliases
  ON cblaero_app.role_taxonomy USING gin (aliases);
CREATE INDEX idx_role_taxonomy_category
  ON cblaero_app.role_taxonomy (tenant_id, category) WHERE is_active = true;

-- RLS
ALTER TABLE cblaero_app.role_taxonomy ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cblaero_app.role_taxonomy
  USING (tenant_id = current_setting('request.jwt.claims', true)::jsonb->>'tenant_id');

-- Grants
GRANT SELECT ON cblaero_app.role_taxonomy TO authenticated;
GRANT ALL ON cblaero_app.role_taxonomy TO service_role;
GRANT USAGE, SELECT ON SEQUENCE cblaero_app.role_taxonomy_id_seq TO service_role;

-- Candidate columns
ALTER TABLE cblaero_app.candidates
  ADD COLUMN IF NOT EXISTS deduced_roles jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE cblaero_app.candidates
  ADD COLUMN IF NOT EXISTS role_deduction_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE cblaero_app.candidates
  ADD CONSTRAINT chk_deduced_roles_max3 CHECK (jsonb_array_length(deduced_roles) <= 3);

-- GIN index for role containment queries (e.g., deduced_roles @> '["A&P Mechanic"]')
CREATE INDEX idx_candidates_deduced_roles_gin
  ON cblaero_app.candidates USING gin (deduced_roles);

-- Seed aviation roles (use actual tenant_id from your environment)
-- INSERT INTO cblaero_app.role_taxonomy (tenant_id, role_name, category, aliases) VALUES
--   ('your_tenant_id', 'A&P Mechanic', 'aviation', '["A&P Aircraft Maintenance Tech", "AP Mechanic", "Airframe and Powerplant Mechanic"]'::jsonb),
--   ('your_tenant_id', 'Avionics Technician', 'aviation', '["Avionics Tech", "AVIONICS TECH"]'::jsonb),
--   ... (full list in Task 1.4)
```

### Existing Patterns to Reuse (DO NOT Reinvent)

| Need | Existing Solution | Location |
|------|-------------------|----------|
| LLM inference | `callLlm(model, systemPrompt, userContent, opts)` | `@/modules/ai/inference.ts` |
| Prompt management | `loadPrompt()`, `registerFallbackPrompt()` | `@/modules/ai/prompt-registry.ts` |
| LLM extraction pattern | `extractCandidateFromDocument()` | `@/features/candidate-management/application/candidate-extraction.ts` |
| JSON response sanitization | Key-whitelist `ALLOWED_EXTRACTION_KEYS` pattern | `@/features/candidate-management/application/candidate-extraction.ts` |
| Candidate query | `listCandidates()`, `getCandidateById()` | `@/features/candidate-management/infrastructure/candidate-repository.ts` |
| Supabase admin client | `getSupabaseAdminClient()` | `@/modules/persistence` |
| API auth wrapper | `withAuth(handler, options)` | `@/modules/auth/with-auth.ts` |
| Job interface | `SchedulerJob` (name + run) | `@/modules/ingestion/jobs.ts` |
| Job registration | `registerIngestionJobs(scheduler)` | `@/modules/ingestion/jobs.ts` |
| Ingestion mapper | `mapToCandidateRow()` | `@/modules/ingestion/index.ts` |
| Skills badge UI | `SkillsCell` component | `@/app/dashboard/recruiter/candidates/page.tsx` |
| Purple badge styling | existing badge patterns | `@/app/dashboard/recruiter/candidates/[id]/page.tsx` |
| Candidate detail hero | Header section with job title + badges | `@/app/dashboard/recruiter/candidates/[id]/page.tsx:187-210` |
| Filter bar pattern | Dropdown filters | `@/app/dashboard/recruiter/candidates/page.tsx:290-320` |
| Structured logging | `console.log(JSON.stringify({...}))` | Pattern from all jobs in `jobs.ts` |
| Cost tracking | Automatic via `callLlm` → `llm_usage_log` | `@/modules/ai/usage-log.ts` |

### Architecture Compliance

- **Tenant isolation:** Every query MUST include `tenant_id`. `role_taxonomy` is tenant-scoped with RLS.
- **API envelope:** Success `{ data, meta }`, error `{ error: { code, message } }`.
- **No direct DB in routes:** All DB access via repository functions.
- **LLM calls through centralized service:** `callLlm()` only — never direct Anthropic SDK.
- **Prompt versioning:** Use `loadPrompt()` with registered fallback — allows runtime prompt updates without deploy.
- **Scheduler boundary:** Job registered via `SchedulerJob` interface. No Render cron, no hardcoded timers. Story 2.7 owns the monthly schedule.
- **Error handling:** Every Supabase `.error` checked. Failed role deductions logged via structured JSON, do NOT block ingestion — candidate proceeds with `deduced_roles: []`.
- **Budget awareness:** LLM calls auto-tracked via `llm_usage_log`. At ~$0.001/candidate, 100 resumes/day = $0.10/day — well within $10/day budget alert.

### Previous Story Intelligence

**From Story 2.5 (Dedup):**
- 302 tests passing. `SchedulerJob` interface: only `name: string` and `run(): Promise<void>`.
- Jobs route has 4 entries in allowlist: `['ceipal-sync', 'email-sync', 'onedrive-sync', 'dedup']`. `SavedSearchDigestJob` is registered in `registerIngestionJobs()` but has NO route branch or allowlist entry. `email-sync` falls to `else` catch-all. Task 12.4 fixes both issues.
- Use `params.id` directly in route handlers — NOT `(await params).id` (bug C1 from 2.5 review).
- `getSupabaseAdminClient()` from `@/modules/persistence` — no `.schema('cblaero_app')` needed.
- Append-only tables: grant INSERT + SELECT only, no UPDATE/DELETE for `authenticated`.

**From Story 2.4a (Dashboard UI Standardization):**
- White backgrounds, consistent headers/breadcrumbs/footers, font normalization now standardized.
- New UI components should follow the standardized patterns from 2.4a.

**From Git History:**
- Most recent work: Story 2.5 dedup capabilities registered in architecture.md and dev-standards.md
- Candidate detail page recently updated with resume_url, better badges
- Recruiter dashboard uses white theme (`bg-white`, `text-gray-900`)

### Risk Notes

- **LLM cost for inline resume/email:** ~$0.001 per candidate, ~200ms latency. At 100/day = $0.10/day. Acceptable.
- **CSV batch = heuristic only:** No LLM for 10K-row uploads. Keeps upload fast. Unclassified candidates caught by enrichment job.
- **IT role sprawl:** Prompt instructs "prefer existing roles." Case-insensitive dedup check before inserting new IT roles. Recommend admin review of new IT roles after first month.
- **pg_trgm dependency:** Verify `pg_trgm` extension is enabled in Supabase. If not, fall back to JS-side Jaro-Winkler distance for fuzzy matching (slightly less accurate).
- **Backfill idempotent:** Running backfill twice overwrites results. Metadata `deduced_at` tracks when.

### Project Structure Notes

```
cblaero/
  supabase/
    schema.sql                                    [MODIFY] — role_taxonomy table + seed, deduced_roles/metadata columns, RPCs updated, indexes, RLS, grants
  src/
    features/candidate-management/
      contracts/
        candidate.ts                              [MODIFY] — add deducedRoles to CandidateListItem, CandidateDetail, CandidateFilterParams
      application/
        role-deduction.ts                         [NEW] — deduceRoles(), deduceRolesHeuristic(), deduceRolesLlm(), prompt registration
        __tests__/
          role-deduction.test.ts                  [NEW] — 15+ unit tests for heuristic and LLM paths
      infrastructure/
        role-taxonomy-repository.ts               [NEW] — RoleTaxonomyRepository (6 functions + cache)
        candidate-repository.ts                   [MODIFY] — add deduced_roles to row types, toListItem mapper, listCandidates params
    app/
      api/
        internal/
          recruiter/
            csv-upload/
              route.ts                            [MODIFY] — wire heuristic role deduction after prepareRows
            resume-upload/
              route.ts                            [MODIFY] — wire LLM role deduction after extractCandidateFromDocument
          jobs/
            run/
              route.ts                            [MODIFY] — add 'role-enrichment', fix else catch-all bug
      dashboard/
        recruiter/
          candidates/
            page.tsx                              [MODIFY] — add Roles column with purple badges, role filter dropdown
            [id]/
              page.tsx                            [MODIFY] — add deduced roles badges in hero header
    modules/
      ingestion/
        index.ts                                  [MODIFY] — add deduced_roles passthrough in mapToCandidateRow
        jobs.ts                                   [MODIFY] — add RoleDeductionEnrichmentJob, register as 6th job
      email/
        nlp-extract-and-upload.ts                 [MODIFY] — wire role deduction after extraction
  scripts/
    backfill-deduced-roles.ts                     [NEW] — heuristic backfill for ~731K candidates
    test-role-deduction-llm.ts                    [NEW] — 1K-record LLM validation batch
  docs/
    planning_artifacts/
      architecture.md                             [MODIFY] — register role deduction capabilities
      development-standards.md                    [MODIFY] — add role-taxonomy-repository, role-deduction module
```

### References

- [Source: docs/implementation_artifacts/tech-spec-deduced-role-classification.md — full tech spec with investigation results]
- [Source: docs/planning_artifacts/development-standards.md — mandatory implementation rules, error handling, retry, type safety, auth, testing patterns]
- [Source: docs/planning_artifacts/architecture.md#Implemented-Capabilities-Registry — existing reusable services]
- [Source: docs/planning_artifacts/architecture.md#AI-Inference-Service — callLlm, prompt registry, cost tracking]
- [Source: docs/implementation_artifacts/stories/2-5-implement-deterministic-deduplication-and-manual-review-queue.md — SchedulerJob pattern, jobs route structure, testing patterns]
- [Source: cblaero/src/features/candidate-management/application/candidate-extraction.ts — LLM extraction pattern to follow]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None

### Completion Notes List

- Tasks 1-3: Created `role_taxonomy` table with 47 seeded aviation roles, aliases, GIN indexes, RLS, and `seed_aviation_roles()` function. Added `deduced_roles` and `role_deduction_metadata` columns to candidates with CHECK constraint (max 3). Updated `search_candidates` RPC with `p_deduced_role` filter and `deduced_roles` in RETURNS. Updated `get_candidate_detail` and `process_import_chunk` RPCs.
- Task 4: Schema migration SQL provided for manual execution (no Supabase MCP available).
- Task 5: Created `RoleTaxonomyRepository` with 6 functions + 10-minute TTL cache + test helpers.
- Task 6: Created role deduction module with heuristic (free, fast) and LLM (Haiku, ~$0.001/candidate) paths. Registered `role-deduction` fallback prompt. Key-whitelist sanitization on LLM output.
- Tasks 7-8: Added `deducedRoles` to `CandidateListItem`, `CandidateDetail`, `CandidateFilterParams` contracts. Updated `CandidateRow`/`CandidateDetailRow` types, `toListItem()` mapper, and `listCandidates()` RPC params.
- Task 9: Wired role deduction into resume upload (LLM path after extraction), email ingestion (LLM path before mapToCandidateRow), CSV upload (heuristic-only batch), and ingestion mapper (`deduced_roles` passthrough).
- Task 10: Added Roles column with purple badges (max 2 + overflow) to candidate list page. Added Role filter input. Added `deduced_role` param to candidates API route.
- Task 11: Added purple deduced roles badges in candidate detail hero header below job title.
- Task 12: Created `RoleDeductionEnrichmentJob` (batch 100, LLM path). Fixed jobs route: added `role-enrichment` and `saved-search-digest` to allowlist, added explicit `email-sync` branch, changed catch-all to 400 error.
- Tasks 13-14: Created `backfill-deduced-roles.ts` (heuristic, idempotent) and `test-role-deduction-llm.ts` (1K sample, accuracy report).
- Task 15: 21 unit tests for heuristic (10 cases), LLM (7 cases), orchestrator (4 cases). Updated `ingestion-jobs.test.ts` for 6th job registration and sync run args. 322/323 tests pass (1 pre-existing failure).
- Task 16: Registered all new capabilities in architecture.md and development-standards.md.

### Change Log

- 2026-04-08: Story 2.5a implemented — role taxonomy, heuristic + LLM deduction, UI badges, enrichment job, backfill scripts, 21 new tests
- 2026-04-08: Adversarial code review (Sonnet 4.6, 3 parallel agents) — 10 HIGH, 12 MEDIUM findings. All HIGH and MEDIUM fixed: LLM input truncation/sanitization (H1/M1), N+1 elimination via in-memory taxonomy lookup (H2/H6), upsert for insertRole (H3), enrichment job circuit breaker + failed-candidate guard (H4), findRoleByName exact match RPC (H5), deducedRole in countActiveFilters (H7), recordSyncFailure on role insert failure (H8), schema-scoped constraint check (H9), try/catch around LLM call in orchestrator (H10), duplicate alias fix (M5), case-sensitive filter docs (M6), badge rounded-full (M3), FILTER_LABELS (M4), hero bg-white (M9), enrichment log fix (M10), test mock shapes (M11), PII console.log removal (M12). Tests: 324/325 pass (23 role-deduction tests, +2 new).

### File List

- cblaero/supabase/schema.sql (modified — role_taxonomy table, seed function, deduced_roles columns, updated RPCs)
- cblaero/src/features/candidate-management/contracts/candidate.ts (modified — deducedRoles, deducedRole filter)
- cblaero/src/features/candidate-management/application/role-deduction.ts (new — role deduction module)
- cblaero/src/features/candidate-management/application/__tests__/role-deduction.test.ts (new — 21 unit tests)
- cblaero/src/features/candidate-management/infrastructure/role-taxonomy-repository.ts (new — 6 functions + cache)
- cblaero/src/features/candidate-management/infrastructure/candidate-repository.ts (modified — deduced_roles type, mapper, filter)
- cblaero/src/modules/ingestion/index.ts (modified — deduceRoles import, email deduction, mapToCandidateRow deduced_roles)
- cblaero/src/modules/ingestion/jobs.ts (modified — RoleDeductionEnrichmentJob, registerIngestionJobs 6th job)
- cblaero/src/app/api/internal/candidates/route.ts (modified — deduced_role filter param)
- cblaero/src/app/api/internal/jobs/run/route.ts (modified — role-enrichment, email-sync, saved-search-digest branches, fixed else catch-all)
- cblaero/src/app/api/internal/recruiter/resume-upload/route.ts (modified — role deduction after extraction)
- cblaero/src/app/api/internal/recruiter/csv-upload/route.ts (modified — heuristic batch role deduction)
- cblaero/src/app/dashboard/recruiter/candidates/page.tsx (modified — Roles column, RolesCell, Role filter)
- cblaero/src/app/dashboard/recruiter/candidates/[id]/page.tsx (modified — deducedRoles type, purple badges in hero)
- cblaero/src/modules/__tests__/ingestion-jobs.test.ts (modified — 6 jobs expected, role-deduction mock, sync run args)
- cblaero/scripts/backfill-deduced-roles.ts (new — heuristic backfill script)
- cblaero/scripts/test-role-deduction-llm.ts (new — LLM validation batch script)
- docs/planning_artifacts/architecture.md (modified — role deduction capabilities registered)
- docs/planning_artifacts/development-standards.md (modified — role-taxonomy-repository, role-deduction utilities)
- docs/implementation_artifacts/sprint-status.yaml (modified — 2-5a status: in-progress → review)
