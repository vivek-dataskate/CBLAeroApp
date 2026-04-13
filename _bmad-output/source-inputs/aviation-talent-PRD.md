# Product Requirements Document (PRD)

## 1. Executive Summary
CBLAero is an AI-driven talent sourcing platform tailored for the aviation industry. It automates candidate discovery, enrichment, engagement, and recruiter handoff while complying with regulatory and privacy requirements. The system leverages a multi-agent architecture and real-time database to minimize sourcing time and improve recruiter productivity. Our competitive edge lies in aviation-specific features and a cost-effective subscription model.

✔️ **Vision:** Deliver the fastest, most accurate aviation candidate matching service that integrates seamlessly into recruiters' workflows.

✨ **Differentiators:**
- Aviation domain expertise (FAA certifications, type ratings, background checks)
- SMS & email automation built in from the ground up
- Real-time availability tracker and multi-channel candidate engagement
- Compliance modules for GDPR, CCPA, TCPA
- Lower price point than generic ATS vendors

## 2. Personas
1. **Candidate** – Aviation professionals searching for roles; receive personalized outreach and respond via SMS/email.
2. **Recruiter** – Sources candidates, reviews matches, initiates campaigns, and passes qualified leads to delivery.
3. **Delivery Head** – Monitors pipeline health, agent performance, and recruiter workload.
4. **Owner/Executive** – Tracks metrics, compliance, ROI, and business value.

## 3. Core Requirements
### 3.1 Data & Matching
- Store candidates, jobs, engagements, metrics, and client intelligence in Supabase.
- Deduplication engine: phone > email > fuzzy name/location, with ML-assisted scoring.
- Confidence scoring: 0.50–0.85 thresholds for manual review and recruiter alerts.
- Availability Tracker agent running continuous checks (calendar, LinkedIn, manual updates).

### 3.2 Enrichment & Ingestion
- APIs: Clay/Apollo enrichment with rate limiting (20/day per recruiter standard, configurable).  
- HTTP service: `POST /api/enrichment/validate-and-enrich` (`candidate`, `source`), `GET /api/enrichment/history`.
- Ingest resumes via email/Textract, CSV uploads, SharePoint scraping.
- Sanitize and normalize fields (names, phones, emails).

### 3.3 Campaigns & Outreach
- Seamless campaign definitions: `type` (cold, match, nurture, custom), `trigger` (new-match, follow-up, manual).
- Campaign agent generates and sends via Instantly (email) and Telnyx (SMS) after de-dup check.
- Round-robin A/B testing with three variants per campaign.
- Compliance window 8 am–9 pm recipient timezone; opt-outs tracked.

### 3.4 Notifications & Teams Integration
- One Teams **events channel** for system alerts (errors, new-match, low-confidence).  
- One Teams **feedback channel** for recruiter notes and candidate responses.
- No bot commands; users rely on email links or simple Teams cards with hyperlinks.
- Tasks created for high-priority issues (API quota depleted, candidate escalations).

### 3.5 Compliance & Security
- GDPR/CCPA/TCPA consent tracking per candidate with geo-detection.
- Data residency option (EU vs US) with encryption at rest (Supabase PGCrypt).  
- Access control: recruiter vs admin roles; 2FA enforced.
- Audit logs of every action on candidate records.
- Disaster recovery: RTO 1 hr, RPO 15 min (Supabase point-in-time recovery + nightly dump).

### 3.6 Monitoring & Alerts
- System agent monitors API quotas, error rates, campaign success, database health.
- Alerts via Teams and email (severity: info, warning, critical).  
- Dashboard metrics: matches/day, engagements, send rate, deliverability, CPL/CPI.

### 3.7 Operational Runbook & Support
- Runbook scenarios for:
  - Failed enrichment requests
  - Email deliverability issues
  - SMS compliance violations
  - API quota exhaustion
  - Database growth exceeding budget
- 4‑week post-launch support plan with daily stand‑ups and bug triage.
- Training guides for recruiters and delivery heads.

### 3.8 Training & Success Criteria
- Week‑1 metrics: agent reliability ≥ 99%, dedup accuracy ≥ 95%, first-match lead time < 4 h.
- Training sessions: new user onboarding video, FAQ docs, Teams channel for questions.

## 4. Weekly Production Release Plan
1. **Week 1 – Foundation**
   - Supabase schema & core agents (Orchestrator, Ingestor, Evidence Analyzer).
   - Resume ingestion (Textract) and basic job/candidate import.
   - Simple search UI and match computation.

2. **Week 2 – Enrichment & Deduplication**
   - Clay/Apollo API integration with rate limiting.
   - Deduplication engine & confidence scoring.
   - Availability Tracker skeleton.

3. **Week 3 – Outreach Engines**
   - Campaign agent, Instantly/Telnyx integration.
   - A/B testing and timezone sending window.
   - Teams events/feedback channels.

4. **Week 4 – Compliance & Monitoring**
   - GDPR/CCPA/TCPA consent model and audit logs.
   - System agent monitoring & alert rules.
   - Dashboard basic metrics and quotas.

5. **Week 5 – Aviation Specials & Reporting**
   - FAA certification and type-rating matching.
   - Delivery head dashboard and recruiter workload view.
   - ROI metrics (CPL/CPI).

6. **Week 6+ – Refinement & Scale**
   - Messaging queue, retry logic.
   - Cost dashboards, forecasting.
   - Candidate mobile app / referral program (stretch goals).

## 5. Non‑Functional Requirements
- **Performance:** 100ms search latency for top 20 matches.
- **Scalability:** support 5 million candidate records and 10 k recruiters.
- **Availability:** 99.9% uptime SLA.
- **Maintainability:** YAML-based agent definitions and env var config.

## 6. Open Questions & Future Enhancements
- Vendor selection for FAA background checks and document validation.
- Integration with payroll or timesheet systems for placements.
- ChatGPT-powered resume summarization (phase 3).

---

This PRD will evolve as we validate assumptions and gather user feedback.  
Next: convert high‑level requirements into user stories and begin implementation during Week 1.
