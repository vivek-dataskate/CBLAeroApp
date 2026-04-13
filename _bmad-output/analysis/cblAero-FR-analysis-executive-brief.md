# CBLAero FR Analysis: Executive Summary & Action Items

**Date:** 2026-03-04  
**Status:** CRITICAL FINDINGS – Recommendation: Address before Phase 1 launch  
**Audience:** Product, Engineering, Leadership

---

## HEADLINE FINDINGS

| Finding | Severity | Impact |
|---|---|---|
| **9 Critical Gaps** identified across compliance, audit, operations | 🔴 HIGH | Affects MVP readiness (SOC 2, GDPR, recruiter productivity) |
| **Tier scoping misalignment** (15-20 FRs are Phase 2+ but in MVP scope) | 🔴 HIGH | Creates 14-week delivery risk |
| **62 FRs may be unrealistic** for 14-week Tier 1-3 delivery | 🟡 MEDIUM | Recommend focusing on 40-45 essentials first |
| **Strengths: Domain compliance comprehensive** | ✅ GOOD | Pre-screening logic, FAA/tooling/badging coverage solid |
| **Blue Team defense: All major attacks blunted** | ✅ GOOD | When gaps identified, mitigation path clear |

---

## TOP 5 CRITICAL GAPS (MUST FIX BEFORE LAUNCH)

### 1. 🔴 **Bulk Operations Missing**
- **Problem:** Recruiter can't batch-update 50 candidates at once; must click individually
- **Impact:** Recruiter productivity goal (<30 min/day non-recruitment work) UNACHIEVABLE
- **Fix:** Add FRs: Bulk update candidates, bulk campaign launch, CSV bulk import
- **Effort:** Medium (2-3 engineer-days)
- **Phase:** Tier 1 (week 3-4) or Tier 2 (week 5-6)

**Stakeholder Voice:** Mike (Recruiter) – "You've got the basics. But I can't bulk-update 50 candidates when their availability changes. I have to click 50 times."

---

### 2. 🔴 **Per-Channel Communication Preferences**
- **Problem:** No explicit SMS vs email opt-in tracking per channel; assumes global consent
- **Impact:** TCPA violations ($500-1,000 per SMS × 1,000s of outreach = millions liability)
- **Fix:** Add FR: Track SMS/email/phone opt-in separately; validate before sending any channel
- **Effort:** Low (1-2 engineer-days)
- **Phase:** Tier 1 (week 2-3)

**Compliance Risk:** CRITICAL – TCPA fines and regulatory enforcement

---

### 3. 🔴 **Communication Audit History Export**
- **Problem:** Audit logs exist (admin-only); no customer-facing export proving consent
- **Impact:** GDPR compliance audit FAILS ("Did you contact candidate X? Proof?")
- **Fix:** Add FR: Per-candidate communication history export (all outreach + consent proof)
- **Effort:** Low-Medium (2-3 engineer-days)
- **Phase:** Tier 1 (week 3-4)

**Compliance Risk:** CRITICAL – SOC 2 Type II audit gap

---

### 4. 🔴 **Data Retention & Deletion Policies**
- **Problem:** 5-year audit retention defined; candidate data lifecycle NOT defined
- **Impact:** GDPR right-to-be-forgotten not implemented; data hoarding liability
- **Fix:** Add FR: Candidate data lifecycle (e.g., delete after 24mo no contact), GDPR deletion workflow, immutable audit trail
- **Effort:** High (4-5 engineer-days due to data architecture implications)
- **Phase:** Tier 1 (week 2-3, requires design work first)

**Compliance Risk:** CRITICAL – GDPR non-compliance

---

### 5. 🔴 **Cost Tracking & Customer Visibility**
- **Problem:** Cost triggers exist; no real-time dashboard or customer-facing cost breakdown
- **Impact:** CFO can't track SMS/API spend; customers can't forecast costs; margin oversight lost
- **Fix:** Add FRs: Real-time cost dashboard (per tenant, per component), cost forecasting, unit economics transparency
- **Effort:** Medium (2-3 engineer-days for dashboard + backend metering)
- **Phase:** Tier 1 (week 4) or Tier 2 (week 6-7)

