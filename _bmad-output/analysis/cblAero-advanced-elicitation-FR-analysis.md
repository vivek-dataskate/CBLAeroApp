# CBLAero Functional Requirements: Advanced Elicitation Analysis
**Expert Elicitation Report | Advanced Reasoning Methods Applied**

**Date:** 2026-03-04  
**Analyst:** Advanced Elicitation Framework  
**Scope:** Validation of CBLAero FR completeness (62 FRs across 10 capability areas)  
**Status:** CRITICAL GAPS IDENTIFIED – Recommendation: Address before Phase 1 launch

---

## Executive Summary

CBLAero's FR set comprehensively covers core platform functionality but has **9 critical gaps** and **5 phase-scoping misalignments** that create execution risk. Using six advanced elicitation methods (Stakeholder Round Table, Red Team vs Blue Team, Completeness Mapping, First Principles Analysis, Devil's Advocate Challenge, and MVP Scope Reevaluation), this analysis identifies gaps, validates core assumptions, and recommends phase adjustments.

**Key Findings:**
- ✅ **Strengths:** Domain compliance FRs comprehensive; core sourcing/outreach well-scoped; success criteria measurable
- ⚠️ **Misalignments:** 15-20 FRs are Phase 2+ features front-loaded into MVP scope
- 🔴 **Critical Gaps:** Candidate deduplication, communication preferences, data retention/deletion, customer exports, offer workflow

**Recommendation:** Add 5 critical gap FRs to MVP scope; defer 8-10 Nice-to-Have FRs to Phase 2; reduce MVP FR count from 62 to ~45 for realistic 14-week delivery.

---

## METHODOLOGY 1: STAKEHOLDER ROUND TABLE

### Goal
Convene each persona to validate FRs against their needs and expose missing capabilities.

---

### **RECRUITER PERSONA** – Mike (Senior Aviation Staffing Recruiter)

**Stated Needs:** "I need candidates delivered daily, logging interactions, tracking conversions. Am I seeing all the workflow capabilities I need? What am I missing?"

**Requirements Validation:**

| FR Category | Capability | Validated? | Gap? |
|---|---|---|---|
| Outreach & Engagement | SMS/email automation | ✅ Yes | — |
| Recruiter Workflow | Candidate list + details | ✅ Yes | — |
| Recruiter Workflow | Log interactions | ✅ Yes | — |
| Recruiter Workflow | Track outcomes (interview/placement) | ✅ Yes | — |
| Match & Scoring | Confidence scores + reasoning | ✅ Yes | — |
| Metrics & Reporting | Daily delivery SLA (5 cand/24hrs) | ✅ Yes | — |
| **Recruiter Workflow** | **Bulk operations (update 50 candidates at once)** | ❌ Not explicit | 🔴 CRITICAL |
| **Recruiter Workflow** | **Schedule outreach in advance (campaign calendar)** | ❌ Not explicit | ⚠️ MEDIUM |
| **Recruiter Workflow** | **Undo/recall sent outreach** | ❌ Missing | ⚠️ LOW |
| **Outreach & Engagement** | **Communication history audit (evidence for audit/GDPR)** | ❌ Missing | 🔴 CRITICAL |
| **Recruiter Workflow** | **Notes/internal tags on candidates** | ❌ Not explicit | ⚠️ MEDIUM |
| **Outreach & Engagement** | **Channel preference management (SMS vs email vs push)** | ❌ Missing | 🔴 CRITICAL |

**Mike's Verdict:** "You've got the basics. But here's what kills me: (1) I can't bulk-update 50 candidates at once when their availability changes. I have to click 50 times. (2) I can't see who I called before—no audit of my outreach history per candidate. That's a GDPR nightmare if someone asks 'did we contact this person?' and I can't prove it. (3) I need to know if a candidate wants SMS or email before we send; some people never respond to SMS. Without that, we're guessing and wasting credits."

**Mike's Critical Gaps:**
1. **Bulk operations** (update candidates, update jobs, launch campaigns to 100+ candidates)
2. **Communication audit trail** (per-candidate log of all outreach attempts, responses, timestamps)
3. **Channel preferences** (SMS vs email vs push opt-in per candidate, per channel)

---

### **DELIVERY HEAD PERSONA** – Elena (Delivery Head, Staffing Firm)

**Stated Needs:** "I need visibility into recruiter performance, pipeline forecasting, compliance tracking. Are the metrics FRs complete?"

**Requirements Validation:**

| FR Category | Capability | Validated? | Gap? |
|---|---|---|---|
| Metrics & Reporting | Recruiter performance (conversions, time-to-fill) | ✅ Yes | — |
| Metrics & Reporting | Pipeline forecasting | ✅ Yes | — |
| Metrics & Reporting | Compliance tracking (domain reqs met) | ✅ Yes | — |
| Metrics & Reporting | Real-time dashboard | ✅ Yes | — |
| **Metrics & Reporting** | **Peer comparison (compare 1 recruiter vs. team avg)** | ❌ Not explicit | ⚠️ MEDIUM |
| **Metrics & Reporting** | **Performance trend analysis (month-over-month recruiter velocity)** | ❌ Not explicit | ⚠️ MEDIUM |
| **Metrics & Reporting** | **KPI alerts (e.g., 'conversion rate fell below 5% this week')** | ❌ Missing | ⚠️ MEDIUM |
| **Metrics & Reporting** | **Custom report builder** | ❌ Missing | ⚠️ LOW (Phase 2) |
| **System Operations** | **Cost tracking per recruiter/customer** | ❌ Not explicit | ⚠️ MEDIUM |

**Elena's Verdict:** "The dashboard covers what I need to see, but I can't drill into 'why is Mike underperforming?' Is he contacting fewer candidates? Are his candidates less qualified? I need to compare Mike's metrics to the team average. Also, I should get an alert if our conversion rate drops below our target (e.g., <5%) so I can intervene."

**Elena's Critical Gaps:**
1. **Peer comparison metrics** (recruiter A vs. team average on key KPIs)
2. **Trend analysis** (month-over-month, quarter-over-quarter recruiter metrics)
3. **KPI alerts** (proactive notification when key metrics fall below thresholds)

---

### **COMLUX DOMAIN PARTNER PERSONA** – Raj (Director of Staffing, Comlux)

**Stated Needs:** "We need aviation-specific compliance (FAA certs, tooling, badging). Are domain FRs covering our requirements?"

**Requirements Validation:**

| FR Category | Capability | Validated? | Gap? |
|---|---|---|---|
| Domain Compliance & Regulatory | FAA cert validation (A&P, IA) | ✅ Yes | — |
| Domain Compliance & Regulatory | Type rating matching | ✅ Yes | — |
| Domain Compliance & Regulatory | Badging eligibility check | ✅ Yes | — |
| Domain Compliance & Regulatory | Drug test tracking | ✅ Yes | — |
| Domain Compliance & Regulatory | Tooling ownership validation | ✅ Yes | — |
| **Domain Compliance & Regulatory** | **Pre-screening workflow automation (conditional logic: if no A&P, auto-reject)** | ❌ Not explicit | ⚠️ MEDIUM |
| **Domain Compliance & Regulatory** | **Integration with FAA external data (cert verification API)** | ❌ Not explicit | ⚠️ MEDIUM |
| **Domain Compliance & Regulatory** | **Union/CBA compliance checking (IAMAW, TWU collective bargaining)** | ❌ Not explicit | ⚠️ LOW |
| **Candidate Management** | **Seasonal hiring intelligence (winter weather impact on recruitment)** | ❌ Not explicit | ⚠️ MEDIUM |

**Raj's Verdict:** "You've got the checklist items, but not the automation. You say 'tooling ownership validation' but that's just a question in the intake form. I need the system to automatically flag 'this candidate has no A&P' and either auto-reject or route for manual review. Also, we have union agreements with IAMAW; I need the system to know who's union-eligible in Indianapolis vs. who isn't. And seasonal patterns matter: in December, candidates don't want offers; in spring, they do. You need to track that."

**Raj's Critical Gaps:**
1. **Automated pre-screening logic** (if-then rules for auto-accept/auto-reject/manual review)
2. **FAA data integration** (real-time cert verification, not just questionnaire)
3. **Union/CBA compliance** (eligibility checking per location/agreement)
4. **Seasonal hiring patterns** (candidate seasonality by geography)

---

