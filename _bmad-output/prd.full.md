---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-12-complete
inputDocuments:
  - docs/planning_artifacts/source-inputs/aviation-product-brief.md
  - docs/planning_artifacts/source-inputs/aviation-talent-PRD.md
classification:
  projectType: 'Web-based recruiter tool'
  domain: 'Aviation recruitment'
  complexity: 'High (domain complexity, reduced vendor surface)'
  projectContext: 'greenfield'
projectType: greenfield
briefCount: 1
existingPRDCount: 1
workflowType: 'prd'
date: '2026-03-04'
lastEdited: '2026-03-10'
editHistory:
  - date: '2026-03-10'
    changes: 'Validation-driven cleanup Phase 1: removed duplicate scope, added web platform requirements, reduced implementation leakage, tightened high-impact FR/NFR measurability'
  - date: '2026-03-10'
    changes: 'Validation-driven cleanup Phase 2: removed residual implementation-specific wording in FR/NFR summaries and scaling requirements'
  - date: '2026-03-10'
    changes: 'Validation-driven cleanup Phase 3: tightened FR/NFR measurability thresholds for deduplication, confidence validation, reassignment triggers, anomaly response, and UI acknowledgment'
---

# Product Requirements Document - CBLAero

**Author:** vivek
**Date:** 2026-03-04

## Executive Summary

CBLAero is a recruiting delivery engine built for aviation staffing firms. It automates the repetitive 90 % of candidate sourcing—scraping cold leads, tracking past contacts, and continuously engaging potential matches every day based on the profiles we know clients want. The system also automatically reaches out to all matching candidates to gauge who is closeable, confirm their interest, collect preferred contact times, and probe seriousness with qualifying questions. It assigns an opportunity score, prioritizes the list, and delivers at least five qualified, pre‑confirmed options per job requirement within 24 hours. Recruiters no longer hand‑search databases; they simply review the top‑ranked candidates in Teams, call motivated people at their preferred time, and submit to the client the same day.

The product’s core insight is that **availability is the primary signal**; candidates drive the process by announcing when they’re free, and the system continuously engages to maintain that signal. CBLAero self‑tests its matching performance and aims to deliver candidates with 95 % confidence that they meet most of the criteria. This allows one recruiter to handle three client accounts with sourcing largely handled by software, converting speed into revenue opportunities and tighter client relationships.

**Project Classification:**

- Web‑based recruiter tool
- Aviation recruitment domain (high complexity)
- Greenfield initiative

---

## Executive Quick-Reference Card

**For busy stakeholders:** Does this deserve greenlight? Read this in <2 minutes.

| Dimension                  | Target                                                             | Status                                               |
| -------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| **Time-to-Candidate**      | 5 qualified candidates in 24 hrs                                   | MVP Tier 1                                           |
| **Recruiter Productivity** | 1 recruiter → 3 clients by month 6                                 | 14-week phased delivery                              |
| **Confidence Score**       | ≥95% match accuracy                                                | Validated via self-testing + conversion funnel       |
| **Placement Conversion**   | 8–12% month 1 → 40% month 6                                        | Staged, realistic metrics (not overconfident)        |
| **Economics**              | $800 margin/placement; break-even month 4                          | At scale: 20 customers required                      |
| **Unit Economics Risk**    | Sourcing cost >$200/placement erodes margin                        | **CRITICAL:** Cost triggers + API fallback required  |
| **Launch Go/No-Go**        | 4-week pilot with 1–2 ideal-fit customers                          | Week 4 decision point locked in                      |
| **Technical Readiness**    | 99.5% uptime; no cross-tenant data leakage                         | 8 pre-launch security/resilience gaps identified     |
| **Compliance Baseline**    | Immutable audit, GDPR 30-day deletion, SOC 2 Q2 2027               | Phase 3 launch gate                                  |
| **MVP Scope**              | 76 FR identifiers (including FR1a) across 3 tiers; 38 NFRs defined | Tier is defined per requirement tag (`[MVP Tier X]`) |

**Bottom Line:** ✅ Comprehensive, realistic, phased MVP. 🚩 Success requires: (1) committed pilot customer, (2) acceptance of 14-week timeline, (3) confidence-first approach (domain-logic → ML later), (4) strict cost governance.

---

## Success Criteria

### User Success

**Recruiter Success:**

- Deliver **5 qualified candidates (0.70+ confidence)** per req within 24 hrs (SLA with confidence warning).
- **80 % of contacted candidates** receive interview requests (tiered by confidence; recruiters see 0.75+ by default).
- **80 % interview attendance** rate for contacted candidates.
- **Staged conversion:** Month 1–2: 8–12% → starts; Month 3–4: 15–20%; Month 5–6: 25–35%; Month 6+: 40%.
- Recruiters spend <30 min/day on non-recruitment tasks (filtering, re-contacting).

**Candidate Success:**

- **85 % response rate** (SMS/email delivered within 24 hrs to availability intentions).
- **≥70 % candidate satisfaction** (post-interaction NPS: "responsive" or better).
- **<5 % opt-out rate** (trust proxy; >10% = messaging problem).
- Candidates see transparent status (applied → screening → offer → start) in portal.

### Business Success

- **Staged placement conversion:** Ramp from 8–12% (month 1–2) to 40% (month 6+).
- Enable each recruiter to **manage 1 client (month 1), 2 (month 3), 3 (month 6)**.
- **Revenue target:** $800 margin/placement × placements/recruiter (e.g., 6 starts/week ≈ $4.8k/week).
- **Pilot goal:** Achieve month 3 metrics within 3 months; onboard 50 active customers by Q4.
- **Break-even:** Hit cash break-even by month 4 with 20 customers (CAC < $1,500; LTV > $12,000).
- **Cost triggers:** API costs >$1,000/month = renegotiate; SMS >$200/placement = cut volume.

### Technical Success

- **SLA:** ≥5 prioritized candidates delivered per req within 24 hrs (graceful degradation: batch mode = 4–6 hrs if APIs down).
- **Match confidence:** Maintain ≥95 % via self-testing; validate via conversion funnel by bucket; re-calibrate monthly.
- **Continuous engagement:** Daily scraping/outreach regardless of events.
- **Performance metrics:** Notification delivery <1 min; dataset refresh every 4 hrs; 99.5 % uptime (excludes maintenance).
- **Scale:** Launch: 1M existing records (initial load); ongoing: daily/weekly recruiter uploads + ATS/email auto-sync; Year 1: 3M+ records.
- **Quality gate:** Each candidate includes human-readable match reason (e.g., "FAA cert + 5yr exp + location").

### Measurable Outcomes

- 5 candidates/req in 24 hrs (with confidence warning)
- 80 % interview request rate (of contacted)
- 80 % interview attendance
- Staged conversion: 8–12% (month 1) → 40% (month 6)
- 85 % candidate response rate
- 70 % candidate satisfaction
- <5 % opt-out rate
- 3 clients/recruiter (by month 6)
- 50 active customers by Q4
- 95 % match confidence (validated)
- Break-even by month 4

## Product Scope

### MVP - Minimum Viable Product

- Continuous daily scraping/engagement engine.
- Automated candidate outreach, interest confirmation, preferred contact time, and seriousness probes.
- Teams notification pipeline with top‑ranked list and match reasons.
- Self-testing module for match confidence with validation loop.
- Metrics dashboard tracking staged outcomes; graceful degradation modes.
- Basic candidate portal for status transparency.

