# Story 3.1b: Telnyx SMS Provider Integration

Status: backlog

## Story

As a platform engineer,
I want to replace the stub SMS provider with a live Telnyx integration including authentication, delivery webhooks, rate limiting, and idempotent retries,
so that SMS messages actually reach candidates and delivery/response events flow back into the system.

## Context

Story 3.1 built the full SMS pipeline (templates, scheduling, consent, contact windows, audit) with a `StubSMSProvider`. This story wires up the real provider. Per architecture.md, Telnyx is the primary SMS provider with Twilio as warm standby (Day 2).

**Architecture references:**
- [architecture.md §External Systems] — Telnyx for two-way SMS
- [architecture.md §11] — Provider-level idempotency via `X-Idempotency-Key` header
- [architecture.md §7] — Webhook burst handling: thin receiver → raw event row → async processing
- [architecture.md §6] — Consent sync: opt-out must complete before Telnyx webhook returns 200

## Acceptance Criteria

### AC 1: Telnyx Account Authentication

**Given** the env vars `TELNYX_API_KEY` and `TELNYX_MESSAGING_PROFILE_ID` are set
**When** the application starts
**Then** `getSMSProvider()` returns a `TelnyxSMSProvider` instead of the stub
**And** if either env var is missing, the stub provider continues to be used (graceful degradation, not crash)
**And** the API key is validated on first send attempt — a 401 from Telnyx triggers an admin alert and marks the provider as `unhealthy`

### AC 2: Send SMS via Telnyx API

**Given** the SMS pipeline dispatches a send via `TelnyxSMSProvider`
**When** `send(to, body, idempotencyKey)` is called
**Then** it makes a `POST https://api.telnyx.com/v2/messages` with:
- `Authorization: Bearer {TELNYX_API_KEY}`
- `X-Idempotency-Key: {idempotencyKey}` (per architecture.md §11)
- Body: `{ "from": "{TELNYX_FROM_NUMBER}", "to": "{to}", "text": "{body}", "messaging_profile_id": "{TELNYX_MESSAGING_PROFILE_ID}" }`
**And** the response `message_id` is stored as `provider_message_id` on the `sms_sends` row
**And** errors are classified: `4xx` = permanent failure, `429` = rate limited (retry after backoff), `5xx` = transient (retry)

### AC 3: Delivery Status Webhook

**Given** Telnyx fires a delivery webhook to `POST /api/webhooks/telnyx`
**When** the event type is `message.sent`, `message.delivered`, `message.failed`, or `message.undeliverable`
**Then** the webhook handler validates the request signature (Telnyx webhook signing secret)
**And** writes a raw event row to `webhook_events` table (thin receiver pattern per architecture.md §7, target < 100ms response)
**And** returns 200 OK immediately
**And** a background processor drains `webhook_events` and updates the corresponding `sms_sends` row status
**And** delivery status changes are logged to `outreach_audit_log`

### AC 4: Inbound Reply Webhook (STOP, YES, freeform)

**Given** a candidate replies to an SMS
**When** Telnyx fires an inbound webhook (`message.received` event)
**Then** the handler validates the signature, writes to `webhook_events`, returns 200
**And** the background processor classifies the response:
- STOP / UNSUBSCRIBE / CANCEL → `response_type = 'opt_out'` → triggers `recordOptOut()` synchronously before returning (per architecture.md §6)
- YES / INTERESTED / AVAILABLE → `response_type = 'affirmative'`
- NO / NOT INTERESTED / UNAVAILABLE → `response_type = 'negative'`
- Anything else → `response_type = 'freeform'`
**And** `sms_sends.response_received_at`, `response_body`, and `response_type` are updated
**And** the response is logged to `outreach_audit_log`

### AC 5: Rate Limiting and Throttling

**Given** Telnyx has per-number throughput limits (1 MPS default, 10 MPS with 10DLC)
**When** the SMS dispatch job processes a batch of sends
**Then** sends are throttled to respect the configured rate limit (`TELNYX_RATE_LIMIT_PER_SECOND`, default 1)
**And** 429 responses trigger exponential backoff (1s → 2s → 4s → 8s, max 30s)
**And** the rate limiter is implemented as a simple token bucket or `setTimeout` delay between sends in the batch loop

### AC 6: Retry with Bounded Backoff

**Given** a send attempt fails with a transient error (5xx or network error)
**When** the retry policy evaluates
**Then** up to 3 retry attempts are made with escalating delay (30s, 120s, 300s)
**And** after 3 failures, status is set to `undeliverable` with the error details
**And** an admin alert is logged for terminal failures
**And** each retry attempt increments `delivery_attempt_count` and updates `last_attempt_at`

### AC 7: Idempotency Key Design

**Given** the send pipeline generates an idempotency key
**When** it is passed to Telnyx via `X-Idempotency-Key` header
**Then** duplicate sends (from worker retries after crash) are prevented at the Telnyx level
**And** the key format is `sha256(tenantId + candidateId + templateId + templateVersion + sendId)` — deterministic and stable across retries
**And** if Telnyx returns a cached response for a duplicate key, the worker writes the original `message_id` and marks complete

### AC 8: Provider Health Monitoring

