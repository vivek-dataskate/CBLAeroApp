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

# CBLAero - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for CBLAero, decomposing the requirements from the PRD, UX Design, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: System can ingest candidate records from bulk CSV upload (up to 1M records initial load, then daily/weekly recruiter uploads of 100-10,000 records); upload must validate, deduplicate, retain unmapped columns in candidate extra_attributes (JSONB), and report import errors per row with a downloadable error report.
FR1a: System can perform initial bulk load of up to 1M existing candidate records via a one-time admin-supervised migration pipeline; load must complete within a time-bounded batch window with progress tracking and rollback capability.
FR2: System can ingest candidate data automatically from configured ATS system connectors (read-only API polling or webhook) and recruiter email inboxes (Microsoft Graph mail parsing); new or updated records are upserted via the standard deduplication pipeline with source attribution.
FR3: System can store and index candidate profiles with core attributes (name, phone, email, location, skills, certifications, experience, availability status).
FR4: System can deduplicate candidate records with deterministic merge policy: auto-merge at >=95% identity confidence, manual-review queue at 70-94%, keep separate below 70%.
FR5: System can track candidate availability status (active, passive, unavailable) using self-reported status plus engagement events from the previous 90 days.
FR6: System can archive candidate records indefinitely with 5-year queryable retention and 7-year cold storage; implement GDPR right-to-be-forgotten deletion policy.
FR7: Recruiter can view complete candidate profiles including enriched data (company history, skills, location, match reason).
FR8: System can compose and schedule SMS outreach using parameterized templates and enforce candidate contact windows.
FR9: System can compose and schedule email outreach using parameterized templates with role-based edit permissions and template version history.
FR10: System can manage per-candidate communication channel preferences (SMS vs. email opt-in, TCPA compliance per channel).
FR11: Candidate can respond to SMS/email with availability confirmation, preferred contact window, and structured seriousness fields.
FR12: System can track SMS and email delivery status and response rates per recruiter, per customer, per candidate pool.
FR13: System can honor candidate opt-outs from SMS/email and prevent further outreach per channel.
FR14: System can enforce opt-out compliance (TCPA regulations) for SMS and email campaigns; maintain audit trail of all outreach.
FR15: System can retry failed outreach with bounded policy (maximum 3 retries, escalating delay, then terminal undeliverable status with admin alert).
FR16: Candidate can register for the platform via SMS/email link with one-time token validation (15-min expiry).
FR17: System can launch bulk outreach campaigns for batch sizes between 50 and 5,000 candidates with per-batch completion reporting; campaign targeting uses pre-computed index slices at 1M+ scale.
FR18: Recruiter can post a new job requirement with client details, role description, and 10 mandatory aviation-specific intake questions.
FR19: Recruiter can view daily-refreshed candidate list for each job, sorted by opportunity score and availability signal.
FR20: Recruiter can view structured candidate match reasons containing certification fit, experience fit, location fit, and availability fit.
FR21: Recruiter can log interactions with each candidate (call, SMS response, declined, interviewed, placed).
FR22: Recruiter can track candidate journey status (prospects -> interested -> interview scheduled -> interview in progress -> interview attended/missed -> offer extended -> placed -> started), including attendance confirmation.
FR23: Recruiter can execute formal offer workflow (create offer, submit for sign-off, send to candidate, capture accept/decline state, and log turnaround time).
FR24: Recruiter can bulk-update candidate status, tags, or job assignments for batch sizes between 50 and 1,000 records with success/failure summary.
FR25: Recruiter can export candidate list in structured formats for approved downstream systems while preserving match score, reason summary, and communication status.
FR26: Recruiter can manage multiple client accounts with explicit active-client context indicator and confirmation before cross-client actions.
FR27: Recruiter can view personal metrics dashboard (candidates delivered, conversions, time-to-fill, commissions, peer comparison vs. team average).
FR28: System can assign opportunity score (0-100) using weighted factors: skills (40%), availability (30%), location fit (20%), domain requirements (10%).
FR29: System can validate availability signals by comparing stated availability against engagement activity from the prior 90 days and marking stale signals older than 7 days.
FR30: System can compute seriousness state (High, Medium, Low) from behavioral responses (tool ownership, badge readiness, decision timeline) using explicit scoring rules.
FR31: System can screen for mandatory domain requirements (A&P certification, airport badge eligibility, no felony records).
FR32: System can flag candidates who do not meet hard requirements with explicit rejection reason code (missing_certification, badging_ineligible, tooling_missing, availability_mismatch).
FR33: System can test match confidence against prior 90-day conversion outcomes, recalibrate scoring monthly, and achieve >=90% precision in the top confidence quintile by end of Tier 2.
FR34: System can refresh candidate data (availability, location, skills) on a 4-hour cadence (Tier 1) or continuous with caching (Tier 2+).
FR35: System can apply seasonal hiring adjustments with configurable weighting (+/-15%) by month and geography, with override controls for delivery head users.
FR36: System can send daily Teams notification to recruiter with top 5 candidates for each job, including match reasons and contact buttons.
FR37: System can embed rich notification cards in Teams with candidate summary, confidence score, and one-click call/email actions.
FR38: System can notify Delivery Head on explicit events: interview scheduled, interview attended/missed, offer accepted/declined, placement started, and cost threshold breach.
FR39: Delivery Head can drill into recruiter performance metrics from notifications, view workload imbalance indicators by recruiter, and receive reassignment recommendations when workload variance exceeds 20% from team median for 3 consecutive days.
FR40: Admin can configure notification channels, cadence (daily/weekly/immediate), and metric thresholds per role and per customer.
FR41: User can log in via enterprise SSO for @cblsolutions.com users, with session persistence and remember device option (30 days).
FR42: System can enforce role-based access control: Recruiter, Delivery Head, Admin, Compliance Officer.
FR43: System can isolate multi-tenant data: Recruiter can only see their own customer candidates; no cross-customer visibility.
FR44: Admin can invite new users, assign roles, manage team membership, and audit all admin actions separately.
FR45: System can require step-up authentication for sensitive operations (data export, role changes, communication history access).
FR46: Dashboard displays operational metrics (candidates delivered, SMS response rate, interview request rate, conversion rate, time-to-fill) with refresh interval <=4 hours.
FR47: Dashboard shows per-recruiter metrics (productivity, conversion rate, attendance rate, cost-per-hire) with 30/60/90-day trend views.
FR48: Dashboard shows per-customer metrics (placements/month, revenue/recruiter/week, cost-per-hire, churn rate) with month-over-month delta.
FR49: Dashboard displays cost tracking per customer and per component (enrichment, SMS, email) with threshold alerts at 80/90/100% budget.
FR50: Delivery Head can view peer performance comparison and recommended support reassignments when a recruiter rolling 30-day conversion rate is >=15% below team average.
FR51: Delivery Head can view forecasted pipeline (30-60 day) and forecast-vs-actual cohort performance by month.
FR52: System can alert when KPI thresholds are breached (conversion rate <5%, SMS response rate <70%, cost-per-hire >$1,000).
FR53: Admin can export audit logs for compliance review (all user actions, data access, system events, timestamp, actor).
FR54: System can alert when cost triggers are hit (API spend >$1k/month, SMS >$200/placement, churn >10%).
FR55: System can forecast budget overspend (notify CFO/Admin at 80%, 90%, 100% of monthly budget).
FR56: System can capture 10 mandatory aviation-specific intake questions (aircraft type, tools, shift/AOG, decision-maker, red flags, etc.).
FR57: System can validate FAA A&P certifications with verification state (verified, unverified, expired) and 90-day revalidation cadence.
FR58: System can screen for airport badge eligibility (flag candidates with felony records, drug test history, mandatory clearances).
FR59: System can track drug test compliance status and generate drug test request letters.
FR60: System can maintain communication audit trail for every message (channel, timestamp, sender role, recipient, delivery status, response state, content hash) for GDPR/SOC 2.
FR61: System can flag candidates who fail mandatory pre-screening (missing tooling, cert issue, criminal record) with transparency into why.
FR62: System can implement GDPR deletion workflow (request intake, approval, purge execution, third-party confirmation, completion proof) within 30 days.
FR63: System can monitor external provider health and alert Admin when rolling 1-hour availability drops below 95%.
FR64: System can meter API usage per-customer and trigger alerts at 80% quota usage.
FR65: System can gracefully degrade if APIs fail: queue candidates for batch processing and notify recruiter of delay with ETA.
FR66: System can log all user actions in immutable append-only audit trail (5-year hot, 7-year cold).
FR67: System can detect anomalies (unusual access patterns, bulk data export, impossible geolocation changes) using severity thresholds and alert Compliance Officer within 15 minutes for high-severity events.
FR68: Admin can manually refresh candidate data from external sources if scheduled refresh fails.
FR69: System can back up data daily to immutable cold archive with encryption and integrity verification.
FR70: System can enforce USA-only data residency for customer data, logs, and backups within approved USA regions.
FR71: Candidate can log in via SMS token or email link and view profile.
FR72: Candidate can update availability status and seriousness inputs (tool ownership, badge readiness, decision timeline).
FR73: Candidate can view application status (applied -> screening -> interview -> offer -> placement -> started).
FR74: Candidate can receive status notifications for interview scheduled, interview attended/missed, offer sent, offer decision, and start-date confirmation.
FR75: Candidate can download offer letter and other documents from portal.

