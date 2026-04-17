# Story 3.1: Build SMS Outreach Template and Scheduling Workflow

Status: ready-for-dev

> **Regenerated 2026-04-17** after Epic 1 was reopened for the Edge System Provider Framework (Stories 1-12 / 1-12a / 1-12b / 1-12c). The earlier in-session implementation was discarded so this story can be built cleanly on the framework. Scope unchanged from the original — dependencies updated to require provider framework integration (stub SMS provider extends `BaseProviderClient`, click-tracking endpoint uses `BaseWebhookReceiver`, provider registered in `ProviderRegistry`).

## Story

As a recruiter,
I want to compose SMS outreach from approved templates and have the system schedule sends inside each candidate's contact window,
so that outreach is fast, personalized, and reaches candidates when they are willing to read — not at 3 a.m. — while every outbound message carries campaign + template-version metadata for funnel attribution and audit.

## Funnel Lever & Measurement

**REQUIRED** — per PRD Success Criteria → "Beat LinkedIn RPS Recruiter Funnel." LinkedIn RPS baseline: 100 InMails → 28 responses → 14 submissions → 0.5 closures per $200.

- **Funnel lever(s) moved:** Outreach-sent volume (primary), Response rate (secondary), Recruiter time reduction (secondary). This story is the first compliant outbound channel — every other Epic-3 response/delivery/bulk story depends on it emitting `outreach.message.sent` events.
- **Expected lift:**
  - +50x Outreach-sent volume per recruiter per day vs. manual SMS (from ~10/day manual → 500+/day templated), enabling the 100-InMail equivalent recruiter load.
  - +12 percentage points on response rate vs. LinkedIn baseline (target ≥40% once Stories 3-3 and 3-4 stack on top). This story's direct lift is persuasive-template quality + in-window delivery — quantified once 3-4 lands.
  - −20 min/day recruiter time on send composition (templated send flow replaces hand-typed messages).
- **How lift is measured:**
  - Primary: `outreach.message.sent` funnel event emitted on every successful `sms_sends.status='sent'` transition, with `{tenant_id, campaign_id, template_id, template_version, candidate_id, actor_id, channel:'sms', sent_at, contact_window_respected}` fields (per Architecture §Communication Patterns event envelope). Counted daily on Epic 10 `/dashboard/recruiter/funnel` (Outreach-Sent column).
  - Secondary: `outreach.message.sent` → downstream `outreach.response.received` join (Story 3-4) yields response-rate per template + per campaign.
  - Deferred: click-tracked response-rate proxy via `sms_sends.clicked_at` increments (this story only wires the click endpoint; campaign-level aggregation in Epic 10).
- **Baseline comparison:** LinkedIn RPS 28% response rate baseline — full attribution deferred to Story 3-4 (response capture) + Epic 10. This story's acceptance gate is emission fidelity, not lift measurement.

## Acceptance Criteria

### AC 1: Admin-only SMS template CRUD — 13 agenda categories

