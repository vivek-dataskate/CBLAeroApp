# Story 3.2a: Instantly Email Campaign Provider Integration

Status: backlog

## Story

As a platform engineer,
I want to integrate Instantly as the email campaign provider with authentication, sequence management, delivery/engagement webhooks, and rate limiting,
so that email outreach templates (Story 3.2) actually deliver to candidates and open/click/reply events flow back into the system.

## Context

Story 3.2 builds email template CRUD and role-based permissions with a stub email provider (mirroring Story 3.1's approach for SMS). This story wires up Instantly as the live email campaign provider. Per architecture.md, Instantly is the primary campaign email provider; Microsoft Graph/Outlook is the fallback for ad hoc recruiter emails and critical transactional messages when Instantly is kill-switched.

**Architecture references:**
- [architecture.md §External Systems] — Instantly for campaign email
- [architecture.md §Instantly Campaign Email Flow] — sequence diagram: load batch → create campaign → upload recipients → launch → delivery webhooks
- [architecture.md §7] — Webhook burst handling: thin receiver → raw event row → async processing
- [architecture.md §6] — Consent sync: opt-out from ANY channel kills pending email sequences
- [architecture.md §11] — Idempotency: sequence membership deduplicated by recipient email per sequence ID
- [architecture.md §10] — Outreach cooldown: 24-hour channel-agnostic lock before automated sends

## Acceptance Criteria

### AC 1: Instantly Account Authentication

**Given** the env vars `INSTANTLY_API_KEY` and `INSTANTLY_WORKSPACE_ID` are set
**When** the application starts
**Then** `getEmailCampaignProvider()` returns an `InstantlyEmailProvider` instead of a stub
**And** if either env var is missing, the stub provider continues to be used (graceful degradation)
**And** the API key is validated on first campaign creation — a 401 from Instantly triggers an admin alert

### AC 2: Campaign Creation and Recipient Upload

**Given** a recruiter sends email outreach to a batch of candidates
**When** the email send pipeline processes the batch
**Then** it creates an Instantly campaign via `POST /api/v1/campaign/create` with:
- Campaign name: `{tenant}_{agenda}_{timestamp}` (auditable, unique)
- Email account: configured sender account from `INSTANTLY_SENDER_EMAIL`
- Schedule: respect candidate contact windows
**And** uploads recipients to the campaign sequence via `POST /api/v1/campaign/{id}/sequence/add`
**And** each recipient carries the rendered email body (from Story 3.2 template rendering)
**And** sequence membership is deduplicated by recipient email per sequence ID (per architecture.md §11)

### AC 3: Campaign Launch and Tracking

**Given** recipients are uploaded to an Instantly campaign
**When** the campaign is launched
**Then** Instantly begins delivering the email sequence
**And** the campaign ID is stored in `email_sends.campaign_id` for tracking
**And** campaign status (active/paused/completed) is queryable via the sends API

### AC 4: Delivery and Engagement Webhooks

**Given** Instantly fires webhooks for email events
**When** the event type is `email.sent`, `email.opened`, `email.clicked`, `email.replied`, `email.bounced`, or `email.unsubscribed`
**Then** the webhook handler at `POST /api/webhooks/instantly` validates the request
**And** writes a raw event row to `webhook_events` table (thin receiver, target < 100ms)
**And** returns 200 OK immediately
**And** a background processor drains events and updates the corresponding `email_sends` row:
- `sent` → status = 'delivered'
- `opened` → sets `opened_at`, increments `open_count`
- `clicked` → sets `clicked_at`, increments `click_count`
- `replied` → sets `response_received_at`, `response_body`, classifies `response_type`
- `bounced` → status = 'bounced', halts sequence for this candidate
- `unsubscribed` → triggers `recordOptOut(candidateId, 'email', reason)` synchronously
**And** all events are logged to `outreach_audit_log`

### AC 5: Cross-Channel Consent Sync (SMS Opt-Out Kills Email)

**Given** a candidate opts out of SMS via STOP reply (Story 3.1b Telnyx webhook)
**When** the consent revocation is processed
**Then** any active Instantly campaign sequences with this candidate are cancelled
**And** the system calls `Instantly API: remove from sequence` for all pending email outreach
**And** target latency from SMS opt-out to email sequence cancellation: < 5 seconds (per architecture.md §6)
**And** the cancellation is logged to `outreach_audit_log`

### AC 6: Rate Limiting and Sending Reputation

**Given** Instantly has per-account daily sending limits and warm-up requirements
**When** email sends are dispatched
**Then** the system respects the configured daily limit (`INSTANTLY_DAILY_LIMIT`, default 50 for warm-up)
**And** if the daily limit is approached (>80%), new campaigns are deferred to next day
**And** Instantly's built-in warm-up schedule is used — do NOT override with manual volume ramps

### AC 7: Retry and Bounce Handling

**Given** an email send fails (API error or bounce)
**When** the retry policy evaluates
**Then** transient API errors retry up to 3 times with escalating delay (60s, 300s, 900s)
**And** hard bounces (invalid address) permanently mark the candidate email as `bounced` — no further email outreach
**And** soft bounces (mailbox full, temporary) retry up to 2 times over 48 hours
**And** bounced email addresses are flagged in `candidates` for recruiter visibility

### AC 8: Degraded Mode — Graph Fallback

**Given** Instantly is kill-switched or unhealthy
**When** a critical or recruiter-triggered email needs to send
**Then** the system falls back to Microsoft Graph/Outlook for:
- Recruiter-triggered ad hoc emails (one-click actions from dashboard)
- Critical transactional emails (interview confirmations, offer notifications)
**And** bulk campaign sends are paused (not routed to Graph — Graph is not for mass email)
**And** recruiter is notified: "Campaign email is temporarily paused. Individual emails still work."

## Tasks / Subtasks

- [ ] Task 1: Payload discovery spike
  - [ ] 1.1 Create Instantly account, configure workspace, add sender email
  - [ ] 1.2 Create a test campaign via API, capture request/response payloads
  - [ ] 1.3 Upload test recipients, launch campaign, capture delivery webhook payloads
  - [ ] 1.4 Capture open/click/reply/bounce/unsubscribe webhook event shapes
  - [ ] 1.5 Freeze all payloads as test fixtures in `src/modules/__tests__/fixtures/instantly/`
  - [ ] 1.6 Document Instantly API field mappings → our schema

- [ ] Task 2: InstantlyEmailProvider implementation
  - [ ] 2.1 Create `src/modules/outreach/instantly-provider.ts` implementing `EmailCampaignProvider` interface
  - [ ] 2.2 Campaign CRUD: create, add recipients, launch, pause, cancel
  - [ ] 2.3 HTTP client with auth, timeout (15s), error classification
  - [ ] 2.4 Sequence membership dedup check before adding recipients
  - [ ] 2.5 Daily send limit tracking and threshold alerting
  - [ ] 2.6 Create `getEmailCampaignProvider()` factory — Instantly when env vars set, stub otherwise

- [ ] Task 3: Email sends table (if not already created by Story 3.2)
  - [ ] 3.1 Create `email_sends` table mirroring `sms_sends` structure: id, tenant_id, candidate_id, template_id, template_version, rendered_body, campaign_id, provider, provider_message_id, status, opened_at, open_count, clicked_at, click_count, response_received_at, response_body, response_type, bounced_at, bounce_type, tracking_token, tracking_url, sender_user_id, scheduled_for, sent_at, created_at
  - [ ] 3.2 Add RLS policies (tenant isolation, service_role full, no anon writes)

- [ ] Task 4: Webhook infrastructure
  - [ ] 4.1 Create `POST /api/webhooks/instantly` — thin receiver (validate → raw write → 200 OK)
  - [ ] 4.2 Share `webhook_events` table with Telnyx (Story 3.1b) — add `source` column if not exists
  - [ ] 4.3 Instantly event processor: drain webhook_events WHERE source='instantly', update email_sends
  - [ ] 4.4 Engagement tracking: opened_at, clicked_at, reply handling
  - [ ] 4.5 Bounce handling: hard bounce → mark address permanently, soft bounce → retry
  - [ ] 4.6 Unsubscribe → `recordOptOut(candidateId, 'email', reason)` synchronously

- [ ] Task 5: Cross-channel consent sync
  - [ ] 5.1 When SMS opt-out triggers (from Story 3.1b), check for active Instantly sequences
  - [ ] 5.2 Call Instantly API to remove candidate from active sequences
  - [ ] 5.3 Cancel pending `email_sends` rows for the opted-out candidate

- [ ] Task 6: Degraded mode
  - [ ] 6.1 Health check for Instantly API (ping/auth validation)
  - [ ] 6.2 Kill-switch flag: `INSTANTLY_KILL_SWITCH=true` → pause campaigns, route ad hoc to Graph
  - [ ] 6.3 Recruiter notification when degraded mode is active

- [ ] Task 7: Tests
  - [ ] 7.1 Unit tests: InstantlyEmailProvider (mock HTTP, fixture-based), campaign CRUD, dedup
  - [ ] 7.2 Webhook tests: event processing, engagement tracking, bounce handling, unsubscribe
  - [ ] 7.3 Cross-channel consent: SMS opt-out → email sequence cancellation
  - [ ] 7.4 Integration test: full campaign → webhook → status update flow (mocked Instantly)

## Dev Notes

### Env Vars (New)

| Var | Required | Description |
|-----|----------|-------------|
| `INSTANTLY_API_KEY` | Yes (for live email) | Instantly API key |
| `INSTANTLY_WORKSPACE_ID` | Yes | Workspace identifier |
| `INSTANTLY_SENDER_EMAIL` | Yes | Configured sender email account in Instantly |
| `INSTANTLY_WEBHOOK_SECRET` | Yes | Webhook signing secret (if Instantly supports it) |
| `INSTANTLY_DAILY_LIMIT` | No (default: 50) | Daily send limit per account (warm-up phase) |
| `INSTANTLY_KILL_SWITCH` | No (default: false) | Emergency kill-switch for Instantly sends |

### Instantly API Key Endpoints

| Operation | Endpoint | Method |
|-----------|----------|--------|
| Create campaign | `/api/v1/campaign/create` | POST |
| Add to sequence | `/api/v1/campaign/{id}/sequence/add` | POST |
| Launch campaign | `/api/v1/campaign/{id}/launch` | POST |
| Pause campaign | `/api/v1/campaign/{id}/pause` | POST |
| Remove from sequence | `/api/v1/campaign/{id}/sequence/remove` | POST |
| Campaign status | `/api/v1/campaign/{id}` | GET |

**Note:** Capture REAL payloads via the discovery spike before implementing. Instantly docs may not match reality (Epic 2 retro lesson).

### Architecture Patterns

- **Thin webhook receiver** (architecture.md §7): same pattern as Telnyx. Share `webhook_events` table with `source='instantly'`.
- **Consent sync** (architecture.md §6): opt-out in ANY channel must kill pending email sequences within 5 seconds.
- **Idempotency** (architecture.md §11): Instantly deduplicates by recipient email per sequence ID — check before adding.
- **Outreach cooldown** (architecture.md §10): 24-hour cross-channel lock. If SMS was sent 2 hours ago, email is blocked for 22 more hours.
- **Degraded mode**: Graph handles ad hoc and critical emails. Campaigns pause entirely.

### Dependencies

- Story 3.2 (email template CRUD, email provider interface) must be complete
- Story 3.1b (webhook_events table, webhook burst handling pattern) — shared infrastructure
- Shares `candidate_channel_preferences` table with SMS (Story 3.1)
- Shares `outreach_audit_log` table with SMS (Story 3.1)

### References

- [Source: architecture.md §External Systems] — Instantly for campaign email
- [Source: architecture.md §Instantly Campaign Email Flow] — sequence diagram
- [Source: architecture.md §7] — Webhook burst handling
- [Source: architecture.md §6] — Consent synchronization (cross-channel)
- [Source: architecture.md §10] — Outreach cooldown lock
- [Source: architecture.md §11] — Provider-level idempotency

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