### NonFunctional Requirements

NFR1: Candidate list load <2 seconds p95 (100 concurrent recruiter load test).
NFR2: Candidate enrichment external provider call <10 seconds p95.
NFR3: Teams notification delivery <1 minute from scoring completion to Teams card rendered.
NFR4: Recruiter interaction logging <500ms p95 with visible UI acknowledgment in <=1 second.
NFR5: Dashboard metric refresh <2 seconds load time.
NFR6: Concurrent candidate enrichment 100 candidates/sec sustained in load test; initial 1M-record enrichment is overnight batch.
NFR7: SMS delivery throughput 1,000 SMS/minute peak capacity.
NFR8: 100 concurrent recruiter connections while maintaining candidate-list response <2 seconds p95.
NFR9: All PII encrypted at rest using industry-standard controls.
NFR10: All data in transit encrypted with TLS 1.3+ HTTPS only.
NFR11: Encryption keys managed in centralized KMS with automatic rotation at least every 90 days.
NFR12: Multi-tenancy isolation validated by automated adversarial test suite with zero cross-tenant read success.
NFR13: Session authentication uses enterprise SSO with 30-day remember device token and step-up MFA for sensitive operations.
NFR14: No hardcoded credentials; all secrets managed via centralized secrets service with audit logging.
NFR15: Anomaly detection alerts for failed logins, abnormal bulk downloads, and impossible geolocation shifts.
NFR16: API rate limiting by user, tenant, and endpoint with circuit breaker behavior.
NFR17: All user actions logged within 5 seconds with timestamp, user ID, action type, resource ID, and change delta.
NFR18: Communication audit trail queryable within 1 hour.
NFR19: Append-only audit store with no delete/update, verified quarterly.
NFR20: Audit logs cryptographically signed and backed up weekly to immutable archive.
NFR21: Audit retention is 5-year hot queryable and 7-year cold immutable archive, then purge.
NFR22: GDPR right-to-be-forgotten workflow completed within 30 days with verification across data stores and third parties.
NFR23: USA data residency for all customer data, logs, and backups in approved USA regions only.
NFR24: TCPA compliance enforces per-channel opt-out before outreach and processes opt-out within 24 hours.
NFR25: Aviation domain records for certification verification and related hiring decisions retained for 5 years.
NFR26: SOC 2 Type II audit-ready controls for access, change management, incident response, and DR testing.
NFR27: System uptime 99.5% excluding planned maintenance.
NFR28: API circuit breaker and queue-based graceful degradation for provider timeout >10 seconds.
NFR29: SMS/email provider outage uses 24-hour retry queue; no message drop.
NFR30: Database automated failover with <5 minute recovery target.
NFR31: Daily immutable backups with monthly recovery testing; RTO <1 hour, RPO <24 hours.
NFR32: Disaster recovery runbook documented and tested quarterly.
NFR33: Critical error alerting for DB errors, API quota breaches, auth outage, and uptime breaches.
NFR34: Tier 1 scale supports 50-100 recruiters and 50k records with <100ms query latency.
NFR35: Tier 3 scale supports 100-200 recruiters and 200-500k records with <100ms p95 query latency.
NFR36: Tier 2+ scale supports 200 recruiters and 5M records with <100ms query latency and 10x capacity headroom.
NFR37: Architecture supports 10x user growth with <10% performance degradation until 50M records.
NFR38: Horizontal scaling supports independently scaled processing services with asynchronous task orchestration.

### Additional Requirements

- Architecture mandates Next.js App Router TypeScript baseline as project starter; Epic 1 Story 1 must initialize from this baseline before feature work.
- Initial one-time 1M-record load must use an admin-supervised migration path, not the regular recruiter upload UI.
- Recruiter CSV upload path must support mapping wizard, live validation preview, per-row error report download, and max 10,000 records per upload; columns not mapped to canonical fields are retained in candidate extra_attributes (JSONB) with key normalization, blocked sensitive-key filtering, and per-row payload guardrails.
- ATS and recruiter-email ingestion paths must use source attribution and must never silently discard sync failures.
- Deduplication runs asynchronously; imported records move through pending states before activation.
- Candidate list/search at 1M+ scale requires cursor pagination and indexed pre-filters; no unfiltered show-all table mode.
- Outbox event generation must be transactional with state mutation; fire-and-forget webhook callbacks are not acceptable for critical event pipeline.
- Outreach and notification operations require idempotency keys, bounded retries, and dead-letter classification.
- Public candidate links require one-time token handling, expiry, replay protection, and endpoint rate limiting.
- High-impact actions (bulk changes, exports, compliance overrides) require human-in-the-loop confirmation.
- Every decision/action path must be tenant-scoped and correlation-ID traceable in append-only audit history.
- Goal execution requires hard max iterations and max consecutive failures before enforced pause/escalation.
- Communication UX must enforce candidate contact windows and include pause availability controls without forcing global opt-out.
- Candidate portal should support see-before-share trust pattern and transparent preference controls.
- Recruiter experience must support motivation-first ranking context and visible rejection reasons with controlled override path.
- Dashboard UX must scale from top-5 action view to larger queues via progressive disclosure without overwhelming users.
- Teams outage and provider outage fallback UX must route users to alternate channel notifications and visible status.
- All recurring business schedules must use the global scheduler control plane backed by versioned schedule and policy records; feature workers may own retry timers, but not product-visible cadences.
- Schedule taxonomy must stay explicit in implementation work: business schedules are centrally managed, retry timers remain execution-local, and lock/cooldown windows are enforced from policy/domain state rather than modeled as recurring jobs.