### **CFO/FINANCE PERSONA** – David (Owner/Finance Lead)

**Stated Needs:** "I need cost tracking, metering, ROI calculation. What's missing from operations/metrics FRs?"

**Requirements Validation:**

| FR Category | Capability | Validated? | Gap? |
|---|---|---|---|
| System Operations | Cost triggers (API >$1k/mo, SMS >$200/placement) | ✅ Yes | — |
| Metrics & Reporting | Placement ROI calculation | ✅ Yes | — |
| **System Operations** | **Real-time cost dashboard per tenant** | ❌ Not explicit | 🔴 CRITICAL |
| **System Operations** | **Cost forecasting (project Q2 spend based on current utilization)** | ❌ Not explicit | ⚠️ MEDIUM |
| **System Operations** | **Unit economics transparency (show cost-per-hire, margin per placement)** | ❌ Not explicit | 🔴 CRITICAL |
| **Metrics & Reporting** | **Channel cost breakdown (SMS cost, email cost, Clay enrichment cost)** | ❌ Not explicit | ⚠️ MEDIUM |
| **System Operations** | **Budget cap enforcement (prevent overspend)** | ❌ Not explicit | ⚠️ MEDIUM |

**David's Verdict:** "I see cost triggers in the spec, but I don't see how I can monitor cost in real-time. I need a dashboard showing 'SMS costs this month: $500, vs. budget: $700. At current pace, we'll hit cap on March 15th.' I also need to understand my margin: if I'm paying CLay $0.05 per enrichment, and I'm enriching 10k candidates/month, that's $500 + Telnyx SMS costs. If my placement fee is only $50/candidate, I'm upside down. I need that analysis baked into the dashboard."

**David's Critical Gaps:**
1. **Real-time cost tracking** (per-tenant, per-component breakdown)
2. **Cost forecasting** (burndown analysis, overspend alerts)
3. **Unit economics dashboard** (cost-per-hire, margin visibility)

---

### **COMPLIANCE OFFICER PERSONA** – Sarah (Compliance & Legal)

**Stated Needs:** "I need audit trails, data protection, privacy compliance. Are security/ops FRs covering need?"

**Requirements Validation:**

| FR Category | Capability | Validated? | Gap? |
|---|---|---|---|
| User Auth & Access | Role-based access control (RBAC) | ✅ Yes | — |
| Domain Compliance | GDPR/CCPA/TCPA consent tracking | ✅ Yes | — |
| System Operations | Audit logging (5-year retention) | ✅ Yes | — |
| **System Operations** | **Audit log immutability & tamper-proofing** | ❌ Not explicit | 🔴 CRITICAL |
| **System Operations** | **Right-to-be-forgotten (GDPR deletion) workflow** | ❌ Not explicit | 🔴 CRITICAL |
| **System Operations** | **Data retention policies (auto-delete candidate after 24mo no contact)** | ❌ Not explicit | 🔴 CRITICAL |
| **System Operations** | **Cryptographic signing of audit records** | ❌ Not explicit | 🔴 CRITICAL |
| **System Operations** | **Export audit logs for external audit (SOC 2, GDPR)** | ❌ Not explicit | ⚠️ MEDIUM |
| **Candidate Management** | **Communication history export (prove we asked for consent)** | ❌ Not explicit | 🔴 CRITICAL |

**Sarah's Verdict:** "You mention audit trails, but you don't say how they're protected. If recruiter logs can be deleted, that's not an audit trail—that's a liability. I need immutable, cryptographically-signed logs. Also, GDPR gives candidates the right to deletion. What's your workflow? Do we hard-delete them? Anonymize? Archive? And data retention: we can't keep candidate data forever; someone needs to define the lifecycle (e.g., 'delete after 24 months of inactivity' or 'delete after placement + 1 year'). Finally, if someone asks 'did you contact Candidate X and did they opt in to SMS?', I need to export proof of that communications history."

**Sarah's Critical Gaps:**
1. **Audit trail immutability** (cryptographic signing, no deletion, no tampering)
2. **Data retention/deletion policies** (GDPR right-to-be-forgotten, auto-delete workflows)
3. **Communication history audit** (exportable proof of outreach + consent)
4. **Audit export for compliance** (SOC 2 evidence, external auditor access)

---

### **SYSTEM ADMIN PERSONA** – Alex (IT/Operations)

**Stated Needs:** "I need tenant provisioning, health monitoring, error recovery. Are ops FRs realistic?"

**Requirements Validation:**

| FR Category | Capability | Validated? | Gap? |
|---|---|---|---|
| System Operations | Tenant provisioning | ✅ Yes | — |
| System Operations | API quota monitoring | ✅ Yes | — |
| System Operations | Error alerts (Teams + email) | ✅ Yes | — |
| **System Operations** | **Tenant provisioning UI (vs. manual DB scripts)** | ❌ Not explicit | ⚠️ MEDIUM |
| **System Operations** | **Automated health checks & self-healing** | ❌ Not explicit | ⚠️ MEDIUM |
| **System Operations** | **Runbook automation (auto-retry failed jobs)** | ❌ Not explicit | ⚠️ MEDIUM |
| **System Operations** | **Database scaling alerts (approaching storage limits)** | ❌ Not explicit | ⚠️ MEDIUM |
| **System Operations** | **Backup & restore testing** | ❌ Not explicit | ⚠️ MEDIUM |

**Alex's Verdict:** "I see requirements for monitoring, but provisioning a new tenant requires me to manually run SQL scripts. That's not scalable. Also, if an API call fails, you say 'alert me,' but then what? Do I manually retry? I need semi-automated recovery or at least a one-click runbook. And I need to know: if we hit storage limits at 3 AM, can you gracefully degrade or do we go down? Your spec says '99.5% uptime' but doesn't define how we hit that target."

**Alex's Critical Gaps:**
1. **Tenant provisioning UI** (no manual DB scripts)
2. **Automated health checks & recovery** (self-healing, graceful degradation)
3. **Database scaling alerts** (storage/performance approaching limits)
4. **Backup testing automation** (prove we can restore in RTO/RPO targets)

---

### **CANDIDATE PERSONA** – Sarah (Airbus Pilot Between Contracts)

**Stated Needs:** "I need simple signup, status tracking, responsive communication. Are candidate portal FRs sufficient?"

**Requirements Validation:**

| FR Category | Capability | Validated? | Gap? |
|---|---|---|---|
| Candidate Portal | Status tracking (applied → screening → offer → start) | ✅ Yes | — |
| Outreach & Engagement | SMS/email notifications | ✅ Yes | — |
| Candidate Portal | Availability preference submission | ✅ Yes | — |
| **Candidate Portal** | **Mobile-responsive portal** | ❌ Not explicit | ⚠️ MEDIUM |
| **Candidate Portal** | **One-click SMS response to outreach** | ❌ Not explicit | ⚠️ MEDIUM |
| **Candidate Management** | **Communication preference management (SMS, email, no contact)** | ❌ Not explicit | ⚠️ MEDIUM |
| **Candidate Portal** | **Signed offer letter download** | ❌ Not explicit | ⚠️ MEDIUM |

**Sarah's Verdict:** (From user journey) "I got an SMS about a captain position, responded within hours, and got called at my preferred time. That's great. But I should be able to log in and see the job details again (not just in the SMS). Also, I'd like to know status: 'Interview scheduled for March 10' or 'We're reviewing your profile.' And some jobs I just ignore—let me mark 'not interested' so you stop sending them. Also, when do I get the offer? Do I download it from the portal or does recruiter email a PDF?"

**Sarah's Critical Gaps:**
1. **Mobile-responsive portal** (works on phone, not just desktop)
2. **History & context** (re-read job details, see previous communications)
3. **Preference management** (opt-out specific jobs, channels)
4. **Offer management** (review, sign, download offer documents)

---

### **STAKEHOLDER ROUND TABLE SYNTHESIS**

**Critical Gaps Identified (Must Address):**

