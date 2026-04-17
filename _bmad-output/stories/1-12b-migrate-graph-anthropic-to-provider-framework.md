# Story 1.12b: Migrate Microsoft Graph + Anthropic to Provider Framework

Status: done

## Story

As a platform engineer,
I want to migrate Microsoft Graph (email/inbox) and Anthropic (LLM inference) onto the provider framework,
so that critical integrations gain standardized retry, health tracking, and kill switch capabilities — and the framework is proven on production-critical paths before being applied to Supabase.

## Context

Phase 2 of the provider framework migration. These are medium-risk because:
- **Anthropic** already has the best pattern (`callLlm()` wrapper) — migration is mostly wrapping existing good code in `BaseProviderClient` for retry/health/logging standardization. The public API (`callLlm()`) MUST NOT change — every caller sees zero difference.
- **Microsoft Graph** is used for email sending (SavedSearchDigestJob), inbox parsing (EmailIngestionJob), and SSO token operations. It gains retry and structured logging it currently lacks. OAuth token refresh becomes a proper `OAuthTokenAuth` strategy.

**Depends on:** Story 1.12a (framework validated on Clay + Ceipal)

## Acceptance Criteria

### AC 1: Microsoft Graph Migration

**Given** Graph email operations currently use raw Graph SDK calls
**When** migrated to `GraphProviderClient`
**Then** all Graph API calls go through `BaseProviderClient` with OAuth token refresh auth strategy
**And** `sendMail`, inbox poll, and attachment operations gain retry on 5xx/429 and structured logging
**And** Graph is registered in `ProviderRegistry` with health tracking
**And** when Graph is unhealthy, admin is alerted (email is a critical notification path)
**And** all existing email/ingestion tests pass with zero behavior change

### AC 2: Anthropic Migration

