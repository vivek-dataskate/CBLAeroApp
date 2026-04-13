- `pending_asset_deletions` (SharePoint erasure cleanup queue with retry state — see _Resilience §14_)
- `provider_rate_counters` (per-provider leaky bucket for enrichment rate limiting — see _Resilience §15_)
- `goal_approval_requests` (HITL approval records linking goal*states to actor decisions — see \_Resilience §16*)

---

stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:

- docs/planning_artifacts/prd.md
- docs/planning_artifacts/ux-design-specification.md
- docs/planning_artifacts/prd-validation-report.md
- docs/planning_artifacts/source-inputs/aviation-product-brief.md
- docs/planning_artifacts/source-inputs/aviation-marketing-copy.md
- docs/planning_artifacts/source-inputs/aviation-product-slides.md
- docs/planning_artifacts/source-inputs/aviation-talent-PRD.md
- docs/planning_artifacts/analysis/cblAero-advanced-elicitation-FR-analysis.md
- docs/planning_artifacts/analysis/cblAero-FR-analysis-executive-brief.md
- docs/planning_artifacts/analysis/cblAero-MVP-Elicitation-Analysis.md
- docs/planning_artifacts/analysis/cblAero-PRD-polish-analysis.md
  workflowType: 'architecture'
  project_name: 'CBLAero'
  user_name: 'vivek'
  date: '2026-03-10'
  lastStep: 8
  status: 'complete'
  completedAt: '2026-03-10'

---

# Architecture Decision Document

_This document captures collaborative architecture decisions for CBLAero and is the implementation source of truth for AI agents._

## Project Context Analysis

### Requirements Overview

- 76 FRs across 3 tiers: candidate management, outreach/engagement, recruiter workflow, scoring/matching, delivery analytics, compliance/governance.
- NFRs: 99.5% uptime, 24-hour delivery SLA for 5 candidates, <1-minute notification latency, GDPR/CCPA/TCPA, SOC 2 trajectory, tamper-evident audit.
- Architecture classification: event-rich workflow system with strict multi-tenant data boundaries, 12–16 bounded components, compliance as a first-order design concern.

### Technical Constraints and Dependencies

- Tiered implementation model:
  - Tier 1: manual-heavy validation path, high feedback density
  - Tier 2: automation and throughput expansion
  - Tier 3: pilot-readiness hardening
- Integration dependency on Microsoft Teams for recruiter delivery flow, with explicit outage fallback.
- Candidate trust flow requires job-scoped opt-in, one-time token links, and anti-abuse controls.
- Confidence/motivation models must remain explainable in MVP.

### Cross-Cutting Concerns Identified

- Tenant isolation and authorization enforcement at object level
- Auditability and event traceability for all critical actions
- Compliance-safe communication consent and retention
- Queueing/idempotency for outreach and notification flows
- Explainability of scoring and rejection rationale to preserve recruiter trust
- Cost guardrails and per-tenant metering readiness

## Technology Stack

### Selected Starter: Next.js App Router Baseline

```bash
npx create-next-app@latest cblaero --typescript --eslint --tailwind --src-dir --app --import-alias "@/*"
```

Runtimes: Node.js v24 LTS · Next.js 16.x · Supabase Postgres (PostgreSQL 18-compatible) with `pgvector`. TypeScript-first, App Router, ESLint, `src/` layout. Fastest path to Tier 1 validation while preserving future extraction of worker services.

**First story:** initialize baseline then add auth/tenant middleware, module boundaries, and audit envelope before any feature implementation.

## Core Architectural Decisions

### Data Architecture

- Primary OLTP database: Supabase Postgres (PostgreSQL 18-compatible target).
- **Record scale:** 1M existing candidate records at launch; projected 3M+ by Year 1 via ongoing recruiter uploads and automated ATS/email sync. All queries, indexes, and pagination strategies must be designed for 1M+ rows from day one — no deferred scaling assumptions.
- Data strategy:
  - Relational core for transactional consistency
  - Supabase Postgres is the authoritative persistence layer for session revocation, admin governance, and all audit streams to support multi-instance runtime safety
  - `pgvector` schema in Supabase for tenant-scoped semantic retrieval and RAG grounding workloads
  - Event outbox for reliable asynchronous publication
  - Materialized read models for dashboards and SLA views
  - Cursor-based pagination enforced on all candidate list endpoints (no offset pagination at scale)
  - Composite partial indexes on `(tenant_id, availability_status)`, `(tenant_id, location)`, `(tenant_id, cert_type)` to keep filtered queries sub-second at 1M+ rows
- Canonical entities:
  - `tenant`, `user`, `role_assignment`
  - `candidate`, `candidate_identity_link`, `candidate_availability_signal`
  - `job_requirement`, `job_intake_question`, `candidate_match`
  - `outreach_message`, `consent_record`, `delivery_attempt`
  - `interaction_event`, `audit_event`, `teams_notification`
  - `import_batch`, `import_row_error` (tracks all bulk upload and sync jobs with per-row error audit)
  - `goal_states` (serialized agent scratchpad for resumable agentic execution — see _Resilience §9_)
  - `candidate_outreach_lock` (channel-agnostic 24-hour cooldown enforcement — see _Resilience §10_)
  - `outreach_jobs` (provider idempotency keys and request IDs — see _Resilience §11_)
  - `candidate_faa_verification` (cert expiry tracking for nightly re-verification sweep — see _Resilience §12_)
  - `prompt_registry` (append-only scoring prompt/model version registry — see _Resilience §13_)
  - `trace_spans` (cross-service request tracing spans for Web App, queue, workers, and providers — see _Resilience §17_)

### Datastore Decision Guide

| Data Type | Store | CBLAero Implementation |
|-----------|-------|----------------------|
| Structured/relational | Supabase Postgres | Candidates, users, jobs, audit events, config |
| Embeddings / semantic search | pgvector (in Supabase) | Candidate matching, RAG retrieval (tenant-scoped) |
| Files / attachments | Supabase Storage | Resumes, email attachments (`candidate-attachments` bucket) |
| Token / session cache | Module-level variables | Graph token, Ceipal token (acceptable for single-instance MVP; migrate to Redis if multi-instance) |

### Audit Log Immutability

All `audit_*` tables are append-only. Application roles have INSERT + SELECT grants only — no UPDATE or DELETE in production. Corrections are recorded as new events, not overwrites. Retention minimum: 1 year for compliance-sensitive events. See development-standards.md §27 for schema patterns.

### Correlation IDs / Distributed Tracing

Every request receives a `x-trace-id` (UUID) in `proxy.ts` middleware. This ID must be:
- Propagated to all downstream service calls (HTTP headers)
- Included in all audit events (`trace_id` field)
- Logged in all structured log entries
- Used as the primary key for end-to-end request tracing

### Observability & Logging Strategy

**Decision:** Progressive observability — start with structured stdout, add managed log drains as scale demands, defer self-hosted ELK/Elasticsearch until Epic 7+.

**Tiered progression:**

| Tier | Trigger | Stack | Cost |
|------|---------|-------|------|
| **1 — Current (Tier 1 MVP)** | Now | Structured JSON via `console.log(JSON.stringify({...}))` → Render stdout capture | Free |
| **2 — Log Drain** | Story 2.7 (scheduler) or multi-instance deployment | Render → Logtail (or Datadog/Papertrail) log drain. No code changes — reads structured JSON from stdout. | Free tier (Logtail: 1GB/day, Papertrail: 50MB/day) |
| **3 — Managed Observability** | Epic 3+ (outreach, multi-service) or when log search becomes painful | Grafana Cloud (free: 50GB logs/mo, 10K metrics) or Elastic Cloud (free: 14-day retention). Add OpenTelemetry SDK for distributed tracing. | Free tier or ~$50-100/mo |
| **4 — Full Stack** | Epic 7 (metrics/dashboards) or compliance audit search requirements | Elastic Cloud or self-hosted ELK. Long-term retention, complex queries, dashboards, alerting. | ~$95+/mo |

**Rules for all tiers:**
- All logs MUST be structured JSON for job summaries, errors, LLM calls, and auth events (see development-standards.md §23)
- Simple `console.log('[Module] message')` is acceptable for development/debug lines
- Correlation IDs (`x-trace-id`) included in all structured logs regardless of tier
- No code changes required between tiers — the log drain reads stdout, structured format ensures compatibility
- Never add Elasticsearch, Kibana, or Logstash as application dependencies — they are infrastructure, not code

**What NOT to do:**
- Do not self-host ELK for a single-instance MVP — operational cost exceeds value
- Do not add logging SDKs (winston, pino, bunyan) until Tier 3 — `console.log` with JSON.stringify is sufficient and zero-dependency
- Do not store logs in Supabase — that's for application data, not observability
  - `gold_dataset_cases`, `logic_regression_runs`, `logic_regression_results` (LLM logic regression testing corpus and staged evaluation runs — see _Resilience §18_)
  - `provider_routing_policies`, `provider_health_events` (kill switch, warm-standby routing, and provider health state — see _Resilience §19_)
  - `policy_registry`, `policy_versions` (versioned scoring weights, thresholds, and operational policies — see _Resilience §24_)
  - `schedule_definitions`, `schedule_runs` (global scheduler control plane for recurring business jobs — see _Global Scheduler Design_)
  - `synthetic_load_profiles`, `load_test_runs` (Tier 2 and Tier 3 load-gate definitions and results — see _Resilience §23_)
  - `rag_documents`, `rag_chunks`, `rag_embeddings` (tenant-scoped retrieval corpus and vector index state)
  - `rag_queries`, `rag_citations` (RAG query auditability and source-grounding evidence)
- Dedupe strategy:
  - **Content Fingerprint Gate** — every ingestion path must compute a content fingerprint and check `content_fingerprints` before any expensive processing (LLM extraction, enrichment, DB upsert). If the fingerprint exists and status is `processed`, the pipeline short-circuits immediately. See _Content Fingerprint Gate_ section below.
  - Deterministic identity confidence thresholds per PRD
  - Manual review queue for uncertain merges
  - Dedupe runs asynchronously post-import; records are created in `pending_dedup` state before promotion to active
- Retention/deletion:
  - Policy-driven lifecycle with legal hold support
  - GDPR erase workflow as first-class background process
  - Voice call recordings and transcripts retained in Supabase for 3 years

### Candidate Data Ingestion Architecture

Four ingestion paths are supported; all funnel through the same deduplication and enrichment pipeline.

**Unified Candidate Extraction Service:**

All paths that extract candidate data from unstructured or semi-structured content (PDF resumes, email bodies, future formats) share a single `candidate-extraction` service within `features/candidate-management/application/`. This service exposes a common interface:

```typescript
extractCandidateFromDocument(
  content: Buffer | string,
  contentType: 'pdf' | 'email_body' | 'email_attachment',
  metadata: { source: string; tenantId: string; batchId?: string }
): Promise<CandidateExtraction[]>
```

- **LLM prompt and extraction schema are centralized** — a single structured-output schema defines the candidate fields extracted from any document type. Changes to the extraction schema apply uniformly across all parsers.
- **Content pre-processing is pluggable** — each content type has its own pre-processor (PDF text extraction, email body cleaning, etc.) that produces plain text before passing to the shared LLM extraction call.
- **API routes remain separate per upload type** — each ingestion path has distinct request handling (multipart CSV vs PDF files vs email webhook), validation rules, and UX flows. Routes call the extraction service; they do not implement parsing logic inline.
- **Future extensibility** — new document types (LinkedIn profile exports, ATS record dumps, etc.) only require a new pre-processor and route; the extraction core and downstream pipeline are reused.

**Path 1 — Initial bulk load (one-time, admin-supervised):**

- 1M existing records loaded via a Python migration script (not the live web app).
- Runs as a rate-limited batch against the Supabase service role from a Render one-off job.
- Chunks of 1,000 rows per transaction; progress written to `import_batch` table.
- Rollback capability: if error rate exceeds 5% within a chunk, the job pauses and alerts admin.
- Post-load: async deduplication worker runs over the full batch to collapse identity matches.
- Enrichment of the initial 1M runs as an overnight batch job at 100 candidates/sec; not a real-time process.

**Path 2a — Recruiter CSV uploads (daily/weekly, ongoing):**

- Web UI: drag-and-drop CSV with column mapping wizard and live validation preview.
- Max 10,000 records per recruiter upload; larger batches must be split or handled via admin migration path.
- Validated rows are written to `import_batch` table; a background worker processes the batch.
- Columns not mapped to canonical candidate fields are persisted to `candidates.extra_attributes` (`jsonb`) to preserve recruiter-provided context without schema churn.
- `extra_attributes` guardrails: normalize keys to lowercase snake_case, drop blocked sensitive keys (`password`, `token`, `secret`, `api_key`), and reject rows that exceed per-row key-count/serialized-size limits.
- Per-row error report available for download after processing (missing required fields, failed dedup rules, invalid format).
- Imported records enter `pending_enrichment` state; enrichment worker picks them up via outbox.

**Path 2b — Recruiter PDF resume uploads (on-demand, ongoing):**

- Web UI: recruiter upload page offers a mode selector — CSV or PDF resume. PDF mode accepts a single `.pdf` file or multiple `.pdf` files (via multi-file input or folder selection). Non-PDF file types are rejected client-side and server-side with a clear message.
- Each uploaded PDF is stored in Supabase Storage (`candidate-attachments` bucket) with a path of `resume-uploads/{tenant_id}/{batch_id}/{filename}`.
- LLM-powered extraction via the unified `candidate-extraction` service (shared with Path 3 email parsing) parses each PDF to extract structured candidate fields (name, email, phone, location, skills, certifications, experience).
- Extracted data is presented to the recruiter for review before confirmation — recruiter can edit, accept, or reject individual parsed candidates.
- Confirmed records are persisted via the standard ingestion pipeline with `source: resume_upload` and `ingestion_state: pending_enrichment`.
- A `candidate_submissions` row is created per PDF linking the raw file URL, extraction JSON, and the resulting candidate record.
- **Scanned-image PDF support:** When `pdf-parse` returns no extractable text, the system automatically falls back to Claude vision — the raw PDF is sent as a document content block and Claude reads it visually. This handles scanned resumes, photos of resumes, and image-embedded PDFs. The extraction method is tagged as `ocr+llm` for audit trail. Cost is ~4x higher per file ($0.015 vs $0.004) but only triggers for the ~4% of PDFs that are scanned images.
- Per-file error reporting: PDFs that fail extraction (encrypted, truly blank, corrupted) are flagged with clear error messages; the recruiter can retry or skip.
- No hard cap on file count per upload session — recruiters may select an entire folder. The system processes files in internal batches of 50 to bound concurrent LLM extraction cost and memory usage. A progress tracker shows overall and per-file status so the recruiter can monitor large uploads.
- The Supabase Storage URL for each uploaded PDF is persisted as `candidates.resume_url` — not in `candidate_submissions`. Submissions are reserved for email ingestion evidence only.

**Path 3 — ATS connector and email inbox sync (automated, Tier 2):**

- ATS connector: the global scheduler owns connector cadence and emits due `ats_sync.requested` jobs at scheduled intervals (minimum 15-minute interval per connector). The sync worker then polls the configured ATS API and upserts new or updated records through the standard deduplication pipeline with `source: ats_sync` attribution.
- Email inbox parsing: the global scheduler emits due `inbox_parse.requested` jobs for designated recruiter inboxes. The parse worker uses Microsoft Graph to fetch **unread** messages (`$filter=isRead eq false`) from the shared mailbox, processes each email one at a time (stream processing, not batch), runs LLM extraction, uploads all attachments to Supabase Storage, upserts the candidate, and marks the email as read via Graph PATCH. Failed emails stay unread for automatic retry on the next run. Non-submission emails (classified by LLM) are marked as read and skipped. Already-processed emails (dedup via fingerprint or submission check) are marked as read without re-processing.
- Both paths write to `import_batch` with source attribution; sync errors alert the admin and never silently discard records.
- Admin console shows per-connector: last sync timestamp, records synced/skipped/errored, and error rate trend.
- **Interim scheduling (pre-Story 2.7):** Render Cron Jobs call `/api/internal/jobs/run` every 15 minutes for email sync and daily for Ceipal sync. This is a temporary workaround until the Postgres-backed global scheduler is implemented.

### Content Fingerprint Gate

