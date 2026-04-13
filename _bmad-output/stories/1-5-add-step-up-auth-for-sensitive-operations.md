# Story 1.5: Add Step-Up Auth for Sensitive Operations

Status: done

## Story

As a compliance officer,
I want sensitive workflows to require fresh authentication,
so that high-impact actions are protected from session misuse.

## Acceptance Criteria

1. Given a user with an active session, when they attempt sensitive operations (data export, role changes, or communication-history access), then a step-up challenge is required before completion if authentication is stale.
2. Successful and failed step-up checks are audited in a dedicated step-up audit stream persisted in Supabase Postgres and queryable with tenant-safe controls.

## Tasks / Subtasks

- [x] Add step-up freshness helpers in auth module (AC: 1)
  - [x] Add configurable freshness threshold for sensitive operations.
  - [x] Add helper to evaluate session authentication age.
  - [x] Add helper to build safe re-authentication URLs.

- [x] Enforce step-up on sensitive operations (AC: 1)
  - [x] Mark data export, role assignment, and communication-history access as sensitive actions.
  - [x] Return explicit `step_up_required` error with re-authentication URL when stale.
  - [x] Allow operation immediately when session freshness check passes.

- [x] Add dedicated step-up audit event stream (AC: 2)
  - [x] Add step-up attempt event type and in-memory store.
  - [x] Emit `challenged` events for stale-session attempts.
  - [x] Emit `verified` events when sensitive operations pass step-up freshness checks.

- [x] Surface step-up state in admin console and add quality gates (AC: 1, 2)
  - [x] Show re-authentication link in UI when step-up is required.
  - [x] Show step-up attempt history in admin console audit section.
  - [x] Add module and route tests and run lint, typecheck, test, and build.

## Dev Notes

- Hooks are implemented on top of Story 1.4 governance actions.
- Step-up is enforced server-side using session issuance age as the freshness source of truth.
- Step-up audit persistence uses Supabase Postgres for multi-instance consistency; process-local-only state is not an acceptable production mode.
- For vector-backed semantic compliance search, step-up retrieval paths must enforce tenant and role filtering before ranking.

### Project Structure Notes

- Primary touchpoints for this story:
  - `cblaero/src/modules/auth/step-up.ts`
  - `cblaero/src/modules/audit/index.ts`
  - `cblaero/src/app/api/internal/admin/governance/route.ts`
  - `cblaero/src/app/dashboard/admin/AdminGovernanceConsole.tsx`

### References

- Source: docs/planning_artifacts/epics.md (Epic 1, Story 1.5)
- Source: docs/planning_artifacts/prd.md (Identity and Session Management)
- Source: docs/planning_artifacts/architecture.md (Authentication and Security)

## Dev Agent Record

### Agent Model Used

GPT-5.3-Codex

### Debug Log References

- npm run lint
- npm run typecheck
- npm test
- npm run build

### Completion Notes List

- Added step-up freshness helpers and re-auth URL construction in auth module.
- Enforced step-up challenge behavior for sensitive admin governance actions when authentication is stale.
- Added dedicated step-up audit events for both challenged and verified outcomes.
- Surfaced step-up-required re-auth links and step-up audit trail in admin governance console UI.
- Added tests for step-up helpers and governance step-up route behavior.
- Validation passed locally: lint, typecheck, test, and build.

### File List

- cblaero/src/modules/auth/step-up.ts
- cblaero/src/modules/auth/index.ts
- cblaero/src/modules/audit/index.ts
- cblaero/src/app/api/internal/admin/governance/route.ts
- cblaero/src/app/api/internal/admin/governance/__tests__/route.test.ts
- cblaero/src/app/dashboard/admin/AdminGovernanceConsole.tsx
- cblaero/src/app/dashboard/admin/page.tsx
- cblaero/src/modules/__tests__/auth-step-up.test.ts
- docs/implementation_artifacts/stories/1-5-add-step-up-auth-for-sensitive-operations.md
- docs/implementation_artifacts/sprint-status.yaml
