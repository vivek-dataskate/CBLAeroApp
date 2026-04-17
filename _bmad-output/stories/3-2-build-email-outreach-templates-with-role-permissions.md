# Story 3.2: Build Email Outreach Templates with Role Permissions

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a recruiter lead,
I want role-governed email template editing with version history plus a working send pipeline that reuses the SMS outreach module,
so that communication quality and compliance remain controlled and recruiters can actually send the emails they compose.

## Funnel Lever & Measurement

**REQUIRED — DO NOT SKIP.** Per the PRD north-star KPI (Success Criteria → "Beat LinkedIn RPS Recruiter Funnel"), every story must declare which funnel stage it moves.

- **Funnel lever(s) moved:** Outreach-sent volume + Response rate (email is a parallel touch channel alongside SMS from Story 3.1; two-channel coverage increases total reach and lifts response rate on candidates who prefer email).
- **Expected lift:** +30% outreach-sent volume vs. SMS-only baseline (recruiters send on the channel the candidate prefers — roughly one-third opt for email). Versioned templates + role governance protect the response-rate lift from content drift.
- **How lift is measured:** `outreach_sent` funnel event emitted on every email send with `channel='email'` (Epic 10 wiring) — visible on `/dashboard/recruiter/funnel` (from Story 10.x) with channel breakdown. Template-version tracking lets admins A/B-test response rates by version. Interim observability via `outreach_audit_log` and `email_sends` rows per tenant.
- **Baseline comparison:** LinkedIn RPS baseline is 100 InMails → 28 responses (28% response). Target: combined SMS + email two-channel outreach achieves ≥40% response on the same 100-touch budget. This story delivers the email half; Story 3.1 already shipped the SMS half.

## Acceptance Criteria

1. **Given** an admin with `outreach:manage-templates` permission **When** they open `/dashboard/admin/email-templates` **Then** they see all active email templates grouped by the 13 canonical agenda categories (`new_opportunity`, `availability_check`, `job_followup`, `submission_followup`, `interview_schedule`, `interview_reminder`, `interview_followup`, `bgv_initiation`, `bgv_followup`, `offer_extended`, `onboarding`, `reengagement`, `general`) with columns: Name, Subject, Version, Status (active/archived), Updated By, Updated At **And** can create / edit / archive templates **And** a non-admin receives HTTP 403 from every mutation endpoint.

2. **Given** an admin edits an active template and saves **When** the write completes **Then** a NEW `email_templates` row is inserted with `version = previous + 1`, same `template_key`, `created_by = session.actorId`, `created_at = now()` — the previous row is NOT mutated **And** only one row per `(tenant_id, template_key)` has `status = 'active'` at a time (previous active row flips to `archived`) **And** the version history panel on the admin UI lists every prior version with author and timestamp.

3. **Given** a recruiter viewing the candidate list or candidate detail page **When** they click "Send Email" **Then** a `SendEmailModal` opens with: agenda dropdown (filters the template list), template dropdown, subject preview, HTML body preview, merge-variable panel with candidate context pre-filled (`{{first_name}}`, `{{last_name}}`, `{{recruiter_name}}`, `{{job_title}}`, `{{company}}`, `{{unsubscribe_url}}`), and a Send/Schedule control.

4. **Given** a recruiter submits the send modal with 1-N selected candidates **When** the API receives the request **Then** for each candidate it:
   - Loads `candidate_channel_preferences.email_opted_in` — skips and records `blocked_opt_out` in `email_sends.status` if false
   - Renders subject + body via the shared `outreach` renderer (reused from Story 3.1)
   - Inserts one `email_sends` row per candidate (status `pending`, `scheduled_for = now()` for immediate, `scheduled_for = <future>` for schedule)
   - Writes one `outreach_audit_log` row with `channel = 'email'`, `template_id`, `template_agenda`, `sender_user_id`, `sender_role`, `content_hash`, `compliance_check_passed`
   - Returns `{ queued, blocked_opt_out, errors }` counts — the API never sends synchronously