| Gap | Personas | Priority | Phase |
|---|---|---|---|
| Bulk operations (update 50+ candidates, launch campaigns) | Recruiter | 🔴 CRITICAL | Tier 1 |
| Communication audit trail (per-candidate outreach history) | Recruiter, Sarah | 🔴 CRITICAL | Tier 1 |
| Channel preferences management (SMS vs email per candidate) | Recruiter, Sarah | 🔴 CRITICAL | Tier 1 |
| Real-time cost tracking dashboard | CFO | 🔴 CRITICAL | Tier 1 |
| Unit economics transparency (cost-per-hire, margin calc) | CFO | 🔴 CRITICAL | Tier 1 |
| Audit trail immutability & encryption | Compliance | 🔴 CRITICAL | Tier 1 |
| Data retention/deletion policies (GDPR deletion) | Compliance | 🔴 CRITICAL | Tier 1 |
| Communication history export (prove consent) | Compliance, Recruiter | 🔴 CRITICAL | Tier 1 |
| Automated pre-screening logic (if-then rules) | Comlux | 🔴 CRITICAL | Tier 1 |
| **Peer comparison metrics** | Elena | ⚠️ MEDIUM | Tier 2 |
| **Trend analysis (month-over-month)** | Elena | ⚠️ MEDIUM | Tier 2 |
| **KPI alerts** | Elena | ⚠️ MEDIUM | Tier 2 |
| **Tenant provisioning UI** | Alex | ⚠️ MEDIUM | Tier 2 |
| **Automated health checks & recovery** | Alex | ⚠️ MEDIUM | Tier 2 |

---

## METHODOLOGY 2: RED TEAM vs BLUE TEAM

### Goal
Attack the FR list with critical challenges; defend with existing FRs or acknowledge gaps.

---

### **RED TEAM ATTACKS**

#### **Attack 1: Candidate Deduplication Ambiguity**
**Red Team Challenge:** "You say 'deduplication engine' but don't define severity. What if Clay enriches the same person twice from different sources? Same name, different email. Do you merge? Keep both? The FRs don't say what the confidence threshold is or how you handle '95% sure this is the same person.' If you get it wrong, candidate gets 2 SMS offers for the same job."

**Currently Addressed?**
- FR: "Deduplication engine: phone > email > fuzzy name/location, with ML-assisted scoring"
- Problem: Threshold not defined; merge/keep logic not specified; fallback for 50-60% confidence cases

**Blue Team Defense:**
- ✅ Deduplication FR exists (references phone, email, fuzzy match + ML scoring)
- ❌ Incomplete: Missing threshold definition and conflict resolution strategy
- **Recommendation:** Add sub-FR: "Dedup scoring: >95% = auto-merge; 70-95% = manual review flag; <70% = keep separate"

**Gap Status:** 🟡 PARTIAL – Needs refinement

---

#### **Attack 2: No Bulk Operations**
**Red Team Challenge:** "You say recruiters use Teams to see candidate list, but you don't mention bulk operations. What if recruiter Mike needs to update 100 candidates from 'interested' to 'interviewed' after a mass event? Or launch a campaign to all candidates in a job? One-by-one clicks scale to 5 hours. That's not helping productivity."

**Currently Addressed?**
- FR (Recruiter Workflow): View candidate details, log interactions, track outcomes
- Problem: No mention of bulk update, bulk campaign launch, or batch operations

**Blue Team Defense:**
- ❌ Bulk operations NOT mentioned in current FRs
- **Recommendation:** Add FRs: 
  - "FR-RW-XX: Bulk candidate update (status, tags, notes, availability)"
  - "FR-OE-XX: Bulk campaign launch to candidate segment (all, filtered by tag/download status)"
  - "FR-RW-XX: Bulk import (candidates, jobs, outcomes via CSV)"

**Gap Status:** 🔴 CRITICAL GAP – Mike's #1 pain point

---

#### **Attack 3: No ATS Integration**
**Red Team Challenge:** "Customers use Workday, Greenhouse, Lever. You don't mention integrating with their ATS. Are you replacing their ATS, or are you a sourcing layer on top? If you're a layer, you need to sync placements back to their ATS so hiring managers see 'Jane is placed.' If you don't integrate, they'll use a different tool for candidate tracking and you're just email/SMS automation."

**Currently Addressed?**
- FR (System Operations): Integration with FAA, background checks, Teams
- Problem: No mention of ATS (Workday, Greenhouse, Lever, etc.) integration

**Blue Team Defense:**
- ❌ ATS integration NOT in Tier 1 scope (acknowledged in docs)
- ✅ Acceptable as Phase 2 feature: "Defer ATS integration to Phase 2; Tier 1 uses CBLAero-native candidate DB"
- **Recommendation:** Document ATS integration as Phase 2 GA requirement (not MVP)

**Gap Status:** 🟡 ACCEPTABLE – Deferred to Phase 2, but document explicitly

---

#### **Attack 4: No Communication Preferences**
**Red Team Challenge:** "TCPA compliance requires explicit consent per channel. You mention 'SMS outreach with TCPA opt-outs' but don't say: can candidates opt-in to SMS but opt-out of email? What if candidate says 'only call me, no SMS'? Are you tracking that? If not, you'll blast SMS to someone who never asked for it = TCPA violation = $500-1,000 per SMS fine."

**Currently Addressed?**
- FR (Domain Compliance): "GDPR/CCPA/TCPA consent tracking"
- Problem: Consent tracking is per-candidate/global, not per-channel

**Blue Team Defense:**
- ❌ Channel-specific preferences NOT explicitly addressed
- **Recommendation:** Add FR: "FR-DC-XX: Channel preference management (SMS, email, phone, push) with explicit per-channel opt-in/opt-out; validate before sending"

**Gap Status:** 🔴 CRITICAL GAP – Legal/compliance risk

---

#### **Attack 5: No API Resilience Detail**
**Red Team Challenge:** "You say 'queue for retry' if Clay fails, but don't define queue timeout or retry strategy. What happens if Clay is down for 12 hours? Do candidates stay queued? Do you re-enrich when it's back up? If you queue for 24 hours and then skip, you miss the 'deliver in 24 hrs' SLA. If you queue forever, you're burning storage."

**Currently Addressed?**
- FR (System Operations): "Graceful degradation: batch mode = 4–6 hrs if APIs down"
- Problem: Queue persistence, retry count, timeout, and falling back to manual sourcing not specified

**Blue Team Defense:**
- ⚠️ Partially addressed: Graceful degradation mentioned but lacking specifics
- **Recommendation:** Add FR: "FR-SO-XX: API resilience (circuit breaker, exponential backoff, queue persistence to 48 hrs, then skip)"

**Gap Status:** 🟡 PARTIAL – Needs implementation detail

---

#### **Attack 6: No Offer Management**
**Red Team Challenge:** "You mention 'placed' candidate but don't say who creates offers, tracks offer status, or manages counteroffers. Does the recruiter go to a different system? Do they email the offer? If CBLAero doesn't track offers, you can't measure time-to-offer or conversion rate to placement. That metric is core to your success criteria."

**Currently Addressed?**
- FR (Recruiter Workflow): "Track outcomes (interview/placement)"
- Problem: Placement = binary (yes/no); offer status (pending, accepted, rejected, countered) not tracked

**Blue Team Defense:**
- ❌ Offer workflow NOT mentioned in current FRs
- **Recommendation:** Add FRs:
  - "FR-RW-XX: Create/track offer (status: pending, accepted, rejected, countered)"
  - "FR-RW-XX: Offer document management (template, sign, store, audit)"
  - "FR-RW-XX: Offer workflow integration with ATS (Phase 2)"

**Gap Status:** 🔴 CRITICAL GAP – Metric gap for placement tracking

---

#### **Attack 7: No White-Labeling**
**Red Team Challenge:** "You want to scale to multiple staffing firms. Does each firm get their own branding (logo, colors, domain)? You don't mention white-labeling, custom notification templates, or partner-specific branding. If customer sees generic 'CBLAero' branding when they share SMS with candidates, they lose brand control."

**Currently Addressed?**
- FR (System Operations): Multi-tenancy, data isolation
- Problem: White-labeling and custom branding not mentioned

**Blue Team Defense:**
- ❌ White-labeling NOT in Tier 1 scope
- ✅ Acceptable as Phase 2 feature: "Defer white-labeling to Phase 2; MVP uses CBLAero branding"
- **Recommendation:** Document as Phase 2 GA requirement; MVP uses shared branding

**Gap Status:** 🟡 ACCEPTABLE – Deferred to Phase 2

---

