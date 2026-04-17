---
stepsCompleted: [1, 2]
inputDocuments:
  - docs/planning_artifacts/source-inputs/aviation-product-brief.md
  - docs/planning_artifacts/prd.md
---

# UX Design Specification - CBLAero

**Author:** vivek
**Date:** 2026-03-04

---

## Executive Summary

### Project Vision

CBLAero transforms aviation recruiting from a reactive hunt-and-chase game into a proactive, candidate-driven delivery engine. The system inverts traditional recruiting: instead of recruiters spending 6 hours per day searching databases, candidates proactively signal availability, and CBLAero continuously engages them through automated scraping, enrichment, qualification, and delivery.

The core innovation is **availability-first sequencing** — but critically, _availability is validated by motivation intensity_: how fast Sarah responded, how many questions she asked, whether she volunteered a start date. This distinguishes genuinely ready candidates from passive browsers. CBLAero layers domain-specific aviation intelligence (FAA certs, type ratings, tooling, badging) on top of these signals. This psychological shift — from being hunted to being heard — creates trust with candidates and enables recruiters to manage 3 clients simultaneously instead of 1.

**Success looks like:** Mike opens CBLAero at 8am Monday, sees 5 overnight candidates — ranked by "likely to close today" not just confidence score — each with rich context cards (match reasons, qualification transcript, what questions to ask, auto-booked call slot). He eliminates 2 immediately from visible disqualification reasons, calls 3, converts 1 by noon. Sarah received an SMS Sunday night about a captain role matching her A320 type rating, clicked the anonymous portal link, saw why she was a match, opted in with contact preferences ("mornings until 11am, evenings no later than 9pm"), answered 1 qualifier question ("Do you have personal tools?"), and got confirmation "Mike will call you Monday at 10am."

### Target Users

**Primary User: Mike (Recruiter)**
Aviation recruiter currently spending 6 hours/day manually hunting candidates. Needs to deliver 5 qualified candidates per job within 24 hours while managing multiple client accounts. His biggest fear: the system misses "the perfect candidate" who doesn't fit the algorithm. He needs **rich context** before calls — not just names, but match reasons, qualification transcripts, motivation signals, and auto-scheduled call slots.

> **🚨 Critical Need (Focus Group):** Visibility into _why_ candidates were auto-rejected, with ability to override when client requirements are flexible. Without this, Mike stops trusting the system.

> **🎯 Behavior Insight (Reverse Engineering):** Mike's Monday success depends on: intelligent "call today" prioritization, pre-booked calendar slots based on candidate preferences, qualification transcripts so calls aren't cold, and a feedback loop that validates confidence scores over time.

> **⚠️ Assumption to Validate:** Does transparent confidence scoring change Mike's behavior, or does he mentally re-rank by gut anyway? Track calling decisions vs. confidence scores in Tier 1 pilot.

**Critical Trust Signal: Sarah (Candidate)**
Airbus pilot between contracts, drowning in recruiter spam. Contacted via cold SMS/email (scraped from LinkedIn). Opts in only after seeing job match details anonymously. Needs control over contact frequency and windows (mornings, afternoons, evenings no later than 9pm local time). Her trust is CBLAero's entire candidate acquisition model.

> **🚨 Critical Need (Focus Group):** Ability to pause availability without full opt-out. Opt-in must be job-specific, not global — TCPA compliance requires this and trust demands it.

> **🔒 Red Team Defense:** Sarah's see-before-share portal must have rate limiting, UUID-based URLs, phone/email validation, and one-time tokens in SMS links to prevent phishing, fake profiles, and competitor intelligence gathering.

> **🎯 First Principles Insight:** Sarah doesn't want better job matches — she wants protection from noise. Design her experience as a "do-not-disturb control panel": she sets strict filters (role, pay, type rating, contact window), system promises "we'll only contact you when it's a near-perfect match, max once per week."

**Supporting Personas (Phased — All from Day 1):**

