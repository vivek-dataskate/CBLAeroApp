# CBLAero Implementation Readiness Tracker

Source of truth: `docs/planning_artifacts/architecture.md` -> `Stack-Mapped Implementation Readiness Checklist`

## Gate Summary

- Gate decision: `PENDING`
- Last updated: `2026-03-30`
- Release target: `TBD`
- Program owner: `TBD`

## Status Legend

- `NOT-STARTED`: Not yet initiated
- `IN-PROGRESS`: Active work underway
- `BLOCKED`: Cannot proceed due to dependency/risk
- `DONE`: Completed and evidence attached

## Execution Board

| ID | Workstream | Readiness Task | Owner | Target Date | Status | Evidence | Blocker |
|---|---|---|---|---|---|---|---|
| R-01 | Render Platform | Create separate Render services for web and Python workers | TBD | TBD | NOT-STARTED | TBD |  |
| R-02 | Render Platform | Configure separate staging and production environments | TBD | TBD | NOT-STARTED | TBD |  |
| R-03 | Render Platform | Load all secrets via Render environment secrets only | TBD | TBD | NOT-STARTED | TBD |  |
| R-04 | Render Platform | Validate rollback procedure for web and worker services | TBD | TBD | NOT-STARTED | TBD |  |
| R-05 | Render Platform | Publish service-boundary extraction thresholds and first-extract migration plan for processing orchestration | TBD | TBD | NOT-STARTED | TBD |  |
| R-06 | Render Platform | Validate queue partitioning and independent worker autoscaling under Tier 2 load profile | TBD | TBD | NOT-STARTED | TBD |  |
| D-01 | Supabase Data | Provision Supabase in approved US region | TBD | TBD | NOT-STARTED | TBD |  |
| D-02 | Supabase Data | Implement and test RLS for all tenant-owned tables | TBD | TBD | NOT-STARTED | TBD |  |
| D-03 | Supabase Data | Implement append-only audit + hash-chain verification | TBD | TBD | NOT-STARTED | TBD |  |
| D-04 | Supabase Data | Enforce TLS for all app and worker DB connections | TBD | TBD | NOT-STARTED | TBD |  |
| D-05 | Supabase Data | Apply 3-year retention policy for call recordings/transcripts | TBD | TBD | NOT-STARTED | TBD |  |
| D-06 | Supabase Data | Implement `schedule_definitions` and `schedule_runs` tables with tenant-safe claiming, run history, and policy-version linkage | TBD | TBD | NOT-STARTED | TBD |  |
| I-01 | Identity Access | Configure Microsoft Entra SSO for internal users | TBD | TBD | NOT-STARTED | TBD |  |
| I-02 | Identity Access | Implement SMS/email magic-link login for candidates | TBD | TBD | NOT-STARTED | TBD |  |
| I-03 | Identity Access | Enforce step-up auth for sensitive operations | TBD | TBD | NOT-STARTED | TBD |  |
| I-04 | Identity Access | Validate emergency access runbook with audit trace | TBD | TBD | NOT-STARTED | TBD |  |
| M-01 | Messaging | Complete Telnyx two-way SMS integration | TBD | TBD | NOT-STARTED | TBD |  |
| M-02 | Messaging | Complete Telnyx voice + recording + transcription integration | TBD | TBD | NOT-STARTED | TBD |  |
| M-03 | Messaging | Complete Instantly campaign email integration | TBD | TBD | NOT-STARTED | TBD |  |
| M-04 | Messaging | Complete Graph/Outlook ad hoc email integration | TBD | TBD | NOT-STARTED | TBD |  |
| M-05 | Messaging | Complete Teams cards + tasks + scheduling integration | TBD | TBD | NOT-STARTED | TBD |  |
| M-06 | Messaging | Validate retry policy and terminal failure handling | TBD | TBD | NOT-STARTED | TBD |  |
| M-07 | Messaging | Configure Twilio warm-standby SMS failover and validate provider kill-switch routing | TBD | TBD | NOT-STARTED | TBD |  |
| M-08 | Messaging | Validate degraded email mode and recruiter-visible outage messaging for campaign provider incidents | TBD | TBD | NOT-STARTED | TBD |  |
| E-01 | Enrichment Compliance | Implement connector contracts for Internal DB, Clay, RapidAPI | TBD | TBD | NOT-STARTED | TBD |  |
| E-02 | Enrichment Compliance | Verify provider-agnostic behavior across 2+ sources | TBD | TBD | NOT-STARTED | TBD |  |
| E-03 | Enrichment Compliance | Implement FAA public data + manual verification workflow | TBD | TBD | NOT-STARTED | TBD |  |
| E-04 | Enrichment Compliance | Publish SOP: background checks manual-only in MVP | TBD | TBD | NOT-STARTED | TBD |  |
| E-05 | Enrichment Compliance | Implement provider-scoped leaky-bucket throttling and 429 backoff for Clay, RapidAPI, and FAA enrichment calls | TBD | TBD | NOT-STARTED | TBD |  |
| S-01 | Security and MCP | Enforce HTTPS + HSTS on authenticated surfaces | TBD | TBD | NOT-STARTED | TBD |  |
| S-02 | Security and MCP | Enforce MCP policy allowlists by role/environment | TBD | TBD | NOT-STARTED | TBD |  |
| S-03 | Security and MCP | Add step-up auth + audit for high-risk MCP actions | TBD | TBD | NOT-STARTED | TBD |  |
| S-04 | Security and MCP | Enable secret scanning in CI and resolve findings | TBD | TBD | NOT-STARTED | TBD |  |
| O-01 | Observability | Configure Render and Supabase monitoring dashboards | TBD | TBD | NOT-STARTED | TBD |  |
| O-02 | Observability | Configure alert rules for uptime, queues, provider errors, auth anomalies | TBD | TBD | NOT-STARTED | TBD |  |
| O-03 | Observability | Configure cost alerts (`API $1000/mo`, `SMS $200/placement`) | TBD | TBD | NOT-STARTED | TBD |  |
| O-04 | Observability | Configure KPI alert (`conversion <5%`) | TBD | TBD | NOT-STARTED | TBD |  |
| O-05 | Observability | Validate outage runbook for queue fallback mode | TBD | TBD | NOT-STARTED | TBD |  |
| O-06 | Observability | Implement end-to-end `trace_id`/`span_id` instrumentation across web, queue, workers, providers, and audit events | TBD | TBD | NOT-STARTED | TBD |  |
| O-07 | Observability | Publish provider outage runbook covering kill switch, degraded mode, queue fallback, and failback approval | TBD | TBD | NOT-STARTED | TBD |  |
| O-08 | Observability | Publish versioned policy registry for scoring weights, reassignment thresholds, cooldowns, schedule policies, and provider failover rules | TBD | TBD | NOT-STARTED | TBD |  |
| O-09 | Observability | Monitor global scheduler lag, missed runs, paused schedules, and duplicate-dispatch claim failures | TBD | TBD | NOT-STARTED | TBD |  |
| T-01 | Testing Gate | Pass unit/integration/e2e suites in staging | TBD | TBD | NOT-STARTED | TBD |  |
| T-02 | Testing Gate | Pass tenant-isolation adversarial tests with zero leakage | TBD | TBD | NOT-STARTED | TBD |  |
| T-03 | Testing Gate | Pass external-provider outage drill and recovery validation | TBD | TBD | NOT-STARTED | TBD |  |
| T-04 | Testing Gate | Pass audit immutability + hash-chain verification tests | TBD | TBD | NOT-STARTED | TBD |  |
| T-05 | Testing Gate | Pass accessibility checks on critical workflows | TBD | TBD | NOT-STARTED | TBD |  |
| T-06 | Testing Gate | Pass synthetic Tier 2 automation load profile (100 recruiters, 1M records, outreach burst, provider callbacks) | TBD | TBD | NOT-STARTED | TBD |  |
| T-07 | Testing Gate | Pass synthetic Tier 3 pilot load profile (200 recruiters, 1-2M records, re-verification sweep, queue catch-up) | TBD | TBD | NOT-STARTED | TBD |  |
| T-08 | Testing Gate | Pass gold-dataset scoring regression gate before prompt/model promotion | TBD | TBD | NOT-STARTED | TBD |  |
| T-09 | Testing Gate | Pass scheduler correctness tests for due-run claiming, no double dispatch, pause/resume semantics, and versioned schedule changes | TBD | TBD | NOT-STARTED | TBD |  |

## Accepted MVP Risks (Track and Monitor)

| Risk ID | Accepted Risk | Owner | Monitoring Control | Review Cadence | Status |
|---|---|---|---|---|---|
| K-01 | SMS failover architecture exists, but warm-standby provider is not yet launch-validated until outage drill passes | TBD | Outage drill + provider health alerts + failover test evidence | Weekly | OPEN |
| K-02 | Background checks are manual in MVP | TBD | SOP adherence + audit sample review | Bi-weekly | OPEN |
| K-03 | In-app analytics only (no external BI) | TBD | Dashboard accuracy checks + metric reconciliation | Weekly | OPEN |

## Gate Decision Rule

- `PASS`: All critical items complete (`R-01..R-06`, `D-01..D-06`, `I-01..I-04`, `M-01..M-08`, `S-01..S-04`, `O-01..O-09`, `T-01..T-09`).
- `CONCERNS`: Non-critical items pending with owner and target date assigned.
- `FAIL`: Any critical security, tenant isolation, audit integrity, or core messaging item incomplete.
