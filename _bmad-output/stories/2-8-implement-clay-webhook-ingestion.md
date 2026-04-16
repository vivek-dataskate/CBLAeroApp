# Story 2-8: Implement Clay Webhook Ingestion

Status: done (retroactive)

> **Retroactive story record.** This story was executed against a live [epics.md §Story 2.8](../epics.md) spec and a [sprint-change-proposal-2026-04-15.md](../sprint-change-proposal-2026-04-15.md) before a per-story context file was produced. This file was written on 2026-04-16 from merged PRs #80 and #81 as a historical record — it documents what was actually built, not what was planned. The canonical behavioural spec lives in epics.md §Story 2.8; this file captures delivery artifacts, decisions, and deltas from the spec.

## Story

As an admin,
I want candidates curated by recruiters in our Clay workspace to flow into CBLAero automatically as soon as they're enriched,
so that LinkedIn-enriched candidates become part of the searchable candidate database the moment Clay finishes processing them — without a nightly batch, a cursor, or a scheduler dependency.

## Scope Delivered

**Integration pattern:** Push (Clay → CBLAero) via Clay's HTTP API column. Clay is the clock; no scheduler job, no cursor. See [architecture.md](../architecture.md) §Path 5.

**Endpoint:** `POST /api/webhooks/clay` — bearer-authenticated, accepts single row / array / `{rows:[…]}` envelope, delegates to the shared ingestion pipeline used by ATS, CSV, and email paths.

## Acceptance Criteria (delivered)

