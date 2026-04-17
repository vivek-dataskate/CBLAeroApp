# Story 3.2a: Instantly Email Campaign Provider Integration

Status: ready-for-dev

## Story

As a platform engineer,
I want to integrate Instantly as the email campaign provider — with authentication, sequence management, delivery/engagement webhooks, rate limiting, and kill-switch fallback to Microsoft Graph —
so that recruiters can launch compliant, TCPA/CAN-SPAM-aware campaign emails at bulk scale while reusing the Edge System Provider Framework (Story 1.12) for observability, retry, and health tracking, and honoring cross-channel consent sync with SMS (Telnyx).

## Context

This is the **first Epic 3 provider consumer** of the Edge System Provider Framework (Story 1.12). It builds on the outbound/inbound patterns proven by Clay + Ceipal (1.12a), Graph + Anthropic (1.12b), and the Supabase migration-in-progress (1.12c), and shares webhook receiver infrastructure with the upcoming Telnyx integration (3.1b). It directly consumes `candidate_channel_preferences` + `outreach_audit_log` introduced in sibling stories 3.1 (SMS) and 3.2 (email templates + stub provider).

**Why Instantly:** Architecture §Integration Matrix (line 254) designates Instantly as the primary campaign-email provider; Graph is the **degraded-mode fallback** for ad-hoc + critical emails only. This story delivers that capability end-to-end — authentication, campaign/sequence management, engagement webhooks, unsubscribe handling, rate-limiting, cross-channel consent sync, and a tested kill-switch path.

**Discovery spike REQUIRED before coding (Task 0):** Instantly public API docs are limited and payload shapes drift. The first task of this story is a 1-day spike that captures real Instantly API and webhook payloads into `_bmad-output/source-inputs/instantly-api-discovery.md`. No implementation may begin until the spike artifacts are committed and reviewed. See Task 0 below.

**Blast radius:** Medium. Instantly is the only outreach path for bulk campaigns; a bug can silently fail 5,000-recipient sends or leak TCPA/CAN-SPAM violations if consent checks regress. The 5-second cross-channel consent sync latency (architecture §6) is a compliance hard line — must be enforced by the outbox relay, NOT only at enqueue time.

**Depends on (must be done):**
- **Story 1.12** — Edge System Provider Framework (`BaseProviderClient`, `BaseWebhookReceiver`, `ProviderRegistry`, `PostgresHealthEventStore`, `provider_routing_policies`, `webhook_events`, `provider_health_events`). **DONE** 2026-04-16.
- **Story 1.12b** — Graph on framework. **Required because the kill-switch fallback routes ad-hoc + critical mail through `GraphProviderClient`.** DONE 2026-04-17.
- **Story 3.1b** — Telnyx SMS on framework. Shares `webhook_events` infrastructure AND is the source of the cross-channel opt-out signal that cancels Instantly sequences. If 3.1b is not yet done at dev time, implement the Instantly side of cross-channel consent sync against a mockable seam (`ConsentRevocationListener` interface) so 3.1b can wire it in. **DO NOT block on 3.1b** — build the seam, document the contract, and let 3.1b land the Telnyx-side emit.
- **Story 3.2** — email templates + stub provider. Provides the `EmailProvider` interface, message template storage, and the stub implementation that this story replaces. The stub remains available for unit tests.

**Shares tables with Story 3.1:** `candidate_channel_preferences` (already in schema — [supabase/schema.sql:211-228](supabase/schema.sql)), `outreach_audit_log` (already in schema — [supabase/schema.sql:478-498](supabase/schema.sql)), `webhook_events` (1.12 framework — [supabase/schema.sql:745-763](supabase/schema.sql)). **Do not create parallel tables.** If Story 3.1's SMS flow already writes to `outreach_audit_log` with `channel='sms'`, this story writes identical-shape rows with `channel='email'`.

## Funnel Lever & Measurement

**REQUIRED — this is MANDATORY per the PRD north-star KPI (Beat LinkedIn RPS Recruiter Funnel: 100 InMails → 28 responses → 14 submissions → 0.5 closures/$200).**

- **Funnel lever(s) moved:** Outreach-sent volume | Response rate | Recruiter time reduction
- **Expected lift:**
  - **Outreach-sent volume: +400% vs. LinkedIn InMail cap** — Instantly supports bulk sequences of 500+ recipients per warm-up cohort; LinkedIn manual InMail caps recruiters at ~100/week.
  - **Response rate: +5–12 percentage points vs. 28% LinkedIn baseline** — personalized sequence email (3-touch sequence with reply-threading) historically outperforms a single InMail; target `≥33%` open-to-reply rate based on Instantly benchmark for recruiting campaigns (to be calibrated after 30 days of production).
  - **Recruiter time reduction: 10–15 min/day** — eliminates manual copy-paste into Graph; single "Launch campaign" action replaces sequential per-candidate sends.
- **How lift is measured:**
  - **Outreach volume:** `outreach.message.sent` event count per recruiter per day (channel='email'), viewed on `/dashboard/recruiter/funnel` (Epic 10 dashboard).
  - **Response rate:** `(outreach.email.replied` event count) / (`outreach.message.sent` event count) over 7-day rolling window, per recruiter and per campaign. Open rate (`outreach.email.opened`) and click rate (`outreach.email.clicked`) are secondary funnel metrics.
  - **Bounce / unsubscribe rate:** `outreach.email.bounced_hard` + `outreach.email.unsubscribed` events — alerts at >2% hard-bounce rate in rolling 24h (reputation guardrail).
  - **Recruiter time:** log `campaign.launched` event timestamp vs. cohort size; compute avg seconds-per-recipient-dispatched; report on admin cost dashboard (Story 1-9a).
- **Baseline comparison:** LinkedIn RPS baseline = 28% response rate, 0.5 closures per 100 outbound InMails, recruiter spend ~$200/100 InMails. Target: ≥33% response rate via email (vs. 28% LinkedIn), ≥4x volume, measured weekly.

## Acceptance Criteria

