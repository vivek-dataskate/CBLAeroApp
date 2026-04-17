---
title: Product Requirements Document - CBLAero
author: vivek
date: '2026-03-04'
lastEdited: '2026-04-17'
version: condensed-v1
---

# Product Requirements Document - CBLAero

## Executive Summary

CBLAero is a recruiting delivery engine for aviation staffing firms. It automates the repetitive 90% of candidate sourcing — scraping cold leads, tracking past contacts, and continuously engaging potential matches based on profiles clients want. The system reaches out to matching candidates to gauge closability, confirm interest, collect preferred contact times, and probe seriousness, then assigns an opportunity score and delivers at least five qualified, pre-confirmed options per job requirement within 24 hours.

The product's core insight is that **availability is the primary signal**: candidates drive the process by announcing when they're free, and the system continuously engages to maintain that signal. CBLAero self-tests its matching performance and targets ≥95% confidence. This lets one recruiter handle three client accounts.

**Classification:** Web-based recruiter tool; aviation recruitment domain (high complexity); greenfield.

## Goals & Vision

### User Goals
- Deliver 5 qualified candidates (0.70+ confidence) per req within 24 hrs.
- 80% of contacted candidates receive interview requests; 80% interview attendance.
- 85% candidate response rate; ≥70% candidate satisfaction; <5% opt-out rate.
- Staged placement conversion: 8–12% (mo 1–2) → 40% (mo 6+).
- Recruiters spend <30 min/day on non-recruitment tasks.

### Business Goals
- Enable 1 recruiter → 3 clients by month 6.
- $800 margin/placement; ~$4.8k/week/recruiter at 6 starts/week.
- Break-even by month 4 with 20 customers (CAC < $1,500; LTV > $12,000).
- 50 active customers by Q4.
- Cost triggers: API costs >$1,000/mo = renegotiate; SMS >$200/placement = cut volume.

### Technical Goals
- ≥5 prioritized candidates/req within 24 hrs (graceful degradation: batch 4–6 hrs if APIs down).
- ≥95% match confidence, validated via conversion funnel and recalibrated monthly.
- Daily scraping/outreach regardless of events.
- Notification delivery <1 min; dataset refresh every 4 hrs; 99.5% uptime.
- Scale: 1M records at launch; 3M+ year 1.

### Vision
Universal opt-in availability engine spanning multiple staffing domains, predictive sourcing for contract vs. permanent hires, and seamless compliance automation across jurisdictions.

## Personas

- **Sarah — Candidate:** Aviation professional between contracts. Needs opt-in registration, relevant outreach, availability signaling, and status visibility. Wants to be contacted only within her preferred window.
- **Mike — Recruiter:** Aviation recruiter managing multiple clients. Needs job posting, Teams notifications, candidate prioritization, call scheduling, multi-client management. Goal: triple productivity by letting software handle sourcing.
- **Elena — Delivery Head:** Owns recruiter performance across a team. Needs performance dashboards, team drill-down, pipeline forecasting, compliance alerts, workload-imbalance signals with reassignment recommendations.
- **David — Owner/Executive:** Needs ROI tracking, compliance audits, business intelligence, scale forecasting. Reviews monthly conversion, break-even progress, and cohort variance.
- **Alex — System Admin:** Needs API monitoring, health alerts, integration management, scaling controls, quota alerts. Keeps the platform operational during peak seasons.

## Out of Scope (MVP)

- Public, unauthenticated product pages and SEO-growth features.
- Non-USA data residency or international deployment.
- Automated ITAR/export-control screening and foreign-national adjudication.
- Full ATS/HRIS bidirectional write-back sync (read-only ATS ingestion is in scope from Tier 2).
- Fully automated background check and drug-testing orchestration across all providers.
- Advanced candidate self-service beyond status visibility, availability updates, and document access.

## Domain-Specific Requirements

### Compliance & Regulatory

- **FAA Certifications & Type Ratings:** A&P License mandatory for maintenance roles; IA preferred. Must validate FAA Airframe/Avionics licenses.
- **Airport Badging Requirements:** Criminal background checks to obtain Indianapolis Airport badge; no felony records allowed.
- **Drug & Alcohol Testing:** Pre-employment FAA drug tests; random testing per FAA/DOT regulations.
- **Background Verification:** Criminal, employment, education verification required.
- **Specialized Testing:** Pulmonary function and respirator fit tests for Finish Application Technicians.
- **GDPR/CCPA/TCPA Compliance:** International candidates with geo-detected consent; SMS outreach with TCPA opt-outs.

### Pre-Screening & Intake (summary)

Mandatory intake captures 10 aviation-specific questions (aircraft types for first 30 days, tooling needs, shift/AOG structure, decision-maker, historical red flags, etc.). Pre-screening agents validate tooling ownership, airport badge clearance, and A&P certification. Candidate summaries carry tool ownership, badge clearance status, drug-test readiness, and background-check status flags before submission.

