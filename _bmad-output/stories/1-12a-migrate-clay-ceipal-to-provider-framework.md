# Story 1.12a: Migrate Clay + Ceipal to Provider Framework

Status: ready-for-dev

## Story

As a platform engineer,
I want to migrate Clay (inbound webhook + outbound API client) and Ceipal ATS (outbound polling) onto the provider framework built in Story 1.12,
so that these lowest-risk integrations validate the framework before we apply it to the critical Graph/Anthropic/Supabase paths in 1.12b and 1.12c.

## Context

First consumers of the provider framework (Story 1.12). Clay and Ceipal are chosen for staged rollout because:

- **Clay is inbound-only today** (webhook from Clay → our `/api/webhooks/clay`) — stresses the `BaseWebhookReceiver` path end-to-end.
- **Clay outbound API client is created here** but NOT wired to product code yet. Epic 3 outbound-Clay enrichment story will consume it. Validates `BaseProviderClient` with simple API-key auth.
- **Ceipal is outbound polling with token-exchange auth** — exercises `BaseProviderClient` auth strategy, retry, timeout, structured logging.
- **Both are heavily tested** (55 Clay route tests + 8 Ceipal tests + 23 ingestion-job tests) — any regression is immediately visible.
- **Neither is on the user-visible critical path** — low blast radius.

**Depends on:** Story 1.12 (done 2026-04-16) — framework is complete with `result_meta` column, auth-failure exclusion from kill-switch math, degraded → normal auto-recovery, and all cross-module interface changes in place.

**This is a refactor, not a feature change.** Every test that passes today must pass after the migration. If observable behavior changes, the migration is wrong.

## Acceptance Criteria

### AC 1: Clay Webhook Migration — Inbound

**Given** the Clay webhook at `POST /api/webhooks/clay`
**When** it is refactored to use `BaseWebhookReceiver`
**Then** signature validation uses `BearerTokenWebhookAuth` with `CLAY_WEBHOOK_SECRET` (unchanged semantics, unchanged env var)
**And** the receiver enforces the existing 256 KB payload size limit (via `maxPayloadBytes` config)
**And** the receiver uses `extractEvents` to fan out all four known Clay payload shapes — flat array `[{row1}]`, single object `{…}`, wrapped `{rows:[…]}` (sole top-level key), and double-wrapped `[[{row1}]]`
**And** each event is inserted into `webhook_events` with `source='clay_enrichment'` (matches Story 2-8 — DO NOT use `'clay'`), `provider_event_id=null` (Clay payloads have no stable per-row UUID), `event_type='candidate.upserted'`
**And** Clay-specific processing (assignee resolution → `clay-mapper` → `computeClayFingerprint` → `isAlreadyProcessed` gate → `batchUpsertCandidatesFromATS` → `recordFingerprint`) runs in a `WebhookHandler` executed by `WebhookProcessor`, not inline in the route
**And** the handler returns `WebhookHandlerResult` with `meta = { syncRunId, candidateId, outcome }` so `webhook_events.result_meta` is populated
**And** the handler dual-writes to `sync_runs` via the existing `upsert_clay_hourly_sync_run` RPC so the Story 2.4b admin dashboard keeps working (Phase 1 bucket acquisition → Phase 2 per-row processing → Phase 3 final count upsert pattern preserved)
**And** in-batch dedup (`Set<string>` on fingerprint) and the DB-level `isAlreadyProcessed()` check continue to be the authoritative row-level dedup (the HTTP-level `webhook_events` dedup is effectively disabled for Clay since `provider_event_id` is always null)
**And** the assignee 1-hour TTL cache and `__resetClayWebhookCacheForTests()` hook are preserved exactly
**And** all 55 Clay tests in `src/app/api/webhooks/clay/__tests__/route.test.ts` pass with zero behavior change

### AC 2: Clay Outbound API Client — Created, Not Wired

**Given** Clay exposes a REST API at `https://api.clay.com` for pushing candidates back for enrichment (Epic 3 use case)
**When** a `ClayProviderClient` is created
**Then** it is built by instantiating `BaseProviderClient` with `ApiKeyHeaderAuth` (env var `CLAY_API_KEY`, header TBD per Clay docs — default `x-api-key`)
**And** it exposes typed methods for future operations (e.g. `pushCandidateForEnrichment(profile)`) that are **not called by any product code in this story**
**And** it is registered in `ProviderRegistry.register('clay')` so its health surfaces alongside inbound Clay
**And** it has unit tests with mocked `fetch` covering: happy path, 429 retry, 500 retry, 401 auth_failure classification

### AC 3: Ceipal ATS Migration — Outbound