**Decision:** No ingestion path may invoke LLM extraction, enrichment, or database upsert without first checking a centralized content fingerprint. The fingerprint is the single, universal pre-processing gate across all ingestion types.

**Principle:** Never spend compute on content you have already seen. This applies to LLM calls, enrichment API calls, and unnecessary database round-trips equally.

**`content_fingerprints` table:**

```sql
create table if not exists cblaero_app.content_fingerprints (
  id bigint generated always as identity primary key,
  tenant_id text not null,
  fingerprint_type text not null check (fingerprint_type in (
    'file_sha256', 'email_message_id', 'csv_row_hash', 'ats_external_id', 'candidate_identity'
  )),
  fingerprint_hash text not null,
  source text not null check (source in ('email', 'ats', 'csv', 'ceipal', 'resume_upload', 'onedrive')),
  status text not null default 'processed' check (status in ('processed', 'failed')),
  candidate_id uuid references cblaero_app.candidates(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_fingerprint_tenant_type_hash
  on cblaero_app.content_fingerprints (tenant_id, fingerprint_type, fingerprint_hash);
```

**Fingerprint computation by ingestion type:**

| Ingestion Path | Fingerprint Type | Hash Input | What It Skips |
|----------------|-----------------|------------|---------------|
| PDF resume upload | `file_sha256` | `SHA-256(raw file bytes)` | LLM extraction + DB upsert |
| Email ingestion | `email_message_id` | Graph API `message.id` | LLM extraction + submission insert |
| CSV row | `csv_row_hash` | `SHA-256(normalized: lower(email)\|lower(first+last)\|phone)` | DB upsert call |
| ATS sync (Ceipal) | `ats_external_id` | `ceipal:{applicant_id}` | Full sync processing |
| OneDrive resume poll | `file_sha256` | `SHA-256(raw file bytes)` | Download + LLM extraction |
| Candidate identity | `candidate_identity` | `SHA-256(lower(email))` or `SHA-256(lower(first+last)+normalized(phone))` | DB round-trip for known active candidates |

**`FingerprintService` interface:**

```typescript
// features/candidate-management/infrastructure/fingerprint-repository.ts
interface FingerprintService {
  isAlreadyProcessed(tenantId: string, type: FingerprintType, hash: string): Promise<boolean>;
  recordFingerprint(tenantId: string, type: FingerprintType, hash: string, source: string, candidateId?: string, metadata?: Record<string, unknown>): Promise<void>;
  computeFileHash(content: Buffer): string;
  computeIdentityHash(email?: string, firstName?: string, lastName?: string, phone?: string): string;
}
```

**Pipeline integration — every ingestion path MUST follow this order:**

```
1. Receive input (file bytes, email, CSV row, ATS record)
2. Compute fingerprint → call isAlreadyProcessed()
3. If already processed → log skip, return early (NO LLM, NO DB write)
4. If not processed → proceed with extraction/upsert
5. On success → call recordFingerprint() with candidate_id linkage
6. On failure → call recordFingerprint() with status='failed' (allows retry)
```

**In-memory acceleration (optional, Tier 2):**

For high-throughput batch paths (CSV 10K rows, ATS bulk sync), the service loads recent fingerprints for the tenant into an in-memory `Set<string>` at batch start. This avoids per-row DB lookups. The set is populated from `content_fingerprints WHERE tenant_id = $1 AND fingerprint_type = $2 AND created_at > now() - interval '30 days'`. Cache invalidation is not required — false negatives (missed cache hit) simply fall through to the DB check; false positives are impossible because the set is read-only during the batch.

**Observability:**

Structured log on every skip: `{ event: 'fingerprint_hit', type, source, tenantId, hash: hash.slice(0,12) }`. This enables monitoring of duplicate submission rates per source and early detection of misconfigured connectors that re-send the same data.

### Authentication and Security

- Authentication:
  - Candidate: one-time token links, short-lived verification step
  - Internal users: SSO-ready session model and step-up auth for sensitive operations
- Authorization:
  - RBAC + tenant-scoped object checks on every read/write path
- Security controls:
  - Signed token links, replay protection, and strict expiry
  - Rate limiting and abuse detection on public-facing endpoints
  - PII encryption at rest and in transit
  - Security-relevant action logging into immutable audit stream

### API and Communication Patterns

- External API style: REST with explicit resource scoping and contract versioning.
- Internal async pattern: transactional outbox plus background workers.
- **Outbox implementation contract:**
  - A Postgres trigger (or application service) writes an `outbox` row **in the same transaction** as the state mutation. The DB is the single source of truth for event generation — no event can be lost due to an app crash between persist and enqueue.
  - A dedicated relay worker polls the `outbox` table and publishes events to background workers with full retry, dead-letter, and idempotency control.
  - **Supabase Database Webhooks (`pg_net` HTTP callbacks) are explicitly not used as the delivery mechanism.** They are fire-and-forget with no backpressure, no dead-letter queue, and no delivery ordering guarantees — insufficient for TCPA-compliant outreach and immutable audit requirements. They may be used for low-stakes internal notifications only (e.g., alerting the ops channel on a schema migration), never for the critical event pipeline.
- Response contract:
  - success: `{"data": ..., "meta": ...}`
  - error: `{"error": {"code": "...", "message": "...", "details": ...}}`
- Idempotency requirements:
  - Outreach scheduling and notification sends require idempotency keys.
- Retry behavior:
  - Bounded retries with escalating delay and dead-letter classification.

### Global Scheduler Design

- A single global scheduler service owns all recurring business schedules: ATS sync, inbox parsing, candidate refresh sweeps, daily digests, nightly FAA re-verification, recurring recalibration jobs, and recurring operational guardrail checks.
- Scheduler state is stored in Postgres, not process memory.
  - `schedule_definitions(schedule_id, tenant_id, schedule_type, target_ref, cadence_kind [interval|cron|fixed_local_time], cadence_value, timezone, next_run_at, last_run_at, paused_at, disabled_at, policy_version_id, created_by_actor_id, updated_by_actor_id, created_at, updated_at)`
  - `schedule_runs(run_id, schedule_id, tenant_id, scheduled_for, claimed_at, started_at, completed_at, status [claimed|completed|failed|skipped], emitted_outbox_event_id, worker_job_id, policy_version_id, error_code, error_summary)`
- The scheduler loop claims due rows using a DB-safe claim pattern (`FOR UPDATE SKIP LOCKED` or equivalent), writes the outbox event for the due job, records a `schedule_runs` row, and advances `next_run_at` in the same transaction.
- The scheduler never calls providers directly. It emits due work into the outbox/job system; downstream workers remain event-driven.
- **Cold-start resilience:** The scheduler runs **in-process** inside the Next.js server (via `setInterval`), not as an external cron. This eliminates the cold-start problem where external HTTP calls fail because the server is sleeping (Render free tier spins down after 15 minutes of inactivity). In-process execution means jobs call `.run()` directly — no HTTP round-trip, no wake-up probe needed. The scheduler loop starts on server boot and runs as long as the process is alive.

### Schedule Taxonomy

- Business schedule: a recurring product or operations cadence that users/admins reason about directly, such as ATS polling every 15 minutes, daily Teams digests, nightly FAA sweeps, or 4-hour refresh jobs. Business schedules are centrally owned by the global scheduler.
- Retry timer: an execution-local backoff created after a failed attempt, such as provider retry, `Retry-After`, or dead-letter delay. Retry timers stay inside worker/job handling and are not represented as user-managed schedules.
- Lock/cooldown: a domain-protection window such as candidate outreach cooldown or breaker cool-down. Locks/cooldowns are enforced from domain state and policy values at execution time; they do not create scheduler-owned recurring jobs.

### Schedule Change Path

1. Admin or authorized user changes cadence/state in the UI.
2. Backend API validates tenant scope, allowed cadence bounds, and policy compatibility.
3. The API writes versioned policy/schedule records to `policy_versions` and `schedule_definitions`.
4. The global scheduler picks up the new effective schedule definition.
5. When due, the scheduler emits outbox jobs with the effective `policy_version_id`.
6. Workers execute the emitted job and record the schedule run plus policy version in audit/tracing artifacts.

### Agentic Control Plane and Worker Model

This implementation uses a goal-driven multi-agent execution model, not just background jobs.

**Control-plane agents:**

- Orchestrator Agent:
  - Receives incoming objectives (for example, deliver 5 qualified candidates in 24 hours).
  - Selects the execution plan and worker sequence.
  - Resolves conflicts between worker outputs and chooses final action set.
  - Aggregates partial results into one decision package for recruiter-facing delivery.
- Goal Manager Agent:
  - Tracks active goals, sub-goals, deadlines, and completion criteria.
  - Monitors whether current worker execution is moving toward KPI targets.
  - Replans worker assignments when progress stalls or constraints change.
  - Enforces stop/retry/escalate policy for failed goal paths.
- Global Scheduler Service:
  - Owns recurring business cadence across tenants and connectors.
  - Claims due schedule definitions and emits outbox jobs with versioned schedule context.
  - Records run history, missed-run state, and pause/disable semantics for operations visibility.

**Execution workers (specialized agents):**

- Sourcing Worker: candidate discovery and enrichment through internal DB, Clay, and RapidAPI connectors.
- Matching Worker: scoring, rank generation, and explanation payloads.
- Outreach Worker: SMS/email campaign and ad hoc communication tasks.
- Scheduling Worker: Teams scheduling/task creation and recruiter action orchestration.
- Compliance Worker: consent checks, audit events, FAA/manual verification routing.
- Cost Guardrail Worker: threshold checks (`API`, `SMS`, KPI alerts) and budget-triggered recommendations.

**Learning and adaptation loop:**

- Reporting Agent:
  - Produces progress reports for each active goal (status, risk, blockers, confidence).
  - Feeds structured feedback signals back to Orchestrator and Goal Manager.
- Worker Coaching and Policy Tuning Agent:
  - Uses historical execution outcomes to tune routing rules, prompt templates, and thresholds.
  - Updates worker playbooks and run-time policies after approval gates.
  - Does not perform unsupervised model fine-tuning in MVP; learning is policy-level and auditable.

**Decision governance rules:**

- All agent decisions must be traceable via correlation ID and tenant ID.
- Orchestrator decisions are auditable and stored in append-only event history.
- High-impact actions (bulk changes, exports, compliance overrides) require human-in-the-loop confirmation.
- If worker outputs disagree, Orchestrator uses deterministic arbitration policy and logs rationale.
- Every goal has a hard `max_iterations` and `max_consecutive_failures` budget; breach triggers human-in-the-loop pause — see _Resilience §1_.
- Cold-start tenants (< 10 placements) operate in bootstrap mode with global anonymized baselines — see _Resilience §2_.
- Paused goals resume from serialized scratchpad checkpoint — no full re-run on worker restart — see _Resilience §9_.

### Agentic Architecture Diagram (Control Plane)

```mermaid
flowchart TB
  Goal[Business Goal Input]
  Orchestrator[Orchestrator Agent]
  GoalMgr[Goal Manager Agent]
  Reporter[Reporting Agent]
  Coach[Worker Coaching and Policy Tuning Agent]

  subgraph Workers[Specialist Worker Agents]
    S1[Sourcing Worker]
    S2[Matching Worker]
    S3[Outreach Worker]
    S4[Scheduling Worker]
    S5[Compliance Worker]
    S6[Cost Guardrail Worker]
  end

  Goal --> GoalMgr
  GoalMgr --> Orchestrator
  Orchestrator --> S1
  Orchestrator --> S2
  Orchestrator --> S3
  Orchestrator --> S4
  Orchestrator --> S5
  Orchestrator --> S6

  S1 --> Reporter
  S2 --> Reporter
  S3 --> Reporter
  S4 --> Reporter
  S5 --> Reporter
  S6 --> Reporter

  Reporter --> GoalMgr
  Reporter --> Orchestrator
  Reporter --> Coach
  Coach --> Orchestrator
  Coach --> GoalMgr
```

### Agentic Execution Sequence (Goal to Aggregated Result)

```mermaid
sequenceDiagram
  autonumber
  participant G as Goal Manager
  participant O as Orchestrator
  participant W1 as Sourcing Worker
  participant W2 as Matching Worker
  participant W3 as Outreach Worker
  participant R as Reporting Agent
  participant C as Coaching Agent

  G->>O: Open goal with KPI target and constraints
  O->>W1: Run sourcing/enrichment tasks
  W1-->>O: Candidate pool + quality metadata
  O->>W2: Run ranking and explanation generation
  W2-->>O: Ranked candidates + rationale
  O->>W3: Run outreach and scheduling actions
  W3-->>O: Delivery outcomes + response signals
  O->>R: Send aggregated execution package
  R-->>G: Progress report, risk flags, next-step advice
  R-->>C: Structured feedback from outcomes
  C-->>O: Updated routing/policy guidance
```

### Frontend Architecture

- Next.js App Router UI with feature-bounded folders.
- Core application surfaces:
  - Recruiter workspace (action stream, candidate cards, match reasons)
  - Candidate portal (job-scoped trust-first opt-in flow)
  - Delivery lead operations console
  - Admin and compliance console
- State strategy:
  - Server-driven data for most views
  - Client state only for transient workflow/UI state
- UX-critical architecture requirements:
  - Explicit rejection reasons and override traceability
  - Progressive disclosure for high-volume candidate sets
  - Accessibility baseline with WCAG 2.1 AA alignment

### Infrastructure and Deployment

- Baseline deployment:
  - Web/API runtime deployed on Render
  - Python worker services deployed on Render background workers
  - Data platform on Supabase Postgres (managed Postgres on Render is not used)
  - Separate staging and production environments
- CI/CD expectations:
  - Test gates including tenant isolation test suite
  - Migration checks and backward compatibility checks for schema changes
  - Security/static analysis checks on protected branches
- Observability:
  - Render-native metrics/logging and Supabase-native telemetry
  - Structured logs with correlation IDs, `trace_id`, `span_id`, and `parent_span_id`
  - Metrics for SLA, delivery latency, queue depth, and failure rates
  - Alerts for fallback triggers, compliance workflow failures, and budget thresholds
- Secrets and configuration:
  - Render environment secrets only for MVP

### Confirmed Integration System Matrix

| Capability              | Selected System                            | MVP Notes                                                                                                                              |
| ----------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| SMS (two-way)           | Telnyx                                     | Primary provider; Twilio warm standby supported for Day 2 failover, disabled by default at launch                                      |
| Voice calling           | Telnyx Voice                               | Dial + call recording + transcription                                                                                                  |
| Email campaigns         | Instantly                                  | Primary campaign provider; degraded fallback uses Graph for critical/manual messages if campaign provider is kill-switched             |
| Ad hoc recruiter email  | Microsoft Graph/Outlook                    | One-click recruiter email actions                                                                                                      |
| Teams collaboration     | Microsoft Teams                            | Notification cards, task creation, scheduling, recruiter communication                                                                 |
| Identity                | Microsoft Entra ID + magic links           | Internal SSO for staff, SMS/email magic links for candidates                                                                           |
| Candidate enrichment    | Internal DB, Clay, RapidAPI sources        | Provider-agnostic connector layer remains mandatory                                                                                    |
| FAA verification        | Official FAA public data + manual workflow | Automated third-party FAA API deferred                                                                                                 |
| Background checks       | Manual only                                | No background-check API integration in MVP                                                                                             |
| Job queue and retries   | Render background workers                  | Async processing and retry handling on worker services                                                                                 |
| Monitoring and alerting | Render + Supabase native                   | No external APM in MVP                                                                                                                 |
| Secrets management      | Render environment secrets                 | External vault deferred                                                                                                                |
| Audit immutability      | DB append-only + hash chain                | Tamper-evidence implemented in audit model                                                                                             |
| Document/file storage   | SharePoint folder                          | `https://cblsolution-my.sharepoint.com/:f:/g/personal/vivek_cblsolutions_com/IgDKIFYS0joSSbhgfpiY6XA_AbVtySkMKVQAIZwkiyZblTg?e=QTy2dU` |
| Analytics/BI            | In-app only                                | External BI warehouse/tools deferred                                                                                                   |

### C4 Container Diagram (MVP)