**Given** `callLlm()` currently uses `getSharedAnthropicClient()` directly
**When** migrated to `AnthropicProviderClient`
**Then** HTTP calls delegate to `BaseProviderClient` with bearer auth (`ANTHROPIC_API_KEY`)
**And** existing cost estimation, usage logging, and anomaly detection are preserved exactly
**And** `callLlm()` public API is UNCHANGED — same signature, same return type, same behavior
**And** Anthropic is registered in `ProviderRegistry` with health tracking
**And** if Anthropic is unhealthy (API outage), AI-dependent features degrade gracefully (return null, don't crash)
**And** all existing AI tests pass — callers see zero difference

### AC 3: LLM Provider Interface (Vendor Swap Ready)

**Given** the Anthropic migration introduces proper provider abstraction
**When** a future vendor swap is needed (e.g., Anthropic → OpenAI)
**Then** `LLMProvider` interface exists: `call(model, systemPrompt, userContent, opts) → LLMResult | null`
**And** `AnthropicLLMProvider implements LLMProvider` is the current implementation
**And** `getLLMProvider()` factory returns Anthropic when `ANTHROPIC_API_KEY` is set
**And** swapping to OpenAI = new `OpenAILLMProvider implements LLMProvider` + `OPENAI_API_KEY` env var — zero changes to callers

### AC 4: Zero Regressions

**Given** both migrations are complete
**When** the full test suite runs
**Then** all tests pass with zero regressions
**And** `callLlm()` callers (resume extraction, role deduction, scoring) are unchanged
**And** Email ingestion and digest jobs work identically
**And** Graph + Anthropic show as `healthy` in ProviderRegistry

## Tasks / Subtasks

- [x] Task 1: Microsoft Graph migration
  - [x] 1.1 Create `OAuthTokenAuth` strategy — stores access token, refreshes on 401, thread-safe
  - [x] 1.2 Create `GraphProviderClient` extending `BaseProviderClient` — `OAuthTokenAuth`, 15s timeout
  - [x] 1.3 Refactor `src/modules/email/graph-auth.ts` to use `OAuthTokenAuth`
  - [x] 1.4 Refactor `src/modules/email/index.ts` Graph calls through `GraphProviderClient`
  - [x] 1.5 Refactor `EmailIngestionJob` and `SavedSearchDigestJob` Graph calls
  - [x] 1.6 Register Graph in `ProviderRegistry`
  - [x] 1.7 Verify all email/ingestion tests pass

- [x] Task 2: Anthropic migration
  - [x] 2.1 Create `LLMProvider` interface: `call(model, systemPrompt, userContent, opts) → LLMResult | null`
  - [x] 2.2 Create `AnthropicLLMProvider implements LLMProvider` — wraps Anthropic SDK, reports health via registry hooks (Option A)
  - [x] 2.3 Preserve cost estimation, usage logging, anomaly detection inside the provider
  - [x] 2.4 Create `getLLMProvider()` factory — returns Anthropic when env var set, null otherwise
  - [x] 2.5 Refactor `callLlm()` to delegate to `getLLMProvider().call()` — public API unchanged
  - [x] 2.6 Register Anthropic in `ProviderRegistry`
  - [x] 2.7 Verify all AI tests pass — callers see zero difference

- [x] Task 3: Validation
  - [x] 3.1 Full test suite — zero regressions (593 unit tests pass, +24 new)
  - [x] 3.2 TypeScript clean
  - [x] 3.3 ProviderRegistry now shows Clay + Ceipal (from 1.12a) + Graph + Anthropic as healthy

### Review Findings

_Code review 2026-04-17 — Blind Hunter + Edge Case Hunter + Acceptance Auditor + Cross-Module Flow Auditor (all Sonnet). 1 decision-needed, 9 patches, 10 deferred, 8 dismissed._

**Decision-needed (resolved):**

- [x] [Review][Decision] Admin alert on Graph unhealthy — AC 1 bullet 4 — **resolved with combined option 1 + 3**: `src/modules/providers/admin-alert.ts` now emits a `level: 'critical'` structured log on every alert-worthy transition (covering option 1) AND dispatches an admin email via Graph `sendMail` when `CBL_PROVIDER_ALERT_EMAIL` is configured (covering option 3). Richer multi-channel alerting (Teams/Slack/escalation) is deferred to Epic 8 story 8-5 per `deferred-work.md`.

**Patch (all resolved):**

- [x] [Review][Patch] 401-retry in `GraphProviderClient.request` now sets `skipAuthRetry: true` on the retry attempt and drops an already-aborted `AbortSignal` to keep the retry alive [src/modules/providers/graph/graph-client.ts:114-135]
- [x] [Review][Patch] `MicrosoftGraphEmailParser.getOrCreateFolder` throws on list failure instead of falling through to folder-create — prevents duplicate folder creation under transient Graph 429/5xx [src/modules/email/index.ts:222-242]
- [x] [Review][Patch] `OAuthTokenAuth.invalidateCache()` now bumps a `refreshEpoch` counter; `refreshToken()` compares the epoch before writing back the token, so an in-flight refresh cannot restore a just-revoked credential [src/modules/providers/auth/oauth-token.ts:29-40, 146-163, 173-178]
- [x] [Review][Patch] `GraphProviderClient.normalizePath` now distinguishes same-host (strip prefix), absolute-URL (beta / regional sovereign cloud — pass through), and relative paths. `BaseProviderClient` accepts absolute URLs in the `path` argument without re-prefixing [src/modules/providers/graph/graph-client.ts:175-203, src/modules/providers/base-client.ts:118-122]
- [x] [Review][Patch] Empty-string `@odata.nextLink` is now treated as end-of-pagination in both `MicrosoftGraphEmailParser.fetchMessages` and `OneDriveResumePollerJob.listPdfFiles` / `deleteEmptySubfolders` [src/modules/email/index.ts:267-272, src/modules/ingestion/jobs.ts:558-561, 612-616]
- [x] [Review][Patch] `candidate-extraction.ts` availability check now routes through `getLLMProvider()` — a kill-switched Anthropic provider correctly triggers the regex fallback (and `_resetClientForTest` resets both caches for test isolation) [src/features/candidate-management/application/candidate-extraction.ts:1-8, 165-175, 252-263]
- [x] [Review][Patch] Startup now uses new `initializeLLMProviderFromStartup()` which is a no-op when a provider has been injected — tests can inject a mock before `ensureProvidersInitialized()` runs without risk of clobber [src/modules/ai/llm-factory.ts:51-61, src/modules/providers/startup.ts:3-6, 165]
- [x] [Review][Patch] Item-attachment binary fetch now emits a `provider_log` JSON entry matching the `BaseProviderClient` shape — AC 1 bullet 2's structured-logging gap is closed [src/modules/email/index.ts:305-353]
- [x] [Review][Patch] Graph availability guard in all three jobs now uses `assessGraphAvailability()` which distinguishes `'kill_switched'`, `'unavailable'` (unregistered), and `'available'`. Unregistered → clean skip + completeSyncRun, not a downstream throw [src/modules/ingestion/jobs.ts:32-54]

**Deferred (pre-existing, documented trade-offs, or narrow-edge-case):**

- [x] [Review][Defer] `getLLMProvider()` caches null forever when `ANTHROPIC_API_KEY` arrives at runtime after first access — graceful degradation, fixed indirectly by `setLLMProvider` in startup; narrow race window not worth a second-chance cache (Blind)
- [x] [Review][Defer] `countDocumentPages` in Anthropic cost estimation counts content **blocks**, not PDF pages — pre-existing bug, preserved verbatim per migration scope (Blind)
- [x] [Review][Defer] `AnthropicLLMProvider` reads `getProviderRegistry()` lazily per-call instead of capturing at construction — test-only concern when `ensureProvidersInitialized({registry})` passes a non-default registry; consistent with Ceipal pattern (Blind + Edge + Cross-module)
- [x] [Review][Defer] `OAuthTokenAuth` positional-arg constructor fragile for future callers that want `refreshCooldownMs` but not `scope` — no current caller affected (Edge)
- [x] [Review][Defer] `LLMContentBlock = Anthropic.Messages.ContentBlockParam` leaks vendor type at the abstraction boundary — documented in Dev Notes; OpenAI adapter will map its own blocks (Auditor)
- [x] [Review][Defer] `callLlm()` parameter type still references `Anthropic.Messages.ContentBlockParam[]` directly — callers still import from SDK; documented, matches pre-migration state exactly (Auditor + Cross-module)
- [x] [Review][Defer] `getOrCreateFolder` OData `$filter` does not URL-encode `folderName` — hardcoded `'Processed'`/`'Error'` today; latent risk if parameterized (Edge)
- [x] [Review][Defer] `acquireGraphToken()` pre-startup callers build a detached Graph client (lazy singleton) that `setSharedGraphClient` later replaces — narrow window, startup always runs before production traffic (Cross-module)
- [x] [Review][Defer] `_resetClientForTest()` in `candidate-extraction.ts` resets the Anthropic SDK singleton but not the `LLMProvider` factory — test isolation concern for that feature's tests specifically (Cross-module)
- [x] [Review][Defer] `skipAuthRetry` option is dead code (never activated) — will be removed when the 401 retry patch above lands (Auditor)

**Dismissed as noise:**

- AnthropicLLMProvider TOCTOU on kill-switch (inherent async pattern)
- 401 retry producing duplicate PATCH/POST mutations (HTTP 401 semantics — server did not process)
- `auth` field being `public readonly` (documented test hook)
- Concurrent `ensureProvidersInitialized` calls (idempotent by design)
- Option A vs AC 2 "delegate to BaseProviderClient" text (documented deviation in Dev Notes)
- Log sink wiring verification note (confirmed correct by 1.12a review)
- `mode: normal` vs `healthy` naming (established convention)
- Blind Hunter's `deleteEmptySubfolders` nextLink concern (self-retracted after analysis)

## Dev Notes

### Anthropic special case
The Anthropic SDK (`@anthropic-ai/sdk`) manages its own HTTP client internally. We have two options:
- **Option A:** Wrap the SDK — `AnthropicLLMProvider` uses the SDK internally but reports health to `ProviderRegistry` by intercepting success/failure
- **Option B:** Replace the SDK — use `BaseProviderClient` to call Anthropic REST API directly, remove SDK dependency

Option A is lower risk (SDK handles auth, retries, streaming). Option B gives full control. **Recommend Option A** for this story, with Option B as a future optimization if SDK becomes a constraint.

**Implemented: Option A.** The SDK is retained; health events are surfaced via `ProviderRegistry.recordSuccess/recordFailure` called from within `AnthropicLLMProvider.call()`. Kill-switch is honored — `kill_switched` short-circuits the SDK call and returns `null`.

### References
- [Source: architecture.md §25] — Provider framework + LLM swap procedure
- [Source: src/modules/ai/client.ts] — Current Anthropic singleton
- [Source: src/modules/ai/inference.ts] — Current `callLlm()` wrapper
- [Source: src/modules/email/] — Current Graph integration

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Claude Opus 4.7 via Claude Code CLI, 1M context)