**Given** `CeipalIngestionJob` and `src/modules/ats/ceipal.ts` currently use `fetchWithRetry` directly with module-level token cache
**When** they are refactored to use `CeipalProviderClient` (extends `BaseProviderClient`)
**Then** all HTTP calls go through `client.request()` / `client.get()` / `client.post()` with: 10 s timeout, exponential backoff retry on `[408, 429, 500, 502, 503, 504]`, per-call structured log
**And** a custom `CeipalAuthStrategy` (implements `AuthStrategy`) encapsulates the token-exchange flow (POST to `CEIPAL_AUTH_URL` with `{api_key, email, password, json:1}`, parse XML or JSON response, 5-minute-buffer cache) — the module-level `tokenCache` singleton is replaced by instance state on the strategy
**And** the `clearCeipalTokenCacheForTest()` test hook is ported to the new strategy (rename allowed, behavior identical)
**And** every Ceipal API call emits `ProviderLogEntry` with `{provider:'ceipal', method, path, statusCode, durationMs, attempt}`
**And** `fetchCeipalApplicants()` public signature is **unchanged** — `CeipalIngestionJob` callers see no difference
**And** incremental sync (`since` → `modified_after`), pagination (50/page), 1 s inter-page delay, partial-page early exit, 3-consecutive-skipped-page early exit are all preserved
**And** Ceipal is registered in `ProviderRegistry.register('ceipal', client)` with health tracking wired via `registry.wireClient`
**And** calls pass `costMeta: { endpoint: 'applicant/search' }` via `RequestOptions.costMeta` so future per-endpoint cost attribution works (no cost hook computed in this story — leave `estimateCost` undefined)
**And** SSN is still excluded from `CeipalApplicant` type and never logged
**And** all 8 tests in `src/modules/__tests__/ceipal.test.ts` and the Ceipal-related cases in `src/modules/__tests__/ingestion-jobs.test.ts` pass with zero behavior change

### AC 4: Registry Seed + Health Event Persistence

**Given** the framework persists provider state to `provider_routing_policies` and `provider_health_events`
**When** the app starts up
**Then** a startup seed inserts / upserts two routing policies — `clay` (channel='enrichment', primary='clay', mode='normal') and `ceipal` (channel='ats', primary='ceipal', mode='normal') — the `ProviderRegistry` reads them and restores `mode` across restarts (note: in-memory health tracker still rebuilds; this only persists mode + kill-switch state)
**And** `PostgresHealthEventStore.persist()` is wired to `ProviderRegistry.onHealthEvent` so every mode transition writes an audit row
**And** both providers show `mode='normal'`, `health='healthy'` in `ProviderRegistry.list()` after first successful call

### AC 5: Zero Regressions on Prior Stories (2-8, 2-4b, 2-3)

**Given** Clay webhook delivery (Story 2-8), admin sync-run UI (Story 2-4b), and Ceipal ingestion (Story 2-3) are already live
**When** 1-12a migration lands
**Then** Story 2-8 surface is preserved byte-for-byte:
- HTTP response body shape unchanged: `{ received, accepted, skipped, errored, bucket_run_id }`
- `POST /api/webhooks/clay` status codes: 200 success, 401 auth, 400 malformed, 413 oversized, 503 unresolved assignee
- Source string is `'clay_enrichment'` everywhere (`sync_runs.source`, `recordSyncFailure(source,…)`, `webhook_events.source`) — never `'clay'`
- Fingerprint: `clay:${profile_id}:${last_refresh}` with `fingerprint_type='ats_external_id'`, `source='ats'` — handled by existing `computeClayFingerprint()` in [clay-mapper.ts](src/modules/ingestion/clay-mapper.ts)
- `candidates.source_recruiter_actor_id` stamp still flows through `upsert_candidate_batch` RPC with preserve-if-set `coalesce` rule
- `upsert_clay_hourly_sync_run(p_accepted, p_skipped, p_errored)` RPC still called once per request; `bucket_run_id` still returned in response; Clay is the ONLY source that uses hourly bucketing (partial index `uq_sync_runs_clay_hourly` on `(source, started_at) WHERE source='clay_enrichment'`)
- `__resetClayWebhookCacheForTests()` test hook still exported from `route.ts`
- All env vars identical: `CLAY_WEBHOOK_SECRET`, `CLAY_DEFAULT_ASSIGNEE_EMAIL`, `CLAY_EMAIL_FIELD`, `CLAY_PHONE_FIELD`, `CLAY_BLOB_FIELD`, `CLAY_WEBHOOK_DEBUG`

**And** Story 2-4b surface is preserved:
- `SyncRunSummaryCard` at [src/app/dashboard/admin/SyncRunSummaryCard.tsx](src/app/dashboard/admin/SyncRunSummaryCard.tsx) still renders current-month Clay hourly buckets + per-run rows for Ceipal, email, OneDrive, dedup, digest
- Clay rows still aggregate to 1-per-hour; Ceipal rows still per-run (AC 4 of 2-4b)
- Error drill-down at `/dashboard/admin/sync-errors?runId=xxx` ([src/app/dashboard/admin/sync-errors/page.tsx](src/app/dashboard/admin/sync-errors/page.tsx)) still groups errors by `run_id` for both Clay hourly buckets and Ceipal per-run rows
- `sync-error-repository.ts` API unchanged: `createSyncRun`, `completeSyncRun`, `failSyncRun`, `listSyncRunsCurrentMonth`, `listSyncErrorsByRun`, `recordSyncFailure(source, recordId, error, runId?)`
- API route [src/app/api/internal/admin/sync-runs/route.ts](src/app/api/internal/admin/sync-runs/route.ts) response shape unchanged

