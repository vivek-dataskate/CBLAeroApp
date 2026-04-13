# CBLAeroApp — Project Context for Claude & BMAD

## Project Overview
CBLAeroApp is an Applicant Tracking System (ATS) / recruiter dashboard for CBL Solutions (cbl.aero). Multi-tenant SaaS with Microsoft Entra SSO, data residency enforcement, and AI-assisted candidate management.

- **GitHub**: https://github.com/vivek-dataskate/CBLAeroApp
- **Deployed on**: Render
- **Database**: Supabase (PostgreSQL, schema `cblaero_app`)
- **Owner**: Vivek

## Tech Stack
| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Database | Supabase (PostgreSQL) |
| Auth | Microsoft Entra SSO (OIDC/OAuth2) |
| AI | Anthropic Claude SDK |
| Testing | Vitest |
| Deploy | Render |
| Node | >=24 |

## Key Architecture Patterns
- **App Router**: All routes in `src/app/`
- **Feature modules**: `src/features/` (candidate-management, auth, ai, ats, audit, csv, email, ingestion, persistence, tenants)
- **Non-public schema**: Supabase uses `cblaero_app` (not `public`) — enforced at startup
- **Data residency**: Hard gate — approved US regions only (us-east-1, us-west-2)
- **Active-client contract**: All client-sensitive API calls must include `activeClientId`
- **Multi-tenant**: Role-based access (admin, recruiter), tenant isolation enforced

## Brand & UI Standards
- **Colors**: Navy `#1a174d` (primary), Blue `#1d87c8` (accent), Dark `#101218` (footer)
- **Font**: Poppins (Google Fonts)
- See `docs/dashboard-ui-standards.md` for full standards

## Common Commands
```bash
npm run dev              # Start dev server (port 3000)
npm run build            # Production build
npm run test             # Vitest tests
npm run typecheck        # TypeScript check
npm run lint             # ESLint
npm run residency:preflight  # Data residency check
```

## BMAD Setup
All 6 modules installed — use `/bmad-help` to get started.
- **core** v6.3.0, **bmm** v6.3.0, **bmb** v1.5.0, **cis** v0.1.9, **gds** v0.2.4, **tea** v1.7.2
- 100 skills in `.claude/skills/`
