# CBLAeroApp — Project Context for Claude & BMAD

## Project Overview
CBLAeroApp is an Applicant Tracking System (ATS) / recruiter dashboard for CBL Solutions (cbl.aero). It is a multi-tenant SaaS platform with Microsoft Entra SSO authentication, data residency enforcement, and AI-assisted candidate management.

- **GitHub**: https://github.com/vivek-dataskate/CBLAeroApp
- **Deployed on**: Render (https://<service>.onrender.com)
- **Database**: Supabase (PostgreSQL, dedicated schema `cblaero_app`)
- **Owner**: Vivek

## Tech Stack
| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Database | Supabase (PostgreSQL) |
| Auth | Microsoft Entra SSO (OIDC/OAuth2) |
| AI | Anthropic Claude SDK (`@anthropic-ai/sdk`) |
| Testing | Vitest |
| Deploy | Render |
| Node | >=24 |

## Key Architecture Patterns
- **App Router**: All routes in `src/app/` using Next.js 15+ conventions
- **Feature modules**: Business logic in `src/features/` (candidate-management, auth, ai, ats, audit, csv, email, ingestion, persistence, tenants)
- **Non-public schema**: Supabase uses `cblaero_app` schema (not `public`) — enforced at startup
- **Data residency**: Hard policy gate — approved US regions only (us-east-1, us-west-2). App fails fast if violated.
- **Active-client contract**: All client-sensitive API calls must include `activeClientId`, validated server-side
- **Multi-tenant**: Role-based access (admin, recruiter), tenant isolation enforced

## Directory Structure
\`\`\`
src/
  app/              # Next.js routes & API handlers
    api/            # REST API endpoints
    dashboard/      # Dashboard pages (admin, recruiter)
  features/         # Domain feature modules
    candidate-management/
    auth/
    ai/
    ats/
    audit/
    csv/
    email/
    ingestion/
    persistence/
    tenants/
  modules/          # Shared utilities
  types/            # TypeScript types
supabase/
  schema.sql        # DB schema (run in Supabase SQL Editor)
  migrations/       # DB migrations
docs/
  dashboard-ui-standards.md
_bmad/              # BMAD agents & workflows
_bmad-output/       # BMAD generated artifacts (PRDs, stories, etc.)
.claude/skills/     # 100 BMAD skills for Claude Code
.devcontainer/      # GitHub Codespace configuration
\`\`\`

## Brand & UI Standards
- **Colors**: Navy `#1a174d` (primary), Blue `#1d87c8` (accent), Dark `#101218` (footer)
- **Font**: Poppins (Google Fonts)
- **Layout**: Sticky header + flex main + footer on all dashboard pages
- See `docs/dashboard-ui-standards.md` for full standards

## Environment Variables (Required)
All 28 vars must be set in Render dashboard (`sync: false`). `CBL_SUPABASE_SCHEMA` is hardcoded in `render.yaml`.

\`\`\`
# AI
ANTHROPIC_API_KEY               # Anthropic API key for Claude SDK

# App
CBL_APP_URL                     # App URL (local or Render)
CBL_APP_TENANT_ID               # Internal tenant ID for the app
CBL_SESSION_SECRET              # 32+ char random secret
CBL_JOBS_SECRET                 # Secret for background job endpoints

# SSO — Microsoft Entra
CBL_SSO_ISSUER                  # https://login.microsoftonline.com/<tenant-id>
CBL_SSO_TOKEN_ISSUER            # Token issuer URL (may differ from ISSUER)
CBL_SSO_CLIENT_ID               # Entra app client ID
CBL_SSO_CLIENT_SECRET           # Entra app client secret
CBL_SSO_REDIRECT_URI            # https://<render-url>/api/auth/callback
CBL_SSO_ALLOWED_EMAIL_DOMAIN    # cblsolutions.com
CBL_SSO_ALLOWED_TENANT_ID       # Entra tenant ID

# Supabase
CBL_SUPABASE_URL                # Supabase project URL
CBL_SUPABASE_SERVICE_ROLE_KEY   # Supabase service role key
CBL_SUPABASE_SCHEMA             # cblaero_app (never public) — hardcoded in render.yaml
SUPABASE_DB_URL                 # Direct Postgres connection URL

# Data Residency
CBL_APPROVED_US_REGIONS         # us-east-1,us-west-2
CBL_DATA_REGION                 # us-west-2
CBL_LOG_REGION                  # us-west-2
CBL_BACKUP_REGION               # us-west-2

# Features
CBL_SUBMISSION_INBOXES          # Comma-separated email inboxes for resume ingestion
CBL_VECTOR_AUDIT_ENABLED        # true/false — enable vector audit logging
CBL_VECTOR_AUDIT_TABLE          # Supabase table for vector audit
CBL_VECTOR_DIMENSIONS           # Embedding dimensions (e.g. 1536)

# CEIPAL ATS Integration
CEIPAL_API_KEY                  # CEIPAL API key
CEIPAL_ENDPOINT_KEY             # CEIPAL endpoint key
CEIPAL_USERNAME                 # CEIPAL account username
CEIPAL_PASSWORD                 # CEIPAL account password
\`\`\`

## Common Commands
\`\`\`bash
npm run dev              # Start development server (port 3000)
npm run build            # Production build
npm run test             # Run Vitest tests
npm run typecheck        # TypeScript check
npm run lint             # ESLint
npm run residency:preflight  # Verify data residency before migrations
\`\`\`

## BMAD Setup
This project has all 6 BMAD modules installed:
- **core** v6.3.0 — Core BMAD skills
- **bmm** v6.3.0 — Agile AI-Driven Development (PM, architect, dev, QA workflows)
- **bmb** v1.5.0 — BMad Builder (agent/workflow/module builder)
- **cis** v0.1.9 — Creative Intelligence Suite
- **gds** v0.2.4 — Game Dev Studio
- **tea** v1.7.2 — Test Architect

100 skills available in \`.claude/skills/\`. Use \`/bmad-help\` to get started.

## Current Project Status (as of 2026-04-13)

**Epic 1 — Foundation & Platform**: ✅ DONE (12/12 stories)  
**Epic 2 — Candidate Data Ingestion**: 🔄 IN-PROGRESS (10/11 done — story 2-7 scheduler backlog)  
**Epics 3–9**: ⬜ BACKLOG (39 stories remaining)  

Next story: **2-7 — Global Scheduler Control Plane**  
Full status: see \`PROJECT_STATUS.md\`

### Key Artifact Paths
| Artifact | Location |
|----------|----------|
| Stories (24) | `_bmad-output/stories/` |
| Epics / PRD / Architecture | \`_bmad-output/\` |
| BMAD agents & workflows | \`_bmad/\` |
| Sprint status | \`_bmad-output/sprint-status.yaml\` |

## Deployment Notes
- **Render**: Set all `CBL_*` env vars in Render service settings. Set `CBL_APP_URL` to Render URL. Redeploy after changes.
- **Supabase**: Run `supabase/schema.sql` in SQL Editor. Set `CBL_SUPABASE_SCHEMA=cblaero_app`.
- **Auth callback**: Add `https://<render-url>/api/auth/callback` to Entra app redirect URIs.
