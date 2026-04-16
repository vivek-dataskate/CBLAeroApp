# Story 1.12a: Migrate Clay + Ceipal to Provider Framework

Status: backlog

## Story

As a platform engineer,
I want to migrate Clay (inbound webhook + outbound API) and Ceipal ATS (outbound polling) onto the provider framework built in Story 1.12,
so that these lowest-risk integrations validate the framework before applying it to critical paths.

## Context

First consumers of the provider framework. Clay and Ceipal are chosen because:
- Clay is inbound-only today (webhook) — tests the `BaseWebhookReceiver` path
- Clay outbound API client is created here (ready for Epic 3 candidate push use case) — tests `BaseProviderClient` with a simple auth model
- Ceipal is outbound polling with API key auth — tests `BaseProviderClient` retry/logging
- Both are well-tested (55 Clay tests, Ceipal tests in jobs.test.ts) — regressions are immediately visible
- Neither is on the critical user-facing path — low blast radius if something goes wrong

**Depends on:** Story 1.12 (framework must exist)

## Acceptance Criteria

### AC 1: Clay Webhook Migration

**Given** the Clay webhook at `/api/webhooks/clay`
**When** it is refactored to use `BaseWebhookReceiver`
**Then** signature validation uses `BearerTokenWebhookAuth` (existing `CLAY_WEBHOOK_SECRET` check)
**And** raw payloads are written to shared `webhook_events` table with `source='clay'`
**And** Clay-specific business logic (mapper → fingerprint → ingestion) runs in the webhook processor
**And** existing 256KB payload size limit is enforced by `BaseWebhookReceiver`
**And** duplicate Clay events (same `profile_id:last_refresh`) are deduped at the webhook layer
**And** all 55 existing Clay tests pass with zero behavior change
**And** hourly bucketing for sync_runs is preserved

### AC 2: Clay Outbound API Client

**Given** Clay has a REST API for pushing candidates back for enrichment
**When** a `ClayProviderClient` is created
**Then** it extends `BaseProviderClient` with Clay API key auth
**And** it provides methods for future outbound operations (not wired to any product code yet)
**And** it is registered in `ProviderRegistry` alongside the inbound webhook

### AC 3: Ceipal ATS Migration

**Given** `CeipalIngestionJob` currently uses inline `fetch()` calls
**When** it is refactored to use `CeipalProviderClient`
**Then** API calls go through `BaseProviderClient` with: API key auth, 10s timeout, retry on 5xx
**And** every Ceipal API call emits structured logs: `{provider: 'ceipal', method, path, status, durationMs}`
**And** Ceipal is registered in `ProviderRegistry` with health tracking
**And** all existing Ceipal tests pass with zero behavior change
**And** incremental sync (`since` tracking, early exit) is preserved

### AC 4: Zero Regressions

**Given** both migrations are complete
**When** the full test suite runs
**Then** 472+ tests pass with zero regressions
**And** TypeScript is clean
**And** Clay and Ceipal health show as `healthy` in `ProviderRegistry`

## Tasks / Subtasks

- [ ] Task 1: Clay webhook migration
  - [ ] 1.1 Create `ClayWebhookReceiver` extending `BaseWebhookReceiver` — `BearerTokenWebhookAuth` with `CLAY_WEBHOOK_SECRET`
  - [ ] 1.2 Refactor `/api/webhooks/clay/route.ts` to delegate to `ClayWebhookReceiver`
  - [ ] 1.3 Create Clay webhook event handler for the processor (mapper → fingerprint → ingestion pipeline)
  - [ ] 1.4 Preserve hourly sync_run bucketing
  - [ ] 1.5 Verify all 55 Clay tests pass

- [ ] Task 2: Clay outbound client
  - [ ] 2.1 Create `ClayProviderClient` extending `BaseProviderClient` — API key auth for Clay REST API
  - [ ] 2.2 Register Clay in `ProviderRegistry` (bidirectional: inbound webhook + outbound API)
  - [ ] 2.3 Outbound methods are stubs for now — Epic 3 outbound Clay story will wire them

- [ ] Task 3: Ceipal ATS migration
  - [ ] 3.1 Create `CeipalProviderClient` extending `BaseProviderClient` — API key auth, Ceipal error handling
  - [ ] 3.2 Refactor `CeipalIngestionJob` to use `CeipalProviderClient` for all API calls
  - [ ] 3.3 Preserve incremental sync, early exit, fingerprint batch logic
  - [ ] 3.4 Register Ceipal in `ProviderRegistry`
  - [ ] 3.5 Verify all Ceipal tests pass

- [ ] Task 4: Validation
  - [ ] 4.1 Full test suite — zero regressions
  - [ ] 4.2 TypeScript clean
  - [ ] 4.3 Provider registry shows Clay + Ceipal as healthy

## Dev Notes

### Migration is a refactor, not a feature change
Every test that passed before must pass after. If behavior changes, the migration is wrong. Keep `_legacy` copies of the old code until validated in production (delete after 1 week).

### Clay outbound — future use case
Vivek has a use case for pushing candidates back to Clay for enrichment at end of Epic 3. The `ClayProviderClient` created here will be ready. The outbound methods are defined but not called by any product code in this story.

### References
- [Source: architecture.md §25] — Provider framework specification
- [Source: src/app/api/webhooks/clay/route.ts] — Current Clay webhook
- [Source: src/modules/ingestion/jobs.ts:96-192] — Current Ceipal inline fetch
- [Source: src/modules/ingestion/clay-mapper.ts] — Clay mapper (unchanged)

## Dev Agent Record

### Agent Model Used
### Debug Log References
### Completion Notes List
### File List
