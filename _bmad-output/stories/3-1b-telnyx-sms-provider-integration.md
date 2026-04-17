# Story 3.1b: Telnyx SMS Provider Integration

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform engineer,
I want to replace the stub SMS provider with a live Telnyx integration including authentication, delivery webhooks, rate limiting, and idempotent retries,
so that Epic 3 outreach actually reaches candidates, delivery outcomes are observable, and every send is compliant with TCPA consent revocation rules before we scale to bulk campaigns.

## Funnel Lever & Measurement

**REQUIRED — DO NOT SKIP.** Per the PRD north-star KPI (Success Criteria → "Beat LinkedIn RPS Recruiter Funnel"), every story must declare which funnel stage it moves or which recruiter-effort metric it reduces.

- **Funnel lever(s) moved:** Outreach-sent volume + Response rate (unblocks both — the stub emits nothing; Telnyx lets `outreach_sent` and `response_received` events fire for real).
- **Expected lift:** No direct lift attributable to this story alone — it is the foundational send-path that makes Epic 3's 28%-response-rate target ("beat LinkedIn RPS 28% baseline") *measurable*. Without a live SMS provider, Story 3.1 (template/scheduling), 3.3 (consent), 3.4 (response capture), 3.5 (delivery tracking), and 3.7 (bulk campaigns) cannot emit real funnel events. Enables the entire Epic 3 funnel segment.
- **How lift is measured:** Two canonical funnel events per `funnel_events` schema (architecture.full.md §Funnel Telemetry) — `outreach_sent` (channel=`sms`, source_story=`3.1b`) fires on Telnyx 200 OK; `response_received` (channel=`sms`) fires on every inbound `message.received` webhook. Visible on `/dashboard/recruiter/funnel` and `/dashboard/admin/funnel` once Epic 10 dashboards ship.
- **Baseline comparison:** LinkedIn RPS baseline — 100 outreach → 28% response rate → 14 submissions → 0.5 closures @ $200/mo/recruiter (per `funnel_baseline_config`). This story does not move the needle on its own; it makes baseline comparison possible.

## Context

**Phase 4 of the provider framework rollout** — first outbound messaging provider on the framework, first provider with **webhook callbacks that affect compliance state**, and first provider with a **hard 10DLC/TCPA legal surface**. The stakes are categorically higher than Phases 1-3 (Clay/Ceipal/Graph/Anthropic/Supabase).

**What exists today (Story 3.1 is still backlog):**
- `sms_sends` + `sms_templates` tables with `provider text`, `provider_message_id text`, status enum (`pending`, `queued`, `sent`, `delivered`, `failed`, `bounced`, `undeliverable`, `blocked_opt_out`, `deferred_window`), response capture columns (`response_type`, `response_body`, `response_received_at`), and tracking tokens (already in `supabase/schema.sql:652-689`).
- `webhook_events` table with `(source, provider_event_id)` unique index for dedup and a `dead_letter` status lane (schema.sql:745-763).
- `provider_routing_policies.channel='sms'` row exists as a seed target for kill-switch state.
- **No Telnyx code anywhere in the repo.** A grep for `telnyx` returns zero matches — we are building from scratch on top of the proven framework.
- **Framework is battle-tested:** Clay inbound + Clay outbound + Ceipal + Graph + Anthropic + Supabase all running on `BaseProviderClient` / `BaseWebhookReceiver` / `ProviderRegistry` as of 2026-04-17 (Stories 1.12a, 1.12b, 1.12c merged).

**What this story delivers:**
1. `TelnyxProviderClient extends BaseProviderClient` — outbound `POST /v2/messages` with bearer auth, `X-Idempotency-Key`, MPS rate limiting, exponential backoff on 429, retry on 5xx/408.
2. `TelnyxWebhookReceiver extends BaseWebhookReceiver` (thin, <100ms) for both `message.sent/delivered/failed/undeliverable` and `message.received` (inbound replies, including STOP).
3. **Synchronous consent revocation on STOP** — written to `consent_records` *before* the webhook returns 200, per architecture.md §6.
4. `TelnyxWebhookHandler` — background processor that drains webhook_events rows, updates `sms_sends.status`, retries failed sends with escalating delay (30s, 120s, 300s, max 3 attempts), and emits canonical funnel events.
5. Registration in `ProviderRegistry` with kill-switch enforcement at the send boundary, plus health event persistence.
6. Discovery spike FIRST — capture real Telnyx payloads before writing production code. Telnyx's response/webhook shapes and nullable fields are notoriously under-documented.

**This is a feature, not a refactor.** Unlike Stories 1.12a/b/c, there is no prior Telnyx implementation to preserve byte-for-byte. Zero-regression applies only to the framework primitives (which are frozen) and to Story 3.1's scheduler contract (when that story is scheduled — 3.1b may ship first if 3.1 slips, because stub replacement is independent of template/scheduling UI).

## Dependencies

**Hard prerequisites (must be DONE before this story starts):**
- **Story 1.12** — Edge System Provider Framework (DONE 2026-04-16). Provides `BaseProviderClient`, `BaseWebhookReceiver`, `WebhookProcessor`, `ProviderRegistry`, `PostgresHealthEventStore`, `provider_routing_policies`, `provider_health_events`, `webhook_events`.
- **Story 1.12a** — Clay/Ceipal migration (DONE 2026-04-17). Validates framework on a real webhook + outbound provider pair.
- **Story 1.12b** — Graph/Anthropic migration (DONE 2026-04-17). Validates `OAuthTokenAuth`, admin-alert sink, kill-switch enforcement pattern.
- **Story 1.12c** — Supabase health provider (in-progress 2026-04-17). Non-blocking for 3.1b — Supabase wrapping is health-only and orthogonal.
- **Story 3.1** — SMS pipeline + `SMSProvider` interface + stub provider. **If Story 3.1 has NOT defined the `SMSProvider` interface yet**, this story owns the interface definition AND the Telnyx implementation. Coordinate with the Story 3.1 dev to pick one:
  - **Option A (preferred):** Story 3.1 defines `SMSProvider` interface + stub in `src/modules/outreach/sms-provider.ts`. Story 3.1b implements `TelnyxSMSProvider` in `src/modules/providers/telnyx/`.
  - **Option B:** If Story 3.1 slips, this story creates both the interface (provider-agnostic, vendor-neutral) and the Telnyx implementation. The stub can remain in 3.1's scope.

**Prerequisite for (downstream — will break if this is skipped or rushed):**
- **Story 3.3** — Consent/opt-out engine consumes the STOP webhook path this story wires.
- **Story 3.4** — Response capture consumes `message.received` events this story persists.
- **Story 3.5** — Delivery tracking reads `sms_sends.status` updates driven by `message.delivered/failed/undeliverable`.
- **Story 3.7** — Bulk campaigns depend on MPS rate limiting + idempotency this story establishes.