### FR Coverage Map

FR1: Epic 2 - Candidate ingestion from recruiter CSV uploads
FR1a: Epic 2 - Initial 1M-record migration path
FR2: Epic 2 - ATS and recruiter inbox sync ingestion
FR3: Epic 2 - Candidate profile storage and indexing
FR4: Epic 2 - Deterministic deduplication and manual review routing
FR5: Epic 2 - Availability state lifecycle management
FR6: Epic 8 - Retention and deletion policy execution
FR7: Epic 2 - Recruiter profile visibility with enrichment context
FR8: Epic 3 - SMS outreach composition and scheduling
FR9: Epic 3 - Email outreach composition and governance
FR10: Epic 3 - Per-channel communication preferences and consent
FR11: Epic 3 - Candidate response capture and structured seriousness fields
FR12: Epic 3 - Delivery and response tracking by recruiter/customer/pool
FR13: Epic 3 - Channel-specific opt-out enforcement
FR14: Epic 8 - Regulatory outreach auditability and TCPA controls
FR15: Epic 3 - Failed delivery retry policy and terminal handling
FR16: Epic 3 - One-time token candidate registration path
FR17: Epic 3 - Bulk campaign execution at scale
FR18: Epic 4 - Recruiter job intake workflow
FR19: Epic 4 - Daily ranked candidate view by job
FR20: Epic 5 - Structured match reason transparency
FR21: Epic 4 - Recruiter interaction logging
FR22: Epic 4 - Candidate journey lifecycle tracking
FR23: Epic 4 - Formal offer workflow and turnaround tracking
FR24: Epic 4 - Bulk status/tag/job updates
FR25: Epic 4 - Candidate export workflow with context preservation
FR26: Epic 1 - Multi-client context safety controls
FR27: Epic 7 - Recruiter personal productivity and conversion metrics
FR28: Epic 5 - Weighted opportunity scoring engine
FR29: Epic 5 - Availability signal freshness validation
FR30: Epic 5 - Seriousness model and state assignment
FR31: Epic 5 - Mandatory domain requirement screening
FR32: Epic 5 - Hard-fail rejection reason coding
FR33: Epic 5 - Confidence recalibration against outcomes
FR34: Epic 5 - Candidate data refresh cadence management
FR35: Epic 5 - Seasonal weighting adjustments and override controls
FR36: Epic 6 - Daily Teams top-5 candidate digests
FR37: Epic 6 - Rich Teams action cards
FR38: Epic 6 - Delivery head event notifications
FR39: Epic 6 - Workload imbalance drill-down and recommendations
FR40: Epic 6 - Notification channel/cadence/threshold admin controls
FR41: Epic 1 - Enterprise SSO authentication
FR42: Epic 1 - Role-based access control enforcement
FR43: Epic 1 - Tenant isolation and scoped data access
FR44: Epic 1 - Admin user lifecycle and admin audit trail
FR45: Epic 1 - Step-up authentication for sensitive actions
FR46: Epic 7 - Operational KPI dashboard
FR47: Epic 7 - Per-recruiter trend metrics
FR48: Epic 7 - Per-customer business metrics
FR49: Epic 7 - Cost component dashboard with budget thresholds
FR50: Epic 7 - Peer performance analysis and support recommendations
FR51: Epic 7 - Forecasted pipeline and forecast-vs-actual views
FR52: Epic 7 - KPI breach alerting
FR53: Epic 8 - Compliance audit log export
FR54: Epic 7 - Cost trigger alerts
FR55: Epic 7 - Budget overspend forecasting alerts
FR56: Epic 4 - Aviation intake question capture
FR57: Epic 5 - FAA A&P verification lifecycle
FR58: Epic 5 - Airport badge eligibility screening
FR59: Epic 5 - Drug test compliance tracking and letter generation
FR60: Epic 8 - Communication audit trail completeness
FR61: Epic 5 - Pre-screen failure transparency
FR62: Epic 8 - GDPR deletion workflow completion proof
FR63: Epic 8 - External provider health monitoring
FR64: Epic 8 - Per-customer API metering and quota alerts
FR65: Epic 8 - Graceful degradation and delayed processing UX
FR66: Epic 8 - Immutable append-only user action logging
FR67: Epic 8 - Security anomaly detection and compliance escalation
FR68: Epic 2 - Admin-triggered manual refresh of candidate data
FR69: Epic 8 - Immutable encrypted backup workflow
FR70: Epic 1 - USA-only data residency guardrails
FR71: Epic 9 - Candidate portal login and profile access
FR72: Epic 9 - Candidate self-service availability and seriousness updates
FR73: Epic 9 - Candidate application status visibility
FR74: Epic 9 - Candidate lifecycle status notifications
FR75: Epic 9 - Offer/document download in candidate portal

## Epic List

### Epic 1: Platform Foundation, Access, and Tenant Security

Establish the deployable baseline with enterprise authentication, role-safe access boundaries, and tenant/data-residency controls so all future epics can build safely.
**FRs covered:** FR26, FR41, FR42, FR43, FR44, FR45, FR70

### Epic 2: Candidate Data Ingestion and Profile Lifecycle

Enable trusted candidate ingestion from migration, recruiter uploads, ATS, and inbox channels with deduplication, indexing, and profile lifecycle operations.
**FRs covered:** FR1, FR1a, FR2, FR3, FR4, FR5, FR7, FR68

### Epic 3: Outreach Orchestration and Candidate Engagement

Enable compliant outbound communication and inbound candidate response handling for single-send and bulk campaign operations.
**FRs covered:** FR8, FR9, FR10, FR11, FR12, FR13, FR15, FR16, FR17

### Epic 4: Recruiter Delivery Workflow and Offer Management

Enable recruiters to intake jobs, operate daily pipelines, move candidates through journey states, and execute offer workflows.
**FRs covered:** FR18, FR19, FR21, FR22, FR23, FR24, FR25, FR56

### Epic 5: Matching Intelligence and Domain Qualification

Provide transparent ranking, readiness scoring, and aviation-specific qualification intelligence that guides recruiter action.
**FRs covered:** FR20, FR28, FR29, FR30, FR31, FR32, FR33, FR34, FR35, FR57, FR58, FR59, FR61

### Epic 6: Collaboration and Notification Workflows

Deliver role-aware notifications and action cards so recruiters and delivery heads can respond quickly without dashboard thrash.
**FRs covered:** FR36, FR37, FR38, FR39, FR40

### Epic 7: Metrics, Cost Governance, and Forecasting

Provide operational, financial, and performance insights with thresholding and forecasting for recruiter and leadership decision-making.
**FRs covered:** FR27, FR46, FR47, FR48, FR49, FR50, FR51, FR52, FR54, FR55

### Epic 8: Compliance, Reliability, and Operational Guardrails

Implement immutable auditability, retention/deletion obligations, resilience controls, and security monitoring to keep operations compliant and trustworthy.
**FRs covered:** FR6, FR14, FR53, FR60, FR62, FR63, FR64, FR65, FR66, FR67, FR69

### Epic 9: Candidate Self-Service Portal Experience

Enable candidates to securely self-serve profile, status, and document workflows from token-based portal access.
**FRs covered:** FR71, FR72, FR73, FR74, FR75

## Story Sizing Baseline (One-Week Ideal, Two-Week Max)

- Strategic epics above are product-value containers.
- Delivery planning should use timeboxed execution epics below.
- S = 1-2 dev days (small, low integration)
- M = 3-4 dev days (moderate integration across 1-2 services)
- L = 5+ dev days (must be split before commitment)