### Risk Mitigations (summary)

- Screen for personal tool ownership before submission (Comlux learning: 50%+ rejection otherwise).
- Flag criminal backgrounds that block airport badging during pre-screening.
- Require heavy MRO/completion-center experience; reject general-aviation-only candidates.
- Account for seasonal hiring challenges via weather-informed forecasting.
- Block offer progression unless background-check status is `clear` or explicitly overridden by delivery head.
- Track drug-test request/scheduled/result/outcome dates; block start-date confirmation without compliant result.
- Respect collective bargaining agreements in outreach.

## Web Platform Requirements

- **Browser support:** Chrome 120+, Edge 120+, Firefox 121+, Safari 17+ (full desktop); iOS Safari 17+ and Android Chrome 120+ (partial — candidate portal and recruiter essentials). Test latest and latest-minus-1 each release.
- **Responsive:** Desktop ≥1200px full multi-panel; tablet 768–1199px condensed with persistent primary actions; mobile <768px candidate portal full + recruiter critical actions only. Minimum 44×44px touch targets.
- **Accessibility:** WCAG 2.1 AA. All critical workflows keyboard operable. Body text/control contrast ≥4.5:1. Screen-reader labels on forms, navigation, status, alerts.
- **SEO posture:** Authenticated, non-indexed product console; candidate portal noindex by default.

### Authentication and Access Requirements

**Identity and Session Management**

- Primary identity provider: enterprise SSO for @cblsolutions.com users.
- Session persistence target: 30-day remembered device for low-risk actions.
- Step-up authentication required for sensitive actions (exports, role changes, cross-tenant admin actions).

**Outage Fallback Requirement**

- If SSO is unavailable for more than 2 hours, admin may issue time-boxed emergency access tokens.
- Emergency access must follow a documented runbook, require out-of-band identity verification, and expire within 4 hours.
- Every emergency access event must be audit logged and reviewed within 1 business day.

**Authorization and Multi-Tenancy**

- Enforce strict object-level tenant isolation for every read and write operation.
- Sequential ID enumeration must not expose cross-tenant records.
- Tenant-isolation adversarial test suite must pass in CI before release.

### Integration and Resilience Requirements

- **Provider Abstraction:** Candidate enrichment, SMS, and email capabilities must be provider-agnostic; vendor specifics are architecture decisions.
- **Schedule Governance:** Recurring business cadences (connector syncs, digest generation, refresh sweeps, compliance sweeps, recurring operational checks) must be centrally managed through a unified schedule control plane. Retry delays and cooldowns are execution safety controls, not user-authored schedules. Schedule changes follow: UI → API validation → versioned policy/schedule records → backend scheduler → emitted jobs.
- **Rate Limits and Quotas:** Per-tenant quotas configurable for enrichment, SMS, email. Alert thresholds at 80%, 90%, 100% of configured monthly budgets.
- **Failure Handling:** If external enrichment is unavailable or times out, queue records for async batch processing. Recruiter sees `Enrichment Pending`, `Retry Scheduled`, `Ready`. Messaging failures trigger bounded retry and escalate to admin at ceiling.
- **Circuit Breaker:** Open when rolling error threshold exceeded over 5 minutes; route to queue mode and suppress user-facing hard errors; controlled half-open recovery after cool-down.

### Data Residency and Compliance Boundaries

**Residency Policy**

- Customer data, operational logs, and backups must remain in approved USA regions.
- Cross-region replication outside approved USA regions is prohibited.

**Third-Party Data Handling**

- Third-party processors must have documented residency posture and signed data processing terms.
- If a provider cannot guarantee required residency posture, route through approved proxy pattern or mark provider unsupported.

**Export-Control Boundary**

- MVP does not perform automated ITAR or export-control adjudication.
- Export-control and foreign-national eligibility decisions remain customer compliance responsibilities unless future scope explicitly adds them.

### Security and Audit Requirements

**Audit Integrity**

- All critical user and system actions must be recorded in immutable audit storage.
- Audit records require cryptographic integrity controls and tamper-evident retention.
- Retention target: 5-year hot queryability plus 7-year cold archive.

**Anomaly Detection Requirements**

- Detect and score anomalies across geo-shift, device-shift, volume-shift, and time-of-access signals.
- Define alert thresholds for low, medium, and high severity actions.
- Target false-positive rate below 5% after pilot calibration.

### Scale and Performance Targets

- Candidate-list query: under 2 seconds p95 at target concurrent load.
- Candidate enrichment: under 10 seconds p95 for synchronous workflow path.
- Notification dispatch: under 1 minute from scoring completion.
- Uptime target: 99.5% excluding planned maintenance.
- Scale path: 1M records at launch; 3M+ records year 1 via ongoing uploads and automated ATS/email sync.