```mermaid
flowchart TB
  subgraph People
    Recruiter[Recruiter]
    Candidate[Candidate]
    Admin[Delivery Head/Admin]
  end

  subgraph CBL[CBLAero System]
    Web[Container: Web App\nNext.js on Render\nUI + API routes]
    Worker[Container: Worker Services\nPython on Render\nAsync jobs and integrations]
    Data[(Container: Supabase Postgres\nRLS + Audit Hash Chain)]
    Queue[Container: Outbox/Job Queue\nAsync orchestration]
  end

  subgraph Ext[External Systems]
    Entra[Microsoft Entra ID]
    Telnyx[Telnyx SMS/Voice]
    Instantly[Instantly Campaign Email]
    Graph[Microsoft Graph/Outlook]
    Teams[Microsoft Teams]
    Enrich[Internal DB + Clay + RapidAPI]
    FAA[FAA Public Data]
    SP[SharePoint Folder]
  end

  Recruiter --> Web
  Candidate --> Web
  Admin --> Web

  Web <--> Entra
  Web --> Data
  Web --> Queue
  Queue --> Worker
  Worker --> Data

  Worker --> Telnyx
  Worker --> Instantly
  Worker --> Graph
  Worker --> Teams
  Worker --> Enrich
  Worker --> FAA

  Web --> SP
```

### Sequence Diagram (Candidate Outreach to Recruiter Notification)

```mermaid
sequenceDiagram
  autonumber
  participant C as Candidate
  participant W as Web App (Render)
  participant DB as Supabase Postgres
  participant Q as Outbox/Queue
  participant PY as Python Worker (Render)
  participant T as Telnyx
  participant TM as Microsoft Teams
  participant R as Recruiter

  C->>W: Submit availability + consent
  W->>DB: Persist candidate update (tenant scoped)
  W->>Q: Enqueue scoring/outreach job
  Q->>PY: Dispatch async job
  PY->>DB: Load candidate + job requirement
  PY->>PY: Compute score + match reasons
  PY->>T: Send SMS follow-up (if eligible)
  T-->>PY: Delivery status callback
  PY->>DB: Store delivery/audit event (append-only)
  PY->>TM: Post Teams card with top candidate details
  TM-->>R: Notify recruiter with action card
  R->>W: Open candidate profile from Teams
  W->>DB: Read profile + audit trail (RLS enforced)
  W-->>R: Show profile, match reasons, and next actions
```

### Sequence: Candidate Magic-Link Authentication

```mermaid
sequenceDiagram
  autonumber
  participant C as Candidate
  participant W as Web App
  participant DB as Supabase Postgres
  participant T as Telnyx

  C->>W: Request access for job (job-scoped entry point)
  W->>DB: Create one-time token (short TTL, job-scoped, single-use)
  W->>T: Send magic link via SMS or email
  T-->>C: Deliver magic link message
  C->>W: Click link with token
  W->>DB: Validate token (expiry check, already-used check)
  DB-->>W: Token valid
  W->>DB: Mark token consumed (replay protection)
  W->>DB: Create candidate session (job-scoped, time-bounded)
  W-->>C: Authenticated — show consent + availability flow
```

### Sequence: Internal Recruiter SSO Login (Entra ID)

```mermaid
sequenceDiagram
  autonumber
  participant R as Recruiter
  participant W as Web App
  participant E as Microsoft Entra ID

  R->>W: Navigate to login
  W-->>R: Redirect to Entra ID login
  R->>E: Authenticate with @cblsolutions.com credentials
  E-->>R: Return auth code
  R->>W: Submit auth code
  W->>E: Exchange code for ID + access tokens
  E-->>W: Tokens (role claims included)
  W->>W: Validate claims, extract tenant + role
  W->>DB: Log login event (append-only audit)
  W-->>R: Authenticated recruiter session
```

### Sequence: Job Intake to Ranked Candidate Delivery

```mermaid
sequenceDiagram
  autonumber
  participant R as Recruiter
  participant W as Web App
  participant DB as Supabase Postgres
  participant Q as Outbox/Queue
  participant PY as Python Worker
  participant ENR as Enrichment (Clay / RapidAPI)
  participant TM as Microsoft Teams

  R->>W: Submit job intake form
  W->>DB: Save job requirement (tenant-scoped)
  W->>Q: Enqueue scoring/sourcing job
  Q->>PY: Dispatch scoring job
  PY->>DB: Load candidate pool + job criteria
  PY->>ENR: Enrich shortlisted candidates
  ENR-->>PY: Enriched profiles (skills, recency, cert status)
  PY->>PY: Compute match score + generate explanation payload
  PY->>DB: Store ranked candidates + match reasons (append-only)
  PY->>TM: Post ranked candidate card to recruiter channel
  TM-->>R: Deliver ranked list with action cards
```

### Sequence: Recruiter Teams Action to Candidate Outreach

```mermaid
sequenceDiagram
  autonumber
  participant R as Recruiter
  participant TM as Microsoft Teams
  participant W as Web App
  participant DB as Supabase Postgres
  participant Q as Outbox/Queue
  participant PY as Python Worker
  participant T as Telnyx SMS
  participant C as Candidate

  R->>TM: Click "Reach Out" on candidate card
  TM->>W: POST action callback with candidate_id + job_id
  W->>DB: Verify consent record and opt-in status
  W->>Q: Enqueue outreach job (idempotency key set)
  Q->>PY: Dispatch outreach task
  PY->>DB: Load message template + candidate contact details
  PY->>T: Send personalized SMS to candidate
  T-->>PY: ACK + message SID
  PY->>DB: Store delivery event (append-only audit)
  T-->>PY: Delivery status callback (delivered / failed)
  PY->>DB: Update outreach status
  PY->>TM: Update card status (sent / delivered)
  TM-->>R: Show delivery confirmation
  T-->>C: Receive SMS
```

### Sequence: Two-Way SMS Conversation

```mermaid
sequenceDiagram
  autonumber
  participant C as Candidate
  participant T as Telnyx
  participant PY as Python Worker
  participant DB as Supabase Postgres
  participant TM as Microsoft Teams
  participant R as Recruiter

  C->>T: Reply to outreach SMS
  T->>PY: Inbound webhook (from, body, message_id)
  PY->>DB: Match to candidate + active outreach thread
  PY->>DB: Store inbound message (append-only)
  PY->>PY: Parse intent (availability confirm / question / opt-out)
  alt Opt-out detected
    PY->>DB: Record consent revocation
    PY->>T: Send opt-out confirmation SMS
    PY->>TM: Notify recruiter of opt-out
  else Positive availability signal
    PY->>DB: Update candidate availability signal
    PY->>TM: Post reply alert card to recruiter channel
    TM-->>R: Show candidate response with action options
  end
```

### Sequence: Instantly Campaign Email Flow

```mermaid
sequenceDiagram
  autonumber
  participant PY as Python Worker
  participant I as Instantly API
  participant C as Candidate (email)
  participant DB as Supabase Postgres
  participant TM as Microsoft Teams

  PY->>DB: Load campaign batch + consent-verified recipients
  PY->>I: Create campaign and upload recipient sequence
  I-->>PY: Campaign ID confirmed
  PY->>I: Launch campaign send
  I->>C: Deliver email sequence
  C-->>I: Open / click / reply event
  I->>PY: Webhook: delivery event (open, click, reply, bounce)
  PY->>DB: Store delivery event (append-only, tenant-scoped)
  PY->>PY: Evaluate response signals
  alt Positive engagement
    PY->>DB: Update candidate engagement score
    PY->>TM: Alert recruiter with engagement summary
  else Bounce or hard failure
    PY->>DB: Flag address, halt sequence for candidate
  end
```

### Sequence: Enrichment Pipeline Execution

```mermaid
sequenceDiagram
  autonumber
  participant PY as Sourcing Worker
  participant DB as Supabase Postgres
  participant INT as Internal DB
  participant CLAY as Clay API
  participant RAPID as RapidAPI Source
  participant Q as Outbox/Queue

  PY->>DB: Load candidate stubs requiring enrichment
  PY->>INT: Lookup by email/phone in internal database
  INT-->>PY: Match data (prior roles, contact history)
  PY->>CLAY: Enrich with professional profile data
  CLAY-->>PY: Skills, current employer, social signals
  PY->>RAPID: Fetch aviation cert / license lookups
  RAPID-->>PY: Certification records
  PY->>PY: Merge, deduplicate, score completeness
  PY->>DB: Upsert enriched candidate profile (versioned)
  PY->>Q: Emit enrichment.complete event (triggers scoring)
```

### Sequence: Bulk CSV Candidate Import (Recruiter Upload)

```mermaid
sequenceDiagram
  autonumber
  participant R as Recruiter
  participant W as Web App
  participant DB as Supabase Postgres
  participant Q as Outbox/Queue
  participant PY as Import Worker
  participant ENR as Enrichment Worker

  R->>W: Upload CSV (up to 10,000 rows)
  W->>W: Column mapping wizard + live validation preview
  W->>DB: Create import_batch record (status: validating)
  W-->>R: Show validation preview (errors highlighted)
  R->>W: Confirm import
  W->>Q: Enqueue import_batch job
  Q->>PY: Dispatch import worker
  loop Per chunk of 1,000 rows
    PY->>DB: Upsert candidates (pending_dedup state)
    PY->>DB: Write per-row errors to import_row_error
    PY->>DB: Update import_batch progress counter
  end
  PY->>DB: Mark import_batch complete (imported/skipped/errors)
  PY->>Q: Emit deduplication job for batch
  PY->>Q: Emit enrichment job for new records
  ENR->>DB: Process enrichment (rate-limited overnight batch)
  W-->>R: Import complete — downloadable error report available
```

### Sequence: PDF Resume Upload (Recruiter)

```mermaid
sequenceDiagram
  autonumber
  participant R as Recruiter
  participant W as Web App
  participant S as Supabase Storage
  participant DB as Supabase Postgres
  participant LLM as LLM Parser

  R->>W: Upload PDF(s) (single file or folder, unlimited)
  W->>W: Validate all files are .pdf
  W->>DB: Create import_batch (source: resume_upload, status: processing)
  loop Per PDF file (batched internally, 50 at a time)
    W->>S: Store PDF in candidate-attachments bucket
    W->>LLM: Extract candidate data from PDF
    LLM-->>W: Structured candidate fields (JSON)
    W->>DB: Write candidate_submissions row (raw file URL + extraction JSON)
  end
  W-->>R: Present extracted candidates for review
  R->>W: Confirm/edit/reject each candidate
  loop Per confirmed candidate
    W->>DB: Upsert candidate (pending_enrichment state, source: resume_upload)
  end
  W->>DB: Mark import_batch complete (imported/skipped/errors)
  W-->>R: Upload complete — summary with per-file status
```

### Sequence: ATS Connector Sync (Automated, Tier 2)

```mermaid
sequenceDiagram
  autonumber
  participant SCH as Scheduler (15-min interval)
  participant PY as ATS Sync Worker
  participant ATS as ATS System (read-only API)
  participant DB as Supabase Postgres
  participant Q as Outbox/Queue
  participant ADM as Admin Console

  SCH->>PY: Trigger scheduled sync for connector
  PY->>DB: Read last_sync_cursor for this connector
  PY->>ATS: Fetch records updated since cursor (paginated)
  ATS-->>PY: Updated candidate records (batch)
  loop Per record
    PY->>DB: Check dedup (match by email/phone)
    alt New record
      PY->>DB: Insert candidate (source: ats_sync, state: pending_enrichment)
    else Existing record — merge update
      PY->>DB: Upsert changed fields with source attribution
    end
  end
  PY->>DB: Update last_sync_cursor
  PY->>DB: Write import_batch summary (synced/skipped/errored)
  alt Error rate > threshold
    PY->>ADM: Alert admin (sync health degraded)
  end
  PY->>Q: Emit enrichment jobs for new/updated records
```

### Sequence: Email Inbox Parsing to Candidate Stub (Tier 2)

```mermaid
sequenceDiagram
  autonumber
  participant SCH as Scheduler
  participant PY as Email Parse Worker
  participant G as Microsoft Graph (Recruiter Inbox)
  participant DB as Supabase Postgres
  participant W as Web App
  participant R as Recruiter

  SCH->>PY: Trigger inbox scan (cron or scheduler)
  PY->>G: Fetch unread messages ($filter=isRead eq false)
  G-->>PY: Unread email list (up to 500)
  loop Per message (stream — one at a time)
    PY->>PY: Check fingerprint gate (skip if already processed)
    PY->>PY: LLM classify (submission vs non-submission)
    alt Non-submission
      PY->>G: Mark as read (PATCH isRead: true)
    else Submission
      PY->>G: Fetch all attachments (no type filter)
      PY->>DB: Upsert candidate (.upsert onConflict tenant_id,email)
      PY->>DB: Store submission evidence + upload attachments to Storage
      PY->>DB: Record fingerprint (email_message_id)
      PY->>G: Mark as read (PATCH isRead: true)
    end
    alt Processing failure
      PY->>PY: Email stays unread for retry on next run
      PY->>DB: Record sync error + failed fingerprint
    end
  end
  PY->>PY: Log summary (processed, skipped, failed)
```

### Sequence: Manual FAA Verification Workflow

```mermaid
sequenceDiagram
  autonumber
  participant PY as Compliance Worker
  participant FAA as FAA Public Data
  participant DB as Supabase Postgres
  participant W as Web App
  participant OPS as Ops / Manual Reviewer
  participant TM as Microsoft Teams

  PY->>FAA: Query candidate by name / cert number
  FAA-->>PY: Certificate status data
  PY->>PY: Auto-match: compare FAA record to candidate profile
  alt Confident automated match
    PY->>DB: Record FAA verification (auto, with evidence)
    PY->>DB: Emit compliance.verification.completed event
  else Low-confidence or conflict
    PY->>DB: Flag candidate for manual review
    PY->>TM: Notify ops team with discrepancy details
    TM-->>OPS: Manual review task created
    OPS->>W: Review candidate + FAA evidence side-by-side
    OPS->>W: Submit manual verdict (verified / rejected / pending)
    W->>DB: Record manual FAA verification with reviewer ID
  end
```

### Sequence: GDPR / CCPA Data Erasure Request

```mermaid
sequenceDiagram
  autonumber
  participant C as Candidate
  participant W as Web App
  participant DB as Supabase Postgres
  participant Q as Outbox/Queue
  participant PY as Compliance Worker
  participant SP as SharePoint
  participant TM as Microsoft Teams

  C->>W: Submit data erasure request
  W->>DB: Create erasure request record (check for legal hold)
  W-->>C: Confirm receipt (72-hour SLA)
  W->>Q: Enqueue erasure workflow
  Q->>PY: Dispatch erasure job
  PY->>DB: Check for active legal hold on candidate data
  alt Legal hold active
    PY->>DB: Record hold conflict, defer erasure
    PY->>TM: Alert compliance admin with hold details
  else No hold
    PY->>DB: Soft-delete PII fields (name, phone, email, address)
    PY->>DB: Retain anonymized audit skeleton (regulatory minimum)
    PY->>DB: Revoke all active magic-link tokens
    PY->>SP: Delete candidate documents from SharePoint folder
    PY->>DB: Emit compliance.erasure.completed event (append-only)
    W-->>C: Deletion confirmation
  end
```

### Sequence: Step-Up Auth for High-Risk Action

```mermaid
sequenceDiagram
  autonumber
  participant R as Recruiter / Admin
  participant W as Web App
  participant E as Microsoft Entra ID
  participant DB as Supabase Postgres

  R->>W: Trigger high-risk action (bulk export / role change / compliance override)
  W->>W: Detect action requires elevated scope (policy check)
  W-->>R: Prompt step-up authentication
  R->>E: Complete MFA challenge
  E-->>W: Step-up token with elevated scope
  W->>W: Validate token scope matches action requirement
  W->>DB: Log step-up auth event (actor, action, timestamp, tenant)
  W->>W: Execute action under elevated scope
  W->>DB: Append immutable audit event (action outcome + actor)
  W-->>R: Action complete with audit trace ID
```

### Sequence: Cost Guardrail Trigger and Replan

```mermaid
sequenceDiagram
  autonumber
  participant W as Cost Guardrail Worker
  participant DB as Supabase Postgres
  participant O as Orchestrator Agent
  participant G as Goal Manager Agent
  participant TM as Microsoft Teams
  participant R as Delivery Lead

  W->>DB: Read real-time spend counters (API, SMS)
  W->>W: Compare against thresholds ($1,000/month API · $200/placement SMS)
  alt Threshold breached
    W->>O: Emit budget.threshold.exceeded event
    O->>G: Request goal replan with cost constraint
    G->>G: Identify lower-cost outreach alternatives
    G->>O: Updated execution plan (reduce SMS volume, shift to email)
    O->>DB: Pause pending high-cost outreach tasks
    O->>TM: Alert delivery lead with spend summary + revised plan
    TM-->>R: Show budget alert and plan adjustment
    R->>W: Approve or override revised plan
  end
```