### Debug Log References

- Typecheck error `TS7022 ("referenced directly or indirectly in its own initializer")` on `result`/`data` inside a pagination `while` loop. Resolved by explicitly typing the `ProviderCallResult<T>` return and a typed `data: T | null` intermediate — the fix lives in `src/modules/email/index.ts` and `src/modules/ingestion/jobs.ts`. Pattern: never rely on generic inference across a `while`-loop reassignment of the cursor variable.
- Provider startup tests (`providers-startup.test.ts`) had to clear `CBL_SSO_*` + `ANTHROPIC_API_KEY` in `beforeEach` because the vitest env loader injects them automatically via `.env.local`. Leaking env would have caused the new `graph` + `anthropic` providers to register in tests that asserted explicit provider lists.

### Completion Notes List

**AC 1 — Graph migration (all paths):**
- `OAuthTokenAuth` extended with `scope` parameter and `invalidateCache()` method. Existing Ceipal + test callers still work (no positional-arg breakage).
- New `GraphProviderClient` (`src/modules/providers/graph/`) wraps `BaseProviderClient` with 15s timeout + Graph's OAuth scope. Adds 401-recovery behavior on top of the base client's no-retry-on-auth-failure default: on 401, it invalidates the token cache and retries once. Prevents infinite loops by passing `skipAuthRetry` internally.
- Absolute `@odata.nextLink` URLs are stripped of the baseUrl prefix before being passed to `BaseProviderClient.request()` — callers can pass pagination links back unchanged.
- All Graph traffic in `MicrosoftGraphEmailParser` (`fetchMessages`, `fetchAttachments`, `moveToFolder`, `getOrCreateFolder`) now flows through `GraphProviderClient`. Item-attachment binary fetch remains on `fetchWithRetry` because `BaseProviderClient` consumes the response body as text — narrow edge case (~<1% of email volume).
- `EmailIngestionJob`, `SavedSearchDigestJob`, and `OneDriveResumePollerJob` all call `ensureProvidersInitialized()` at the top of `run()`, honor the `graph` kill-switch, and route Graph calls through `getSharedGraphClient()`.
- `acquireGraphToken()` preserved as a thin wrapper that delegates to `getSharedGraphClient().getAccessToken()` — kept for any legacy caller and for the item-attachment binary fetch path.