### Pre-Launch Quality Gates

1. Tenant-isolation adversarial test suite passes with zero cross-tenant leakage.
2. External-provider outage drills validate queue mode and recovery behavior.
3. Audit immutability checks pass with tamper-evidence verification.
4. Browser and responsive matrix tests pass across supported devices.
5. Accessibility baseline audit passes against WCAG 2.1 AA target.

## Functional Requirement Categories

The full, numbered capability contract (FR1–FR75 + FR1a, FR1b) lives in `prd.full.md`. Categories:

- **Candidate Management:** CSV/PDF/ATS ingestion, dedup (≥95% auto-merge, 70–94% manual), availability status, profile storage with `pgvector`, 5-yr hot / 7-yr cold retention, GDPR right-to-be-forgotten.
- **Outreach & Engagement:** SMS/email templates with contact windows, per-channel TCPA opt-out, candidate responses with structured seriousness fields, bounded retry (max 3), bulk campaigns (50–5,000).
- **Recruiter Workflow:** Job posting with 10 mandatory intake questions, daily candidate list sorted by opportunity score, structured match reasons (with RAG source grounding when used), interaction logging, journey status tracking, offer workflow, bulk updates, exports, multi-client context, personal metrics.
- **Match & Scoring:** Opportunity score (skills 40%, availability 30%, location 20%, domain 10%), availability validation against 90-day engagement, seriousness state (High/Med/Low), domain-requirement screening (A&P, badging, felony, tools), monthly recalibration, 4-hr refresh cadence (Tier 1) / continuous (Tier 2+), seasonal adjustments ±15%.
- **Team Collaboration & Notifications:** Daily Teams digest (top 5), rich Teams cards with one-click actions, Delivery Head event notifications, workload-imbalance drill-downs, centralized admin configuration.
- **Auth & Access Control:** SSO, RBAC (Recruiter/Delivery Head/Admin/Compliance Officer), tenant isolation, admin invitations/audit, step-up MFA for sensitive ops.
- **Metrics & Reporting:** Operational/recruiter/customer dashboards with 30/60/90-day trends, cost tracking with 80/90/100% alerts, peer comparison with reassignment triggers at ≥15% below team average (30-day rolling) for 3 consecutive days, pipeline forecasting, KPI threshold alerts, audit-log export, budget-overspend forecasting.
- **Domain Compliance & Regulatory:** 10 mandatory aviation intake questions, A&P verification with 90-day revalidation, airport-badge eligibility, drug-test tracking and letter generation, communication audit trail with content hashes, pre-screening rejection reason codes, GDPR 30-day deletion workflow.
- **System Operations & Infrastructure:** External-provider health monitoring, per-customer API metering with 80% quota alert, graceful API degradation, immutable append-only audit trail (5-yr hot / 7-yr cold), anomaly detection with 15-min high-severity alerts, admin manual refresh without mutating schedule, daily immutable-cold-archive backup with encryption, USA-only residency.
- **Candidate Portal:** SMS-token/email-link login, profile/availability updates, application status visibility, status notifications, offer-letter download.

See `prd.full.md` for full FR text, Tier assignments, and phase allocation.

### The Capability Contract

This FR list is now BINDING. Any feature not listed here will NOT exist in the final product unless explicitly approved and added. Each FR traces back to user journeys, success criteria, domain requirements, or innovation patterns.

Design, architecture, and engineering teams should treat this section as the canonical capability contract and refine remaining acceptance details during story decomposition where explicitly marked.

## Non-Functional Requirements

### Performance (highlights)

Candidate list <2s p95; enrichment <10s p95; Teams notification <1 min; interaction log <500 ms p95 with UI ack <1s; dashboard refresh <2s. Throughput: 100 enrichments/sec sustained; 1,000 SMS/min peak; 100 concurrent recruiters without regression. Initial 1M-record bulk enrichment runs as a rate-limited overnight batch, not real-time.

### Security Requirements

**Data Protection:**

- **NFR9 [MVP Tier 1]:** All PII encrypted at rest using industry-standard encryption controls (for SSN, phone, email, address fields)
- **NFR10 [MVP Tier 1]:** All data in-transit encrypted with TLS 1.3+ HTTPS only; no plaintext APIs or internal communication
- **NFR11 [MVP Tier 1]:** Encryption keys managed in centralized key-management service with automatic rotation at least every 90 days

**Access Control & Multi-Tenancy:**

