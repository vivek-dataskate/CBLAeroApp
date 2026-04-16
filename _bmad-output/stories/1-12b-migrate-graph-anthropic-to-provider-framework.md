# Story 1.12b: Migrate Microsoft Graph + Anthropic to Provider Framework

Status: backlog

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

- [ ] Task 1: Microsoft Graph migration
  - [ ] 1.1 Create `OAuthTokenAuth` strategy — stores access token, refreshes on 401, thread-safe
  - [ ] 1.2 Create `GraphProviderClient` extending `BaseProviderClient` — `OAuthTokenAuth`, 15s timeout
  - [ ] 1.3 Refactor `src/modules/email/graph-auth.ts` to use `OAuthTokenAuth`
  - [ ] 1.4 Refactor `src/modules/email/index.ts` Graph calls through `GraphProviderClient`
  - [ ] 1.5 Refactor `EmailIngestionJob` and `SavedSearchDigestJob` Graph calls
  - [ ] 1.6 Register Graph in `ProviderRegistry`
  - [ ] 1.7 Verify all email/ingestion tests pass

- [ ] Task 2: Anthropic migration
  - [ ] 2.1 Create `LLMProvider` interface: `call(model, systemPrompt, userContent, opts) → LLMResult | null`
  - [ ] 2.2 Create `AnthropicLLMProvider implements LLMProvider` — wraps Anthropic SDK, uses `BaseProviderClient` for HTTP
  - [ ] 2.3 Preserve cost estimation, usage logging, anomaly detection inside the provider
  - [ ] 2.4 Create `getLLMProvider()` factory — returns Anthropic when env var set, null otherwise
  - [ ] 2.5 Refactor `callLlm()` to delegate to `getLLMProvider().call()` — public API unchanged
  - [ ] 2.6 Register Anthropic in `ProviderRegistry`
  - [ ] 2.7 Verify all AI tests pass — callers see zero difference

- [ ] Task 3: Validation
  - [ ] 3.1 Full test suite — zero regressions
  - [ ] 3.2 TypeScript clean
  - [ ] 3.3 ProviderRegistry now shows Clay + Ceipal (from 1.12a) + Graph + Anthropic as healthy

## Dev Notes

### Anthropic special case
The Anthropic SDK (`@anthropic-ai/sdk`) manages its own HTTP client internally. We have two options:
- **Option A:** Wrap the SDK — `AnthropicLLMProvider` uses the SDK internally but reports health to `ProviderRegistry` by intercepting success/failure
- **Option B:** Replace the SDK — use `BaseProviderClient` to call Anthropic REST API directly, remove SDK dependency

Option A is lower risk (SDK handles auth, retries, streaming). Option B gives full control. **Recommend Option A** for this story, with Option B as a future optimization if SDK becomes a constraint.

### References
- [Source: architecture.md §25] — Provider framework + LLM swap procedure
- [Source: src/modules/ai/client.ts] — Current Anthropic singleton
- [Source: src/modules/ai/inference.ts] — Current `callLlm()` wrapper
- [Source: src/modules/email/] — Current Graph integration

## Dev Agent Record
### Agent Model Used
### Debug Log References
### Completion Notes List
### File List
