# Story 1.7: Add Active Client Context Safeguards

Status: done

## Story

As a recruiter managing multiple clients,
I want explicit active-client indicators and cross-client action confirmations,
so that I avoid accidental operations in the wrong client context.

## Acceptance Criteria

1. Given a recruiter with access to multiple client contexts, when they execute candidate update/export actions, then the active client is clearly displayed and included in request scope.
2. Given a recruiter with access to multiple client contexts, when they attempt a cross-client candidate update/export action, then explicit confirmation is required before execution.

## Tasks / Subtasks

- [x] Introduce active client context contract in auth/session and request handling (AC: 1)
  - [x] Define a server-authoritative active-client context shape for authenticated sessions and candidate write/export requests.
  - [x] Keep tenant isolation strict by default; do not permit cross-client operations unless the actor is explicitly allowed for the target client.
  - [x] Ensure active-client context is propagated into request metadata and trace/audit payloads.

- [x] Add explicit active client indicator in recruiter-facing surfaces (AC: 1)
  - [x] Surface a clear "Active Client" label in dashboard/action surfaces where candidate updates/exports are initiated.
  - [x] Ensure candidate update/export request builders include the active-client identifier in request scope fields.
  - [x] Preserve existing role/tenant safety UX patterns established in Epic 1 stories.

- [x] Enforce cross-client confirmation for high-impact candidate actions (AC: 2)
  - [x] Add a confirmation gate for cross-client candidate update/export attempts before server execution.
  - [x] Keep confirmation checks server-enforced (not UI-only) on internal candidate action routes.
  - [x] Emit auditable events for cross-client confirmation required/confirmed outcomes with actor, tenant/client scope, and trace ID.

- [x] Add verification tests and quality gates (AC: 1, 2)
  - [x] Add/extend unit tests for authorization and tenant/client context handling.
  - [x] Add/extend route tests for active-client request scope and cross-client confirmation requirements.
  - [x] Run lint, typecheck, test, and build; capture validation output in completion notes.

## Dev Notes

- Story dependency context:
  - Story 1.3 established RBAC and tenant-isolated authorization pathways. Extend those controls rather than bypassing them.
  - Story 1.5 established step-up protection and auditable sensitive-action handling. Reuse these enforcement and auditing patterns for confirmation gates on high-impact actions.
  - Story 1.6 reinforced policy-driven compliance evidence patterns; keep new client-context controls explicit, auditable, and server-authoritative.
- Security and guardrail constraints to preserve:
  - Keep strict object-level tenant isolation on every read/write path.
  - High-impact actions (bulk changes and exports) require human-in-the-loop confirmation.
  - Avoid direct cross-tenant queries without explicit tenant predicate and authorization checks.
- Implementation guidance:
  - Current candidate route authorization hard-denies tenant mismatch; Story 1.7 should evolve this safely for multi-client actors by requiring explicit confirmation for allowed cross-client operations, while still denying unauthorized tenant access.
  - Existing dashboard and admin pages already surface tenant context; extend this pattern to an explicit active-client indicator and action-scoped request payload binding.

### Project Structure Notes

- Expected primary touchpoints:
  - `cblaero/src/modules/auth/session.ts`
  - `cblaero/src/modules/auth/authorization.ts`
  - `cblaero/src/modules/audit/index.ts`
  - `cblaero/src/app/dashboard/page.tsx`
  - `cblaero/src/app/api/internal/candidates/route.ts`
  - `cblaero/src/modules/__tests__/authorization.test.ts`
  - `cblaero/src/app/api/internal/candidates/__tests__/route.test.ts`
- If new config is needed for confirmation policy behavior, update:
  - `cblaero/.env.local.example`
  - `cblaero/.env.render.example`
  - `cblaero/README.md`

### References

- Source: docs/planning_artifacts/epics.md (Epic 1, Story 1.7)
- Source: docs/planning_artifacts/epics.md (X3 Security Hardening and Client Safety)
- Source: docs/planning_artifacts/prd.md (FR26)
- Source: docs/planning_artifacts/prd.md (Authentication and Access Requirements)
- Source: docs/planning_artifacts/architecture.md (Decision governance rules)
- Source: docs/planning_artifacts/architecture.md (Project Structure and Boundaries)
- Source: docs/planning_artifacts/architecture.md (Pattern examples and anti-patterns)

## Dev Agent Record

### Agent Model Used

GPT-5.3-Codex

### Debug Log References

- npm test -- src/modules/__tests__/auth-session.test.ts src/modules/__tests__/authorization.test.ts src/app/api/internal/candidates/__tests__/route.test.ts
- npm run lint
- npm run typecheck
- npm test
- npm run build

### Completion Notes List

- Added multi-client session context support (`clientIds`) with strict default behavior preserving single-tenant safety.
- Enabled recruiter `candidate:write` authorization so Story 1.7 recruiter update/export acceptance criteria are enforceable in implementation.
- Updated authorization to permit target client scope only when explicitly present in authenticated session client context.
- Added server-enforced active-client scope validation for candidate write/export actions.
- Added explicit cross-client confirmation gate for candidate update/export actions using a server-issued, short-lived confirmation token (`cross_client_confirmation_required` challenge response).
- Hardened cross-client confirmation to one-time token use with replay protection.
- Added auditable client context confirmation event stream with required/confirmed outcomes.
- Updated candidate API response metadata to include `activeClientId` and `targetClientId` request scope context, and allowed selecting active client from authorized client memberships.
- Updated dashboard and admin dashboard context cards to display "Active Client".
- Added/extended tests for session client context, multi-client authorization, cross-client confirmation requirements, and scope validation behavior.
- Added replay-attempt test coverage to verify one-time confirmation token enforcement.
- Bound cross-client confirmation tokens to deterministic request intent (target client, action, candidate IDs, and export format) to block payload-drift confirmation bypasses.
- Validation passed: lint, typecheck, full test suite, and production build.

### File List

- cblaero/src/modules/auth/session.ts
- cblaero/src/modules/auth/authorization.ts
- cblaero/src/modules/audit/index.ts
- cblaero/src/app/api/internal/candidates/route.ts
- cblaero/src/app/dashboard/page.tsx
- cblaero/src/app/dashboard/admin/page.tsx
- cblaero/src/modules/__tests__/auth-session.test.ts
- cblaero/src/modules/__tests__/authorization.test.ts
- cblaero/src/app/api/internal/candidates/__tests__/route.test.ts
- cblaero/supabase/schema.sql
- docs/implementation_artifacts/stories/1-7-add-active-client-context-safeguards.md
