---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - docs/planning_artifacts/prd.md
  - docs/planning_artifacts/architecture.md
  - docs/planning_artifacts/ux-design-specification.md
project_name: CBLAero
date: '2026-03-11'
status: complete
---

# CBLAero — Epics & Stories Index

**Status as of 2026-04-17**: Epic 1 DONE (12/12 base stories + 1.11 + 1.12 framework + 1.12a migration; 1.12b/c backlog). Epic 2 DONE (11/11 originally planned stories + 2-4a/4b/5a/7a/8 add-ons). Epics 3-9 BACKLOG.

_Navigation index only. Per-story acceptance criteria, tasks, and implementation notes live in `_bmad-output/stories/<story-id>-<slug>.md`. Full historical version preserved at `_bmad-output/epics.full.md`. Canonical sprint progress in [`_bmad-output/sprint-status.yaml`](sprint-status.yaml)._

## Cross-cutting context

CBLAero is a multi-tenant ATS / recruiter dashboard for CBL Solutions (cbl.aero) built on Next.js 16 + Supabase (`cblaero_app` schema) + Anthropic Claude. Key cross-cutting constraints that all epics inherit:

- **Personas**: Recruiter (primary operator), Delivery Head, Admin, Compliance Officer, Candidate (self-service portal in Epic 9).
- **Non-negotiables**: Microsoft Entra SSO, USA data residency (`us-east-1`, `us-west-2`), active-client context on every client-scoped call, tenant-safe RBAC on every read/write.
- **Dependency graph**: Epic 1 (platform/auth/residency) gates all others → Epics 2/3 run in parallel on Epic 1 contracts → Epics 4/7 need Epic 2 ingestion + Epic 3 outreach → Epic 5 (scoring) needs Epic 4 workflow contracts → Epics 6/8/9 layer on top of the workflow + scoring surfaces.
- **Scoring target**: ≥90% precision in the top confidence quintile by end of Tier 2 (see FR33 / Epic 5).
- **Full FR inventory** lives in `_bmad-output/epics.full.md` (lines 22-190); every FR is mapped to an epic in that file.

## Epic 1 — Platform Foundation, Access, and Tenant Security — DONE

**Goal**: Establish the deployable baseline with enterprise authentication, role-safe access boundaries, and tenant/data-residency controls so all future epics can build safely. FRs covered: FR26, FR41-FR45, FR70.

Epic originally closed after 1.10; reopened to add the content-fingerprint gate (1.11) and the Edge System Provider Framework (1.12 + 1.12a/b/c migration series). Status below reflects current sprint-status.yaml.

| Story | Title | Status |
|---|---|---|
| 1.1 | Initialize Next.js Baseline with Core Platform Modules | DONE |
| 1.2 | Implement Enterprise SSO and Session Controls | DONE |
| 1.3 | Enforce RBAC and Tenant-Isolated Authorization | DONE |
| 1.4 | Build Admin User and Team Management Console | DONE |
| 1.5 | Add Step-Up Auth for Sensitive Operations | DONE |
| 1.6 | Enforce USA Data Residency Policy Gates | DONE |
| 1.7 | Add Active Client Context Safeguards | DONE |
| 1.8 | Extract Data Service Repositories and Eliminate Route DB Calls | DONE |
| 1.9 | Create Centralized AI Inference Service with Prompt Registry | DONE |
| 1.9a | AI Cost Dashboard and Prompt Deployment Gates | DONE |
| 1.10 | Implement Shared API Auth Middleware | DONE |
| 1.11 | Implement Content Fingerprint Gate for All Ingestion Paths | DONE |
| 1.12 | Edge System Provider Framework | DONE |
| 1.12a | Migrate Clay/CEIPAL to Provider Framework | DONE |
| 1.12b | Migrate Graph/Anthropic to Provider Framework | BACKLOG |
| 1.12c | Migrate Supabase to Provider Framework | BACKLOG |

Story files: [`_bmad-output/stories/1-1-*.md`](stories/) through [`1-12c-*.md`](stories/).

**Delivery notes** (from sprint-status.yaml):
- 1.12 closed 2026-04-16 with framework + two code reviews + 110 tests.
- 1.12a closed 2026-04-17 as a 2-PR split: PR A #97 (Task 1, Clay webhook receiver) + PR B #99 (Tasks 2-5, CEIPAL migration + Clay outbound + registry seed); Opus 4-layer review applied inline.
- 1.12b/c are sequentially blocked (b → c).

## Epic 2 — Candidate Data Ingestion and Profile Lifecycle — DONE