**And** Story 2-3 surface is preserved:
- `fetchCeipalApplicants({ since?, startPage?, maxPages? })` signature unchanged — same options, same `CeipalApplicant[]` return
- `mapCeipalApplicantToCandidate`, `getCeipalCreatedOn`, `clearCeipalTokenCacheForTest`, `CeipalApplicant` type all still exported from `src/modules/ats/ceipal.ts` (or re-exported if moved)
- `CeipalIngestionJob.lastRunAt` instance state + automatic incremental sync still works
- `createSyncRun('ceipal')` still fires at run start (domain source name, not `'CeipalIngestionJob'`)
- SSN still absent from `CeipalApplicant` type and never logged
- `[Ceipal]` prefixed logs still emit on token acquisition success/failure
- `recordFingerprintBatch` still used (one call per page, not N sequential calls)
- `additionalFields` still maps to `extra_attributes` via `mapToCandidateRow`
- XML `<access_token>` regex fallback + JSON `expires_in` parsing both still work (Ceipal server returns both shapes)
- All env vars identical: `CEIPAL_API_KEY`, `CEIPAL_USERNAME`, `CEIPAL_PASSWORD`, `CEIPAL_ENDPOINT_KEY`, `CEIPAL_AUTH_URL`, `CEIPAL_DATA_URL`

**And** full test suite runs (`npm run test`) with zero regressions — exact prior test counts must all still pass:
- 38 Clay mapper tests in [src/modules/__tests__/clay-mapper.test.ts](src/modules/__tests__/clay-mapper.test.ts) — DO NOT touch the file; the mapper is not migrated
- 17 Clay webhook integration tests in [src/app/api/webhooks/clay/__tests__/route.test.ts](src/app/api/webhooks/clay/__tests__/route.test.ts) — preserve every assertion; if an internal helper moves, update the import, not the assertion
- 8 Ceipal tests in [src/modules/__tests__/ceipal.test.ts](src/modules/__tests__/ceipal.test.ts)
- 23 ingestion-job tests in [src/modules/__tests__/ingestion-jobs.test.ts](src/modules/__tests__/ingestion-jobs.test.ts) (Ceipal cases mocked at `fetchCeipalApplicants` / `mapCeipalApplicantToCandidate` boundary — preserve those mock targets)
- 110 provider-framework tests (1.12 baseline) — unchanged
- Everything else in the project (~430+ other tests) — zero regressions

**And** `npm run typecheck` is clean
**And** `npm run lint` is clean (no new warnings)
**And** manual smoke test covers BOTH feature contracts end-to-end:
1. `curl -X POST $APP_URL/api/webhooks/clay -H "Authorization: Bearer $CLAY_WEBHOOK_SECRET" -d @production-michaela-payload.json` → verify response JSON has `bucket_run_id`, `accepted`, `skipped`, `errored`; verify ONE new `sync_runs` row with `source='clay_enrichment'` (or increment of the existing hourly bucket); verify candidate upserted with `source_recruiter_actor_id` stamped; verify admin dashboard `SyncRunSummaryCard` shows the updated hourly bucket
2. Force a mapper error on one row of a multi-row batch → verify other rows still process, error appears in `sync_errors` with `run_id` linking to Clay hourly bucket, drill-down page renders it
3. Trigger `CeipalIngestionJob` via `/api/internal/jobs/run` → verify structured `{provider:'ceipal',…}` log lines + exactly one new `sync_runs` row with `source='ceipal'` + `lastRunAt` advanced for next invocation
4. Verify `ProviderRegistry.list()` shows `clay`, `clay-outbound`, `ceipal` all with `mode='normal'`, `health='healthy'`

## Tasks / Subtasks

- [ ] **Task 1: Clay webhook — BaseWebhookReceiver migration** (AC: 1)
  - [ ] 1.1 Create `src/modules/providers/clay/` directory (consumer-owned, adjacent to framework)
  - [ ] 1.2 Create `src/modules/providers/clay/clay-webhook-receiver.ts` — instantiate `BaseWebhookReceiver` with `source='clay'`, `auth: new BearerTokenWebhookAuth(process.env.CLAY_WEBHOOK_SECRET)`, `maxPayloadBytes: 256*1024`, and `extractEvents` handling all 4 payload shapes (copy logic from `route.ts:151-178` verbatim — do NOT simplify)
  - [ ] 1.3 Create `src/modules/providers/clay/clay-webhook-handler.ts` — implements `WebhookHandler.handle(event)`. Body: resolve assignee (reuse existing cache — extract `resolveDefaultAssignee()` into handler module if needed), call `mapClayRowToCandidate`, compute fingerprint via existing `computeClayFingerprint`, run `isAlreadyProcessed` gate, call `batchUpsertCandidatesFromATS`, record fingerprint via `recordFingerprint`. Return `{ meta: { syncRunId, candidateId, outcome: 'inserted' | 'updated' | 'skipped_duplicate' } }`.
  - [ ] 1.4 Preserve the 3-phase hourly bucket flow in `/api/webhooks/clay/route.ts` (bucket acquisition pre-handler, per-row processing, final count upsert post-handler) — the bucket RPC wraps the `receiver.receive()` + processor-drain call
  - [ ] 1.5 Refactor `src/app/api/webhooks/clay/route.ts` so the route is thin: parse body, call `clayReceiver.receive(rawBody, headers)`, let the processor drain events synchronously for this request (acceptable since Clay batches are small; preserve current in-request processing — do NOT move to background async)
  - [ ] 1.6 Keep `normalizePayload()`, `resolveDefaultAssignee()`, `__resetClayWebhookCacheForTests()`, and the per-row logic accessible as exported helpers so existing tests don't need rewriting
  - [ ] 1.7 Verify all 55 tests in `src/app/api/webhooks/clay/__tests__/route.test.ts` pass unchanged — if a test asserts an implementation detail that moved, prefer adding a thin shim that preserves the old assertion over rewriting the test

