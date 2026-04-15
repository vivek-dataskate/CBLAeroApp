# Sprint Change Proposal — 2026-04-15 (Revision 3)

> **Revision 3 (2026-04-15, evening same day):** Implementation complete — Clay webhook ingestion landed with 53 passing tests. Real Clay payload shape confirmed via webhook.site capture: nested LinkedIn blob lives under `enrichlinkedin_data` (not `Enrich person` as initially guessed) and sidecar email/phone columns are top-level lowercase `email` / `phone` (not `Personal Email` / `Mobile Phone`). The mapper is shape-tolerant (probes multiple nested-blob keys) and the env defaults match production. Test fixture includes the real Michaela Ealey payload as a regression guard. The webhook route delegates to the shared `batchUpsertCandidatesFromATS` helper rather than implementing a parallel upsert path — every Clay row flows through the same dedup, fingerprint, role-deduction, and upsert pipeline as ATS and CSV ingestion. Schema migration applied to production Supabase by Vivek. Docs, code, and tests all aligned with the real payload shape. Ready for Clay UI configuration and first test fire. See §5 for the Clay configuration handoff.

> **Revision 2 (2026-04-15, afternoon):** Integration pattern pivoted from **pull** to **push** after investigating Clay's capabilities. Clay's **HTTP API column** fires an outbound HTTP request per row as each row finishes enrichment — the natural integration surface is a webhook on CBLAero's side, not a cron-scheduled pull job against the (possibly nonexistent) Clay read API. All four artifacts (epics.md, sprint-status.yaml, architecture.md, this proposal) were updated in place. The story ID (2.8), scope classification (Moderate), and success criteria all remain valid; only the *how* changed. Key downstream effects: Story 2.7 scheduler is no longer a dependency, cursor management drops away, residency check moves from pre-network to startup-time, admin UI doesn't need a Clay-specific panel. The push pattern is simpler and more responsive (seconds vs hours). See §3 for the updated rationale and §4 for the revised change log.

---

# Sprint Change Proposal — 2026-04-15

**Project:** CBLAero
**Workflow:** bmad-correct-course
**Author:** Vivek (with Claude as navigator)
**Date:** 2026-04-15
**Scope classification:** Moderate (backlog reorganization — reopens a closed epic + architecture amendment)

---

## 1. Issue Summary

**Trigger:** Product owner identified a gap between an existing recruiter workflow and the CBLAero data model. Recruiters currently vet candidates on LinkedIn, push them into a Clay workspace table to enrich with personal email and phone, and then operate on that data entirely *outside* CBLAero. The enriched candidates never make it into the candidate database, which means they are:

- Invisible to CBLAero search (Story 2.4)
- Outside the dedup/fingerprint pipeline (Stories 1.11, 2.5)
- Not routed through role deduction (Story 2.5a)
- Not reachable by upcoming Epic 3 outreach, Epic 5 scoring, or Epic 7 reporting

**Evidence:** The Clay table at the recruiter's disposal already holds ~9,000 LinkedIn-enriched candidates with full structured payloads (first/last name, LinkedIn URL, title, headline, current company, country, location, experience array, certifications, languages, connections, follower counts, `last_refresh` timestamp) plus sidecar personal email and phone columns. None of this is in CBLAero.

**Discovery context:** Surfaced during a routine Correct Course review after Epic 2 was marked done (including the merged 2-7a scheduler admin dashboard). The owner asked whether new scope could be added, and the navigation identified this gap as a natural fifth ingestion path.

---

## 2. Impact Analysis

### Epic Impact

| Epic | Status before | Status after | Notes |
|---|---|---|---|
| **Epic 2 — Candidate Data Ingestion** | done | **reopened (in-progress)** | New Story 2.8 added. Epic 2 retrospective remains optional; defer until 2-8 lands. |
| Epic 1 | done | done | No change. |
| Epic 3 | backlog | backlog | Unaffected — outreach consumers operate on the `candidates` table regardless of ingestion source. The `source: clay_enrichment` attribution may become relevant for future segmentation. |
| Epics 4–9 | backlog | backlog | No change. Out-of-scope section in 2.8 explicitly defers recruiter-level assignment to Epic 4, preventing accidental scope leak. |

### Story Impact

| Story | Impact | Type |
|---|---|---|
| **2.8** (new) | Implement Clay Table Sync Ingestion | Addition |
| 2.7 (done) | Scheduler is load-bearing — 2.8 registers as a new job via `registerIngestionJobs(scheduler)` | No code change; reuse |
| 2.7a (done) | Admin dashboard will automatically show the new Clay job once registered | No code change; reuse |
| 2.4b (done) | `sync_runs` table receives Clay runs with `source=clay_enrichment` | No code change; reuse |
| 2.5 (done) | Dedup pipeline receives Clay rows through the standard upsert path | No code change; reuse |
| 2.5a (done) | Role deduction runs automatically on new Clay candidates | No code change; reuse |
| 1.11 (done) | Content fingerprint gate receives Clay rows with `clay_row_id + last_refresh` basis | No code change; reuse |
| 1.6 (done) | Residency policy gates the Clay HTTP call before any network I/O | No code change; reuse |

