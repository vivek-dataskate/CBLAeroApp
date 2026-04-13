# Story 1.2: Implement Enterprise SSO and Session Controls

Status: done

## Story

As an internal user,
I want to authenticate with enterprise SSO and managed session persistence,
so that access is secure and aligned with organizational identity policy.

## Acceptance Criteria

1. Given a valid enterprise identity, when the user signs in through SSO, then an authenticated session is created with remember-device support up to 30 days.
2. Session expiration and revocation behavior is enforced server-side.

## Tasks / Subtasks

- [x] Implement enterprise SSO login and callback flow (AC: 1)
  - [x] Add SSO provider integration for internal users in the auth module.
  - [x] Implement login entrypoint and callback handling for code-to-token exchange.
  - [x] Validate identity claims and map role and tenant context for session bootstrap.

- [x] Implement managed session persistence with remember-device (AC: 1)
  - [x] Add server-managed session issuance for authenticated internal users.
  - [x] Implement remember-device behavior with 30-day persistence limit for low-risk actions.
  - [x] Enforce secure cookie/session defaults (httpOnly, secure, sameSite, bounded TTL).

- [x] Enforce server-side session expiration and revocation (AC: 2)
  - [x] Add session validation middleware/proxy checks on protected internal routes.
  - [x] Implement explicit sign-out and session revocation path.
  - [x] Ensure revoked/expired sessions are denied even if client-side state still exists.

- [x] Add quality gates and verification for auth/session behavior (AC: 1, 2)
  - [x] Add unit tests for claim validation, session issuance, and TTL boundaries.
  - [x] Add integration tests for login success, expiration handling, and revocation denial.
  - [x] Run lint, typecheck, test, and build; capture evidence in completion notes.

## Dev Notes

- Reuse and extend the baseline module boundaries from Story 1.1; avoid cross-module leakage.
- Keep internal APIs protected with authenticated session and tenant context.
- Treat session revocation as a server-authoritative control; do not rely on client token removal alone.
- Keep implementation scoped to internal enterprise SSO and session controls for this story.

### Project Structure Notes

- Existing baseline modules are in place under `cblaero/src/modules/*` from Story 1.1.
- Expected primary touchpoints for this story:
  - `cblaero/src/modules/auth/`
  - `cblaero/src/proxy.ts`
  - Internal auth routes/components under `cblaero/src/app/`
  - Auth/session-focused tests under `cblaero/src/modules/__tests__/` and/or `cblaero/src/app/**/__tests__/`

### References

- Source: docs/planning_artifacts/epics.md (Epic 1, Story 1.2)
- Source: docs/planning_artifacts/prd.md (Identity and Session Management)
- Source: docs/planning_artifacts/prd.md (FR41, NFR13)
- Source: docs/planning_artifacts/architecture.md (Authentication and Security)
- Source: docs/planning_artifacts/architecture.md (Sequence: Internal Recruiter SSO Login)
- Source: docs/planning_artifacts/architecture.md (Architectural Boundaries)
- Source: docs/planning_artifacts/architecture.md (Identity and Access checklist)

## Dev Agent Record

### Agent Model Used

GPT-5.3-Codex

### Debug Log References

- npm run lint
- npm run typecheck
- npm test
- curl.exe -s -D - -o NUL "https://aerodelivery.onrender.com/api/auth/login"
- curl.exe -s -D - -o NUL "https://aerodelivery.onrender.com/api/auth/login?remember=true"
- curl.exe -s -D - -o NUL "https://aerodelivery.onrender.com/api/auth/callback"

### Completion Notes List

- Implemented Microsoft Entra SSO login and callback flow with state/nonce protection and code-to-token exchange.
- Added claim validation for issuer/audience/nonce plus internal domain allowlist and optional tenant allowlist enforcement.
- Implemented server-issued session tokens with remember-device support and bounded TTLs up to 30 days.
- Enforced server-side session verification and revocation checks through proxy request handling.
- Implemented explicit sign-out path that revokes active sessions and clears cookies.
- Added auth/session test coverage for issuance, TTL, revocation, and proxy context behavior.
- Fixed Render production auth behavior by removing invalid max_age authorize parameter usage.
- Fixed proxy-origin redirect handling for auth callback/logout to avoid internal host redirects.
- Added authenticated UX baseline: branded homepage, protected dashboard route, sign-in/sign-out controls, and post-login dashboard redirect.
- Validation passed locally: lint, typecheck, and test.
- Deployment, E2E sign-in, and remember-device checks were completed by user confirmation prior to final story closure.

### File List

- cblaero/package.json
- cblaero/package-lock.json
- cblaero/README.md
- cblaero/.env.local.example
- cblaero/.env.render.example
- cblaero/src/modules/auth/config.ts
- cblaero/src/modules/auth/session.ts
- cblaero/src/modules/auth/sso.ts
- cblaero/src/modules/auth/index.ts
- cblaero/src/modules/__tests__/auth-session.test.ts
- cblaero/src/modules/__tests__/auth-sso-flow.test.ts
- cblaero/src/modules/__tests__/baseline.test.ts
- cblaero/src/app/api/auth/login/route.ts
- cblaero/src/app/api/auth/callback/route.ts
- cblaero/src/app/api/auth/logout/route.ts
- cblaero/src/app/page.tsx
- cblaero/src/app/layout.tsx
- cblaero/src/app/dashboard/page.tsx
- cblaero/src/proxy.ts
- docs/implementation_artifacts/stories/1-2-implement-enterprise-sso-and-session-controls.md