**AC 2 + AC 3 — Anthropic migration:**
- New `LLMProvider` interface (`src/modules/ai/llm-provider.ts`) decouples `callLlm()` from any specific SDK. Content type re-exports `Anthropic.Messages.ContentBlockParam` today; future OpenAI adapter will map its own block types inside the adapter.
- `AnthropicLLMProvider` (`src/modules/ai/anthropic-llm-provider.ts`) wraps the Anthropic SDK — preserves cost estimation (including Epic 2 retro D2 per-page vision surcharge), structured metric logs, usage-log persistence, anomaly detection. Kill-switch honored.
- `getLLMProvider()` factory picks Anthropic when `ANTHROPIC_API_KEY` is set; returns `null` otherwise. Swapping to OpenAI = add a sibling class + update the factory's vendor priority list.
- `callLlm()` is now a 4-line thin delegator in `src/modules/ai/inference.ts`. Public API, return type, null-semantics are all byte-compatible with the legacy version — verified by preserved `ai-inference.test.ts` suite (all 7 tests green).

**AC 4 — Zero regressions:**
- `npm run typecheck` → clean.
- `npx vitest run --exclude 'tests/api/**'` → **593 passed | 1 skipped** across 53 test files.
- Added 24 new tests: 13 for `GraphProviderClient`, 11 for `AnthropicLLMProvider`.
- Updated `providers-startup.test.ts` to clear Graph + Anthropic env vars and to assert registration of the two new providers (6/6 green).