- [ ] **Task 2: Clay outbound client — created, not wired** (AC: 2)
  - [ ] 2.1 Create `src/modules/providers/clay/clay-client.ts` — exports `ClayProviderClient` class wrapping `BaseProviderClient`. Constructor reads `CLAY_API_KEY` and `CLAY_API_BASE_URL` (default `https://api.clay.com`) from env.
  - [ ] 2.2 Auth: `new ApiKeyHeaderAuth(process.env.CLAY_API_KEY, 'x-api-key')` — confirm header name against Clay docs during implementation; if different, note in Dev Agent Record
  - [ ] 2.3 Add stub method `pushCandidateForEnrichment(profile: ClayOutboundProfile): Promise<ProviderCallResult>` — not called anywhere, documented as "wire-up in Epic 3"
  - [ ] 2.4 Register: `providerRegistry.register('clay-outbound')` and `providerRegistry.wireClient('clay-outbound', client)` at startup (add to existing app-startup module — see Dev Notes for location)
  - [ ] 2.5 Create `src/modules/__tests__/providers-clay-client.test.ts` with minimum 6 tests: happy 200, 429 retry-then-success, 500 retry-exhausted, 401 returns `auth_failure`, timeout returns `transient`, `estimateCost` not invoked (left undefined)

- [ ] **Task 3: Ceipal ATS — BaseProviderClient migration** (AC: 3)
  - [ ] 3.1 Create `src/modules/providers/ceipal/ceipal-auth-strategy.ts` — class `CeipalAuthStrategy implements AuthStrategy`. Holds instance-scoped `tokenCache`. `applyAuth(headers)` returns headers + `Authorization: Bearer <token>`, refreshing when `Date.now() >= expiresAt - 300_000`. Refresh uses `fetch()` directly (auth endpoint is outside the client being authed — see 1.12 pattern in `auth/oauth-token.ts:22-50` for reference, including the 10s timeout wrapper). Parses both XML (`<access_token>` regex from `ceipal.ts:71-73`) and JSON (`ceipal.ts:75-83`). Throws typed errors on: missing credentials, auth HTTP !ok, missing token in response.
  - [ ] 3.2 Create `src/modules/providers/ceipal/ceipal-client.ts` — `CeipalProviderClient` extending `BaseProviderClient`. Config: `{ name:'ceipal', baseUrl: CEIPAL_DATA_URL + '/' + CEIPAL_ENDPOINT_KEY, auth: new CeipalAuthStrategy(), timeoutMs: 10_000 }` (use defaults for `maxRetries`, `backoffMs`, `retryableStatuses`).
  - [ ] 3.3 Add method `fetchApplicants({ since, startPage, maxPages })` with signature matching current `fetchCeipalApplicants()` — delegates to `client.get()` with query string building preserved from `ceipal.ts:170-171` (including `modified_after=YYYY-MM-DD` slice), 1 s inter-page delay (`ceipal.ts:174`), partial-page early exit (`ceipal.ts:195`).
  - [ ] 3.4 Export `clearCeipalTokenCacheForTest` from the new module by delegating to the strategy instance's cache-clear method
  - [ ] 3.5 Replace `src/modules/ats/ceipal.ts` body with a re-export of `fetchApplicants` / `mapCeipalApplicantToCandidate` / `getCeipalCreatedOn` / `clearCeipalTokenCacheForTest` / `CeipalApplicant` from the new module so `src/modules/ingestion/jobs.ts:1` and `src/modules/ats/index.ts` imports don't break (do not alter the import site)
  - [ ] 3.6 Wire health: at startup, `providerRegistry.register('ceipal')` + `providerRegistry.wireClient('ceipal', client)` so every `fetchApplicants` call feeds health tracking
  - [ ] 3.7 Verify `src/modules/__tests__/ceipal.test.ts` and Ceipal cases in `src/modules/__tests__/ingestion-jobs.test.ts` pass unchanged. If the auth `fetch` mock boundary shifts, update the mock target to the new strategy's `refreshToken` method — preserve all assertions.

- [ ] **Task 4: Registry seed + health event persistence** (AC: 4)
  - [ ] 4.1 Create `supabase/migrations/<date>-story-1-12a-clay-ceipal-routing-seed.sql` — idempotent `INSERT … ON CONFLICT (channel) DO NOTHING` for two rows in `provider_routing_policies`: (`enrichment`, `clay`, NULL, `normal`) and (`ats`, `ceipal`, NULL, `normal`)
  - [ ] 4.2 Create or extend the app-startup module (check for existing — likely under `src/modules/startup/` or similar; if none, add to `src/modules/providers/startup.ts`) that on first call: (a) loads routing policies from DB and hydrates `ProviderRegistry.setMode` for each; (b) instantiates `PostgresHealthEventStore` and wires to `providerRegistry.onHealthEvent(event => store.persist(event).then(r => r.ok || console.error('[health-event-store]', r.error)))`
  - [ ] 4.3 Ensure the startup function is idempotent and safe to call multiple times (Next.js route/module may instantiate per request in dev)
  - [ ] 4.4 Call the startup function from `src/modules/providers/index.ts` export `ensureProvidersInitialized()` so consumers can `await` it lazily