### AC 0: Discovery Spike Artifacts Published

**Given** Instantly API surface and webhook payload shapes are not fully documented in public sources
**When** Task 0 completes
**Then** `_bmad-output/source-inputs/instantly-api-discovery.md` exists with:
- All API endpoints used by this story with real request/response examples (create campaign, add leads to campaign, launch campaign, pause campaign, remove lead from sequence, get campaign status)
- All webhook event payloads captured from a real Instantly test campaign: `email.sent`, `email.opened`, `email.clicked`, `email.replied`, `email.bounced` (hard + soft), `email.unsubscribed`, `campaign.completed`
- Observed rate-limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) + the daily-send cap + warm-up schedule behavior documented for the active account
- Authentication mechanism confirmed (API key header — name + location) with example curl
- Error response shapes (4xx + 5xx) with actual status codes and body examples
**And** the spike is reviewed by the story owner before Task 1 begins
**And** the spike captures the `idempotency` / dedup semantics for adding the same email to a sequence twice (per architecture §11 line 719: "Instantly: sequence membership dedup")

### AC 1: InstantlyProviderClient — Outbound via `BaseProviderClient`

**Given** a Supabase `email_campaign` record is ready to launch
**When** the worker calls `InstantlyProviderClient.launchCampaign(campaign, recipients[])`
**Then** all HTTP calls go through `BaseProviderClient` with:
- `ApiKeyHeaderAuth` strategy — env var `INSTANTLY_API_KEY`, header name confirmed in discovery spike (default assumption: `Authorization: Bearer <key>` until spike proves otherwise — update in discovery doc + code)
- 15-second timeout (bulk upload endpoints may be slower than default 10s)
- Retry policy default `[408, 429, 500, 502, 503, 504]`
- Structured `ProviderLogEntry` JSON line per call: `{provider:'instantly', method, path, statusCode, durationMs, attempt, errorClassification?}`
- Cost tracking hook: `costMeta: { endpoint, recipientCount?, sequenceId? }` passed via `RequestOptions.costMeta` for future per-campaign cost attribution
**And** the client exposes these typed methods (names final; signatures confirmed by spike):
- `createCampaign(input: CampaignInput): Promise<ProviderCallResult<{campaignId: string}>>`
- `addLeadsToCampaign(campaignId: string, leads: LeadInput[]): Promise<ProviderCallResult<{added: number, skipped_duplicate: number}>>`
- `launchCampaign(campaignId: string): Promise<ProviderCallResult>`
- `pauseCampaign(campaignId: string): Promise<ProviderCallResult>` — called by kill-switch
- `removeLeadFromSequence(campaignId: string, email: string): Promise<ProviderCallResult>` — called by consent revocation
- `getCampaignStatus(campaignId: string): Promise<ProviderCallResult<CampaignStatus>>`
**And** the client is registered in `ProviderRegistry.register('instantly')` + `wireClient('instantly', client.base)` in `ensureProvidersInitialized()` (per 1-12a pattern)
**And** `initializeLLMProviderFromStartup`-equivalent skip logic applies: if `INSTANTLY_API_KEY` is unset, the provider is NOT registered and `getInstantlyProvider()` returns null (graceful degrade, same pattern as Anthropic in 1-12b)

### AC 2: Campaign Launch End-to-End

**Given** a recruiter creates a bulk email campaign via the Epic 3.7 UI (Story 3.7 bulk campaign execution owns the UI; this story provides the worker-side contract)
**When** the worker dequeues a `campaign.launch` outbox event
**Then** the worker:
1. Loads the campaign + recipients from Supabase, filtering out opt-out candidates per `candidate_channel_preferences.email_opted_in=false`
2. Loads rendered message bodies from the template system (Story 3.2)
3. Calls `InstantlyProviderClient.createCampaign()` with subject, body, sequence config
4. Calls `addLeadsToCampaign(campaignId, leads)` — each lead carries the candidate email + substitution fields
5. Calls `launchCampaign(campaignId)` — transitions campaign to `launched` status in Instantly
6. Stores `campaign.instantly_campaign_id`, `campaign.launched_at`, `campaign.recipient_count_sent` in Supabase
7. Emits `campaign.launched` event to `outbox_events` + writes one `outreach_audit_log` row per recipient with `channel='email'`, `delivery_status='queued'`, `send_id=<outbox_event_id>`, `content_hash=sha256(rendered_body)`, `compliance_check_passed=true`
8. Writes `candidate_outreach_lock` row for each recipient (per architecture §10 line 714) with `last_channel='email'`, `lock_expires_at=now()+24h` UNLESS cooldown already held by another channel (then skip + emit `outreach.skipped.cooldown`)

**And** the worker MUST check each recipient's consent TWICE:
- Once at enqueue (when the outbox event is created — duplicate of the UI gate)
- Once at dequeue (right before calling Instantly) — per architecture §6 anti-pattern prohibition: "checking consent only at enqueue"
**And** if a recipient fails consent check at dequeue, the worker removes them from the lead list (not the entire campaign) and writes `outreach.skipped.consent_revoked` audit event

### AC 3: Webhook Receiver — Engagement Events