**Stakeholder Voice:** David (CFO) – "I see cost triggers, but I don't see how I can monitor cost in real-time. I need a dashboard showing 'SMS costs this month: $500, vs. budget: $700.'"

---

## SECONDARY CRITICAL GAPS (MEDIUM PRIORITY) – ADDRESS IN TIER 2

| Gap | Stakeholder | Fix | Phase |
|---|---|---|---|
| **Offer management** (create, track, sign, document) | CFO, Recruiter | Add offer creation + status tracking + metrics | Tier 2 |
| **Peer performance comparison** (vs. team avg) | Delivery Head | Add peer comparison dashboard + trend analysis | Tier 2 |
| **KPI alerts** (conversion falls below target) | Delivery Head | Add threshold-based alerts on performance KPIs | Tier 2 |
| **Recruiter performance trends** (MoM, QoQ) | Delivery Head | Add month-over-month trend analysis for metrics | Tier 2 |
| **Customer business report export** (quarterly ROI) | CFO, Partners | Add customer-facing dashboard + report export | Tier 2 |
| **Tenant provisioning UI** (no manual DB scripts) | System Admin | Build provisioning UI + bulk role assignment | Tier 2 |
| **Automated health checks** (self-healing, graceful degradation) | System Admin | Implement circuit breaker + auto-retry + alerts | Tier 2 |

---

## PHASE SCOPING RECOMMENDATION

### Current State
- **62 FRs** across 10 capability areas
- **14-week delivery** target (Tiers 1-3)
- Mix of Phase 1 essentials + Phase 2+ features

### Recommended Realignment

**Tier 1: Proof of Concept (Weeks 1-4) — ~36-40 FRs**
- Core mission only: manual sourcing, rule-based scoring, email notifications
- Goal: Validate 5-8% conversion achievable; prove availability-first works
- Includes: 5 critical gaps above (bulk ops, channel prefs, audit export, data policy, cost tracking) to ensure Tier 1 compliance-ready

**Tier 2: MVP Internals (Weeks 5-10) — +26-33 FRs**
- Add automation: Teams, ML scoring, lightweight scraper, advanced metrics, offer workflow
- Goal: Ready for 1-2 paying customers

**Tier 3: Pilot Ready (Weeks 11-14) — +7-11 FRs**
- Deploy to live pilots, refine operations, collect data
- Goal: 1-2 customers with positive ROI data

**Total Phase 1: 69-84 FRs** (aligned with original 62 + critical gap additions)

**Phase 2+: Advanced features**
- Full ML (98% confidence) – requires 3+ mo data
- Full continuous scraping – Tier 2 lightweight scraper sufficient
- Anomaly detection – false-positive tuning takes weeks
- White-labeling – complexity; MVP uses CBLAero branding
- ATS integrations (Workday, Greenhouse, Lever) – valuable but Phase 2
- Integrations marketplace (Slack, Zapier webhooks) – Phase 2
- OEM system integrations – Phase 2

---

## GO/NO-GO GATES

### End of Tier 1 (Week 4)
**Continue to Tier 2 IF:**
- ✅ Manual sourcing + rule-based scoring achieves 5-8% conversion (realistic for Month 1-2)
- ✅ SMS response rate >50%
- ✅ Candidate opt-out rate <5%
- ✅ Domain compliance scoring accuracy >90%

**HALT Tier 2 IF:**
- 🛑 Conversion <2%
- 🛑 Response rate <30%
- 🛑 Opt-out rate >15%
- 🛑 Domain pre-screening inaccurate (>20% false positives)

---

### End of Tier 2 (Week 10)
**Continue to Tier 3 IF:**
- ✅ Scraper reliability >95%
- ✅ Teams integration works (desktop + web + mobile)
- ✅ ML confidence scoring validated against historical outcomes
- ✅ Team velocity on track

**HALT Tier 3 IF:**
- 🛑 Scraper reliability <80%
- 🛑 ML confidence model shows <70% accuracy
- 🛑 Engineering debt excessive (team estimate >5 days of rework needed)