#### **Attack 8: Communication History Not Exportable**
**Red Team Challenge:** "Compliance officer Sarah needs to export 'Did we contact Candidate X? When? Did they opt-in to SMS?' for audit purposes. You mention audit logging but don't say it's customer-exportable or GDPR-compliant. If Sarah can't pull that report in 2 minutes, she'll fail an audit."

**Currently Addressed?**
- FR (System Operations): Audit logging (5-year retention)
- Problem: Audit logs not customer-exportable; communication history not structured for compliance export

**Blue Team Defense:**
- ⚠️ Partially addressed: Audit logging exists but not customer-facing
- **Recommendation:** Add FR: "FR-SO-XX: Communication audit export (per-candidate, proof of outreach + consent, GDPR-compliant format)"

**Gap Status:** 🟡 PARTIAL – Exists internally, not exported

---

### **RED TEAM SYNTHESIS**

**High-Risk FR Gaps (Red Team Attacks Not Defeated):**

| Attack | Gap | Risk Level | Blue Team Defense |
|---|---|---|---|
| Dedup confidence thresholds undefined | Duplicate outreach risk | ⚠️ MEDIUM | Add threshold FR; test before launch |
| Bulk operations missing | Recruiter productivity gap = pilot failure | 🔴 CRITICAL | Add to Tier 1 |
| No channel preferences | TCPA violations, legal liability | 🔴 CRITICAL | Add to Tier 1 |
| API resilience vague | Queue/timeout not defined | ⚠️ MEDIUM | Add implementation detail |
| Offer workflow missing | Placement metric gap | 🔴 CRITICAL | Add to Tier 1 or Tier 2 |
| Communication history not exportable | Compliance audit failure | 🔴 CRITICAL | Add export FR to Tier 1 |
| **Acceptable Deferrals:** ATS integration, White-labeling | — | ✅ OK | Document as Phase 2 GA requirements |

---

## METHODOLOGY 3: COMPLETENESS MAPPING

### Goal
Map each element from previous PRD sections to FR coverage, identify gaps.

---

### **Executive Summary Mapping**

| Executive Summary Statement | Supporting FRs | Coverage | Gap |
|---|---|---|---|
| "Automatically reaches out to all matching candidates" | FR: Outreach automation, SMS/email templates | ✅ Complete | — |
| "Assigns opportunity score" | FR: Match & Scoring, confidence scoring | ✅ Complete | — |
| "Delivers at least 5 qualified candidates in 24hrs" | FR: Sourcing (manual/scraper), scoring, metrics SLA | ✅ Complete | — |
| "95% confidence matching" | FR: Self-testing, ML feedback loop | ⚠️ Partial | Month 1-2 manual, Month 3+ ML—validation strategy not detailed |
| "One recruiter handle 3 client accounts" | FR: Multi-client workflow, recruiter load balancing | ✅ Complete | — |
| "Speed into revenue opportunities" | FR: Fast outreach, candidate portal, Team notifications | ✅ Complete | — |

**Gap Found:** Self-testing confidence validation strategy not defined (thresholds, data windows, retraining cadence missing)

---

### **User Journeys Mapping**

#### **Candidate Journey: Sarah**
| Journey Step | Required FRs | Addressed? | Gap |
|---|---|---|---|
| "Signs up for CBLAero via referral" | Candidate portal signup | ✅ Yes | — |
| "System asks for availability preferences" | Availability preference capture | ✅ Yes | — |
| "Gets SMS confirmation" | SMS outreach, opt-in validation | ✅ Yes | — |
| "Receives personalized SMS about job" | Match + SMS delivery | ✅ Yes | — |
| "Responds with preferred call time" | SMS response parsing, time preference | ✅ Yes | — |
| "Recruiter calls at exact time" | Notification to recruiter, timing logic | ✅ Yes | — |
| "Proactively updates availability" | Candidate self-service portal | ✅ Yes | — |

**Gap Found:** None explicit; coverage complete

---

#### **Recruiter Journey: Mike**
| Journey Step | Required FRs | Addressed? | Gap |
|---|---|---|---|
| "Posts job requirement" | Job posting FR | ✅ Yes | — |
| "Gets Teams notification with 5 candidates in 24hrs" | Teams integration, notification, 24hr SLA | ✅ Yes | — |
| "Reviews list, calls top 3" | Recruiter workflow, call scheduling | ✅ Yes | — |
| "Schedules interviews" | Interview scheduling, calendar integration | ⚠️ Partial | Not explicit; assumes external calendar |
| "Submits placement" | Placement tracking, outcome logging | ✅ Yes | — |
| "Manages 3 clients comfortably" | Multi-client workspace, workload balancing | ⚠️ Partial | UI support for multi-client unclear |

**Gap Found:** Interview scheduling integration unclear; multi-client workspace UX not specified

---

#### **Delivery Head Journey: Elena**
| Journey Step | Required FRs | Addressed? | Gap |
|---|---|---|---|
| "Logs into dashboard, sees real-time metrics" | Metrics dashboard, real-time update | ✅ Yes | — |
| "Sees recruiter performance, conversion rates" | Recruiter metrics, conversion funnel | ✅ Yes | — |
| "Notices recruiter struggling, assigns support" | Peer comparison, performance alerts | ❌ No | Need peer comparison FR |
| "Reviews forecast for 60 days out" | Pipeline forecasting | ✅ Yes | — |
| "Presents data to executives" | Report generation, export | ⚠️ Partial | No mention of exec report format |

**Gap Found:** Peer comparison metrics missing; executive report format not specified

---

### **Success Criteria Mapping**

| Success Criterion | Supporting FRs | Coverage | Gap |
|---|---|---|---|
| "5 qual candidates (0.70+ conf) per req in 24hrs" | Sourcing, scoring, SLA, metrics | ✅ Complete | — |
| "80% contacted candidates get interview requests" | Match quality, outreach success tracking | ✅ Complete | — |
| "80% interview attendance rate" | Interview scheduling, confirmation tracking | ⚠️ Partial | No confirmation reminders mentioned |
| "Staged conversion 8-12% (M1-2) → 40% (M6+)" | Placement tracking, funnel metrics | ✅ Complete | — |
| "<30 min/day recruiter non-recruitment time | Dashboard speed, bulk operations | ⚠️ Partial | Bulk ops missing; dashboard latency target 2 sec but not SLA'd |
| "85% SMS response rate" | SMS delivery, outreach timing, messaging quality | ✅ Complete | — |
| "≥70% candidate satisfaction (NPS)" | Candidate experience, portal UX | ⚠️ Partial | No NPS tracking FR mentioned |
| "<5% opt-out rate" | Messaging quality, preference management | ⚠️ Partial | No opt-out tracking or analysis FR |
| "Break-even month 4, 20 customers" | Cost tracking, metering | ⚠️ Partial | Cost tracking vague; forecasting missing |

**Gaps Found:**
1. Interview attendance confirmation tracking missing
2. Bulk operations missing (affects recruiter time goal)
3. NPS/satisfaction tracking not mentioned
4. Opt-out rate tracking/analysis not mentioned
5. Cost forecasting missing

---

### **Domain Requirements Mapping**

| Domain Requirement | Supporting FRs | Coverage | Gap |
|---|---|---|---|
| "FAA Cert & Type Rating validation" | FR: Domain compliance, cert matching | ✅ Complete | — |
| "Airport badging (criminal background)" | FR: Background check integration | ✅ Complete | — |
| "Pre-employment drug tests" | FR: Drug test tracking, letter generation | ✅ Complete | — |
| "Background verification (criminal, employment, education)" | FR: Third-party vendor integration | ✅ Complete | — |
| "Specialized testing (pulmonary, respirator fit)" | FR: Specialized test tracking | ✅ Complete | — |
| "GDPR/CCPA/TCPA compliance" | FR: Consent tracking, geo-detection | ✅ Complete | — |
| "Personal tools requirement validation" | FR: Tooling ownership validation | ✅ Complete | — |
| "FAA-compliant maintenance documentation" | FR: Integration with aircraft OEM systems | ⚠️ Partial | Not explicit; "documentation systems" mentioned but not linked to FRs |
| "Real-time availability" | FR: Availability tracker, continuous engagement | ✅ Complete | — |
| "Multi-channel communication (email, phone, Teams)" | FR: SMS, email, Teams notification | ✅ Complete | — |
| "Fast hiring cycles (same-day to 3-day decisions)" | FR: Rapid candidate delivery, Teams notification, Teams integration | ✅ Complete | — |