### Budget and KPI Alert Baselines

- API spend alert threshold: $1,000/month
- SMS cost alert threshold: $200/placement
- KPI breach alert threshold: conversion rate <5%

### Architecture Standards and Governance

**Standards we follow for implementation:**

- C4 model for architecture views and boundary documentation (Context, Container, Component).
- Domain-oriented module boundaries (bounded-context style) aligned to FR domains.
- Twelve-Factor app principles for config, stateless runtime, and environment parity.
- OWASP ASVS L2 and OWASP API Security Top 10 as baseline application/API security standard.
- Zero-trust access posture for internal services and operational tools.

**Vector and RAG implementation standard:**

- RAG is introduced as a controlled capability and must be tenant-safe by design.
- Vector storage standard: `pgvector` in Supabase Postgres under isolated schema.
- Retrieval must enforce tenant filter + role filter before semantic ranking.
- Prompt input pipeline must include prompt-injection detection and policy filtering.
- PII and sensitive compliance data are excluded from embeddings unless explicitly approved.

**MCP-based access control standard:**

- MCP usage must be brokered through a server-side policy gateway.
- Tool access is allowlisted per role and per environment.
- Every MCP tool invocation must include actor, tenant, scope, and trace ID.
- High-risk MCP operations (export, bulk update, credentialed actions) require step-up auth and audit trail.

**Strict Supabase access from Python standard:**

- Python workers access Supabase only from trusted backend runtime on Render.
- Service-role key is never exposed to browser/client code.
- Candidate-facing and recruiter-facing app paths use RLS-protected tokens; service role bypass is backend-only.
- Separate key scopes by environment (`dev`, `staging`, `prod`) with rotation policy.
- Use least-privilege SQL roles for worker jobs where possible; avoid broad superuser privileges.
- All Python DB calls must use TLS and connection settings enforcing certificate verification.
- Administrative SQL operations are restricted to migration pipeline and audited maintenance workflows.

**SSL/TLS implementation standard:**

- External traffic: HTTPS only with TLS 1.2+ (TLS 1.3 preferred) at edge.
- Enforce HTTP->HTTPS redirects and HSTS for authenticated application surfaces.
- Service-to-database traffic: TLS required (`sslmode=require` minimum, `verify-full` where supported).
- Certificates are managed by platform-managed TLS endpoints (Render and Supabase) with automatic renewal.
- No plaintext credentials or connection strings in source control; all secrets via Render environment secrets.

**Related ADRs:**

- `docs/planning_artifacts/adr/README.md`
- `docs/planning_artifacts/adr/0001-security-baseline-and-zero-trust.md`
- `docs/planning_artifacts/adr/0002-rag-and-vector-governance.md`
- `docs/planning_artifacts/adr/0003-mcp-tool-access-control.md`
- `docs/planning_artifacts/adr/0004-supabase-access-for-python-workers.md`
- `docs/planning_artifacts/adr/0005-transport-and-tls-standards.md`

## Development Standards Reference

All stories must follow the coding standards and best practices documented in [development-standards.md](development-standards.md). Key areas: external API retry/backoff patterns, LLM integration safety, data ingestion dedup, Supabase error handling, token caching, and evidence preservation. Code reviews should verify compliance.

## Implemented Capabilities Registry

_Dev agents: read this section BEFORE implementing any story. If a capability exists, reuse or extend it — never recreate. After implementing a new reusable capability, add it here._

### HTTP & External APIs
| Capability | Location | When to Use |
|-----------|----------|-------------|
| `fetchWithRetry(url, init, opts)` | `src/modules/ingestion/fetch-with-retry.ts` | ALL external HTTP calls (Ceipal, Graph, OneDrive, Azure AD). 3 retries, exponential backoff, handles 429/5xx/network errors. |
| `acquireGraphToken()` | `src/modules/email/graph-auth.ts` | Microsoft Graph API calls (email, OneDrive, calendar). Caches token with 60s buffer. |
| `acquireCeipalToken()` | `src/modules/ats/ceipal.ts` (internal) | Ceipal API calls. Caches token with 5min buffer. Called internally by `fetchCeipalApplicants`. |

### AI Inference Service
| Capability | Location | When to Use |
|-----------|----------|-------------|
| `getSharedAnthropicClient()` | `src/modules/ai/client.ts` | Shared Anthropic SDK singleton. Returns null if no API key. ALL LLM usage must go through this — never `new Anthropic()` directly. |
| `callLlm(model, systemPrompt, userContent, opts)` | `src/modules/ai/inference.ts` | Centralized LLM call wrapper with token counting, cost estimation, structured logging, anomaly detection, and usage persistence. Accepts `string` or `ContentBlockParam[]` (multimodal — document/image blocks for vision OCR). Returns `{ text, inputTokens, outputTokens, estimatedCostUsd, durationMs, model }`. |
| `recordLlmUsage(entry)` | `src/modules/ai/usage-log.ts` | Persist per-call token counts and estimated cost to `llm_usage_log` table. Called automatically by `callLlm()` (fire-and-forget). |
| `loadPrompt(name, version?)` | `src/modules/ai/prompt-registry.ts` | Load prompt from `prompt_registry` table (DB-first, in-memory fallback). Returns `{ name, version, prompt_text, model }`. |
| `registerFallbackPrompt(record)` | `src/modules/ai/prompt-registry.ts` | Register inline fallback prompt for when DB is unavailable (tests, no Supabase). |
| `clearClientForTest()` | `src/modules/ai/client.ts` | Reset Anthropic singleton for test isolation. |
| `getAggregatedUsage(params)` | `src/modules/ai/usage-repository.ts` | Aggregate `llm_usage_log` by day/model/promptName with filtering. Returns `{ daily, totals }`. Used by AI cost dashboard API. |
| `checkBudgetThreshold(thresholdUsd?)` | `src/modules/ai/budget-alert.ts` | Check if today's AI spend exceeds threshold (default $10/day). Emits structured warn log if exceeded. |
| `deprecatePrompt(name, version)` | `src/modules/ai/prompt-registry.ts` | Mark a prompt version as deprecated (append-only). `loadPrompt()` stops returning deprecated versions. |
| `updatePromptStatus(name, version, status)` | `src/modules/ai/prompt-registry.ts` | Update prompt status to active/staged/deprecated. Used for staged rollout lifecycle. |
| `listPromptVersions(name)` | `src/modules/ai/prompt-registry.ts` | List all versions of a prompt (including deprecated) sorted by created_at desc. |

### CSV Parsing & Field Inference
| Capability | Location | When to Use |
|-----------|----------|-------------|
| `parseCsv(text)` | `src/modules/csv/index.ts` | Parse CSV text into headers + rows. Handles quoted fields, embedded newlines, BOM, CRLF/CR/LF. Used by recruiter CSV upload route and wizard. |
| `splitCsvRows(text)` | `src/modules/csv/index.ts` | Split CSV text into logical rows respecting quoted fields with embedded newlines. Called by `parseCsv`. |
| `parseCsvLine(line)` | `src/modules/csv/index.ts` | Parse a single CSV row into cells. Handles RFC 4180 double-quote escaping. Called by `parseCsv`. |
| `inferFieldForHeader(header)` | `src/modules/csv/index.ts` | Auto-map a CSV header to a canonical candidate field via `FIELD_ALIASES`. Returns `"(ignore)"` if no match. |
| `normalizeHeaderKey(value)` | `src/modules/csv/index.ts` | Normalize header to lowercase snake_case for alias lookup and extra_attributes keys. |
| `FIELD_ALIASES` | `src/modules/csv/index.ts` | Lookup table mapping 40+ common header variations to canonical candidate fields. |
| `CANONICAL_FIELDS` | `src/modules/csv/index.ts` | Set of all valid canonical field names including `"(ignore)"`. |

### Candidate Data Pipeline
| Capability | Location | When to Use |
|-----------|----------|-------------|
| `extractCandidateFromDocument(input, type, opts)` | `src/features/candidate-management/application/candidate-extraction.ts` | LLM extraction from any document type (email, PDF, DOCX). Uses `callLlm()` from `modules/ai/`. Haiku 4.5, 10K char limit. Scanned-image PDFs automatically fall back to Claude vision OCR (`extractionMethod: 'ocr+llm'`). |
| `extractCandidateFromEmail(body, subject)` | `src/modules/email/nlp-extract-and-upload.ts` | Thin wrapper for email-specific extraction. Delegates to `extractCandidateFromDocument`. |
| `mapToCandidateRow(record, source, overrides?)` | `src/modules/ingestion/index.ts` | Maps any extracted candidate data to `candidates` table columns. Handles all 30+ fields. |
| `mapCeipalApplicantToCandidate(applicant)` | `src/modules/ats/ceipal.ts` | Maps Ceipal API response to ingestion candidate shape. |
| `uploadFileToStorage(buffer, filename, storagePath)` | `src/features/candidate-management/infrastructure/storage.ts` | **Single shared function** for ALL Supabase Storage uploads. Used by resume uploads, OneDrive poller, and email attachments. Never use `db.storage.upload()` directly. |
| `uploadAttachmentToStorage(db, buffer, filename, candidateId, submissionId)` | `src/modules/email/nlp-extract-and-upload.ts` | Email attachment wrapper — delegates to `uploadFileToStorage`. |

### Database Operations (RPCs & Repositories)
| Capability | Location | When to Use |
|-----------|----------|-------------|
| `search_candidates` RPC | `supabase/schema.sql` | Filtered, paginated candidate search with trigram indexes. Called by `listCandidates()`. |
| `get_candidate_detail` RPC | `supabase/schema.sql` | Single candidate with all columns. Called by `getCandidateById()`. |
| `upsert_candidate` RPC | `supabase/schema.sql` | Atomic candidate upsert with email dedup. Called by `upsertCandidateByEmail()` and `insertCandidateNoEmail()`. |
| `upsert_candidate_batch` RPC | `supabase/schema.sql` | Batch candidate upsert (max 500). Called by `batchUpsertCandidatesByEmail()` and `batchInsertCandidatesNoEmail()`. |
| `process_import_chunk` RPC | `supabase/schema.sql` | Batch candidate upsert with per-row error tracking. Handles `resume_url` for PDF uploads. Used by CSV upload, resume upload, OneDrive poller. |
| `rollback_import_batch` RPC | `supabase/schema.sql` | Delete all candidates from a batch. Called by `deleteImportBatchCandidates()`. |
| `check_and_record_fingerprint` RPC | `supabase/schema.sql` | Atomic check+upsert fingerprint with dedup. Called by `recordFingerprint()`. |
| `upsert_fingerprint_batch` RPC | `supabase/schema.sql` | Batch fingerprint upsert with ON CONFLICT dedup (max 500). Called by `recordFingerprintBatch()`. |
| `load_recent_fingerprints` RPC | `supabase/schema.sql` | Batch pre-load fingerprint hashes into Set. Called by `loadRecentFingerprints()`. |
| `find_candidate_ids_by_emails` RPC | `supabase/schema.sql` | Batch email→candidateId lookup. Called by `findCandidateIdsByEmails()`. |
| `count_candidates_by_source` RPC | `supabase/schema.sql` | Count candidates by source. Called by `countCandidatesBySource()`. |
| `get_last_candidate_update_by_source` RPC | `supabase/schema.sql` | Latest updated_at for a source. Called by `getLastCandidateUpdateBySource()`. |
| `cleanup_audit_logs` RPC | `supabase/schema.sql` | Purge audit records older than retention period. |
| `listCandidates(tenantId, params)` | `src/features/candidate-management/infrastructure/candidate-repository.ts` | Filtered, paginated candidate list with cursor-based pagination. Supports 15+ filters. Uses `search_candidates` RPC. |
| `getCandidateById(tenantId, candidateId)` | `src/features/candidate-management/infrastructure/candidate-repository.ts` | Single candidate detail with all columns. Uses `get_candidate_detail` RPC. |
| `upsertCandidateByEmail(candidateRow)` | `src/features/candidate-management/infrastructure/candidate-repository.ts` | Single-roundtrip candidate upsert by email conflict. Returns candidate ID. All ingestion paths must use this. |
| `insertCandidateNoEmail(candidateRow)` | `src/features/candidate-management/infrastructure/candidate-repository.ts` | Insert candidate without email (no dedup). Returns candidate ID. |
| `batchUpsertCandidatesByEmail(rows)` | `src/features/candidate-management/infrastructure/candidate-repository.ts` | Batch upsert with email conflict key. Used by ATS/Ceipal bulk ingestion. |
| `batchInsertCandidatesNoEmail(rows)` | `src/features/candidate-management/infrastructure/candidate-repository.ts` | Batch insert for candidates without email. |
| `batchUpsertCandidatesFromATS(records)` | `src/modules/ingestion/index.ts` | Orchestrates batch upsert via repository functions with email dedup + fallback to individual inserts on conflict. |
| `upsertCandidateFromEmailFull(record)` | `src/modules/ingestion/index.ts` | Single email submission: dedup check first, then repository upsert + submission evidence + attachment upload. Returns `'dedup_skip'` if already processed. |
| `recordSyncFailure(source, recordId, err, runId?)` | `src/features/candidate-management/infrastructure/sync-error-repository.ts` | Log sync errors to Supabase `sync_errors` table with in-memory fallback. Optional `runId` links error to parent sync run. Re-exported from `ingestion/index.ts`. |
| `listRecentSyncErrors()` | `src/features/candidate-management/infrastructure/sync-error-repository.ts` | Fetch recent sync errors for admin dashboard. |
| `createSyncRun(source)` | `src/features/candidate-management/infrastructure/sync-error-repository.ts` | Create sync run row at job start. Returns id or null on failure (never throws). |
| `completeSyncRun(runId, counts)` | `src/features/candidate-management/infrastructure/sync-error-repository.ts` | Mark sync run complete with succeeded/failed/total counts. No-op on null runId. |
| `failSyncRun(runId, errorMessage)` | `src/features/candidate-management/infrastructure/sync-error-repository.ts` | Mark sync run failed with error message/stack trace. No-op on null runId. |
| `listSyncRunsCurrentMonth()` | `src/features/candidate-management/infrastructure/sync-error-repository.ts` | List sync runs for current UTC month, ordered by started_at desc. |
| `listSyncErrorsByRun(runId)` | `src/features/candidate-management/infrastructure/sync-error-repository.ts` | List all sync errors linked to a specific run. |
| `getMarkerValue(source, recordId)` | `src/features/candidate-management/infrastructure/sync-error-repository.ts` | Read KV marker from sync_errors table (e.g., Ceipal resume page). |
| `setMarkerValue(source, recordId, value)` | `src/features/candidate-management/infrastructure/sync-error-repository.ts` | Write KV marker to sync_errors table. |
| `createImportBatch(params)` | `src/features/candidate-management/infrastructure/import-batch-repository.ts` | Create new import batch (CSV, resume, email). Returns id + startedAt. Dual persistence. |
| `getImportBatchById(batchId, tenantId)` | `src/features/candidate-management/infrastructure/import-batch-repository.ts` | Fetch single import batch by id with tenant isolation. |
| `updateImportBatch(batchId, updates)` | `src/features/candidate-management/infrastructure/import-batch-repository.ts` | Update batch status, counts, completedAt. |
| `listImportBatchesByTenant(tenantId, page, pageSize)` | `src/features/candidate-management/infrastructure/import-batch-repository.ts` | Paginated import batch list for admin dashboard. |
| `getLatestMigrationBatch(tenantId)` | `src/features/candidate-management/infrastructure/import-batch-repository.ts` | Fetch most recent migration-source batch for admin MigrationStatusCard. |
| `processImportChunk(params)` | `src/features/candidate-management/infrastructure/import-batch-repository.ts` | Wrapper for `process_import_chunk` RPC. Routes must use this instead of calling RPC directly. |
| `listImportRowErrors(batchId, limit)` | `src/features/candidate-management/infrastructure/import-batch-repository.ts` | Fetch import row errors for batch detail and error reports. |
| `insertSubmission(params)` | `src/features/candidate-management/infrastructure/submission-repository.ts` | Insert candidate submission evidence. Used by resume upload, email ingestion. |
| `findSubmissionByMessageId(messageId, tenantId)` | `src/features/candidate-management/infrastructure/submission-repository.ts` | Dedup check for email submissions. Returns existing submission or null. |
| `listSubmissionsByBatch(batchId, tenantId)` | `src/features/candidate-management/infrastructure/submission-repository.ts` | List all submissions for a batch. Used by resume upload status. |
| `countFailedSubmissions(batchId, tenantId)` | `src/features/candidate-management/infrastructure/submission-repository.ts` | Count submissions with null extracted_data. Used for error tallying. |
| `findCandidateIdsByEmails(emails, tenantId)` | `src/features/candidate-management/infrastructure/candidate-repository.ts` | Batch email→candidateId lookup for submission linking. |
| `countCandidatesBySource(source)` | `src/features/candidate-management/infrastructure/candidate-repository.ts` | Count candidates by source. Used for Ceipal sync resume page. |
| `getLastCandidateUpdateBySource(source)` | `src/features/candidate-management/infrastructure/candidate-repository.ts` | Get latest updated_at for source. Used for Ceipal daily sync since date. |
| `recordFingerprintBatch(items)` | `src/features/candidate-management/infrastructure/fingerprint-repository.ts` | Batch-upsert content fingerprints in a single DB call. Use for CSV/resume uploads instead of per-row `recordFingerprint`. |
| `resolveRequestTenantId(session, request)` | `src/app/api/internal/recruiter/csv-upload/shared.ts` | Safely resolve tenant ID from `x-active-client-id` header, validating against session's clientIds allowlist. Use in route handlers instead of reading the header directly. |
| `computeFileHash(content)` | `src/features/candidate-management/infrastructure/fingerprint-repository.ts` | SHA-256 hex digest of file bytes. Used before LLM extraction for PDF/resume dedup. |
| `computeRowHash(email, first, last, phone)` | `src/features/candidate-management/infrastructure/fingerprint-repository.ts` | SHA-256 of normalized candidate identity fields. Used for CSV row dedup. |
| `computeIdentityHash(email, first, last, phone)` | `src/features/candidate-management/infrastructure/fingerprint-repository.ts` | SHA-256 with email-preferred fallback to name+phone. Used for candidate identity dedup. |
| `isAlreadyProcessed(tenantId, type, hash)` | `src/features/candidate-management/infrastructure/fingerprint-repository.ts` | Check if content fingerprint exists with status=processed. Mandatory gate before expensive processing. |
| `recordFingerprint(params)` | `src/features/candidate-management/infrastructure/fingerprint-repository.ts` | Upsert fingerprint after processing. Supports processed/failed status. |
| `loadRecentFingerprints(tenantId, type, days?)` | `src/features/candidate-management/infrastructure/fingerprint-repository.ts` | Batch pre-load fingerprints into Set for CSV/ATS batch paths. Default 30-day window. Email sync uses 3650 days (emails persist in inbox). |