**Given** Telnyx API calls are being made
**When** rolling 1-hour error rate exceeds 5% or response latency p95 exceeds 5 seconds
**Then** the provider health status is set to `degraded` and an admin alert is sent
**And** if error rate exceeds 20%, the provider is marked `unhealthy` and sends are paused until manual re-enable
**And** health status is visible in the admin scheduler dashboard

## Tasks / Subtasks

- [ ] Task 1: Payload discovery spike
  - [ ] 1.1 Create Telnyx sandbox account and obtain API key + messaging profile
  - [ ] 1.2 Send test SMS via Telnyx API, capture real request/response payloads
  - [ ] 1.3 Configure Telnyx webhook URL, receive delivery + inbound callbacks, capture real payloads
  - [ ] 1.4 Freeze all captured payloads as test fixtures in `src/modules/__tests__/fixtures/telnyx/`
  - [ ] 1.5 Document field name mappings (Telnyx response → our schema)

- [ ] Task 2: TelnyxSMSProvider implementation
  - [ ] 2.1 Create `src/modules/outreach/telnyx-provider.ts` implementing `SMSProvider` interface
  - [ ] 2.2 HTTP client with auth header, timeout (10s), and error classification (4xx/429/5xx)
  - [ ] 2.3 Idempotency key generation and `X-Idempotency-Key` header
  - [ ] 2.4 Update `getSMSProvider()` to return Telnyx when env vars are set, stub otherwise
  - [ ] 2.5 Rate limiter (token bucket, configurable MPS)

- [ ] Task 3: Webhook infrastructure
  - [ ] 3.1 Create `webhook_events` table (id, source, event_type, raw_payload jsonb, processed boolean, created_at)
  - [ ] 3.2 Create `POST /api/webhooks/telnyx` — signature validation, raw write, 200 OK (< 100ms)
  - [ ] 3.3 Create webhook event processor (background drain loop or scheduler job)
  - [ ] 3.4 Delivery status processor: update sms_sends status from webhook events
  - [ ] 3.5 Inbound reply processor: classify response, update sms_sends, trigger opt-out for STOP

- [ ] Task 4: Retry policy
  - [ ] 4.1 Implement bounded retry with escalating delay (30s, 120s, 300s)
  - [ ] 4.2 Terminal failure handling: mark `undeliverable`, log admin alert
  - [ ] 4.3 Integrate retry into SMSOutreachJob dispatch loop

- [ ] Task 5: Health monitoring
  - [ ] 5.1 Track rolling error rate and p95 latency per provider
  - [ ] 5.2 Health status enum: healthy / degraded / unhealthy
  - [ ] 5.3 Admin alert on threshold breach

- [ ] Task 6: Tests
  - [ ] 6.1 Unit tests: TelnyxSMSProvider (mock HTTP, fixture-based), idempotency key, rate limiter
  - [ ] 6.2 Webhook tests: signature validation, thin receiver, event processing, response classification
  - [ ] 6.3 Retry tests: escalating delay, terminal failure, idempotent recovery
  - [ ] 6.4 Integration test: full send → webhook → status update flow (with mocked Telnyx)

## Dev Notes

### Env Vars (New)

| Var | Required | Description |
|-----|----------|-------------|
| `TELNYX_API_KEY` | Yes (for live SMS) | Telnyx API v2 bearer token |
| `TELNYX_MESSAGING_PROFILE_ID` | Yes | Messaging profile ID from Telnyx portal |
| `TELNYX_FROM_NUMBER` | Yes | E.164 phone number (e.g., `+18005551234`) |
| `TELNYX_WEBHOOK_SECRET` | Yes | Webhook signing secret for signature validation |
| `TELNYX_RATE_LIMIT_PER_SECOND` | No (default: 1) | Per-number throughput limit |

### Architecture Patterns to Follow

- **Thin webhook receiver** (architecture.md §7): validate signature → write raw event → return 200. No business logic in the handler.
- **Consent sync** (architecture.md §6): STOP opt-out must complete synchronously before webhook returns 200.
- **Idempotency** (architecture.md §11): `X-Idempotency-Key` header on every Telnyx API call. Key is deterministic.
- **Provider abstraction**: `TelnyxSMSProvider` implements the same `SMSProvider` interface as `StubSMSProvider`. Zero changes to the send pipeline (jobs.ts, send/route.ts).

### 10DLC Compliance Note

US A2P SMS requires 10DLC registration (10-Digit Long Code). This is an account-level setup in Telnyx portal, not code. Ensure:
- Brand registration is complete
- Campaign use case is registered (recruiting/staffing)
- Throughput tier matches expected volume (1 MPS → 10 MPS after approval)

### Dependency

- Story 3.1 must be complete (provides: SMSProvider interface, sms_sends table, audit log, scheduler job)
- This story is a prerequisite for Story 3.4 (response capture) and Story 3.5 (delivery tracking at scale)

### References

- [Source: architecture.md §External Systems] — Telnyx as primary SMS provider
- [Source: architecture.md §7] — Webhook burst handling pattern
- [Source: architecture.md §6] — Consent synchronization latency
- [Source: architecture.md §11] — Provider-level idempotency
- [Source: src/modules/outreach/sms-provider.ts] — SMSProvider interface and getSMSProvider()

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