**Given** Instantly emits webhooks for `email.sent`, `email.opened`, `email.clicked`, `email.replied`, `email.bounced`, `email.unsubscribed`, `campaign.completed`
**When** Instantly POSTs to `/api/webhooks/instantly`
**Then** the receiver uses `BaseWebhookReceiver` with:
- `source='instantly'`
- Auth strategy confirmed by spike (HMAC signature OR bearer token — default assumption: HMAC SHA-256 with `INSTANTLY_WEBHOOK_SECRET`; update per spike)
- `maxPayloadBytes=256*1024` (same default as Clay)
- Replay protection: 5-minute window using the timestamp header from the spike
- `provider_event_id` = Instantly's per-event UUID extracted from payload (if one exists — spike confirms field name; otherwise `null`)
- `event_type` = one of `email.sent | email.opened | email.clicked | email.replied | email.bounced | email.unsubscribed | campaign.completed`
- Rate limit: 500/minute per source (bulk campaigns can burst — higher than Clay's 100/min default)
**And** the receiver enforces the thin-webhook pattern (architecture §7 line 697): signature validate → size check → parse → dedup via `webhook_events` (unique on `(source, provider_event_id)` when present) → insert row → 200 OK in <100ms
**And** a `WebhookProcessor` background drain claims events with `FOR UPDATE SKIP LOCKED` (framework already implements) and dispatches to a `InstantlyWebhookHandler` that:
- For `email.sent` → update `outreach_audit_log.delivery_status='sent'` where `send_id` matches
- For `email.opened` → emit `outreach.email.opened` audit event, update per-candidate engagement score
- For `email.clicked` → emit `outreach.email.clicked` audit event
- For `email.replied` → emit `outreach.email.replied` audit event; alert recruiter via Teams card (reuse Epic 3.4 response capture hook); mark candidate engagement as positive
- For `email.bounced` with `bounce_type='hard'` → set `candidate_channel_preferences.email_opted_in=false`, `email_opt_out_reason='hard_bounce'`; emit `outreach.email.bounced_hard` audit; **permanent** — no retry
- For `email.bounced` with `bounce_type='soft'` → increment per-recipient soft-bounce counter; after 3 soft bounces within 7 days → escalate to hard-bounce treatment; otherwise retry allowed
- For `email.unsubscribed` → IMMEDIATELY write `candidate_channel_preferences.email_opted_in=false`, `email_opt_out_at=now()`, `email_opt_out_reason='unsubscribe_link_clicked'`; emit `consent.email.revoked` audit; cancel any pending Instantly sequences for this candidate via `removeLeadFromSequence` (fire-and-forget with retry on failure)
- For `campaign.completed` → update `email_campaign.status='completed'`, `completed_at=now()`
**And** the handler returns `WebhookHandlerResult` with `meta = { campaignId, candidateId, eventType, outcome }` so `webhook_events.result_meta` is populated
**And** failed handler calls retry 3 times with exponential backoff then dead-letter (framework default)

### AC 4: Cross-Channel Consent Synchronization (<5s latency)

**Given** a candidate texts STOP to Telnyx (SMS opt-out), triggering the Telnyx webhook handler (Story 3.1b)
**When** Story 3.1b's handler synchronously writes the consent revocation to `candidate_channel_preferences.sms_opted_in=false` AND emits a `consent.sms.revoked` event to the cross-channel consent bus
**Then** this story's `InstantlyConsentRevocationListener` consumes that event and:
1. Finds all `email_campaign` rows with this candidate in an active sequence (i.e., `instantly_campaign_id IS NOT NULL` AND `status='launched'` AND candidate is in `campaign.recipient_emails[]`)
2. Cancels the pending outbox row for that recipient (if any)
3. Calls `InstantlyProviderClient.removeLeadFromSequence(campaignId, email)` for each active sequence
4. Writes `outreach.sequence.cancelled_consent` audit row per cancelled sequence
**And** steps 1–3 complete within **5 seconds** of the Telnyx webhook receipt (measured end-to-end: Telnyx webhook POST → `candidate_channel_preferences.sms_opted_in=false` → Instantly sequence removed)
**And** a test asserts this latency with a mock Instantly API that records call timestamps
**And** the `InstantlyConsentRevocationListener` interface is defined in `src/modules/providers/instantly/consent-listener.ts` so Story 3.1b's Telnyx handler can wire the emission without tight coupling
**And** if Instantly rejects `removeLeadFromSequence` (e.g., 404 "lead not in sequence"), the listener treats it as success (idempotent); other errors retry 3× then dead-letter to `webhook_events` with `status='dead_letter'` + admin alert

**Cross-reference:** This AC is the email-side mirror of Story 3.1b's SMS-side opt-out flow. The contract MUST match architecture §6 (line 692–695): "Consent revocation is synchronous, highest-priority. … target <5s Telnyx → all pending cancelled."

### AC 5: Rate Limiting + Warm-Up Schedule Awareness

**Given** Instantly accounts have daily send limits (e.g., 500/day new account, scaling up via warm-up) AND per-minute rate limits via the API
**When** the worker is about to dispatch a campaign launch
**Then** the worker checks `provider_rate_counters` (architecture §15 pattern — same table used by Clay/RapidAPI/FAA) with `provider_id='instantly'` scoped by tenant:
- Daily counter: `(provider_id, tenant_id, window='daily', window_start=<midnight UTC>)` — increments by `recipients.length`
- Per-minute counter: `(provider_id, tenant_id, window='minute', window_start=<current minute>)` — increments by 1 per API call
**And** if the daily counter + `recipients.length` would exceed the configured daily cap (env `INSTANTLY_DAILY_SEND_CAP`, default 500), the worker splits the campaign across days: the first N recipients go out today, the remaining are re-enqueued as `campaign.launch` outbox events with `scheduled_at=tomorrow_midnight_utc`
**And** the daily cap is configurable per tenant via `policy_registry` under key `outreach.email.instantly_daily_cap` (per architecture §24 zero-inference rule — **DO NOT hardcode**; fallback to env default if policy missing, but log a warning)
**And** on Instantly `429` response, the worker honors `Retry-After` header + re-queues the job with exponential backoff (framework default)
**And** `provider_health_events` records `rate_limit_hit` transitions so the admin dashboard surfaces warm-up-cap vs. true-API-limit distinction

### AC 6: Kill Switch + Graph Fallback

**Given** Instantly enters `degraded` or `kill_switched` mode (auto-triggered by framework at 30% error rate / ≥10 attempts per Story 1.12 framework, OR manually by admin via `provider_routing_policies.mode` UPDATE)
**When** the worker picks up a `campaign.launch` outbox event
**Then**:
- **Bulk campaigns pause.** Worker does NOT re-route bulk sends to Graph (Graph cannot scale to 500-recipient sequences). Instead: marks the outbox event `queued_degraded` per architecture §22 line 782, UI shows "paused due to provider incident", retains position in queue, resumes automatically when Instantly returns to `normal`.
- **Ad-hoc + critical emails fall back to Graph.** If the outbox event carries `kind='adhoc_email'` OR `priority='critical'` (e.g., offer letter, interview confirmation), the worker routes to `GraphProviderClient` from Story 1.12b. Recruiter UI shows a subtle "Sent via backup email path" badge.
**And** `outreach_audit_log` captures the actual provider used (`provider='instantly' | 'graph'`) in a new column `provider_used` (adds to existing schema via migration) so dashboards can distinguish fallback volume
**And** `provider_routing_policies` has a row for `channel='email_campaign'` with `primary_provider='instantly'`, `fallback_provider='graph'`, `mode='normal'`, seeded in the startup migration
**And** when mode transitions occur, the Teams admin channel receives a Graph-delivered notification (reuse Story 1.12b admin-alert sink at `CBL_PROVIDER_ALERT_EMAIL`)
**And** **failback from Graph → Instantly is MANUAL** per architecture §19 line 759; admin action via `/dashboard/admin/providers` flips `mode='normal'`; observability shows the transition

### AC 7: Provider-Level Idempotency (No Duplicate Sends on Retry)

**Given** architecture §11 line 719 requires: "Every outreach job stores `provider_idempotency_key` passed to provider on every attempt. Instantly: sequence membership dedup."
**When** a campaign launch retries (worker crash mid-dispatch, 5xx from Instantly, etc.)
**Then**:
- The worker computes `provider_idempotency_key = sha256(tenant_id + candidate_id + job_requirement_id + message_template_version + send_window_date)` per recipient and stores it in `outreach_jobs` (table already in architecture spec; migration creates if absent)
- `addLeadsToCampaign` call uses **Instantly's built-in sequence-membership dedup**: adding the same email to the same campaign twice is a no-op at Instantly's API level. The worker relies on this AND pre-checks `outreach_jobs.send_status` before dispatch.
- On retry, the worker fetches `outreach_jobs WHERE provider_idempotency_key=?` — if `send_status='sent'`, the retry is a no-op; if `send_status='pending'` or `'failed'`, the retry proceeds.
**And** integration tests prove: same campaign launched twice (simulating worker crash + retry) produces exactly one `outreach_audit_log` row per recipient, one Instantly API call sequence, zero duplicate candidate sends.

### AC 8: Logging + Audit Guardrails (per 1.12a pattern)

**PRESERVE from prior stories:**
1. `[Instantly]` console prefix on every legacy log site (additive to framework JSON logs)
2. `webhook_events.result_meta` populated for every processed event
3. `outreach_audit_log` rows written for every dispatch + every inbound engagement event

**ADD (new behavior from framework):**
4. Every outbound Instantly call emits exactly one `ProviderLogEntry` JSON line with fields populated even on failure, including `errorClassification` on failure
5. Every inbound Instantly webhook event emits exactly one `WebhookLogEntry` per event row with `{source:'instantly', eventType, payloadSize, signatureValid, duplicate, outcome, processingTimeMs}`
6. Every `ProviderRegistry` mode transition writes to `provider_health_events` via `PostgresHealthEventStore` (framework default)
7. Dead-letter events at `webhook_events.status='dead_letter'` emit `console.error` structured log line

**NEVER LOG (security):**
8. Instantly API key value, webhook secret, or any Authorization header
9. Full candidate PII (email, phone, name) — log candidate UUID, hash the email if needed
10. Full rendered email body — log only `content_hash` (sha256) and template version
11. Bulk recipient lists — log counts and per-row candidate UUID, not addresses

**INTEGRATION TEST GATE:**
12. Add `src/modules/__tests__/providers-instantly-audit.test.ts` — fire a full dispatch cycle: create campaign → add 3 leads (1 opt-out after dequeue) → launch → receive 2 `email.sent` + 1 `email.opened` + 1 `email.replied` webhooks. Assert:
    - 3 `outreach_audit_log` rows with `channel='email'`, correct `delivery_status` transitions
    - 4 `webhook_events` rows with `status='completed'`, `result_meta` populated
    - 0 rows in `sync_errors`
    - `provider_log_entries` stdout count matches API call count
    - `webhook_log_entries` stdout count = 4
    - `[Instantly]` prefix visible on legacy logs
    - `outreach_audit_log` carries `content_hash` (not body), `compliance_check_passed=true`

### AC 9: Zero Regressions on Graph + Clay + Ceipal (Earlier Migrations)

**Given** Graph (1.12b) + Clay + Ceipal (1.12a) are live on the provider framework
**When** this story lands
**Then** all 609 tests from 1.12b baseline (+ 110 framework tests + 98 Clay/Ceipal tests) still pass with zero behavior change in those modules
**And** `GraphProviderClient` gains no new callers in this story EXCEPT the kill-switch fallback path (AC 6) — Graph remains the primary for ad-hoc + inbox
**And** `npm run typecheck` clean, `npm run lint` clean (no new warnings on new files)
**And** `npm run residency:preflight` passes — no new non-USA providers introduced

## Tasks / Subtasks

### Task 0: Discovery Spike (AC: 0) — BLOCKING

- [ ] 0.1 Set up Instantly sandbox / test account with known API key + webhook endpoint (e.g., via `ngrok` or a Render preview URL)
- [ ] 0.2 Create a test campaign with 3 dummy leads; capture every API request/response (use `curl -v` or `mitmproxy`)
- [ ] 0.3 Trigger webhook events (send to real email boxes you control; click the links, reply, unsubscribe, hard-bounce simulation)
- [ ] 0.4 Capture all observed webhook payloads verbatim with headers into `_bmad-output/source-inputs/instantly-api-discovery.md`
- [ ] 0.5 Document auth mechanism (header name, format), rate-limit headers, daily cap, warm-up schedule semantics
- [ ] 0.6 Document error response shapes (401, 403, 404, 429, 500, 502, 503)
- [ ] 0.7 Confirm sequence-membership dedup behavior (add same lead twice → expected response)
- [ ] 0.8 Review discovery doc with story owner; only then proceed to Task 1

### Task 1: `InstantlyProviderClient` — Outbound (AC: 1)

- [ ] 1.1 Create `src/modules/providers/instantly/` directory (consumer-owned, adjacent to framework, per 1.12a pattern)
- [ ] 1.2 Create `src/modules/providers/instantly/instantly-client.ts` — wraps `BaseProviderClient`; env builder `buildInstantlyProviderClientFromEnv()` reads `INSTANTLY_API_KEY`, `INSTANTLY_API_BASE_URL` (default confirmed by spike)
- [ ] 1.3 Auth strategy: use existing `ApiKeyHeaderAuth` OR `BearerTokenAuth` per spike confirmation; do NOT create a new strategy unless spike proves Instantly uses something framework doesn't cover
- [ ] 1.4 Implement typed methods: `createCampaign`, `addLeadsToCampaign`, `launchCampaign`, `pauseCampaign`, `removeLeadFromSequence`, `getCampaignStatus`
- [ ] 1.5 Each call passes `costMeta: { endpoint, recipientCount?, sequenceId? }`; `estimateCost` left undefined unless spike reveals a pricing model the framework can score
- [ ] 1.6 Unit tests `src/modules/__tests__/providers-instantly-client.test.ts` — ≥15 tests covering: happy paths for each method, 429 retry, 500 retry, 401 `auth_failure` classification, timeout, header injection, bad-config throw, env-builder fallback, `costMeta` plumbed through

### Task 2: Registry Wiring + Startup Seed (AC: 1, 6)

- [ ] 2.1 Extend `src/modules/providers/startup.ts::ensureProvidersInitialized()` to register `instantly` when `INSTANTLY_API_KEY` is set; `null` and skip if absent (match Anthropic pattern from 1.12b)
- [ ] 2.2 Create `supabase/migrations/2026-04-XX-story-3-2a-instantly-routing-seed.sql` — idempotent `INSERT ON CONFLICT (channel) DO NOTHING` seed for `provider_routing_policies` row: `channel='email_campaign'`, `primary_provider='instantly'`, `fallback_provider='graph'`, `mode='normal'`
- [ ] 2.3 Wire default `onLog` JSON-line sink for `instantly` client (per 1.12a Patch in code review)
- [ ] 2.4 Update `src/modules/providers/__tests__/providers-startup.test.ts` to assert `instantly` appears in `registry.listProviders()` when env set; absent when unset

### Task 3: Campaign Launch Worker + Outbox Flow (AC: 2, 7, 8)

- [ ] 3.1 Create `src/features/outreach/application/email-campaign-dispatcher.ts` — consumes `campaign.launch` outbox events, orchestrates: consent-filter recipients → load rendered templates → create campaign → add leads → launch → write audit + lock
- [ ] 3.2 Implement consent double-check: once at enqueue (`EmailCampaignService.enqueueLaunch`), once at dequeue (`EmailCampaignDispatcher.dispatch`); dequeue skip writes `outreach.skipped.consent_revoked` audit
- [ ] 3.3 Implement `candidate_outreach_lock` write per recipient per architecture §10; skip + emit `outreach.skipped.cooldown` if `now() < lock_expires_at`
- [ ] 3.4 Compute `provider_idempotency_key` per recipient + store in `outreach_jobs` table (migration creates if absent; use `sha256(tenant_id|candidate_id|job_requirement_id|template_version|send_window_date)`)
- [ ] 3.5 On retry, pre-check `outreach_jobs.send_status` — skip if `'sent'`
- [ ] 3.6 Write one `outreach_audit_log` row per recipient with `content_hash` (NOT body), `template_id`, `compliance_check_passed=true`, `provider_used='instantly'`
- [ ] 3.7 Unit tests for dispatcher: consent-filter, cooldown skip, idempotency key determinism, opt-out after enqueue, partial-campaign recovery
- [ ] 3.8 Integration test `src/modules/__tests__/providers-instantly-audit.test.ts` (AC 8 gate)

### Task 4: Webhook Receiver + Handler (AC: 3)

- [ ] 4.1 Create `src/modules/providers/instantly/instantly-webhook-receiver.ts` — instantiate `BaseWebhookReceiver` with `source='instantly'`, auth strategy per spike, `maxPayloadBytes=256*1024`, `rateLimitMax=500/min`, `extractEvents` per Instantly payload shape (spike confirms)
- [ ] 4.2 Create `src/modules/providers/instantly/instantly-webhook-handler.ts` — `WebhookHandler.handle(event)` switches on `event_type` and dispatches to per-event handlers; returns `WebhookHandlerResult`
- [ ] 4.3 Implement per-event handlers: sent, opened, clicked, replied, bounced (hard/soft), unsubscribed, campaign.completed
- [ ] 4.4 Hard-bounce: write `candidate_channel_preferences.email_opted_in=false` synchronously; soft-bounce: increment `candidate_soft_bounce_counter` (new table OR column on `candidate_channel_preferences` — decide in Task 4.3 review); 3 soft bounces in 7 days → escalate to hard
- [ ] 4.5 Unsubscribe: write `candidate_channel_preferences.email_opted_in=false` synchronously + call `removeLeadFromSequence` for any active campaign
- [ ] 4.6 Reply: emit `outreach.email.replied` audit + trigger Teams recruiter alert card (reuse Story 3.4 response hook if available; else leave a TODO + mock seam)
- [ ] 4.7 Create `POST /api/webhooks/instantly/route.ts` — thin route per 1.12a pattern: env check → `ensureProvidersInitialized()` → receiver.receive() → processor.processBatch() (synchronous drain for simplicity; revisit if latency budget violated) → response
- [ ] 4.8 Route tests: auth failure, replay rejection, signature mismatch, rate limit, malformed payload, 7 event types processed correctly, dead-letter after 3 retries, `result_meta` populated

### Task 5: Cross-Channel Consent Sync (AC: 4)

- [ ] 5.1 Define `src/modules/providers/instantly/consent-listener.ts` — `InstantlyConsentRevocationListener` interface + default implementation; subscribes to the cross-channel consent bus (if Story 3.1 introduces one) OR polls a shared event store
- [ ] 5.2 Integration with 3.1b's Telnyx handler: either (a) 3.1b emits to an in-process EventEmitter that this listener consumes, OR (b) both listen to `consent.sms.revoked` rows in `outreach_audit_log` with a short-polling worker. Pick (a) if 3.1b is done at dev time; else (b) + leave a TODO for 3.1b to wire (a)
- [ ] 5.3 On revocation event, find active Instantly campaigns for candidate → call `removeLeadFromSequence` per campaign → write `outreach.sequence.cancelled_consent` audit
- [ ] 5.4 Latency test: measure webhook receipt → sequence cancelled end-to-end < 5s using mock Instantly API with timestamp recording
- [ ] 5.5 Idempotency: 404 from `removeLeadFromSequence` = success; other errors retry 3× then dead-letter

### Task 6: Rate Limiting + Warm-Up (AC: 5)

- [ ] 6.1 Create migration for `provider_rate_counters` rows or reuse existing table (architecture §15 — Clay/RapidAPI already use it). Confirm schema has `(provider_id, tenant_id, window, window_start, request_count, limit_per_window)`.
- [ ] 6.2 Implement `src/modules/providers/instantly/rate-limiter.ts` — atomic increment + compare; daily window midnight UTC, per-minute window current minute
- [ ] 6.3 Policy-driven daily cap: read `policy_registry` key `outreach.email.instantly_daily_cap` per tenant; env fallback `INSTANTLY_DAILY_SEND_CAP` (default 500); log warning if policy missing
- [ ] 6.4 Campaign splitting: if `recipients.length + current_daily_count > cap`, split: first (cap - current) go today, remainder re-enqueued with `scheduled_at = next_midnight_utc`
- [ ] 6.5 On 429: honor `Retry-After` + framework retry; log `rate_limit_hit` health event
- [ ] 6.6 Unit tests: split logic, cap boundary, multi-tenant isolation, policy override

### Task 7: Kill Switch + Graph Fallback (AC: 6)

- [ ] 7.1 Add `provider_used` column to `outreach_audit_log` via migration (nullable text); backfill existing rows = `'graph'` (current email path is Graph)
- [ ] 7.2 In `EmailCampaignDispatcher`, read `providerRegistry.getMode('instantly')` before dispatch
- [ ] 7.3 If mode = `degraded` or `kill_switched` AND kind = `bulk_campaign` → mark outbox `status='queued_degraded'`; UI surfaces paused-due-to-incident (Story 3.7 owns UI; this story provides the state)
- [ ] 7.4 If mode != `normal` AND kind = `adhoc_email` OR `priority='critical'` → route to `GraphProviderClient.sendMail` (Story 1.12b exposed this); record `outreach_audit_log.provider_used='graph'`
- [ ] 7.5 Failback is manual-only — no auto-unpausing from `degraded` back to `normal`
- [ ] 7.6 Admin alert via Graph sendMail to `CBL_PROVIDER_ALERT_EMAIL` on mode transitions (reuse 1.12b admin-alert sink)
- [ ] 7.7 Unit + integration tests: mode=`degraded` with bulk → queued_degraded; mode=`kill_switched` with adhoc → routed to Graph; failback manual

### Task 8: Validation (AC: 9)

- [ ] 8.1 `npm run test`: all prior tests pass; new tests net +50 tests minimum
- [ ] 8.2 `npm run typecheck`: clean
- [ ] 8.3 `npm run lint`: zero new warnings on new files
- [ ] 8.4 `npm run residency:preflight`: passes
- [ ] 8.5 End-to-end smoke on Render preview env: create campaign via internal API → launch → verify Instantly dashboard shows campaign launched → trigger test webhook → verify `outreach_audit_log` + `webhook_events` rows
- [ ] 8.6 Kill-switch drill: manually `UPDATE provider_routing_policies SET mode='kill_switched' WHERE primary_provider='instantly'` → verify bulk queued_degraded + ad-hoc routed to Graph → flip back to `normal` → resume
- [ ] 8.7 Consent-sync latency drill: text STOP to Telnyx sandbox → verify Instantly sequence cancelled in <5s (measured)
- [ ] 8.8 Cost + audit dashboards show `provider='instantly'` rows (Story 1-9a + 2.4b dashboards)

## Dev Notes

### Provider Framework — Non-Negotiable Rules (from dev standards §1)

- **Do NOT use `fetchWithRetry`.** `fetchWithRetry` is deprecated for new code. All outbound HTTP MUST go through `BaseProviderClient` + `AuthStrategy`.
- **No module-level token singletons.** Instance-scoped cache on `ApiKeyHeaderAuth` (or `BearerTokenAuth`) handles concurrent-refresh coalescing.
- **Register + wire in `ensureProvidersInitialized()`.** Call from every route entry point that uses the provider. Idempotent; safe on cold path.
- **Error classification matters.** `auth_failure` is excluded from kill-switch math; `transient` + `rate_limited` count. See `src/modules/providers/base-client.ts` for the classifier.
- **Structured `ProviderLogEntry` JSON lines** emit to stdout with `kind: "provider_log"`. Log aggregators (Render) pick these up. Don't replace; augment legacy `[Instantly]` prefixes.
- **Inbound webhooks:** Reference implementation is `src/modules/providers/clay/`. Thin route → `BaseWebhookReceiver` → `WebhookHandler` → `WebhookProcessor`.

### Architecture Compliance — Story-Specific Cross-References

- **§6 — Consent sync latency (<5s):** Must pass the latency test. Anti-pattern explicitly prohibited: checking consent only at enqueue. Double-check at enqueue AND dequeue.
- **§7 — Thin webhook receiver:** Receiver MUST return 200 OK in <100ms. Business logic runs in the `WebhookProcessor` drain, not inline. Unique constraint on `(source, provider_event_id)` dedups.
- **§10 — 24-hour channel-agnostic outreach lock:** Every dispatch writes `candidate_outreach_lock`. Cooldown skip emits `outreach.skipped.cooldown`. Manual recruiter override allowed with visible banner + audit.
- **§11 — Provider idempotency:** `provider_idempotency_key = sha256(tenant_id|candidate_id|job_requirement_id|message_template_version|send_window_date)`. Store in `outreach_jobs`. Retry pre-checks `send_status`.
- **§15 — Rate limit pattern:** Reuse `provider_rate_counters` — same atomic-DB-counter pattern as Clay/RapidAPI/FAA. No Redis.
- **§19 — Kill switch + fallback:** Manual failback only. `provider_routing_policies` is authoritative. Auto-kill at 30% error / ≥10 attempts (framework default from 1.12 review).
- **§22 — Queue fallback mode:** Bulk campaigns during Instantly outage go to `queued_degraded`, not immediate fail. UI messaging is Story 3.7's concern; this story provides the state.
- **§24 — Policy registry / zero-inference:** Daily send cap is a `policy_registry` entry, not a hardcoded constant. Env var is a fallback, not the source of truth.

### File Structure

```
src/modules/providers/instantly/
  index.ts                         # barrel exports
  instantly-client.ts              # InstantlyProviderClient (BaseProviderClient wrapper)
  instantly-webhook-receiver.ts    # BaseWebhookReceiver instance
  instantly-webhook-handler.ts     # WebhookHandler implementation
  consent-listener.ts              # InstantlyConsentRevocationListener
  rate-limiter.ts                  # daily + per-minute counters
  types.ts                         # CampaignInput, LeadInput, CampaignStatus

src/app/api/webhooks/instantly/
  route.ts                         # POST handler — thin

src/features/outreach/application/
  email-campaign-dispatcher.ts     # orchestrates campaign.launch outbox events

src/modules/__tests__/
  providers-instantly-client.test.ts
  providers-instantly-webhook.test.ts
  providers-instantly-audit.test.ts    # AC 8 integration gate
  providers-instantly-consent-sync.test.ts
  providers-instantly-rate-limiter.test.ts
  providers-instantly-kill-switch.test.ts

src/app/api/webhooks/instantly/__tests__/
  route.test.ts

supabase/migrations/
  2026-04-XX-story-3-2a-instantly-routing-seed.sql       # provider_routing_policies row
  2026-04-XX-story-3-2a-outreach-audit-provider-col.sql  # add provider_used column
  2026-04-XX-story-3-2a-outreach-jobs-table.sql          # if not already present from Story 3.1

_bmad-output/source-inputs/
  instantly-api-discovery.md       # Task 0 artifact (PREREQUISITE)
```

### Database Changes Summary

1. **`outreach_audit_log.provider_used text`** — new nullable column; backfill `'graph'` for existing rows (current email path); future rows populate per actual dispatch provider
2. **`outreach_jobs`** — table per architecture §11; create if not already present. Columns: `job_id UUID PK`, `outbox_event_id UUID FK`, `tenant_id text`, `candidate_id UUID`, `provider_idempotency_key text UNIQUE`, `provider_request_id text`, `provider_used text`, `send_status text` (`pending|sent|failed|skipped`), `attempt_count int`, `created_at`, `updated_at`. Index on `provider_idempotency_key`.
3. **`candidate_outreach_lock`** — per architecture §10; create if not already present (Story 3.1 may own this). Columns: `candidate_id UUID`, `tenant_id text`, `last_outreach_at timestamptz`, `last_channel text`, `last_actor_type text`, `lock_expires_at timestamptz`. PK `(candidate_id, tenant_id)`.
4. **`provider_routing_policies`** — seed row for `email_campaign` channel (framework table from 1.12)
5. **`provider_rate_counters`** — verify schema from architecture §15; Story 3.1 or this story may own initial creation

**DO NOT** create parallel tables if one of these exists. Check the current [supabase/schema.sql](supabase/schema.sql) bootstrap FIRST; only write migrations for missing objects. `candidate_channel_preferences` and `outreach_audit_log` already exist (lines 211–228 and 478–498 respectively).

### Environment Variables

Add to [CLAUDE.md](CLAUDE.md) env var section + [render.yaml](render.yaml):

```
INSTANTLY_API_KEY                # Instantly API key (required to register provider)
INSTANTLY_API_BASE_URL           # https://api.instantly.ai or region-specific (confirmed by spike)
INSTANTLY_WEBHOOK_SECRET         # Shared secret for webhook signature validation
INSTANTLY_DAILY_SEND_CAP         # Fallback cap when policy_registry entry absent (default 500)
CBL_PROVIDER_ALERT_EMAIL         # Already exists from 1.12b; confirm not overloaded
```

### Testing Standards

- **Vitest** (per project standard). Test files colocated under `__tests__/` adjacent to source.
- **No real Instantly API in CI.** Use `vi.fn()` + mocked `fetch`. Record-and-replay fixtures from the discovery spike go in `src/modules/__tests__/fixtures/instantly/*.json`.
- **Real Supabase calls only via `getSupabaseAdminClient()` behind mocks in unit tests.** Integration tests may use a local/preview Supabase.
- **Minimum test counts:**
  - Client: 15 (see Task 1.6)
  - Webhook: 20 (each event type × error classes)
  - Dispatcher: 12 (consent gates, idempotency, cooldown, split)
  - Consent sync: 4 (happy path, 404 idempotent, retry, dead-letter)
  - Rate limiter: 8 (daily cap, per-minute, split, multi-tenant)
  - Kill switch: 6 (mode transitions, bulk vs adhoc routing, failback manual)
  - Audit integration: 1 comprehensive end-to-end (AC 8 gate)
  - **Target net new: ≥50 tests; total suite after = ≥660 (609 from 1.12b + 50 new)**
- **Reject on review:** Skipping the consent double-check. Hardcoded daily cap. Missing `[Instantly]` prefix on legacy logs. Storing email body in audit log (must be `content_hash`). Logging API key or webhook secret.

### Previous Story Intelligence (1.12a, 1.12b, 1.12c)

**From 1.12a (Clay + Ceipal) — first framework consumer:**
- Route files must call `ensureProvidersInitialized()` at the top of the POST handler. Missed initially in 1.12a PR B and caught in code review. **Do not repeat this miss.**
- Auth failures must invalidate the auth cache so the next attempt forces re-auth. `CeipalAuthStrategy.clearCacheForTest()` was added for this; apply the same pattern if Instantly's auth is OAuth-like.
- `expires_in ≤ 0` must force-refresh (don't silently cache with a default TTL).
- `onLog` default sink must be wired at startup (otherwise structured logs never reach stdout in production).

**From 1.12b (Graph + Anthropic):**
- Admin alert sink via Graph sendMail + critical log works well for operator notifications — reuse for Instantly mode transitions.
- `initializeLLMProviderFromStartup` preserves test mocks — design `getInstantlyProvider()` factory the same way so unit tests can inject a mock.
- `callLlm()` public API remained unchanged across migration. Apply the same stability contract: Story 3.2's `EmailProvider` interface (if one exists) stays stable; this story only swaps the implementation.

**From 1.12c (Supabase migration, in-progress):**
- Health provider + circuit breaker patterns — watch for any guidance that lands in 1.12c before this story implements its own circuit behavior (framework-level already handles most cases).

**From 1.12 framework review (110 tests, 2 rounds of adversarial):**
- `evaluateKillSwitch` fires on BOTH success and failure (decision 1C accepted). Be aware: a recovering provider can trip at totalAttempts=50 with 80% stale error rate on a success call. Design alerts accordingly.
- Rate limiter is per-process; cold restarts lose state. Document this in the rate-limiter code comment. Architecturally acceptable per §15 (atomic DB counter is source of truth).
- Retry whitelist is `[408, 429, 500-504]`. Don't narrow.

### Anti-Patterns Explicitly Prohibited

1. **Checking consent only at enqueue** — must double-check at dequeue (architecture §6 anti-pattern)
2. **Hardcoding daily send cap** — must be `policy_registry` entry (architecture §24 zero-inference rule)
3. **Using `fetchWithRetry` for new code** — framework is mandatory (development-standards §1)
4. **Storing full email body in `outreach_audit_log`** — must be `content_hash` only (PII + retention)
5. **Routing bulk campaigns to Graph during kill-switch** — Graph cannot scale; bulk must `queued_degraded` and wait
6. **Auto-failback from `degraded` → `normal`** — failback is MANUAL per architecture §19
7. **Creating a new `candidate_channel_preferences` column for email opt-out** — already exists as `email_opted_in` + `email_opt_out_at` + `email_opt_out_reason`. Reuse.
8. **Creating a new `outreach_audit_log` table for email** — the existing table covers both channels via `channel='email' | 'sms'` discriminator
9. **Inline business logic in the webhook route** — thin route ONLY; handler runs in `WebhookProcessor` drain
10. **Logging API key, webhook secret, or full email body** — redact

### References

- [Source: architecture.md §6] — Consent synchronization (<5s cross-channel latency)
- [Source: architecture.md §7] — Thin webhook receiver pattern
- [Source: architecture.md §10] — 24-hour channel-agnostic outreach lock
- [Source: architecture.md §11] — Provider-level idempotency (sequence dedup by email)
- [Source: architecture.md §15] — External rate limiting via `provider_rate_counters` (leaky bucket)
- [Source: architecture.md §19] — Provider failover + kill switch + manual failback
- [Source: architecture.md §22] — Queue fallback mode state machine
- [Source: architecture.md §24] — Policy registry / zero-inference guardrail
- [Source: architecture.full.md §"Sequence: Instantly Campaign Email Flow" lines 802–828] — Campaign flow sequence diagram (worker → Instantly → candidate → webhook back)
- [Source: architecture.md §Integration Matrix line 254] — Instantly = primary campaign email; Graph = degraded fallback
- [Source: stories/1-12-edge-system-provider-framework.md] — Framework contract + interface change notes
- [Source: stories/1-12a-migrate-clay-ceipal-to-provider-framework.md] — First-consumer migration pattern + webhook receiver reference implementation
- [Source: stories/1-12b-migrate-graph-anthropic-to-provider-framework.md] — Graph fallback path already wired
- [Source: development-standards.md §1] — Provider framework mandate + `fetchWithRetry` deprecation
- [Source: supabase/schema.sql:211-228] — `candidate_channel_preferences` existing schema
- [Source: supabase/schema.sql:478-498] — `outreach_audit_log` existing schema
- [Source: supabase/schema.sql:745-763] — `webhook_events` existing schema
- [Source: prd.md §"Outreach & Engagement"] — SMS/email templates, per-channel TCPA opt-out, bulk campaigns 50–5,000

### Project Structure Notes

- Module location (`src/modules/providers/instantly/`) matches 1.12a Clay pattern — provider consumer modules live adjacent to the framework under `src/modules/providers/<vendor>/`.
- Route location (`src/app/api/webhooks/instantly/`) matches Clay webhook route pattern.
- Feature location (`src/features/outreach/application/`) — if `src/features/outreach/` doesn't exist, create it with standard `contracts/`, `application/`, `domain/`, `infrastructure/`, `ui/` layers per architecture naming rules. Story 3.1 (SMS) likely creates this directory first; reuse it.
- No CBLAero-wide naming conflicts: no existing `InstantlyProviderClient`, no existing `/api/webhooks/instantly`.
- **Detected variance:** Story 3.1 (SMS) may create `candidate_outreach_lock` and `outreach_jobs` tables first. Check before migrating; if present, only read/write — do not redefine.

## Dev Agent Record

### Agent Model Used

TBD

### Debug Log References

### Completion Notes List

### File List