### File List

**New files:**
- `src/modules/providers/graph/graph-client.ts` — `GraphProviderClient` + `buildGraphProviderClientFromEnv`
- `src/modules/providers/graph/index.ts` — barrel + `getSharedGraphClient`/`setSharedGraphClient`/`resetSharedGraphClientForTest`
- `src/modules/ai/llm-provider.ts` — `LLMProvider` interface + content/result types
- `src/modules/ai/anthropic-llm-provider.ts` — `AnthropicLLMProvider` + `buildAnthropicLLMProvider`
- `src/modules/ai/llm-factory.ts` — `getLLMProvider`/`setLLMProvider`/`resetLLMProviderForTest`
- `src/modules/__tests__/providers-graph-client.test.ts` — 13 tests (auth scope, 401 recovery, nextLink, verbs, env gating)
- `src/modules/__tests__/providers-anthropic-llm.test.ts` — 11 tests (success/error paths, kill-switch, vision surcharge, registry integration)

**Modified:**
- `src/modules/providers/auth/oauth-token.ts` — added `scope` param + `invalidateCache()` (legacy `clearTokenForTest` kept as alias)
- `src/modules/providers/index.ts` — export Graph barrel
- `src/modules/providers/startup.ts` — register `graph` + `anthropic`, wire hooks, share clients
- `src/modules/email/graph-auth.ts` — thin wrapper over `getSharedGraphClient().getAccessToken()`
- `src/modules/email/index.ts` — `MicrosoftGraphEmailParser` routes through `GraphProviderClient`
- `src/modules/ingestion/jobs.ts` — `EmailIngestionJob`, `SavedSearchDigestJob`, `OneDriveResumePollerJob` ensure providers initialized, honor kill-switch, route Graph calls through client
- `src/modules/ai/inference.ts` — `callLlm()` now delegates to `getLLMProvider()`
- `src/modules/ai/index.ts` — export new LLM provider surface
- `src/modules/__tests__/ai-inference.test.ts` — reset `llm-factory` cache per test
- `src/modules/__tests__/providers-startup.test.ts` — clear Graph/Anthropic env in setup, add registration assertions for both

### Change Log

- **2026-04-17** — Story 1.12b implemented in a single session. Graph + Anthropic migrated to the provider framework (AC 1, AC 2, AC 3). Zero regressions: 593 unit tests pass, 24 new tests added. Typecheck clean. Next steps: code review (recommended against a different LLM than Opus 4.7), then Story 1.12c to close out provider framework rollout for Supabase.
- **2026-04-17 — Review complete.** 4-layer adversarial review (Blind Hunter, Edge Case Hunter, Acceptance Auditor, Cross-Module Flow Auditor — all Sonnet sub-agents). Triage: 1 decision, 9 patches, 10 deferred, 8 dismissed. All patches applied + new regression tests: admin-alert sink (critical log + Graph sendMail), `refreshEpoch` race guard on `OAuthTokenAuth`, `BaseProviderClient` absolute-URL support, `skipAuthRetry` activation, empty-nextLink pagination guards, `getLLMProvider()` kill-switch–aware availability check in candidate-extraction, `initializeLLMProviderFromStartup` to preserve test mocks, provider-log emission on item-attachment binary path, `assessGraphAvailability()` gate in all three ingestion jobs. **609 tests pass, typecheck clean.** Deferred items written to `_bmad-output/deferred-work.md`. Ready for PR.