### Story Size Reference

- Story 1.1: M
- Story 1.2: M
- Story 1.3: M
- Story 1.4: M
- Story 1.5: S
- Story 1.6: S
- Story 1.7: S
- Story 2.1: M
- Story 2.2: M
- Story 2.2a: M
- Story 2.3: M
- Story 2.4: S
- Story 2.4a: S
- Story 2.4b: M
- Story 2.5: M
- Story 2.6: S
- Story 2.7: M
- Story 3.1: S
- Story 3.2: S
- Story 3.3: M
- Story 3.4: M
- Story 3.5: S
- Story 3.6: S
- Story 3.7: M
- Story 4.1: S
- Story 4.2: M
- Story 4.3: M
- Story 4.4: M
- Story 4.5: M
- Story 5.1: M
- Story 5.2: S
- Story 5.3: M
- Story 5.4: S
- Story 5.5: S
- Story 5.6: M
- Story 6.1: S
- Story 6.2: M
- Story 6.3: M
- Story 6.4: S
- Story 7.1: M
- Story 7.2: M
- Story 7.3: M
- Story 7.4: S
- Story 7.5: M
- Story 8.1: M
- Story 8.2: M
- Story 8.3: M
- Story 8.4: M
- Story 8.5: S
- Story 8.6: S
- Story 9.1: S
- Story 9.2: S
- Story 9.3: S
- Story 9.4: S
- Story 9.5: S

## 4-Week Plan by Strategic Epic (9 Epics, Parallel)

### Plan Rules

- This plan executes and tracks work at the 9-epic level; package mapping below is FYI only.
- Target remains full product completion by end of Week 4.
- Each epic should be 1 week ideal and 2 weeks maximum.
- Per-person WIP cap is 2 concurrent epics per week.
- Parallel execution is required; epics overlap by design.

### Required Delivery Capacity

- 2 squad members: squad-member-1 and squad-member-2.
- Work is split by epic ownership with daily integration sync to control dependency risk.

### 9-Epic Calendar

| Epic                                                        | Owner          | Start  | Finish | Dependency Gate                                                  |
| ----------------------------------------------------------- | -------------- | ------ | ------ | ---------------------------------------------------------------- |
| Epic 1: Platform Foundation, Access, and Tenant Security    | squad-member-1 | Week 1 | Week 2 | None                                                             |
| Epic 2: Candidate Data Ingestion and Profile Lifecycle      | squad-member-2 | Week 1 | Week 2 | Core platform contracts from Epic 1 frozen                       |
| Epic 3: Outreach Orchestration and Candidate Engagement     | squad-member-1 | Week 1 | Week 2 | Core platform contracts from Epic 1 frozen                       |
| Epic 4: Recruiter Delivery Workflow and Offer Management    | squad-member-2 | Week 3 | Week 3 | Candidate ingestion and outreach interfaces complete             |
| Epic 5: Matching Intelligence and Domain Qualification      | squad-member-1 | Week 3 | Week 4 | Candidate signals available and Epic 4 workflow contracts frozen |
| Epic 6: Collaboration and Notification Workflows            | squad-member-2 | Week 4 | Week 4 | Epic 4 and Epic 5 payload contracts frozen                       |
| Epic 7: Metrics, Cost Governance, and Forecasting           | squad-member-1 | Week 3 | Week 3 | Workflow event streams and initial scoring outputs available     |
| Epic 8: Compliance, Reliability, and Operational Guardrails | squad-member-2 | Week 3 | Week 4 | Security baseline from Epic 1 complete                           |
| Epic 9: Candidate Self-Service Portal Experience            | squad-member-1 | Week 4 | Week 4 | Outreach tokens and Epic 4 workflow status APIs available        |

### FYI Package Mapping (X1-X27 -> Epics)

This mapping is reference-only for decomposition visibility. Planning, ownership, and execution remain epic-based.

| Package | Brief Name                                                | Mapped Epic | Story Coverage |
| ------- | --------------------------------------------------------- | ----------- | -------------- |
| X1      | Platform Bootstrap and SSO                                | Epic 1      | 1.1, 1.2       |
| X2      | Authorization and Admin Controls                          | Epic 1      | 1.3, 1.4       |
| X3      | Security Hardening and Client Safety                      | Epic 1      | 1.5, 1.6, 1.7  |
| X4      | Initial Migration Path                                    | Epic 2      | 2.1            |
| X5      | CSV/Resume Ingestion and Indexing                         | Epic 2      | 2.2, 2.2a, 2.4, 2.4a, 2.4b |
| X6      | External Sync and Deduplication                           | Epic 2      | 2.3, 2.5       |
| X7      | Availability Lifecycle, Refresh, and Scheduler Foundation | Epic 2      | 2.6, 2.7       |
| X8      | Outbound Messaging Foundations                            | Epic 3      | 3.1, 3.2       |
| X9      | Consent and Channel Preferences                           | Epic 3      | 3.3            |
| X10     | Response Capture and Delivery Reliability                 | Epic 3      | 3.4, 3.5       |
| X11     | Token Onboarding and Bulk Campaigns                       | Epic 3      | 3.6, 3.7       |
| X12     | Job Intake and Candidate Queue                            | Epic 4      | 4.1, 4.2       |
| X13     | Recruiter Execution and Bulk Ops                          | Epic 4      | 4.3, 4.4       |
| X14     | Offer Workflow Completion                                 | Epic 4      | 4.5            |
| X15     | Scoring and Freshness Signals                             | Epic 5      | 5.1, 5.2       |
| X16     | Domain Screening and FAA Verification                     | Epic 5      | 5.3, 5.4       |
| X17     | Drug Compliance and Recalibration                         | Epic 5      | 5.5, 5.6       |
| X18     | Teams Collaboration Surface                               | Epic 6      | 6.1, 6.2       |
| X19     | Delivery Oversight and Policy Controls                    | Epic 6      | 6.3, 6.4       |
| X20     | Operational and Trend Analytics                           | Epic 7      | 7.1, 7.2       |
| X21     | Cost Governance and Peer Support                          | Epic 7      | 7.3, 7.4       |
| X22     | Forecasting and KPI Alerts                                | Epic 7      | 7.5            |
| X23     | Audit and Retention Controls                              | Epic 8      | 8.1, 8.2       |
| X24     | GDPR and Reliability Degradation                          | Epic 8      | 8.3, 8.4       |
| X25     | Health Monitoring and Security Escalation                 | Epic 8      | 8.5, 8.6       |
| X26     | Portal Access and Status Visibility                       | Epic 9      | 9.1, 9.3       |
| X27     | Candidate Updates and Documents                           | Epic 9      | 9.2, 9.4, 9.5  |

### Weekly Objectives

- Week 1: Start Epic 1, Epic 2, Epic 3 in parallel; baseline implementation and integration lanes.
- Week 2: Complete Epic 1, Epic 2, Epic 3 and freeze shared contracts.
- Week 3: Execute Epic 4 and Epic 7 as one-week deliveries; start Epic 5 and Epic 8.
- Week 4: Complete Epic 5 and Epic 8; deliver Epic 6 and Epic 9; run end-to-end hardening.

### Critical Risk Note

- This 4-week target is feasible only with disciplined parallel staffing, strict WIP control, and contract freeze discipline.
- If any Week 3 dependency slips, immediately defer non-critical scope behind feature flags to preserve date.

## Epic 1: Platform Foundation, Access, and Tenant Security