### Artifact Conflicts

| Artifact | Change needed |
|---|---|
| `_bmad-output/epics.md` | **Done** — Story 2.8 inserted between 2.7 and Epic 3 header. |
| `_bmad-output/sprint-status.yaml` | **Done** — Epic 2 → `in-progress`, 2-8 added as backlog. |
| `_bmad-output/architecture.md` | **Done** — Candidate Data Ingestion section updated (Four → Five paths), new Path 5 block added, inbound-vs-outbound Clay flow clarification added. |
| `_bmad-output/prd.md` | **No change.** FR28-30 and the "enrichment, SMS, email must be provider-agnostic" clause already permit Clay as a named provider. No new functional requirement is introduced — 2.8 delivers an existing capability area that was deferred from Epic 2 planning. |
| `_bmad-output/ux-design-specification.md` | **No change.** No new UI surface. Story 2.7a admin dashboard already covers view/pause/trigger for any registered job, including Clay. |

### Technical Impact

**Schema (single migration, reversible — unchanged by revision 2):**

```sql
alter table cblaero_app.candidates
  add column if not exists source_recruiter_actor_id text;

create index if not exists idx_candidates_source_recruiter
  on cblaero_app.candidates (tenant_id, source_recruiter_actor_id)
  where source_recruiter_actor_id is not null;
```

**New env vars (Render service + local dev) — revised for push pattern:**

