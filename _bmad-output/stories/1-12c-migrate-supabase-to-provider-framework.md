# Story 1.12c: Migrate Supabase to Provider Framework

Status: backlog

## Story

As a platform engineer,
I want Supabase to be health-tracked and circuit-breakered through the provider framework,
so that database health is visible alongside all other providers and the application fails fast instead of queuing hundreds of requests against a dead database.

## Context

Phase 3 — lightest touch, highest stakes. Every feature depends on Supabase. The Supabase JS SDK already manages its own connection pool, retry, and timeout internally. We do NOT wrap individual queries in `BaseProviderClient` — that would add latency to every DB call for no benefit. Instead, we wrap the client with health monitoring only.

**Depends on:** Story 1.12b (framework proven on 4 providers)

## Acceptance Criteria

### AC 1: Supabase Health Provider

**Given** the existing `getSupabaseAdminClient()` singleton
**When** a `SupabaseHealthProvider` wraps it
**Then** a periodic health ping (every 30s) checks DB connectivity via a lightweight query (`SELECT 1`)
**And** query-level error rates are tracked (not individual query timing — SDK handles that)
**And** Supabase is registered in `ProviderRegistry` with health status
**And** health is visible in the admin dashboard alongside other providers

### AC 2: Circuit Breaker

**Given** Supabase is unreachable
**When** the health ping fails for > 30 seconds consecutively
**Then** `ProviderRegistry` marks Supabase as `unhealthy`
**And** `getSupabaseAdminClient()` continues to return the client (SDK may recover on its own)
**And** an admin alert is emitted: `provider.supabase.unhealthy`
**And** when health recovers, status returns to `healthy` automatically (no manual failback needed — DB is different from messaging providers)

### AC 3: No Query Wrapping

**Given** `getSupabaseAdminClient()` returns the Supabase client
**When** repositories call `client.from("table").select()` etc.
**Then** these calls are NOT wrapped in `BaseProviderClient` — they use the SDK directly as today
**And** the public API of `getSupabaseAdminClient()` is unchanged
**And** all existing repository code and tests work identically

### AC 4: Zero Regressions

**Given** the migration is complete
**When** the full test suite runs
**Then** all tests pass with zero regressions
**And** ProviderRegistry shows all 5 providers (Clay, Ceipal, Graph, Anthropic, Supabase)

## Tasks / Subtasks

- [ ] Task 1: Supabase health provider
  - [ ] 1.1 Create `SupabaseHealthProvider` — wraps existing client with periodic health ping
  - [ ] 1.2 Health ping: `SELECT 1` every 30 seconds, track success/failure
  - [ ] 1.3 Register Supabase in `ProviderRegistry`
  - [ ] 1.4 Error rate tracking: count failed DB operations (from repositories that opt-in to reporting)

- [ ] Task 2: Circuit breaker
  - [ ] 2.1 Auto-unhealthy after 30s of consecutive ping failures
  - [ ] 2.2 Admin alert emission on health transitions
  - [ ] 2.3 Auto-recovery when pings succeed again (unlike messaging providers — DB doesn't need manual failback)

- [ ] Task 3: Validation
  - [ ] 3.1 Full test suite — zero regressions
  - [ ] 3.2 TypeScript clean
  - [ ] 3.3 ProviderRegistry shows all 5 providers
  - [ ] 3.4 Simulate DB outage in test: verify circuit breaker fires, verify recovery

## Dev Notes

### Why Supabase is different
Messaging providers (Telnyx, Instantly) have per-request auth, idempotency keys, and webhook callbacks. Supabase JS SDK manages its own connection pool with PostgREST. Wrapping every query in `BaseProviderClient` would:
- Add latency to every DB call (unnecessary — SDK handles retry)
- Break the Supabase fluent API (`client.from().select().eq()`)
- Force every repository to change its calling pattern

Instead, we add health-only monitoring. The SDK continues to handle connections. We just know when it's broken and alert.

### References
- [Source: architecture.md §25] — Supabase special case
- [Source: src/modules/persistence/index.ts] — Current Supabase singleton

## Dev Agent Record
### Agent Model Used
### Debug Log References
### Completion Notes List
### File List