### Dedup & Merge (Story 2.5)
| Capability | Location | When to Use |
|-----------|----------|-------------|
| `computeIdentityConfidence(a, b)` | `src/features/candidate-management/application/dedup-scoring.ts` | Deterministic confidence scoring (98/95/85/70/50/0%). Compares email, phone, name. Phone normalization matches `computeIdentityHash` (digits-only, no leading-1 strip). |
| `routeDedupDecision(score)` | `src/features/candidate-management/application/dedup-scoring.ts` | Routes score to `auto_merge` (>=95), `manual_review` (70-94), or `keep_separate` (<70). |
| `selectWinner(a, b)` | `src/features/candidate-management/application/dedup-merge.ts` | Winner selection: prefer active > more fields > most recent. Returns `{ winner, loser }`. |
| `computeMergedFields(winner, loser)` | `src/features/candidate-management/application/dedup-merge.ts` | Computes merged JSONB for `merge_candidates` RPC. JSON array union for skills/certs. Preserves email aliases, merged sources, additional resumes. |
| `computeFieldDiffs(a, b)` | `src/features/candidate-management/application/dedup-merge.ts` | Computes field-level diffs for review queue UI side-by-side display. |
| `findIdentityMatches(tenantId, hash, excludeId?)` | `src/features/candidate-management/infrastructure/dedup-repository.ts` | Pass 1: Query `content_fingerprints` for `candidate_identity` hash matches. |
| `findRawFieldMatches(tenantId, phone, first, last, excludeId?)` | `src/features/candidate-management/infrastructure/dedup-repository.ts` | Pass 2: Calls `find_dedup_field_matches` RPC for server-side phone normalization + name matching. Searches `active` + `pending_review` candidates. |
| `loadCandidateForDedup(tenantId, candidateId)` | `src/features/candidate-management/infrastructure/dedup-repository.ts` | Load candidate with all fields needed for scoring/merge (includes `resume_url`, `aircraft_experience`). |
| `listPendingDedupCandidates(tenantId, limit?)` | `src/features/candidate-management/infrastructure/dedup-repository.ts` | Query candidates in `pending_dedup` state for worker processing. |
| `callMergeCandidatesRpc(winnerId, loserId, fields, decision)` | `src/features/candidate-management/infrastructure/dedup-repository.ts` | Wrapper for `merge_candidates` RPC. Atomic: NULL loser email/phone → update winner → migrate refs → audit. |
| `createReviewItem(tenantId, aId, bId, score, diffs)` | `src/features/candidate-management/infrastructure/dedup-repository.ts` | Insert into `dedup_review_queue` for manual review. |
| `recordDedupDecision(params)` | `src/features/candidate-management/infrastructure/dedup-repository.ts` | Insert into `dedup_decisions` audit table. |
| `listPendingReviews(tenantId, limit?, offset?)` | `src/features/candidate-management/infrastructure/dedup-repository.ts` | Paginated list of pending review queue items. |
| `resolveReview(reviewId, tenantId, decision, actorId)` | `src/features/candidate-management/infrastructure/dedup-repository.ts` | Update review queue item status. On reject, also transitions candidates to active. |
| `getDedupStats(tenantId)` | `src/features/candidate-management/infrastructure/dedup-repository.ts` | Counts by decision type + pending reviews. Uses `get_dedup_stats` RPC with GROUP BY. |
| `merge_candidates` RPC | `supabase/schema.sql` | Atomic merge: NULL loser email/phone (unique constraint release) → update winner fields → migrate fingerprints + submissions → insert audit row. |
| `find_dedup_field_matches` RPC | `supabase/schema.sql` | Server-side phone normalization (`regexp_replace`) + name matching. Searches `active` + `pending_review` candidates. |
| `get_dedup_stats` RPC | `supabase/schema.sql` | GROUP BY `decision_type` counts for dashboard stats. |

### Availability & Refresh (Story 2.6)
| Capability | Location | When to Use |
|-----------|----------|-------------|
| `updateAvailabilityStatus(tenantId, candidateId, newState, source, metadata?)` | `src/features/candidate-management/infrastructure/availability-repository.ts` | Atomic availability state update via `update_availability_status` RPC. Updates `candidates.availability_status` + `availability_last_signal_at`, inserts audit row in `candidate_availability_signals`. |
| `getSignalHistory(tenantId, candidateId, limit?)` | `src/features/candidate-management/infrastructure/availability-repository.ts` | Query recent availability signals ordered by `created_at DESC`. Default limit 20. |
| `getLatestSignal(tenantId, candidateId)` | `src/features/candidate-management/infrastructure/availability-repository.ts` | Get single most recent signal row. |
| `batchUpdateAvailability(tenantId, candidateIds, newState, source)` | `src/features/candidate-management/infrastructure/availability-repository.ts` | Parallel batch update using `Promise.allSettled()` over RPC calls. Max 50 candidates from UI. |
| `computeAvailabilityState(tenantId, candidateId)` | `src/features/candidate-management/application/availability-scoring.ts` | Recalculate availability from engagement signals: fresh self-report takes priority, then count engagement events (>=3 active, 1-2 passive, 0 unavailable). |
| `isStaleSignal(availabilityLastSignalAt)` | `src/features/candidate-management/application/availability-scoring.ts` | Returns true if null or >7 days ago. Used by API routes and UI components. |
| `update_availability_status` RPC | `supabase/schema.sql` | Atomic: SELECT current state → UPDATE candidate → INSERT signal row. Returns `{ signal_id, previous_state, new_state, source }`. |

### Ingestion Jobs (Scheduler-Ready)
| Capability | Location | When to Use |
|-----------|----------|-------------|
| `CeipalIngestionJob` | `src/modules/ingestion/jobs.ts` | Polls Ceipal API for applicants, batch upserts. Supports `startPage`, `maxPages`, `since` params. |
| `EmailIngestionJob` | `src/modules/ingestion/jobs.ts` | Stream-processes Graph inbox: fetches unread emails, LLM classifies, persists submissions with attachments, marks as read. Uses `processInbox()` for one-at-a-time processing (no OOM). |
| `OneDriveResumePollerJob` | `src/modules/ingestion/jobs.ts` | Polls OneDrive folder recursively (BFS subfolders) for PDFs. 10-concurrent parallel processing, 500-file cap per run (hourly cron). Uses `uploadFileToStorage` → LLM extraction → `processImportChunk()` repository wrapper with `resume_url`. Uses `mapToCandidateRow()` for field mapping. Uses `createImportBatch()`/`updateImportBatch()` repository functions. Deletes source only after storage backup confirmed. Cleans up empty subfolders. |
| `SavedSearchDigestJob` | `src/modules/ingestion/jobs.ts` | Sends daily digest emails for saved searches via Graph sendMail. Checks response status. |
| `DedupWorkerJob` | `src/modules/ingestion/jobs.ts` | Two-pass dedup worker: Pass 1 fingerprint hash lookup, Pass 2 `find_dedup_field_matches` RPC for phone/name. Routes to auto-merge (>=95%), manual review (70-94%), or keep-separate (<70%). Records identity fingerprints. Batch size 100, triggered via `/api/internal/jobs/run` with `job=dedup`. |
| `RoleDeductionEnrichmentJob` | `src/modules/ingestion/jobs.ts` | Monthly enrichment: queries candidates with empty `deduced_roles`, runs `deduceRoles()` (LLM path) per candidate, updates `deduced_roles` and `role_deduction_metadata`. Batch size 100, triggered via `/api/internal/jobs/run` with `job=role-enrichment`. |
| `CandidateAvailabilityRefreshJob` | `src/modules/ingestion/jobs.ts` | Recalculates availability for stale candidates. Reads interval from `policy_registry` (default 4h). Batch size 200, triggered via `/api/internal/jobs/run` with `job=availability-refresh`. |
| `registerIngestionJobs(scheduler)` | `src/modules/ingestion/jobs.ts` | Registers all 7 jobs (Ceipal, Email, OneDrive, SavedSearchDigest, DedupWorker, RoleDeductionEnrichment, CandidateAvailabilityRefresh) with any scheduler implementing `{ register(job: SchedulerJob): void }`. |

### Role Deduction (Story 2.5a)
| Capability | Location | When to Use |
|-----------|----------|-------------|
| `deduceRoles(candidate, tenantId, options?)` | `src/features/candidate-management/application/role-deduction.ts` | Orchestrator: tries heuristic first, falls back to LLM. Use `{ heuristicOnly: true }` for CSV batch mode. Returns `{ roles, metadata }`. |
| `deduceRolesHeuristic(jobTitle, skills, taxonomy)` | `src/features/candidate-management/application/role-deduction.ts` | Fast, free heuristic matching: exact name → alias containment → word overlap → skills intersection. Returns up to 3 roles sorted by confidence. |
| `deduceRolesLlm(jobTitle, skills, certs, aircraft, taxonomy, tenantId)` | `src/features/candidate-management/application/role-deduction.ts` | LLM classification via `callLlm()` with `role-deduction` prompt. Validates roles against taxonomy, auto-inserts new IT roles. ~$0.001/candidate on Haiku. |
| `getAllRoles(tenantId)` | `src/features/candidate-management/infrastructure/role-taxonomy-repository.ts` | Cached (10-min TTL) fetch of all active roles for a tenant. Used by deduction and UI filter. |
| `getRolesByCategory(tenantId, category)` | `src/features/candidate-management/infrastructure/role-taxonomy-repository.ts` | Fetch roles by category (aviation/it/other). |
| `findRoleByName(tenantId, roleName)` | `src/features/candidate-management/infrastructure/role-taxonomy-repository.ts` | Case-insensitive role lookup. Used by LLM path to validate deduced roles. |
| `insertRole(tenantId, roleName, category)` | `src/features/candidate-management/infrastructure/role-taxonomy-repository.ts` | Insert new role (used by LLM path for new IT roles). Invalidates cache. |
| `getRolesWithAliases(tenantId)` | `src/features/candidate-management/infrastructure/role-taxonomy-repository.ts` | Alias of `getAllRoles` — aliases always included. Used for heuristic matching. |
| `clearRoleTaxonomyCacheForTest()` | `src/features/candidate-management/infrastructure/role-taxonomy-repository.ts` | Test cleanup for role taxonomy cache + in-memory store. |
| `seed_aviation_roles` RPC | `supabase/schema.sql` | Seeds ~47 canonical aviation roles with aliases for a given tenant. Idempotent via ON CONFLICT. |

### Auth & Admin
| Capability | Location | When to Use |
|-----------|----------|-------------|
| `withAuth(handler, options)` | `src/modules/auth/with-auth.ts` | Shared API auth middleware wrapper. Consolidates extractSessionToken → validateActiveSession → authorizeAccess → error envelope → null guard into a single HOF. All protected routes MUST use this instead of inline auth boilerplate. |
| `authorizeAccess(input)` | `src/modules/auth/authorization.ts` | RBAC check for any route. Returns `{ allowed, reason }`. |
| `validateActiveSession(token)` | `src/modules/auth/session.ts` | Validate session token, check revocation. |
| `registerOrSyncUserFromSession(session)` | `src/modules/admin/index.ts` | Upsert user record from SSO session. |
| `resolveEffectiveRole(actorId, tokenRole)` | `src/modules/admin/index.ts` | Get latest role from DB, falling back to token role. |
| `issueCrossClientConfirmationToken(input)` | `src/modules/auth/cross-client-confirmation.ts` | Issue HS256 JWT for cross-client confirmation. 5-minute TTL. |
| `verifyCrossClientConfirmationToken(input)` | `src/modules/auth/cross-client-confirmation.ts` | Verify JWT claims match request context. Returns jti + expiry or null. |
| `consumeCrossClientConfirmationToken(jti, exp)` | `src/modules/auth/cross-client-confirmation.ts` | Replay prevention: consume JTI once. DB-backed in prod, Map in test. |
| `recordImportBatchAccessEvent(input)` | `src/modules/audit/index.ts` | Record audit event for import batch access (list, detail, CSV upload, resume upload). Append-only. |
| `listImportBatchAccessEvents(tenantId?)` | `src/modules/audit/index.ts` | Retrieve import batch access audit trail. Tenant-scoped optional filter. |

### UI Components (Reusable)
| Capability | Location | When to Use |
|-----------|----------|-------------|
| `SyncErrorStatusCard` | `src/app/dashboard/admin/SyncErrorStatusCard.tsx` | Legacy — replaced by SyncRunSummaryCard in Story 2.4b. Kept for zero-risk rollback. |
| `SyncRunSummaryCard` | `src/app/dashboard/admin/SyncRunSummaryCard.tsx` | Self-fetching client component showing current month sync runs with status, counts, error details on click, and "View Errors" drill-down. |
| `MigrationStatusCard` | `src/app/dashboard/admin/MigrationStatusCard.tsx` | Display import batch status. Accepts `tenantId`, `actorId`. |
| `BatchProgressCard` | `src/app/dashboard/recruiter/upload/BatchProgressCard.tsx` | Real-time batch progress with polling. Accepts `batchId`. |
| `AiCostDashboard` | `src/app/dashboard/admin/AiCostDashboard.tsx` | AI cost dashboard with daily spend chart, budget alert, prompt version comparison. Client component, self-fetching. |
| `DedupReviewDashboard` | `src/app/dashboard/admin/dedup/page.tsx` | Dedup review queue with stats, side-by-side comparison, merge/reject actions, bulk operations. Shows merged record after approval. |

### Dashboard UI Standards