**Goal**: Enable trusted candidate ingestion from migration, recruiter uploads, ATS, and inbox channels with deduplication, indexing, and profile lifecycle operations. FRs covered: FR1, FR1a, FR2-FR5, FR7, FR68.

| Story | Title | Status |
|---|---|---|
| 2.1 | Build Admin-Supervised Initial 1M Record Migration Pipeline | DONE |
| 2.2 | Implement Recruiter CSV Upload Wizard and Validation | DONE |
| 2.2a | Implement Recruiter PDF Resume Upload with LLM Extraction | DONE |
| 2.3 | Implement ATS and Email Ingestion Connectors | DONE |
| 2.4 | Implement Candidate Profile Storage and Indexing | DONE |
| 2.4a | Dashboard UI Standardization | DONE |
| 2.4b | Sync Run Summary and Error Management | DONE |
| 2.5 | Implement Deterministic Deduplication and Manual Review Queue | DONE |
| 2.5a | Implement Deduced Role Classification | DONE |
| 2.6 | Implement Availability State and Manual Refresh Operations | DONE |
| 2.7 | Implement Global Scheduler Control Plane | DONE |
| 2.7a | Scheduler Admin Dashboard | DONE |
| 2.8 | Implement Clay Webhook Ingestion | DONE |

**Delivery notes** (from sprint-status.yaml):
- 2.2 ingestion hit production on 2026-03-31 (6,150 candidates, `extra_attributes` live).
- 2.4b sync-run summary shipped 2026-04-08 with two adversarial reviews (19 findings fixed).
- 2.7 scheduler closed 2026-04-14 with outbox consumer, `FOR UPDATE SKIP LOCKED`, policy versioning, readiness probe; 22 review findings fixed, 6 deferred.
- 2.7a admin dashboard live 2026-04-15; Render cron `CBLAero-Scheduler-Tick` running `*/10 * * * *`.
- 2.8 Clay webhook merged 2026-04-16 via PRs #80 + #81 (push pattern, 55 tests passing, retroactive story file).
- Epic 2 retro 2026-04-16: 3 action items, 3 debt items, 1 team agreement.

## Epic 3 — Outreach Orchestration and Candidate Engagement — BACKLOG

**Goal**: Enable compliant outbound communication and inbound candidate response handling for single-send and bulk campaign operations. FRs covered: FR8-FR13, FR15-FR17.

**Dependency gate**: Core platform contracts from Epic 1 frozen.

| Story | Title | Status |
|---|---|---|
| 3.1 | Build SMS Outreach Template and Scheduling Workflow | BACKLOG |
| 3.2 | Build Email Outreach Templates with Role Permissions | BACKLOG |
| 3.3 | Implement Consent, Opt-Out, and Channel Preference Engine | BACKLOG |
| 3.4 | Capture Candidate Responses and Seriousness Inputs | BACKLOG |
| 3.5 | Track Delivery Outcomes and Retry Failed Sends | BACKLOG |
| 3.6 | Enable Candidate One-Time Token Registration | BACKLOG |
| 3.7 | Implement Bulk Campaign Execution at Scale | BACKLOG |

## Epic 4 — Recruiter Delivery Workflow and Offer Management — BACKLOG

**Goal**: Enable recruiters to intake jobs, operate daily pipelines, move candidates through journey states, and execute offer workflows. FRs covered: FR18, FR19, FR21-FR25, FR56.

**Dependency gate**: Candidate ingestion (Epic 2) and outreach interfaces (Epic 3) complete.

| Story | Title | Status |
|---|---|---|
| 4.1 | Implement Job Intake with Mandatory Aviation Questions | BACKLOG |
| 4.2 | Build Daily Candidate Queue View by Job | BACKLOG |
| 4.3 | Implement Interaction Logging and Journey State Machine | BACKLOG |
| 4.4 | Build Bulk Candidate Operations and Export Workflow | BACKLOG |
| 4.5 | Implement Formal Offer Workflow | BACKLOG |

## Epic 5 — Matching Intelligence and Domain Qualification — BACKLOG

**Goal**: Provide transparent ranking, readiness scoring, and aviation-specific qualification intelligence that guides recruiter action. FRs covered: FR20, FR28-FR35, FR57-FR59, FR61.

**Dependency gate**: Candidate signals available (Epic 2) and Epic 4 workflow contracts frozen.