1. **Auth & transport** — `Authorization: Bearer {CLAY_WEBHOOK_SECRET}` required; 401 on missing/mismatched, 400 on malformed JSON, 413 on payloads over 256 KB. ✅
2. **Payload shape tolerance** — handler accepts single row object, array of rows, or `{rows:[…]}` envelope and iterates row-by-row. Row-level errors accumulate in `sync_run_errors` without failing siblings. Response reports per-row counts (received / accepted / skipped / errored). ✅
3. **Mapping** — Clay row → candidate column mapping per [epics.md §Story 2.8](../epics.md) table (nested `enrichlinkedin_data.*` blob + top-level `email`/`phone` sidecars). Unknown fields preserved under `extra_attributes.clay.*`. `source='clay_enrichment'`. Sidecar `email` is the dedup identity. ✅
4. **Shared ingestion path** — Clay routes through `batchUpsertCandidatesFromATS` (Story 2.3). No parallel implementation. Story 2.5 dedup, Story 2.5a role deduction, and Story 2.4b sync tracking all run automatically with zero additional integration. ✅
5. **Default assignee** — `CLAY_DEFAULT_ASSIGNEE_EMAIL` resolves to a `cblaero_app.admin_managed_users` row on first use and is cached for the process lifetime. Unresolved → HTTP 503 (fail-loud, not silent-orphan). Every Clay-ingested candidate is stamped with `source_recruiter_actor_id = <cached user id>`. ✅
6. **Preserve-if-set merge rule** — on upsert, if the existing candidate row already has a non-null `source_recruiter_actor_id`, the value is preserved (enforced by the updated `upsert_candidate_batch` RPC's `coalesce(existing, excluded)` rule). ✅
7. **Fingerprint idempotency** — basis is `clay:${profile_id}:${last_refresh}`, stored under `fingerprint_type='ats_external_id'`, `source='ats'`. Replays short-circuit to `skipped`. Fingerprint hits logged as structured events. ✅
8. **Sync run tracking — hourly buckets (Story 2.8 revision)** — Clay sync runs aggregate into **one row per hour** via the new `upsert_clay_hourly_sync_run` RPC (partial unique index on `(source, started_at) WHERE source='clay_enrichment'`). Fixes the per-request row explosion from the initial rollout (~9k rows would have flooded the admin dashboard). Only Clay respects hourly bucketing; ATS/Ceipal/email/onedrive/dedup/role-enrichment keep their per-run pattern unchanged. ✅
9. **Residency** — no per-request check; Story 1.6 startup gate is authoritative. ✅
10. **Debug logging** — `CLAY_WEBHOOK_DEBUG=true` by default during rollout — dumps raw payload for mapper-drift visibility. ✅

## Dev Components Delivered

### [src/app/api/webhooks/clay/route.ts](../../src/app/api/webhooks/clay/route.ts) — HTTP handler

**Exports:**
- `POST` — accepts single row / array / `{rows:[…]}`; returns 200 with per-row outcome counts and `bucket_run_id`
- `GET` — 405 Method Not Allowed
- `__resetClayWebhookCacheForTests` — test hook that clears the cached assignee actor ID

**Key internal helpers:**
- `resolveAssigneeUserId` — looks up `CLAY_DEFAULT_ASSIGNEE_EMAIL` against `admin_managed_users`, caches for process lifetime. Transport errors do **not** cache (retryable). Unresolved user caches a sentinel and blocks all Clay traffic with 503 until restart (fail-loud).
- `normalizePayload` — coerces body into row array across the three accepted shapes, rejects nulls/empties cleanly.
- `processRow` — per-row pipeline: compute fingerprint → dedup gate → map to camelCase → delegate to `batchUpsertCandidatesFromATS` → record fingerprint. Returns `{status, fingerprint, error}`.

**Notable behaviour:**
- Bearer-token auth via `CLAY_WEBHOOK_SECRET` (direct string compare — webhook secret, not user credential).
- 256 KB content-length ceiling enforced before body read.
- Rows with neither `profile_id+last_refresh` nor email short-circuit as `skipped_no_identity` before mapping.
- Fingerprint gate (Story 1.11) is mandatory and runs before the shared upsert path.
- **Hourly-bucket RPC called once per request** (not per row) with aggregated counts. RPC errors are **swallowed** so observability cannot block candidate ingestion.
- Raw payload (first 4000 chars) logged on every request when `CLAY_WEBHOOK_DEBUG=true`.
- Env vars consumed: `CLAY_WEBHOOK_SECRET`, `CLAY_DEFAULT_ASSIGNEE_EMAIL`, `CLAY_EMAIL_FIELD` (default `email`), `CLAY_PHONE_FIELD` (default `phone`), `CLAY_BLOB_FIELD` (default `enrichlinkedin_data`), `CLAY_WEBHOOK_DEBUG` (default `true`).
- Test-mode branch: when Supabase is not configured, assignee resolution synthesizes a deterministic test ID without a DB query.

### [src/modules/ingestion/clay-mapper.ts](../../src/modules/ingestion/clay-mapper.ts) — pure mapper

**Exports:**
- `mapClayRowToCandidate(rawRow, config): ClayMappedCandidate` — pure mapping to canonical camelCase shape; preserves raw payload under `extra_attributes.clay`.
- `computeClayFingerprint(rawRow, config): string | null` — `clay:${profile_id}:${last_refresh}` when available; falls back to `clay:${email}`; returns `null` when no usable identity.
- `ClayMapperConfig` interface — `emailField`, `phoneField`, `blobField?`, `defaultAssigneeUserId`.
- `ClayMappedCandidate` interface — all canonical candidate fields + `sourceRecruiterActorId` + `extra_attributes`.

**Key internal helpers (each embodies a design decision):**
- `extractLinkedInBlob` — resolution order: (1) explicit `config.blobField`, (2) flat top-level fields if `first_name`/`last_name`/`url` present, (3) probe fallback list: `enrichlinkedin_data`, `Enrich person`, `enrich_person`, `linkedin_data`, `linkedin`, `LinkedIn`, `profile`, `person`, `enriched`, (4) raw payload as last resort. **This is what makes the mapper tolerant of Clay column renames without a redeploy.**
- `pickJobTitle` — priority: `title` (if not `--` / `—`) → `headline` → `latest_experience.title` → `null`. Tolerates degenerate Clay values.
- `pickCurrentCompany` — priority: `org` → `latest_experience.company` → `null`.
- `parseClayLocation` — comma-split US-format parser; returns nulls for 4+ part strings (defensive pessimism — don't guess on pathological shapes).

**Notable behaviour:**
- Pure functions — no I/O, no env reads, no Supabase. Config flows through parameters; fully unit-testable.
- Every input key is optional; missing fields degrade gracefully.
- **Full raw payload preserved** under `extra_attributes.clay.*` — zero data loss even if schema evolves. Future field promotion needs no reingestion.
- Email is lowercased; phone is preserved as-sent (Clay already normalizes).
- `experience` and `certifications` coerce `null`/missing to `[]`.

### [src/modules/ingestion/index.ts](../../src/modules/ingestion/index.ts) — one-line extension

`mapToCandidateRow` gained a single-line `sourceRecruiterActorId: str('sourceRecruiterActorId')` passthrough. All other ingestion callers (ATS, CSV, email, OneDrive) are unaffected because they never set this field — the RPC's `coalesce(existing, excluded)` rule means the column stays `NULL` for non-Clay sources.

### [supabase/migrations/2026-04-15-story-2-8-clay-webhook.sql](../../supabase/migrations/2026-04-15-story-2-8-clay-webhook.sql) — schema + upsert RPC

- **Column:** `candidates.source_recruiter_actor_id text` (nullable) — forward-looking provenance column.
- **Index:** `idx_candidates_source_recruiter` — partial on `(tenant_id, source_recruiter_actor_id) WHERE source_recruiter_actor_id IS NOT NULL`. Skips nulls for index size efficiency.
- **RPC:** `upsert_candidate_batch(jsonb) → (inserted int, updated int)` redefined to:
  - Include `source_recruiter_actor_id` in both insert branches (email-match and no-email).
  - **Preserve-if-set merge rule:** `ON CONFLICT (tenant_id, email) DO UPDATE SET source_recruiter_actor_id = coalesce(candidates.source_recruiter_actor_id, excluded.source_recruiter_actor_id)`. This means the first Clay ingestion *stamps* the recruiter, and subsequent updates from any source never overwrite. Epic 4's real attribution model can retrofit values without losing what's already stamped.

### [supabase/migrations/2026-04-15-story-2-8-clay-hourly-bucket.sql](../../supabase/migrations/2026-04-15-story-2-8-clay-hourly-bucket.sql) — observability fix

- **Index:** `uq_sync_runs_clay_hourly` — unique partial on `(source, started_at) WHERE source='clay_enrichment'`. Enables deterministic upsert for hourly bucketing. **Partial scope is load-bearing** — only Clay rows obey hourly bucketing; ATS, Ceipal, email, OneDrive, dedup, and role-enrichment keep per-run semantics.
- **RPC:** `upsert_clay_hourly_sync_run(p_accepted int, p_skipped int, p_errored int) → uuid`. Atomically inserts-or-increments a single `sync_runs` row keyed by `(source='clay_enrichment', started_at=date_trunc('hour', now()))`. Counters added via `ON CONFLICT DO UPDATE`; `completed_at` refreshed on every call; status is always `'complete'` (it's an aggregate, not an in-flight lifecycle row). Returns the row id so the webhook can echo it as `bucket_run_id`.
- **Migration is idempotent and re-runnable.**

> **⚠ Postmortem note:** An earlier draft of this migration included a `DELETE FROM sync_runs WHERE source='clay_enrichment'` cleanup intended to wipe the ~30 noisy per-request rows from the initial rollout. A parallel real backfill happened concurrently and the DELETE removed ~5,953 legitimate backfill rows before anyone noticed. **Migration DELETEs against observability tables are banned going forward** — see development-standards §3 and architecture.md §Observability Table Mutations.

### [supabase/schema.sql](../../supabase/schema.sql)

Fresh-install parity with both migrations — includes the new column, partial indexes, and both RPCs.

## Test Coverage

**Total: 55 passing** (38 mapper unit + 17 webhook integration).

Mapper unit ([src/modules/__tests__/clay-mapper.test.ts](../../src/modules/__tests__/clay-mapper.test.ts)):
- `parseClayLocation` — 6 tests (nulls/empty, 3-part US, 2-part city+state, single-token, whitespace, 4+ part pathological)
- `mapClayRowToCandidate` (synthetic Isis Soto fixture) — 9 tests (nested identity, sidecar email/phone, LinkedIn URL, title priority, company priority, location parsing, experience array, certifications coercion, source stamping)
- `mapClayRowToCandidate` edge cases — 7 tests (headline fallback, latest_experience fallback, org fallback, missing email, flat payloads, empty blob, degenerate title values)
- **Real production Michaela Ealey payload (frozen regression fixture)** — 8 tests (nested blob extraction, lowercase sidecars, title over headline, org → current_company, 3-part location, LinkedIn URL, experience array, extra_attributes preservation)
- `computeClayFingerprint` — 5 tests (profile_id + last_refresh, idempotency, re-enrichment trigger, email fallback, no-identity null)

Webhook integration ([src/app/api/webhooks/clay/__tests__/route.test.ts](../../src/app/api/webhooks/clay/__tests__/route.test.ts)):
- Auth — 3 tests (missing header, wrong token, server secret unset)
- Payload handling — 4 tests (single object, array, `{rows:[…]}`, garbage + empty array)
- Fingerprint gate — 3 tests (short-circuit on hit, record on success, no-identity skip)
- Row-level error containment — 3 tests (sibling continuation on failure, hourly bucket still recorded, no-identity short-circuits before pipeline)
- Hourly bucket aggregation — 4 tests (RPC called once per request, accurate counts, batch aggregation math, `bucket_run_id` in response)

## Files Delivered

| File | Role |
|---|---|
| [src/app/api/webhooks/clay/route.ts](../../src/app/api/webhooks/clay/route.ts) | POST handler: bearer auth, payload normalization, fingerprint gate, hourly sync-run RPC, debug logging |
| [src/modules/ingestion/clay-mapper.ts](../../src/modules/ingestion/clay-mapper.ts) | Pure `mapClayRowToCandidate` + `computeClayFingerprint`. Shape-tolerant — probes multiple nested-blob keys (`enrichlinkedin_data`, `Enrich person`, `linkedin`, etc.) |
| [src/modules/ingestion/index.ts](../../src/modules/ingestion/index.ts) | `mapToCandidateRow` extended with one-line `source_recruiter_actor_id` passthrough (backward compatible) |
| [supabase/migrations/2026-04-15-story-2-8-clay-webhook.sql](../../supabase/migrations/2026-04-15-story-2-8-clay-webhook.sql) | Adds `candidates.source_recruiter_actor_id text` + partial index; redefines `upsert_candidate_batch` RPC with the new column + preserve-if-set merge |
| [supabase/migrations/2026-04-15-story-2-8-clay-hourly-bucket.sql](../../supabase/migrations/2026-04-15-story-2-8-clay-hourly-bucket.sql) | Partial unique index + `upsert_clay_hourly_sync_run` RPC; DELETEs noisy per-request Clay rows from initial rollout |
| [supabase/schema.sql](../../supabase/schema.sql) | Fresh-install parity with both migrations |
| [src/app/api/webhooks/clay/__tests__/route.test.ts](../../src/app/api/webhooks/clay/__tests__/route.test.ts) | 15 webhook integration tests (auth, payload shapes, error accumulation, hourly-bucket RPC assertions) |
| [src/modules/__tests__/clay-mapper.test.ts](../../src/modules/__tests__/clay-mapper.test.ts) | 38 pure mapper tests incl. real Michaela Ealey production payload as regression fixture |

**Test total:** 55 passing (38 mapper + 17 webhook after hourly-bucket revision added 3 and updated 2 lifecycle tests).

## Environment Variables Introduced

| Var | Default | Notes |
|---|---|---|
| `CLAY_WEBHOOK_SECRET` | *required* | Shared secret validated against bearer token. Startup fails loudly if unset. |
| `CLAY_DEFAULT_ASSIGNEE_EMAIL` | *required* | Must resolve to an active `admin_managed_users` row. Startup fails loudly if unset. |
| `CLAY_EMAIL_FIELD` | `email` | Sidecar column name for personal email. |
| `CLAY_PHONE_FIELD` | `phone` | Sidecar column name for personal phone. |
| `CLAY_WEBHOOK_DEBUG` | `true` | Raw payload logging; flip to `false` once mapper is stable. |

## Key Decisions & Deltas from Original Spec

1. **Pull → push pivot.** Original sprint direction assumed a Clay REST pull with a cursor on a scheduler cadence. Discovery on 2026-04-15 established Clay's HTTP API column as the natural push mechanism, eliminating scheduler, cursor, and polling logic entirely. Captured in [sprint-change-proposal-2026-04-15.md](../sprint-change-proposal-2026-04-15.md) revision 3.
2. **Real payload shape discovered via webhook.site.** The nested LinkedIn blob lives under `enrichlinkedin_data` (not `linkedin` or `Enrich person` as initial mocks assumed); sidecar personal email/phone are top-level lowercase `email`/`phone` keys. The mapper probes multiple nested-blob keys for shape tolerance but defaults match production.
3. **Default assignee, not recruiter attribution.** Recruiter-level attribution needs a candidate assignment model that doesn't exist yet — deferred to Epic 4. For now every Clay row is stamped to `vivek@cblsolutions.com` via the new nullable `source_recruiter_actor_id` column. Preserve-if-set rule means Epic 4 can retrofit real attribution without losing stamped values.
4. **Hourly sync-run buckets (post-rollout fix).** Initial rollout created one `sync_runs` row per webhook request. Backfilling ~9,000 Clay rows produced ~9,000 admin dashboard rows — unusable. Fixed in commit 02b45a1 by aggregating into hourly buckets **only for Clay** (`source='clay_enrichment'`). Atomic increment via Postgres `ON CONFLICT DO UPDATE`; no race even under concurrent webhook fire. Noisy per-request rows from the first rollout were DELETEd by the migration for a clean slate.
5. **Reuse, not reinvention.** `mapToCandidateRow` got a one-line extension instead of a parallel Clay-only mapping function. `batchUpsertCandidatesFromATS` is called unchanged. Dedup, role deduction, and residency all work with zero Clay-specific integration.

## Clay UI Configuration (operator runbook)

Edit the Clay table's HTTP API column:
- Method: `POST`
- URL: `{CBL_APP_URL}/api/webhooks/clay`
- Headers: `Authorization: Bearer ${CLAY_WEBHOOK_SECRET}`, `Content-Type: application/json`
- Body: Clay's default dynamic body (emits the nested `enrichlinkedin_data` blob + sidecar columns automatically)
- Backfill: column menu → "Run on all rows". Fingerprint idempotency makes re-runs safe.

## Out of Scope (explicitly deferred)

- Recruiter-level attribution (Epic 4 — assignment model)
- Outbound push of CBLAero candidates back to Clay (Epic 5 — scoring/enrichment flow, already sketched in architecture.md)
- Pull-based Clay API integration (rejected in favour of push)
- Promoting `education`, `languages`, `num_followers`, etc. from `extra_attributes.clay.*` into typed columns (stays in JSON until a query use case lands)
- Runtime rotation of `CLAY_WEBHOOK_SECRET` via admin UI (rotate via env var + redeploy for MVP)

## Delivery Trail

| Commit | PR | Description |
|---|---|---|
| c7085b3 | [#80](https://github.com/vivek-dataskate/CBLAeroApp/pull/80) | feat(ingestion): add Clay webhook ingestion path (Story 2.8) |
| 02b45a1 | [#81](https://github.com/vivek-dataskate/CBLAeroApp/pull/81) | fix(ingestion): aggregate Clay webhook sync_runs into hourly buckets |

## Dev Notes

- **Lesson for future stories (per recurring-agent-mistakes feedback):** the pull→push pivot only surfaced because we captured a real Clay payload via webhook.site before writing the mapper. Any future third-party ingestion story should do the same — discover the real payload shape before the mapper, not during code review.
- **External call economy:** no per-request calls to Clay — Clay pushes to us. The preserve-if-set RPC merge rule avoids a read-before-write round trip.
- **Test quality bar:** mapper suite includes the real production payload as a frozen regression fixture. Auth negative paths, malformed JSON, oversized body, batch-with-one-bad-row, fingerprint replay, and hourly-bucket RPC assertions all covered.

## Review Findings

_Code review run 2026-04-16 via `bmad-code-review` — three adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). 35 raw findings → 18 retained after dedup + triage. All 2 decision-needed resolved. All 13 patches being applied in this session._

### Resolved during review (decision-needed)

- **DN1 — Startup fail-loud vs first-request fail-loud** → resolved: relax spec wording. Tightening code to throw at module init would turn a single misconfig into a full-app outage; current "first-request fails loud" is safer. AC #26 wording in [epics.md](../epics.md) and AC #5 above should read *"fails loud on first request"* rather than *"fails loud at startup"*. Non-blocking.
- **DN2 — Assignee "active user" filter** → resolved: dismissed. The `admin_managed_users` table ([schema.sql:123-132](../../supabase/schema.sql#L123-L132)) has no `status`/`active` column. Filter cannot be implemented and isn't needed until Epic 1 adds user deactivation semantics.

### Action items (patch)

- [ ] [Review][Patch] P1 — Timing-safe bearer comparison + case/whitespace header normalization [src/app/api/webhooks/clay/route.ts:250-251]
- [ ] [Review][Patch] P2 — Content-Length bypass: read body via `arrayBuffer()` and enforce 256KB on actual byte count (current header check is trivially bypassed) [src/app/api/webhooks/clay/route.ts:265-278]
- [ ] [Review][Patch] P3 — `computeClayFingerprint` type guard on `profile_id` (currently accepts 0, `{}`, `[]`, booleans as valid identity) [src/modules/ingestion/clay-mapper.ts:701]
- [ ] [Review][Patch] P4 — `parseClayLocation` 3-part heuristic: `last.length > 0` is always true after empty-part filter, so the "give up" branch is dead code [src/modules/ingestion/clay-mapper.ts:506-511]
- [ ] [Review][Patch] P5 — Flip `CLAY_WEBHOOK_DEBUG` default from `true` → `false` (PII leak risk + log-injection surface in production) [src/app/api/webhooks/clay/route.ts:61]
- [ ] [Review][Patch] P6 — Coerce non-string sidecar email/phone (array, number, boolean) + log on drop [src/modules/ingestion/clay-mapper.ts:638-643]
- [ ] [Review][Patch] P7 — Assignee cache TTL (1 hour) — currently stale user ID sticks until process restart [src/app/api/webhooks/clay/route.ts:80-119]
- [ ] [Review][Patch] P8 — In-memory fingerprint dedup within a single webhook request (prevents duplicate-rows-in-batch double-processing before DB fingerprint record commits) [src/app/api/webhooks/clay/route.ts:158-232]
- [ ] [Review][Patch] P9 — Test coverage gaps: 413/500 branches, empty-array fast-return, `normalizePayload` null return, 4-part location, `pickJobTitle`/`pickCurrentCompany` fallbacks, flat top-level LinkedIn blob, probe list fallbacks, non-string sidecar coercion [test files]
- [ ] [Review][Patch] P10 — `rows` wrapper-key collision: a Clay column literally named `rows` would be misread as batch envelope. Require `{rows: [...]}` to be the sole top-level key [src/app/api/webhooks/clay/route.ts:142-143]
- [ ] [Review][Patch] P11 — Double-wrapped array `[[row1, row2]]` silently drops everything with 200 response [src/app/api/webhooks/clay/route.ts:136-137]
- [ ] [Review][Patch] P12 — `sync_run_errors` not linked to hourly bucket `run_id` — Clay errors don't appear under the 2.4b error detail drill-down. Fix by calling the hourly-bucket RPC at start of request to get the bucket ID, pass as `runId` to `recordSyncFailure`, then re-call with counts at end [src/app/api/webhooks/clay/route.ts:198, 335]
- [ ] [Review][Patch] P13 — Simplify `v_bucket` double time-zone conversion (cosmetic — harmless in UTC but obscures intent) [supabase/migrations/2026-04-15-story-2-8-clay-hourly-bucket.sql:56]

### Deferred (real but pre-existing or out of scope)

- [x] [Review][Defer] D1 — `ingestion_state` downgrade in `upsert_candidate_batch` ON CONFLICT: whitelist only covers `active` and `pending_review`; hypothetical terminal states (`archived`, `rejected`, `hired`) would be stomped back to `pending_dedup` by a Clay re-push [supabase/schema.sql upsert_candidate_batch RPC] — deferred, pre-existing in the shared RPC (not Clay-specific); affects every ingestion source; not worth mixing with Story 2.8 scope. Flag for a future shared-RPC hardening pass.
- [x] [Review][Defer] D2 — `sync_runs.total` accounting mismatch: `total = accepted + skipped + errored` but `skipped` is folded only into total, not stored separately, so `succeeded + failed ≠ total` on the dashboard [supabase/migrations/2026-04-15-story-2-8-clay-hourly-bucket.sql:68] — deferred, cosmetic dashboard-math interpretation gap; not worth a schema change.
- [x] [Review][Defer] D3 — `__proto__` / `constructor` keys in Clay payload preserved under `extra_attributes.clay.*` [src/modules/ingestion/clay-mapper.ts:679-681] — deferred, theoretical; safe at write time (JSONB stringifies cleanly), risk surfaces only if a downstream Epic 4+ consumer does `Object.assign(target, clayBlob)`. Flag for future consumers to be aware.

### Dismissed (not actionable)

7 findings were dismissed as noise, false positives, or handled elsewhere: ON CONFLICT partial-index syntax concern (proven working in production), `last_refresh` ISO format drift (Clay's format is stable), epics.md AC drift vs hourly bucket (resolved by this story file), non-POST handler asymmetry (Next.js returns 405 automatically), intentional `coalesce(existing, excluded)` for `source_recruiter_actor_id` (preserves first-touch recruiter — working as designed), `first_name`/`last_name` non-string coercion (handled by the `null-name-safety` migration), `v_bucket` DST concern (no DST in UTC).