All dashboard pages follow a unified design system documented in [`cblaero/docs/dashboard-ui-standards.md`](../../cblaero/docs/dashboard-ui-standards.md). Key constraints:

- White background, sticky header with `text-base` breadcrumbs, consistent footer on every page
- `max-w-6xl` container, `rounded-xl` cards, `rounded-lg` buttons
- `gray-*` neutrals only (no `slate-*`), `emerald-*` accent (no `cyan-*`)
- Minimum font size `text-xs` (12px) — no arbitrary pixel values like `text-[10px]`
- Dev agents creating or modifying dashboard pages MUST read the full standards doc first
- Code review validates UI standards compliance for any `src/app/dashboard/` changes (see development-standards.md §27)

## Architecture Resilience Decisions

Closed decisions for 8 operational risk areas identified during architecture review.

### 1. Agentic Loop Prevention and Human-in-the-Loop Circuit Breaker

**Decision:** Every active goal has a hard execution budget attached at creation time.

- `max_iterations`: the Orchestrator may attempt at most N replanning cycles per goal (default 5).
- `max_consecutive_failures`: if any single worker fails ≥ 3 consecutive tasks within one goal run, the Orchestrator pauses the goal and creates a human-review task (Teams card + DB `goal_review_required` flag) before spending any further API budget.
- `escalation_timeout`: if a paused goal is not reviewed within 30 minutes, the Goal Manager auto-escalates to the delivery head's Teams channel.
- All circuit-breaker state transitions (pause, escalate, resume, abandon) are stored as append-only events with `correlation_id`, `tenant_id`, and `cost_at_trigger`.
- The Coaching Agent must not apply policy changes until the human reviewer approves the resumed goal — no unsupervised replan loops.

**Runaway cost guard:** The Cost Guardrail Worker (see item 8) enforces a hard stop on API spend regardless of goal state. Circuit breaker and cost stop are independent — either can halt execution independently.

### 2. Cold-Start Behavior for New Tenants

**Decision:** The Sourcing and Matching workers operate in explicit bootstrap mode when `tenant.placement_count < 10`.