---

### End of Tier 3 (Week 14)
**Proceed to Phase 2 IF:**
- ✅ 1-2 pilots achieve 5-8% conversion (validates hypothesis)
- ✅ Cost-per-hire <$900 (validates unit economics)
- ✅ Recruiter feedback positive ("This saves me 10+ hrs/week")
- ✅ Operations team comfortable supporting >3 customers

**PIVOT IF:**
- 🛑 Pilots <2% conversion (hypothesis invalidated; pivot to event-based sourcing)
- 🛑 Cost-per-hire >$1,200 (margins eroded; reduce scope)
- 🛑 Operations unsustainable (hiring/outsourcing needed before scaling)

---

## MISSING FRs: DETAILED REGISTRY

### CRITICAL (Add Tier 1)

| FR ID | FR Name | Category | Rationale | Effort | Owner |
|---|---|---|---|---|---|
| **CMG-001** | Bulk candidate update (status, tags, notes) | Candidate Mgmt | Recruiter productivity (<30 min/day) unachievable without this | M | Backend |
| **OE-001** | Channel preference management (SMS, email, phone per-candidate) | Outreach | TCPA compliance; explicit per-channel opt-in | L | Backend |
| **RW-001** | Bulk campaign launch (to candidate segment) | Recruiter Workflow | Enables fast outreach at scale | M | Backend |
| **RW-002** | CSV bulk import (candidates, jobs, outcomes) | Recruiter Workflow | Reduces data entry friction | M | Backend |
| **SO-001** | Communication audit history export (per-candidate, GDPR format) | System Ops | SOC 2 + GDPR audit readiness | M | Backend |
| **SO-002** | Candidate data retention & deletion policy (lifecycle, GDPR workflow) | System Ops | GDPR right-to-be-forgotten, data hoarding prevention | H | Arch + Backend |
| **SO-003** | Real-time cost tracking dashboard (per tenant, per component) | System Ops | CFO visibility, customer cost transparency | M | Backend |
| **SO-004** | Audit trail immutability & cryptographic signing | System Ops | SOC 2 Type II, tamper-proofing | H | Crypto Eng |
| **COM-001** | Automated pre-screening logic (if-then rules, tooling auto-reject) | Domain Compliance | Efficiency for Comlux-like customers | M | Backend |

### IMPORTANT (Add Tier 2)

| FR ID | FR Name | Category | Rationale | Effort | Owner |
|---|---|---|---|---|---|
| **RW-003** | Offer management (create, track status, document store) | Recruiter Workflow | Placement metric completeness; offer acceptance tracking | H | Backend |
| **M&R-001** | Peer performance comparison (vs. team avg) | Metrics | Delivery head can diagnose underperformance | M | Backend |
| **M&R-002** | Performance trend analysis (MoM, QoQ recruiter metrics) | Metrics | Early intervention on declining performance | M | Backend |
| **M&R-003** | KPI alerts (conversion, response rate, interview attendance thresholds) | Metrics | Proactive issue detection | M | Backend |
| **M&R-004** | Customer-facing business review dashboard (KPIs, placements, revenue) | Metrics | Customer ROI visibility; reduces churn | M | Frontend |
| **SO-005** | Tenant provisioning UI (no manual DB scripts) | System Ops | Operational scaling; reduces toil | M | Backend |
| **SO-006** | Automated health checks & self-healing (circuit breaker, graceful degrade) | System Ops | 99.5% uptime target achievable | H | Backend |
| **SO-007** | Database scaling alerts (approaching storage/performance limits) | System Ops | Proactive capacity management | L | Backend |

---

## CLARITY REQUIRED FROM PRODUCT TEAM

**Before finalizing Tier 1 scope, resolve:**

1. **Notifications Strategy:**
   - Q: If Teams integration deferred to Tier 2, how do recruiters get daily candidate list in Tier 1?
   - A Options: (A) Email digest; (B) Dashboard login required; (C) Slack webhook
   - **Recommendation:** Email digest (simple, complies with existing email infrastructure)