- **NFR12 [MVP Tier 1]:** Multi-tenancy isolation: Recruiter cannot query another tenant's candidates, validated by automated adversarial test suite with zero cross-tenant read success; Supabase Postgres RLS (and equivalent service-layer checks) must enforce tenant predicates for relational and vector retrieval paths
- **NFR13 [MVP Tier 1]:** Session authentication: enterprise SSO only; 30-day `remember device` token; step-up MFA for sensitive operations (data export, role changes, communication-history access)
- **NFR14 [MVP Tier 1]:** No hardcoded credentials in code; all secrets managed via centralized secrets service with audit logging

**Threat Detection & Response:**

- **NFR15 [MVP Tier 2]:** Anomaly detection alerts:
  - > 10 failed login attempts in 1 hour → Auto-lockout + Admin alert
  - > 100 bulk data downloads/day → Compliance Officer alert
  - Geolocation shift >500 miles in <30 minutes → anomaly flag + manual review within 2 hours

**API Security:**

- **NFR16 [MVP Tier 2]:** API rate limiting:
  - Per-user: 1,000 requests/min
  - Per-tenant: 10,000 requests/min
  - Per-API endpoint: Circuit breaker if >100 errors/min

### Compliance & Audit Requirements

**Audit Logging & Immutability:**

- **NFR17 [MVP Tier 1]:** All user actions logged within 5 seconds with: timestamp, user ID, action type, resource ID, change delta
  - Examples: "FR_001 viewed candidate #C123", "FR_001 logged call with #C123", "Admin_001 deleted user #U456"
- **NFR18 [MVP Tier 1]:** Communication audit trail: Every SMS/email logged with content hash, recipient, timestamp, delivery status, and response state; queryable within 1 hour
- **NFR19 [MVP Tier 1]:** Append-only audit store (no DELETE, no UPDATE; immutable records) in Supabase Postgres, verified quarterly with tamper-attempt test cases; vector-side retrieval indexes must be rebuildable from immutable relational audit source-of-truth records
- **NFR20 [MVP Tier 1]:** Audit logs cryptographically signed with industry-standard integrity controls; weekly off-chain backup to immutable archive storage with object lock

**Data Retention & Deletion:**

- **NFR21 [MVP Tier 1]:** Audit log retention: 5-year hot (queryable), 7-year cold (immutable archive), then purge
- **NFR22 [MVP Tier 3]:** GDPR compliance: Data deletion workflow (right-to-be-forgotten request → 30-day process → audit purge → verification)
  - Verification: Confirm no data in primary DB, backups, logs, or third-party services
  - Audit trail: Document deletion proof for compliance officer

**Data Residency & Sovereignty:**

- **NFR23 [MVP Tier 1]:** USA data residency: All customer data, logs, and backups remain in approved USA regions only
  - No replication or backup in non-USA regions
  - Third-party processors require documented residency posture and quarterly compliance review

**Regulatory Compliance:**

- **NFR24 [MVP Tier 1]:** TCPA compliance: Maintain opt-out requests per channel (SMS vs. email); enforce before outreach; process opt-out within 24 hours; audit trail of all opt-outs
- **NFR25 [MVP Tier 1]:** Aviation domain: Maintain 5-year record of all A&P certifications verified, hiring decisions involving certifications, FAA compliance checks
- **NFR26 [MVP Tier 2]:** SOC 2 Type II audit-ready:
  - Access controls defined and enforced (RBAC documented)
  - Change management logged (all system changes in audit trail)
  - Incident response procedures documented (runbook for security incidents)
  - Backup & disaster recovery tested quarterly
  - Target: Audit-ready by Q2 2027 (9 months post-launch)

### Reliability & Scalability (highlights)

- 99.5% uptime (excludes planned maintenance); admin alert if downtime >15 min.
- Circuit breaker on external-provider >10s timeout → queued batch retry with exponential backoff; messaging queued for 24-hr retry window; no dropped messages.
- Supabase Postgres HA failover <5 min; daily snapshot + PITR to immutable cold archive; RTO <1 hr, RPO <24 hrs; monthly recovery test; quarterly DR dry-runs.
- Scale path: Tier 1 50–100 recruiters / 50k records / <100 ms relational p95 / ≤250 ms p95 vector; Tier 3 100–200 recruiters / 200–500k records; Phase 2+ 200 recruiters / 5M records with 10× headroom. Architecture supports 10× growth with <10% degradation until 50M records; horizontal scaling of processing services with async orchestration.

## Launch Gate Criteria (Week 14)

- Performance: all user-facing actions <2 s p95 with 100 concurrent users.
- Security: penetration test passed; encryption verified; no critical vulnerabilities.
- Compliance: audit trail verified for 5-yr retention; GDPR/TCPA framework in place.
- Reliability: 99.5% uptime achieved in staging; graceful degradation tested for all external APIs.
- Scalability: 2–5 customer pilot load test completed; 500k records at <100 ms latency.