| Persona                   | Core Need                                                        | Critical Risk                                             |
| ------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| **Elena (Delivery Head)** | Observability: alerts when Mike misses promised calls            | No escalation path = operational promises broken at scale |
| **David (Owner/CEO)**     | Qualification layer improves conversion, not just moves dropouts | Must model full funnel before assuming net-positive       |
| **Alex (System Admin)**   | Resilience: Teams outage fallback + retry logic                  | No fallback = single point of failure on Microsoft uptime |

### Key Design Challenges

**1. Dropout Prevention Architecture**
CBLAero inserts a qualification layer _between_ interest signal and recruiter call. When Sarah responds "I'm interested," the system probes readiness then schedules Mike's call.

> **⚠️ Critical Design Constraint:** Every qualification gate historically causes 20-40% dropout. Reduce to the single most critical question per role (not 5 questions). For Comlux roles: "Do you have personal tools?" For badge-required roles: "Any criminal background preventing airport access?" Allow "Not sure? The recruiter will discuss" as a valid response — never auto-reject on ambiguity. Show progress ("Question 1 of 1") and explain why.

**2. Trust-First Candidate Experience**
Sarah receives cold SMS/email → clicks anonymous portal link → sees job match details → opts in with contact preferences → answers 1 qualifier → receives confirmation.

> **🔒 Security Layer (Red Team):** Job-specific opt-in only (not global), UUID URLs, one-time tokens per SMS link with 7-day expiry, official SMS shortcode, rate limiting. Portal requires minimum profile info before browsing to prevent competitor intelligence scraping.

> **🎯 First Principles Redesign:** Show Sarah **recruiter reputation** before she opts in — "Mike has placed 47 candidates in 6 months. 4.8/5 candidate satisfaction." She can choose who calls her. Trust through transparency.

**3. Context-Rich Recruiter Dashboard**
Mike needs not just "5 candidates" but "3 to call today + 2 for later," ranked by _motivation intensity_ (response speed, questions asked, start date volunteered) with full qualification transcripts and auto-booked calendar slots.

> **🎯 SCAMPER — Eliminate:** Consider removing confidence scores entirely in favor of match reasons only ("A&P cert + 5yr MRO + local + tools owned") to reduce black-box mistrust. Validate this in Tier 1 pilot via A/B test.

> **📊 Failure Mode:** Morning briefing designed for 5 candidates breaks with 50 (Tier 2 scraper spike). Design progressive disclosure: top 5 rich cards + "Show 45 more" in compact scan view.

**4. Intelligence Document Automation**
Job roles pull pre-defined probe questions automatically. System must match role taxonomy to question libraries without manual setup.

> **⚠️ Assumption Risk:** Real pilot may reveal that intake questions are too custom per client to standardize. Must validate with Comlux data in Week 1 before building automation. Fallback: Mike selects from pre-built question bank rather than fully automated.

**5. Multi-Channel Resilience**
SMS → Email → Teams notification cards → Web portal across 5 personas.

> **🛡️ Failure Modes & Mitigations:**
>
> - Teams outage: fallback to email digest + SMS alert "Check dashboard"
> - SMS spam flagging: official shortcode, warm up sending reputation, A/B test messaging
> - Timezone mismatch: detect from IP + confirm with candidate
> - Enrichment API timeout: show "enriching..." not error; queue for overnight batch

**6. Operational Observability for Elena**
System makes promises to candidates (Mike calls at 2pm Monday). When Mike doesn't follow through, the system must escalate — not silently fail.

> **🎯 Reverse-Engineered Requirement:** Elena's dashboard shows "Mike's 2pm call with Sarah is in 10 minutes — [Send Reminder Now]." Teams card shows commitment: "You agreed to call Sarah at 2pm. [Mark Done] [Reschedule]." If Mike misses 2+ committed calls, Elena is alerted automatically.

### Design Opportunities

**1. "Morning Briefing" → "Action Stream"**
Not a database query — a prioritized action list. "Call Today (3)" + "Review Later (2)" ranked by motivation intensity. Rich cards with: match reasons, qualification transcript, what questions to ask, auto-booked call slot. Scales from 5 candidates (Tier 1 manual) to 50 candidates (Tier 2 scraper) via progressive disclosure. At 1M+ record scale, the action stream is driven by pre-computed index slices — not live full-table queries — so load time remains <2s regardless of database size.