**Given** an authenticated user with role `admin`
**When** they navigate to `/dashboard/admin/sms-templates`
**Then** they see a CollapsibleCard grid of 13 agenda categories: `new_opportunity`, `availability_check`, `job_followup`, `submission_followup`, `interview_schedule`, `interview_reminder`, `interview_followup`, `bgv_initiation`, `bgv_followup`, `offer_extended`, `onboarding`, `reengagement`, `general` (enum matches `sms_templates.agenda` CHECK constraint in [schema.sql:706](../../supabase/schema.sql#L706))
**And** they can Create / Edit / Archive templates with fields `name`, `template_key`, `agenda`, `body` (≤1600 chars — enforced by `sms_templates_body_length` constraint), `variables[]` (JSONB — declared placeholders like `{{first_name}}`, `{{job_title}}`, `{{tracking_link}}`)
**And** Edit creates a NEW `sms_templates` row with `version = max(version)+1`, same `tenant_id` + `template_key`, status `active`; the prior version is set to `archived`. Templates are **append-only** (template_id + version stable in audit trail). Uniqueness enforced by `idx_sms_templates_tenant_key_version`.
**And** role `recruiter` sees a READ-ONLY template picker, never the CRUD surface (RBAC via `withAuth({ roles: ['admin'] })` on write routes).
**And** Archive flips `status = 'archived'`; archived templates are hidden from the recruiter send picker but remain queryable for audit-log rendering and historical `sms_sends.template_id` joins.

### AC 2: Seed 12 persuasive templates on first deploy

**Given** the migration runs in a fresh tenant
**When** `seed_sms_templates(p_tenant_id text, p_actor_id text)` RPC is called (idempotent via `ON CONFLICT (tenant_id, template_key) DO NOTHING`)
**Then** 12 seed templates land — at least one for each of the most-used agendas (`new_opportunity` ×2, `availability_check`, `job_followup`, `submission_followup`, `interview_schedule`, `interview_reminder`, `bgv_initiation`, `offer_extended`, `onboarding`, `reengagement`, `general`). Body copy is **persuasive, compliance-safe**, includes `{{first_name}}` + `{{tracking_link}}`, ≤ 480 chars (3 SMS segments), identifies the sender as "CBL Aero — Mike" or equivalent, and carries a TCPA-safe opt-out line ("Reply STOP to opt out").
**And** seed runs idempotently on every deploy — re-running never overwrites edited templates (preserve-if-set merge via `ON CONFLICT DO NOTHING`).
**And** the seed RPC is invoked once during Epic 3 kickoff via the existing one-off admin task pattern (not auto-run on route startup — templates are tenant-scoped content).

### AC 3: Recruiter single-send from candidate detail

**Given** an authenticated recruiter on `/dashboard/recruiter/candidates/[id]` with a valid `activeClientId`
**When** they click "Send SMS" on a candidate with non-null `phone`
**Then** a modal opens listing all `sms_templates.status='active'` for the tenant, grouped by agenda
**And** selecting a template renders a live preview with `{{first_name}}`, `{{job_title}}`, `{{tracking_link}}` substituted from candidate row + active-job-requirement + generated tracking token
**And** clicking "Schedule Send" POSTs to `/api/outreach/sms/send` with `{candidate_id, template_id, template_version, context_params, source:'single_send'}`
**And** the handler: (1) validates `withAuth({ requireActiveClient: true })` and `activeClientId`; (2) checks `candidate_channel_preferences.sms_opted_in=true` (false → 409 `OPT_OUT_BLOCK` + banner); (3) computes `scheduled_for` from the candidate's `contact_windows` JSONB (next-slot resolver); (4) inserts one `sms_sends` row with `status='pending'`, generates a `tracking_token` (UUID, URL-safe), fills `tracking_url = ${CBL_APP_URL}/api/outreach/track/${token}`; (5) writes `outreach_audit_log` row synchronously; (6) returns `{send_id, scheduled_for, tracking_url}`
**And** the modal closes and a toast shows "Scheduled for {friendly time}" — no blocking until send; the scheduler dispatches in the background (AC 6)
**And** error envelope `{ error: { code, message } }` per dev-standards §16 on every failure path (no sibling fields on `error`).

### AC 4: Recruiter bulk "Send SMS" action on list view

**Given** an authenticated recruiter on `/dashboard/recruiter/candidates` with N candidate rows selected via checkbox
**When** they click "Send SMS" above the list
**Then** a modal prompts for template, renders preview (shows substitution against the first selected candidate as illustrative example), and asks "Send to N candidates?"
**And** confirmation POSTs to `/api/outreach/sms/bulk-send` with `{candidate_ids:[…], template_id, template_version, context_params_per_candidate:{…} | shared:{…}, source:'bulk_send'}`
**And** handler enforces `candidate_ids.length <= 200` for this story's MVP (bounded bulk — Story 3-7 removes this bound and adds campaign staging)
**And** per candidate: opt-out check, contact-window resolution, `sms_sends` insert, audit-log row — wrapped in a single `insert_sms_sends_bulk` RPC so it is one round-trip per batch, not N (per dev-standards §4.3)
**And** blocked candidates return in the response as `{blocked:[{candidate_id, reason}]}` alongside `{scheduled:[{candidate_id, send_id, scheduled_for}]}` — partial success is a 200, not a 207 (we don't use 207s elsewhere)
**And** all `sms_sends` rows in a bulk call share the same `campaign_id` (auto-generated UUID for this operation) so Epic 10 can count by campaign.

### AC 5: "Send SMS to All Matching" filter-based blast

**Given** an authenticated recruiter on `/dashboard/recruiter/candidates` with filters / search criteria applied (no row-level selection)
**When** they click "Send to All Matching"
**Then** a modal shows the result count (already computed by `search_candidates` RPC — do not re-run expensive COUNT), prompts for template + preview, and requires typed confirmation of the count ("Type `N` to confirm") — guards against fat-fingered 10k-row blasts
**And** on confirm, POSTs to `/api/outreach/sms/filter-send` with `{filter_criteria, template_id, template_version, context_params}`
**And** handler enforces hard upper bound of 1,000 candidates for this story (re-executing the search server-side — never trust client-sent candidate IDs). Beyond 1,000 → 413 `TOO_MANY_RECIPIENTS` with guidance to narrow filters (Story 3-7 adds proper bulk-campaign staging).
**And** handler writes one `sms_sends` row per matching candidate, same `campaign_id`, same opt-out + contact-window checks as AC 4.
**And** the modal shows a progress indicator while the server expands filters → candidates → inserts (expected <5s at 1,000 rows via the shared `insert_sms_sends_bulk` RPC).

### AC 6: Global scheduler drains due sends (integrates with Story 2-7)

**Given** one or more `sms_sends` rows exist with `status='pending'` and `scheduled_for <= now()`
**When** the global scheduler tick fires (Render cron `CBLAero-Scheduler-Tick` every 10 min — existing)
**Then** `SmsDispatchJob` (new — registered via `registerIngestionJobs()` pattern; see [src/modules/ingestion/jobs.ts:1242](../../src/modules/ingestion/jobs.ts#L1242)) claims a batch of due sends via `claim_due_sms_sends(p_batch_size int default 50)` RPC using `FOR UPDATE SKIP LOCKED` (per architecture §Global Scheduler Design)
**And** for each claimed send: re-validate opt-out (consent sync per architecture §6 — check at enqueue AND dequeue), render body against the frozen `template_version`, invoke the stub SMS provider (AC 8), update `sms_sends` with `provider`, `provider_message_id`, `status='sent'`, `sent_at`, emit `outreach.message.sent` funnel event (AC 9)
**And** job registers with `jobKey:'sms-dispatch'`, `scheduleName:'SMS Outreach Dispatcher'`, `cronExpression:'*/10 * * * *'`, `policyFamily:'outreach_schedules'`, `policyKey:'sms_dispatch'` — cadence is versioned in `policy_registry` (admin can edit via existing scheduler admin UI from Story 2-7a)
**And** each job run creates a `sync_runs` row (`createSyncRun('sms_dispatch')` → `completeSyncRun(runId, {total, succeeded, failed})`) so it surfaces in the admin `SyncRunSummaryCard` alongside every other ingestion job (Story 2-4b pattern)
**And** per-send failures call `recordSyncFailure('sms_dispatch', send_id, err, runId)` — never throw out of the job loop; a single bad row must not stop siblings (Clay retro lesson)
**And** opt-outs discovered at dequeue transition send to `status='blocked_opt_out'`, `blocked_reason='opt_out_at_dequeue'` — still counted in sync-run summary under `skipped`.

### AC 7: Contact-window enforcement

**Given** a candidate has `candidate_channel_preferences.contact_windows` JSONB of shape `{timezone: "America/Chicago", windows: [{day:"mon", start:"08:00", end:"20:00"}, …]}`
**When** a send is scheduled (single / bulk / filter) and the current time is outside the candidate's allowed windows
**Then** `scheduled_for` is set to the next in-window instant (computed server-side in the candidate's timezone using `Intl.DateTimeFormat` or `date-fns-tz` — NO new full date lib) and the row is inserted with `status='pending'` (not `deferred_window`)
**And** when contact_windows is null or empty, default to **Mon–Fri 08:00–20:00 candidate-local-time** — fallback declared in `policy_registry` under `family='outreach_defaults'`, `key='sms_default_contact_window'` (append-only version history — no hardcoded constant).
**And** if the candidate has a window defined but the scheduler's dequeue time has drifted outside it (e.g. job was paused 4h for an incident), the dispatch job transitions the send to `status='deferred_window'`, sets `contact_window_deferred_until = <next in-window ts>`, and leaves the row for the next tick — uses the `idx_sms_sends_deferred_window` partial index already in the schema.
**And** the window resolver is exported as `resolveNextContactWindow(now: Date, windows: CandidateContactWindows | null, tz: string | null): Date` from `src/features/outreach-engagement/application/contact-window.ts` — unit-testable, no I/O. Tests cover: no windows → default, same-day in-window → now, same-day past-end → next-day start, weekend skip, DST transitions, invalid timezone fallback to UTC with structured-log warning.

### AC 8: Stub SMS provider + provider framework wiring

**Given** the provider framework is live (Stories 1.12 + 1.12a/b) and Telnyx is the designated production SMS provider (architecture §Confirmed Integration System Matrix)
**When** this story lands
**Then** a `StubSmsProvider` implements the same `SmsProvider` capability interface that Telnyx will implement in Story 3.1b (deferred), following the pattern of `AnthropicLLMProvider` (Story 1.12b) — **capability interface declared now so Story 3.1b is a swap, not a rewrite.**
**And** interface: `interface SmsProvider { send(req: { to: string; body: string; idempotencyKey: string; costMeta?: Record<string,unknown> }): Promise<{ providerMessageId: string; status: 'sent'|'queued'|'failed'; durationMs: number }> }`
**And** `StubSmsProvider` records the request to a module-level in-memory array (test-accessible via `__getStubSmsLogForTest()`), generates a deterministic `providerMessageId = 'stub_' + sha256(to+body+idempotencyKey).slice(0,12)`, returns `status:'sent'` in <5ms
**And** registered as `providerRegistry.register('sms-stub')` from `ensureProvidersInitialized()` — mode / kill-switch UI shows it alongside Clay/Ceipal/Graph/Anthropic
**And** `provider_idempotency_key = sha256(tenant_id + candidate_id + template_id + template_version + scheduled_for.toISOString().slice(0,10))` per architecture §11 Provider-Level Idempotency — passed to `send()` and stored in `sms_sends.provider_message_id_hash` (new column — see AC 12). Key is stable across retries; duplicate dispatches in the same day return the same provider_message_id.
**And** routing policy seed row: `channel='sms'`, `primary_provider='sms-stub'`, `fallback_provider=NULL`, `mode='normal'` — added to `ensureProvidersInitialized()` alongside the Clay/Ceipal seeds (pattern in [src/modules/providers/startup.ts](../../src/modules/providers/startup.ts)).
**And** Telnyx migration is **explicitly deferred** to Story 3.1b (not 3.5) — the contract above is the migration target, nothing more needs to change in product code to flip.

### AC 9: Outbound message metadata, audit, and funnel event

**Given** a send completes (`status='sent'`)
**When** the dispatch job commits
**Then** the `sms_sends` row carries all campaign + template version metadata needed for funnel attribution: `tenant_id`, `campaign_id` (UUID; NULL for single-send OR auto-generated shared ID for bulk/filter operations), `template_id`, `template_version` (frozen at schedule time — later template edits do not rewrite history), `sender_user_id`, `context_params` (JSONB of substitution values used), `rendered_body_hash = sha256(rendered_body)` (for audit integrity — architecture §NFR18), `tracking_token`, `tracking_url`, `provider`, `provider_message_id`
**And** an append-only `outreach_audit_log` row is written with `channel='sms'`, `send_id`, `candidate_id`, `sender_user_id`, `sender_role`, `template_id`, `template_agenda`, `delivery_status='sent'`, `content_hash=rendered_body_hash`, `compliance_check_passed=true` — per schema.sql:478 and NFR18
**And** the audit row carries `correlation_id` / `trace_id` propagated via `proxy.ts` middleware (architecture §Correlation IDs) — NEW COLUMNS on `outreach_audit_log` if not present; add via migration (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS trace_id text, correlation_id text`) and update schema.sql per dev-standards §4.9 Dual-Update Rule.
**And** the funnel event is emitted as a structured log entry (JSON line) with `event_type='outreach.message.sent'` and the envelope `{event_id, event_type, occurred_at, tenant_id, actor_id, trace_id, span_id, parent_span_id, payload: {campaign_id, template_id, template_version, candidate_id, channel:'sms', contact_window_respected}, schema_version:'1.0.0'}` per architecture §Communication Patterns. Epic 10 consumes this from log drain — this story does NOT build a dashboard; it MUST emit the event exactly so dashboards can.

### AC 10: Click-tracking endpoint

**Given** a tracking URL `${CBL_APP_URL}/api/outreach/track/[token]` is embedded in a sent SMS
**When** the candidate clicks the link
**Then** `GET /api/outreach/track/[token]` looks up `sms_sends` by `tracking_token` (unique-indexed via `sms_sends_tracking_token_key`), updates `clicked_at = now()` (first click only — preserve-if-set pattern), increments `click_count`, emits a `outreach.message.clicked` funnel event (same envelope shape as AC 9), and 302-redirects to the destination (the `{{tracking_link}}` substitution that was rendered at send time, stored in `sms_sends.context_params.destination_url`)
**And** route is **public** (no auth, no tenant context) — tokens are UUID + `tracking_token_key` unique — but rate-limited to 100 req/min per IP at the route level (simple in-memory sliding window; architecture §7 pattern)
**And** invalid / unknown / expired tokens return 302 to `${CBL_APP_URL}/tracking-expired` (never leak `{error: {…}}` to a public click) — the 302 is structured-logged as `outreach.track.miss` for anomaly detection
**And** response time < 200ms p95 (single row lookup + one update + redirect — use the existing `tracking_token` unique index)
**And** NO PII returned in the response headers or body — pure 302 redirect
**And** SSRF defense: `destination_url` is validated against an allowlist of protocols (`https:` only) AND the candidate's tenant's configured domains (stored in `tenants.allowed_redirect_hosts` — add if not present; default to `['cbl.aero', 'cblsolutions.com']`). Reject open-redirect attempts at send time, not click time.

### AC 11: Deferrals for Stories 3-4 / 3-5 — explicit OUT OF SCOPE

**This story does NOT implement:**
- Inbound response capture (SMS reply, STOP, structured seriousness) — Story 3-4. `sms_sends.response_received_at`, `response_body`, `response_type` columns stay nullable; no webhook receiver for inbound SMS lands here.
- Delivery webhooks / retry on failure — Story 3-5. `sms_sends.status='failed'` transitions are stubbed to no-retry; Story 3-5 will wire the retry policy (max 3, escalating delay, then `undeliverable` + admin alert per FR15).
- Telnyx real SMS — Story 3.1b (new follow-up). Stub provider implements the exact capability interface the Telnyx client will consume; the swap is non-breaking.
- Consent / channel preference UI — Story 3-3. This story reads `candidate_channel_preferences.sms_opted_in` (already in schema) but does not build the candidate-facing or recruiter-facing preference management screens.
- Opt-out via SMS STOP keyword — Story 3-3 webhook + Story 3-4 response capture.
- Campaign / bulk scale 1k → 5k — Story 3-7. This story caps at 1,000 matching candidates per filter-send and 200 per bulk action.

Each deferral MUST show as a TODO comment in code referencing the deferred story number.

### AC 12: Schema delta + migration

**Given** the existing `sms_sends` and `sms_templates` tables (schema.sql:652, 691) cover most fields
**When** this story lands
**Then** a single migration `supabase/migrations/YYYY-MM-DD-story-3-1-sms-outreach.sql` adds:
- `sms_sends.provider_idempotency_key text` — indexed `(tenant_id, provider_idempotency_key)` partial `WHERE provider_idempotency_key IS NOT NULL` (for Story 1.12b dedup on retry)
- `sms_sends.rendered_body_hash` — keep (column exists; no change)
- `outreach_audit_log.trace_id text`, `outreach_audit_log.correlation_id text` — for cross-service tracing per architecture §17
- `outreach_audit_log.event_envelope jsonb` — store the emitted funnel-event envelope for replay / forensic (append-only — no UPDATE ever)
- RPC `claim_due_sms_sends(p_batch_size int, p_now timestamptz default now()) RETURNS setof sms_sends` — `SELECT ... FOR UPDATE SKIP LOCKED LIMIT p_batch_size` where `status='pending' AND scheduled_for <= p_now`
- RPC `insert_sms_sends_bulk(p_rows jsonb) RETURNS (inserted int, skipped int)` — atomic batch insert with per-row opt-out check, max 500 rows per call (dev-standards §4.4)
- RPC `seed_sms_templates(p_tenant_id text, p_actor_id text) RETURNS void` — idempotent `INSERT … ON CONFLICT (tenant_id, template_key) DO NOTHING` for the 12 seeds
- RLS policy update on `sms_templates`: `admin` tenant actor → full CRUD; `recruiter` → SELECT only. RLS on `sms_sends`: `recruiter`/`admin` in same tenant → full R/W. Use the same JWT claim pattern as candidate RLS: `tenant_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')`.
**And** `supabase/schema.sql` is updated in the same PR to reflect the final state (Dual-Update Rule — dev-standards §4.9). Migration is append-only; schema.sql is current-state bootstrap.
**And** migration contains **NO DELETE / UPDATE on observability tables** (post-2.8 rule — dev-standards §3, architecture §Observability Table Mutations). Schema changes only.
**And** all new tables/columns have `GRANT INSERT, SELECT` (append-only) or `GRANT SELECT, INSERT, UPDATE` (for `sms_sends` which legitimately updates status) to the `authenticated` role. No broad grants to `anon` (Epic 2 retro: grant over-breadth caught 3 times).

### AC 13: Test coverage — 472-ish target, concrete minima below

**Given** Epic 2 closed with 430 tests and the comparable Story 2-8 delivered 55 targeted tests, the minimum coverage for this story is:

- `src/features/outreach-engagement/application/contact-window.test.ts` — **≥ 20 tests** for `resolveNextContactWindow`: null windows → default, empty windows → default, in-window now, past-end same-day → next-day start, weekend skip with windows on `mon-fri`, DST spring-forward, DST fall-back, invalid timezone → UTC fallback + warn log, malformed windows array → default, boundary at start minute, boundary at end minute, multi-window same day.
- `src/features/outreach-engagement/application/template-render.test.ts` — **≥ 15 tests** for `renderTemplate(body, context)`: all required placeholders substituted, unknown placeholder left as-is + logged, missing candidate first_name → fallback "there", tracking link substitution, HTML/injection-safe passthrough (body is plain text only, raw angle-brackets allowed but never interpreted), 1600-char overflow rejected, emoji / Unicode preserved.
- `src/features/outreach-engagement/infrastructure/sms-sends-repository.test.ts` — **≥ 25 tests**: single insert, bulk insert via RPC, idempotency key generation determinism, opt-out short-circuit, contact-window respected, `sms_sends` status transitions, `outreach_audit_log` dual-write, trace_id propagation.
- `src/app/api/outreach/sms/send/__tests__/route.test.ts` — **≥ 15 tests**: happy path single-send, missing `activeClientId` → 400, opted-out candidate → 409, bad template_id → 404, RBAC recruiter-allowed / admin-allowed / unauthenticated denied, malformed context_params → 400, contact-window deferred.
- `src/app/api/outreach/sms/bulk-send/__tests__/route.test.ts` — **≥ 10 tests**: 50-candidate batch happy path, partial-success response shape, 201-row batch → 413, at least one opted-out in batch → partial result, campaign_id shared across all rows, empty candidate_ids array → 400.
- `src/app/api/outreach/sms/filter-send/__tests__/route.test.ts` — **≥ 8 tests**: filter re-executed server-side, count confirmation mismatch → 400, 1001-result filter → 413, happy path at 100, happy path at 1000.
- `src/app/api/outreach/track/[token]/__tests__/route.test.ts` — **≥ 12 tests**: valid token → 302 + `clicked_at` set, second click → click_count increments but `clicked_at` not overwritten, unknown token → 302 to expired page, rate-limit trip → 429, SSRF disallowed destination → 302 to expired page + anomaly log, non-HTTPS destination rejected.
- `src/modules/ingestion/__tests__/sms-dispatch-job.test.ts` — **≥ 20 tests**: job claim batch size, FOR UPDATE SKIP LOCKED semantics (mocked), opt-out at dequeue → `blocked_opt_out`, contact-window drift → `deferred_window`, provider call success, provider call failure → `failed` (no retry — deferred), sync_run created + completed, per-row failure does not kill loop, idempotency key consistent across job restarts.
- `src/modules/providers/sms-stub/__tests__/stub-sms-provider.test.ts` — **≥ 10 tests**: `send()` return shape, deterministic provider_message_id, in-memory log capture, registry health wiring, `__getStubSmsLogForTest()` + `__clearStubSmsLogForTest()` hooks.
- `src/modules/providers/__tests__/providers-sms-audit-integration.test.ts` — **≥ 5 integration tests** in the same style as Story 1.12a's `providers-audit-integration.test.ts`: one scheduled send → dispatch → `sms_sends.status='sent'` + `outreach_audit_log` row + `outreach.message.sent` JSON log line emitted + `provider_health_events` empty (happy path) + stub provider log captures the call.
- Admin-template CRUD page: **≥ 10 Playwright or component tests** covering create, edit-bumps-version, archive, recruiter sees readonly picker, RBAC denial for recruiter POSTs. (Uses the same test style as existing admin dashboard pages — see `AdminGovernanceConsole.tsx` tests.)

**Target: ≥ 140 new tests in this story; the already-shipped sibling hit 472 counting cross-suite additions.** Every test passes against Supabase in integration mode (dev-standards §8: in-memory for unit, real Supabase for integration).

### AC 14: Reuse, don't reinvent — explicit anti-reinvention gates

- MUST use `withAuth()` from [`src/modules/auth/with-auth.ts`](../../src/modules/auth/with-auth.ts) on every API route. No inline session checks.
- MUST use `recordSyncFailure(source, recordId, err, runId?)` from [`src/features/candidate-management/infrastructure/sync-error-repository.ts`](../../src/features/candidate-management/infrastructure/sync-error-repository.ts). No ad-hoc error logs for ingestion failures.
- MUST use `createSyncRun('sms_dispatch')` + `completeSyncRun(runId, counts)` / `failSyncRun(runId, err)` — already proven in all 7 existing ingestion jobs.
- MUST use `getSupabaseAdminClient()` only from inside a new `features/outreach-engagement/infrastructure/*-repository.ts` — never in route handlers (dev-standards §4.5, §18).
- MUST use `ensureProvidersInitialized()` at the top of every outreach route (same pattern as Clay webhook: [src/app/api/webhooks/clay/route.ts](../../src/app/api/webhooks/clay/route.ts)).
- MUST follow ui-ux-standards.md for `/dashboard/admin/sms-templates` — `CollapsibleCard` grid, `max-w-6xl w-full px-6`, `rounded-xl border-gray-200` cards, `cbl-navy`/`cbl-blue` for accents (NOT `emerald-*`).
- MUST register the dispatch job in `registerIngestionJobs()` (see [jobs.ts:1242](../../src/modules/ingestion/jobs.ts#L1242)) — do not stand up a separate cron. Cadences live in `policy_registry` / `policy_versions` (architecture §Schedule Change Path).
- MUST declare new canonical types in `src/features/outreach-engagement/contracts/` (dev-standards §19.1): `SmsTemplate`, `SmsTemplateVersion`, `SmsSend`, `SmsSendStatus`, `CampaignRef`, `CandidateContactWindows`, `SmsProvider` (capability interface).
- MUST NOT create a parallel audit table — `outreach_audit_log` already exists; extend it.
- MUST NOT introduce a new date library just for timezone math — `Intl.DateTimeFormat` or the already-present `date-fns` is sufficient. (Check `package.json` before picking.)
- MUST NOT write `db.from('sms_sends')` in a route handler — all writes go through the repository (dev-standards §4.5 is enforced; code review rejects otherwise).

## Tasks / Subtasks

### Task 1: Schema + migration + seed RPC (AC 1, 2, 12)

- [ ] 1.1 Write `supabase/migrations/2026-04-XX-story-3-1-sms-outreach.sql`:
  - `ALTER TABLE sms_sends ADD COLUMN IF NOT EXISTS provider_idempotency_key text` + partial unique index
  - `ALTER TABLE outreach_audit_log ADD COLUMN IF NOT EXISTS trace_id text, correlation_id text, event_envelope jsonb`
  - `CREATE OR REPLACE FUNCTION claim_due_sms_sends(...)` returning setof, FOR UPDATE SKIP LOCKED
  - `CREATE OR REPLACE FUNCTION insert_sms_sends_bulk(p_rows jsonb)` — atomic batch with opt-out check
  - `CREATE OR REPLACE FUNCTION seed_sms_templates(p_tenant_id, p_actor_id)` — 12 ON CONFLICT DO NOTHING inserts
  - RLS update: `sms_templates` admin-write policy; `sms_sends` tenant-scoped R/W
  - GRANTs to `authenticated` role only; NO `anon` grants
  - NO row mutations on observability tables (dev-standards §3)
- [ ] 1.2 Update `supabase/schema.sql` in the same PR (Dual-Update Rule §4.9)
- [ ] 1.3 Write 12 seed template bodies — persuasive copy, ≤ 480 chars, `{{first_name}}` + `{{tracking_link}}` + "Reply STOP to opt out" + identifiable sender. Review with PM (Vivek) before coding.
- [ ] 1.4 Unit tests on the seed RPC: idempotent re-run, new tenant gets 12 rows, existing tenant with edits preserves edits.

### Task 2: Feature module scaffolding (AC 14)

- [ ] 2.1 `src/features/outreach-engagement/contracts/sms-template.ts` — `SmsTemplate`, `SmsTemplateVersion`, `SmsAgenda` enum matching DB CHECK
- [ ] 2.2 `src/features/outreach-engagement/contracts/sms-send.ts` — `SmsSend`, `SmsSendStatus`, `SmsSendInsertRow`, `CampaignRef`
- [ ] 2.3 `src/features/outreach-engagement/contracts/contact-window.ts` — `CandidateContactWindows` type shape
- [ ] 2.4 `src/features/outreach-engagement/contracts/sms-provider.ts` — `SmsProvider` capability interface
- [ ] 2.5 `src/features/outreach-engagement/infrastructure/sms-template-repository.ts` — CRUD + version bump + RLS-aware
- [ ] 2.6 `src/features/outreach-engagement/infrastructure/sms-send-repository.ts` — insert single, bulk via RPC, claim due, update status, wrapper for audit-log write
- [ ] 2.7 `src/features/outreach-engagement/application/contact-window.ts` — pure `resolveNextContactWindow` + `isWithinContactWindow` + `loadDefaultContactWindow` (reads policy_registry)
- [ ] 2.8 `src/features/outreach-engagement/application/template-render.ts` — pure `renderTemplate(body, context)` with mustache-style `{{var}}` substitution (no dependency — 50 LOC)
- [ ] 2.9 `src/features/outreach-engagement/application/idempotency.ts` — pure `computeSmsIdempotencyKey({tenantId, candidateId, templateId, templateVersion, scheduledFor})` → SHA-256
- [ ] 2.10 Register capability/registry entries in `_bmad-output/architecture.md` §Implemented Capabilities (dev-standards §20 completion gate)

### Task 3: Stub SMS provider + framework wiring (AC 8)

- [ ] 3.1 `src/modules/providers/sms-stub/stub-sms-provider.ts` — implements `SmsProvider`, module-level in-memory log, deterministic message IDs
- [ ] 3.2 `src/modules/providers/sms-stub/index.ts` — `buildStubSmsProviderFromEnv()` factory + `setSharedSmsProvider(provider)` for test injection
- [ ] 3.3 Wire registration in `src/modules/providers/startup.ts::ensureProvidersInitialized()` — register `'sms-stub'` and seed the `sms` routing policy row
- [ ] 3.4 Unit tests — send shape, deterministic IDs, registry hooks, test-reset hooks

### Task 4: Dispatch job (AC 6, 7)

- [ ] 4.1 `src/modules/ingestion/jobs.ts::SmsDispatchJob` class implementing `SchedulerJob` — follows `EmailIngestionJob` pattern (stream-process, per-row error recovery, sync_run tracking)
- [ ] 4.2 Register in `registerIngestionJobs()` with `jobKey:'sms-dispatch'`, cadence from `policy_registry`
- [ ] 4.3 Integration tests — end-to-end: insert pending → tick → claim → dispatch → status='sent' → audit log → event emitted
- [ ] 4.4 Verify admin `SyncRunSummaryCard` shows the new job automatically (no UI changes needed)

### Task 5: API routes (AC 3, 4, 5, 10)

- [ ] 5.1 `src/app/api/outreach/sms/send/route.ts` — POST, `withAuth({ requireActiveClient: true, roles: ['recruiter','admin'] })`
- [ ] 5.2 `src/app/api/outreach/sms/bulk-send/route.ts` — POST, same auth, max 200 candidates
- [ ] 5.3 `src/app/api/outreach/sms/filter-send/route.ts` — POST, same auth, max 1,000 candidates, re-runs `search_candidates` RPC server-side
- [ ] 5.4 `src/app/api/outreach/track/[token]/route.ts` — GET, public, IP-rate-limited, SSRF-safe redirect
- [ ] 5.5 Response envelopes `{ data, meta } | { error: { code, message, details? } }` per dev-standards §16

### Task 6: Admin template CRUD UI (AC 1)

- [ ] 6.1 `src/app/dashboard/admin/sms-templates/page.tsx` — admin-only, CollapsibleCard grid by agenda
- [ ] 6.2 `TemplateEditorModal.tsx` — body textarea with char counter (≤1600), agenda dropdown, variables-detected preview
- [ ] 6.3 Uses existing `AdminGovernanceConsole` patterns; `max-w-6xl w-full px-6`, `rounded-xl border-gray-200`, `cbl-navy`/`cbl-blue`, NOT `emerald`
- [ ] 6.4 API routes under `/api/internal/admin/sms-templates/*` — RBAC `admin` only
- [ ] 6.5 Recruiter-side picker component `SmsTemplatePicker.tsx` — lists active templates grouped by agenda — read-only

### Task 7: Recruiter send UI (AC 3, 4, 5)

- [ ] 7.1 "Send SMS" button on `src/app/dashboard/recruiter/candidates/[id]/page.tsx` (single)
- [ ] 7.2 Bulk "Send SMS" action on `src/app/dashboard/recruiter/candidates/page.tsx` (top-of-list; uses the checkbox selection state — if none exists yet, add per UX standards)
- [ ] 7.3 "Send to All Matching" button — only enabled when filters/search are active, disabled otherwise
- [ ] 7.4 `SendSmsModal.tsx` — template picker, live preview, schedule preview ("Will send Mon 8:15 AM Central"), confirm
- [ ] 7.5 All text ≥ `text-xs`, `gray-*` neutrals, `cbl-*` brand (UI standards §Checklist)

### Task 8: Funnel event emission (AC 9)

- [ ] 8.1 `src/features/outreach-engagement/application/emit-funnel-event.ts` — builds `outreach.message.sent` envelope, calls structured `console.log(JSON.stringify(...))` (architecture §Observability Tier 1)
- [ ] 8.2 Schema version the envelope (`schema_version: '1.0.0'`) — immutable for Epic 10 consumers; any shape change = new schema_version
- [ ] 8.3 Also emit `outreach.message.clicked` on track endpoint hit
- [ ] 8.4 Test: snapshot-test the envelope JSON against a frozen fixture — any drift fails CI

### Task 9: E2E adversarial review

- [ ] 9.1 Dev agent runs full unit + integration suite green
- [ ] 9.2 Run `bmad-code-review` 4-layer adversarial pass (Blind Hunter + Edge Case Hunter + Acceptance Auditor + SSRF/XSS layer) — Epic-2 retro standard for new external-channel code
- [ ] 9.3 Triage findings into DN (decision-needed) / Patch / Defer per Story 1.12a template
- [ ] 9.4 Manual smoke: send single, send bulk 50, send filter-all at 500, click-track one, dispatch tick; verify `SyncRunSummaryCard` shows the run

## Dev Notes

### Previous Story Intelligence (Stories 2-7, 2-7a, 2-8, 1-12, 1-12a, 1-12b)

**From Story 2-7 (Global Scheduler — DONE 2026-04-14):** All recurring jobs MUST register via `registerIngestionJobs(scheduler)` in [src/modules/ingestion/jobs.ts](../../src/modules/ingestion/jobs.ts). New job needs: class implementing `SchedulerJob`, `jobKey`, `scheduleName`, `cronExpression`, `policyFamily`, `policyKey`. Cadence is code-defined in the registration call AND synced to `policy_registry` on bootstrap; admin UI shows read-only label + edit-in-modal. DO NOT create a parallel cron — the single Render cron `CBLAero-Scheduler-Tick` (`*/10 * * * *`) fires all jobs.

**From Story 2-7a (Scheduler Admin Dashboard — DONE 2026-04-15):** `SchedulerStatusCard` auto-discovers registered jobs; no UI work needed for the new SMS dispatch job to appear. Cadences editable via existing modal that writes to `policy_registry` / `policy_versions`.

**From Story 2-8 (Clay Webhook — DONE 2026-04-16):** The Story 2-8 retro coined "discover before you code" as mandatory for external integrations — applies here to Telnyx in 3.1b. For this story (stub-only), the lesson translates to: **freeze the `SmsProvider` capability interface with explicit shape before writing the stub** so 3.1b is a drop-in swap. Also: bulk row loops MUST accumulate per-row errors in `sync_run_errors` linked to `run_id`, NEVER fail the whole batch. Hourly sync_run buckets are Clay-specific — SMS dispatch uses per-run (normal pattern).

**From Story 1-12 (Provider Framework — DONE 2026-04-16):** Framework is in place. `BaseProviderClient` wraps outbound HTTP; `BaseWebhookReceiver` wraps inbound. For this story: SMS outbound goes through the framework (via the stub's wrapped `base: BaseProviderClient` or Anthropic-style hooks per Story 1.12b AnthropicLLMProvider). NO vendor SDK imports in product code (dev-standards §1).

**From Story 1-12a (Clay + Ceipal migration — DONE 2026-04-17):** Routing-policy startup seed pattern lives in `src/modules/providers/startup.ts::ensureProvidersInitialized()`. For this story, add `'sms-stub'` alongside `'clay'`, `'clay-outbound'`, `'ceipal'`. Call `ensureProvidersInitialized()` at the top of every outreach route (same as Clay webhook does). The `attachProviderLogSink()` helper will auto-emit `ProviderLogEntry` JSON lines for every stub call.

**From Story 1-12b (Graph + Anthropic migration — DONE 2026-04-17):** `AnthropicLLMProvider` is the reference pattern for SDK-based providers that go through registry health hooks without `wireClient`. SMS stub doesn't need that complexity today (there's no SDK), but the capability-interface-first approach is the blueprint for 3.1b.

**From Epic 2 retro (2026-04-16):**
- Scope growth is normal — plan for 2x (A1). This story may grow into 3.1 + 3.1b at minimum; keep the capability interface stable so that split is clean.
- "Discover before you code" is mandatory for 3.1b when Telnyx lands (A2). For 3.1: freeze the interface.
- Foundational stories get adversarial review BEFORE downstream stories start (A3) — this is the foundational outreach story; Stories 3-3/3-4/3-5/3-7 depend on its schema and event shape. **Run 4-layer code review before 3-3 starts** (dev + explicit gate).
- HIGH debt D1 (`ingestion_state` downgrade in `upsert_candidate_batch` — fixed in [2026-04-16-d1-ingestion-state-whitelist.sql](../../supabase/migrations/2026-04-16-d1-ingestion-state-whitelist.sql)) — validated before Epic 3 kickoff per retro verdict.

### Architecture Anchors

Follow these architecture sections to the letter:

- **§Global Scheduler Design** — `schedule_definitions` + `schedule_runs` + `FOR UPDATE SKIP LOCKED`; emit outbox/jobs, workers are event-driven. SMS dispatch is a scheduled job, not a cron.
- **§6 Consent Synchronization Latency** — consent check at enqueue AND dequeue. A candidate who opts out AFTER their SMS was queued but BEFORE dispatch must see `status='blocked_opt_out'`. Do NOT check consent only at enqueue.
- **§10 Communication Collision Prevention — Outreach Lock** — `candidate_outreach_lock` 24-hr cooldown applies to AUTOMATED outreach. **Recruiter-triggered single-send, bulk-send, and filter-send bypass the lock** (architecture §10: "Manual recruiter action bypasses with visible banner; confirmation logged as `outreach.manual.override`"). Implement the bypass + banner in the UI + audit event. The dispatch job does NOT bypass — if the scheduler later fires a queued send for a candidate who received a recruiter-manual SMS in the last 24 hours, the dispatch job MUST transition to `status='blocked_cooldown'`, `blocked_reason='candidate_outreach_lock_active'`. (Add this status to the `sms_sends_status_valid` CHECK.)
- **§11 Provider-Level Idempotency** — `sha256(tenant_id + candidate_id + job_requirement_id + message_template_version + send_window_date)`. For this story: there's no job_requirement_id yet (Epic 4) — use `''` as the placeholder, so the key becomes `sha256(tenant + candidate + template_id + template_version + scheduled_for.yyyy-mm-dd)`. When Epic 4 adds job IDs, the key will include them and be non-breaking (different hashes for different jobs; same-hash only when same candidate+template+day).
- **§7 Webhook Burst Handling** — inbound webhook pattern reserved for Story 3-5 (delivery webhooks) and 3-4 (inbound response). NOT needed here.
- **§17 Observability and Distributed Tracing** — `trace_id` propagates through every audit row + log line. `outreach_audit_log.trace_id` is NEW (AC 12). Propagate from `proxy.ts` middleware → route handler → repository → audit log.
- **§19 Provider Failover and Kill Switch** — the stub is registered with `mode='normal'`; no kill-switch math applies on the stub (no failures in happy path). But the routing-policy row MUST exist so Story 3.1b's Telnyx migration is a mode-flip, not a schema change.
- **§24 Policy Registry and Zero-Inference Guardrail** — the default contact window MUST live in `policy_registry`, not in code. If no row exists, seed it in the migration: `family='outreach_defaults'`, `key='sms_default_contact_window'`, `value='{"timezone":"America/Chicago","windows":[{"day":"mon","start":"08:00","end":"20:00"},…]}'`.

### Funnel Measurement Plumbing

Epic 10 (Delivery & Metrics) consumes `outreach.message.sent` and `outreach.message.clicked` via log drain. This story MUST:
1. Emit the events as structured JSON lines per the envelope in architecture §Communication Patterns.
2. Snapshot-test the envelope — any key rename breaks Epic 10 silently, so lock the shape in a frozen JSON fixture that CI diffs on every build.
3. NOT build any dashboard — that's Story 7-1 onwards. Your job: emit, store, audit. Dashboards consume.

### Security / Compliance Deep Cuts

- **TCPA (NFR24):** every outbound SMS MUST include a compliant opt-out instruction in the rendered body ("Reply STOP to opt out"). Templates that lack this fail validation on save. Enforce in the template editor + in a DB CHECK if tractable (regex).
- **PII in logs:** phone numbers MUST NOT appear in structured logs. Log the `sms_sends.id` and candidate_id hash, never the raw phone. (Clay retro: PII leak risk in debug logs is real; default `CLAY_WEBHOOK_DEBUG=true` was flagged as P5 critical patch.)
- **Rendered body hash, not body, in audit:** `rendered_body_hash` is the NFR18 compliance field. `rendered_body` is nullable in `sms_sends` — NULL it out on any recruiter-requested delete path (GDPR erasure, Story 8-3) but keep the hash.
- **SSRF on click redirect:** the `destination_url` is user-supplied (via template context). Validate at SEND time: `https://` only, host must be in tenant's allowlist (`tenants.allowed_redirect_hosts` — add column if missing, default `['cbl.aero','cblsolutions.com']`). Reject at send, not at click.
- **Rate-limit click-tracking:** 100 req/min per IP. In-memory sliding window is fine for single-instance MVP (architecture §Token/Session Cache: module-level variables OK for MVP). When we go multi-instance, migrate to Redis or DB counter.
- **Append-only audit:** `outreach_audit_log` is append-only per architecture §Audit Log Immutability. NO UPDATE / DELETE grants for application roles. Corrections = new events.

### Project Structure Notes

- New feature module: `src/features/outreach-engagement/` — mirrors `features/candidate-management/` layout (`contracts/`, `application/`, `infrastructure/`). No UI subdir — pages live under `src/app/dashboard/`.
- New API namespace: `src/app/api/outreach/sms/*` + `src/app/api/outreach/track/[token]/*` + `src/app/api/internal/admin/sms-templates/*`.
- Dispatch job lives in existing `src/modules/ingestion/jobs.ts` (beside the 7 other registered jobs) — despite the name ("ingestion"), this file is the central job registry. Naming-debt decision: **reuse, don't fork**. If it becomes cluttered, split in a follow-up; do not branch now.
- Admin UI: `src/app/dashboard/admin/sms-templates/page.tsx` + colocated editor modal.
- Recruiter UI: add to existing candidates list + detail pages; one new reusable `SendSmsModal.tsx` component.
- Canonical domain types: `src/features/outreach-engagement/contracts/*.ts`. Cross-feature consumers import from `contracts/` only, never from `infrastructure/` (dev-standards §19.1).

### References

Cite sources on every technical claim:

- [Epics index — §Epic 3 Story 3.1](../epics.md#epic-3---outreach-orchestration-and-candidate-engagement---backlog)
- [PRD §Outreach & Engagement (FR8–FR17)](../prd.md#functional-requirement-categories) / [PRD.full §FR8–FR17](../prd.full.md#L798-L807)
- [Architecture §Confirmed Integration System Matrix — Telnyx](../architecture.md#confirmed-integration-system-matrix)
- [Architecture §Global Scheduler Design](../architecture.md#global-scheduler-design)
- [Architecture §6 Consent Synchronization Latency](../architecture.md#6-consent-synchronization-latency-sms-opt-out--kills-pending-email)
- [Architecture §10 Communication Collision — Outreach Lock](../architecture.md#10-communication-collision-prevention--channel-agnostic-outreach-lock)
- [Architecture §11 Provider-Level Idempotency](../architecture.md#11-provider-level-idempotency--preventing-duplicate-outreach-on-worker-retry)
- [Architecture §19 Provider Failover + Kill Switch](../architecture.md#19-provider-failover-and-reputation-management--kill-switch--warm-standby)
- [Architecture §24 Policy Registry and Zero-Inference](../architecture.md#24-policy-registry-and-zero-inference-guardrail)
- [Architecture §25 Edge System Provider Framework — Story 1-12 / 1-12a / 1-12b implementation](../architecture.md)
- [UI/UX Standards §Admin Console + Component Inventory](../ui-ux-standards.md)
- [Development Standards §1 Provider Framework](../development-standards.md#1-external-api-calls--provider-framework-current--fetchwithretry-legacy)
- [Development Standards §3 Data Ingestion + Observability Table Mutations](../development-standards.md#3-data-ingestion-standards)
- [Development Standards §4 Database Access (RPC-first, 500-batch, Dual-Update Rule)](../development-standards.md#4-database-access--rpc-first-reusable-minimal-calls)
- [Development Standards §18 Reusability — Centralized Utilities](../development-standards.md#18-reusability--centralized-utilities--always-check-before-creating)
- [Development Standards §27 Dashboard UI Standards](../development-standards.md#27-dashboard-ui-standards)
- [Epic 2 Retrospective 2026-04-16 — Action Items A1–A3](../epic-2-retro-2026-04-16.md#action-items)
- [Story 2-7 Global Scheduler](2-7-implement-global-scheduler-control-plane.md)
- [Story 2-8 Clay Webhook (retroactive)](2-8-implement-clay-webhook-ingestion.md)
- [Story 1-12 Edge System Provider Framework](1-12-edge-system-provider-framework.md)
- [Story 1-12a Clay + Ceipal Migration](1-12a-migrate-clay-ceipal-to-provider-framework.md)
- [Story 1-12b Graph + Anthropic Migration](1-12b-migrate-graph-anthropic-to-provider-framework.md)
- [supabase/schema.sql:652 sms_sends table](../../supabase/schema.sql#L652)
- [supabase/schema.sql:691 sms_templates table](../../supabase/schema.sql#L691)
- [supabase/schema.sql:478 outreach_audit_log table](../../supabase/schema.sql#L478)
- [supabase/schema.sql:211 candidate_channel_preferences table](../../supabase/schema.sql#L211)
- [src/modules/providers/startup.ts ensureProvidersInitialized](../../src/modules/providers/startup.ts)
- [src/modules/ingestion/jobs.ts registerIngestionJobs](../../src/modules/ingestion/jobs.ts)

### Dependencies (Pre-Flight)

Before starting:
- [ ] Epic 2 retro debt D1 resolved (confirmed in sprint-status 2026-04-16).
- [ ] Story 1-12b (Graph/Anthropic migration — DONE 2026-04-17) merged — confirms SDK-based provider pattern for 3.1b Telnyx work.
- [ ] Story 1-12c (Supabase migration — IN-PROGRESS 2026-04-17) need not block; SMS dispatch uses standard Supabase admin client. If 1-12c changes the client API, one-line update here.
- [ ] Confirm Render env vars are writeable for the seed / template fixtures (no new env vars in this story — SMS stub is env-free).

### Rollout Plan

1. Migration PR (Task 1) — schema + seeds land behind a feature flag (`CBL_SMS_OUTREACH_ENABLED=false` default). Re-run migration is idempotent.
2. Capability + stub PR (Tasks 2, 3, 4) — registers provider, dispatch job runs but no sends exist until UI lands. Safe to merge.
3. API + UI PR (Tasks 5, 6, 7, 8) — flip `CBL_SMS_OUTREACH_ENABLED=true` in staging; admin creates 12 templates via seed RPC; recruiter tests single-send against stub; verify `SyncRunSummaryCard` + structured `outreach.message.sent` log lines.
4. Adversarial review PR (Task 9) — 4-layer review; patches applied inline per 1-12a template.
5. Production enable: flip env var in Render; seed RPC runs for the cblaero tenant; admin adds real template copy.
6. Hand-off to Story 3.1b: Telnyx provider is a swap (capability interface is stable); no further schema change required.

## Dev Agent Record

### Agent Model Used

_To be filled by the dev agent (claude-sonnet-4-6 or claude-opus-4-7 per bmad-dev-story configuration)._

### Debug Log References

_(empty — story not yet started)_

### Completion Notes List

_(empty — story not yet started)_

### File List

_(empty — story not yet started)_