### Growth Features (Post-MVP)

- Improve match confidence to 98 % via ML feedback.
- Add availability forecasting and candidate behavior analytics.
- Integrate additional enrichment vendors and data feeds.
- Stakeholder-specific dashboards (recruiter time savings, CFO margins, compliance audits).

### Vision (Future)

- Universal opt-in availability engine spanning multiple staffing domains.
- Predictive sourcing for contract vs. permanent hires.
- Seamless compliance automation across jurisdictions.
- Zero-incident operations (MTTD <5 min, MTTR <15 min).

### Out of Scope (MVP)

- Public, unauthenticated product pages and search-engine growth features.
- Non-USA data residency or international deployment.
- Automated ITAR/export-control screening and foreign-national adjudication.
- Full ATS/HRIS bidirectional write-back sync (read-only ATS ingestion is in scope from Tier 2).
- Fully automated background check and drug-testing orchestration across all providers.
- Advanced candidate self-service features beyond status visibility, availability updates, and document access.

## User Journeys

### Candidate Journey: "From Overwhelmed to Empowered"

**Sarah's story:** Airbus pilot between contracts; drowning in recruiter spam. Opts into CBLAero, receives relevant captain match via SMS, responds with availability, and gets contacted only within her preferred contact window. Lands job and keeps profile current for future opportunities.

### Recruiter Journey: "From Hunting to Orchestrating"

**Mike's story:** Aviation recruiter spending 6 hrs/day hunting candidates. Posts job in CBLAero; receives 5 prioritized candidates with match reasons in 24 hrs. Calls top 3, converts 1. Realizes he can handle 3 clients simultaneously. Productivity triples; work-life balance improves.

### Delivery Head Journey: "From Reactive to Predictive"

**Elena's story:** Delivery head firefighting recruiter quotas, client delays, compliance issues. Logs into CBLAero dashboard; sees recruiter performance, conversion rates, forecasts, and workload imbalance alerts with assignment recommendations. Compliance issues are auto-flagged, shifting her role from crisis management to strategic planning.

### Owner/Executive Journey: "From Uncertainty to Confidence"

**David reviews the monthly report:** 40% placement conversion target, break-even month 4, 50 active customers by Q4, and forecast-vs-actual cohort variance. Compliance audits pass and productivity trends support scale decisions.

### System Admin Journey: "From Invisible to Essential"

**Alex manages via admin dashboard:** Monitors API health, data feeds, quota alerts. Proactively scales during peak seasons; prevents outages.

### Journey Capability Map

| Actor     | Role          | Key Needs                                                                                            |
| --------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| **Sarah** | Candidate     | Opt-in registration, relevant outreach, availability signaling, status visibility                    |
| **Mike**  | Recruiter     | Job posting, Teams notifications, candidate prioritization, call scheduling, multi-client management |
| **Elena** | Delivery Head | Performance dashboards, team drill-down, pipeline forecasting, compliance alerts                     |
| **David** | Owner/CEO     | ROI tracking, compliance audits, business intelligence, scale forecasting                            |
| **Alex**  | System Admin  | API monitoring, health alerts, integration management, scaling controls, quota alerts                |

## Domain-Specific Requirements

### Compliance & Regulatory

- **FAA Certifications & Type Ratings:** A&P License mandatory for maintenance roles; IA preferred. Must validate FAA Airframe/Avionics licenses.
- **Airport Badging Requirements:** Criminal background checks to obtain Indianapolis Airport badge; no felony records allowed.
- **Drug & Alcohol Testing:** Pre-employment FAA drug tests; random testing per FAA/DOT regulations.
- **Background Verification:** Criminal, employment, education verification required.
- **Specialized Testing:** Pulmonary function and respirator fit tests for Finish Application Technicians.
- **GDPR/CCPA/TCPA Compliance:** International candidates with geo-detected consent; SMS outreach with TCPA opt-outs.

### Technical Constraints

- **Tooling Requirements:** Personal tools mandatory (drills, riveters, etc.); client provides partial tooling; specialty tools not required but preferred.
- **Documentation Systems:** Must support FAA-compliant maintenance records, work packages, and inspection documentation.
- **Real-time Availability:** Seasonal hiring patterns; winter weather deters candidates; need predictive availability for peak seasons.
- **Multi-channel Communication:** Email for documentation, phone for urgent matters; Teams integration for aviation firms.
- **Performance Requirements:** Fast hiring cycles (decisions same day to 3 days; start within 2 weeks).

### Integration Requirements

- **FAA Data Feeds:** Integration for certificate verification and drug test results.
- **Aircraft OEM Systems:** Support for Boeing BBJ, Airbus ACJ service centers; PPI capabilities.
- **Maintenance Environment:** Heavy MRO for VIP/WIP aircraft (Boeing 737/767/727; Airbus A319/A320/A321).
- **Microsoft Teams:** Native integration for aviation staffing firms' workflow.
- **Background Check Services:** Integration with third-party providers for criminal/employment verification.
- **Weather APIs:** Seasonal hiring intelligence for recruitment adjustments.

### Pre-Screening & Intake Requirements

- **Mandatory Intake Questions** (before sourcing):
  - Which aircraft will the candidate touch in the first 30 days?
  - Is recent experience on that aircraft mandatory or flexible?
  - Are personal tools required on day one? If yes, which tool categories?
  - Any specialty tooling or certifications required?
  - Shift structure, overtime reality, and AOG exposure?
  - Indoor vs outdoor work and environmental constraints?
  - Who is the real decision-maker for technical approval?
  - What has killed candidates late in the process before?
  - What background profiles historically fail here?
  - Which resume red flags are unique to this client?
- **Pre-Screening Agents:**
  - Tooling ownership validation
  - Airport badge clearance verification (criminal background)
  - A&P certification validation
- **Candidate Qualification Flags:**
  - Tool ownership status in candidate summary before submission
  - Badge clearance status (prevent disqualified candidates)
  - Compliance readiness (drug test scheduling)
  - Background check workflow status (`not started`, `in progress`, `clear`, `conditional`, `failed`) before offer stage

### Risk Mitigations

- **Tooling Readiness:** Screen for personal tool ownership before submission; reduce 50%+ rejection rate (Comlux learnings).
- **Badge Clearance:** Avoid candidates with criminal backgrounds that prevent airport badging; flag in pre-screening.
- **Experience Depth:** Require heavy MRO/completion center experience; reject general aviation-only candidates.
- **Winter Recruitment:** Account for seasonal hiring challenges in cold climates; integrate weather forecasting.
- **Compliance Timing:** Complete all compliance (drug tests, background checks) before start date; automate drug letter generation.
- **Background Workflow Depth:** Trigger background checks at interview-ready stage; block offer progression unless status is `clear` or explicitly overridden by delivery head.
- **Drug-Testing Workflow Depth:** Track request date, scheduled date, result date, and outcome; block start-date confirmation if compliant result not present.
- **Union Considerations:** Respect collective bargaining agreements in outreach.

### Domain Patterns & Best Practices

- **Hard-to-Fill Roles:** Cabinet Fabricators and Upholstery Technicians require specialized skills; extended sourcing timelines.
- **Hands-on Assessments:** Required for some roles to validate practical abilities; coordinate with client.
- **Blueprint Reading:** Essential for structures, sheet metal, interior roles; note in candidate requirements.
- **Shift Structure:** Consider overtime reality and AOG (Aircraft on Ground) exposure in job descriptions.
- **Environmental Factors:** Indoor vs outdoor work; climate-controlled hangars during winter; impacts recruitment in cold weather.
- **Fast-Track Hiring:** Same-day to 3-day decisions; start within 2 weeks; system requires rapid response capability.