- `CLAY_WEBHOOK_SECRET` (shared-secret bearer token that Clay's HTTP API column sends in the `Authorization` header)
- `CLAY_DEFAULT_ASSIGNEE_EMAIL` (e.g. `vivek@cblsolutions.com`)
- `CLAY_EMAIL_FIELD` (optional, default `email` — sidecar column name in Clay containing personal email)
- `CLAY_PHONE_FIELD` (optional, default `phone` — sidecar column name in Clay containing personal phone)

**Removed env vars (were in revision 1, no longer needed):**

- ~~`CLAY_API_KEY`~~ — not needed for push, Clay initiates the request
- ~~`CLAY_TABLE_URL`~~ — not needed, Clay knows which table it's pushing from

**New code — revised for push pattern:**

- `cblaero/src/app/api/webhooks/clay/route.ts` — webhook handler: bearer-token auth, batch-vs-single payload normalization, per-row mapping and upsert, sync_run tracking
- `cblaero/src/modules/ingestion/clay-mapper.ts` — pure `mapClayRowToCandidate(row, config)` function (no I/O, fully unit-testable)
- Extension of `mapToCandidateRow` in `cblaero/src/modules/ingestion/index.ts` to honor a new optional `sourceRecruiterActorId` field (backward compatible)
- Migration file: `supabase/migrations/2026-04-XX-story-2-8-clay-webhook.sql`

**Removed from revision 1 (no longer needed in push pattern):**

- ~~`cblaero/src/modules/ingestion/clay-sync.ts`~~ (no scheduled job — replaced by the webhook route + mapper module)
- ~~Registration in `registerIngestionJobs(scheduler)`~~ — Clay is not a scheduled job
- ~~Cursor storage pattern~~ — fingerprint idempotency replaces cursor-based incremental reads

**No new infra, no new tables, no new cross-cutting services, no scheduler dependency.** The single new column is still the entire schema delta.

---

## 3. Recommended Approach

**Decision: Direct Adjustment — add Story 2.8 to reopened Epic 2.**

### Rationale

1. **Ingestion story fits Epic 2's theme.** Epic 2 is explicitly the "ingest-to-profile pipeline" epic. Adding a fifth ingestion path belongs here thematically; forcing it into Epic 3 (outreach) or creating a micro-epic creates organizational drag for no benefit.

2. **All dependencies are already `done`.** Stories 1.6, 1.11, 2.4b, 2.5, 2.5a, 2.7, 2.7a are merged. 2.8 is implementable today with no blocking work.

3. **Minimal data model risk.** One nullable column. No new tables. No FK constraints. Fully reversible.

4. **Scope containment.** The recruiter-attribution question (which nearly expanded the story into an assignment model) was successfully deferred — all Clay candidates stamped to a single default user as provenance only. A real candidate assignment model remains available for Epic 4 design, and the `source_recruiter_actor_id` column provides a clean backfill path.

5. **No PRD churn.** FR28, FR48/49 ("provider-agnostic enrichment"), and the existing Clay references in `architecture.md` §Sourcing Worker already frame Clay as an in-scope provider. This is operationally completing the Epic 2 ingestion surface, not expanding product scope.

6. **Alternatives were considered and rejected:**
   - **Option B (park in Epic 3)** — wrong thematic fit; outreach is about sending, not receiving.
   - **Option C (new epic for post-ingestion enrichment)** — premature abstraction; one connector isn't an epic.
   - **Bringing Epic 4 assignment model forward** — major replan, violates YAGNI, blocks the actual Clay ingestion on unrelated design work.

### Effort Estimate

- **Spike (half day):** Validate Clay API supports incremental reads via `last_refresh` filter, or confirm full-table-pull-with-client-filter throughput.
- **Implementation (2–3 days):**
  - Clay API client + URL parser
  - Row mapper (typed columns + `extra_attributes.clay.*`)
  - Scheduler registration + cursor storage
  - Migration + backfill of first ~9,000 rows (runs itself as the first scheduled job)
  - Startup validation of `CLAY_DEFAULT_ASSIGNEE_EMAIL`
- **Testing (1 day):**
  - Fixture-based unit tests for the mapper (including the `"--"` headline fallback and the location parser)
  - Integration test that walks a fake Clay response through the pipeline end-to-end
  - Residency gate test
  - Startup failure test for a bad assignee email
- **Review + merge:** standard 2-pass adversarial code review per project convention
- **Total:** ~4–5 engineer-days

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Clay API lacks incremental read support | Medium | Low | First-run fallback: pull full table (~9k rows), filter client-side by `last_refresh`. Throughput is the only cost; no functional blocker. |
| `CLAY_DEFAULT_ASSIGNEE_EMAIL` refers to a user not yet provisioned in CBLAero | Medium | Low | Fail-fast at job startup with clear log; unblocked by provisioning Vivek via the Story 1.4 admin console. |
| Clay payload schema drifts mid-sync | Low | Medium | Row-level errors accumulate in `sync_run_errors` without blocking the batch; schema change is visible in the next 2.4b error detail review. |
| Large first-run hits Clay rate limits | Low | Low | `fetchWithRetry` handles 429 with exponential backoff. ~9k rows at 500 rpm is ~18 min — well within normal operational bounds. |
| `extra_attributes.clay.*` payload growth on the candidates row | Low | Low | Payload size is bounded (~2-3 KB per row); JSONB compresses well; the existing 2.2 `extra_attributes` guardrails already enforce per-row limits. |
| PII (personal email + phone) leaving approved region | Medium | High | **Residency gate evaluated before the first Clay HTTP call** — violation halts the run pre-network. Enforced by the Story 1.6 policy gate. |

### Timeline Impact

- **Epic 2 closure slips** by ~1 week (from "done as of 2026-04-15" to expected 2026-04-22 assuming standard review cadence).
- **Epic 3 kickoff unaffected** — 2.8 is parallelizable with Epic 3 Story 3.1 start.
- **Epic 2 retrospective** remains optional; recommend running it after 2.8 merges so it captures the corrected-course story alongside the original Epic 2 work.

---

## 4. Detailed Change Proposals

### 4.1 Epics (`_bmad-output/epics.md`)

**Status:** ✅ Applied this session.

Inserted Story 2.8 between the end of Story 2.7 (line 732) and the Epic 3 header (line 734). The new story follows the existing GWT acceptance-criteria format and includes: context, 7 given-when-then blocks, a Clay → candidates field mapping table, NFRs, out-of-scope, and implementation notes.

### 4.2 Sprint Status (`_bmad-output/sprint-status.yaml`)

**Status:** ✅ Applied this session.

- Line 72: `epic-2: done` → `epic-2: in-progress  # reopened 2026-04-15 to add story 2-8 (Clay Table Sync Ingestion)`
- After line 84: inserted `2-8-implement-clay-table-sync-ingestion: backlog  # added 2026-04-15 via bmad-correct-course — ~9k row initial pull, hourly cadence, default assignee vivek@cblsolutions.com`

### 4.3 Architecture (`_bmad-output/architecture.md`)

**Status:** ✅ Applied this session.

- Updated the Candidate Data Ingestion Architecture introduction from "Four ingestion paths" to "Five ingestion paths"
- Inserted Path 5 block after Path 3 (ATS + email sync), describing the Clay inbound flow end-to-end
- Added a new "Clay flow direction — inbound vs outbound" subsection clarifying that the existing outbound enrichment flow (documented in the Sourcing Worker / enrichment sequence diagrams) is a **separate future capability** tied to Epic 5 scoring, distinct from the inbound Path 5 delivered by Story 2.8

### 4.4 PRD (`_bmad-output/prd.md`)

**Status:** No change needed.

The existing PRD clauses supporting this work:

- **FR28** — provider-agnostic candidate enrichment
- **FR48/49** — dashboards track enrichment cost per provider (Clay already named)
- **"Candidate enrichment, SMS, and email capabilities must be provider-agnostic"** constraint in the Enrichment section

No new functional requirement is introduced. Story 2.8 delivers against existing clauses that were deferred from Epic 2's original story set.

### 4.5 UX Design (`_bmad-output/ux-design-specification.md`)

**Status:** No change needed.

No new user-facing screens. Admin interaction with the Clay sync happens through the existing Story 2.7a scheduler dashboard (view/pause/trigger/edit-cron), which is job-agnostic by design. The 2.4b sync-run summary card and error detail page already handle any ingestion source.

---

## 5. Implementation Handoff

**Scope classification:** Moderate.

**Routing:**
- **Primary recipient:** Developer agent (`bmad-dev-story` or `gds-dev-story` depending on which dev workflow the owner uses for this story)
- **Secondary:** Code Review (`bmad-code-review`) after implementation, following the project's standard 2-pass adversarial review pattern

**Prerequisites before dev work starts:**
1. Verify `vivek@cblsolutions.com` is provisioned in `cblaero_app.user` with an active `recruiter` or `admin` role. If not, create via Story 1.4 admin console first.
2. Obtain a Clay API key (service account preferred; document which Clay account owns the key).
3. Confirm the Clay table URL: `https://app.clay.com/workspaces/621935/workbooks/wb_0sy0elgA57hzDWMoXZh/tables/t_0syawnqtDR8UxdEBJWY/views/gv_0syawnqV87ZuY63ucVa`.
4. Add the three new env vars to Render service config (`sync: false`) and to the local `.env.example` template.

**Deliverables:**
- Spike report (half day) — Clay API incremental-read capability confirmation
- New module: `cblaero/src/modules/ingestion/clay-sync.ts`
- Job registration update: `cblaero/src/modules/ingestion/jobs.ts`
- Migration: `supabase/migrations/2026-04-XX-story-2-8-clay-sync.sql`
- Unit + integration tests
- Run the first sync in production and verify ~9,000 rows land correctly in `candidates`
- Sign-off via the existing code review workflow

**Success criteria:**
- All ~9,000 Clay rows successfully persisted on the first scheduled run
- New candidates visible in the recruiter search UI with `source: clay_enrichment` and `source_recruiter_actor_id` set to the cached Vivek user ID
- `sync_runs` row shows the first Clay run with accurate pulled/new/merged/errored counts
- Subsequent hourly runs pull only changed rows (cursor advances correctly)
- No residency policy violations logged
- Adversarial code review passes on the first or second pass

---

## 6. Open Items for the Implementer

These are things the story deliberately did not pin down, either because they're spike outputs or they depend on live Clay API behavior:

1. **Clay API incremental-read support.** If Clay supports filtering by `last_refresh > X` on the read endpoint, use it. If not, pull the full table and filter client-side. Decision goes in the spike report and is updated in the Implementation Notes section of Story 2.8.
2. **Rate limit headroom.** Confirm Clay's actual rate limits against the 500 rows/min NFR. Adjust `fetchWithRetry` backoff parameters if needed.
3. **Pagination details.** Clay API pagination mechanics (cursor-based? page-based? batch size?) — document in spike report.
4. **Cursor storage location.** Decide between adding a row to `schedule_definitions.payload` (Story 2.7 supports per-job state) or extending the Ceipal `getLastCandidateUpdateBySource` pattern. Prefer whichever keeps cursor storage consistent across connectors.
5. **Location parser behavior.** The `location_name` → `city`/`state` parser should be a simple comma-split with a US-state whitelist. Non-matching formats noop gracefully and leave `city`/`state` null (raw `location` is still preserved).

None of these block story acceptance as long as the Given-When-Then criteria in Section 2.8 are met.

---

## 7. Approval Record

- **Proposer:** Vivek (product owner), via `bmad-correct-course` navigation session on 2026-04-15
- **Navigator:** Claude (Opus 4.6)
- **Reviewers:** (pending)
- **Status:** Draft → to be approved by Vivek before routing to the developer agent

---

*Generated by bmad-correct-course on 2026-04-15. Related artifacts: [_bmad-output/epics.md](epics.md) §Story 2.8, [_bmad-output/sprint-status.yaml](sprint-status.yaml), [_bmad-output/architecture.md](architecture.md) §Candidate Data Ingestion / Path 5.*