2. **Bulk Operations Priority:**
   - Q: Is bulk update/campaign launch critical for Tier 1 MVP or acceptable as Tier 2 nice-to-have?
   - A Options: (A) Tier 1 (recruiting Mike's #1 pain point); (B) Tier 2; (C) Defer entire capability
   - **Recommendation:** Tier 1 – recruiter productivity goal unachievable without it

3. **Offer Workflow Scope:**
   - Q: Is offer creation in-scope for MVP or should recruiters use external templates?
   - A Options: (A) In CBLAero (Tier 2); (B) External via email (recruiter uses own template); (C) Minimum viable (plain text offer, no signature)
   - **Recommendation:** Tier 2 for full workflow; Tier 1 out-of-scope (use email templates)

4. **ATS Integration Timeline:**
   - Q: When do customers expect Workday/Greenhouse/Lever sync?
   - A Options: (A) Tier 2; (B) Phase 2; (C) Not in scope year 1; (D) Handle manually via CSV export
   - **Recommendation:** Phase 2 (requires vendor partnership; manual CSV export for MVP)

5. **Confidence Scoring Claims:**
   - Q: When can we claim "95% confidence" in matching?
   - A Options: (A) Tier 1 via rules ("rules definition = 95%"); (B) After Tier 2 ML validation against real data; (C) Never claim pre-Phase 2
   - **Recommendation:** Tier 1 rules-based scoring = "70% confidence rule-based" + "95% confidence goal by Month 3" (data-driven)

6. **Data Residency Commitment:**
   - Q: Does "USA-only residency" apply to third-party vendors (Clay, Telnyx)?
   - A Options: (A) Yes, proxy all vendors through CBLAero API; (B) US data center commitment only; (C) Define per vendor
   - **Recommendation:** Document Clay/Telnyx vendor data centers explicitly; proxy if needed

---

## SUCCESS CRITERIA FOR MVP READINESS

**Before Tier 1 Launch:**

- [ ] All 9 critical gaps designed & FRs written (include in requirements doc)
- [ ] Product team confirms tier scoping (which FRs in Tier 1 vs Tier 2)
- [ ] Go/no-go success criteria finalized & shared with team
- [ ] Pilot customer identified and readiness confirmed (ideally Comlux)
- [ ] Team capacity locked (4 engineers, 1 PM, 1 domain researcher)
- [ ] Infrastructure provisioned (Supabase, AWS, CI/CD, auth, logging)
- [ ] Legal/compliance reviewed (GDPR, TCPA, SOC 2 scope, data residency)
- [ ] Stakeholder alignment meeting (all personas understand in/out scope)

---

## QUICK REFERENCE: STAKEHOLDER ROUND TABLE FINDINGS

| Persona | #1 Pain Point | #2 Gap | #3 Request |
|---|---|---|---|
| **Recruiter (Mike)** | No bulk operations | No comm audit trail | Per-channel preference mgmt |
| **Delivery Head (Elena)** | No peer comparison | No trend analysis | KPI alerts |
| **Domain Partner (Raj)** | Domain rules not automated | No FAA integration | Seasonal hiring intel |
| **CFO (David)** | No real-time cost tracking | No forecasting | Unit economics visibility |
| **Compliance (Sarah)** | Audit immutability missing | No deletion workflow | Comm history export |
| **System Admin (Alex)** | Provisioning manual toil | No auto health checks | Scaling alerts |
| **Candidate (Sarah)** | No mobile portal | No comm history | Channel preferences |

**All stakeholder gaps are addressed in critical gap list above.**

---

## NEXT STEPS

1. **Review (24 hours):** Product team reviews this analysis; identifies agreed/disagreed findings
2. **Clarify (48 hours):** Resolve 6 clarity questions above; document decisions
3. **Revise (24 hours):** Update MVT scope document with agreed Tier 1/2/3 FRs
4. **Socialize (48 hours):** Stakeholder alignment meeting (all personas); confirm go-ahead
5. **Execute (Week 1+):** Begin Tier 1 build with finalized AF scope

---

**Analysis prepared using 6 advanced elicitation methods.**  
**Full detailed findings available in: cblAero-advanced-elicitation-FR-analysis.md**