- [ ] **Task 5: Full validation — prove zero regression on 2-8, 2-4b, 2-3** (AC: 5)
  - [ ] 5.1 `npm run test` — full suite, zero regressions. Record exact counts in Dev Agent Record → Completion Notes (expect: 38 clay-mapper + 17 clay-route + 8 ceipal + 23 ingestion-jobs + 110 provider-framework + all others = baseline + new tests from Tasks 2 & 3)
  - [ ] 5.2 Run the 3 targeted suites in isolation first to fail fast: `npx vitest run src/modules/__tests__/clay-mapper.test.ts src/app/api/webhooks/clay/__tests__/route.test.ts src/modules/__tests__/ceipal.test.ts src/modules/__tests__/ingestion-jobs.test.ts` — ALL must pass before running the full suite
  - [ ] 5.3 `npm run typecheck` — zero errors
  - [ ] 5.4 `npm run lint` — zero new warnings
  - [ ] 5.5 Run residency preflight: `npm run residency:preflight`
  - [ ] 5.6 Story 2-8 contract smoke (manual): `curl -X POST http://localhost:3000/api/webhooks/clay -H "Authorization: Bearer $CLAY_WEBHOOK_SECRET" -H "Content-Type: application/json" -d @test-fixtures/clay-michaela.json` → assert response JSON has all 5 fields `{received, accepted, skipped, errored, bucket_run_id}`, assert `sync_runs` shows hourly bucket with `source='clay_enrichment'`, assert candidate upserted with `source_recruiter_actor_id` stamped
  - [ ] 5.7 Story 2-8 row-error containment smoke: send a 3-row batch with 1 malformed row → assert 2 accepted, 1 errored, sibling rows still upserted, `sync_errors` row has `run_id` linking to the hourly bucket
  - [ ] 5.8 Story 2-4b UI smoke: open `/dashboard/admin` → `SyncRunSummaryCard` shows the Clay hourly bucket and new Ceipal per-run rows; click "View Errors" on a failed row → drill-down at `/dashboard/admin/sync-errors?runId=xxx` shows grouped errors
  - [ ] 5.9 Story 2-3 smoke: trigger `CeipalIngestionJob` via `POST /api/internal/jobs/run` → assert structured `{provider:'ceipal',…}` logs + one new per-run `sync_runs` row with `source='ceipal'` + `CeipalIngestionJob.lastRunAt` advanced for next invocation
  - [ ] 5.10 Provider registry smoke: `ProviderRegistry.list()` shows `clay`, `clay-outbound`, `ceipal` all with `mode='normal'`, `health='healthy'` after the smoke calls above
  - [ ] 5.11 Double-submit the same Clay payload → assert second submission is deduped at `content_fingerprints` (row count unchanged), assert `webhook_events` has 2 rows (HTTP-level dedup is off for Clay since `provider_event_id=null`), assert hourly bucket counter still increments accepted+skipped correctly

## Dev Notes

### Cross-Story Preservation Map (read this FIRST)

Three done stories already ship the Clay and Ceipal features. This refactor must leave their observable contracts untouched. If any of the following breaks, the migration is wrong.

#### From Story 2-8 (Clay webhook ingestion — 2026-04-16)