## Innovation & Novel Patterns

### Detected Innovation Areas

**1. Availability-First Sequencing**

- Traditional recruitment matches skills/experience first, then checks availability. CBLAero inverts this: availability becomes the primary signal driver.
- Innovation: Candidates proactively announce when they're ready; the system engages continuously, not reactively. This eliminates the "candidate is qualified but currently employed/unavailable" problem.

**2. Candidate-Initiated Signal Architecture**

- Instead of recruiters hunting candidates (pull model), CBLAero creates conditions where candidates self-identify as available and interested (push model).
- Innovation: Flips recruiter control to candidate control, reducing friction and improving candidate fit (self-selection bias toward motivation).

**3. Continuous Proactive Sourcing Engine**

- Most recruiters source reactively (when a job posts). CBLAero sources continuously: daily scraping, engagement, and availability tracking regardless of inbound events.
- Innovation: Transforms sourcing from event-driven to always-on, amortizing sourcing cost across multiple clients and jobs.

**4. Pre-Qualification via Behavioral Probing**

- Beyond resume matching, CBLAero probes seriousness (tool ownership, badge readiness, commitment level) before recruiter involvement.
- Innovation: Reduces candidate fallout by pre-screening for domain-specific deal-breakers (e.g., Comlux: no personal tools = automatic fail).

**5. Market Differentiation: Aviation MRO Focus**

- Combines availability-first logic with domain-specific intelligence (FAA certs, type ratings, tooling requirements, seasonal patterns, badging).
- Innovation: Availability-first approach applied to underserved, high-complexity domain where traditional ATS fails.
- Competitive Advantage: No generic ATS vendor understands aviation MRO constraints; CBLAero automates what Comlux and similar firms do manually.

### Market Context & Competitive Landscape

**Existing Market Gaps:**

- Generic ATS platforms (Greenhouse, Workable): Built for corporate hiring; ignore aviation compliance, domain-specific constraints.
- LinkedIn Recruiter: Volume-based; no domain intelligence; no continuous engagement model.
- Aviation-specific platforms: Limited; focus on pilot hiring (not MRO technicians); no sourcing automation.
- CBLAero Position: **First availability-first + domain-intelligent sourcing engine for aviation MRO staffing.**

**Why This Matters:**

- $800 margin/placement × placement velocity = Revenue multiplier. CBLAero's availability-first model + automation enables 3x recruiter productivity (vs. 1.2x typical ATS improvements).
- Non-IT staffing boom: Market inflection point; CBLAero captures wave with differentiated technology.

### Validation Approach

**Innovation Validation Strategy:**

- **Pilot Phase (Month 1–2):** Test availability-first model with 5–10 recruiters on Comlux-like clients. Measure: availability signal accuracy, candidate drop-off at each stage.
- **Proof of Concept:** Validate 40% placement conversion (vs. industry 8–15%). Track which innovation piece drives improvement (availability-first vs. pre-qualification vs. automation).
- **Market Testing:** Launch with high-velocity segment (contract staffing, seasonal hiring). Validate model works before scaling.

### Risk Mitigation

**Innovation Risks & Fallbacks:**

- **Risk:** Candidate self-selection model doesn't work; candidates ignore system despite opt-in.
  - Mitigation: A/B test messaging/incentives. If <30% active engagement, pivot to hybrid model (mix self-initiated + recruiter-proactive).
- **Risk:** Availability signals decay too fast; stale data reduces match quality.
  - Mitigation: Real-time validation; 48-hour refresh max; candidate satisfaction tracking (if <70%, system needs retooling).

- **Risk:** Pre-qualification (tooling/badge checks) disqualifies too many candidates; pipeline dries up.
  - Mitigation: Validate assumptions with Comlux early. Adjust thresholds if fallout >40%.

- **Risk:** Continuous sourcing costs (API, SMS) explode; margin erodes.
  - Mitigation: Cost triggers already built in (API >$1k/month, SMS >$200/placement). Pivot to event-driven model if needed.

---

## Decision Gates & Risk Validation

**This PRD requires staged validation before proceeding.** Each gate locks in either continue or pivot decision:

### Week 4 Gate: Availability-First Model Validation

**Decision:** Does the 5-candidates-in-24hrs delivery work with manual sourcing?

- **Success Criteria:** ≥5 qualified candidates per job within 24 hrs; ≥70% SMS response rate
- **Risk Signal:** <3 candidates/24hrs or <40% response → model assumption broken; pivot to hybrid sourcing earlier
- **Decision Options:** (A) Proceed to Tier 2 automation (week 5), OR (B) Extend Tier 1 testing (weeks 5–6), OR (C) Stop and reassess
- **Owner:** Product + engineering lead

### Week 10 Gate: Automation ROI & Operational Readiness

**Decision:** Do automation (scraper + self-testing) deliver promised time savings without quality loss?

- **Success Criteria:** ≥15% time savings (recruiter engagement hours), ≥90% accuracy of self-testing, <5% regression in candidate quality
- **Risk Signal:** Time savings <10% or accuracy <85% → automation not ready for Tier 3 pilots
- **Decision Options:** (A) Proceed to Tier 3 pilots (week 11), OR (B) Extend automation polish (weeks 11–12), OR (C) Revert to semi-manual approach
- **Owner:** Product + ops lead

### Week 14 Gate: Break-Even Path & Unit Economics

**Decision:** Is the $800 margin/placement sustainable at scale? Are pilots pointing to month 4 break-even?

- **Success Criteria:** Confirmed cost-per-placement ≤$200; placement volume ≥6/recruiter/week; pilot revenue ≥$4,800/recruiter/week
- **Risk Signal:** Costs >$250/placement OR volume <4/week OR revenue <$3,200/week → unit economics fail; requires pivot (pricing, efficiency, go-to-market)
- **Decision Options:** (A) Scale to 20+ customers (month 4 break-even), OR (B) Pivot to higher-margin segments, OR (C) Extend pilot phase
- **Owner:** CFO/CEO + product lead

---

## Web-Tool Technical Requirements

### Web Platform Requirements

**Browser Support Matrix**

| Browser        | Minimum Version | Support Level | Notes                                     |
| -------------- | --------------- | ------------- | ----------------------------------------- |
| Chrome         | 120             | Full          | Primary desktop browser                   |
| Edge           | 120             | Full          | Windows enterprise baseline               |
| Firefox        | 121             | Full          | Full recruiter workflow support           |
| Safari         | 17              | Full          | macOS and iPadOS support                  |
| iOS Safari     | 17              | Partial       | Candidate portal and recruiter essentials |
| Android Chrome | 120             | Partial       | Candidate portal and recruiter essentials |

**Compatibility policy:** Test latest and latest-minus-1 for all full-support browsers at each release.

**Responsive Design Requirements**

- Desktop (>=1200px): full multi-panel recruiter workflow.
- Tablet (768px-1199px): condensed panels with persistent primary actions.
- Mobile (<768px): candidate portal full support; recruiter critical actions only.
- Minimum touch target size: 44x44 px.

**Accessibility Level**