Initialize the production foundation and enforce identity, authorization, and tenant boundaries before feature surfaces are exposed.

### Story 1.1: Initialize Next.js Baseline with Core Platform Modules

As a platform engineer,
I want to initialize the application from the approved Next.js TypeScript starter with module boundaries,
So that all subsequent stories build on a consistent architecture baseline.

**Acceptance Criteria:**

**Given** an empty application workspace
**When** the baseline scaffold is created with required runtime/tooling configuration
**Then** the app builds and runs with lint/type checks passing
**And** core module boundaries for auth, tenants, audit, and ingestion are present

### Story 1.2: Implement Enterprise SSO and Session Controls

As an internal user,
I want to authenticate with enterprise SSO and managed session persistence,
So that access is secure and aligned with organizational identity policy.

**Acceptance Criteria:**

**Given** a valid enterprise identity
**When** the user signs in through SSO
**Then** an authenticated session is created with remember-device support up to 30 days
**And** session expiration and revocation behavior is enforced server-side

### Story 1.3: Enforce RBAC and Tenant-Isolated Authorization

As a security engineer,
I want every read/write path to enforce role and tenant checks,
So that users cannot access data outside their allowed scope.

**Acceptance Criteria:**

**Given** authenticated users with different roles and tenants
**When** they access protected APIs and UI routes
**Then** only role-permitted operations succeed
**And** cross-tenant access attempts are denied and audited in Supabase Postgres with tenant-safe filtering across relational and vector retrieval paths

### Story 1.4: Build Admin User and Team Management Console

As an admin,
I want to invite users, assign roles, and manage team membership,
So that workforce onboarding and governance are controlled centrally.

**Acceptance Criteria:**

**Given** an admin user
**When** they create invitations or change role/team assignments
**Then** changes apply immediately with validation of allowed role transitions
**And** admin actions are written to a separate auditable admin action stream persisted in Supabase Postgres and queryable with tenant-safe vector-assisted retrieval

### Story 1.5: Add Step-Up Auth for Sensitive Operations

As a compliance officer,
I want sensitive workflows to require fresh authentication,
So that high-impact actions are protected from session misuse.

**Acceptance Criteria:**

**Given** a user with an active session
**When** they attempt export, role change, or communication-history access
**Then** a step-up challenge is required before completion
**And** successful and failed step-up attempts are audited in a dedicated Supabase-backed step-up stream, including traceable records for relational and vector search

### Story 1.6: Enforce USA Data Residency Policy Gates

As a platform owner,
I want storage and backup targets constrained to approved USA regions,
So that residency commitments are enforced by architecture and configuration.

**Acceptance Criteria:**

**Given** deployment and storage configuration
**When** non-approved region targets are configured
**Then** deployment or provisioning is blocked with explicit error messaging
**And** compliance evidence for active region settings is queryable

### Story 1.7: Add Active Client Context Safeguards

As a recruiter managing multiple clients,
I want explicit active-client indicators and cross-client action confirmations,
So that I avoid accidental operations in the wrong client context.

**Acceptance Criteria:**

**Given** a recruiter with access to multiple client contexts
**When** they execute candidate update/export actions
**Then** the active client is clearly displayed and included in request scope
**And** cross-client action attempts require explicit confirmation

### Story 1.8: Extract Data Service Repositories and Eliminate Route DB Calls

As a platform engineer,
I want all database access routed through dedicated repository functions,
So that route handlers are decoupled from the DB schema and query logic is reusable, testable, and consistent.

**Acceptance Criteria:**

**Given** any API route handler
**When** it needs to read or write data
**Then** it calls a named repository/module function — never `getSupabaseAdminClient()` directly
**And** `ImportBatchRepository`, `SubmissionRepository` exist with in-memory test support
**And** cross-client confirmation token logic lives in `modules/auth/`

### Story 1.9: Create Centralized AI Inference Service with Prompt Registry

As a platform engineer,
I want all LLM/AI interactions routed through a centralized inference service with prompt versioning,
So that future AI features (scoring, matching, outreach drafting) reuse the same client, retry, cost tracking, and prompt management patterns.

**Acceptance Criteria:**

**Given** any code that needs to call an LLM
**When** it makes the call
**Then** it uses the shared client from `modules/ai/` with structured logging and prompt versioning
**And** prompts are loadable from the `prompt_registry` table
**And** existing extraction behavior is unchanged

### Story 1.10: Implement Shared API Auth Middleware

As a platform engineer,
I want a reusable auth middleware wrapper for API routes,
So that session-validation, RBAC, step-up, and audit enforcement is defined once — not copy-pasted across 15+ handlers.

**Acceptance Criteria:**

**Given** any protected API route handler
**When** it needs auth enforcement
**Then** it uses `withAuth(handler, options)` wrapper
**And** all existing route behavior and tests are preserved

## Epic 2: Candidate Data Ingestion and Profile Lifecycle

Create the ingest-to-profile pipeline from migration and ongoing channels so candidate data remains high quality at scale.

### Story 2.1: Build Admin-Supervised Initial 1M Record Migration Pipeline

As an admin,
I want a one-time migration path for the initial candidate corpus,
So that legacy records are loaded safely with rollback and progress visibility.

**Acceptance Criteria:**

**Given** a migration batch submission
**When** processing runs in bounded chunks
**Then** progress metrics and failure rates are recorded per chunk
**And** rollback controls are available when error thresholds are exceeded

### Story 2.2: Implement Recruiter CSV Upload Wizard and Validation

As a recruiter,
I want to upload CSV candidate files with mapping and validation,
So that I can quickly add candidate pools with actionable error feedback.

**Acceptance Criteria:**

**Given** a recruiter CSV file up to 10,000 records
**When** the upload wizard runs validation and column mapping
**Then** invalid rows are reported with downloadable per-row errors
**And** valid rows are written into an import batch for background processing
**And** unmapped columns are retained in candidate extra_attributes (JSONB) with guardrails applied

### Story 2.2a: Implement Recruiter PDF Resume Upload with LLM Extraction

As a recruiter,
I want to upload PDF resumes (single or multiple via folder) and have the system extract candidate data automatically,
So that I can ingest candidates without manually converting resumes into CSV format.

**Acceptance Criteria:**

**Given** a recruiter uploads one or more PDF files (single file or folder, no hard cap)
**When** the system processes each PDF through LLM-powered extraction (batched internally)
**Then** extracted candidate data is presented for recruiter review before committing
**And** confirmed candidates are persisted with `source: resume_upload` attribution
**And** each PDF is stored in Supabase Storage and linked via `candidate_submissions`
**And** non-PDF files are rejected with a clear message requiring PDF conversion
**And** failed extractions display actionable per-file error messages
**And** a progress tracker shows overall and per-file extraction status for large uploads

### Story 2.3: Implement ATS and Email Ingestion Connectors

As a system integrator,
I want ATS polling and recruiter inbox parsing feeds,
So that candidate records are continuously synchronized from external sources.

**Acceptance Criteria:**

**Given** configured ATS and inbox connectors
**When** scheduler-emitted sync jobs execute
**Then** new or updated candidates are upserted through standard ingestion pipeline
**And** sync failures are surfaced with source-attributed error tracking

### Story 2.4: Implement Candidate Profile Storage and Indexing

As a recruiter,
I want candidate profiles stored with searchable core attributes,
So that I can find and review talent quickly.

**Acceptance Criteria:**