**7. Data Import and Sync Console (Admin / Recruiter)**
The platform starts with 1M existing candidate records and grows via three ongoing ingestion paths:

- **Bulk CSV upload** (recruiters, daily/weekly): drag-and-drop interface, column mapping wizard, live validation preview (duplicate detection, missing required fields), per-row error report download, and a progress tracker showing records imported/skipped/errors. Columns not mapped to canonical fields are retained in candidate `extra_attributes` (`jsonb`) and surfaced in UX as "stored as additional attributes"; blocked sensitive keys are dropped. Max 10,000 records per recruiter upload; initial 1M-record migration is admin-supervised one-time flow with rollback capability.
- **PDF resume upload** (recruiters, on-demand): the recruiter upload page offers a mode selector ("Upload CSV" / "Upload Resumes"). Resume mode accepts a single `.pdf` file or multiple `.pdf` files via multi-file selector or folder selection. Only PDF format is accepted — the UI displays a clear note: "Only PDF files are supported. Please convert Word, RTF, or other formats to PDF before uploading." Each uploaded PDF is processed by LLM-powered extraction; a review step shows the extracted candidate data per file in an editable card layout where the recruiter can accept, edit, or reject each parsed candidate before committing. A progress tracker shows per-file extraction status (processing/complete/failed). Failed extractions (encrypted PDFs, image-only scans, corrupted files) display actionable error messages. No hard cap on file count per session; system batches internally (50 at a time).
- **ATS connector sync** (automated, Tier 2): read-only polling of connected ATS system; new and updated records are upserted via the standard deduplication pipeline. Admin console shows last-sync timestamp, records synced, and error rate. Sync failures alert the admin; never silently skip records.
- **Email inbox parsing** (automated, Tier 2): Microsoft Graph scans designated recruiter inboxes for forwarded resumes and candidate reply threads; extracted candidate stubs are queued for enrichment with source attribution ("from: recruiter email"). Recruiter reviews parsed batch before records are activated.

Design constraint: at 1M+ records, candidate search and list views must use cursor-based pagination and indexed pre-filters (by availability status, location, cert type) — never an unfiltered full-scan. The UI must not offer a "show all" control on unfiltered candidate tables.

**8. Schedule and Cadence Console (Admin)**
One global schedule console governs recurring business jobs. It is the configuration surface for business cadences, not a dump of every internal timer.

- **Business schedules shown:** ATS connector syncs, recruiter inbox scans, candidate refresh sweeps, daily recruiter digests, nightly FAA/compliance sweeps, and recurring operational guardrail checks.
- **Each schedule row shows:** human-readable job name, human-readable cadence (e.g. "Every 15 minutes", "Daily at 2:00 AM UTC"), enabled/paused state, next run, last run time, and latest run status. Raw cron expression is available as a tooltip for technical reference.
- **Schedule cadences are code-defined** — the schedule column is read-only in the UI. Admins can pause/resume jobs, override the next run time, or trigger immediate execution, but cannot change cron expressions from the dashboard (prevents code/DB drift).
- **Edit flow:** admin pauses/resumes a job or overrides next_run_at -> API validates tenant scope -> system updates the schedule definition. Cron expression changes are code-deployed only, creating a new versioned policy record on bootstrap sync.
- **Non-schedulable timing controls:** retry backoffs and outreach cooldown windows are shown as read-only policy hints or in contextual warnings; they are not editable as recurring schedules in this console.

**Admin Console Layout Pattern**
The admin console uses **collapsible card sections** (`CollapsibleCard` component) to organize its multiple modules (Scheduler Status, Sync Runs, AI Costs, User & Team Governance). Each section has a clickable header with a chevron toggle. Sections marked `defaultOpen` are expanded on page load; others are collapsed. This reduces visual clutter and lets admins focus on the section they need. See `docs/dashboard-ui-standards.md` for the component specification.