**Shared tables (touched by multiple stories — DO NOT re-define):**
- `webhook_events` — used by Clay (1.12a), Supabase migrations, and future Instantly (3.2a). **Source string MUST be `'telnyx'`** (lowercase, singular). Do not use `'telnyx_sms'` or split sources for outbound-confirmation vs. inbound-reply — one source, event_type disambiguates.

## Acceptance Criteria

### AC 1: Discovery Spike — Real Telnyx Payloads Captured BEFORE Production Code

**Given** Telnyx's API docs are authoritative but their actual response shapes + webhook payloads drift across account types, 10DLC status, and regional routing
**When** the dev agent starts implementation
**Then** Task 0 (discovery spike) runs FIRST — provision a Telnyx sandbox account, send 5-10 test SMS through the real API, capture every distinct payload shape into fixture files under `src/modules/providers/telnyx/__fixtures__/`:
- `outbound-send-success.json` — `POST /v2/messages` 200 OK response body
- `outbound-send-400-validation.json` — bad-number validation error
- `outbound-send-401-auth.json` — invalid API key
- `outbound-send-429-rate-limited.json` — MPS breach (may require multiple rapid-fire requests)
- `webhook-message-sent.json` — sandbox → production-like webhook
- `webhook-message-delivered.json`
- `webhook-message-failed.json` — intentionally send to an invalid number
- `webhook-message-undeliverable.json` — send to a known undeliverable number (e.g. landline)
- `webhook-message-received-normal.json` — manual reply from a test phone
- `webhook-message-received-stop.json` — reply with "STOP" (legally-mandated keyword)
- `webhook-message-received-help.json` — reply with "HELP" (legally-mandated keyword)
- `webhook-message-received-unicode.json` — reply with emoji or non-ASCII text
**And** every fixture is a real response body captured via `curl -v` or `fetch` — **synthetic payloads are prohibited** (Telnyx's `messaging_profile_id`, `from` numbers, timestamps, and signature headers cannot be guessed)
**And** the signature header (`telnyx-signature-ed25519` + `telnyx-timestamp`) format is documented in `docs/telnyx-webhook-signing.md` with a verified signature validation example
**And** all production code in Tasks 1-5 uses these fixtures as test inputs — no code references fields not present in a captured fixture
**And** a written go/no-go note is added to Dev Notes documenting any discovered deviation from Telnyx public docs (e.g. undocumented fields, different status codes than documented, missing fields under certain conditions)

### AC 2: TelnyxProviderClient — Outbound Sends

**Given** an outbound SMS needs to be dispatched
**When** `TelnyxProviderClient.sendMessage({ to, from, text, idempotencyKey })` is called
**Then** the request targets `POST {TELNYX_API_BASE}/v2/messages` (default `https://api.telnyx.com`)
**And** auth is `BearerTokenAuth(process.env.TELNYX_API_KEY)` via `Authorization: Bearer <key>` header
**And** the `X-Idempotency-Key` header is the `idempotencyKey` parameter (see AC 4 for key derivation)
**And** request body is `{ from, to, text, messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID, webhook_url: <our receiver URL>, webhook_failover_url?: undefined }`
**And** timeout is 15 seconds (SMS send should be fast; long waits mean the provider is degraded)
**And** retry configuration is `maxRetries: 3`, `backoffMs: 1000`, `retryableStatuses: [408, 429, 500, 502, 503, 504]` (framework defaults)
**And** 429 responses honor `Retry-After` when present (override framework exponential backoff for that attempt only)
**And** every call emits exactly one `ProviderLogEntry` JSON line with `{provider:'telnyx', method:'POST', path:'/v2/messages', statusCode, durationMs, attempt, errorClassification?}` — identical shape to Clay/Ceipal/Graph
**And** successful sends record `{provider_message_id, from, cost_estimate?}` on the caller's `sms_sends` row
**And** 4xx non-429 responses classify as `permanent` (validation, bad number) and DO NOT retry
**And** 401 classifies as `auth_failure` and is EXCLUDED from kill-switch math (per framework §19 rule)

### AC 3: Rate Limiting — Messages Per Second (MPS)

**Given** Telnyx enforces per-messaging-profile MPS limits (default 1 MPS for new 10DLC accounts, configurable higher after trust-score approval)
**When** sends are dispatched from the SMS worker
**Then** a leaky-bucket rate limiter on `TelnyxProviderClient` enforces `CBL_TELNYX_MPS` (default 1, env-configurable) BEFORE the call leaves the process — not AFTER a 429
**And** the same atomic `provider_rate_counters` pattern used by Clay/RapidAPI (architecture.md §15) is reused: `UPDATE provider_rate_counters SET request_count = request_count + 1 WHERE provider_id='telnyx' AND window_start = current_second() RETURNING request_count`; if `request_count > limit` the send is re-enqueued with delay until the next window
**And** when a 429 still slips through (defense-in-depth), the framework retry kicks in with exponential backoff (1s → 2s → 4s) AND respects `Retry-After` when present
**And** after 3 consecutive rate-limit failures on a single send, the send moves to `sms_sends.status='deferred_window'` + `contact_window_deferred_until = now() + 5min` for a scheduler re-pickup — do not dead-letter on rate limits alone

### AC 4: Provider-Level Idempotency — Key Derivation + Persistence

**Given** architecture.md §11 mandates `provider_idempotency_key` on every outreach job
**When** an SMS send is enqueued
**Then** the idempotency key is computed as `sha256(tenant_id + candidate_id + job_requirement_id + sms_template_version + send_window_date)` — job_requirement_id may be null for non-job sends (availability pings) — use empty string
**And** the key is persisted on the `sms_sends` row in a new column `provider_idempotency_key text` (migration required — see Task 6)
**And** the same key is passed as `X-Idempotency-Key` on EVERY retry attempt — never regenerated on retry
**And** if Telnyx returns the same `provider_message_id` for the same `X-Idempotency-Key`, the worker treats it as a first-write success (idempotent replay)
**And** if a worker crashes between `provider.sendMessage()` returning 200 and the DB write of `provider_message_id`, the next retry presents the same `X-Idempotency-Key` and Telnyx deduplicates server-side — no duplicate SMS sent to candidate

### AC 5: Delivery Status Webhooks

**Given** Telnyx posts delivery status updates to our webhook URL
**When** a webhook arrives at `POST /api/webhooks/telnyx`
**Then** the receiver is `TelnyxWebhookReceiver` extending `BaseWebhookReceiver` with:
- `source: 'telnyx'`
- `auth: TelnyxSignatureAuth` — custom `WebhookAuthStrategy` validating `telnyx-signature-ed25519` + `telnyx-timestamp` using `TELNYX_PUBLIC_KEY` and 5-minute replay window
- `maxPayloadBytes: 64 * 1024` (Telnyx webhooks are small)
- `rateLimitMax: 1000, rateLimitWindowMs: 60_000` (Telnyx can burst during delivery storms)
- `extractEventId: (p) => p?.data?.id` (Telnyx message ID is the event ID for dedup)
- `extractEventType: (p) => p?.data?.event_type` (e.g. `'message.sent'`, `'message.delivered'`, `'message.failed'`, `'message.finalized'`, `'message.received'`)
- `extractTimestamp: (p) => p?.data?.occurred_at` (for replay protection)
**And** the route handler is thin (<100ms target) — only: validate signature → write `webhook_events` row → return 200 OK
**And** `WebhookProcessor` with 3 retries drains the queue and routes events to `TelnyxWebhookHandler`
**And** `TelnyxWebhookHandler.handle(event)` updates `sms_sends`:
- `message.sent` → `status='sent'`, `sent_at=occurred_at`, emit `funnel_events(event_type='outreach_sent', channel='sms', source_story='3.1b')` (idempotent via `idempotency_key`)
- `message.delivered` → `status='delivered'` (terminal success)
- `message.failed` → `status='failed'`, trigger retry logic (AC 7) if `attempt < 3` else dead-letter
- `message.finalized` with `errors[]` non-empty → treat as `message.failed`
- `message.undeliverable` → `status='undeliverable'` (terminal, no retry — number is dead)
- `message.received` → see AC 6
**And** `webhook_events.result_meta` on success is `{ syncRunId: null, outcome: 'updated', candidateId, smsSendId, eventType }`
**And** failed handlers (exception thrown) follow framework dead-letter path: `status='dead_letter'` after 3 retries, `error_message` populated, structured `console.error` log

### AC 6: Inbound Reply Webhooks — STOP Synchronously Revokes Consent

**Given** Telnyx delivers inbound SMS replies via `message.received` webhook
**When** a reply arrives
**Then** `TelnyxWebhookReceiver` classifies it via `isStopKeyword(text)` BEFORE writing `webhook_events` — trim + uppercase + match against TCPA-mandated STOP keywords: `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`, `REVOKE`, `OPT OUT`, `OPTOUT` (per TCPA/CTIA Common Short Code guidelines)
**And IF STOP detected** the following happens SYNCHRONOUSLY before the webhook returns 200:
1. Write `consent_records` row (new table — see Task 6) with `candidate_id`, `channel='sms'`, `state='revoked'`, `source='inbound_stop_keyword'`, `revoked_at=now()`, `evidence_webhook_event_id` (FK to `webhook_events.id`)
2. Cancel all pending `sms_sends` rows for that candidate: `UPDATE sms_sends SET status='blocked_opt_out' WHERE candidate_id=? AND status IN ('pending','queued','deferred_window')`
3. Call `cancelPendingOutboxForCandidate(candidateId, 'sms')` — future hook for Story 3.3 cross-channel cancellation; stub as no-op with TODO marker if Story 3.3 hasn't shipped
4. Emit `audit_event` `consent.revoked.sms` with actor=`system`, reason=`inbound_stop`, trace_id preserved from the webhook request
5. Write the `webhook_events` row with `source='telnyx'`, `event_type='message.received'`, `result_meta={ outcome: 'updated', stopDetected: true, consentRecordId, cancelledSmsCount }`
6. Return 200 OK to Telnyx

**Target latency: <5 seconds from Telnyx → all pending cancelled** (architecture.md §6 SLA). The synchronous path MUST complete within the webhook response window.

**And IF NOT STOP** the handler persists the reply normally:
- `sms_sends.response_received_at=occurred_at`, `response_body=text`, `response_type=inferResponseType(text)` (affirmative/negative/freeform — see Story 3.4's taxonomy; default `freeform` if that story hasn't shipped)
- Emit `funnel_events(event_type='response_received', channel='sms', source_story='3.1b')` idempotently
- Record `webhook_events.result_meta={ outcome: 'updated', smsSendId, stopDetected: false }`

**CRITICAL — NEVER LOG full reply text at INFO level.** PII + potential PHI. Log only `{smsSendId, candidateIdHash, replyLength, stopDetected, responseType}`. Full body lives only in `sms_sends.response_body` and `webhook_events.raw_payload` which are tenant-isolated by RLS.

### AC 7: Retry Policy — 30s, 120s, 300s, Max 3 Attempts

**Given** a send fails with a classification of `transient` or `rate_limited` (framework retry already handled in-process)
**When** the in-process retries are exhausted
**Then** the outbox worker re-picks up the send with escalating delays: **30s after attempt 1, 120s after attempt 2, 300s after attempt 3 — max 3 total processor attempts** (distinct from and additive to the `BaseProviderClient.maxRetries:3` in-process retries)
**And** the two retry layers are explicitly documented: in-process (framework) burns retries within seconds for the same HTTP call; out-of-process (worker) burns retries over minutes across fresh HTTP calls
**And** `sms_sends.delivery_attempt_count` increments on every out-of-process attempt (not every in-process retry)
**And** `sms_sends.last_attempt_at` is updated on every out-of-process attempt
**And** after 3 out-of-process attempts fail, status → `failed`, an `outreach.sms.dead_letter` audit event fires, and the recruiter is notified via Teams (reuse the notification path from future Story 6.3 — stub with TODO if not yet shipped)
**And** `message.failed` webhook with classification `permanent` (bad number, spam filter) SKIPS the retry queue and goes straight to `failed` terminal state
**And** `message.undeliverable` is ALWAYS terminal — number is dead, retry is waste

### AC 8: Kill Switch + Health Monitoring + Warm Standby Readiness

**Given** the provider framework tracks health and mode (`normal`/`degraded`/`kill_switched`) per provider
**When** Telnyx is registered in `ProviderRegistry` at startup
**Then** `ensureProvidersInitialized()` in `src/modules/providers/startup.ts` registers `telnyx` when `TELNYX_API_KEY` is set, wires the client via `registry.wireClient('telnyx', telnyxClient.base)`, and attaches the default JSON log sink
**And** `provider_routing_policies` row is seeded via new migration: `('sms', 'telnyx', 'twilio', 'normal')` — Twilio named as fallback but NOT yet implemented (warm standby is documented, not built, per §19 "SMS has warm-standby; campaign email enters degraded mode")
**And** auto-degrade fires at 30% error rate / ≥10 attempts (framework default — unchanged)
**And** auto-kill fires at 80% error rate / ≥50 attempts in 5 min OR manual admin toggle (framework default — unchanged)
**And** `TelnyxProviderClient.sendMessage` calls `registry.getMode('telnyx')` BEFORE every send — if `kill_switched`, return `{ ok: false, errorClassification: 'permanent', error: 'Telnyx kill-switched' }` and log a structured `outreach.sms.kill_switched` event; the caller re-queues to `sms_sends.status='queued_degraded'` (new status — see Task 6)
**And** degraded mode logs a per-send warning but does NOT refuse the send — operator sees the degraded banner in the admin dashboard and decides whether to manually kill
**And** health event transitions (`normal → degraded`, `normal → kill_switched`, etc.) fire the existing admin-alert sink (critical log + Graph sendMail to `CBL_PROVIDER_ALERT_EMAIL` — pattern established in 1.12b `src/modules/providers/admin-alert.ts`)
**And** failback from `kill_switched` is MANUAL ONLY (never silent) — admin must explicitly run `UPDATE provider_routing_policies SET mode='normal' WHERE primary_provider='telnyx'` or use the Scheduler Admin Dashboard (2.7a)

### AC 9: 10DLC Compliance Documentation

**Given** US SMS campaigns require 10DLC registration per CTIA guidelines and TCPA enforcement
**When** this story ships
**Then** `docs/telnyx-10dlc-compliance.md` is created documenting:
1. **Brand and campaign registration status** — whether CBL Solutions is registered as a 10DLC brand with Telnyx, and campaign registration status (Brand/Campaign/Mnemonic/T-Mobile QNS status)
2. **Throughput class** — 10DLC throughput tier determines the `CBL_TELNYX_MPS` value (default 1 MPS; higher after trust score + brand registration)
3. **Opt-in/opt-out keyword handling** — explicit mapping of STOP/HELP/UNSUBSCRIBE keywords to code paths (AC 6 provides STOP; HELP auto-reply is deferred to Story 3.3 but must be acknowledged here)
4. **Message content rules** — no shortened URLs except our own tracking domain, mandatory "Msg&Data rates may apply" on first-touch messages (verify with legal whether this is automated here or handled at template level in Story 3.1)
5. **Quiet hours** — TCPA 8am-9pm local-time rule; defer implementation to Story 3.3 consent engine but document the constraint
6. **10DLC known-gotchas checklist** — document whatever quirks the discovery spike (Task 0) uncovered: T-Mobile QNS filtering, AT&T spam-likely tagging, carrier-specific character encoding quirks, etc.

**And** a decision log entry is added to the story (Dev Notes section) stating: "Ship decision — this story is safe to merge IF 10DLC brand is registered AND campaign is approved AND throughput class is set. Blocked otherwise." The story is NOT merge-blocked on 10DLC approval timing — we ship the code, admin gates rollout with the kill switch until 10DLC clears.

### AC 10: Zero Regressions + Test Coverage

**Given** the migration must not break the provider framework or Supabase health path
**When** `npm run test` runs
**Then** all existing tests pass with zero regressions — concretely:
- All 110 provider-framework tests from 1.12 baseline — unchanged
- All Clay tests (52 mapper + 27 webhook route = 79) — unchanged
- All Ceipal tests (7 unit + 12 ingestion-job cases) — unchanged
- All Graph tests (13 GraphProviderClient) — unchanged
- All Anthropic tests (11 AnthropicLLMProvider + 7 ai-inference) — unchanged
- All Supabase health tests (from 1.12c) — unchanged
- Any SMS tests from Story 3.1 (TBD) — unchanged

**And** new tests added this story cover minimum:
- `src/modules/providers/telnyx/__tests__/telnyx-client.test.ts` — ≥15 tests: happy send, 400 validation, 401 auth, 429 rate-limit with Retry-After, 5xx transient retry, idempotency key echo, kill-switch short-circuit, cost estimation, log sink shape, `X-Idempotency-Key` header injection, MPS rate limiter, MPS re-enqueue on breach, timeout classification, 3-retry-exhausted behavior, environment variable validation
- `src/modules/providers/telnyx/__tests__/telnyx-webhook-auth.test.ts` — ≥8 tests: valid ed25519 signature, invalid signature (400), missing signature header, missing timestamp, replay window breach (>5 min old), future-skew tolerance (30s), malformed payload, signature algorithm drift
- `src/modules/providers/telnyx/__tests__/telnyx-webhook-handler.test.ts` — ≥12 tests: `message.sent` → status+funnel event, `message.delivered` terminal, `message.failed` transient → retry, `message.failed` permanent → dead-letter, `message.undeliverable` terminal, `message.received` non-STOP → reply persisted, `message.received` STOP → synchronous consent revocation (<5s), STOP with surrounding whitespace, STOP case-insensitive, STOP variant keywords (UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, STOPALL, OPT OUT, OPTOUT), inbound reply emits `response_received` funnel event, reply text NEVER appears in log sink
- `src/modules/__tests__/providers-telnyx-audit-integration.test.ts` — ≥3 end-to-end tests (parallel to `providers-audit-integration.test.ts` established in 1.12a): send→webhook→delivered happy path, send→webhook→failed→retry→dead-letter, inbound STOP end-to-end with consent record + sms cancel + audit event

**And** `npm run typecheck` clean
**And** `npm run lint` clean (zero new warnings)
**And** `npm run residency:preflight` passes

### AC 11: Logging, Audit, PII Guardrails — Explicit Contract

**PRESERVE (framework-wide conventions — inherit unchanged):**
1. One `ProviderLogEntry` JSON line per outbound HTTP attempt (AC 2)
2. One `WebhookLogEntry` JSON line per inbound event with `{source:'telnyx', eventType, payloadSize, signatureValid, duplicate, outcome, processingTimeMs}` — same shape as Clay
3. Every `ProviderRegistry` mode transition writes `provider_health_events` via `PostgresHealthEventStore.persist()`
4. Every webhook rate-limit breach, replay rejection, signature failure emits `WebhookLogEntry` with the matching `outcome` field (e.g. `rejected_auth`, `rejected_replay`, `rejected_rate_limit`)

**ADD (Telnyx-specific):**
5. Every `message.received` webhook logs `{source:'telnyx', eventType:'message.received', candidateIdHash, replyLength, stopDetected, responseType}` — **never** the raw reply body at INFO level
6. Every kill-switch short-circuit logs a structured `console.warn` with `{provider:'telnyx', mode:'kill_switched', smsSendId, candidateIdHash}` — admin sees the queue building without log spam
7. Every consent revocation on STOP emits an `audit_event` row with `event_type='consent.revoked.sms'`, `reason='inbound_stop'`, `evidence_webhook_event_id`, preserved trace_id

**NEVER LOG (security + compliance):**
8. Full SMS reply text outside `sms_sends.response_body` + `webhook_events.raw_payload` — tenant-RLS-protected only
9. `TELNYX_API_KEY` or `TELNYX_PUBLIC_KEY` values (redact in any config-dump log)
10. Full phone numbers in log lines — mask to last-4-digits when absolutely required; prefer `candidateIdHash`
11. `X-Idempotency-Key` values in log output — these contain tenant/candidate/job IDs via hashing but should still be opaque to operators; log presence, not value
12. Signature headers (`telnyx-signature-ed25519`) — redact in any debug dump

## Tasks / Subtasks

- [ ] **Task 0: Discovery spike — capture real Telnyx payloads** (AC: 1)
  - [ ] 0.1 Provision Telnyx sandbox account + API key; add to 1Password under "CBL / Telnyx Sandbox"
  - [ ] 0.2 Register a test messaging profile; capture the profile ID
  - [ ] 0.3 Capture 11 fixtures under `src/modules/providers/telnyx/__fixtures__/` (see AC 1 list)
  - [ ] 0.4 Document `telnyx-signature-ed25519` + `telnyx-timestamp` format in `docs/telnyx-webhook-signing.md`
  - [ ] 0.5 Write a go/no-go note in Dev Notes listing discovered deviations from Telnyx docs
  - [ ] 0.6 Confirm sandbox can reach our dev environment — Telnyx needs a public URL for webhooks; use ngrok or Render preview deploy

- [ ] **Task 1: TelnyxProviderClient — outbound sends** (AC: 2, 3, 4, 8)
  - [ ] 1.1 Create `src/modules/providers/telnyx/` directory
  - [ ] 1.2 `telnyx-client.ts` — `TelnyxProviderClient` wraps `BaseProviderClient` with `BearerTokenAuth(TELNYX_API_KEY)`, `baseUrl=TELNYX_API_BASE` (default `https://api.telnyx.com`), `timeoutMs:15000`, default retries
  - [ ] 1.3 `sendMessage({ to, from, text, idempotencyKey, smsSendId }): Promise<ProviderCallResult<TelnyxSendResponse>>`
    - Calls `registry.getMode('telnyx')` first — if `kill_switched`, return classification `permanent` without HTTP call
    - Computes cost estimate via `estimateCost` callback — Telnyx pricing: `text.length <= 160 ? $0.0045 : ceil(text.length / 153) * $0.0045` (SMS segmentation; confirm against real invoice during discovery spike)
    - Body: `{ from, to, text, messaging_profile_id, webhook_url, type: 'SMS' }`
    - Headers: `X-Idempotency-Key: ${idempotencyKey}` + framework auth injection
  - [ ] 1.4 `computeIdempotencyKey({ tenantId, candidateId, jobRequirementId, templateVersion, sendWindowDate })` — SHA-256 helper, returns hex string (64 chars)
  - [ ] 1.5 MPS rate limiter — integrate with `provider_rate_counters` (create migration to add `telnyx` row or rely on seed in AC 8 seed migration); env var `CBL_TELNYX_MPS` (default 1)
  - [ ] 1.6 `buildTelnyxProviderClientFromEnv()` — returns `null` when `TELNYX_API_KEY` is unset; validates `TELNYX_MESSAGING_PROFILE_ID` is set if `TELNYX_API_KEY` is set
  - [ ] 1.7 `getSharedTelnyxClient` / `setSharedTelnyxClient` / `resetSharedTelnyxClientForTest` — mirror Graph/Clay pattern
  - [ ] 1.8 `index.ts` barrel export

- [ ] **Task 2: TelnyxSignatureAuth + TelnyxWebhookReceiver** (AC: 5)
  - [ ] 2.1 `telnyx-signature-auth.ts` — `TelnyxSignatureAuth implements WebhookAuthStrategy`. Uses `node:crypto` `verify('ed25519', ...)` against `telnyx-signature-ed25519` header + `telnyx-timestamp` + raw body. 5-min replay window. 30s future-skew tolerance.
  - [ ] 2.2 `telnyx-webhook-receiver.ts` — `createTelnyxWebhookReceiver(store, handler)` factory returning `BaseWebhookReceiver` with config: `source:'telnyx'`, `auth: new TelnyxSignatureAuth(TELNYX_PUBLIC_KEY)`, `maxPayloadBytes: 64*1024`, rate limit 1000/min, `extractEventId/Type/Timestamp` per AC 5
  - [ ] 2.3 Register route `src/app/api/webhooks/telnyx/route.ts` — thin handler: `ensureProvidersInitialized()` → `receiver.receive(rawBody, headers)` → if STOP shortcut runs synchronously (see Task 3) → return 200
  - [ ] 2.4 Synchronous STOP detection happens BEFORE the `webhook_events` INSERT — parse payload, detect STOP, run consent revocation INSIDE the route handler, then INSERT `webhook_events` with `status='completed'` + `result_meta.stopDetected=true`. Non-STOP inbound goes through normal async processor path.

- [ ] **Task 3: STOP handling — synchronous consent revocation** (AC: 6)
  - [ ] 3.1 `stop-detection.ts` — `isStopKeyword(text: string): boolean` with TCPA-mandated keywords list (normalized via trim/uppercase/collapse-whitespace)
  - [ ] 3.2 `consent-revocation.ts` — `revokeConsentSync({ tenantId, candidateId, channel:'sms', evidence: {webhookEventId, rawText, occurredAt} })`
    - Inserts `consent_records` row (Task 6 migration)
    - UPDATEs pending `sms_sends` → `blocked_opt_out`
    - Writes `audit_event` with `event_type='consent.revoked.sms'`
    - All in ONE transaction — if any step fails, webhook returns 500 and Telnyx retries
  - [ ] 3.3 Add hook point `cancelPendingOutboxForCandidate(candidateId, channel)` — stub for Story 3.3 integration

- [ ] **Task 4: TelnyxWebhookHandler — async status + reply processing** (AC: 5, 6, 7)
  - [ ] 4.1 `telnyx-webhook-handler.ts` — `TelnyxWebhookHandler implements WebhookHandler`. Switch on `event.data.event_type`:
    - `message.sent` → update `sms_sends.status='sent'`, emit `funnel_events(outreach_sent)`
    - `message.delivered` → update `status='delivered'` (terminal)
    - `message.failed` → route through retry decision (Task 5)
    - `message.finalized` with errors → treat as `message.failed`
    - `message.undeliverable` → `status='undeliverable'` (terminal)
    - `message.received` → if STOP (defense-in-depth — route already handled sync path), call `revokeConsentSync`; else persist reply + emit `funnel_events(response_received)`
  - [ ] 4.2 `funnel-events.ts` helper — `emitFunnelEvent({ eventType, tenantId, candidateId, channel:'sms', sourceEpic:'epic-3', sourceStory:'3.1b', idempotencyKey, attributes })`; writes to `funnel_events` table (schema per architecture.full.md §Funnel Telemetry — create migration if table doesn't exist yet; coordinate with Epic 10 owner)
  - [ ] 4.3 Response-type inference — default `freeform`; STOP → `opt_out`; if Story 3.4 has shipped, import its `inferResponseType`; else stub

- [ ] **Task 5: Retry orchestration — out-of-process attempts** (AC: 7)
  - [ ] 5.1 Extend the SMS outbox worker (Story 3.1 will land this — if not yet shipped, create a minimal worker under `src/modules/outreach/sms-worker.ts`)
  - [ ] 5.2 On `message.failed` with `transient` classification, re-enqueue with `delay_ms = [30_000, 120_000, 300_000][sms_sends.delivery_attempt_count - 1]`
  - [ ] 5.3 After 3 out-of-process attempts, status → `failed` + emit `audit_event('outreach.sms.dead_letter')` + enqueue Teams notification (stub if Story 6.3 not shipped)
  - [ ] 5.4 `message.failed` with `permanent` classification → straight to `failed` (skip retry queue)
  - [ ] 5.5 Integration with `provider_rate_counters` — MPS overflow also uses the retry queue with `deferred_window` status

- [ ] **Task 6: Schema migrations** (AC: 4, 6, 8)
  - [ ] 6.1 `supabase/migrations/2026-04-1X-story-3-1b-telnyx.sql`:
    - `ALTER TABLE sms_sends ADD COLUMN provider_idempotency_key text;` + index `idx_sms_sends_idempotency ON sms_sends(provider_idempotency_key) WHERE provider_idempotency_key IS NOT NULL`
    - Add `'queued_degraded'` to `sms_sends_status_valid` CHECK constraint
    - Create `consent_records` table if not present (channel, state enum `active|revoked|pending_confirmation`, source, evidence_webhook_event_id FK, created_at, revoked_at, tenant_id, candidate_id) + unique partial index `(candidate_id, channel) WHERE state='active'`
    - Seed `provider_routing_policies`: `INSERT ... (channel, primary_provider, fallback_provider, mode) VALUES ('sms', 'telnyx', 'twilio', 'normal') ON CONFLICT (channel) DO NOTHING`
    - Seed `provider_rate_counters` row for telnyx with `window_seconds=1, limit_per_window=1` (overridable by env)
    - Create `funnel_events` table if not present (coordinate with Epic 10 — see Dev Notes) or guard the funnel-event writes with a feature flag until Epic 10 creates the table
  - [ ] 6.2 Update `supabase/schema.sql` canonical bootstrap to reflect post-migration state (DO include this — the 2.4b pattern established schema.sql is current-state)

- [ ] **Task 7: Startup wiring + kill-switch enforcement** (AC: 8)
  - [ ] 7.1 Extend `src/modules/providers/startup.ts` `initializeImpl()` — register `telnyx` when `TELNYX_API_KEY` set, wire client, attach log sink, share client via `setSharedTelnyxClient`
  - [ ] 7.2 Export from `src/modules/providers/index.ts` — types + `TelnyxProviderClient` + `buildTelnyxProviderClientFromEnv` + `getSharedTelnyxClient`/`setSharedTelnyxClient`/`resetSharedTelnyxClientForTest`
  - [ ] 7.3 Update `providers-startup.test.ts` to assert `telnyx` appears in registered provider list when env is set, AND that it's absent when env is unset

- [ ] **Task 8: Validation** (AC: 10, 11)
  - [ ] 8.1 Full test suite — zero regressions on all prior stories
  - [ ] 8.2 TypeScript clean
  - [ ] 8.3 Lint clean
  - [ ] 8.4 Residency preflight passes
  - [ ] 8.5 Manual smoke test against Telnyx sandbox — send → webhook → delivered path end-to-end
  - [ ] 8.6 Manual smoke test — send → reply "STOP" from test phone → verify consent_records row + sms_sends blocked + audit_event fired, all within 5 seconds
  - [ ] 8.7 Manual kill-switch smoke — `UPDATE provider_routing_policies SET mode='kill_switched' WHERE primary_provider='telnyx'` → verify next send short-circuits with `queued_degraded`

- [ ] **Task 9: 10DLC documentation** (AC: 9)
  - [ ] 9.1 `docs/telnyx-10dlc-compliance.md` covering brand status, throughput class, keyword handling, content rules, quiet hours, known gotchas
  - [ ] 9.2 Dev Notes section in this story — ship decision log, 10DLC gating mechanism (kill switch default until admin flips to normal)

## Dev Notes

### Why this is Phase 4, not Phase 1

The framework was intentionally rolled out low-stakes → high-stakes so each tier could fix its own class of problems:
- **Phase 1 (1.12a Clay/Ceipal):** proved `BaseWebhookReceiver`, `BaseProviderClient`, `CeipalAuthStrategy` patterns; low blast radius because Clay is idempotent-by-design and Ceipal is outbound polling.
- **Phase 2 (1.12b Graph/Anthropic):** proved `OAuthTokenAuth`, admin-alert sink, kill-switch-aware availability checks; medium blast because Anthropic outage degrades AI features (null return) and Graph outage slows email but doesn't corrupt state.
- **Phase 3 (1.12c Supabase):** proved health-only wrapping pattern for singletons where per-call wrapping would add latency.
- **Phase 4 (this story) Telnyx:** first provider where framework failures have **compliance consequences**. STOP must revoke in <5s or we send TCPA-violating messages after revocation. Webhook delivery has retry amplification — Telnyx retries a failed webhook up to 6 times over 24 hours; our handler must be idempotent against replays. 10DLC rejects can brick a campaign without our stack ever seeing the message.

### STOP is the riskiest code path

Everything in AC 6 runs **inside the webhook response window**. If Telnyx doesn't get 200 within ~10s, they retry; if we revoke consent then fail to return 200, we could double-process and emit duplicate audit events. The mitigation:
1. Put all 5 steps in ONE Supabase transaction — atomic commit or full rollback
2. Use `(candidate_id, channel)` unique partial index `WHERE state='active'` on `consent_records` so duplicate revocations ON CONFLICT DO NOTHING
3. Use `webhook_events.(source, provider_event_id)` unique index (already exists) so retried webhooks dedup at the DB layer — second attempt lands on the same row, sees `status='completed'`, returns 200 immediately

### 10DLC and the ship decision

You can merge + deploy this story WITHOUT 10DLC approval — the kill switch defaults to `normal` but admin can pre-flip to `kill_switched` while 10DLC processes. Sends will route to `sms_sends.status='queued_degraded'` and drain once admin flips back to `normal`. This decoupling is why §19 mandates manual-failback: it forces admin to acknowledge "yes, 10DLC is clear, open the gate."

### Funnel events table — coordinate with Epic 10

`funnel_events` is defined in architecture.full.md but not yet in `supabase/schema.sql`. Two paths:
1. **Preferred:** create the table in this story's migration — it's documented, the shape is stable, and Epic 10 will consume it. Epic 10 may later add materialized views (`funnel_daily_by_recruiter`, etc.) but the base table is this story's responsibility since we're the first emission point.
2. **Fallback:** guard the funnel emission with a feature flag `CBL_FUNNEL_EMISSION_ENABLED` (default true) and let Epic 10 create the table. Risk: we ship the emission code without a table and fail every send on `INSERT INTO funnel_events`. DO NOT take this path unless Epic 10 has a concrete migration PR open.

**Choose option 1** — create the table. Schema per architecture.full.md §Funnel Telemetry lines 169-186.

### Rate limiter placement — in the client, not the outbox

MPS limiting happens INSIDE `TelnyxProviderClient.sendMessage` (before the HTTP call) using the atomic `provider_rate_counters` UPDATE pattern. Do NOT put rate limiting in the outbox worker — multiple workers would contend on claim/release and still race each other on the actual HTTP dispatch. Atomic DB counter at the call boundary is the only correct pattern (per architecture.md §15, §8, §11 — all three decisions converge on this).

### Why the webhook receiver is at `/api/webhooks/telnyx`, not `/api/providers/telnyx/webhook`

Consistency with Clay (`/api/webhooks/clay`). The `/api/webhooks/*` namespace is the inbound-provider convention established in 1.12a. If a reverse proxy / WAF rule blocklists anything outside this path, the Telnyx webhook would silently fail — match the established pattern.

### Environment variables — new in this story

| Var | Purpose | Example | Required |
|---|---|---|---|
| `TELNYX_API_KEY` | Bearer token for outbound API | `KEY01234...` | Yes (for outbound sends) |
| `TELNYX_PUBLIC_KEY` | Ed25519 public key for webhook signature validation | base64 string | Yes (for inbound webhooks) |
| `TELNYX_MESSAGING_PROFILE_ID` | Identifies the 10DLC-registered messaging profile | UUID | Yes |
| `TELNYX_API_BASE` | Base URL override | `https://api.telnyx.com` | No (default shown) |
| `CBL_TELNYX_MPS` | Messages-per-second throttle | `1` | No (default 1) |
| `CBL_TELNYX_WEBHOOK_URL` | Public URL Telnyx posts to — MUST match deployed route | `https://app.cbl.aero/api/webhooks/telnyx` | Yes |

Add all six to `render.yaml` as `sync: false` secrets. Document in `CLAUDE.md` environment variables section.

### Architecture compliance — non-negotiable hot links

- **§6 Consent Synchronization Latency** — STOP must kill pending sends BEFORE webhook 200; target <5s; synchronous write required; outbox relay must re-check consent on dequeue (belt + suspenders)
- **§7 Webhook Burst Handling** — receiver is thin, stateless, <100ms; queue business logic in outbox processor; unique constraint on `(source, message_id)` dedups at insert
- **§11 Provider-Level Idempotency** — `provider_idempotency_key` column on `sms_sends`; `X-Idempotency-Key` on every retry attempt; key formula = `sha256(tenant_id + candidate_id + job_requirement_id + message_template_version + send_window_date)`
- **§15 External Enrichment Rate Limiting** — reuse `provider_rate_counters` atomic UPDATE pattern; no Redis; `429` secondary defense via `Retry-After`
- **§19 Provider Failover — Kill Switch + Warm Standby** — Twilio named as fallback in `provider_routing_policies.fallback_provider` but NOT implemented; manual failback only
- **§22 Provider Outage Queue Fallback Mode** — `sms_sends.status='queued_degraded'` when `telnyx` is `kill_switched`; operator visible in admin dashboard (reuses 2.7a infrastructure)

### Previous story intelligence (from 1.12a + 1.12b reviews)

**Learnings that WILL bite if ignored:**
1. **`ensureProvidersInitialized()` must be called from EVERY route that uses a provider** — 1.12a PR B code review caught a blocker where the Clay webhook route never initialized providers. Mitigation: call it at the top of `src/app/api/webhooks/telnyx/route.ts` POST AND inside any SMS worker `run()`.
2. **`BaseProviderClient.onLog` defaults to no-op** — startup wires a default JSON sink. Do NOT construct a client OUTSIDE `ensureProvidersInitialized()` flow in production code, or structured logs drop silently. The `attachProviderLogSink()` helper in startup.ts handles this.
3. **Env-var leakage in tests** — vitest env loader auto-injects from `.env.local`; clear `TELNYX_*` in `beforeEach` of any test that asserts provider registration, mirroring the pattern in `providers-startup.test.ts` beforeEach block.
4. **OAuth-style caches must invalidate on 401** — not applicable here (bearer auth, no refresh) but the pattern: `BaseProviderClient` classifies 401 as `auth_failure` and excludes from kill-switch math. If Telnyx returns 401, it's a misconfigured API key, not a network blip — admin-alert should mention that.
5. **`expires_in ≤ 0` defensive handling** — not applicable (no token refresh) but note the general principle: any time-based cache must treat non-positive expiry as "force refresh now."
6. **Typecheck `TS7022` on while-loop pagination** — 1.12b hit this on `ProviderCallResult<T>` generic inference. If you use paging in retry queue logic, explicitly type the loop variable.
7. **Test mock preservation** — `initializeLLMProviderFromStartup` pattern: if tests inject a mock before `ensureProvidersInitialized()`, startup must NOT clobber it. Apply the same pattern to `setSharedTelnyxClient` — add an `initializeSharedTelnyxClientFromStartup()` that no-ops when a mock is already set.

### Git intelligence

Recent work (last 5 commits as of 2026-04-17):
- `2a60df2` — 1.12b Graph/Anthropic merge — reference the `attachProviderLogSink` sentinel pattern for Telnyx
- `895329e` — 1.12b feat — pattern for `OAuthTokenAuth` (not used here — bearer auth) and admin-alert sink (re-used here for telnyx kill-switch events)
- `34a4c44` — funnel benchmark cascade — confirms `funnel_events` schema and emission contract used in AC 6
- `fff36ac` + `0cbdb88` — framework review items + condense; both merged code review findings into architecture.md and development-standards.md — re-read §19 and §6 before coding

### File structure (new files) — expected

```
src/modules/providers/telnyx/
├── index.ts                          # barrel: client + receiver + auth
├── telnyx-client.ts                  # TelnyxProviderClient + buildTelnyxProviderClientFromEnv
├── telnyx-signature-auth.ts          # Ed25519 webhook signature validation
├── telnyx-webhook-receiver.ts        # createTelnyxWebhookReceiver factory
├── telnyx-webhook-handler.ts         # WebhookHandler for status + reply events
├── stop-detection.ts                 # isStopKeyword()
├── consent-revocation.ts             # revokeConsentSync()
├── funnel-events.ts                  # emitFunnelEvent helper
└── __fixtures__/
    ├── outbound-send-success.json
    ├── outbound-send-400-validation.json
    ├── outbound-send-401-auth.json
    ├── outbound-send-429-rate-limited.json
    ├── webhook-message-sent.json
    ├── webhook-message-delivered.json
    ├── webhook-message-failed.json
    ├── webhook-message-undeliverable.json
    ├── webhook-message-received-normal.json
    ├── webhook-message-received-stop.json
    └── webhook-message-received-help.json
src/modules/providers/telnyx/__tests__/
├── telnyx-client.test.ts             # ≥15 tests
├── telnyx-signature-auth.test.ts     # ≥8 tests
├── telnyx-webhook-handler.test.ts    # ≥12 tests
└── stop-detection.test.ts            # ≥10 tests (STOP keyword variants)
src/modules/__tests__/
└── providers-telnyx-audit-integration.test.ts  # ≥3 E2E tests

src/app/api/webhooks/telnyx/
├── route.ts
└── __tests__/route.test.ts           # ≥10 integration tests

supabase/migrations/
└── 2026-04-1X-story-3-1b-telnyx.sql  # sms_sends column, status enum, consent_records, seeds

docs/
├── telnyx-webhook-signing.md         # signature format doc
└── telnyx-10dlc-compliance.md        # brand/campaign/throughput/keywords
```

### File structure — modifications to existing files

```
src/modules/providers/startup.ts      # register telnyx in initializeImpl
src/modules/providers/index.ts        # export telnyx barrel
src/modules/__tests__/providers-startup.test.ts  # assert telnyx registration
supabase/schema.sql                   # updated current-state bootstrap with new columns + table
render.yaml                           # add 6 new env var stubs (sync: false)
CLAUDE.md                             # document 6 new env vars in the env vars section
_bmad-output/sprint-status.yaml       # flip 3-1b-telnyx-sms-provider-integration → done (at merge time)
```

**Do NOT modify:**
- Any existing provider directory (`clay/`, `ceipal/`, `graph/`, `supabase/`) — Telnyx is additive
- `BaseProviderClient` / `BaseWebhookReceiver` — framework primitives are frozen post-1.12; if Telnyx needs a framework change, escalate and split into a separate framework-patch story

### Latest technical information

**Telnyx SDK choice — we do NOT use it.** The Telnyx JS SDK (`@telnyx/messaging`) wraps the same `/v2/messages` endpoint but adds a dependency, vendors its own retry policy (conflicts with framework), and doesn't expose the `X-Idempotency-Key` ergonomically. **Use `fetch` via `BaseProviderClient.request()` directly** — architecture.md §19 implementation status explicitly calls out "product code never imports vendor SDKs" for outbound paths.

**Telnyx API version:** `/v2/messages` (stable as of 2026, no v3 announced). Pin via the `TELNYX_API_BASE` env var — if Telnyx ever forces migration, we change one env var, not code.

**Webhook signature algorithm:** `ed25519`. Telnyx supports `hmac-sha256` legacy but ed25519 is the default and recommended; our `TelnyxSignatureAuth` implements ed25519 only. If Telnyx fallback to hmac-sha256 happens in sandbox, upgrade the account to ed25519 before proceeding (common for old accounts).

**10DLC throughput:** New brands start at 1 MPS; Tier 1 brands go to 40 MPS; T-Mobile QNS gate applies independently. Default `CBL_TELNYX_MPS=1` and bump only after 10DLC brand + campaign approval. DO NOT encode higher throughput as a default — misconfigured deploys to new Telnyx accounts will 429-storm.

**Node.js ed25519 verification:** `crypto.verify('ed25519', null, publicKey, signature)` works natively in Node 20+. We are on Node ≥24 per CLAUDE.md. Use `crypto.createPublicKey({ key: rawBuffer, format: 'der', type: 'spki' })` to construct the public key from Telnyx's base64-encoded raw key.

### References

- [Source: architecture.md §6] — Consent Synchronization Latency (SMS Opt-Out → Kills Pending Email) — the synchronous STOP path
- [Source: architecture.md §7] — Webhook Burst Handling — thin webhook receiver pattern
- [Source: architecture.md §11] — Provider-Level Idempotency — `provider_idempotency_key` key formula
- [Source: architecture.md §15] — External Enrichment Rate Limiting — `provider_rate_counters` atomic pattern
- [Source: architecture.md §19] — Provider Failover — kill switch + warm standby; Twilio as Day-2 fallback
- [Source: architecture.md §22] — Provider Outage Queue Fallback Mode — `queued_degraded` status
- [Source: architecture.full.md §Funnel Telemetry Architecture (lines 165-218)] — `funnel_events` schema + emission contract
- [Source: _bmad-output/epics.md §Epic 3] — Story 3.1 outreach context
- [Source: _bmad-output/epics.full.md lines 916-1010] — Epic 3 story definitions
- [Source: _bmad-output/prd.md NFR24] — TCPA compliance: per-channel opt-out, enforce before outreach, audit all opt-outs
- [Source: _bmad-output/stories/1-12a-migrate-clay-ceipal-to-provider-framework.md] — pattern for `ensureProvidersInitialized`, audit-integration test, cross-story preservation
- [Source: _bmad-output/stories/1-12b-migrate-graph-anthropic-to-provider-framework.md] — pattern for admin-alert sink, kill-switch enforcement, log sink wiring
- [Source: _bmad-output/stories/1-12c-migrate-supabase-to-provider-framework.md] — pattern for non-wrapping health-only integration (not applicable here, but relevant for awareness)
- [Source: supabase/schema.sql lines 652-763] — existing `sms_sends`, `sms_templates`, `webhook_events`, `provider_routing_policies`, `provider_health_events` schemas
- [Source: src/modules/providers/] — framework primitives, auth strategies, registry, startup
- [Source: src/modules/providers/admin-alert.ts] — re-used verbatim for Telnyx health events
- [Source: _bmad-output/development-standards.md] — funnel telemetry emission is non-negotiable for all outreach modules

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