**Given** ingested candidate records
**When** profile persistence completes
**Then** core attributes and enrichment fields are queryable via indexed paths
**And** profile detail views include source and ingestion metadata

### Story 2.4a: Dashboard UI Standardization

As a recruiter, admin, or delivery head,
I want all dashboard screens to have a consistent, clean visual design with white backgrounds, readable fonts, and uniform navigation,
so that the application feels professional and I can navigate confidently across all sections.

**Acceptance Criteria:**

**Given** any dashboard page (`/dashboard/**`)
**When** the page renders
**Then** the background is white, the header is sticky with `text-base` breadcrumb navigation, a consistent footer is present, all content uses `max-w-6xl` container, minimum font size is `text-xs` (12px), colors use `gray-*`/`emerald-*` palette, and cards use `rounded-xl` borders
**And** the full design system is documented in `cblaero/docs/dashboard-ui-standards.md` and enforced via development-standards.md §27 and code-review workflow checks

### Story 2.4b: Sync Run Summary and Error Management

As an admin,
I want batch-level sync run summaries on the dashboard with drill-down into individual errors per run,
so that I can understand which ingestion runs failed and why.

**Acceptance Criteria:**

**Given** any ingestion job runs
**When** the job completes
**Then** a `sync_runs` row tracks source, status, counts, and timestamps; the admin dashboard shows current month's runs in a SyncRunSummaryCard; failed runs link to a detail page with errors grouped by type
**And** run tracking never blocks ingestion (returns null on failure), both tables auto-prune after 30 days

### Story 2.5: Implement Deterministic Deduplication and Manual Review Queue

As a data steward,
I want deterministic merge thresholds and manual-review routing,
So that duplicate outreach is prevented without unsafe auto-merges.

**Acceptance Criteria:**

**Given** candidate identity collisions
**When** identity confidence is evaluated
**Then** >=95% candidates auto-merge, 70-94% route to manual review, and <70% remain separate
**And** dedupe decisions are logged with rationale for auditability

### Story 2.6: Implement Availability State and Manual Refresh Operations

As a recruiter,
I want availability lifecycle tracking and manual refresh controls,
So that candidate readiness reflects fresh information when automation lags.

**Acceptance Criteria:**

**Given** candidate engagement and self-reported updates
**When** availability state is recalculated or manually refreshed
**Then** active/passive/unavailable states are updated with timestamped provenance
**And** stale state detection is visible in recruiter views
**And** manual refresh creates an ad hoc job without mutating recurring schedule definitions

### Story 2.7: Implement Global Scheduler Control Plane

As a platform engineer,
I want one auditable scheduler for recurring business jobs,
So that ATS syncs, inbox scans, refresh sweeps, and future digests do not rely on per-worker timers.

**Acceptance Criteria:**

**Given** due recurring business schedules
**When** the scheduler claims work
**Then** it emits outbox jobs idempotently and records schedule-run history with tenant and policy version context
**And** workers remain event-driven consumers instead of owning business-level timers

**Given** admin-authored cadence changes
**When** validated updates are saved
**Then** new versions apply only to subsequent scheduled runs

**Implementation Notes (from Story 2.3, updated after code review pass 7):**
- `registerIngestionJobs(scheduler)` in `cblaero/src/modules/ingestion/jobs.ts` registers four jobs:
  - `EmailIngestionJob` — stream-processes `submissions-inbox@cblsolutions.com` via Microsoft Graph (`$filter=isRead eq false`). LLM classifies each email, uploads all attachments to Supabase Storage, upserts candidates via `.upsert()`, marks as read via Graph PATCH. Failed emails stay unread for retry. Recommended cadence: **15 minutes**. Dedup by fingerprint (`email_message_id`) + submission dedup.
  - `CeipalIngestionJob` — polls Ceipal ATS v1 API with DB-backed incremental `since` tracking (via `getLastCandidateUpdateBySource`). Recommended cadence: **daily** with `maxPages: 20` for incremental sync. Uses `recordFingerprintBatch()` for efficient bulk fingerprinting. Dedup by fingerprint (`ats_external_id`) — skips applicants without `ceipalId`.
  - `OneDriveResumePollerJob` — polls configured OneDrive folder for PDFs, extracts via LLM, persists via `process_import_chunk` RPC. Deletes from OneDrive only after confirmed Supabase Storage backup.
  - `SavedSearchDigestJob` — sends daily digest emails for saved searches via Graph sendMail.
- All jobs implement `SchedulerJob` interface (`name: string`, `run(): Promise<void>`)
- `GlobalScheduler` stub was **removed** in code review pass 7 — Story 2.7 must implement from scratch using the Postgres-backed `schedule_definitions`/`schedule_runs` design
- **Interim:** Render Cron Jobs call `/api/internal/jobs/run` endpoint (email: every 15 min, Ceipal: daily, OneDrive: hourly). Cron jobs are temporary until Story 2.7.

**Cold-Start / Server Wake-Up Requirement (learned from interim cron failures):**
- Render free tier spins down after 15 minutes of inactivity. Jobs that run less frequently than every 15 minutes (Ceipal daily, OneDrive hourly) hit a cold/sleeping server and fail with `fetch failed`.
- **The global scheduler MUST handle cold-start wake-up before dispatching jobs.** Implementation options:
  1. **Health-check probe before dispatch:** Scheduler pings the health endpoint, waits for 200, then dispatches the job. Timeout + retry if server is still cold.
  2. **In-process scheduler:** Run the scheduler loop inside the web process itself (not as a separate cron). Jobs execute in-process, no HTTP call needed. Server stays warm as long as the process is alive.
  3. **Keep-alive heartbeat:** Scheduler emits a lightweight ping every 10 minutes to prevent spin-down. All jobs then dispatch to a guaranteed-warm server.
- Option 2 (in-process) is preferred for Render — avoids the HTTP round-trip entirely and eliminates the cold-start problem. The scheduler loop runs on a `setInterval` inside the Next.js server, claims due `schedule_definitions` rows, and calls job `.run()` directly.
- If using external dispatch (option 1), the wake-up probe must be the **first step** in every schedule run, not just for infrequent jobs — any job can hit a cold server after a deploy or crash restart.

**And** prior runs remain auditable against the schedule and policy version in effect at execution time

## Epic 3: Outreach Orchestration and Candidate Engagement

Create compliant communication workflows for outbound outreach and inbound candidate response at individual and campaign scale.

### Story 3.1: Build SMS Outreach Template and Scheduling Workflow

As a recruiter,
I want to compose and schedule SMS messages from templates,
So that outreach is fast, personalized, and sent within candidate contact windows.

**Acceptance Criteria:**

**Given** a candidate segment and SMS template
**When** outreach is scheduled
**Then** send windows enforce candidate time preferences
**And** all outbound messages carry campaign and template version metadata
**And** due sends are emitted by the global scheduler rather than feature-local timers

### Story 3.2: Build Email Outreach Templates with Role Permissions

As a recruiter lead,
I want role-governed email template editing and version history,
So that communication quality and compliance remain controlled.

**Acceptance Criteria:**

**Given** users with different roles
**When** they view or edit email templates
**Then** permission checks enforce allowed actions
**And** template revisions are versioned with author and timestamp

### Story 3.3: Implement Consent, Opt-Out, and Channel Preference Engine

As a compliance officer,
I want per-channel consent state and opt-out enforcement,
So that outreach always respects TCPA and candidate intent.

**Acceptance Criteria:**

**Given** candidate communication preferences
**When** outreach execution is requested
**Then** blocked channels are prevented from sending
**And** opt-out actions are applied within policy windows and audited