**Gap Found:** OEM system documentation integration not explicitly in FRs; consider Phase 2 feature

---

### **Technical Requirements Mapping**

| Technical Requirement | Supporting FRs | Coverage | Gap |
|---|---|---|---|
| "Multi-tenancy strict isolation" | FR: Tenant provisioning, RBAC, UUID-based access | ✅ Complete | — |
| "Audit logging 5-year retention" | FR: Audit trail, data retention | ✅ Complete | — |
| "Anomaly detection (GPS, access patterns)" | FR: System operations, anomaly detection | ✅ Complete | — |
| "API resilience (circuit breaker pattern)" | FR: Graceful degradation, retry logic | ⚠️ Partial | Details (timeout, queue persistence) missing |
| "Encryption at rest & in transit" | FR: Data security, pgcrypt, HTTPS | ✅ Complete | — |
| "SMS/email delivery <1 min" | FR: Notification SLA | ✅ Complete | — |
| "Dataset refresh every 4 hrs" | FR: Continuous engagement, data refresh cadence | ✅ Complete | — |
| "99.5% uptime (excludes maintenance)" | FR: System operations, SLA | ✅ Complete | — |
| "Scale to 5M records + 10k recruiters" | FR: Scalability, performance targets | ✅ Complete | — |

**Gap Found:** None; technical coverage complete with partial detail on API resilience

---

### **COMPLETENESS MAPPING SYNTHESIS**

**Critical Gaps Identified:**

