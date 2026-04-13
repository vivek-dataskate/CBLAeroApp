# Story 1.3: Enforce RBAC and Tenant-Isolated Authorization

Status: done

## Story

As a security engineer,
I want every read/write path to enforce role and tenant checks,
so that users cannot access data outside their allowed scope.

## Acceptance Criteria

1. Given authenticated users with different roles and tenants, when they access protected APIs and UI routes, then only role-permitted operations succeed.
2. Given cross-tenant access attempts, when a protected path is evaluated, then access is denied and the attempt is audited in Supabase Postgres with tenant-safe controls across relational and vector retrieval paths.

## Tasks / Subtasks

- [x] Enforce role-based authorization on protected APIs and UI routes (AC: 1)
  - [x] Define role-permission checks for internal roles across route handlers and protected pages.
  - [x] Apply authorization guards so only allowed operations execute per role.
  - [x] Return explicit unauthorized responses for forbidden role operations.

- [x] Enforce tenant-isolated authorization on read/write paths (AC: 1, 2)
  - [x] Validate tenant scope on every protected read/write path using trusted server session context.
  - [x] Deny cross-tenant access attempts regardless of client-provided identifiers.
  - [x] Ensure tenant context propagation remains server-authoritative throughout request handling.

- [x] Add authorization audit logging for denied access (AC: 2)
  - [x] Capture denied-role and cross-tenant events with actor, tenant, path, and reason metadata.
  - [x] Ensure audit entries are emitted for both API and UI-protected path denials.
  - [x] Verify denied events are queryable through existing audit foundations.

- [x] Add quality gates and verification for authorization behavior (AC: 1, 2)
  - [x] Add unit/integration tests for role-permitted access and role-forbidden access.
  - [x] Add tests for cross-tenant denial and audit-event emission on denial.
  - [x] Run lint, typecheck, test, and build; capture evidence in completion notes.

## Dev Notes

- Build on Story 1.2 authenticated session context and keep authorization checks server-side.
- Treat tenant and role from signed session as trusted; do not trust client-supplied actor/tenant claims.
- Ensure denial behavior is deterministic and observable through audit logging.
- Ensure authorization deny auditing is multi-instance safe by persisting through Supabase Postgres instead of process-local memory.
- Enforce tenant guardrails consistently for both relational queries and vector retrieval paths used by semantic features.
- Keep implementation scoped to authorization and tenant isolation only.

### Project Structure Notes

- Existing auth/session baseline from Stories 1.1 and 1.2 is in place under `cblaero/src/modules/auth/` and `cblaero/src/proxy.ts`.
- Expected primary touchpoints for this story:
  - `cblaero/src/modules/auth/`
  - `cblaero/src/modules/audit/`
  - Protected route handlers/components under `cblaero/src/app/`
  - Authorization-focused tests under `cblaero/src/modules/__tests__/` and/or `cblaero/src/app/**/__tests__/`

### References

- Source: docs/planning_artifacts/epics.md (Epic 1, Story 1.3)
- Source: docs/planning_artifacts/prd.md (Identity and Session Management)
- Source: docs/planning_artifacts/architecture.md (Authentication and Security)
- Source: docs/planning_artifacts/architecture.md (Architectural Boundaries)

## Dev Agent Record

### Agent Model Used

GPT-5.3-Codex

### Debug Log References

- npm run lint
- npm run typecheck
- npm test
- npm run build

### Completion Notes List

- Added a centralized authorization module with role-permission mapping and tenant-isolation checks for protected actions.
- Applied RBAC and tenant checks to protected API routes and dashboard routes, including admin-only access paths.
- Implemented denied authorization auditing with reason metadata and a protected query route for denial events.
- Added unit and route tests covering allow paths, forbidden role paths, unauthenticated access, and cross-tenant denial behavior.
- Validation passed locally: lint, typecheck, test, and build.

### File List

- cblaero/src/modules/auth/authorization.ts
- cblaero/src/modules/auth/index.ts
- cblaero/src/modules/audit/index.ts
- cblaero/src/modules/__tests__/authorization.test.ts
- cblaero/src/app/api/internal/candidates/route.ts
- cblaero/src/app/api/internal/candidates/__tests__/route.test.ts
- cblaero/src/app/api/internal/audit/authorization-denials/route.ts
- cblaero/src/app/api/internal/audit/authorization-denials/__tests__/route.test.ts
- cblaero/src/app/dashboard/page.tsx
- cblaero/src/app/dashboard/admin/page.tsx
- cblaero/vitest.config.ts
- docs/implementation_artifacts/stories/1-3-enforce-rbac-and-tenant-isolated-authorization.md