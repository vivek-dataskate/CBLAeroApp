# Story 1.9a: AI Cost Dashboard and Prompt Deployment Gates

Status: done

## Story

As a delivery head / admin,
I want a cost dashboard showing daily/weekly LLM token usage and spending, plus controlled prompt version rollouts,
so that I can monitor AI costs, set budget alerts, and safely deploy new prompt versions without risking production quality.

## Acceptance Criteria

1. **Given** the `llm_usage_log` table (populated by `callLlm()` from Story 1.9)
   **When** an admin views the AI cost dashboard
   **Then** they see: total tokens (input/output), estimated cost, call count — grouped by day, model, and prompt name

2. **Given** daily cost data
   **When** estimated spend exceeds a configurable threshold (e.g., $10/day)
   **Then** a structured log alert is emitted: `{ level: 'warn', module: 'ai', action: 'budget_alert', dailyCostUsd, threshold }`

3. **Given** an admin wants to deploy a new prompt version
   **When** they insert a new version into `prompt_registry`
   **Then** the system supports staged rollout: new version is used for new calls only while old version remains active for comparison

4. **Given** two prompt versions running in parallel
   **When** the admin views the dashboard
   **Then** they see side-by-side fill rate and cost comparison for each version

5. **Given** an old prompt version
   **When** the delivery head approves retirement
   **Then** the version is marked deprecated (not deleted — append-only) and `loadPrompt()` stops returning it

## Tasks / Subtasks

- [x] Create admin API route: `GET /api/internal/admin/ai-usage` (AC: 1)
  - [x] Query `llm_usage_log` grouped by day, model, prompt_name
  - [x] Return: `{ daily: [{ date, model, promptName, callCount, inputTokens, outputTokens, estimatedCostUsd }], totals: { ... } }`
  - [x] Support query params: `?days=7` (default), `?model=`, `?promptName=`

- [x] Create `AiCostDashboard` UI component (AC: 1, 4)
  - [x] Add to admin dashboard page
  - [x] Show daily cost chart (bar chart by day, stacked by model)
  - [x] Show per-prompt version fill rate comparison table
  - [x] Show total spend summary card

- [x] Implement budget threshold alerting (AC: 2)
  - [x] Add `ai_budget_threshold_usd` to tenant/system config (default: $10/day)
  - [x] In `recordLlmUsage()` or a lightweight check: sum today's cost, warn if threshold exceeded
  - [x] Log structured alert; optionally integrate with Teams notification (future)

- [x] Add prompt version lifecycle management (AC: 3, 5)
  - [x] Add `status` column to `prompt_registry`: `active` | `staged` | `deprecated` (default: `active`)
  - [x] Update `loadPrompt()` to filter by `status != 'deprecated'`
  - [x] Add admin route: `POST /api/internal/admin/prompt-registry` with `{ name, version, status }`
  - [x] Staged rollout: new version inserted as `staged`, admin promotes to `active` after review

- [x] Write tests
  - [x] Unit tests for usage aggregation query
  - [x] Unit tests for budget threshold logic
  - [x] Unit tests for prompt deprecation filtering
  - [x] Integration test for dashboard API route

## Dev Notes

### What already exists (from Story 1.9)
- `modules/ai/inference.ts` — `callLlm()` returns `inputTokens`, `outputTokens`, `estimatedCostUsd`
- `modules/ai/usage-log.ts` — `recordLlmUsage()` persists every call to `llm_usage_log` table
- `modules/ai/prompt-registry.ts` — `loadPrompt()` with DB + fallback + 5min cache
- `prompt_registry` table — append-only, `(name, version)` unique
- `llm_usage_log` table — per-call token counts, cost, model, prompt attribution
- Model pricing map in inference.ts: Haiku $0.80/$4.00, Sonnet $3.00/$15.00 per 1M tokens

### Architecture constraints
- Dashboard should use `withAuth()` middleware (Story 1.10) once available — until then, use existing admin auth pattern
- Budget alerts are log-based initially; Teams integration deferred to Story 6.x
- Prompt deployment gates follow architecture.md §Resilience §13 — 30-day co-existence, version badge in UI

### References
- [Source: docs/planning_artifacts/architecture.md — Resilience §13 Prompt Registry, §AI Inference Service]
- [Source: docs/planning_artifacts/development-standards.md — §19 Cost Optimization, §22 Prompt Versioning]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Full test suite: 35 files, 269 tests — all pass, zero regressions
- Supabase migrations applied: `add_prompt_registry_status_and_usage_indexes`, `add_prompt_registry_status_check_constraint`

### Completion Notes List