- Target standard: WCAG 2.1 AA.
- All critical workflows keyboard operable without pointer input.
- Color contrast minimum 4.5:1 for body text and controls.
- Screen-reader labels required for forms, navigation, status indicators, and alert banners.

**SEO and Indexing Posture**

- Product console is authenticated and non-indexed.
- Candidate portal routes are noindex by default unless explicitly approved for public indexing.

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

**Provider Abstraction**

- Candidate enrichment, SMS, and email capabilities must be provider-agnostic.
- Provider selection and vendor specifics are architecture decisions and not part of this PRD contract.

**Schedule Governance**

- Recurring business cadences (connector syncs, digest generation, refresh sweeps, compliance sweeps, and recurring operational checks) must be centrally managed through a unified schedule control plane.
- Retry delays and cooldown windows are not user-authored schedules; they are execution safety controls enforced by policy.
- Schedule changes must follow a validated path: UI -> API validation -> versioned policy/schedule records -> backend scheduler -> emitted jobs.

**Rate Limits and Quotas**

- Per-tenant quotas must be configurable for enrichment, SMS, and email.
- Alert thresholds at 80%, 90%, and 100% of configured monthly budgets.

**Failure Handling and Degradation**

- If external enrichment is unavailable or exceeds timeout, system queues records for asynchronous batch processing.
- Recruiters see explicit status states: `Enrichment Pending`, `Retry Scheduled`, `Ready`.
- Messaging failures trigger bounded retry policy and escalation to admin when retry ceiling is exceeded.

**Circuit Breaker Requirements**

- Open breaker when rolling error threshold is exceeded over 5 minutes.
- While open, route requests to queue mode and suppress user-facing hard errors.
- Attempt controlled half-open recovery after cool-down period.

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
- Scale path: 1M records at launch (initial bulk load); 3M+ records year 1 via ongoing recruiter uploads and automated ATS/email sync.

### Pre-Launch Quality Gates

1. Tenant-isolation adversarial test suite passes with zero cross-tenant leakage.
2. External-provider outage drills validate queue mode and recovery behavior.
3. Audit immutability checks pass with tamper-evidence verification.
4. Browser and responsive matrix tests pass across supported devices.
5. Accessibility baseline audit passes against WCAG 2.1 AA target.

## Project Scoping & Phased Development

### MVP Philosophy & Strategy

**Core Insight from Advanced Elicitation:**
Initial MVP scope (8-12 weeks, pure manual sourcing) was lean but risky: it deferred all automation to Phase 2, which meant Month 1-4 CBLAero would look like a faster ATS, not an availability-first platform. Red Team analysis revealed three critical flaws:

1. Manual sourcing ≠ continuous value proposition; without automated scraping, we lose differentiation
2. 95% confidence claimed but delivered as manual recruiter review (0-60% real accuracy)
3. Unit economics wouldn't validate until Phase 2 automation; Phase 1 pilots would struggle to hit 8-12% conversion

**Decision: Refined Hybrid Approach**
Extend MVP to 14 weeks with phased tiers that **prove the hypothesis early**:

- Tier 1 (Weeks 1-4): Validate core availability-first model with manual sourcing
- Tier 2 (Weeks 5-10): Introduce lightweight automation (scraper, self-testing, pre-screening agent)
- Tier 3 (Weeks 11-14): Real-world pilot validation with differentiated platform

This approach balances speed (still ~14 weeks, not 20+) with proof of differentiation (automation begins week 5, not week 16).

### MVP Feature Set: 3-Tier Implementation (14 weeks)

#### **Tier 1: Proof of Concept (Weeks 1-4)**

**Goal:** Validate that availability-first model improves conversion vs. traditional recruiting

**Must-Have Capabilities:**

- Candidate sourcing: Manual research of 10-20 pre-qualified candidates per job (domain SME + researcher)
- Outreach orchestration: SMS/email templates with preferred contact time scheduling
- Teams notification pipeline: Daily digest of prioritized candidates with match reasons
- Recruiter workflow: View candidate details, log interactions, track outcomes
- Basic metrics dashboard: Candidate delivery, SMS response rate, interview requests, conversions
- Candidate portal: Status transparency (applied → screening → offer → start)

**Not Included:** Scraping automation, ML confidence scoring, pre-screening agents

**Success Criteria:**

- 5 candidates delivered per job within 24 hours (manual sourcing)
- 80% of contacted candidates receive interview requests
- 80% interview attendance rate
- 5-8% conversion to placements (realistic for Month 1-2)

**Team:** 3 engineers (1 backend, 1 frontend, 1 QA), 1 PM, 1 domain researcher (from Comlux)

---

#### **Tier 2: MVP Internals—Add Automation Evidence (Weeks 5-10)**

**Goal:** Prove that automation reduces manual effort and improves scaling potential

**New Capabilities:**

- **Lightweight scraper (Weeks 5-6):** Automated daily pulls from approved external candidate sources. Targets: 30-50 candidates/day per customer
- **Self-testing prototype (Weeks 7-8):** System validates match quality against historical conversions; adjusts confidence scoring monthly
- **Pre-screening agent pilot (Weeks 9-10):** Automated checks for tooling ownership, A&P certification, airport badge eligibility

**Enhanced Capabilities:**

- Sourcing combines manual + automated candidates (hybrid approach)
- Confidence scores now show transparent reasoning ("A&P cert + 5yr MRO exp + local + availability signal")
- Pre-screening dashboard for domain SME review

**Not Included:** Full continuous monitoring, anomaly detection, advanced ML, cost transparency dashboard

**Success Criteria:**

- Sourcing velocity increases 3x (50-100 candidates/day by week 10)
- Pre-screening reduces manual recruiter time by 30%
- Self-testing validates 90%+ match accuracy (vs. historical outcomes)

**Team:** +1 backend engineer for scraper/automation; existing team continues

---

#### **Tier 3: Pilot Ready—Real-World Validation (Weeks 11-14)**

**Goal:** Prove unit economics work; collect data for scaling decision

**Pilot Readiness:**

- Select 1-2 ideal-fit customers (high-velocity hiring, strong processes, commitment to feedback)
- Deploy hybrid sourcing + automation across full customer workflow
- Establish metrics tracking: conversions, sourcing velocity, cost-per-hire, time-to-fill
- Create operational playbook for scaling to 3-5 customers

**Success Criteria:**

- 1-2 pilots achieve 5-8% conversion rate (validates funnel)
- Cost-per-hire: $600-800 (validates unit economics at $800 margin)
- Time-to-fill: <7 days average (validates 24-hr candidate delivery)
- Recruiter feedback: "This saves me 10+ hours/week" (adoption signal)
- Operational readiness: <0.5 FTE support per 3 customers

---

### Phased Development Roadmap

#### **Phase 1 (Weeks 1-14): MVP Launch**

**Timeline:** 14 weeks (Tier 1-3 sequential build)
**Team:** 4 engineers, 1 PM, 1 domain researcher
**Budget:** ~$70K (engineering + infrastructure)
**Outcome:** 1-2 live pilots, validated unit economics, proof of differentiation

**Phase 1 Success Metrics:**

- 5-8% conversion rate (realistic for Month 1-2)
- <7 day time-to-fill (vs. industry 3-4 weeks)
- 3x recruiter productivity gain (vs. 1.2x typical ATS)
- 80% interview attendance rate
- 85% SMS response rate
- <$800 cost-per-hire (validated unit economics)

---

#### **Phase 2 (Weeks 15-30): Growth & Scale**