### Story 3.4: Capture Candidate Responses and Seriousness Inputs

As a recruiter,
I want candidate replies normalized into availability and seriousness fields,
So that follow-up priorities are data-driven.

**Acceptance Criteria:**

**Given** inbound SMS/email responses
**When** parsing and validation complete
**Then** structured fields (contact window, tooling, badge readiness, timeline) are saved
**And** parsing confidence/failure paths are visible for manual correction

### Story 3.5: Track Delivery Outcomes and Retry Failed Sends

As an operations user,
I want outbound delivery telemetry and bounded retries,
So that failed communication is recovered predictably and observable.

**Acceptance Criteria:**

**Given** outbound messages with provider callbacks
**When** delivery failures occur
**Then** retry policy applies up to three attempts with escalating delay
**And** terminal undeliverable state triggers alerting and reporting visibility

### Story 3.6: Enable Candidate One-Time Token Registration

As a product owner,
I want secure candidate registration links,
So that candidate onboarding remains safe and compliant.

**Acceptance Criteria:**

**Given** one-time registration links
**When** candidates authenticate
**Then** one-time token validation enforces expiry and replay protection
**And** successful and failed token attempts are auditable

### Story 3.7: Implement Bulk Campaign Execution at Scale

As a recruiter,
I want to launch and monitor bulk campaigns,
So that high-volume outreach remains observable and performant.

**Acceptance Criteria:**

**Given** campaign definitions and candidate segments
**When** a bulk campaign runs
**Then** execution supports 50-5,000 targets with completion reporting
**And** campaign targeting uses pre-computed index slices at large record scale

## Epic 4: Recruiter Delivery Workflow and Offer Management

Deliver the recruiter operating loop from job intake to offer execution with clear lifecycle transitions.

### Story 4.1: Implement Job Intake with Mandatory Aviation Questions

As a recruiter,
I want to create job requirements using mandatory intake structure,
So that matching and qualification evaluate complete context.

**Acceptance Criteria:**

**Given** a new job intake
**When** recruiter submits job details
**Then** all mandatory aviation question fields are validated and stored
**And** incomplete intake cannot proceed to active matching

### Story 4.2: Build Daily Candidate Queue View by Job

As a recruiter,
I want a daily-refreshed candidate queue per job,
So that I can focus on high-value outreach and interviews.

**Acceptance Criteria:**

**Given** an active job
**When** recruiter opens the candidate queue
**Then** candidates are shown in ranked order with refresh metadata
**And** filters preserve performance at large record counts

### Story 4.3: Implement Interaction Logging and Journey State Machine

As a recruiter,
I want to log candidate interactions and transition journey states,
So that pipeline execution and accountability are accurate.

**Acceptance Criteria:**

**Given** candidate interaction events
**When** recruiter logs call/SMS/interview actions
**Then** journey states transition through allowed paths only
**And** attendance confirmation and state history are preserved

### Story 4.4: Build Bulk Candidate Operations and Export Workflow

As a recruiter,
I want to run batch updates and exports with safeguards,
So that operational throughput increases without context loss.

**Acceptance Criteria:**

**Given** selected candidate sets between 50 and 1,000 records
**When** recruiter executes bulk update or export
**Then** success/failure summaries are returned per operation
**And** exported records preserve score, reason summary, and communication status

### Story 4.5: Implement Formal Offer Workflow

As a recruiter,
I want to create, route, send, and track offers,
So that late-stage pipeline outcomes are managed in-system.

**Acceptance Criteria:**

**Given** a candidate in offer-eligible state
**When** recruiter initiates offer workflow
**Then** sign-off, send, and accept/decline outcomes are captured
**And** turnaround time metrics are generated for reporting

## Epic 5: Matching Intelligence and Domain Qualification

Implement transparent scoring and qualification intelligence that explains why a candidate is recommended or rejected.

### Story 5.1: Implement Weighted Opportunity Scoring Core

As a recruiter,
I want opportunity scores based on explicit weighted factors,
So that ranking logic is explainable and consistent.

**Acceptance Criteria:**

**Given** candidate and job inputs
**When** scoring executes
**Then** score output uses configured weights for skills, availability, location, and domain requirements
**And** score breakdown is retrievable for transparency

### Story 5.2: Build Availability Freshness and Seriousness Computation

As a recruiter,
I want freshness and seriousness state computed from recent behavior,
So that stale or weak-intent candidates are deprioritized.

**Acceptance Criteria:**

**Given** candidate engagement history and stated preferences
**When** state computation runs
**Then** stale availability older than seven days is marked appropriately
**And** seriousness state is assigned using explicit, testable rules

### Story 5.3: Implement Domain Screening and Rejection Reason Codes

As a recruiter,
I want mandatory aviation requirements screened with explicit failure reasons,
So that decisions are trustworthy and reviewable.

**Acceptance Criteria:**

**Given** candidate qualification inputs
**When** domain screening runs
**Then** A&P, badge, felony, and tooling checks evaluate deterministically
**And** failing candidates are tagged with standardized rejection reason codes

### Story 5.4: Implement FAA Verification Lifecycle

As a compliance officer,
I want certification verification lifecycle tracking,
So that FAA requirements are enforced consistently.

**Acceptance Criteria:**

**Given** candidates in aviation roles
**When** compliance checks are triggered or refreshed
**Then** FAA verification state supports verified/unverified/expired with 90-day cadence
**And** verification state changes are fully auditable

### Story 5.5: Implement Drug Test Compliance Tracking

As a compliance officer,
I want drug-test status and letter workflows tracked in-system,
So that required screening artifacts are complete and reviewable.

**Acceptance Criteria:**

**Given** candidates requiring drug-test compliance
**When** drug-test status changes or request letters are generated
**Then** status transitions are captured with responsible actor and timestamp
**And** generated letters are linked to candidate compliance history

### Story 5.6: Build Confidence Recalibration and Seasonal Adjustment Controls

As a delivery lead,
I want periodic confidence calibration and seasonal weighting controls,
So that model quality and hiring context remain aligned over time.

**Acceptance Criteria:**

**Given** historical conversion outcomes and seasonal configuration
**When** monthly recalibration runs
**Then** top-quintile precision metrics are produced and compared to target
**And** delivery-head overrides are applied with full audit trail

## Epic 6: Collaboration and Notification Workflows

Deliver role-specific collaboration signals and action paths through Teams and configurable notification channels.

### Story 6.1: Implement Recruiter Daily Top-5 Teams Digest

As a recruiter,
I want a daily Teams summary of top candidates per job,
So that I can begin execution from prioritized opportunities.

**Acceptance Criteria:**

**Given** daily scoring outputs
**When** digest generation runs
**Then** each active job publishes top-5 candidates with reason snippets
**And** digest includes links/actions for immediate follow-up
**And** digest runs are emitted from the centralized scheduler with tenant-local cadence handling

### Story 6.2: Implement Rich Teams Action Cards

As a recruiter,
I want interactive Teams cards with one-click actions,
So that I can act without switching systems for every candidate step.

**Acceptance Criteria:**

**Given** an eligible notification event
**When** Teams card payload is rendered
**Then** card includes candidate summary, confidence context, and call/email actions
**And** action outcomes sync back to workflow state in near real time

### Story 6.3: Build Delivery Head Event and Workload Alerts

As a delivery head,
I want event-triggered alerts and workload imbalance detection,
So that I can intervene when pipeline execution or staffing risk appears.

