# ADR-0001: Security Baseline and Zero-Trust

- Status: Accepted
- Date: 2026-03-10
- Owners: Architecture, Security, Platform

## Context

CBLAero handles PII, multi-tenant data, compliance evidence, and operational workflows across recruiters, candidates, and admins. Security controls must be explicit and enforceable across web, workers, APIs, and integrations.

## Decision

1. Adopt OWASP ASVS L2 and OWASP API Security Top 10 as the minimum security bar.
2. Use zero-trust principles for all internal and external access paths.
3. Enforce least privilege for identities, secrets, services, and SQL roles.
4. Require step-up authentication for high-risk operations (exports, role changes, bulk actions).
5. Log all security-relevant actions to immutable append-only audit with tamper evidence.
6. Use deny-by-default authorization with explicit role and tenant scope checks.

## Consequences

- Positive: Reduces tenant leakage and privileged misuse risk; improves SOC 2 readiness.
- Negative: Adds implementation overhead in authz middleware, policy checks, and audit validation.

## Verification

- Tenant isolation adversarial tests must pass in CI.
- Security controls mapped to ASVS requirements in release checklist.
- Quarterly review of privileged role assignments and secret scopes.