**Focus:** Automation hardening + capacity scaling + additional customer onboarding

**Features Added:**

- Continuous daily scraping at full scale (100+ candidates/day per customer)
- ML-powered confidence calibration (98%+ accuracy)
- Anomaly detection (GPS, access patterns, fraud detection)
- Availability forecasting & seasonal intelligence
- Expanded pre-screening (multi-stage agents for domain variations)
- Admin tenant provisioning UI (no manual DB scripts)

**Phase 2 Success Metrics:**

- Scale to 5-10 active customers
- 15-20% conversion rate (Month 3-4)
- Enable 2 clients/recruiter (vs. 1 in Phase 1)
- $1.8K revenue/recruiter/week (margin-based scaling)
- 98% match confidence validated

---

#### **Phase 3 (Months 6+): Expansion & Platform**

**Focus:** Market expansion + compliance automation + universal platform

**Features Added:**

- Compliance automation (drug test letters, background check integration)
- Cost transparency dashboard (per-tenant metering)
- Universal platform template (non-aviation staffing domains)
- Predictive sourcing (contract vs. permanent hiring patterns)
- Stakeholder-specific dashboards (CFO margins, compliance audits, etc.)

**Phase 3 Success Metrics:**

- 40% conversion rate (Month 6+)
- 3 clients/recruiter (full multi-client workflow)
- 50+ active customers by Q4
- $4.8K+ revenue/recruiter/week
- Break-even achieved (month 4 with 20 customers)

---

### Risk Mitigation Strategy

#### **Technical Risks**

| Risk                                                         | Tier Introduced | Mitigation                                                             |
| ------------------------------------------------------------ | --------------- | ---------------------------------------------------------------------- |
| Manual sourcing doesn't scale (recruiter becomes bottleneck) | Tier 1          | Add lightweight scraper by week 5 (Tier 2)                             |
| Pre-screening agents make wrong calls (too strict/loose)     | Tier 2          | Start with 50% automation; manual review of borderline cases           |
| Confidence scoring unreliable                                | Tier 2          | Month 1-2: transparent reasoning only; don't claim 95% until validated |
| Continuous scraper hits API limits                           | Tier 2          | Implement quota management + graceful degradation by week 6            |

#### **Market Risks**

| Risk                                                     | Validation Point       | Mitigation                                                                 |
| -------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------- |
| Availability-first hypothesis doesn't improve conversion | End of Tier 1 (week 4) | Pilot with Comlux decision-makers; compare vs. their historical data       |
| Continuous outreach is perceived as spam                 | Tier 1 (week 2)        | A/B test messaging; start conservative (1/week), ramp based on feedback    |
| Customers can't adopt due to process friction            | Tier 1 (week 4)        | Conduct on-site training; measure recruiter time-to-productivity           |
| Economics don't work (cost-per-hire > margin)            | Tier 3 (week 14)       | If unit economics fail, pause Phase 2; pivot to event-based sourcing model |

#### **Resource Risks**

| Scenario                      | Contingency                                                            |
| ----------------------------- | ---------------------------------------------------------------------- |
| Domain researcher unavailable | Use Comlux partnership for sourcing; extend Tier 1 timeline by 1 week  |
| Backend engineer unavailable  | Defer lightweight scraper to week 7; compress Tier 2 (5 weeks)         |
| Funding delayed               | Reduce Tier 2 scope; launch Tier 1+MVP only (weeks 1-10); delay Tier 3 |

---

### Success Gates & Go/No-Go Decision Points

**End of Tier 1 (Week 4): Continue to Tier 2?**

- ✅ Go if: Manual sourcing achieves 5-8% conversion; customers request automation
- 🛑 No-go if: Manual sourcing <2% conversion; availability hypothesis unsupported

**End of Tier 2 (Week 10): Continue to Tier 3?**

- ✅ Go if: Scraper working; pre-screening accuracy >90%; team confident in reliability
- 🛑 No-go if: Scraper unreliable; pre-screening false negatives >30%; engineering debt too high

**End of Tier 3 (Week 14): Launch to Phase 2?**

- ✅ Go if: 1-2 pilots at 5-8% conversion; cost-per-hire <$900; operational playbook ready
- 🛑 No-go if: Pilots <3% conversion; cost-per-hire >$1,200; scaling plan unclear

---

### MVP vs. Phase 1 vs. Full Platform Clarity

**What shipped in Phase 1 (after week 14):**

- ✅ Proof-of-concept MVP with manual sourcing
- ✅ Lightweight automation (scraper, pre-screening, self-testing)
- ✅ 1-2 live pilots generating real ROI
- ✅ Operational playbook for 3-5 customer scaling

**What's NOT in MVP (deferred):**

- ❌ Full continuous monitoring (99.5% SLA monitoring)
- ❌ Anomaly detection (GPS/access patterns)
- ❌ Advanced ML (98% confidence)
- ❌ Compliance automation (drug test letters)
- ❌ Universal platform (non-aviation)
- ❌ 100 recruiters at scale (focus on 1-2 customers)

**Why this scope works:**

- Validates core hypothesis (availability-first improves hiring velocity) by week 4
- Proves differentiation (automation begins week 5, not week 16) by week 10
- Demonstrates unit economics (realistic 5-8% conversion) by week 14
- Sets board expectations (phased approach, clear go/no-go gates) from launch

## Functional Requirements

**THE CAPABILITY CONTRACT:** Every feature listed below defines what CBLAero IS. Features not listed here will NOT exist in the final product unless explicitly added. This section binds all downstream design, architecture, and engineering work.

**FR Allocation by Phase:**

- **MVP Tier 1 (Weeks 1-4):** Core mission FRs + pre-screening + compliance basics = ~45 FRs
- **MVP Tier 2 (Weeks 5-10):** Automation + advanced notifications + ML basics = +26-33 FRs
- **MVP Tier 3 (Weeks 11-14):** Ops, scaling, pilot ops = +7-11 FRs
- **Phase 2+ (Month 5+):** Advanced integrations, white-label, universal platform = remaining FRs

**🔴 Critical Gaps Addressed:** 9 gaps identified in advanced elicitation now integrated below (marked with ⚠️).

---

### Candidate Management