| Gap | Severity | Impact |
|---|---|---|
| Bulk operations (update, campaign, import) | 🔴 CRITICAL | Recruiter productivity goal (<30 min/day) unachievable without bulk ops |
| Interview attendance confirmation tracking | ⚠️ MEDIUM | 80% attendance SLA not measurable without confirmation reminders |
| NPS/satisfaction tracking | ⚠️ MEDIUM | 70% NPS goal not trackable without tracking FR |
| Opt-out rate analysis | ⚠️ MEDIUM | <5% opt-out goal not monitorable without analysis dashboard |
| Cost forecasting & overspend prevention | ⚠️ MEDIUM | Unit economics validation delayed without forecasting |
| Peer comparison metrics | ⚠️ MEDIUM | Delivery head journey incomplete (can't identify underperforming recruiters) |
| API resilience details (timeout, queue) | ⚠️ MEDIUM | Graceful degradation not fully specified |

---

## METHODOLOGY 4: FIRST PRINCIPLES ANALYSIS

### Goal
Start from core mission: "How do we deliver 5 qualified candidates in 24 hours with 95% confidence?"

---

### **CORE MISSION DECOMPOSITION**

**Mission:** Deliver 5+ qualified candidates (70%+ confidence) per job within 24 hours

**What must be true for this to work?**

1. **Candidate Data (sourcing)**
   - We have access to aviation talent database
   - Manual + automated sourcing combined
   - FRs: Candidate management, sourcing (FR1-6), data enrichment
   - **Essential:** Yes ✅

2. **Candidate Quality (scoring)**
   - Matching algorithms identify candidates who fit role
   - Confidence scoring reflects real likelihood of placement
   - FRs: Match & Scoring (FR23-30), self-testing validation
   - **Essential:** Yes ✅

3. **Outreach Capability (engagement)**
   - Candidates can be reached (SMS, email)
   - Outreach is fast (deliver 5 in 24 hrs = batch process, not sequential)
   - FRs: Outreach & Engagement (FR7-14)
   - **Essential:** Yes ✅

4. **Recruiter Workflow (action)**
   - Recruiter can quickly review candidates and take action
   - Action logging for audit/forecasting
   - FRs: Recruiter Workflow (FR15-22)
   - **Essential:** Yes ✅

5. **Domain Compliance (validation)**
   - Candidates meet aviation-specific requirements (FAA cert, badging, tooling)
   - Pre-screening filters unsuitable candidates early
   - FRs: Domain Compliance (FR47-51)
   - **Essential:** Yes ✅

6. **Metrics & Validation (proof)**
   - System measures what works (candidate delivery SLA, response rate, conversion)
   - Can adjust sourcing strategy based on data
   - FRs: Metrics & Reporting (FR41-46), Logging (FR55)
   - **Essential:** Yes ✅

---

### **ESSENTIAL vs NICE-TO-HAVE ANALYSIS**

**Essential to MVP (Deliver Mission):**
- Candidate Mgmt (FR1-6): Core data ✅
- Outreach & Engagement (FR7-14): Delivery mechanism ✅
- Match & Scoring (FR23-30): Quality control ✅
- Recruiter Workflow (FR15-22): Action + logging ✅
- Domain Compliance (FR47-51): Regulatory gate ✅
- Metrics (FR41-43): Minimal tracking (did we deliver 5? response rate? conversion?) ✅
- Logging (FR55): Audit trail ✅
- **Estimated FRs:** ~40 FRs

**Nice-to-Have for MVP (Enhance but not required):**
- Team Collaboration / Notifications (FR31-35): Could use email digest instead of Teams ⚠️
- User Auth & Access (FR36-40): Basic role-based OK; advanced features defer ⚠️
- Candidate Portal (FR59-62): Could live without login; manual SMS interaction sufficient ⚠️
- Advanced Metrics (FR44-46): Forecasting, peer comparison defer to Phase 2 ⚠️
- System Ops (FR52-58): Full monitoring/scaling can start basic ⚠️
- **Estimated FRs:** ~15-20 FRs

**Current Allocation:** 62 FRs total

**Implication:** ~25% of FRs are Phase 2+ features, front-loaded into MVP scope.

---

### **CAN WE DELIVER MISSION WITH MINIMUM FRs?**

**Hypothetical Minimum FRs (30-35 total):**
- Manual sourcing (5 candidates/day per customer from researcher) → Core FR only
- Outreach orchestration (SMS/email send to 5 candidates) → No fancy scheduling, just send
- Basic scoring (rule-based: has A&P? + location? + availability?) → No ML
- Recruiter workflow (list view, click call, log outcome) → No bulk, no advanced filtering
- Domain compliance (intake questions, auto-reject if no A&P) → No external integrations
- Basic metrics (dashboard: did we deliver? response rate? conversions?) → No forecasting
- Email/text notifications (no Teams integration) → Simple email digest
- Audit logging (append-only, 1-year retention) → No cryptographic signing

**Can we deliver 5 candidates in 24 hrs with this?** YES ✅
- Manual sourcing: 5 per day (researcher gives us 5-10 candidates each morning)
- Outreach: Batch SMS/email to all 5 (2 min to send)
- Scoring: Rule-based (recruit only A&P + location match = 70% confidence)
- Recruiter workflow: 30 min to review, log calls, update status
- Metrics: Dashboard shows "5 delivered, 3 SMS opened, 2 interview requests"
- Result: **Deliver mission for ~$50K engineering in 10-12 weeks with 2 engineers**

**Can we deliver with current 62 FRs?** YES, but over-engineered
- Current path: 14 weeks, 4 engineers, $70K engineering, 40+ FRs for essential mission + 20+ FRs for nice-to-have

**Recommendation:** Trim MVP to ~40 essential FRs, defer 15-20 to Phase 2

---

### **WHAT BREAKS IF WE CUT FRs?**

| FR Category | If we cut | Impact |
|---|---|---|
| Recruiter Workflow → Bulk operations | Still works, but recruiter spends 2+ hrs on manual updates | ⚠️ Affects productivity goal |
| Teams integration | Switch to email digest; still works | ✅ OK for MVP; nicer UX with Teams |
| Candidate Portal | Candidate must respond via SMS only; no web login | ✅ OK; SMS is primary channel |
| ML confidence scoring | Use rule-based scoring (has certs + location) | ✅ OK for MVP; validate before investing in ML |
| Forecasting/peer comparison | No early warnings on underperformance | ⚠️ Affects delivery head visibility but not mission |
| Advanced ops (health checks, scaling alerts) | Manual ops until Month 3; RTO longer | ⚠️ Affects reliability; need to plan for growth |

---

### **FIRST PRINCIPLES SYNTHESIS**

**Core Insight:** We can deliver the mission with ~40 essential FRs in 10-12 weeks. Current 62 FRs are realistic scope for a full platform but over-spec for MVP.

**Recommendation:**
- **MVP (Tier 1, 4 weeks):** 30-35 FRs (manual sourcing, rule-based scoring, basic outreach, email notifications, minimal ops)
- **Tier 2 (5-10 weeks):** +10-15 FRs (automation, Teams integration, candidate portal, peer metrics, advanced ops)
- **Tier 3 (11-14 weeks):** +5-10 FRs (ML confidence, forecasting, white-labeling, cost transparency)

**Go/No-Go Gate (Week 4):**
- ✅ Go to Tier 2 if: Manual sourcing achieves 5-8% conversion, <5% response time to candidate inquiry
- 🛑 No-go if: Manual sourcing <2% conversion, >15% candidate opt-out rate

---

## METHODOLOGY 5: DEVIL'S ADVOCATE CRITICAL CHALLENGE

### Goal
What's NOT working in the FR list? Challenge every assumption.

---

### **CHALLENGE 1: Missing Customer-Facing Data Exports**

**Devil's Advocate Critique:** "You have metrics dashboard and audit logs, but not for customers. Staffing firm leader needs to export placement data weekly for their own reporting. 'This quarter, we placed 45 candidates; $36K revenue; average time-to-fill 6 days.' You mention FR20 'export candidate list' but that's just a CSV dump. You don't have FR for 'placement report' or 'quarterly business review dashboard.'"

**Current Coverage:**
- FR: Export candidate list (admin/recruiter)
- FR: Metrics dashboard (internal)
- **Gap:** No customer-facing business report export

**Impact:** 🔴 CRITICAL
- Customers can't verify CBLAero ROI without manual spreadsheet calculation
- Steering committee asks delivery head "what's our Q1 placement breakdown?" → No easy answer
- Risk of churn: "We can't justify the cost without better reporting"

**Mitigation (Phase 1 or Tier 2):**
- Add FR: "Generate/export quarterly placement report (placements, revenue, time-to-fill, cost-per-hire)"
- Add FR: "Customer business review dashboard (KPIs, trends, benchmarks)"

**Gap Status:** 🔴 CRITICAL

---

### **CHALLENGE 2: Missing Integrations Marketplace**

**Devil's Advocate Critique:** "You have Teams + Clay + Telnyx integrations hardcoded. But staffing firms use different tools: Some want Slack, some Zapier webhooks, some custom Salesforce CRM sync. You don't mention an integrations marketplace or partner API. Without that, you'll never scale beyond 10 customers because each one needs custom integration."

**Current Coverage:**
- FR: Teams integration, Clay enrichment, Telnyx SMS
- **Gap:** No extensible integration framework; no partner API

**Impact:** 🟡 MEDIUM
- Phase 2 blocker: Can't scale to 50+ customers without custom integrations
- Not critical for MVP (1-2 pilots) but needed by Month 4 for Phase 2

**Mitigation (Phase 2):**
- Add FR: "Partner API (webhooks for custom integrations)"
- Add FR: "Integration marketplace (Slack, Zapier, Salesforce, custom webhooks)"

**Gap Status:** 🟡 MEDIUM – Phase 2 blocker

---

### **CHALLENGE 3: Missing Approval Workflows**

**Devil's Advocate Critique:** "You assume recruiter can just 'call candidate Monday.' But enterprise staffing firms have manager approval workflows: 'Recruiter proposes candidate → Manager approves → Then call.' Or compliance pre-approval: 'Candidate must pass pre-screening quiz before outreach.' You don't mention conditional workflows or approval states."

**Current Coverage:**
- FR: Pre-screening agent (auto-accept/reject based on domain criteria)
- **Gap:** No approval/conditional workflow customization; no manager sign-off

**Impact:** 🟡 MEDIUM
- Enterprise customers (Comlux) may require approval steps before outreach
- Not critical for MVP (small pilots) but needed for enterprise scale

**Mitigation (Tier 2+):**
- Add FR: "Customizable approval workflows (manager sign-off, compliance review, conditional routing)"

**Gap Status:** 🟡 MEDIUM – Enterprise feature

---

### **CHALLENGE 4: Missing Offer Management & Tracking**

**Devil's Advocate Critique:** "You track 'candidate contacted → interviewed → placed' but not the offer. Who creates offers? Where are they stored? If candidate rejects, do you track why? If they counter, who manages that? You say 'placement' but a placement needs an offer. Without offer management, you can't measure offer acceptance rate, average time-to-offer, or counteroffers. These are critical metrics."

**Current Coverage:**
- FR: Placement tracking (binary: placed or not)
- **Gap:** No offer creation, status tracking, document management

**Impact:** 🔴 CRITICAL
- Placement metric is incomplete without offer tracking
- Candidates don't "place" until offer is accepted; you can't track that now
- CFO can't calculate true conversion: offers sent → offers accepted = X%

**Mitigation (Tier 1 or Tier 2):**
- Add FR: "Offer management (create, track status: pending/accepted/rejected/countered, document storage)"
- Add FR: "Offer metrics (offer sent, acceptance rate, counter-offer tracking)"

**Gap Status:** 🔴 CRITICAL – Metrics gap

---

### **CHALLENGE 5: Missing Communication History Audit**

**Devil's Advocate Critique:** "Compliance officer Sarah needs to pull 'Candidate X received 3 SMS on 3/1, 3/5, 3/8. First two marked 'no response'; third marked 'interested'. We can prove we contacted them with consent.' Current audit logging is admin-only. You don't have a customer-facing export that proves communication history + consent. That fails compliance audit."

**Current Coverage:**
- FR: Audit logging (internal, admin-only)
- FR: Consent tracking (global per-candidate)
- **Gap:** No audit export; no per-message audit trail; consent not linked to communication

**Impact:** 🔴 CRITICAL
- GDPR audit failure: Can't prove consent for each communication
- Compliance officer manual workaround: Hours per audit
- Regulatory risk: TCPA, GDPR violations if contact audit absent

**Mitigation (Tier 1):**
- Add FR: "Communication audit export (per-candidate: date, channel, message, consent status, response)"
- Add FR: "Link consent to communication (prove consent was obtained before outreach)"

**Gap Status:** 🔴 CRITICAL

---

### **CHALLENGE 6: Missing Recruiter Performance Reviews**

**Devil's Advocate Critique:** "You have individual recruiter metrics (conversions, time-to-fill) but no peer comparison or performance trend. Delivery head Elena can see Mike has 5% conversion, but she can't see: 'Mike is 20% below team average' or 'Mike's conversion has dropped 10% month-over-month.' You need trend analysis and peer benchmarking to manage performance."

**Current Coverage:**
- FR: Individual recruiter metrics
- **Gap:** No peer comparison, no month-over-month trend analysis, no performance alerts

**Impact:** 🟡 MEDIUM
- Delivery head can't diagnose performance gaps early
- Phase 2 requirement for scaling to multiple recruiters/managers

**Mitigation (Tier 2):**
- Add FR: "Peer comparison metrics (vs. team average, vs. top performer)"
- Add FR: "Performance trend analysis (month-over-month, quarter-over-quarter)"
- Add FR: "Performance alerts (if trend <target threshold, alert delivery head)"

**Gap Status:** 🟡 MEDIUM – Tier 2

---

### **CHALLENGE 7: Missing KPI Alerts for Performance Thresholds**

**Devil's Advocate Critique:** "You have cost triggers ('alert if SMS >$200/placement') but no performance alerts. What if conversion rate drops from 8% to 3%? Delivery head doesn't notice until month-end report. You should alert her immediately: 'This week's conversion: 3% vs. target 8%. Investigate.' Same for response rate, interview attendance, etc."

**Current Coverage:**
- FR: Cost triggers (via system monitoring)
- **Gap:** No performance KPI alerts; no threshold-based alerting on metrics

**Impact:** 🟡 MEDIUM
- Delivery head can't intervene quickly on performance issues
- Risk of unnoticed decline in conversion/quality

**Mitigation (Tier 2):**
- Add FR: "KPI alerts (conversion, response rate, interview attendance below thresholds; alert delivery head + metrics dashboard)"

**Gap Status:** 🟡 MEDIUM – Tier 2

---

### **CHALLENGE 8: Missing Candidate Communication Preferences Per Channel**

**Devil's Advocate Critique:** "You mention TCPA compliance but not per-channel preferences. Candidate opts in to SMS but not email. System sends them email anyway = TCPA violation. You need explicit per-channel opt-in/opt-out before sending on ANY channel. That's not in the FRs explicitly."

**Current Coverage:**
- FR: GDPR/CCPA/TCPA consent tracking (global)
- **Gap:** Not per-channel; consent is global or inferred

**Impact:** 🔴 CRITICAL
- TCPA fines: $500-1,000 per SMS violation × 1,000s of outreach = millions in liability
- Regulatory risk

**Mitigation (Tier 1):**
- Add FR: "Channel-specific consent (SMS, email, phone—explicit separate opt-in per channel)"
- Add FR: "Validate channel consent before sending (check per-channel opt-in before SMS/email dispatch)"

**Gap Status:** 🔴 CRITICAL

---

### **CHALLENGE 9: Missing Data Retention & Deletion Lifecycle**

**Devil's Advocate Critique:** "You say 'audit retention 5 years' but don't define candidate data lifecycle. Can customers request 'delete candidate X'? GDPR gives them the right. Do you hard-delete, anonymize, or archive? What's the process? And when does old data auto-expire? You should have a policy like 'delete candidate record 24 months after last contact' to limit data hoarding."

**Current Coverage:**
- FR: 5-year audit log retention
- **Gap:** No candidate data retention policy; no GDPR deletion workflow; no auto-expiry

**Impact:** 🔴 CRITICAL
- GDPR non-compliance: Right-to-be-forgotten not documented
- Data hoarding liability
- SOC 2 audit gap

**Mitigation (Tier 1):**
- Add FR: "Data retention policy (define candidate data lifecycle, e.g., delete 24mo after last contact)"
- Add FR: "GDPR deletion workflow (customer requests deletion → hard-delete candidate + communications + audit logs)"
- Add FR: "Audit log immutability (delete only per retention policy, no manual deletion)"

**Gap Status:** 🔴 CRITICAL

---

### **DEVIL'S ADVOCATE SYNTHESIS**

**Critical Gaps (Fix Before MVP Launch):**

| Gap | Severity | Phase |
|---|---|---|
| Offer management & tracking | 🔴 CRITICAL | Tier 1 or Tier 2 |
| Per-channel communication preferences | 🔴 CRITICAL | Tier 1 |
| Communication audit history export | 🔴 CRITICAL | Tier 1 |
| Data retention & deletion policies | 🔴 CRITICAL | Tier 1 |
| Customer-facing business reports | 🔴 CRITICAL | Tier 2 |
| **Medium-Priority Gaps (Phase 2+):** | — | — |
| Peer performance comparison | 🟡 MEDIUM | Tier 2 |
| KPI performance alerts | 🟡 MEDIUM | Tier 2 |
| Approval workflows | 🟡 MEDIUM | Tier 2 |
| Integrations marketplace | 🟡 MEDIUM | Phase 2 |
| Recruiter trend analysis | 🟡 MEDIUM | Tier 2 |

---

## METHODOLOGY 6: REEVALUATE SCOPE FOR 14-WEEK MVP

### Goal
Map FRs to realistic 14-week phased delivery; clarify MVP vs Phase 2.

---

### **TIER 1: PROOF OF CONCEPT (Weeks 1-4)**

**Goal:** Validate that availability-first + domain compliance model improves conversion vs. traditional recruiting.

**Must-Have FRs for Tier 1 (Core Mission Only):**

| FR Category | Tier 1 FRs | Count |
|---|---|---|
| **Candidate Management** | Store candidates, basic search, enrichment validation | 4-5 |
| **Outreach & Engagement** | SMS/email templates, scheduling, basic personalization | 5-6 |
| **Recruiter Workflow** | View candidate list, log interactions, track outcomes, bulk operations | 5-6 |
| **Match & Scoring** | Rule-based scoring (has certs + location + availability) | 3-4 |
| **Domain Compliance** | Intake questions, auto-reject rules (no A&P = reject), tooling validation | 5 |
| **Metrics & Reporting** | Dashboard: delivery count, SMS open rate, interview request rate, conversion % | 3-4 |
| **User Auth & Access** | Basic Azure AD, recruiter + admin roles, RBAC | 2 |
| **System Operations** | Graceful degradation (if API fails, batch mode), error logging | 2-3 |
| **Team Collaboration** | Email digest of top 5 candidates (no Teams integration yet) | 1 |
| **Candidate Portal** | Simple status view (no signup, access via link) | 1 |
| **Logging & Audit** | Append-only audit log (1 year retention) | 1 |
| **Critical Additions** | Bulk operations, comm audit export, channel preferences, com audit trail | 4-5 |
| **TIER 1 TOTAL** | — | **~36-42 FRs** |

**Tier 1 Not Included:**
- ❌ Teams rich notifications (use email digest)
- ❌ ML confidence scoring (use rules)
- ❌ Forecasting (manual review only)
- ❌ Peer comparison (single recruiter pilot)
- ❌ Candidate portal login (link-based access)
- ❌ White-labeling (CBLAero branding)

---

### **TIER 2: MVP INTERNALS — ADD AUTOMATION (Weeks 5-10)**

**Goal:** Prove automation reduces manual effort; introduce Teams + ML + advanced metrics.

**Additional FRs for Tier 2:**

| FR Category | Tier 2 FRs | Count |
|---|---|---|
| **Outreach & Engagement** | Lightweight scraper (30-50 cand/day), A/B testing, campaign scheduling | 3-4 |
| **Match & Scoring** | Self-testing (validate accuracy monthly), ML confidence scoring (0.70-0.85) | 2-3 |
| **Team Collaboration** | Teams rich notifications, Teams event channel, Teams action buttons | 3-4 |
| **Metrics & Reporting** | Peer comparison, trend analysis (MoM), KPI alerts, forecast dashboard | 4-5 |
| **Domain Compliance** | Pre-screening agent logic (if-then rules), FAA integration skeleton | 2 |
| **Candidate Portal** | Login portal, full status transparency, preference management | 3-4 |
| **System Operations** | Health check automation, database scaling alerts, backup testing | 3-4 |
| **Offer Management** | Offer creation, status tracking, document management | 3-4 |
| **Logging & Audit** | 5-year retention, cryptographic signing, communication audit export | 2-3 |
| **TIER 2 TOTAL** | — | **~26-33 FRs** |

**Tier 2 Not Included:**
- ❌ Advanced ML (98% confidence)
- ❌ Anomaly detection
- ❌ Full continuous scraping (scaled to 500k candidates)
- ❌ Compliance automation (drug test letters)
- ❌ White-labeling

**Tier 1 + Tier 2 Total: 62-75 FRs** (Note: User base FR count = 62, so we're aligned)

---

### **TIER 3: PILOT READY — REAL-WORLD VALIDATION (Weeks 11-14)**

**Goal:** Prove unit economics; deploy to 1-2 live pilots; create scaling playbook.

**Refinement FRs for Tier 3:**

| FR Category | Tier 3 FRs | Count |
|---|---|---|
| **Match & Scoring** | Continuous model retraining, monthly accuracy validation | 1-2 |
| **System Operations** | Tenant provisioning UI, admin dashboard, operational runbook | 3-4 |
| **Metrics & Reporting** | Customer-facing business review dashboard, quarterly reports | 2-3 |
| **Domain Compliance** | Seasonal hiring intelligence, weather-based recruitment adjustments | 1-2 |
| **TIER 3 TOTAL** | — | **~7-11 FRs** |

**Tier 1 + Tier 2 + Tier 3 Total: ~70-85 FRs** (scope creep observed)

---

### **PHASE 2 & BEYOND (Deferred)**

| Feature | Phase | Rationale |
|---|---|---|
| Advanced ML (98% confidence) | Phase 2 | Requires 3+ months of production data |
| Full continuous scraping (100+ cand/day) | Phase 2 | Engineering-heavy; Tier 2 lightweight scraper sufficient |
| Anomaly detection (GPS, access patterns) | Phase 2 | Not critical for MVP; false-positive tuning takes weeks |
| White-labeling | Phase 2 | MVP uses CBLAero branding; adds complexity |
| Compliance automation (drug test letters) | Phase 2 | Requires vendor integrations; manual process OK for MVP |
| Integrations marketplace (Slack, Zapier) | Phase 2 | Extensibility not required for pilot; hardcoded Teams OK |
| OEM system integrations (aircraft MRO) | Phase 2 | Not critical for MVP; Comlux can use spreadsheet export |
| Universal platform (non-aviation) | Phase 3 | Aviation domain proven first; expand later |

---

### **REVISED MVP SCOPING RECOMMENDATION**

**Instead of "62 FRs across 10 areas," recommend:**

**Phase 1 MVP (14 weeks):**
- **Tier 1 (Weeks 1-4):** 36-42 FRs (proof of concept)
- **Tier 2 (Weeks 5-10):** +26-33 FRs (automation + Teams + ML + metrics)
- **Tier 3 (Weeks 11-14):** +7-11 FRs (pilot optimization)
- **Total Phase 1:** 69-86 FRs (aligned with 62+ critical gap additions)

**Phase 2+ (Months 4+):** Advanced ML, webhooks, white-label, compliance automation, universal platform

---

### **GO/NO-GO GATES**

**End of Tier 1 (Week 4):**
- ✅ Continue to Tier 2 if: Manual sourcing + rule-based scoring achieves 5-8% conversion; <5% opt-out; SMS response rate >50%
- 🛑 No-go if: <2% conversion; >15% opt-out; <30% SM response; domain compliance scoring inaccurate

**End of Tier 2 (Week 10):**
- ✅ Continue to Tier 3 if: Scraper reliable (>95% success); user feedback positive on Teams integration; ML confidence scoring validated
- 🛑 No-go if: Scraper <80% success; engineering debt too high; team morale at risk

**End of Tier 3 (Week 14):**
- ✅ Proceed to Phase 2 if: 1-2 pilots at 5-8% conversion; cost-per-hire <$900; team comfortable with operations
- 🛑 No-go if: Pilots <2% conversion; cost-per-hire >$1,200; operations unsustainable; customer feedback negative

---

## SYNTHESIS & REFINED RECOMMENDATIONS

---

### **TOP 5 CRITICAL GAPS TO ADD TO MVP**

| Gap | Priority | Phase | Effort | Impact |
|---|---|---|---|---|
| **1. Bulk Operations** (update candidates, launch campaigns, bulk import) | 🔴 CRITICAL | Tier 1 | Med | Recruiter productivity goal achievable |
| **2. Per-Channel Communication Preferences** (SMS vs email opt-in per channel) | 🔴 CRITICAL | Tier 1 | Med | TCPA/GDPR compliance |
| **3. Offer Management & Tracking** (create, status, document mgmt) | 🔴 CRITICAL | Tier 2 | High | Placement metric completeness |
| **4. Communication Audit History Export** (per-candidate log + consent proof) | 🔴 CRITICAL | Tier 1 | Med | Compliance audit readiness |
| **5. Data Retention & Deletion Policy** (lifecycle, GDPR deletion, immutable audit) | 🔴 CRITICAL | Tier 1 | High | SOC 2 + GDPR compliance |

---

### **TIER 1 VS MVP CLARIFICATION**

**Tier 1 (Weeks 1-4) = "Can we validate the hypothesis?"**
- Manual sourcing + rule-based scoring + email notifications
- Goal: Prove 5-8% conversion is achievable; prove availability-first works
- Not "MVP" in traditional sense; more "proof-of-concept"
- ~36-40 FRs

**Tier 2 (Weeks 5-10) = "Can we automate it?"**
- Add Teams, ML scoring, lightweight scraper, advanced metrics
- Prove automation reduces recruiter load to <30 min/day
- Goal: Ready for 1-2 paying customers
- +26-33 FRs

**Tier 3 (Weeks 11-14) = "Can we operationalize it?"**
- Deploy to live pilots, collect data, refine operations
- Goal: 1-2 customers with positive ROI
- +7-11 FRs

**"MVP" post-Phase 1 = Tier 1 + Tier 2 + Tier 3 combined (all 62+ FRs)**

---

### **CRITICAL CLARIFICATIONS NEEDED**

| Question | Context | Answer Options |
|---|---|---|
| **Teams vs Email for Tier 1?** | If Teams notifications deferred, how do recruiters get daily candidate list? | A) Email digest; B) Dashboard login required; C) Slack webhook |
| **Bulk Operations Priority?** | Is bulk update/campaign launch critical for Tier 1 or acceptable as Tier 2? | A) Tier 1 (required for productivity); B) Tier 2 (nice-to-have) |
| **Offer Workflow Scope?** | Is offer creation in-scope for MVP or external? | A) In CBLAero (Tier 2); B) External via email (recruit uses own template) |
| **ATS Integration Timeline?** | When do customers expect Workday/Greenhouse sync? | A) Tier 2; B) Phase 2; C) Not in scope year 1 |
| **AI/ML Confidence?** | When can we claim "95% confidence"? | A) Tier 1 via rules (rules = "95%"); B) After Tier 2 ML validation; C) Never claim pre-Phase 2 |
| **Data Residency?** | "USA-only" applies to Clay/Telnyx vendors too? | A) Yes, proxy vendors; B) US data centers only, ignore vendors; C) Define later |