| Story | Title | Status |
|---|---|---|
| 5.1 | Implement Weighted Opportunity Scoring Core | BACKLOG |
| 5.2 | Build Availability Freshness and Seriousness Computation | BACKLOG |
| 5.3 | Implement Domain Screening and Rejection Reason Codes | BACKLOG |
| 5.4 | Implement FAA Verification Lifecycle | BACKLOG |
| 5.5 | Implement Drug Test Compliance Tracking | BACKLOG |
| 5.6 | Build Confidence Recalibration and Seasonal Adjustment Controls | BACKLOG |

## Epic 6 — Collaboration and Notification Workflows — BACKLOG

**Goal**: Deliver role-aware notifications and action cards so recruiters and delivery heads can respond quickly without dashboard thrash. FRs covered: FR36-FR40.

**Dependency gate**: Epic 4 and Epic 5 payload contracts frozen.

| Story | Title | Status |
|---|---|---|
| 6.1 | Implement Recruiter Daily Top-5 Teams Digest | BACKLOG |
| 6.2 | Implement Rich Teams Action Cards | BACKLOG |
| 6.3 | Build Delivery Head Event and Workload Alerts | BACKLOG |
| 6.4 | Implement Notification Configuration Console | BACKLOG |

## Epic 7 — Metrics, Cost Governance, and Forecasting — BACKLOG

**Goal**: Provide operational, financial, and performance insights with thresholding and forecasting for recruiter and leadership decision-making. FRs covered: FR27, FR46-FR52, FR54, FR55.

**Dependency gate**: Workflow event streams and initial scoring outputs available.

| Story | Title | Status |
|---|---|---|
| 7.1 | Build Core Operational Dashboard | BACKLOG |
| 7.2 | Add Recruiter and Customer Trend Analytics | BACKLOG |
| 7.3 | Implement Cost and Budget Governance Views | BACKLOG |
| 7.4 | Implement Peer Comparison and Support Recommendations | BACKLOG |
| 7.5 | Add Pipeline Forecasting and KPI Breach Alerting | BACKLOG |

## Epic 8 — Compliance, Reliability, and Operational Guardrails — BACKLOG

**Goal**: Implement immutable auditability, retention/deletion obligations, resilience controls, and security monitoring to keep operations compliant and trustworthy. FRs covered: FR6, FR14, FR53, FR60, FR62-FR67, FR69.

**Dependency gate**: Security baseline from Epic 1 complete.

| Story | Title | Status |
|---|---|---|
| 8.1 | Implement Immutable Audit Event Pipeline and Export | BACKLOG |
| 8.2 | Implement Retention, Archival, and Backup Governance | BACKLOG |
| 8.3 | Implement GDPR Deletion Workflow End-to-End | BACKLOG |
| 8.4 | Implement Reliability Controls for Provider and Queue Failures | BACKLOG |
| 8.5 | Implement Provider Health and API Metering Alerts | BACKLOG |
| 8.6 | Implement Security Anomaly Escalation Workflow | BACKLOG |

## Epic 9 — Candidate Self-Service Portal Experience — BACKLOG

**Goal**: Enable candidates to securely self-serve profile, status, and document workflows from token-based portal access. FRs covered: FR71-FR75.

**Dependency gate**: Outreach tokens (Epic 3) and Epic 4 workflow status APIs available.

| Story | Title | Status |
|---|---|---|
| 9.1 | Implement Candidate Token Login and Profile View | BACKLOG |
| 9.2 | Implement Candidate Availability and Seriousness Self-Updates | BACKLOG |
| 9.3 | Build Candidate Application Status Timeline | BACKLOG |
| 9.4 | Implement Candidate Lifecycle Notifications | BACKLOG |
| 9.5 | Implement Candidate Offer and Document Download | BACKLOG |

## Done Epic Retros

- Epic 1: [`epic-1-retro-2026-04-03.md`](epic-1-retro-2026-04-03.md) (and earlier [`epic-1-retro-2026-03-30.md`](epic-1-retro-2026-03-30.md))
- Epic 2: [`epic-2-retro-2026-04-16.md`](epic-2-retro-2026-04-16.md) (and earlier [`epic-2-retro-2026-04-15.md`](epic-2-retro-2026-04-15.md))

## Planning metadata

- **Original 4-week plan** (Weeks 1-4, two squad members, parallel epics): see `epics.full.md` lines 358-431 for the calendar, package mapping (X1-X27 → epics), and weekly objectives. Historical only — actual execution has run past the four-week target.
- **Story sizing reference** (S/M/L): `epics.full.md` lines 292-356.
- **Full functional-requirements inventory** (FR1-FR75): `epics.full.md` lines 22-190.