- **FR1 [MVP Tier 1]:** System can ingest candidate records from bulk CSV upload (up to 1M records initial load, then daily/weekly recruiter uploads of 100–10,000 records); upload must validate, deduplicate, retain unmapped columns in candidate `extra_attributes` (JSONB), and report import errors per row with a downloadable error report. Guardrails: blocked sensitive keys (`password`, `token`, `secret`, `api_key`) are dropped; per-row `extra_attributes` payload is capped by key count and serialized size.
- **FR1b [MVP Tier 1]:** System can ingest candidate records from PDF resume uploads (single file or entire folder; PDF format only, no hard cap on file count). The system extracts candidate data from each resume via LLM-powered parsing (batched internally), presents extracted data for recruiter review before confirmation, and persists validated records through the standard ingestion pipeline with `source: resume_upload` attribution. Resumes are stored in Supabase Storage (`candidate-attachments` bucket) and linked to the candidate record. Non-PDF file types are rejected with a clear message instructing the recruiter to convert before uploading. A progress tracker shows per-file extraction status for large uploads.
- **FR1a [MVP Tier 1]:** System can perform initial bulk load of up to 1M existing candidate records via a one-time admin-supervised migration pipeline; load must complete within a time-bounded batch window with progress tracking and rollback capability
- **FR2 [MVP Tier 2]:** System can ingest candidate data automatically from configured ATS system connectors (read-only API polling or webhook) and recruiter email inboxes (Microsoft Graph mail parsing); new or updated records are upserted via the standard deduplication pipeline with source attribution
- **FR3 [MVP Tier 1]:** System can store and index candidate profiles with core attributes (name, phone, email, location, skills, certifications, experience, availability status) in Supabase Postgres as the system of record; candidate semantic-retrieval indexes use `pgvector` under tenant-scoped access controls
- **FR4 [MVP Tier 1]:** System can deduplicate candidate records (detect same person across multiple sources; prevent duplicate outreach) with deterministic merge policy: auto-merge at >=95% identity confidence, manual-review queue at 70-94%, keep separate below 70% ⚠️
- **FR5 [MVP Tier 1]:** System can track candidate availability status (active, passive, unavailable) using self-reported status plus engagement events from the previous 90 days (response, click, call outcome)
- **FR6 [MVP Tier 1]:** System can archive candidate records indefinitely with 5-year queryable retention and 7-year cold storage; implement GDPR right-to-be-forgotten deletion policy ⚠️
- **FR7 [MVP Tier 1]:** Recruiter can view complete candidate profiles including enriched data (company history, skills, location, match reason)

### Outreach & Engagement

- **FR8 [MVP Tier 1]:** System can compose and schedule SMS outreach using parameterized templates (name, role, location, preferred time) and enforce candidate contact windows
- **FR9 [MVP Tier 1]:** System can compose and schedule email outreach using parameterized templates with role-based edit permissions and template version history
- **FR10 [MVP Tier 1]:** System can manage per-candidate communication channel preferences (SMS vs. email opt-in, TCPA compliance per channel) ⚠️
- **FR11 [MVP Tier 1]:** Candidate can respond to SMS/email with availability confirmation, preferred contact window, and structured seriousness fields (tool ownership, badge readiness, decision timeline)
- **FR12 [MVP Tier 1]:** System can track SMS and email delivery status and response rates per recruiter, per customer, per candidate pool
- **FR13 [MVP Tier 1]:** System can honor candidate opt-outs from SMS/email and prevent further outreach per channel
- **FR14 [MVP Tier 1]:** System can enforce opt-out compliance (TCPA regulations) for SMS and email campaigns; maintain audit trail of all outreach
- **FR15 [MVP Tier 2]:** System can retry failed outreach with bounded policy (maximum 3 retries, escalating delay, then terminal `undeliverable` status with admin alert)
- **FR16 [MVP Tier 1]:** Candidate can register for the platform via SMS/email link with one-time token validation (15-min expiry)
- **FR17 [MVP Tier 2]:** System can launch bulk outreach campaigns for batch sizes between 50 and 5,000 candidates with per-batch completion reporting; at 1M+ record scale, campaign targeting uses pre-computed index slices rather than full-table scans ⚠️

### Recruiter Workflow

- **FR18 [MVP Tier 1]:** Recruiter can post a new job requirement with client details, role description, and 10 mandatory aviation-specific intake questions
- **FR19 [MVP Tier 1]:** Recruiter can view daily-refreshed candidate list for each job, sorted by opportunity score and availability signal
- **FR20 [MVP Tier 1]:** Recruiter can view structured candidate match reasons containing at least certification fit, experience fit, location fit, and availability fit; if semantic retrieval (RAG) contributes to explanation, each reason must include traceable grounded source references and tenant-safe retrieval filtering
- **FR21 [MVP Tier 1]:** Recruiter can log interactions with each candidate (call, SMS response, declined, interviewed, placed)
- **FR22 [MVP Tier 1]:** Recruiter can track candidate journey status (prospects → interested → interview scheduled → interview in progress → interview attended/missed → offer extended → placed → started), including attendance confirmation
- **FR23 [MVP Tier 3]:** Recruiter can execute formal offer workflow (create offer, submit for sign-off, send to candidate, capture accept/decline state, and log turnaround time) ⚠️
- **FR24 [MVP Tier 2]:** Recruiter can bulk-update candidate status, tags, or job assignments for batch sizes between 50 and 1,000 records with success/failure summary ⚠️
- **FR25 [MVP Tier 1]:** Recruiter can export candidate list in structured formats for approved downstream systems while preserving match score, reason summary, and communication status
- **FR26 [MVP Tier 1]:** Recruiter can manage multiple client accounts with explicit active-client context indicator and confirmation before cross-client actions
- **FR27 [MVP Tier 1]:** Recruiter can view personal metrics dashboard (candidates delivered, conversions, time-to-fill, commissions, peer comparison vs. team average) ⚠️

### Match & Scoring

- **FR28 [MVP Tier 1]:** System can assign opportunity score (0-100) using weighted factors: skills (40%), availability (30%), location fit (20%), domain requirements (10%)
- **FR29 [MVP Tier 1]:** System can validate availability signals by comparing stated availability against engagement activity from the prior 90 days and marking stale signals older than 7 days
- **FR30 [MVP Tier 1]:** System can compute seriousness state (`High`, `Medium`, `Low`) from behavioral responses (tool ownership, badge readiness, decision timeline) using explicit scoring rules
- **FR31 [MVP Tier 1]:** System can screen for mandatory domain requirements (A&P certification, airport badge eligibility, no felony records)
- **FR32 [MVP Tier 1]:** System can flag candidates who don't meet hard requirements (missing certs, criminal history, unavailable tools) with explicit rejection reason code (`missing_certification`, `badging_ineligible`, `tooling_missing`, `availability_mismatch`)
- **FR33 [MVP Tier 2]:** System can test match confidence against prior 90-day conversion outcomes, recalibrate scoring monthly, and achieve >=90% precision in the top confidence quintile by end of Tier 2 (Month 1-2 manual, Month 3+ ML-assisted)
- **FR34 [MVP Tier 1]:** System can refresh candidate data (availability, location, skills) on a 4-hour cadence (Tier 1) or continuous with caching (Tier 2+) using centrally managed schedule policies rather than worker-local timers
- **FR35 [MVP Tier 1]:** System can apply seasonal hiring adjustments with configurable weighting (+/-15%) by month and geography, with override controls for delivery head users

### Team Collaboration & Notifications

- **FR36 [MVP Tier 2]:** System can send daily Teams notification to recruiter with top 5 candidates for each job, including match reasons and contact buttons
- **FR37 [MVP Tier 2]:** System can embed rich notification cards in Teams with candidate summary, confidence score, and one-click call/email actions
- **FR38 [MVP Tier 1]:** System can notify Delivery Head on explicit events: interview scheduled, interview attended/missed, offer accepted/declined, placement started, and cost threshold breach
- **FR39 [MVP Tier 2]:** Delivery Head can drill into recruiter performance metrics from notifications, view workload imbalance indicators by recruiter, and receive reassignment recommendations when workload variance exceeds 20% from team median for 3 consecutive days
- **FR40 [MVP Tier 2]:** Admin can configure notification channels, cadence (daily/weekly/immediate), schedule state (pause/resume), and metric thresholds per role and per customer through a centralized configuration console

### User Authentication & Access Control