---

### **FINAL VALIDATION CHECKLIST**

Before Tier 1 Launch:

- [ ] **FRs finalized & prioritized** (36-40 for Tier 1, +26-33 for Tier 2, +7-11 for Tier 3)
- [ ] **Go/no-go gates documented** (specific, measurable success criteria per tier)
- [ ] **Critical gaps resolved** (bulk ops, channel prefs, audit, data policy, offer workflow designed)
- [ ] **Pilot customer identified** (ideally Comlux; confirm readiness to participate)
- [ ] **Team capacity confirmed** (4 engineers, 1 PM, 1 domain researcher; estimated at $70K)
- [ ] **Infrastructure ready** (Supabase, AWS, CI/CD pipeline, local dev environment)
- [ ] **Legal/compliance reviewed** (GDPR, TCPA, data residency, audit scope SOC 2)
- [ ] **Stakeholder alignment** (all personas understand what's in/out of Tiers 1-3)

---

## CONCLUSION

CBLAero's FR set is **comprehensive but front-loaded** with Phase 2+ features. By applying six advanced elicitation methods, we identified **9 critical gaps** and **15+ phase-scoping misalignments** that create execution risk:

**Critical Findings:**
1. ✅ **Strengths:** Domain compliance, core sourcing/outreach, success criteria measurable
2. 🔴 **Gaps:** Bulk operations, channel preferences, communication audit, data retention, offer workflow
3. 🟡 **Misalignments:** 15-20 FRs are Phase 2+ features but scoped for MVP

**Recommendation:**
- **Refocus MVP on 40-45 essential FRs** (Tier 1-2 combined)
- **Add 4-5 critical gap FRs** (bulk ops, channel prefs, audit export, data policy, offer workflow)
- **Defer 10-15 nice-to-have FRs** to Phase 2 (Teams advanced, forecasting, peer comparison, white-label)
- **Establish clear go/no-go gates** at end of Tier 1 (week 4), Tier 2 (week 10), Tier 3 (week 14)

**Bottom Line:** With these changes, CBLAero can deliver a focused, defensible MVP in 14 weeks that proves the availability-first hypothesis and the unit economics without over-engineering. Defer the platform vision (universal, white-label, advanced analytics) to Phase 2 once the core thesis is validated.

---

## APPENDIX: FR CROSS-REFERENCE

**10 Capability Areas & Estimated FR Counts (Original):**
1. Candidate Management: 6 FRs
2. Outreach & Engagement: 8 FRs
3. Recruiter Workflow: 8 FRs
4. Match & Scoring: 8 FRs
5. Team Collaboration & Notifications: 5 FRs
6. User Authentication & Access Control: 5 FRs
7. Metrics & Reporting: 6 FRs
8. Domain Compliance & Regulatory: 5 FRs
9. System Operations & Infrastructure: 7 FRs
10. Candidate Portal: 4 FRs
**TOTAL: 62 FRs**

**Recommended Contribution by Tier:**
- **Tier 1:** 30-35 FRs (core mission only)
- **Tier 2:** +20-25 FRs (automation + analytics)
- **Tier 3:** +5-10 FRs (refinement + ops)
- **Phase 2+:** +5-10 FRs (advanced, nice-to-have)

---

**END OF ELICITATION ANALYSIS**

*Report prepared using six advanced elicitation methods: Stakeholder Round Table, Red Team vs Blue Team, Completeness Mapping, First Principles Analysis, Devil's Advocate Challenge, MVP Scope Reevaluation.*