- Created `usage-repository.ts` with `getAggregatedUsage()` — aggregates `llm_usage_log` by day/model/promptName/promptVersion with in-memory test support
- Created `budget-alert.ts` with `checkBudgetThreshold()` and `maybeCheckBudgetProactive()` — checks daily spend against configurable threshold, emits structured JSON warn log when exceeded, proactive sampling every 50 LLM calls
- Extended `prompt-registry.ts` with `deprecatePrompt()`, `updatePromptStatus()`, `listPromptVersions()` — full lifecycle management (active/staged/deprecated)
- Updated `loadPrompt()` to return only `active` prompts for unversioned calls; pinned-version calls exclude `deprecated` only
- Created `GET /api/internal/admin/ai-usage` route — returns aggregated usage, totals, and budget status with admin auth
- Created `GET/POST /api/internal/admin/prompt-registry` route — list versions and update prompt status with admin auth
- Created `AiCostDashboard` client component — CSS bar chart by day/model, summary cards, budget alert banner, prompt version comparison table
- Added `AiCostDashboard` to admin dashboard page
- Added `status` column to `prompt_registry` table with CHECK constraint and migrations applied to Supabase
- Added 3 new protected actions to authorization module: `admin:read-ai-usage`, `admin:read-prompt-registry`, `admin:manage-prompt-registry`
- Granted `delivery-head` role access to AI dashboard (read-only)
- Tests: 8 usage-repository, 5 budget-alert, 6 prompt-lifecycle, 7 route integration = 26 new tests

### Senior Developer Review (AI)

**Reviewer:** Claude Sonnet 4.6 (adversarial review, different model from implementor)
**Review Date:** 2026-04-03
**Review Outcome:** Changes Requested → All Fixed

#### Action Items

- [x] [H1] Budget alert double-filter with fragile midnight boundary logic — simplified to use totals directly
- [x] [H2] Dead session null check in ai-usage route — removed unreachable code
- [x] [H3] Aggregation groups by (date, model, prompt_name) but NOT prompt_version — added version to group key
- [x] [M1] Budget threshold hardcoded at $10 — acceptable (parameter-based), proactive check added
- [x] [M2] Budget check only fires on dashboard page load — added `maybeCheckBudgetProactive()` in `recordLlmUsage()` (sampled every 50 calls)
- [x] [M3] `loadPrompt()` returns staged prompts in production — changed to `.eq('status', 'active')` for unversioned calls
- [x] [M4] No CHECK constraint on prompt_registry.status column — added CHECK + migration applied
- [x] [M5] No test for staged prompt behavior — added version comparison test and extended prompt lifecycle tests
- [x] [L1] delivery-head role locked out of AI dashboard — granted `admin:read-ai-usage` and `admin:read-prompt-registry`
- [x] [L2] Silent catch in loadPrompt swallows DB errors — added console.warn logging
- [x] [L4] Unguarded `data as PromptRecord` cast — added shape validation before constructing record

### Change Log

- 2026-04-03: Story 1.9a implemented — AI cost dashboard, budget alerts, prompt lifecycle management
- 2026-04-03: Code review (Sonnet 4.6) — 3 High, 5 Medium, 4 Low findings. All HIGH and MEDIUM fixed. L1, L2, L4 also fixed. 12 items resolved.

### File List

- cblaero/src/modules/ai/usage-repository.ts (new — aggregated usage queries with in-memory test support)
- cblaero/src/modules/ai/budget-alert.ts (new — budget threshold check with proactive sampling and structured logging)
- cblaero/src/modules/ai/usage-log.ts (modified — wired maybeCheckBudgetProactive into recordLlmUsage)
- cblaero/src/modules/ai/prompt-registry.ts (modified — status lifecycle, active-only filter, shape validation, error logging)
- cblaero/src/modules/ai/index.ts (modified — re-exports new functions and types)
- cblaero/src/app/api/internal/admin/ai-usage/route.ts (new — GET aggregated AI usage)
- cblaero/src/app/api/internal/admin/ai-usage/__tests__/route.test.ts (new — 7 integration tests)
- cblaero/src/app/api/internal/admin/prompt-registry/route.ts (new — GET/POST prompt version management)
- cblaero/src/app/dashboard/admin/AiCostDashboard.tsx (new — client component with charts and tables)
- cblaero/src/app/dashboard/admin/page.tsx (modified — added AiCostDashboard import and render)
- cblaero/src/modules/auth/authorization.ts (modified — added 3 new protected actions, delivery-head access)
- cblaero/src/modules/ai/__tests__/usage-repository.test.ts (new — 8 unit tests incl. version separation)
- cblaero/src/modules/ai/__tests__/budget-alert.test.ts (new — 5 unit tests)
- cblaero/src/modules/ai/__tests__/prompt-lifecycle.test.ts (new — 6 unit tests incl. staged/pinned)
- cblaero/supabase/schema.sql (modified — status column, CHECK constraint, index, UPDATE grant)