- Scoring weights fall back to global anonymized aggregate baselines (computed from all tenants, fully anonymized, stored in a read-only `global_signal_defaults` table — never from another tenant's raw data).
- Enrichment weighting is increased in bootstrap mode (heavier reliance on external enrichment vs. internal historical signal) since there is no interaction history to calibrate against.
- The Coaching Agent does not apply tenant-specific policy tuning until the tenant exits bootstrap mode. Bootstrap threshold (10 placements) is configurable per tenant by admin.
- The UI shows a "New account — improving with each placement" indicator on scoring explanations while in bootstrap mode so recruiters understand why explanation detail is lower.

### 3. Enrichment Pipeline Tenant PII Isolation

**Decision:** Supabase RLS is the DB boundary; the enrichment connector layer is the API boundary. Both must enforce tenant isolation independently.

- Every enrichment request from Clay or RapidAPI is tagged with `tenant_id` at the point of outbound call construction.
- Enrichment results are stored immediately under `candidate_enrichment` rows with `tenant_id` as a non-nullable partition key. No enrichment result is ever written without a tenant ID.
- **No shared enrichment cache.** There is no cross-tenant cache layer in MVP. Each tenant's enrichment queries are independent calls. Caching (if introduced) must be scoped to `(tenant_id, candidate_id, source_id)` with explicit eviction on erasure requests.
- The Python connector module enforces: if the `tenant_id` derived from the job context does not match the `tenant_id` on the candidate being enriched, the call is rejected and a `security.tenant_mismatch` audit event is emitted.

### 4. Partial Erasure Under Legal Hold

**Decision:** The Compliance Worker produces a structured erasure receipt on every erasure request regardless of hold status.

Erasure receipt fields:

- `erased_fields`: list of field names nulled/pseudonymized (e.g. `name`, `phone`, `email`, `address`)
- `retained_fields`: list of field names retained and the legal basis (e.g. `audit_event_skeleton` retained under `legal_hold_id`)
- `hold_reference`: hold ID, hold type, estimated hold expiry date (if known)
- `erasure_status`: `COMPLETE` | `PARTIAL_HOLD` | `DEFERRED`

The Web App surfaces this receipt as a two-panel compliance summary:

- Left: "Deleted" (green) — personal identifiers removed
- Right: "Retained" (amber) — retained data with the legal basis and estimated hold duration

The recruiter/admin cannot dismiss this view without acknowledging it; the acknowledgement is itself written as an audit event.

### 5. Teams API Timeout Strategy

**Decision:** Microsoft Teams notifications are a secondary async event that must never block the primary DB write.

- The worker writes the DB update (the primary state transition) first, unconditionally.
- The Teams notification call is issued with a **5-second timeout**.
- On timeout or non-2xx response: the failed notification is written to the `outbox` table as a `teams_notification.pending` event with retry metadata (attempt count, next retry time using exponential backoff, max 3 retries).
- After 3 failed retries, the record is moved to dead-letter state and a `teams_notification.dead_letter` audit event is emitted. The delivery lead is alerted via the fallback path (email via Microsoft Graph) if a notification has been dead-lettered.
- Workers never `await` a Teams call in the critical path of an outreach or scoring job.

### 6. Consent Synchronization Latency (SMS Opt-Out → Kills Pending Email)

**Decision:** Consent revocation is a synchronous, highest-priority operation — it must complete before the Telnyx webhook response is returned.

Processing order on inbound opt-out:

1. Telnyx webhook received by webhook receiver worker.
2. **Synchronously** within the request handler: write `consent_record` revocation row to DB with `revoked_at`, `channel`, and `source_message_id`. This write must commit before the 200 OK is returned to Telnyx.
3. The outbox relay's dispatch step checks `consent_record` status on every job dequeue — if revoked, the job is cancelled before any API call is made. This means even tasks already in the queue will not execute.
4. Any Instantly campaigns with this candidate in an active sequence: the relay cancel logic cancels the pending outbox row AND calls `Instantly API: remove from sequence` within the same transaction-like flow. Target latency from Telnyx webhook receipt to all pending tasks cancelled: **< 5 seconds**.
5. A `compliance.consent.revoked` audit event is emitted and a Teams notification is sent to the recruiter (async, non-blocking).

**Anti-pattern explicitly prohibited:** checking consent only at enqueue time. Consent must be checked at enqueue AND at dequeue.

### 7. Webhook Burst Handling (Instantly / Telnyx at Scale)

**Decision:** The webhook receiver is a thin, stateless ingestion layer that decouples ingest rate from processing rate.

- Webhook endpoints (`POST /webhooks/telnyx`, `POST /webhooks/instantly`) do exactly one thing: validate the request signature, write a raw event row to `webhook_events` table, return `200 OK`. No business logic in the handler. Target response time < 100ms.
- A separate outbox relay worker drains `webhook_events` rows and performs the business logic (consent checks, scoring updates, delivery tracking). This worker scales horizontally on Render background workers.
- Render background workers scale horizontally within the plan limits. For MVP, configure minimum 2 replicas for the webhook processing worker to handle concurrent bursts.
- An unprocessed `webhook_events` queue depth alert is configured: if depth > 200 for > 60 seconds, alert the delivery lead. This is the early warning before processing falls behind.
- Idempotency: the `webhook_events` table has a unique constraint on `(source, message_id)` — duplicate webhook deliveries are deduplicated at insert.

### 8. Cost Guardrail Granularity

**Decision:** Costs are tracked via real-time atomic DB counters, not batch/daily sync.

- A `cost_counter` table has one row per `(tenant_id, counter_type, billing_period)` with an atomic `amount_cents` column.
- Every outreach dispatch (SMS send, email send, enrichment API call) performs an `UPDATE cost_counter SET amount_cents = amount_cents + $cost WHERE tenant_id = $tid AND counter_type = $type AND billing_period = $period RETURNING amount_cents` inside the same DB transaction as the outbox job claim.
- If `RETURNING amount_cents` exceeds the threshold for that `counter_type`, the job is aborted before the external API call is made. No API request is issued for an over-budget tenant.
- The Cost Guardrail Worker also executes a scheduler-emitted 1-minute macro-check job across all tenants (catches accumulated small increments that might slip past per-request checks during concurrent bursts without introducing worker-owned business timers).
- Thresholds: API `$1,000/month` (hard stop at `$950` + alert delivery lead), SMS `$200/placement` (hard stop at `$180` + alert recruiter).
- All budget stops are written as `cost.threshold.exceeded` audit events and surface in the operations console.

### 9. Agentic Continuity — Goal State Persistence for Resumption

**Decision:** A `goal_states` table in Supabase stores the serialized agent execution context; paused goals resume from their last checkpoint without re-running full analysis.

- Schema: `goal_states(goal_id PK, tenant_id, status, scratchpad JSONB, last_checkpoint_at, iteration_count, correlation_id, resumed_by_actor_id, created_at, updated_at)`.
- `scratchpad` stores the serialized agent working memory: current plan, completed sub-tasks, partial results, pending actions, and token budget consumed. Format is framework-neutral JSON — not LangChain-specific — so the worker layer can swap model libraries without a schema change.
- On every iteration completion the Orchestrator writes an updated `scratchpad` checkpoint inside the same DB transaction as the outbox job state update. If the Render replica crashes mid-iteration, the last committed checkpoint is the recovery point.
- On human approval: the approver's action sets `goal_states.status = 'approved'`, records `resumed_by_actor_id`, and enqueues a resume job referencing the `goal_id`. The new worker reads the `scratchpad` and continues from the last checkpoint — it does not re-run prior steps.
- Scratchpad retention: completed goals retain their final scratchpad for 90 days for audit/debugging then are pruned. Abandoned goals retain for 7 days.
- Token cost protection: each checkpoint records `tokens_consumed_total`; if a resumed goal would exceed a per-goal token budget (default 50,000 tokens), it is auto-escalated rather than resumed.

### 10. Communication Collision Prevention — Channel-Agnostic Outreach Lock

**Decision:** A `candidate_outreach_lock` record enforces a 24-hour channel-agnostic cooldown on all automated outreach. Manual recruiter-triggered outreach bypasses the lock but surfaces a visible warning.

- Schema: `candidate_outreach_lock(candidate_id, tenant_id, last_outreach_at, last_channel, last_actor_type [automated|recruiter], lock_expires_at)`. One row per `(candidate_id, tenant_id)`; upserted on every outreach dispatch.
- Before any automated outreach job dispatches (SMS via Telnyx, campaign email via Instantly, ad hoc email via Graph), the worker reads `lock_expires_at`. If `now() < lock_expires_at`, the job is cancelled and written as `outreach.skipped.cooldown` — not retried.
- Cooldown window: 24 hours for automated outreach. Configurable per tenant by admin (minimum 4 hours; maximum 72 hours).
- Manual recruiter action (Teams card "Reach Out"): bypasses the automated lock but the Web App renders a warning banner — "This candidate was last contacted [X hours ago] via [channel]." The recruiter must confirm before the send proceeds. Their confirmation is logged as `outreach.manual.override` in the audit trail.
- Lock is always written regardless of delivery outcome (sent, failed, bounced) — the cooldown protects the candidate experience, not just confirmed deliveries.
- Opt-out takes precedence over lock logic: a revoked consent record short-circuits before the lock check is ever reached.

### 11. Provider-Level Idempotency — Preventing Duplicate Outreach on Worker Retry

**Decision:** Every outreach job stores a `provider_idempotency_key` that is passed to the external provider on every attempt; duplicate sends are prevented at the provider level regardless of how many times the worker retries.

- The `outreach_jobs` table contains: `job_id`, `outbox_event_id`, `provider_idempotency_key`, `provider_request_id` (written back after first successful API call), `send_status`, `attempt_count`.
- `provider_idempotency_key` is generated as `sha256(tenant_id + candidate_id + job_requirement_id + message_template_version + send_window_date)` — deterministic, stable across retries, and scoped to a single send intent. It is generated before the first attempt and never changes on retry.
- Telnyx: key is passed in the `X-Idempotency-Key` header. If Telnyx has already processed the key, it returns the original `message_id` without sending again. The worker writes this `message_id` as `provider_request_id` and marks the job complete.
- Instantly: campaign sequence membership is deduplicated by recipient email per sequence ID — adding the same email twice to the same sequence is a no-op at the Instantly API level. The worker checks sequence membership before adding.
- Microsoft Graph (ad hoc email): idempotency key is included as a custom `X-CBL-Idempotency-Key` message header. The worker queries sent items by this header before dispatching to detect prior successful sends by a crashed prior attempt.
- If the worker crashes after the external API call succeeds but before writing `provider_request_id` to DB: the retry will call the provider again with the same idempotency key, receive the deduplicated response, and then successfully write the status. No double-send occurs.

### 12. FAA Verification Decay — Periodic Re-Verification for Active Candidates

**Decision:** FAA verification is a subscription for ranked/active candidates, not a one-time snapshot. The global scheduler emits a nightly re-verification job that the Compliance Worker executes for all candidates with `rank_status = active` and FAA certs nearing or past expiration.

- The `candidate_faa_verification` table stores: `verification_id`, `candidate_id`, `verified_at`, `cert_type`, `cert_expiry_date`, `verification_status [current|expiring_soon|expired|invalid]`, `source [auto|manual]`.
- Nightly sweep: the scheduler emits the due compliance sweep at off-peak hours and the Compliance Worker queries all candidates where `cert_expiry_date <= now() + 60 days` AND `rank_status = active`. For each, it re-queries FAA public data to confirm current status.
- Status transitions:
  - `current → expiring_soon`: cert expires within 60 days. Recruiter is notified via Teams card; candidate is not automatically downranked but match reasons include expiry warning.
  - `expiring_soon → expired`: cert is past expiry date. Candidate's `rank_status` is set to `compliance_hold` automatically. A `compliance.faa_cert.expired` audit event is emitted.
  - `expired → current`: re-verification confirms renewal (candidate renewed cert). `rank_status` restored; recruiter notified.
- Recruiter-triggered manual re-verification is also supported at any time and does not wait for the nightly sweep.
- Re-verification sweep runs at off-peak hours (default 02:00 tenant local time) using the global scheduler to avoid competing with scoring jobs and to keep timezone handling centralized.
- All re-verification outcomes (pass, expiring, expired, error) are written as append-only audit events with `source: compliance_sweep` and the FAA data snapshot used as evidence.

### 13. Scoring Model Version Audit — Prompt and Model ID Recorded on Every Score

**Decision:** Every `candidate_match` record stores the exact prompt version and model ID used to generate the score and match reasons, making scoring decisions fully reproducible and auditable.

- The `candidate_match` table adds: `scoring_model_id` (e.g. `gpt-4o-2026-01`), `scoring_prompt_version` (semver tag e.g. `scoring-prompt@2.1.0`), `scoring_schema_version`, `scored_at`.
- `scoring_prompt_version` references a `prompt_registry` table: `(prompt_id, version, prompt_text_hash, description, deployed_at, deprecated_at)`. The prompt text is never stored inline in `candidate_match` — only the version reference. The `prompt_registry` is append-only; versions are never deleted.
- When a recruiter asks "why did this candidate's rank change?", the application can query the two `candidate_match` records (before and after), compare `scoring_prompt_version` and `scoring_model_id`, and surface a human-readable explanation: _"Score changed from 87 to 61 on [date]. Scoring model updated from `gpt-4o-2026-01` to `gpt-4o-2026-03`; prompt version updated from `2.0.1` to `2.1.0` (updated: weighted recency of FAA cert renewal). Prior score reasoning is preserved below."_
- Prompt version changes must go through a deployment gate: new version is staged (used for new scores only), prior version remains active for 30 days, scores from both versions co-exist in the UI with a version badge. Version retirement requires delivery head approval.
- The `audit_event` stream also captures `scoring.model.version.changed` events when a new prompt/model is deployed, with actor, timestamp, and change summary.

### 14. GDPR Erasure — SharePoint Asset Cleanup Queue

**Decision:** SharePoint deletion is a retried async step within the compliance worker using the existing outbox pattern. Erasure status remains `PARTIAL_PENDING_SP` until SharePoint confirms all assets deleted. The record is never promoted to `COMPLETE` while orphaned files exist.

- A `pending_asset_deletions` table stores one row per asset awaiting deletion: `(deletion_id, erasure_request_id, candidate_id, tenant_id, asset_type, asset_reference, status [pending|confirmed|failed], attempt_count, last_attempted_at, confirmed_at)`.
- The compliance worker writes `pending_asset_deletions` rows **before** calling the SharePoint API — the intent is recorded even if the worker crashes before the API call.
- On SharePoint `200 OK`: row is updated to `confirmed`.
- On error or timeout: row stays `pending`, re-enqueued with exponential backoff (1 min → 5 min → 15 min → 60 min). Maximum 10 attempts over 24 hours.
- `erasure_request.status` transitions: `IN_PROGRESS` → `PARTIAL_PENDING_SP` (PII DB fields erased, SharePoint pending) → `COMPLETE` (all assets confirmed). Alert fires if any erasure stays in `PARTIAL_PENDING_SP` for > 6 hours.
- After 10 failed attempts: status set to `MANUAL_INTERVENTION_REQUIRED`; compliance admin is alerted with the full asset list. Manual deletion and confirmation via admin console closes the record.
- Reuses the existing Render background worker + outbox retry infrastructure — no separate cleanup service.

### 15. External Enrichment Rate Limiting — Provider-Scoped Leaky Bucket

**Decision:** A `provider_rate_counters` table implements a per-provider leaky bucket using the same Supabase atomic counter pattern as cost guardrails. No Redis dependency introduced in MVP.

- Schema: `provider_rate_counters(provider_id, window_start, request_count, window_seconds, limit_per_window)`. One row per `(provider_id, window_start)` per rolling window.
- Before any outbound enrichment call (Clay, RapidAPI, FAA public data), the worker atomically increments the counter for the current window and compares against `limit_per_window`. If at limit, the job is not issued — it is re-enqueued with a delay equal to the time until the next window boundary.
- Default per-provider limits (configurable by admin without a deploy):
  - Clay: 60 req/min
  - RapidAPI: 30 req/min
  - FAA public data: 20 req/min (no published SLA; conservative to avoid IP block)
- Bulk intake (initial 1M load): the enrichment batch worker self-throttles by checking the rate counter before each chunk dispatch — it will never saturate a provider window on its own.
- Provider `429` responses are a secondary defense: on `429` the worker reads the `Retry-After` header and re-enqueues with that exact delay.
- All rate-limit backoffs are written as `enrichment.rate_limited` informational events in the audit stream for provider headroom visibility.

### 16. Human-in-the-Loop Approval Entry Points

**Decision:** Teams Action Card is the primary HITL path; the Web App "Agent Pending" tab is the authoritative entry point, required fallback, and audit owner. The Web App owns all state transitions — Teams is a delivery channel only.

**Teams Action Card (primary path):**

- When a goal requires human approval, the Orchestrator creates a `goal_approval_requests` record and the Reporting Agent sends an Adaptive Card to the recruiter/delivery lead Teams channel.
- Card shows: goal summary, pause reason, cost-at-pause, and action buttons: "Approve & Resume" / "Abandon" / "View Details in App".
- Button actions POST to `POST /api/v1/agent-approvals/:approval_id/action` on the Web App. The Web App validates the actor's Entra token, writes the decision, updates `goal_states.status`, and enqueues the resume job. The Teams card is then updated to a confirmation message.

**Web App "Agent Pending" tab (authoritative fallback):**

- Lists all `goal_approval_requests` with `status = awaiting_approval` for the tenant, ordered by urgency and elapsed wait time.
- Required during Teams outage: if the Teams card delivery dead-letters (per Teams timeout decision §5), the escalation path notifies the delivery lead via email (Graph) with a direct link to this tab.
- High-sensitivity approvals (bulk-erasure overrides, compliance holds) never appear on Teams cards — Web App only, with step-up authentication required.

**Audit trail:**

- Every decision (source: `teams_card` or `webapp_tab`) is written as `agent.goal.approved` / `agent.goal.abandoned` with actor, source, tenant, elapsed wait time, and cost-at-decision.
- Approval SLA: any `goal_approval_requests` item awaiting approval for > 30 minutes triggers auto-escalation to the delivery head via both channels.
- New entities: `goal_approval_requests(approval_id, goal_id, tenant_id, triggered_by, status, created_at, decided_at, decided_by_actor_id, decision_source, cost_at_trigger)`.

### 17. Observability and Distributed Tracing — Full Request Lineage Across Web, Queue, Workers, and Providers

**Decision:** Every request that can affect candidate state, scoring, outreach, or compliance carries a single `trace_id` end-to-end. Async hops create child `span_id` values, but the `trace_id` remains stable from ingress to final audit event.

- The Web App generates a W3C-compatible `trace_id` at ingress if one is not already present. It writes `trace_id`, `span_id`, and `parent_span_id` into API request context, outbox payloads, worker job envelopes, `audit_event` rows, and structured logs emitted by both Next.js and Python workers.
- Every queue dispatch creates a child span. Example lineage: `web.request -> api.persist_candidate -> outbox.enqueue -> worker.process -> telnyx.send_sms -> audit.persist_delivery`.
- The `audit_event` envelope is extended with `trace_id`, `span_id`, and `parent_span_id`, making audit and tracing queryable together.
- A `trace_spans` table stores summarized async span records: `(trace_id, span_id, parent_span_id, service_name, operation_name, status, started_at, ended_at, tenant_id, candidate_id, job_id, provider_name, error_code)`.
- External provider calls include `X-CBL-Trace-ID` where the provider supports custom headers. If not supported, the worker still logs a local `provider_request_id -> trace_id` mapping in `trace_spans`.
- Debugging contract: any user-visible candidate action, score change, message send, or compliance decision must be explainable by querying all `trace_spans` and `audit_event` rows for the same `trace_id`.

### 18. Testing Undeterministic Logic — Gold Dataset and Judge-Assisted Regression Gate

**Decision:** Prompt/model changes must pass a staged logic regression suite using a curated gold dataset plus a secondary LLM judge. The judge is advisory, not the only gate.

- A `gold_dataset_cases` table stores a curated set of at least 30 representative candidate/job pairs covering strong positive matches, obvious rejects, borderline aviation-cert cases, stale availability signals, conflicting enrichment inputs, and compliance-sensitive cases.
- On every scoring prompt or model change, the system runs both the current version and candidate version against the full gold dataset during the 30-day staging window.
- Results are written to:
  - `logic_regression_runs(run_id, baseline_model_id, candidate_model_id, baseline_prompt_version, candidate_prompt_version, started_at, completed_at, summary_status)`
  - `logic_regression_results(run_id, case_id, baseline_score, candidate_score, baseline_reason, candidate_reason, judge_verdict, judge_confidence, human_override_status)`
- The judge model must not be the same model under test. Its task is rubric-based comparison: did the candidate version improve ranking quality, explanation quality, and compliance-safety for this case?
- Release gate for a prompt/model upgrade:
  - zero unresolved Sev1 regressions on the gold dataset
  - no more than 2 unresolved medium regressions after human review
  - judge model preference must be non-worse than baseline on median quality
  - any low-confidence or disputed judge result is routed to human review before promotion
- Human review is focused, not exhaustive: reviewers inspect only cases where the judge flags regression, confidence is low, or the score delta exceeds a configured threshold.
- Gold dataset updates are append-only and versioned; retired cases remain queryable so historical model comparisons stay reproducible.

### 19. Provider Failover and Reputation Management — Kill Switch plus Warm Standby Routing

**Decision:** Every external messaging provider has a kill switch. SMS has a warm-standby secondary provider; campaign email enters degraded mode instead of pretending there is equivalent hot failover.

- A `provider_routing_policies` table controls per-channel routing: `(channel, primary_provider, fallback_provider, mode [normal|degraded|kill_switched], updated_at, updated_by_actor_id, reason)`.
- A `provider_health_events` table records rolling failure rates, reputation incidents, and kill-switch transitions.
- Automatic kill-switch trigger criteria:
  - rolling 5-minute failure rate >= 80% with at least 50 attempts, or
  - provider returns explicit account/reputation suspension signal, or
  - admin manually activates the kill switch from the operations console.
- SMS routing:
  - Primary: Telnyx
  - Fallback: Twilio warm standby connector, pre-configured but disabled until needed
  - When Telnyx is kill-switched, new SMS jobs route to Twilio automatically. Existing in-flight Telnyx jobs are marked `provider_aborted` and not retried against Telnyx.
- Campaign email routing:
  - Primary: Instantly
  - No equivalent high-volume hot failover provider is assumed at launch.
  - If Instantly is kill-switched, the system enters `degraded` email mode: bulk campaign sends pause, recruiter-triggered ad hoc emails and critical transactional candidate notices continue via Microsoft Graph/Outlook.
  - Operations console must clearly show that campaign automation is paused so recruiters do not assume bulk outreach is still running.
- Reputation-protection policy:
  - failover is not silent; every mode transition emits `provider.kill_switch.activated`, `provider.failover.started`, or `provider.degraded_mode.entered`
  - delivery leads are alerted immediately with provider, channel, failure rate, queued job count, and current routing mode
  - once the primary provider recovers, failback requires manual approval; the system never auto-fails back during an incident window

### 20. Throughput Evolution and Service-Boundary Extraction — Monolith+Worker Until Triggered

**Decision:** The launch architecture remains a web monolith plus background workers, but service extraction is governed by explicit throughput and deployment-cadence triggers. Extraction is not ad hoc.

- The initial implementation slice keeps these in one deployable web/API boundary: recruiter UI, candidate portal, auth/session handling, approval endpoints, and lightweight orchestration entrypoints.
- The first extractable backend service is the `processing-orchestration` boundary: scoring orchestration, enrichment dispatch, queue control, and provider routing. Auth, tenant resolution, and recruiter-facing page delivery remain in the web boundary.
- Service extraction becomes mandatory if any **two** of the following are true for 7 consecutive days in production or staging load tests:
  - candidate-processing backlog exceeds 50,000 queued jobs or oldest job age exceeds 15 minutes
  - worker autoscaling requires >8 sustained replicas to meet SLA
  - recruiter-facing API p95 exceeds 2 seconds due to worker or orchestration contention
  - background processing independently needs a faster deployment cadence than the web app more than twice per sprint
  - outbound provider dispatch exceeds 25 calls/sec sustained or scoring throughput exceeds 100 candidate evaluations/minute sustained
- When extraction is triggered, the migration path is:
  1. preserve existing event envelopes and contracts
  2. move orchestration endpoints behind a dedicated internal API/service
  3. keep the outbox/event catalog stable so workers do not change behavior
  4. route the web app through the new service for orchestration-only calls
- This prevents premature microservice decomposition while removing ambiguity about when the monolith+worker envelope is no longer sufficient.

### 21. Model-Serving and RAG Evolution Lane — Active with Governance Gates

**Decision:** Supabase `pgvector` and tenant-safe RAG are active architectural capabilities now, while advanced model-serving scale-out remains gated by throughput and quality triggers.

- Tier 1 and Tier 2 continue to prioritize deterministic scoring rules, but RAG is allowed for approved retrieval and explanation scenarios with strict tenant and role filters.
- Activation gate for a dedicated model-serving lane (separate service cluster) requires all of the following:
  - Tier 2 scoring precision target met on historical outcomes
  - gold-dataset regression gate stable for 30 days
  - clear evidence that semantic retrieval improves ranking or explanation quality beyond deterministic signals
- The active lane consists of:
  - `model-gateway` service for model routing and prompt/version enforcement
  - `embedding-worker` for offline chunking and vector generation
  - `retrieval-service` enforcing tenant filter and role filter before semantic ranking
  - `prompt-firewall` stage for prompt-injection detection and policy filtering before model execution
  - optional reranker after retrieval, before final score assembly
- Performance targets for the model-serving lane:
  - vector retrieval <250ms p95
  - prompt-firewall + assembly <500ms p95
  - end-to-end scored inference <5s p95 for interactive recruiter use
- No direct app-to-model calls are allowed once this lane is introduced; all model access must flow through the model gateway for policy and audit consistency.

### 22. Provider Outage Queue Fallback Mode — Operational Runbook and State Machine

**Decision:** Queue fallback mode is now an explicit operating mode, not a runbook placeholder.

- Provider-facing jobs can be in one of these states: `ready`, `queued_degraded`, `provider_aborted`, `dead_letter`, `completed`.
- If a provider is kill-switched or enters degraded mode, new jobs targeting that provider move to `queued_degraded` instead of failing immediately.
- Recruiter-facing behavior in degraded mode:
  - web and Teams surfaces show current channel mode and ETA
  - bulk sends display `paused due to provider incident`
  - manual critical notifications continue only on allowed fallback channels
- The provider-outage runbook must define:
  - incident detection trigger
  - kill-switch owner and approval path
  - fallback routing rules by channel
  - queue release criteria after recovery
  - manual failback approval before primary provider resumes traffic
- Queue fallback mode must be exercised in staging before launch and quarterly thereafter.

### 23. Synthetic Load Profiles — Tier 2 and Tier 3 Gate Artifacts

**Decision:** Synthetic load profiles are mandatory gate artifacts, not a nice-to-have.

- `synthetic_load_profiles` defines reusable named scenarios with workload shape, dataset size, concurrency, and pass criteria.
- Required launch-adjacent profiles:
  - `tier2-automation-load`:
    - 100 recruiter sessions
    - 1M candidate records
    - 5,000-recipient outreach batch
    - 500 concurrent provider/webhook callbacks
    - 100 candidate enrichments/sec for 5 minutes
  - `tier3-pilot-load`:
    - 200 recruiter sessions
    - 1-2M candidate records
    - nightly FAA re-verification sweep
    - queue catch-up after degraded mode recovery
    - concurrent audit writes and score recalculations
- Pass criteria:
  - recruiter candidate-list load <2 seconds p95
  - queue backlog drains to steady state within 15 minutes after burst
  - no tenant leakage or cross-tenant query success
  - provider throttling enters graceful backoff instead of hard failure
  - no data-loss in outbox, webhook_events, or audit_event streams
- Tier 2 gate cannot pass without `tier2-automation-load`. Tier 3 gate cannot pass without `tier3-pilot-load`.

### 24. Policy Registry and Zero-Inference Guardrail — No Hidden Business Logic in Code

**Decision:** Any scoring weight, reassignment threshold, cooldown window, cost threshold, routing rule, or recurring business cadence that affects behavior must be versioned in a policy registry instead of being inferred or hardcoded by implementers.

- `policy_registry` stores policy families such as `scoring_weights`, `reassignment_thresholds`, `cooldown_windows`, `provider_failover_thresholds`, `seasonal_adjustments`, `connector_sync_cadences`, `digest_cadences`, `refresh_cadences`, and `guardrail_check_cadences`.
- `policy_versions` stores versioned values and activation windows. Example: `scoring_weights@1.0.0` with skills 40, availability 30, location 20, domain 10; `digest_cadences@1.2.0` with recruiter-digest daily 07:00 tenant local time.
- Workers and orchestration code must read effective policy at execution time and record the `policy_version_id` used in the resulting audit or match records.
- `schedule_definitions` must reference the effective `policy_version_id` for any schedule whose cadence or enablement is user-configurable, so schedule-change history is auditable and replay-safe.
- If a requirement is broad in product language and no policy value exists yet, engineering is not allowed to guess. The work item is blocked until a policy entry or product decision is created.
- This converts remaining PRD long-tail ambiguity into explicit configuration debt rather than hidden implementation leakage.

## Service Boundary Architecture

_Decision: The application follows a layered service architecture with clear boundaries. Routes delegate to services, services delegate to repositories. No layer may skip a level._

### Target Service Boundaries

```
Client → API Routes → {AuthService, DataService, AIInferenceService, AuditService} → Supabase/APIs
```

| Service | Location | Responsibility | Status |
|---------|----------|---------------|--------|
| **Auth Service** | `modules/auth/` | SSO, session, RBAC, step-up, cross-client confirmation | **Complete** — clean boundary |
| **Audit Service** | `modules/audit/` | Event recording, compliance trails, vector audit | **Complete** — clean boundary |
| **Admin Service** | `modules/admin/` | User governance, invitations, role assignment | **Complete** — clean boundary |
| **AI Inference Service** | `modules/ai/` (target) | Shared Anthropic client, prompt registry, extraction/scoring/drafting | **Planned** — currently embedded in `features/candidate-management/application/` |
| **Data Service** | Repositories per entity | DB access abstraction, all queries go through named functions | **Partial** — `candidates` and `saved_searches` have repos; `import_batch`, `candidate_submissions` do not |
| **Fingerprint Service** | `features/candidate-management/infrastructure/fingerprint-repository.ts` | Content fingerprint gate — pre-processing dedup check for all ingestion paths | **Complete** — Story 1.11 |
| **Ingestion Service** | `modules/ingestion/` | Candidate upsert orchestration, sync errors, job scheduling | **Complete** — mostly clean |
| **Email Service** | `modules/email/` | Graph API integration, email parsing | **Complete** — clean boundary |
| **ATS Service** | `modules/ats/` | Ceipal connector, applicant mapping | **Complete** — clean boundary |
| **API Gateway** | `app/api/` + middleware | Route handling, shared auth enforcement | **Partial** — auth pattern copy-pasted per route, no shared middleware |

### Architectural Rules

1. **Route handlers must NEVER call `getSupabaseAdminClient()` directly.** All DB access goes through repository functions or service modules.
2. **Each DB table must have a repository owner.** If a table is queried from 2+ files, extract a dedicated repository or module function.
3. **LLM access must be centralized.** All Anthropic SDK usage goes through `modules/ai/` — no direct `new Anthropic()` in feature code.
4. **Auth enforcement must use shared middleware/helpers.** The validate-session → authorize → step-up pattern should be a reusable function, not copy-pasted.
5. **Every ingestion path must check the content fingerprint gate before any expensive processing.** No LLM extraction, enrichment API call, or database upsert may execute without first calling `FingerprintRepository.isAlreadyProcessed()`. Violations are treated as bugs, not style issues.

### Migration Path

These refactors are tracked as stories 1.8, 1.9, 1.10 in Epic 1 (Platform Foundation):

| Story | Scope | Priority |
|-------|-------|----------|
| **1.8** | Extract `ImportBatchRepository`, `SubmissionRepository`; move cross-client token logic to auth module; eliminate all `db.from()` in routes | High — blocks clean Story 3.x implementation |
| **1.9** | Create `modules/ai/` with shared client, prompt registry loader, extraction service; migrate `candidate-extraction.ts` | Medium — blocks Story 5.x (scoring) |
| **1.10** | Create `withAuth()` middleware wrapper; refactor all routes to use it | Medium — reduces code duplication |
| **1.11** | Create `content_fingerprints` table, `FingerprintRepository`, wire into all ingestion paths as pre-processing gate | High — eliminates redundant LLM calls, prerequisite for Story 2.5 dedup |

### Current Boundary Violations (Tech Debt)

| Violation | Files | Impact |
|-----------|-------|--------|
| Routes call `getSupabaseAdminClient()` directly | 15+ route handlers | Couples routes to DB schema, prevents reuse |
| `import_batch` queries inline in 4+ files | csv-upload, resume-upload, import-batches, jobs/run routes | Duplicate query logic, no shared abstraction |
| `candidate_submissions` inserts inline in routes | resume-upload route, ingestion module | Split persistence logic |
| Cross-client confirmation JWT logic in candidates route | candidates/route.ts lines 179-261 | Auth concern leaked into data route |
| Anthropic client in feature module | candidate-extraction.ts | Not reusable for scoring/outreach LLM use cases |
| Auth preamble copy-pasted in every route | All 15+ route handlers | 15-line pattern repeated, maintenance burden |

## Implementation Patterns and Consistency Rules

### Pattern Categories Defined

Critical conflict points identified: naming, API contract shape, event semantics, and cross-module boundaries.

### Naming Patterns

**Database naming conventions:**

- Tables: `snake_case`, plural (`candidates`, `job_requirements`)
- Columns: `snake_case`
- FK fields: `<entity>_id`
- Indexes: `idx_<table>_<column_list>`

**API naming conventions:**

- Endpoint paths: plural nouns (`/api/v1/candidates`)
- Route params: kebab path segments with IDs as UUID strings
- Query params: `snake_case`

**Code naming conventions:**

- TypeScript types/interfaces: `PascalCase`
- Variables/functions: `camelCase`
- File names:
  - React components: `PascalCase.tsx`
  - non-component modules: `kebab-case.ts`

### Structure Patterns

- Organize by feature domain first, technical type second.
- Every feature domain has explicit layers:
  - `contracts`
  - `application`
  - `domain`
  - `infrastructure`
  - `ui` (where applicable)
- No direct cross-feature imports except through published feature contracts.

### Format Patterns

- API response and error envelopes are mandatory and stable.
- Dates/times use ISO 8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`).
- IDs use UUIDv7 (or UUIDv4 if v7 support unavailable at initialization).
- Booleans are strict true/false, never numeric substitutions.

### Communication Patterns

- Event naming: `<bounded_context>.<aggregate>.<past_tense_verb>`
  - Example: `outreach.message.sent`
- Event envelope:
  - `event_id`, `event_type`, `occurred_at`, `tenant_id`, `actor_id`, `trace_id`, `span_id`, `parent_span_id`, `payload`, `schema_version`
- Correlation and causation IDs required for all async workflows.

### Process Patterns

**Error handling:**

- Domain errors are explicit typed errors.
- User-facing messages are safe/sanitized.
- Internal diagnostics are captured in structured logs only.

**Loading and async status:**

- Long-running operations expose explicit status resources.
- UI polling intervals are bounded and adaptive.
- Retries are never silent; retry state is observable in operations views.

### Enforcement Guidelines

All AI agents must:

- Respect module boundaries and public contracts.
- Use the standard API and event envelopes.
- Preserve tenant ID propagation in all data and event paths.
- Include tests for boundary, authorization, and idempotency behavior.

Pattern enforcement:

- Pull request checklist for architecture contract compliance
- Contract tests for API envelope and event schema stability
- Lint and static import-boundary checks

### Pattern Examples

**Good example (event):**

- `candidate.availability.updated` with `tenant_id`, `candidate_id`, `previous_state`, `new_state`, `source`

**Anti-patterns to avoid:**

- Direct cross-tenant queries without explicit tenant predicate
- Sending Teams notifications without idempotency key
- Feature module accessing another feature's private persistence layer

## Project Structure and Boundaries

### Complete Project Directory Structure

```text
cblaero/
  README.md
  package.json
  pnpm-workspace.yaml
  .env.example
  .github/
    workflows/
      ci.yml
      security.yml
  apps/
    web/
      package.json
      next.config.ts
      tsconfig.json
      src/
        app/
          (recruiter)/
            dashboard/page.tsx
            jobs/[jobId]/page.tsx
            candidates/[candidateId]/page.tsx
          (candidate)/
            portal/[token]/page.tsx
            availability/page.tsx
          (ops)/
            delivery/page.tsx
            compliance/page.tsx
          api/
            v1/
              candidates/route.ts
              jobs/route.ts
              outreach/route.ts
              notifications/route.ts
              reports/route.ts
          layout.tsx
          page.tsx
        features/
          candidate-management/
            contracts/
            application/
            domain/
            infrastructure/
            ui/
          outreach-engagement/
            contracts/
            application/
            domain/
            infrastructure/
            ui/
          recruiter-workflow/
            contracts/
            application/
            domain/
            infrastructure/
            ui/
          scoring-matching/
            contracts/
            application/
            domain/
            infrastructure/
            ui/
          compliance-governance/
            contracts/
            application/
            domain/
            infrastructure/
            ui/
          analytics-operations/
            contracts/
            application/
            domain/
            infrastructure/
            ui/
        shared/
          auth/
          tenancy/
          api/
          observability/
          validation/
          ui/
  workers/
    outreach-worker/
      src/
        jobs/
        retries/
        adapters/
    notifications-worker/
      src/
        teams/
        email/
        sms/
  packages/
    contracts/
      src/api/
      src/events/
    config/
      eslint/
      typescript/
    test-utils/
      src/
  db/
    prisma/
      schema.prisma
      migrations/
    seeds/
  docs/
    architecture/
      adr/
      api-contracts/
      event-catalog/
  tests/
    unit/
    integration/
    e2e/
    adversarial/
      tenant-isolation/
      token-abuse/
```

### Architectural Boundaries

**API boundaries:**

- Public candidate portal endpoints are isolated from authenticated internal endpoints.
- Internal API requires authenticated session and tenant context.

**Component boundaries:**

- Feature modules communicate through typed contracts only.
- UI components do not call persistence adapters directly.

**Service boundaries:**

- Worker services consume outbox events and invoke channel adapters.
- Notification channel adapters are pluggable and isolated from domain logic.

**Data boundaries:**

- Tenant-owned data partitioning enforced via tenant key and policy layer.
- Audit event store treated as append-only with hash-chain tamper-evidence.

### Requirements to Structure Mapping

**Feature/FR domain mapping:**

- Candidate management FRs (`FR1, FR1b, FR2-FR7`) -> `features/candidate-management`
- Outreach and engagement FRs (`FR8-FR17`) -> `features/outreach-engagement` + `workers/outreach-worker`
- Recruiter workflow FRs (`FR18-FR27`) -> `features/recruiter-workflow`
- Scoring/matching FRs (`FR28+` scoring set) -> `features/scoring-matching`
- Compliance/governance FR/NFR sets -> `features/compliance-governance` + `tests/adversarial`
- Delivery analytics and KPI reporting -> `features/analytics-operations`

**Cross-cutting concerns:**

- Auth and tenancy enforcement -> `shared/auth`, `shared/tenancy`
- Audit and observability -> `shared/observability`, `docs/architecture/event-catalog`
- API and event contracts -> `packages/contracts`

### Integration Points

**Internal communication:**

- Sync: typed application services and repository interfaces
- Async: outbox events consumed by worker services

**External integrations:**

- Telnyx for SMS and voice calling (recording and transcription)
- Instantly for campaign email
- Microsoft Graph/Outlook for ad hoc recruiter email
- Microsoft Teams for notifications, scheduling, task creation, and recruiter communication
- Candidate enrichment connectors for internal DB, Clay, and RapidAPI sources
- FAA verification via official FAA public data and manual review workflow
- SharePoint for document/file distribution in MVP

**Data flow:**

1. Candidate/job signals enter transactional core
2. Domain events emitted to outbox
3. Workers deliver outreach/notifications with retries
4. Interaction events feed scoring and analytics projections
5. Audit stream captures all critical transitions

## Architecture Validation Results

### Stack-Mapped Implementation Readiness Checklist

Use this checklist as the pre-build and pre-release gate for the chosen stack.

#### 1. Render Platform and Environment Readiness

- [ ] Separate Render services created for web app and Python workers.
- [ ] Separate `staging` and `production` environments configured.
- [ ] Environment variables and secrets loaded through Render environment secrets only.
- [ ] CI/CD pipeline includes schema migration checks and protected-branch build rules.
- [ ] Rollback procedure documented and tested for both web and worker services.

Evidence:

- Render service configuration exports/screenshots
- Deployment pipeline config and last successful staging run

#### 2. Supabase and Data Security Readiness

- [ ] Supabase project provisioned in approved US region.
- [ ] RLS policies implemented and tested for all tenant-owned tables.
- [ ] Append-only audit tables with hash-chain integrity checks implemented.
- [ ] Python workers use backend-only service credentials; no client exposure of service role keys.
- [ ] TLS enforced for all DB connections from app and workers.
- [ ] 3-year retention policy for call recordings/transcripts configured and documented.

Evidence:

- SQL migrations for RLS and audit models
- Access test report proving cross-tenant denial
- Connection settings showing TLS requirement

#### 3. Identity and Access (Entra + Candidate Magic Links)

- [ ] Microsoft Entra SSO configured for internal users.
- [ ] Candidate magic-link login flow implemented for SMS/email link entry.
- [ ] Step-up authentication enforced for high-risk actions (exports, role changes, bulk sensitive actions).
- [ ] Emergency access runbook documented and audit logging verified.

Evidence:

- Auth flow test cases and runbook
- Audit sample showing privileged action traces

#### 4. Messaging and Collaboration Integrations

- [ ] Telnyx integration live for two-way SMS.
- [ ] Telnyx voice integration live for dial, recording, and transcription.
- [ ] Instantly integration live for campaign email sends/status.
- [ ] Microsoft Graph/Outlook integration live for ad hoc recruiter email actions.
- [ ] Microsoft Teams integration live for cards, task creation, and scheduling actions.
- [ ] Retry policy (max retries, delay strategy, terminal state) implemented and tested across integrations.

Evidence:

- Integration smoke-test report per provider
- Message delivery and callback logs
- Teams card/task end-to-end test capture

#### 5. Enrichment and Compliance Workflow Readiness

- [ ] Enrichment connector layer implemented for internal DB, Clay, and RapidAPI sources.
- [ ] Provider-agnostic connector contract verified with at least two enrichment sources.
- [ ] FAA verification workflow implemented using official FAA public data + manual review.
- [ ] Background check path documented as manual-only in MVP operations SOP.

Evidence:

- Connector contract tests
- FAA verification workflow documentation and sample execution

#### 6. Security, TLS, and MCP Control Readiness

- [ ] HTTPS-only access and HSTS enabled on authenticated application surfaces.
- [ ] TLS 1.2+ enforced edge-to-client; TLS enforced service-to-database.
- [ ] MCP tool access policies implemented with role/environment allowlists.
- [ ] MCP high-risk operations protected by step-up auth and explicit audit trails.
- [ ] Secret scanning active in CI; no plaintext credentials in repository.

Evidence:

- Security config snapshots
- MCP policy definitions and deny-path test results
- CI security scan reports

#### 7. Observability, Alerts, and Cost Guardrails

- [ ] Render and Supabase native monitoring dashboards configured.
- [ ] Alert rules configured for uptime, queue failures, provider errors, and auth anomalies.
- [ ] Cost alerts configured at: API `$1,000/month`, SMS `$200/placement`.
- [ ] KPI alert configured for conversion rate `<5%`.
- [ ] Operational runbook exists for provider outage and queue fallback mode.

Evidence:

- Alert policy export
- Test alert triggers and runbook execution notes

#### 8. Testing and Release Gate

- [ ] Unit, integration, and e2e tests pass on staging.
- [ ] Tenant-isolation adversarial suite passes with zero leakage.
- [ ] External-provider outage drill validates queue mode and recovery.
- [ ] Audit immutability and hash-chain verification checks pass.
- [ ] Accessibility baseline checks pass for critical workflows.

Gate rule:

- `PASS`: all critical items complete.
- `CONCERNS`: non-critical items pending with approved mitigation owner/date.
- `FAIL`: any critical security, tenant isolation, or audit integrity item incomplete.

#### 9. Known Accepted MVP Risks

- [ ] SMS backup provider is not configured in MVP (accepted risk, monitor via outage drill).
- [ ] Background checks remain manual in MVP (accepted operational tradeoff).
- [ ] External BI remains deferred; in-app analytics only for MVP.

### Gap Analysis Results

**Critical gaps:**

- None blocking architecture initiation.

**Important gaps to close during story decomposition:**

- Finalize measurable acceptance thresholds for remaining long-tail FR/NFR entries still marked as warning in PRD validation.
- Finalize candidate portal depth boundaries for MVP vs post-MVP.
- Lock explicit forecast/cohort analytics acceptance criteria for executive workflow.

**Nice-to-have gaps:**

- None beyond ongoing wording hygiene in PRD/validation artifacts.

### Architecture Readiness Assessment

**Overall status:** READY FOR IMPLEMENTATION

**Confidence level:** Medium-high

- Medium because PRD revalidation remains at warning for residual measurability/detail gaps.
- High because architecture now absorbs and resolves previously deferred implementation choices.

**Key strengths:**

- Clear tenant-safe, compliance-aware architecture path
- Strong async workflow foundation for outreach and notifications
- Explainability-preserving scoring and decision traceability support
- Implementation-consistent patterns designed for multi-agent delivery

**Areas for future enhancement:**

- Execute service-boundary extraction only if the throughput triggers in _Resilience §20_ are breached.
- Activate the dedicated model-serving lane only if the gate in _Resilience §21_ is passed.

### Implementation Handoff

AI agents must:

- Follow this document for all technical decisions and boundary rules.
- Treat this as canonical for architecture-related implementation questions.
- Escalate only if new requirements conflict with explicit decisions in this file.

First implementation priority:

1. Initialize baseline app with the starter command.
2. Add tenancy/auth/audit foundations before feature implementation.
3. Create first vertical slice: job posting -> ranked candidate list -> Teams delivery with audit trail.