5. **Given** pending `email_sends` rows exist **When** the `OutreachEmailDispatchJob` runs (scheduler-registered, default 1-minute cadence) **Then** it claims due rows via `FOR UPDATE SKIP LOCKED`, calls the stub `EmailCampaignProvider.send()` which returns `{ provider_message_id: 'stub-<uuid>', status: 'sent' }`, updates `email_sends.status = 'sent'`, `sent_at = now()`, `provider_message_id`, `provider = 'stub'` **And** a fail path updates `status = 'failed'` with `blocked_reason` and leaves the row for retry policy (Story 3.5 owns actual retry logic — this story only records failure correctly).

6. **Given** every email body **When** rendered **Then** an unsubscribe link is appended using `{{unsubscribe_url}}` = `${CBL_APP_URL}/portal/opt-out?token=<candidate_token>&channel=email` — absence of the link anywhere in the body causes the render function to throw before insert.

7. **Given** the feature ships **When** all tests run **Then** unit tests cover: permission gate, template version increment, renderer merge-variables + unsubscribe enforcement, opt-out short-circuit, dispatch job happy path + failure path **And** 12 seed email templates (one per agenda where needed — matches SMS seed count) are inserted via a new migration **And** typecheck + lint are clean.

## Tasks / Subtasks

- [ ] Task 1: Database schema — `email_templates`, `email_sends`, seeds (AC: #1, #2, #4, #5, #7)
  - [ ] 1.1 New migration `supabase/migrations/YYYY-MM-DD-story-3-2-email-outreach.sql` creates `cblaero_app.email_templates` mirroring `sms_templates` exactly, plus `subject text not null` column and `body` check constraint `length(body) <= 100000` (HTML bodies). Same agenda CHECK list (13 values). Same status CHECK (`active`, `archived`). Same unique index `idx_email_templates_tenant_key_version on (tenant_id, template_key, version)`. Same `(tenant_id, agenda, status)` lookup index.
  - [ ] 1.2 Create `cblaero_app.email_sends` mirroring `sms_sends` columns with these deltas: `rendered_subject text`, `rendered_body text`, `rendered_body_hash text`, NO `contact_window_deferred_until` (email has no contact-window rule — always allowed during recruiter hours), ADD `opened_at timestamptz`, `open_count integer not null default 0`, KEEP `clicked_at`, `click_count`, `tracking_token`, `tracking_url`. Same status CHECK list minus `deferred_window`: `('pending','queued','sent','delivered','failed','bounced','undeliverable','blocked_opt_out')`. Same indexes (`idx_email_sends_pending_due` on `(tenant_id, scheduled_for) WHERE status='pending'`, `idx_email_sends_tenant_candidate_status`).
  - [ ] 1.3 Apply the migration via Supabase MCP on the dev branch, then collapse the final state into `supabase/schema.sql` at the correct alphabetical position (after `email_*` group — there is no current `email_*` table block; place before `import_batches`). Per dev standards §4.9 the two files must ship in the same PR.
  - [ ] 1.4 Add RLS policies identical to the SMS equivalents: `email_templates_read` (tenant-scoped, any authenticated), `email_sends_read` (tenant-scoped), plus service-role full access.
  - [ ] 1.5 Seed 12 email templates inline in the migration (one per agenda: omit `general` OR omit one rare agenda — pick the mapping that matches SMS seed count). Each seed row: `version=1`, `status='active'`, realistic aviation-recruiter subject (e.g. `"Aviation opportunity — {{job_title}} ({{company}})"`), branded HTML body with `<p>` copy + signature + `<a href="{{unsubscribe_url}}">Unsubscribe</a>` footer. Include `variables` jsonb listing every `{{var}}` used.
  - [ ] 1.6 Verify no RPCs needed for template writes — plain `.insert()` + `.update()` from repository is sufficient because the version-increment logic runs in JS (see Task 3). Dispatch job WILL need a claim RPC — see Task 6.

- [ ] Task 2: Extend `outreach` module with email-specific pieces (AC: #3, #4, #6)
  - [ ] 2.1 In `src/modules/outreach/` (the shared module Story 3.1 created — reuse, do not fork), add a `channels/email/` subdirectory. Do not duplicate the renderer, validator, consent-gate, tracking-token, or audit writer — import them from the module root.
  - [ ] 2.2 Create `src/modules/outreach/channels/email/renderer.ts` — thin wrapper that calls the shared `renderTemplate(template, context)`, then runs an `assertUnsubscribeLink(bodyHtml)` guard that searches for `href="{{unsubscribe_url}}"` OR an already-rendered `${CBL_APP_URL}/portal/opt-out` URL. Throws `RenderError` if missing.
  - [ ] 2.3 Create `src/modules/outreach/channels/email/types.ts` — `EmailTemplate`, `EmailSend`, `EmailSendStatus`, `RenderedEmail = { subject, bodyHtml, bodyHash, trackingToken, trackingUrl }`.
  - [ ] 2.4 Create `src/modules/outreach/channels/email/email-provider.ts` — `EmailCampaignProvider` interface per architecture.md §External Systems: `send(message: RenderedEmailMessage): Promise<EmailProviderResult>` where `RenderedEmailMessage` includes `{ to, subject, bodyHtml, trackingToken, providerIdempotencyKey }` and result is `{ providerMessageId, status: 'sent' | 'failed', error? }`. Ship ONE implementation: `StubEmailProvider` that logs the send and returns `{ providerMessageId: 'stub-' + crypto.randomUUID(), status: 'sent' }` deterministically. Real Instantly + Graph fallback land in Story 3.2a.
  - [ ] 2.5 Register stub in `src/modules/providers/registry.ts` as `'email-campaign'` (per provider-framework §25) at startup so ProviderRegistry health-tracks it. For the stub this is a trivial always-healthy registration — the point is to lock the wiring in place so 3.2a swaps one factory line.
  - [ ] 2.6 Add `provider_routing_policies` seed row (migration in Task 1.1) for `channel = 'email'`, `primary = 'stub'`, `fallback = null`, `mode = 'normal'` so the framework's routing lookup returns a value when Story 3.2a arrives.

- [ ] Task 3: Email template repository (AC: #1, #2)
  - [ ] 3.1 Create `src/features/outreach-engagement/infrastructure/email-template-repository.ts`. Functions:
    - `listActiveEmailTemplates(tenantId): Promise<EmailTemplate[]>` — filter `status='active'`, order by `agenda, name`.
    - `listEmailTemplateHistory(tenantId, templateKey): Promise<EmailTemplate[]>` — all versions, newest first.
    - `getEmailTemplateById(tenantId, id): Promise<EmailTemplate | null>`.
    - `createEmailTemplateVersion(input): Promise<EmailTemplate>` — inside one SQL transaction (wrap with `rpc` or sequential with rollback contract): (a) `UPDATE email_templates SET status='archived', updated_at=now() WHERE tenant_id=$1 AND template_key=$2 AND status='active'`; (b) compute `next_version = max(version) + 1 WHERE template_key=$2`; (c) `INSERT INTO email_templates (...) VALUES (...)`. If transactional atomicity matters at scale, create `create_email_template_version` RPC per dev-standards §4.1 (2+ sequential calls → RPC).
    - `archiveEmailTemplate(tenantId, templateKey): Promise<void>` — flip active row to archived without creating a new version.
  - [ ] 3.2 Always check `.error` on every Supabase call per dev-standards §4.7.
  - [ ] 3.3 Feature folder `src/features/outreach-engagement/` should already exist from Story 3.1. If not, create it — do not scatter outreach code under `candidate-management`.

- [ ] Task 4: Email send repository (AC: #4, #5)
  - [ ] 4.1 Create `src/features/outreach-engagement/infrastructure/email-send-repository.ts`. Functions:
    - `insertEmailSend(input): Promise<EmailSend>` — single insert with all required columns.
    - `batchInsertEmailSends(inputs[]): Promise<EmailSend[]>` — one round-trip `.insert(array)`, max 500 rows per dev-standards §4.4.
    - `claimDueEmailSends(tenantId?, limit=100): Promise<EmailSend[]>` — invoked by dispatch job. Implement as RPC `claim_email_sends` using `FOR UPDATE SKIP LOCKED` on `status='pending' AND scheduled_for <= now()`, flip rows to `'queued'`, return claimed rows. Pattern: copy from Story 2.7's `claim_due_schedules` RPC.
    - `markEmailSendSent(id, providerMessageId, provider)`, `markEmailSendFailed(id, reason)`.
    - `getEmailSendsByCandidate(tenantId, candidateId, limit=50)` — for the candidate detail history tab.

- [ ] Task 5: Admin UI — email template CRUD (AC: #1, #2)
  - [ ] 5.1 Create `src/app/dashboard/admin/email-templates/page.tsx` — server component, session + role gate identical to `/dashboard/admin/sms-templates` (Story 3.1 reference). Non-admin → redirect.
  - [ ] 5.2 Create `src/app/dashboard/admin/email-templates/EmailTemplateList.tsx` — client component. GET `/api/internal/admin/email-templates` on mount. Group templates by `agenda` with expand/collapse per agenda. Columns per row: Name, Subject, Version, Status, Updated By, Updated At, Actions (Edit, History, Archive).
  - [ ] 5.3 Create `src/app/dashboard/admin/email-templates/EmailTemplateEditor.tsx` — client modal. Fields: Agenda (dropdown, 13 values), Name, Template Key (read-only once created), Subject, Body (HTML textarea — plain textarea is fine for MVP, richer editor is a 3.2a concern), Variables (auto-derived from body on blur via regex `/\{\{(\w+)\}\}/g`). Save → POST or PATCH to API.
  - [ ] 5.4 Create `src/app/dashboard/admin/email-templates/EmailTemplateHistoryPanel.tsx` — side panel that lists all versions from `listEmailTemplateHistory()` with author + timestamp + status badge. Clicking a prior version opens a read-only preview; no rollback in this story (explicit future enhancement).
  - [ ] 5.5 Follow UI standards from `_bmad-output/ui-ux-standards.md`: `bg-white`, `rounded-xl border border-gray-200`, `cbl-navy` primary buttons, `CollapsibleCard` where appropriate, Poppins font, no `slate-*` / `emerald-*` / `cyan-*`, min 12px type.
  - [ ] 5.6 Add "Email Templates" card to `/dashboard/admin` next to "SMS Templates" (from 3.1) — both link to their respective management pages.

- [ ] Task 6: Admin API routes (AC: #1, #2)
  - [ ] 6.1 `GET /api/internal/admin/email-templates` — `withAuth({ permission: 'outreach:manage-templates' })`. Returns `listActiveEmailTemplates(activeClientId)`. Add a `?history=<template_key>` query mode that instead returns `listEmailTemplateHistory()`.
  - [ ] 6.2 `POST /api/internal/admin/email-templates` — create new template (version 1). Body validation: required `agenda` ∈ 13 values, `name`, `template_key` (unique within tenant), `subject`, `body`, optional `variables[]`. Reject body with no `{{unsubscribe_url}}` via the renderer's assertion. Returns the created row.
  - [ ] 6.3 `PATCH /api/internal/admin/email-templates/[id]` — edit an active template. Calls `createEmailTemplateVersion()` — DOES NOT mutate the referenced row (AC #2). Returns the NEW version row.
  - [ ] 6.4 `POST /api/internal/admin/email-templates/[id]/archive` — calls `archiveEmailTemplate`.
  - [ ] 6.5 All four routes: `withAuth({ permission: 'outreach:manage-templates' })`, resolve `activeClientId` via `resolveRequestTenantId`, tenant-scope every query. Unknown `id` or cross-tenant → 404 (never leak existence).
  - [ ] 6.6 Add `'outreach:manage-templates'` to `ProtectedAction` union in `src/modules/auth/authorization.ts` **ONLY IF Story 3.1 has not already added it** (per user brief, Story 3.1 is the owner — double-check at implementation time and skip if present). Grant to `admin` role. Do not grant to `recruiter` or `delivery-head`.

- [ ] Task 7: Recruiter Send Email modal + API (AC: #3, #4)
  - [ ] 7.1 Create `src/app/dashboard/candidates/SendEmailModal.tsx` — client modal mirroring `SendSMSModal.tsx` from Story 3.1. Props: `candidateIds: string[]`, `onClose`, `onSent`. Lists active email templates (GET `/api/internal/outreach/email-templates`). On submit posts to `/api/internal/outreach/email/send`.
  - [ ] 7.2 Add "Send Email" action to candidate list toolbar (appears when ≥1 candidate selected) alongside the existing "Send SMS" button from 3.1. Single-candidate "Send Email" button on candidate detail page header.
  - [ ] 7.3 `GET /api/internal/outreach/email-templates` — `withAuth({ permission: 'candidate:write' })`. Returns active templates so recruiters can see them but NOT edit (no POST/PATCH equivalent on this route).
  - [ ] 7.4 `POST /api/internal/outreach/email/send` — `withAuth({ permission: 'candidate:write' })`. Body `{ candidateIds: string[] (max 500), templateId, scheduledFor?: ISO8601 }`. For each candidate: check `candidate_channel_preferences.email_opted_in`, render, insert `email_sends` row, write `outreach_audit_log`. Return `{ queued, blocked_opt_out, errors }` per AC #4. Batch candidate fetch into a single `.in('id', candidateIds)` call — never loop per-candidate DB queries (dev-standards §4.3).
  - [ ] 7.5 When `candidateIds.length > 50`, create a `campaign_id uuid` (fresh) and stamp it on every `email_sends.campaign_id`. For ≤50, `campaign_id` is null (ad-hoc send). Bulk campaign execution at 500–5000 scale is Story 3.7's concern — this story caps at 500 in the route.

- [ ] Task 8: Dispatch job (AC: #5)
  - [ ] 8.1 Create `OutreachEmailDispatchJob` implementing `SchedulerJob` in `src/modules/ingestion/jobs.ts` OR a new `src/modules/outreach/jobs.ts` (prefer the outreach module — keep feature code co-located).
  - [ ] 8.2 Job body: `claimDueEmailSends(limit=100)` → for each row: resolve `getEmailCampaignProvider()` from registry → call `provider.send()` → on success `markEmailSendSent`, on fail `markEmailSendFailed`. Emit `outreach.email.sent` log line per dispatch.
  - [ ] 8.3 Register in `registerOutreachJobs(scheduler)` with default cron `*/1 * * * *` (every minute) and policy family `refresh_cadences`, key `outreach_email_dispatch`. If `registerOutreachJobs` does not yet exist (3.1 may have added `registerOutreachSmsJob`), create it and add the SMS job alongside — do not fork the registration entrypoint.
  - [ ] 8.4 Story 3.5 owns retry-count increment, exponential backoff, and terminal undeliverable. THIS story stops at `status='failed'` on the single attempt. Document that explicitly in Dev Notes so 3.5 can extend without breaking this.
  - [ ] 8.5 Add `'email-dispatch'` alias to `src/app/api/internal/jobs/run/route.ts` for manual triggering, following the explicit `else if` + terminal `throw` pattern from Story 2.6 Task 7.4 (dev-standards: no silent catch-all).

- [ ] Task 9: Tests (AC: all)
  - [ ] 9.1 Unit: `email-template-repository.test.ts` — version-increment inserts a new row, archives the previous, preserves history. Cross-tenant isolation (tenant A cannot see tenant B's templates).
  - [ ] 9.2 Unit: `email-renderer.test.ts` — merges every variable, throws `RenderError` when body omits `{{unsubscribe_url}}`, HTML-escapes user-supplied candidate fields to prevent template-injection XSS (critical — recruiter-supplied data MUST be escaped).
  - [ ] 9.3 Unit: `send-route.test.ts` — blocks opt-out, creates one `email_sends` + one `outreach_audit_log` per candidate, rejects >500 candidates, handles unknown candidateId gracefully.
  - [ ] 9.4 Unit: `dispatch-job.test.ts` — happy path (stub provider returns sent), failure path (provider throws → `status='failed'` + `blocked_reason` set), concurrency safety (two concurrent job runs do not dispatch the same row — relies on `FOR UPDATE SKIP LOCKED`; test by mocking the claim RPC to return the same row twice and asserting the second claim is empty).
  - [ ] 9.5 Unit: `email-templates-api.test.ts` — admin can POST/PATCH; recruiter receives 403 on POST/PATCH but 200 on GET of the recruiter-facing `/api/internal/outreach/email-templates`.
  - [ ] 9.6 Integration: exercise the full flow with the stub provider — admin creates template → recruiter selects 3 candidates (one opted out) → posts send → dispatch job runs → verify 2 `sent` + 1 `blocked_opt_out` + 3 `outreach_audit_log` rows.

- [ ] Task 10: Register capabilities in architecture.md + development-standards.md §18 (AC: compliance)
  - [ ] 10.1 Add `email_templates` / `email_sends` tables to the canonical schema registry in architecture.md (§Database Schemas adjacent to the `sms_*` entries).
  - [ ] 10.2 Add `EmailCampaignProvider` interface to architecture.md §External Systems.
  - [ ] 10.3 Add `createEmailTemplateVersion`, `insertEmailSend`, `claimDueEmailSends`, `renderEmailTemplate` to development-standards.md §18 Reusability table.
  - [ ] 10.4 Document the stub-provider + 3.2a swap plan in `_bmad-output/deferred-work.md` so Story 3.2a finds it immediately.

## Dev Notes

### SMS parity — what we copy, what we change

Story 3.1 (in parallel) ships the SMS equivalent of every asset in this story. To prevent two drifting implementations, we **replicate the directory layout** but keep channel-specific files isolated:

```
src/
  modules/outreach/
    renderer.ts            <-- shared (from 3.1) — reuse verbatim
    validator.ts           <-- shared (from 3.1)
    consent-gate.ts        <-- shared (from 3.1)
    tracking.ts            <-- shared (from 3.1)
    audit.ts               <-- shared (from 3.1)
    send-repository.ts     <-- shared interface; per-channel repos below
    channels/
      sms/                 <-- Story 3.1
      email/               <-- THIS STORY
        renderer.ts        <-- thin wrapper + unsubscribe assertion
        email-provider.ts  <-- EmailCampaignProvider interface + Stub impl
        types.ts
  features/outreach-engagement/
    infrastructure/
      sms-template-repository.ts   <-- Story 3.1
      sms-send-repository.ts       <-- Story 3.1
      email-template-repository.ts <-- THIS STORY
      email-send-repository.ts     <-- THIS STORY
  app/
    dashboard/admin/sms-templates/   <-- Story 3.1
    dashboard/admin/email-templates/ <-- THIS STORY
```

**Do NOT duplicate** `renderer.ts`, `validator.ts`, `consent-gate.ts`, `tracking.ts`, `audit.ts`, or the `outreach_audit_log` writer. Reuse them as-is. The renderer takes a generic `body: string` — HTML or text — and the validator takes a generic template; they do not care about channel.

**Canonical 13 agendas** (do not re-define, import from `src/modules/outreach/agendas.ts` which Story 3.1 creates):
`new_opportunity`, `availability_check`, `job_followup`, `submission_followup`, `interview_schedule`, `interview_reminder`, `interview_followup`, `bgv_initiation`, `bgv_followup`, `offer_extended`, `onboarding`, `reengagement`, `general`.

Matches the `sms_templates.agenda` CHECK constraint verbatim.

### Schema deltas vs. SMS

Email-specific columns in `email_templates`:
- `subject text not null`
- `body` check constraint `length(body) <= 100000` (HTML is verbose; 100KB is generous but bounded)

Email-specific columns in `email_sends`:
- `rendered_subject text`
- `opened_at timestamptz`, `open_count integer not null default 0` (open-tracking pixel — Story 3.2a wires it; schema is present so we don't migrate again later)
- No `contact_window_deferred_until` — email has no contact-window enforcement

Email-specific status values: drop `'deferred_window'` from the CHECK list.

### Shared tables — do not re-create

From Story 3.1 (already created — `schema.sql` lines 211-228, 478-498):
- `candidate_channel_preferences` — query `email_opted_in` before every send (AC #4). Do NOT add an `email_*` counterpart — the table already has `email_opted_in`, `email_opt_out_at`, `email_opt_out_reason` columns.
- `outreach_audit_log` — `channel` column accepts `'sms' | 'email'` via the existing CHECK. Write email audit rows with `channel = 'email'`. No schema change required.

### Renderer — merge-variable spec

Variables resolved per candidate at send time:

| Variable | Source |
|---|---|
| `{{first_name}}`, `{{last_name}}` | `candidates.first_name` / `.last_name` |
| `{{email}}` | `candidates.email` |
| `{{recruiter_name}}` | `session.actorId` → lookup `users.display_name` |
| `{{job_title}}`, `{{company}}` | From send request body — recruiter must supply (template validator rejects unsupplied required vars) |
| `{{unsubscribe_url}}` | `${CBL_APP_URL}/portal/opt-out?token=<candidate_token>&channel=email` — computed at render time; `candidate_token` is the existing portal token from Story 2.6 / Story 3.6. Story 3.6 owns minting; this story consumes. |

**XSS hardening (mandatory):** every candidate-sourced field (`first_name`, `last_name`, etc.) runs through `escapeHtml()` from `src/modules/outreach/renderer.ts` BEFORE substitution. Recruiter-supplied `job_title` / `company` run through the same escape. A malicious candidate name like `<script>alert(1)</script>` must render as `&lt;script&gt;alert(1)&lt;/script&gt;` in the email HTML. Unit test this explicitly (Task 9.2).

### Unsubscribe enforcement

Every rendered body MUST contain the unsubscribe link. The renderer's `assertUnsubscribeLink()` runs AFTER variable substitution and searches for either the literal `{{unsubscribe_url}}` variable or an already-rendered `${CBL_APP_URL}/portal/opt-out` URL. Throws `RenderError('Missing unsubscribe link')` if absent. The admin template editor blocks save on the same check before persisting. CAN-SPAM + internal policy.

### Permissions — follow Story 3.1's addition

Story 3.1 adds `'outreach:manage-templates'` to `ProtectedAction` in `src/modules/auth/authorization.ts` and grants it to `admin` only. THIS story:
- Reuses the same permission — no new permission strings.
- Uses existing `'candidate:write'` for recruiter-facing send routes (already granted to recruiter + delivery-head + admin).

Double-check at implementation time: if 3.1 has not yet merged, add `'outreach:manage-templates'` here instead (see Task 6.6).

### Provider framework integration (architecture.md §25)

Per Story 1.12 (done) + 1.12b (done — Graph migrated), the `EmailCampaignProvider` interface lives in `src/modules/outreach/channels/email/email-provider.ts` but is REGISTERED through `ProviderRegistry` at startup. Story 3.2a (Instantly real integration) will:
1. Create `src/modules/providers/instantly/instantly-client.ts` extending `BaseProviderClient`.
2. Create `InstantlyEmailProvider implements EmailCampaignProvider` that calls the client.
3. Flip the factory in `src/modules/providers/startup.ts` from `new StubEmailProvider()` to `new InstantlyEmailProvider()` — ONE line.
4. Add Graph fallback logic in the dispatch job (per architecture.md: "Email campaigns → Instantly primary; degraded fallback to Graph").

Keep the stub in `channels/email/stubs/stub-email-provider.ts` — it stays in tree for test doubles and dev-mode runs even after 3.2a.

### Stub provider health reporting

The `StubEmailProvider` records success via `providerRegistry.recordSuccess('email-campaign')` on every call so ProviderRegistry shows it healthy. Do not skip this — the framework's kill-switch math and admin-alert wiring (from 1.12b) expect every call to emit a health event.

### Scheduler integration (from Story 2.7)

Use the existing global scheduler — no feature-local `setInterval`. The dispatch job registers once in `registerOutreachJobs(scheduler)` and is invoked by `/api/internal/scheduler/tick` (Render cron `CBLAero-Scheduler-Tick`, `*/10 * * * *`). At the default cadence the email dispatch runs every 10 minutes worst-case; tight enough for MVP. Story 3.5 may tighten.

### Deferred to future stories (do NOT implement here)

- **Real Instantly integration + Graph fallback** → Story 3.2a
- **Bounce / delivery webhook processing, open/click event ingestion** → Story 3.2a (schema is present on `email_sends` already — `opened_at`, `open_count`, `clicked_at`, `click_count` — but nothing writes to them in this story)
- **Retry policy with exponential backoff** → Story 3.5
- **Two-way reply capture** → Story 3.4
- **5000-candidate bulk campaigns** → Story 3.7
- **Consent engine + policy windows** → Story 3.3 (this story uses the simple `email_opted_in` boolean check only)
- **Template richer WYSIWYG editor** → Story 3.2a or UI polish story

### Project Structure Notes

- All outreach feature code lives under `src/features/outreach-engagement/` per architecture.md §Requirements-to-Structure-Mapping ("FR8–FR17 → `features/outreach-engagement`"). If Story 3.1 placed code elsewhere, the reviewer should flag it — but this story follows the canonical location.
- Shared outreach primitives live under `src/modules/outreach/` — channel-agnostic.
- Admin dashboard routes under `src/app/dashboard/admin/email-templates/`.
- Recruiter-facing send modal lives co-located with the candidate list page: `src/app/dashboard/candidates/SendEmailModal.tsx`.
- DB migrations in `supabase/migrations/YYYY-MM-DD-story-3-2-email-outreach.sql`; collapse final state into `supabase/schema.sql` per §4.9 dual-update rule.

### References

- [Source: _bmad-output/epics.md#Epic-3] — Epic 3 story grid; 3.2 user story + AC
- [Source: _bmad-output/epics.full.md:934-945] — Full 3.2 story text
- [Source: _bmad-output/prd.md#FR9] — Email outreach with role-based edit permissions + version history
- [Source: _bmad-output/prd.full.md:35] — FR9 authoritative
- [Source: _bmad-output/prd.full.md:40] — FR14 TCPA/opt-out audit trail requirement (satisfied partially here + fully in 3.3)
- [Source: _bmad-output/architecture.md#Confirmed-Integration-System-Matrix (line 254)] — "Email campaigns → Instantly primary; degraded fallback to Graph for critical/manual messages"
- [Source: _bmad-output/architecture.md#Service-Boundary-Architecture (line 890)] — "Outreach/engagement FRs (FR8-FR17) → features/outreach-engagement + workers/outreach-worker"
- [Source: _bmad-output/architecture.md#11-Provider-Level-Idempotency (line 717)] — Provider idempotency key pattern: `sha256(tenant_id + candidate_id + job_requirement_id + message_template_version + send_window_date)`. Apply to email sends.
- [Source: _bmad-output/architecture.full.md Edge-System-Provider-Framework §25] — `EmailCampaignProvider` interface lives here; this story instantiates the stub
- [Source: _bmad-output/development-standards.md §1] — Provider framework mandate for new outbound integrations
- [Source: _bmad-output/development-standards.md §4.1, §4.4, §4.7, §4.9] — RPC-first, 500 batch max, always check .error, dual-update schema.sql + migration
- [Source: _bmad-output/development-standards.md §13] — Auth guard patterns for admin routes
- [Source: _bmad-output/development-standards.md §18] — Central utilities registry (add email entries)
- [Source: _bmad-output/ui-ux-standards.md] — Brand tokens, dashboard layout contract, component inventory
- [Source: supabase/schema.sql:211-228] — `candidate_channel_preferences` (reused)
- [Source: supabase/schema.sql:478-498] — `outreach_audit_log` (reused)
- [Source: supabase/schema.sql:652-712] — `sms_sends` / `sms_templates` — copy the structure for email counterparts
- [Source: src/modules/auth/authorization.ts] — `ProtectedAction` union; add `outreach:manage-templates` if 3.1 has not
- [Source: src/modules/providers/registry.ts + startup.ts] — Provider framework entry points for stub registration
- [Source: _bmad-output/stories/1-12-edge-system-provider-framework.md] — Framework primitives (`BaseProviderClient`, `ProviderRegistry`, routing policies, health tracking)
- [Source: _bmad-output/stories/1-12b-migrate-graph-anthropic-to-provider-framework.md] — Graph migration (reference when 3.2a wires Graph fallback)
- [Source: _bmad-output/stories/2-6-implement-availability-state-and-manual-refresh-operations.md Task 7.4] — Jobs-route alias pattern (explicit `else if` + terminal throw)
- [Source: _bmad-output/stories/2-7a-scheduler-admin-dashboard.md] — Admin UI pattern for job registration + SchedulerStatusCard

## Dev Agent Record

### Agent Model Used

_(populated at dev-story time)_

### Debug Log References

### Completion Notes List

### File List

_(populated at dev-story time — list every created/modified file per dev-standards §9)_
