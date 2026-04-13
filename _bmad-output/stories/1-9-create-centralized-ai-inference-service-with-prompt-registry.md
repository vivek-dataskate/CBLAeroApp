# Story 1.9: Create Centralized AI Inference Service with Prompt Registry

Status: done

## Story

As a platform engineer,
I want all LLM/AI interactions routed through a centralized inference service with prompt versioning,
so that future AI features (scoring, matching, outreach drafting) reuse the same client, retry, cost tracking, and prompt management patterns.

## Acceptance Criteria

1. **Given** any code that needs to call an LLM (Anthropic Claude)
   **When** it makes the call
   **Then** it uses the shared client from `modules/ai/client.ts` — never instantiates `new Anthropic()` directly

2. **Given** the extraction prompt currently hardcoded in `candidate-extraction.ts`
   **When** the AI service initializes
   **Then** prompts are loadable from the `prompt_registry` table (with inline fallback for when DB is unavailable)

3. **Given** any LLM call
   **When** it completes (success or failure)
   **Then** structured metrics are logged: `{ module, action, model, inputChars, outputChars, durationMs, fillRate, promptVersion }`

4. **Given** the existing `candidate-extraction.ts`
   **When** migrated to use `modules/ai/`
   **Then** all existing tests pass, extraction behavior is identical, and the capability is registered

5. **Given** the `prompt_registry` table schema (already defined in architecture.md resilience §13)
   **When** a new prompt version is created
   **Then** it is append-only (old versions preserved), tagged with name + version, and the active version is loadable by name

6. **Given** a future story that needs LLM for scoring or outreach
   **When** it imports from `modules/ai/`
   **Then** it gets the shared client, retry handling, cost logging, and prompt loading without reimplementing any of it

## Tasks / Subtasks

- [x] Create `modules/ai/` service structure (AC: 1, 6)
  - [x] Create `src/modules/ai/client.ts` — shared Anthropic client singleton with lazy init, env check, `clearClientForTest()`
  - [x] Create `src/modules/ai/prompt-registry.ts` — `loadPrompt(name, version?)` function that reads from `prompt_registry` table with in-memory fallback
  - [x] Create `src/modules/ai/inference.ts` — `callLlm(model, systemPrompt, userContent, opts)` wrapper with structured logging, cost tracking, retry via `fetchWithRetry` from `@/modules/ingestion/fetch-with-retry` for transient API errors
  - [x] Create `src/modules/ai/index.ts` — public API exports

- [x] Create `prompt_registry` table if not exists (AC: 5)
  - [x] Add DDL to `supabase/schema.sql`: `CREATE TABLE IF NOT EXISTS prompt_registry (id SERIAL PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, prompt_text TEXT NOT NULL, model TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), created_by TEXT, notes TEXT, UNIQUE(name, version))`
  - [x] Apply via Supabase MCP
  - [x] Seed initial prompt: `candidate-extraction` v1 with current `EXTRACTION_PROMPT` text

- [x] Migrate `candidate-extraction.ts` to use `modules/ai/` (AC: 1, 4)
  - [x] Replace `getAnthropicClient()` with import from `modules/ai/client`
  - [x] Replace direct `anthropicClient.messages.create()` with `callLlm()` from `modules/ai/inference`
  - [x] Load extraction prompt from registry (with hardcoded fallback for tests/no-DB mode)
  - [x] Keep `extractCandidateFromDocument()` public API identical — this is a transparent refactor
  - [x] Update `_resetClientForTest()` to delegate to `modules/ai/client`

- [x] Add structured LLM call logging (AC: 3)
  - [x] `callLlm()` logs JSON: `{ level, module: 'ai', action: 'llm_call', model, promptName, promptVersion, inputChars, outputChars, durationMs }`
  - [x] On extraction complete, log fill rate: `{ action: 'extraction_complete', fillRate, fieldsPopulated, totalFields }`

- [x] Write tests (AC: 4, 5)
  - [x] Unit tests for `modules/ai/client.ts` (singleton, env check, test reset)
  - [x] Unit tests for `modules/ai/prompt-registry.ts` (load from mock DB, fallback to inline)
  - [x] Unit tests for `modules/ai/inference.ts` (structured logging, error handling)
  - [x] Verify all existing extraction tests pass unchanged

- [x] Register capabilities in architecture.md and development-standards.md §18 (AC: 6)
  - [x] Add `callLlm()`, `loadPrompt()`, `getSharedAnthropicClient()` to Capabilities Registry
  - [x] Update dev-standards §18 utility table
  - [x] Update dev-standards §22 Prompt Versioning to reference actual implementation

## Dev Notes

### Architecture Compliance

This story implements the "AI Inference Service" from architecture.md §Service Boundary Architecture. The key rule: **all Anthropic SDK usage goes through `modules/ai/` — no direct `new Anthropic()` in feature code.**

### Test Baseline

**208 tests currently pass.** All must remain green after this refactor. Run `npm test` before and after every significant change.

### LLM Safety (dev-standards §25) — MANDATORY