- **FR41 [MVP Tier 1]:** User can log in via enterprise SSO for @cblsolutions.com users, with session persistence and `remember device` option (30 days)
- **FR42 [MVP Tier 1]:** System can enforce role-based access control: Recruiter, Delivery Head, Admin, Compliance Officer
- **FR43 [MVP Tier 1]:** System can isolate multi-tenant data: Recruiter can only see their own customer's candidates; no cross-customer visibility guaranteed
- **FR44 [MVP Tier 1]:** Admin can invite new users, assign roles, manage team membership, and audit all admin actions separately
- **FR45 [MVP Tier 2]:** System can require step-up authentication for sensitive operations (data export, role changes, communication history access)

### Metrics & Reporting

> **Dashboard Visual Standards:** All dashboard pages follow a unified design system (white backgrounds, consistent headers/footers, standardized typography and colors). See [`cblaero/docs/dashboard-ui-standards.md`](../../cblaero/docs/dashboard-ui-standards.md) and development-standards.md §27.

- **FR46 [MVP Tier 1]:** Dashboard displays operational metrics (candidates delivered, SMS response rate, interview request rate, conversion rate, time-to-fill) with refresh interval <=4 hours
- **FR47 [MVP Tier 1]:** Dashboard shows per-recruiter metrics (productivity, conversion rate, attendance rate, cost-per-hire) with 30/60/90-day trend views
- **FR48 [MVP Tier 1]:** Dashboard shows per-customer metrics (placements/month, revenue/recruiter/week, cost-per-hire, churn rate) with month-over-month delta
- **FR49 [MVP Tier 2]:** Dashboard displays cost tracking per customer and per component (enrichment, SMS, email) with threshold alerts at 80/90/100% budget ⚠️
- **FR50 [MVP Tier 2]:** Delivery Head can view peer performance comparison (individual recruiter metrics vs. team average, percentile ranking) and recommended support reassignments when a recruiter's rolling 30-day conversion rate is >=15% below team average ⚠️
- **FR51 [MVP Tier 2]:** Delivery Head can view forecasted pipeline (30-60 day) and forecast-vs-actual cohort performance by month
- **FR52 [MVP Tier 2]:** System can alert when KPI thresholds are breached (conversion rate <5%, SMS response rate <70%, cost-per-hire >$1,000) ⚠️
- **FR53 [MVP Tier 1]:** Admin can export audit logs for compliance review (all user actions, data access, system events, timestamp, actor) from Supabase Postgres append-only audit storage, including deterministic linkage to any vector-indexed audit records used for semantic compliance search
- **FR54 [MVP Tier 1]:** System can alert when cost triggers are hit (API spend >$1k/month, SMS >$200/placement, churn >10%)
- **FR55 [MVP Tier 2]:** System can forecast budget overspend (notify CFO/Admin at 80%, 90%, 100% of monthly budget) ⚠️

### Domain Compliance & Regulatory

- **FR56 [MVP Tier 1]:** System can capture 10 mandatory aviation-specific intake questions (aircraft type, tools, shift/AOG, decision-maker, red flags, etc.)
- **FR57 [MVP Tier 1]:** System can validate FAA A&P certifications for aviation maintenance roles with verification state (`verified`, `unverified`, `expired`) and 90-day revalidation cadence
- **FR58 [MVP Tier 1]:** System can screen for airport badge eligibility (flag candidates with felony records, drug test history, mandatory clearances)
- **FR59 [MVP Tier 1]:** System can track drug test compliance status and generate drug test request letters
- **FR60 [MVP Tier 1]:** System can maintain communication audit trail for every message (channel, timestamp, sender role, recipient, delivery status, response state, content hash) for GDPR/SOC 2 ⚠️
- **FR61 [MVP Tier 1]:** System can flag candidates who fail mandatory pre-screening (missing tooling, cert issue, criminal record) with transparency into why
- **FR62 [MVP Tier 3]:** System can implement GDPR deletion workflow (request intake, approval, purge execution, third-party confirmation, completion proof) within 30 days ⚠️

### System Operations & Infrastructure

- **FR63 [MVP Tier 2]:** System can monitor external provider health and alert Admin when rolling 1-hour availability drops below 95%
- **FR64 [MVP Tier 2]:** System can meter API usage per-customer and trigger alerts at 80% quota usage (prevent runaway costs)
- **FR65 [MVP Tier 1]:** System can gracefully degrade if APIs fail: queue candidates for batch processing; notify recruiter of delay with ETA
- **FR66 [MVP Tier 1]:** System can log all user actions (user, timestamp, action, resource, change delta) in immutable append-only audit trail (5-year hot, 7-year cold) persisted in Supabase Postgres with multi-instance-safe write semantics (no process-local-only state)
- **FR67 [MVP Tier 2]:** System can detect anomalies (unusual access patterns, bulk data export, impossible geolocation changes) using severity thresholds and alert Compliance Officer within 15 minutes for high-severity events; semantic anomaly correlation may use RAG over tenant-scoped audit history in `pgvector`
- **FR68 [MVP Tier 1]:** Admin can manually refresh candidate data from external sources if scheduled refresh fails; the manual action creates an ad hoc refresh job without mutating the recurring schedule definition
- **FR69 [MVP Tier 1]:** System can backup data daily to immutable cold archive with encryption and integrity verification
- **FR70 [MVP Tier 1]:** System can enforce USA-only data residency for customer data, logs, and backups within approved USA regions

### Candidate Portal

- **FR71 [MVP Tier 2]:** Candidate can log in via SMS token or email link and view their profile
- **FR72 [MVP Tier 2]:** Candidate can update availability status and seriousness inputs (tool ownership, badge readiness, decision timeline)
- **FR73 [MVP Tier 2]:** Candidate can view application status (applied → screening → interview → offer → placement → started)
- **FR74 [MVP Tier 2]:** Candidate can receive status notifications for interview scheduled, interview attended/missed, offer sent, offer decision, and start-date confirmation
- **FR75 [MVP Tier 2]:** Candidate can download offer letter and other documents from portal

---

### Functional Requirements Summary by Phase

**Tier 1 MVP (Weeks 1-4): 45 FRs**
Core mission FRs (sourcing, outreach, workflow, scoring, compliance, audit, ops):

- Candidate Management: FR1, FR1b, 3, 4, 5, 6, 7 (all manual sourcing focus)
- Outreach & Engagement: FR8-14, 16 (SMS/email outreach + opt-out compliance)
- Recruiter Workflow: FR18-22, 25-27 (job posting, workflow, clients)
- Match & Scoring: FR28-35 (availability-first scoring, domain screening)
- Authentication: FR41-45 (enterprise SSO, RBAC, multi-tenancy)
- Metrics: FR46-48, 53-54 (basic dashboard, audit logs, alerts)
- Compliance: FR56-61 (domain questions, FAA, badging, audit trail)
- Operations: FR65-70 (graceful degrade, audit trail, backup, residency)

**Tier 2 MVP (Weeks 5-10): +28 FRs**
Automation evidence + advanced features:

- Candidate Management: FR2 (scraper)
- Outreach: FR15, 17 (retry, bulk)
- Workflow: FR24 (bulk ops)
- Scoring: FR33 (self-testing)
- Notifications: FR36-40 (Teams integration)
- Metrics: FR49-52, 55 (cost dashboard, KPI alerts, forecasting)
- Operations: FR63-67 (API monitoring, anomaly detection)
- Portal: FR71-75 (candidate portal)

**Tier 3 MVP (Weeks 11-14): +2 FRs**
Pilot ops + scaling:

- Workflow: FR23 (offer management)
- Compliance: FR62 (GDPR deletion workflow)