**2. "See-Before-Share" → "Do Not Disturb Control Panel"**
Sarah's portal is less job board, more preference enforcer. She sets exact criteria (role, pay, type rating, contact window). System promise: "We only contact you when it's near-perfect, max once per week." Transparency: shows her contact history, who has her data, how to revoke.

Candidate contact windows and outreach cooldowns are enforced policy/consent controls, not admin-authored recurring schedules. The UI should make that distinction explicit so operators do not confuse preference protection with scheduler configuration.

**3. Motivation-First Confidence Scoring**
Confidence = motivation intensity + domain match. Fast response + questions asked + volunteered start date = high confidence. Show signal breakdown so Mike builds trust with the system. Track Mike's calling behavior vs. scores to validate usefulness or retire scores entirely.

**4. Recruiter Reputation for Candidate Trust**
Sarah sees Mike's placement history and candidate satisfaction score before opting in. She chooses who calls her. Recruiters compete on reputation, not volume. Differentiator: no generic ATS offers this.

**5. Instant Connect Mode**
Sarah opts in → system immediately connects Mike via live call within 2 minutes. Removes all batch latency. For high-motivation signals (response in <5 min), offer instant mode vs. scheduled mode.

**6. Mutual Match Reveal**
Both Mike and Sarah confirm interest before contact info is shared. Mike sees: "Sarah is evaluating 2 other opportunities — here's why you're her best option." Sarah sees Mike's reputation. Match only happens on mutual confirmation.

### Dashboard Visual Design System

All dashboard pages (`/dashboard/**`) follow a unified design system documented in [`cblaero/docs/dashboard-ui-standards.md`](../../cblaero/docs/dashboard-ui-standards.md). Key design decisions:

- **White backgrounds** across all dashboard screens for a clean, professional appearance
- **Sticky headers** with breadcrumb navigation at 16px (`text-base`) for clear wayfinding
- **Consistent footer** ("CBL Aero · Enterprise Portal") on every page
- **Emerald accent** (`emerald-600`) as the primary interactive color; `gray-*` for all neutrals
- **Minimum 12px** (`text-xs`) font size — no text smaller than this for accessibility and readability
- **`max-w-6xl` container** — wide enough for data-dense tables, narrow enough for comfortable reading
- **`rounded-xl` cards**, `rounded-lg` buttons, `rounded-full` badges for consistent visual rhythm
- **No dark mode** — single light theme for this enterprise internal tool

This design system is enforced via development-standards.md §27 and validated during code reviews for any `src/app/dashboard/` changes.

### LinkedIn RPS Funnel Dashboards (North-Star KPI Surfaces)

These are **required screens**, not optional. They surface the PRD north-star KPI (beat the LinkedIn RPS recruiter funnel: 100 InMails → 28 responses → 14 submissions → 0.5 closures @ $200/mo) to the two personas that own the outcome: Mike (recruiter) and Elena (delivery head) / Alex (admin).

**Screen A: Recruiter Funnel Dashboard (`/dashboard/recruiter/funnel`)**

Primary user: Mike. Primary question: "Am I beating my old LinkedIn RPS numbers this month?"

Layout (top to bottom):

1. **Header strip** — "This month vs. LinkedIn RPS baseline" with a single-glance verdict: ✅ Beating baseline / ⚠️ Matching baseline / ❌ Below baseline. Show current month-to-date with days-elapsed context.
2. **Four-stage funnel viz** — horizontal funnel with four stages (Outreach → Responses → Submissions → Closures). Each stage shows:
   - Current count (MTD)
   - LinkedIn RPS baseline count (dimmed line behind the current bar)
   - Conversion rate from prior stage (e.g., "42% response rate" with baseline "28%" in small text below)
   - Delta vs. baseline rate in green (positive) or red (negative)