`callLlm()` must enforce adversarial input protections:
- **Output validation**: Verify LLM JSON output field types and value ranges before accepting
- **Field override**: Security-critical fields (`source`, `extractionMethod`) are hardcoded AFTER spreading LLM output — never trust LLM for these
- **Prompt hardening**: System prompts must include "Respond ONLY with valid JSON" guardrails
- **Anomaly detection**: Log warning if LLM output contains prompt-like patterns (possible injection echo)

### What already exists (MIGRATE, do not recreate)
- `features/candidate-management/application/candidate-extraction.ts` — has working extraction with Anthropic client, prompt, parsing, regex fallback. The public API (`extractCandidateFromDocument`) MUST remain identical.
- `modules/email/nlp-extract-and-upload.ts` — thin wrapper that calls `extractCandidateFromDocument`. Should not need changes.
- `modules/ingestion/fetch-with-retry.ts` — existing retry utility with exponential backoff. Import from `@/modules/ingestion/fetch-with-retry` for API call retries.

### Deferred issues from Story 1.8 (do not regress)
- Resume MIME type hardcoding (LOW) — don't introduce new hardcoded MIME assumptions
- In-memory mode param divergence (LOW) — follow existing repository test-mode patterns

### Future consumers (do NOT implement, just ensure the API supports them)
- Story 5.1: Weighted opportunity scoring — will need `callLlm()` with a different prompt
- Story 3.x: Outreach message drafting — will need `callLlm()` with different prompt + template
- Story 6.1: Digest summarization — may need `callLlm()` for candidate highlights

### Model configuration
- Default model: `claude-haiku-4-5-20251001` (cost-efficient for extraction)
- Model should be configurable per prompt in the registry (not hardcoded in callLlm)
- Input truncation (10K chars) stays in the caller, not in the inference service

### References

- [Source: docs/planning_artifacts/development-standards.md — §2 LLM Integration, §19 Cost Optimization, §21 Quality Monitoring, §22 Prompt Versioning, §25 LLM Safety]
- [Source: docs/planning_artifacts/architecture.md — Service Boundary Architecture, Resilience §13 Prompt Registry, Implemented Capabilities Registry]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

### Completion Notes List

- Created `modules/ai/` with 4 files: client.ts (singleton), prompt-registry.ts (DB+fallback loader), inference.ts (callLlm wrapper with structured logging + anomaly detection), index.ts (public exports)
- Created `prompt_registry` table in Supabase via MCP migration, seeded with `candidate-extraction` v1.0.0
- Migrated `candidate-extraction.ts`: replaced local Anthropic client with `getSharedAnthropicClient()`, replaced direct API call with `callLlm()`, added `loadPrompt()` for registry-backed prompt loading with inline fallback
- Added fill rate logging on every extraction: `{ action: 'extraction_complete', fillRate, fieldsPopulated, totalFields }`
- Added anomaly detection in `callLlm()`: warns on prompt-echo patterns in LLM output
- 241 tests pass (33 new: 4 client, 4 prompt-registry, 5 inference, 20 from existing files counting new coverage). TypeScript clean.
- Registered 5 new capabilities in architecture.md §AI Inference Service and development-standards.md §18
- Updated development-standards.md §22 to reflect implemented state

### Change Log

- 2026-04-03: Story 1.9 implemented — centralized AI inference service with prompt registry
- 2026-04-03: Code review fixes — 2 HIGH, 3 MEDIUM, 1 LOW resolved: API error handling in callLlm, prompt_registry grant security, anomaly regex false-positive fix, prompt cache with 5min TTL, test-mode guards on clear*ForTest, repository table entry
- 2026-04-03: Added token-level cost tracking — callLlm() now returns inputTokens/outputTokens/estimatedCostUsd, persists to llm_usage_log table via fire-and-forget

### File List

- cblaero/src/modules/ai/client.ts (new)
- cblaero/src/modules/ai/prompt-registry.ts (new)
- cblaero/src/modules/ai/inference.ts (new)
- cblaero/src/modules/ai/usage-log.ts (new)
- cblaero/src/modules/ai/index.ts (new)
- cblaero/src/modules/__tests__/ai-client.test.ts (new)
- cblaero/src/modules/__tests__/ai-prompt-registry.test.ts (new)
- cblaero/src/modules/__tests__/ai-inference.test.ts (new)
- cblaero/src/features/candidate-management/application/candidate-extraction.ts (modified)
- cblaero/src/features/candidate-management/application/__tests__/candidate-extraction.test.ts (modified)
- cblaero/src/app/api/internal/recruiter/resume-upload/__tests__/route.test.ts (modified)
- cblaero/src/app/api/internal/recruiter/resume-upload/[batchId]/__tests__/route.test.ts (modified)
- cblaero/supabase/schema.sql (modified)
- docs/planning_artifacts/architecture.md (modified)
- docs/planning_artifacts/development-standards.md (modified)
- docs/implementation_artifacts/sprint-status.yaml (modified)
