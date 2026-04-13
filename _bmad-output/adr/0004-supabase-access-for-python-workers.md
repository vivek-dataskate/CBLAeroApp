# ADR-0004: Supabase Access Controls for Python Workers

- Status: Accepted
- Date: 2026-03-10
- Owners: Architecture, Data, Platform

## Context

CBLAero uses Supabase Postgres with Render-hosted Python workers. Service-role misuse or weak connection controls could bypass tenant rules and expose sensitive data.

## Decision

1. Python workers run only in trusted Render backend runtime.
2. Service-role credentials are backend-only and never exposed to browser/client code.
3. Candidate and recruiter app paths use RLS-protected tokens; backend service-role usage is limited to worker and controlled admin tasks.
4. Keys and connection strings are environment-scoped (`dev`, `staging`, `prod`) and rotated on schedule.
5. Worker jobs use least-privilege SQL roles where feasible.
6. All Python DB connections require TLS with certificate verification enabled.
7. Administrative SQL actions are restricted to migration pipeline and audited maintenance paths.

## Consequences

- Positive: Minimizes blast radius for credential leakage and enforces separation of duties.
- Negative: Requires clear runtime boundaries and stricter operational discipline.

## Verification

- Static checks prevent service-role usage in frontend code.
- Runtime checks confirm worker-only environment variables for privileged keys.
- Audit logs cover all administrative and privileged data operations.