3. **Trend sparklines** — four small charts (one per stage), trailing 90 days, weekly granularity. Baseline shown as a horizontal dashed line.
4. **Cost-per-closure card** — CBLAeroApp effective cost-per-closure (fully loaded) vs. $200/0.5 = $400/closure LinkedIn baseline. Flag if above baseline.
5. **"What's moving my funnel" panel** — top 3 features/epics attributed to this month's lift (driven by `source_epic` attribution in funnel events). E.g., "Epic 3 multi-channel outreach: +12% response rate."
6. **Micro-actions** — "Send more outreach" / "Review pending responses" shortcuts, wired to next-best-action in the recruiter's action stream.

Empty state (new recruiter, <30 days of data): show baseline + a partial funnel with "Need 30 days of data for trend comparison." Do not show distorted conversion rates on <100 outreach events.

**Screen B: Admin Consolidated Funnel Dashboard (`/dashboard/admin/funnel`)**

Primary users: Elena (delivery head), Alex (admin), David (CEO). Primary question: "Is the team beating LinkedIn RPS on average, and who needs help?"

Layout (top to bottom):

1. **Tenant rollup header** — total closures MTD / projected monthly, total cost / recruiter, total lift vs. baseline (e.g., "3.2× baseline closures across 12 recruiters").
2. **Consolidated four-stage funnel** — same viz as recruiter screen but aggregated across all recruiters; click any stage to drill into per-recruiter breakdown.
3. **Recruiter leaderboard** — sortable table: recruiter name, MTD closures, response rate, submission rate, cost-per-closure, baseline-beat badge. Default sort: closures descending. Below-baseline recruiters flagged with a coaching icon.
4. **Cost rollup** — total platform cost per recruiter (CBLAeroApp platform + integrations + AI per recruiter) vs. $200/mo LinkedIn baseline. Goal: ≤$200 fully loaded.
5. **Baseline-breach alerts inbox** — list of recruiters whose trailing-30-day funnel fell below baseline for 7+ consecutive days (see Epic 10 Story 10.7). Each row has a "Schedule 1:1" CTA.
6. **Feature attribution rollup** — same "what's moving the funnel" panel but at the tenant level — which epics/features are driving the most lift across all recruiters.

**Screen C: Baseline Configuration (`/dashboard/admin/funnel/baseline`)**

Primary user: Alex (admin) or David (CEO). Used rarely (quarterly review). Shows current LinkedIn RPS baseline values (outreach=100, response=28%, submission=50%, closure=3.6%, cost=$200), their effective_from date, and an edit form that creates a new versioned baseline. Historical dashboard views automatically use the baseline that was effective at the time of the events being displayed.

**Design principles across all three screens:**

- Follow the dashboard visual design system above (white, sticky header, emerald accent, `max-w-6xl`, `rounded-xl` cards).
- Every baseline comparison must label the baseline explicitly ("vs. LinkedIn RPS 28%") so a new recruiter who never used RPS understands the comparison.
- Funnel visualizations must remain legible on mobile — reduce to stacked vertical bars below 768px.
- Every dashboard cell is drill-able: clicking a stage filters the recruiter's action stream to candidates at that stage.
- Never show a funnel rate computed from <30 events in the denominator — show "insufficient data" instead, to avoid misleading early-month percentages.

**Relationship to existing "Action Stream":**

The funnel dashboard is the measurement layer; the action stream (Design Opportunity #1 above) is the working layer. Clicking a funnel stage on the recruiter dashboard filters the action stream to that stage — they are not separate apps.

### Critical Assumptions Requiring Tier 1 Validation

| #   | Assumption                                   | Risk                                                       | Validation                                           |
| --- | -------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| 1   | Availability-first improves conversion       | Weak signal; low motivation candidates                     | A/B test vs. motivation-first scoring                |
| 2   | See-before-share increases opt-in            | Cold outreach still feels like spam without traffic driver | Track SMS → portal → opt-in funnel (target >15%/30%) |
| 3   | Qualification layer reduces _total_ dropouts | Moves dropout to earlier stage; no net gain                | Model full funnel; compare placement conversion      |
| 4   | Mike trusts + acts on confidence scores      | Ignores scores; uses gut; adds cognitive load              | Track calling decisions vs. score correlation        |
| 5   | Role taxonomy enables automation             | Intake questions too custom per client                     | Analyse Comlux job postings Week 1                   |