**Total MVP Phase 1 (14 weeks):** 45 + 28 + 2 = **75 numbered FRs**, plus **FR1a** = **76 FR identifiers**

---

### Critical Gaps Integrated (9 items, all addressed)

✅ **FR4:** Candidate deduplication (prevents duplicate outreach)  
✅ **FR10:** Per-channel communication preferences (TCPA compliance)  
✅ **FR6, FR60, FR62:** Communication audit history + data deletion (SOC 2 + GDPR)  
✅ **FR23:** Offer management workflow (placement tracking)  
✅ **FR49, FR55:** Real-time cost dashboard + budget alerts (CFO/customer visibility)  
✅ **FR50:** Peer performance comparison (Delivery Head diagnostics)  
✅ **FR52:** KPI threshold alerts (early warning system)

---

### The Capability Contract

This FR list is now BINDING. Any feature not listed here will NOT exist in the final product unless explicitly approved and added. Each FR traces back to user journeys, success criteria, domain requirements, or innovation patterns.

Design, architecture, and engineering teams should treat this section as the canonical capability contract and refine remaining acceptance details during story decomposition where explicitly marked.

## Non-Functional Requirements

**THE QUALITY CONTRACT:** Non-functional requirements define HOW WELL the system performs quality attributes like speed, security, reliability, and scale. Only relevant categories are included; bloat is avoided.

---

### Performance Requirements

**User-Facing Response Times:**

- **NFR1 [MVP Tier 1]:** Candidate list load: **<2 seconds p95** (100 concurrent recruiter load test)
- **NFR2 [MVP Tier 1]:** Candidate enrichment (external provider call): **<10 seconds p95** (single candidate, 50th percentile at 3-5sec)
- **NFR3 [MVP Tier 2]:** Teams notification delivery: **<1 minute** (from scoring completion to Teams card rendered)
- **NFR4 [MVP Tier 1]:** Recruiter interaction logging (call/SMS response): **<500ms p95** with visible UI acknowledgment in **<=1 second**
- **NFR5 [MVP Tier 1]:** Dashboard metric refresh: **<2 seconds** load time (basic dashboard refresh)

**Throughput & Concurrency:**

- **NFR6 [MVP Tier 2]:** Concurrent candidate enrichment: **100 candidates/sec sustained** (5-minute load test without performance degradation); initial 1M-record bulk enrichment runs as a rate-limited overnight batch job, not a real-time process
- **NFR7 [MVP Tier 2]:** SMS delivery throughput: **1,000 SMS/minute** peak capacity (10k SMS/day = 7/sec average, 150/sec peak during morning sends)
- **NFR8 [MVP Tier 1]:** Concurrent recruiter connections: **100 recruiters simultaneously** while maintaining candidate-list response **<2 seconds p95**

**Rationale:** Candidate delivery >2sec loses recruiter adoption (they revert to manual sourcing tools). Enrichment >10sec breaks automation value prop. Daily notifications must land within business day.

---

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

---

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

---

### Reliability & Uptime Requirements

**Availability SLAs:**

- **NFR27 [MVP Tier 1]:** System uptime: **99.5%** availability (excludes planned maintenance; ~3.6 hours/month acceptable downtime)
  - Measured: Automated health checks every 5 minutes
  - Alert: Admin notified if downtime >15 minutes

**Graceful Degradation:**

- **NFR28 [MVP Tier 1]:** API circuit breaker: external-provider timeout >10sec triggers fail-safe queue mode and batch retry
  - Recruiter sees: "Enrichment queued; will complete in <1 hour"
  - No error to user; automatic retry with exponential backoff
- **NFR29 [MVP Tier 1]:** SMS/email delivery failure mode: If provider unavailable, queue for 24-hour retry window; do not drop messages
- **NFR30 [MVP Tier 1]:** Database failover: Supabase Postgres high-availability failover to approved standby within <5 minutes recovery, with all authentication, revocation, admin-governance, and audit persistence remaining consistent across horizontally scaled app instances

**Backup & Recovery:**

- **NFR31 [MVP Tier 1]:** Database backup: Daily Supabase Postgres snapshot plus point-in-time recovery configuration to immutable cold archive; recovery tested monthly
  - Recovery time objective (RTO): <1 hour to restore from backup
  - Recovery point objective (RPO): <24 hours of data loss acceptable
- **NFR32 [MVP Tier 2]:** Disaster recovery runbook: Documented procedures for major outages; tested quarterly with dry-run exercises

**Monitoring & Alerting:**

- **NFR33 [MVP Tier 1]:** Critical error alerting:
  - Database connection errors → Admin alert within 5 minutes
  - API quota exceeded → Finance alert + Delivery Head alert
  - Authentication system unavailable → All leaders notified
  - 99.5% uptime breached → Incident review triggered

---

### Scalability Requirements

**Initial Scale (MVP Tier 1, Week 4):**

- **NFR34 [MVP Tier 1]:** Support 50-100 recruiters, 50k candidate records, <100ms relational query latency on Supabase Postgres, and <=250ms p95 tenant-filtered vector retrieval latency for approved semantic lookup paths
  - Single approved USA region deployment
  - No horizontal data partitioning required

**Growth Scale (Tier 3, Week 14):**

- **NFR35 [MVP Tier 3]:** Support 100-200 recruiters, 200-500k candidate records, <100ms query latency (p95)
  - Dedicated analytical query path may be needed
  - Database indexes optimized for 500k records

**Year 1 Scale (Phase 2+):**

- **NFR36 [MVP Tier 2+]:** Support 200 recruiters, 5M candidate records, <100ms relational query latency, <=250ms p95 tenant-filtered vector retrieval latency, and 10x capacity headroom on Supabase Postgres + `pgvector`
  - Horizontal data-partitioning plan if >50M records
  - High-speed caching layer for real-time candidate lists
  - Global static-asset distribution for user-facing portals

**Design for Growth:**

- **NFR37 [MVP Tier 1]:** Architecture supports 10x user growth with <10% performance degradation (no architectural rework required until 50M records)
- **NFR38 [MVP Tier 2]:** Horizontal scaling: processing services can scale independently; asynchronous task orchestration required for non-blocking workflows

---

### Quality Gate Summary

**Launch Gate Criteria (Week 14, End of Tier 3):**

✅ **Performance:** All user-facing actions <2sec p95; 100 concurrent users tested  
✅ **Security:** Penetration test passed; no critical vulnerabilities; encryption verified  
✅ **Compliance:** Audit trail complete (5-year retention verified); GDPR/TCPA compliance framework in place  
✅ **Reliability:** 99.5% uptime achieved in staging; graceful degradation tested for all external APIs  
✅ **Scalability:** 2-5 customer pilot load test completed; database handles 500k records at <100ms latency

---

### NFR Trade-offs & Assumptions

**Performance vs. Cost:**

- <2sec candidate load requires aggressive in-memory caching; additional infrastructure cost is an acceptable trade-off for user adoption.

**Security vs. Usability:**

- Step-up MFA for data exports is friction, but required for SOC 2. Acceptable; recruiter friction <1% of workflow time.

**Compliance vs. Speed:**

- GDPR deletion verification (30-day process) is slow, but required by law. Async process doesn't block recruiter operations.

**Scalability vs. Simplicity:**

- Horizontal data-partitioning plan deferred to Phase 2 (after 50M records); simpler MVP architecture acceptable for Tier 1-3.
