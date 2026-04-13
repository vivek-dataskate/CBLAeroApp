# Story 1.4: Build Admin User and Team Management Console

Status: done

## Story

As an admin,
I want to invite users, assign roles, and manage team membership,
so that workforce onboarding and governance are controlled centrally.

## Acceptance Criteria

1. Given an admin user, when they create invitations or change role/team assignments, then changes apply immediately with validation of allowed role transitions.
2. Admin actions are written to a separate auditable admin action stream persisted in Supabase Postgres, with tenant-safe queryability for both relational and vector-assisted retrieval.

## Tasks / Subtasks

- [x] Implement admin-governed user and invitation lifecycle services (AC: 1)
  - [x] Add an admin governance module for managed users and pending invitations.
  - [x] Register users into governance records from authenticated session context.
  - [x] Validate invitation uniqueness and tenant-scoped targeting rules.

- [x] Implement role transition governance and team membership controls (AC: 1)
  - [x] Define allowed role transition map and enforce invalid transition rejection.
  - [x] Add role assignment operation for tenant-scoped managed users.
  - [x] Add team membership update operation with normalized team identifiers.

- [x] Add protected admin governance API route (AC: 1, 2)
  - [x] Expose tenant-scoped governance reads for users, invitations, and admin action history.
  - [x] Expose action-based governance writes for invite, role assignment, and team update operations.
  - [x] Apply admin authorization checks and return explicit validation and authorization errors.

- [x] Add separate auditable admin action stream (AC: 2)
  - [x] Introduce dedicated admin action event types and in-memory event store.
  - [x] Emit admin audit events for invite, role assignment, and team membership changes.
  - [x] Include trace, actor, tenant, target, and action detail metadata in each event.

- [x] Add admin console UI and quality gates (AC: 1, 2)
  - [x] Upgrade admin dashboard route into governance console with action forms and state refresh.
  - [x] Add unit and route tests for governance operations and authorization denials.
  - [x] Run lint, typecheck, test, and build; capture evidence in completion notes.

## Dev Notes

- Builds on Story 1.2 session controls and Story 1.3 authorization foundations.
- Keeps governance operations tenant-scoped and server-authoritative.
- Maintains a distinct admin audit stream separate from authorization denial events.
- Uses Supabase Postgres as the authoritative governance and audit persistence layer for multi-instance consistency.
- If vector indexing is used for governance audit discovery, retrieval must enforce tenant and role filters before semantic ranking.

### Project Structure Notes

- Primary touchpoints for this story:
  - `cblaero/src/modules/admin/`
  - `cblaero/src/modules/audit/`
  - `cblaero/src/modules/auth/`
  - `cblaero/src/app/api/internal/admin/governance/`
  - `cblaero/src/app/dashboard/admin/`

### References

- Source: docs/planning_artifacts/epics.md (Epic 1, Story 1.4)
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

- Added `admin` domain module with managed user catalog, invitation lifecycle, role transition validation, and team membership updates.
- Added governance APIs under `/api/internal/admin/governance` with admin-only authorization and explicit error handling.
- Added separate admin action audit stream and wired emission for invite, role, and team governance operations.
- Upgraded admin dashboard UI with interactive governance forms and real-time payload refresh.
- Updated session callback and dashboard flows to register and resolve managed user roles for governance consistency.
- Added Story 1.4 unit and route tests and validated all quality gates.

### File List

- cblaero/src/modules/admin/index.ts
- cblaero/src/modules/audit/index.ts
- cblaero/src/modules/auth/authorization.ts
- cblaero/src/modules/index.ts
- cblaero/src/app/api/auth/callback/route.ts
- cblaero/src/app/api/internal/admin/governance/route.ts
- cblaero/src/app/api/internal/admin/governance/__tests__/route.test.ts
- cblaero/src/app/dashboard/admin/page.tsx
- cblaero/src/app/dashboard/admin/AdminGovernanceConsole.tsx
- cblaero/src/app/dashboard/page.tsx
- cblaero/src/modules/__tests__/admin-governance.test.ts
- cblaero/src/modules/__tests__/authorization.test.ts
- cblaero/src/app/api/internal/candidates/__tests__/route.test.ts
- cblaero/src/app/api/internal/audit/authorization-denials/__tests__/route.test.ts
- docs/implementation_artifacts/stories/1-4-build-admin-user-and-team-management-console.md
