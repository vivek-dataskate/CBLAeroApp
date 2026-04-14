# CBLAeroApp — Project Context

> **ATS / Recruiter Dashboard for CBL Solutions (cbl.aero)**  
> Multi-tenant SaaS · Microsoft Entra SSO · AI-assisted candidate management · USA data residency

---

## What This System Does

CBLAeroApp is the internal talent operations platform for CBL Solutions — an aviation staffing firm. It ingests candidate records from multiple sources (CSV upload, PDF resumes, ATS sync via Ceipal, email inboxes), deduplicates and profiles them, and surfaces them to recruiters through a dashboard for matching, outreach, and delivery to clients.

**Scale target:** 1M candidate records at launch, 3M+ by Year 1. All queries designed for 1M+ rows from day one.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Database | Supabase (PostgreSQL) — schema `cblaero_app` |
| Auth | Microsoft Entra SSO (OIDC/OAuth2) |
| AI | Anthropic Claude SDK (`@anthropic-ai/sdk`) |
| ATS | Ceipal API integration |
| Deploy | Render (oregon region) |
| Node | >=24 |

---

## Architecture Principles

- **Non-public schema**: All tables in `cblaero_app` schema — never `public`
- **Data residency gate**: Hard fail on startup if region not in `us-east-1, us-west-2`
- **Active-client contract**: Every sensitive API call requires `activeClientId`, validated server-side
- **Append-only audit**: All `audit_*` tables are INSERT+SELECT only — no UPDATE/DELETE
- **Cursor pagination**: No offset pagination — all list endpoints use cursor-based pagination
- **Correlation IDs**: Every request gets `x-trace-id` (UUID) propagated to all downstream calls and audit events
- **Retry pattern**: All external HTTP via `fetchWithRetry()` — never raw fetch for external APIs

---

## Key Artifact Files

| Artifact | Path |
|---|---|
| Architecture (source of truth) | `_bmad-output/architecture.md` |
| Development Standards | `_bmad-output/development-standards.md` |
| PRD | `_bmad-output/prd.md` |
| Epics + Stories (BDD) | `_bmad-output/epics.md` |
| UX Design Spec | `_bmad-output/ux-design-specification.md` |
| Dashboard UI Standards | `docs/dashboard-ui-standards.md` |
| DB Schema | `supabase/schema.sql` |
| Sprint Status | `_bmad-output/sprint-status.yaml` |
| ADRs | `_bmad-output/adr/` |

---

## Current Sprint Status (as of 2026-04-14)

### Epic 1 — Platform Foundation ✅ DONE (12/12 stories)
All auth, RBAC, tenant isolation, AI inference service, data residency, and API middleware complete.

### Epic 2 — Candidate Data Ingestion 🔄 IN PROGRESS (10/11 done)

| Story | Title | Status |
|---|---|---|
| 2-1 | Admin-supervised 1M record migration pipeline | ✅ Done |
| 2-2 | Recruiter CSV upload wizard + validation | ✅ Done |
| 2-2a | PDF resume upload with LLM extraction | ✅ Done |
| 2-3 | ATS + email ingestion connectors | ✅ Done |
| 2-4 | Candidate profile storage + indexing | ✅ Done |
| 2-4a | Dashboard UI standardization | ✅ Done |
| 2-4b | Sync run summary + error management | ✅ Done |
| 2-5 | Deterministic deduplication + manual review queue | ✅ Done |
| 2-5a | Deduced role classification | ✅ Done |
| 2-6 | Availability state + manual refresh operations | ✅ Done |
| **2-7** | **Global Scheduler Control Plane** | **🔲 NEXT** |

### Epics 3–9 ⬜ BACKLOG (39 stories)

---

## Implemented Capabilities Registry

_Always check here before writing new code — reuse or extend existing capabilities._

### AI Inference
| Capability | Location | Notes |
|---|---|---|
| `callLlm(model, system, user, opts)` | `src/modules/ai/inference.ts` | Central LLM call — ALWAYS use this |
| `getSharedAnthropicClient()` | `src/modules/ai/client.ts` | Shared SDK singleton — never `new Anthropic()` directly |
| `loadPrompt(name, version?)` | `src/modules/ai/prompt-registry.ts` | DB-first prompt loading with inline fallback |
| `checkBudgetThreshold(usd?)` | `src/modules/ai/budget-alert.ts` | Daily AI spend guard (default $10/day) |

### HTTP & External APIs
| Capability | Location | Notes |
|---|---|---|
| `fetchWithRetry(url, init, opts)` | `src/modules/ingestion/fetch-with-retry.ts` | ALL external HTTP — never raw fetch |
| `acquireGraphToken()` | `src/modules/email/graph-auth.ts` | Microsoft Graph API token |
| `acquireCeipalToken()` | `src/modules/ats/ceipal.ts` | Ceipal API token |

### Candidate Pipeline
| Capability | Location | Notes |
|---|---|---|
| `extractCandidateFromDocument(input, type)` | `src/features/candidate-management/application/candidate-extraction.ts` | LLM extraction; auto OCR for scanned PDFs |
| `mapToCandidateRow(record, source)` | `src/modules/ingestion/index.ts` | Maps candidate data to DB columns (30+ fields) |
| `uploadFileToStorage(buffer, filename, path)` | `src/features/candidate-management/infrastructure/storage.ts` | Only Supabase Storage upload — never `db.storage.upload()` directly |

### Database RPCs
| RPC | When to Use |
|---|---|
| `upsert_candidate` | Single candidate upsert with email dedup |
| `upsert_candidate_batch` | Batch upsert (max 500 records) |
| `process_import_chunk` | Batch upsert with per-row error tracking |
| `search_candidates` | Filtered, paginated candidate search |
| `get_candidate_detail` | Single candidate with all columns |
| `rollback_import_batch` | Delete all candidates from an import batch |

---

## Brand & UI Standards

- **Colors**: Navy `#1a174d` (primary), Blue `#1d87c8` (accent), Dark `#101218` (footer)
- **Font**: Poppins (Google Fonts)
- **Layout**: Sticky header + flex main + footer on ALL dashboard pages
- Full spec: `docs/dashboard-ui-standards.md`

---

## GitHub

- **Repo**: https://github.com/vivek-dataskate/CBLAeroApp
- **Deploy**: Render — `https://<service>.onrender.com`
- **Projects board**: https://github.com/users/vivek-dataskate/projects/2