| Contract | Where | Rule |
|---|---|---|
| Source string | `sync_runs.source`, `webhook_events.source`, `recordSyncFailure()` arg | MUST be `'clay_enrichment'`. Not `'clay'`. Not `'Clay'`. The 2-4b partial unique index is predicated on this exact string. |
| Hourly-bucket RPC | `upsert_clay_hourly_sync_run(p_accepted, p_skipped, p_errored) → uuid` | Must still be called once per HTTP request (not per row). Keep the Phase 1 (acquire zero-count bucket) → Phase 2 (process rows) → Phase 3 (final-count upsert) pattern from [route.ts:434-493](src/app/api/webhooks/clay/route.ts#L434-L493). `bucket_run_id` echoed in response. |
| Preserve-if-set merge | `upsert_candidate_batch` RPC uses `coalesce(existing.source_recruiter_actor_id, excluded.source_recruiter_actor_id)` | Do NOT touch this RPC or the migration. Clay is the only writer of this column today; preserve that. |
| Response body | `{ received, accepted, skipped, errored, bucket_run_id }` | Shape is contract with Clay operators and future monitoring. Unchanged. |
| Error codes | 401 auth, 400 malformed, 413 oversized, 503 unresolved assignee, 200 success | All preserved. `BaseWebhookReceiver` already maps these except 503 — handle the 503 path in the route wrapper before calling the receiver. |
| Fingerprint | `clay:${profile_id}:${last_refresh}` with `fingerprint_type='ats_external_id'`, `source='ats'` | Row-level dedup stays via `content_fingerprints`. Framework-level `webhook_events.provider_event_id` is `null` for Clay. |
| Env vars | `CLAY_WEBHOOK_SECRET`, `CLAY_DEFAULT_ASSIGNEE_EMAIL`, `CLAY_EMAIL_FIELD`, `CLAY_PHONE_FIELD`, `CLAY_BLOB_FIELD`, `CLAY_WEBHOOK_DEBUG` | All unchanged. Do NOT rename. |
| Test hook | `__resetClayWebhookCacheForTests()` | Still exported from `route.ts`. Existing 17 integration tests call it in `beforeEach`. |
| Test files (DO NOT rewrite) | [clay-mapper.test.ts](src/modules/__tests__/clay-mapper.test.ts) (38 tests), [route.test.ts](src/app/api/webhooks/clay/__tests__/route.test.ts) (17 tests) | Preserve every assertion. Mapper file is frozen (mapper is not migrated). Route test mocks at `@/modules/ingestion`, fingerprint repo, and persistence boundaries — those boundaries don't move. |
| Mapper module | [src/modules/ingestion/clay-mapper.ts](src/modules/ingestion/clay-mapper.ts) | **ZERO CHANGES**. Pure functions. `mapClayRowToCandidate`, `computeClayFingerprint`, `ClayMapperConfig`, `ClayMappedCandidate` — all unchanged. |
| Shared ingestion | `batchUpsertCandidatesFromATS` in [src/modules/ingestion/index.ts](src/modules/ingestion/index.ts) | Clay handler still calls this. No parallel pipeline. `sourceRecruiterActorId` passthrough in `mapToCandidateRow` stays. |

#### From Story 2-4b (Sync run summary + error drill-down — 2026-04-08)

| Contract | Where | Rule |
|---|---|---|
| Summary card | [src/app/dashboard/admin/SyncRunSummaryCard.tsx](src/app/dashboard/admin/SyncRunSummaryCard.tsx) | Reads `sync_runs` rows current-month. Assumes Clay=hourly-bucketed, all others=per-run. Do not invert this. |
| Admin API | [src/app/api/internal/admin/sync-runs/route.ts](src/app/api/internal/admin/sync-runs/route.ts) | Response shape unchanged. Returns ≤200 rows for current month. |
| Error drill-down | [src/app/dashboard/admin/sync-errors/page.tsx](src/app/dashboard/admin/sync-errors/page.tsx), accepts `?runId=xxx` | Groups by error message pattern. Requires `sync_errors.run_id` FK populated. |
| Repository API | [sync-error-repository.ts](src/features/candidate-management/infrastructure/sync-error-repository.ts) | `createSyncRun(source)`, `completeSyncRun(id, counts)`, `failSyncRun(id, err)`, `listSyncRunsCurrentMonth()`, `listSyncErrorsByRun(runId)`, `recordSyncFailure(source, recordId, error, runId?)` — all signatures unchanged. |
| Error linkage | Clay: `recordSyncFailure('clay_enrichment', recordId, err, bucketRunId)` | The `runId` argument MUST be the hourly-bucket ID for Clay, or the per-run ID for Ceipal. Preserves drill-down navigation. |
| Admin page layout | [src/app/dashboard/admin/page.tsx](src/app/dashboard/admin/page.tsx) | 2x2 dashboard grid. `SyncRunSummaryCard` in compact mode (5-row view + "View all"). Do not disturb. |

#### From Story 2-3 (Ceipal ATS connector — baseline)

| Contract | Where | Rule |
|---|---|---|
| Public fetch | `fetchCeipalApplicants({ since?, startPage?, maxPages? }): Promise<CeipalApplicant[]>` exported from `src/modules/ats/ceipal.ts` | Signature frozen. Internal implementation can swap to `BaseProviderClient`, but the exported function signature and behavior must match. |
| Mapper | `mapCeipalApplicantToCandidate(applicant)`, `getCeipalCreatedOn(applicant)` | Frozen — unchanged. |
| Type | `CeipalApplicant` (40+ optional fields; **SSN intentionally excluded**) | Frozen. Do NOT add SSN or other PII. |
| Test hook | `clearCeipalTokenCacheForTest()` exported | Must still work. After migration, it delegates to the new auth strategy's cache clear. |
| Job class | `CeipalIngestionJob` in [jobs.ts:96-192](src/modules/ingestion/jobs.ts#L96-L192) | Body unchanged. `lastRunAt` instance state + automatic incremental sync preserved. Only the `fetchCeipalApplicants()` call site swaps internal transport to the new client. |
| Log prefix | `[Ceipal]` on token acquisition + errors | Preserved. The new `CeipalProviderClient` can add its own structured `{provider:'ceipal',…}` logs in parallel, but the existing `[Ceipal]` lines must stay (tests / operator runbooks assume them). |
| Fingerprint batch | `recordFingerprintBatch(fpEntries)` — single call per page | Preserved. Do NOT regress to N sequential calls. |
| `extra_attributes` | `additionalFields` in Ceipal mapper routes through `mapToCandidateRow` → `extra_attributes` column | Preserved — do not drop this passthrough. |
| Token response parsing | Both XML `<access_token>` regex and JSON with `expires_in` | Both paths must work. Ceipal server may return either. |
| Env vars | `CEIPAL_API_KEY`, `CEIPAL_USERNAME`, `CEIPAL_PASSWORD`, `CEIPAL_ENDPOINT_KEY`, `CEIPAL_AUTH_URL`, `CEIPAL_DATA_URL` | Unchanged. |

### Current Code Map (read these before writing anything)

| Area | File | Key lines |
|---|---|---|
| Clay webhook route | [src/app/api/webhooks/clay/route.ts](src/app/api/webhooks/clay/route.ts) | auth 309-336, size check 348-379, normalize 151-178, per-row 198-291, hourly bucket 434-493 |
| Clay mapper (unchanged) | [src/modules/ingestion/clay-mapper.ts](src/modules/ingestion/clay-mapper.ts) | parse 81-120, pick title 128-144, fingerprint 324-355 |
| Clay tests | [src/app/api/webhooks/clay/__tests__/route.test.ts](src/app/api/webhooks/clay/__tests__/route.test.ts) | 522 lines, 55 tests, mocks at `@/modules/ingestion` / fingerprint / persistence boundaries |
| Ceipal connector | [src/modules/ats/ceipal.ts](src/modules/ats/ceipal.ts) | token 47-95, fetch 155-210, mapper 215-267, test hook 269-271 |
| Ceipal job | [src/modules/ingestion/jobs.ts](src/modules/ingestion/jobs.ts#L96-L192) | `CeipalIngestionJob` class — DO NOT change its public surface |
| Ceipal tests | [src/modules/__tests__/ceipal.test.ts](src/modules/__tests__/ceipal.test.ts) | 104 lines, 8 tests |
| Framework entry | [src/modules/providers/index.ts](src/modules/providers/index.ts) | all framework exports — import from here, never deep-import |

### Framework Extension Points (use these — do not reinvent)

- **Outbound:** `new BaseProviderClient(ProviderConfig)` with `baseUrl`, `auth: AuthStrategy`, defaults `timeoutMs=10_000`, `maxRetries=3`, `retryableStatuses=[408,429,500,502,503,504]`. Call with `client.get/post/put/delete()` or `client.request()`.
- **Outbound auth:** `BearerTokenAuth`, `ApiKeyHeaderAuth`, `OAuthTokenAuth` from `providers/auth/*`. For Ceipal's custom token-exchange flow, write a new `CeipalAuthStrategy implements AuthStrategy` — do NOT modify existing auth classes.
- **Inbound receiver:** `new BaseWebhookReceiver(WebhookReceiverConfig, WebhookEventStore)` where `extractEvents` is the fan-out hook for Clay batches. The receiver handles size, signature, replay, dedup, rate limit, and storage. Your job is just to supply auth + `extractEvents`.
- **Inbound auth:** `BearerTokenWebhookAuth(secret)` uses SHA-256 rehash + `timingSafeEqual` — safe for multi-byte UTF-8 secrets.
- **Handler:** `WebhookHandler.handle(event) → WebhookHandlerResult | void`. Return `{meta}` to populate `webhook_events.result_meta`.
- **Processor:** `new WebhookProcessor(config, eventStore, handlersByType)` drains claimed events. For Clay, use event_type routing to the one Clay handler.
- **Registry:** `ProviderRegistry.register(name, client?)`, `.wireClient(name, client)`, `.onHealthEvent(cb)`, `.setMode(name, mode, reason)`, `.list()`, `.isAvailable(name)`. Auth-failure classifications are already excluded from kill-switch math — no action needed on your side.
- **Health persistence:** `new PostgresHealthEventStore({ insert: row => supabase.from('provider_health_events').insert(row) })` + wire to `registry.onHealthEvent`. Non-throwing — returns `{ok, error?}`.

### Migration Patterns (zero-regression rules)

1. **Preserve public signatures.** `fetchCeipalApplicants(options)` and `CeipalIngestionJob` callers see identical types, identical return shapes, identical error semantics. The change is internal plumbing.
2. **Preserve env var names.** `CLAY_WEBHOOK_SECRET`, `CLAY_DEFAULT_ASSIGNEE_EMAIL`, `CLAY_EMAIL_FIELD`, `CLAY_PHONE_FIELD`, `CLAY_BLOB_FIELD`, `CEIPAL_API_KEY`, `CEIPAL_USERNAME`, `CEIPAL_PASSWORD`, `CEIPAL_ENDPOINT_KEY`, `CEIPAL_AUTH_URL`, `CEIPAL_DATA_URL` — all unchanged. Add new ones (`CLAY_API_KEY`, `CLAY_API_BASE_URL`) only for AC 2.
3. **Preserve log shapes where tests / dashboards consume them.** The provider framework emits a new structured `ProviderLogEntry` — that's additive. Do NOT remove existing `console.log('[Ceipal] …')` lines that tests assert on; leave them and let the framework log in parallel.
4. **Content-level dedup stays in the handler.** The webhook-level `webhook_events` dedup is HTTP-delivery dedup. Clay's row-level dedup is `content_fingerprints` — keep that check in the handler. Two layers, different purposes.
5. **`provider_event_id=null` is correct for Clay.** Clay payloads have no stable UUID per row. Setting it lets `INSERT ... ON CONFLICT DO NOTHING` always insert (`UNIQUE(source, provider_event_id) WHERE provider_event_id IS NOT NULL` partial index means null values don't participate in dedup).
6. **Dual-write `sync_runs` in the Clay handler.** The Story 2.4b admin dashboard reads from `sync_runs`, not `webhook_events`. Keep the `upsert_clay_hourly_sync_run` RPC — pass the `syncRunId` back through `WebhookHandlerResult.meta.syncRunId` so the linkage is audit-visible.
7. **Do not touch `clay-mapper.ts`.** It's pure, unit-tested, and the framework migration doesn't require changes to mapping logic.
8. **Leave `CeipalIngestionJob` scheduling & fingerprint-batch logic alone.** Only the HTTP-call layer moves to the framework. The job's page loop, 3-consecutive-skip break, and `sync_runs` tracking stay in `jobs.ts`.
9. **Use `src/modules/ingestion/fetch-with-retry.ts`** for the Ceipal token-exchange POST inside the auth strategy if easier, OR native `fetch` wrapped with `AbortController` + 10 s timeout (mirrors `auth/oauth-token.ts:refreshToken`). Pick one and be consistent — do not leave both.
10. **Do not add new dependencies.** The framework is zero-dep `fetch`-based; keep it that way.

### Testing Approach

- **Clay route tests (55):** mocks are at `@/modules/ingestion`, fingerprint repo, and persistence boundaries. The migration should not need test changes because those mock targets don't move. If a test reaches inside `route.ts` for internal state (`cachedAssigneeUserId`), export the helper from the new handler module and update only the import path in the test.
- **Ceipal tests (8):** mocks `fetch` globally. After migration, if the auth-refresh `fetch` site moves to the strategy, update the mock to target that module — preserve the assertions.
- **New tests:** add `providers-clay-client.test.ts` (6 min tests) and `providers-ceipal-client.test.ts` (minimum 8: happy path, token cache hit, token cache miss → refresh, auth failure → `auth_failure` classification, 429 retry, 500 retry, timeout, pagination with `since`).
- **Integration test (new):** `providers-clay-webhook-integration.test.ts` — POST to receiver with a known 3-row payload, assert 3 rows in `webhook_events`, 3 calls to mocked `batchUpsertCandidatesFromATS`, `result_meta.syncRunId` populated.
- **Coverage gates:** match the 1.12 story's density — minimum 15 tests for any new `BaseProviderClient` consumer, minimum 10 for any new `BaseWebhookReceiver` consumer.

### Things NOT to Change in This Story

- `src/modules/providers/**` (framework source) — immutable in this story unless a bug is found; if so, fix it in a sibling commit and note in Dev Agent Record.
- `supabase/migrations/2026-04-16-story-1-12-provider-framework.sql` — frozen.
- `clay-mapper.ts`, `batchUpsertCandidatesFromATS`, fingerprint repo, `sync_runs` schema.
- `CeipalIngestionJob.run()` body (only the `fetchCeipalApplicants` call it makes swaps to the new client internally).
- Any route other than `/api/webhooks/clay`.
- Any scheduler config / policy versioning (Story 2.7 territory).

### Startup Wiring Location

The existing codebase does not yet have a single "providers init" module. Add it under `src/modules/providers/startup.ts` exporting `ensureProvidersInitialized(): Promise<void>` with:
- Idempotency guard (`let initialized = false`).
- Load all rows from `provider_routing_policies` and call `ProviderRegistry.setMode(row.primary_provider, row.mode, 'startup-restore')` for each.
- Instantiate `PostgresHealthEventStore` bound to the Supabase admin client.
- Wire `registry.onHealthEvent(e => store.persist(e).then(r => r.ok || console.error('[health-event-store] persist failed', r.error)))`.
- Register `clay`, `clay-outbound`, `ceipal` with their clients.

Call `ensureProvidersInitialized()` from:
- The Clay webhook route (`/api/webhooks/clay`) at the top of the handler before `receiver.receive()`.
- The Ceipal job `run()` at the top before the first fetch.

This lazy-init keeps cold-start cheap in serverless and avoids module-load-time DB calls.

### Reference: Framework Interface Changes from 1.12 Code Review (Round 2)

These were added/changed in Story 1.12 specifically to unblock 1-12a — use them:
- `WebhookHandlerResult` with `meta` field → use for `syncRunId` + `candidateId` traceability.
- `extractEvents` with explicit Clay-shapes docstring in `types.ts:216-243` → copy those 4 cases.
- `CostContext.costMeta` typed fields → use `{ endpoint }` for Ceipal; Anthropic fields are for 1-12b.
- `result_meta` JSONB column on `webhook_events` → already migrated, your handler result lands here.
- Default retryable statuses widened to `[408, 429, 500, 502, 503, 504]` (501 removed) → matches `fetchWithRetry`, no regression on Ceipal transient errors.
- `WebhookEventStore.insertIfNotDuplicate()` atomic → use the provided Postgres implementation, do not write your own.

## References

- [Source: _bmad-output/architecture.md §25](_bmad-output/architecture.md) — Edge System Provider Framework spec
- [Source: _bmad-output/architecture.md §7](_bmad-output/architecture.md) — Thin webhook receiver pattern
- [Source: _bmad-output/architecture.md §19](_bmad-output/architecture.md) — Kill switch + routing policies
- [Source: _bmad-output/stories/1-12-edge-system-provider-framework.md](_bmad-output/stories/1-12-edge-system-provider-framework.md) — Parent framework story; see "Migration notes for 1-12a" section
- [Source: _bmad-output/epics.md#Story-1.12a](_bmad-output/epics.md) — Original epic entry
- [Source: src/app/api/webhooks/clay/route.ts](src/app/api/webhooks/clay/route.ts) — Current Clay webhook (516 lines)
- [Source: src/modules/ats/ceipal.ts](src/modules/ats/ceipal.ts) — Current Ceipal connector (272 lines)
- [Source: src/modules/ingestion/jobs.ts](src/modules/ingestion/jobs.ts#L96-L192) — `CeipalIngestionJob`
- [Source: src/modules/providers/types.ts](src/modules/providers/types.ts) — All framework type signatures
- [Source: src/modules/providers/index.ts](src/modules/providers/index.ts) — Public framework exports
- [Source: supabase/migrations/2026-04-16-story-1-12-provider-framework.sql](supabase/migrations/2026-04-16-story-1-12-provider-framework.sql) — DB schema (webhook_events, provider_routing_policies, provider_health_events)

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