**Acceptance Criteria:**

**Given** interview/offer/placement and workload data
**When** trigger conditions are met
**Then** delivery-head alerts include event context and recommended next action
**And** workload variance >20% for 3 consecutive days produces reassignment guidance

### Story 6.4: Implement Notification Configuration Console

As an admin,
I want configurable channels, cadence, and thresholds per role/customer,
So that notification noise and urgency can be tuned by operating context.

**Acceptance Criteria:**

**Given** role and customer notification policies
**When** admin updates configuration
**Then** policy validation prevents invalid combinations
**And** policy changes are versioned and applied to subsequent scheduler-emitted events only

## Epic 7: Metrics, Cost Governance, and Forecasting

Provide leadership and recruiter analytics that connect operational execution to financial outcomes and early risk signals.

### Story 7.1: Build Core Operational Dashboard

As a recruiter,
I want a dashboard for delivery throughput and conversion health,
So that I can monitor daily execution outcomes and adjust quickly.

**Acceptance Criteria:**

**Given** completed outreach and pipeline events
**When** dashboard loads
**Then** candidates delivered, response rate, interview rate, conversion, and time-to-fill metrics are shown
**And** refresh interval is within defined 4-hour SLA

### Story 7.2: Add Recruiter and Customer Trend Analytics

As a delivery leader,
I want 30/60/90-day recruiter and customer trends,
So that I can identify improving or declining performance patterns.

**Acceptance Criteria:**

**Given** historical pipeline data
**When** trend views are requested
**Then** recruiter productivity and customer outcome metrics render with period comparisons
**And** month-over-month delta values are available for each core metric

### Story 7.3: Implement Cost and Budget Governance Views

As a finance stakeholder,
I want cost component tracking with trigger thresholds,
So that spending risk is visible before budget breach.

**Acceptance Criteria:**

**Given** enrichment, SMS, and email cost feeds
**When** cost dashboard updates
**Then** budget usage indicators show 80/90/100% thresholds
**And** API, SMS-per-placement, and churn triggers produce alerts

### Story 7.4: Implement Peer Comparison and Support Recommendations

As a delivery head,
I want peer benchmarking and support recommendations,
So that underperformance can be corrected proactively.

**Acceptance Criteria:**

**Given** recruiter performance cohorts
**When** ranking and variance analysis runs
**Then** percentile and team-average comparisons are displayed
**And** recommendations are produced when rolling conversion drops below policy thresholds

### Story 7.5: Add Pipeline Forecasting and KPI Breach Alerting

As leadership,
I want 30-60 day pipeline forecasts with KPI threshold monitoring,
So that planning and intervention decisions are data-backed.

**Acceptance Criteria:**

**Given** forecast and live KPI inputs
**When** forecasting jobs run
**Then** forecast-vs-actual cohorts are visible by month
**And** breaches for conversion, response rate, and cost-per-hire trigger targeted alerts

## Epic 8: Compliance, Reliability, and Operational Guardrails

Harden the platform for regulated operations with immutable evidence, resilience controls, and lifecycle governance.

### Story 8.1: Implement Immutable Audit Event Pipeline and Export

As a compliance officer,
I want append-only action and communication audit logs with export capability,
So that investigations and regulatory reviews are supported.

**Acceptance Criteria:**

**Given** user and system actions
**When** events are persisted
**Then** append-only storage prevents mutation/deletion
**And** authorized exports include actor, timestamp, resource, and change details

### Story 8.2: Implement Retention, Archival, and Backup Governance

As a platform operator,
I want retention policy automation and immutable encrypted backups,
So that legal retention and disaster recovery obligations are met.

**Acceptance Criteria:**

**Given** retention policies and daily backup schedule
**When** archival and backup jobs run
**Then** data is retained and tiered according to policy windows
**And** backup integrity checks and recovery test results are recorded

### Story 8.3: Implement GDPR Deletion Workflow End-to-End

As a compliance officer,
I want right-to-be-forgotten request processing with proof artifacts,
So that deletion obligations are fulfilled within required timelines.

**Acceptance Criteria:**

**Given** an approved deletion request
**When** deletion workflow executes
**Then** primary and downstream data stores are purged within 30 days
**And** completion proof and third-party confirmation are attached to case history

### Story 8.4: Implement Reliability Controls for Provider and Queue Failures

As a recruiter,
I want graceful degradation when providers fail,
So that workflows continue with clear delay expectations instead of hard errors.

**Acceptance Criteria:**

**Given** provider timeout, outage, or quota exhaustion
**When** resilience policy triggers
**Then** operations enter queue/retry mode with ETA messaging
**And** no critical communication or processing event is silently dropped
**And** scheduler lag, missed runs, and duplicate-dispatch prevention are observable during degraded operation

### Story 8.5: Implement Provider Health and API Metering Alerts

As an operations lead,
I want health and quota monitoring,
So that outages and runaway costs are contained quickly.

**Acceptance Criteria:**

**Given** provider uptime and quota usage telemetry
**When** thresholds are breached
**Then** role-specific alerts are sent within configured response windows
**And** alert events are correlated to tenant and provider context

### Story 8.6: Implement Security Anomaly Escalation Workflow

As a compliance officer,
I want high-severity security anomalies escalated through a defined workflow,
So that risky behavior is triaged within policy response windows.

**Acceptance Criteria:**

**Given** anomaly telemetry that crosses severity thresholds
**When** a high-severity condition is detected
**Then** escalation routes to compliance workflow within 15 minutes
**And** investigation status and resolution outcomes are recorded for audit

## Epic 9: Candidate Self-Service Portal Experience

Deliver the secure candidate portal experience for self-service updates, status visibility, and document retrieval.

### Story 9.1: Implement Candidate Token Login and Profile View

As a candidate,
I want to sign in with SMS/email token links and view my profile,
So that I can safely interact without a complex account setup.

**Acceptance Criteria:**

**Given** a valid one-time token link
**When** candidate opens portal and authenticates
**Then** secure session is established with token expiry/replay protections
**And** profile view renders current candidate data scoped to that candidate only

### Story 9.2: Implement Candidate Availability and Seriousness Self-Updates

As a candidate,
I want to update availability and readiness details,
So that recruiters receive accurate and current intent signals.

**Acceptance Criteria:**

**Given** an authenticated candidate session
**When** candidate updates availability and seriousness inputs
**Then** changes persist with timestamp and source attribution
**And** downstream scoring refresh is queued automatically

### Story 9.3: Build Candidate Application Status Timeline

As a candidate,
I want to track progress through the recruiting journey,
So that I understand where I am and what happens next.

**Acceptance Criteria:**

**Given** active candidate-job relationships
**When** candidate opens status view
**Then** lifecycle stages from applied through started are displayed in order
**And** status transitions show latest timestamp and explanatory labels

### Story 9.4: Implement Candidate Lifecycle Notifications

As a candidate,
I want notifications about key status events,
So that I can take timely action without manual follow-up.

**Acceptance Criteria:**

**Given** interview/offer/start events
**When** event triggers occur
**Then** candidate receives configured status notifications
**And** delivery success and failure outcomes are tracked per channel

### Story 9.5: Implement Candidate Offer and Document Download

As a candidate,
I want secure access to offer letters and related documents,
So that I can review and act on hiring paperwork.

**Acceptance Criteria:**

**Given** authorized candidate access to available documents
**When** candidate requests a download
**Then** only permitted documents are served with integrity checks
**And** every document access is audited with actor, timestamp, and document identifier
