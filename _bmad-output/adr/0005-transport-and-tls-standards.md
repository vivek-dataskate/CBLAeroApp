# ADR-0005: Transport and TLS Standards

- Status: Accepted
- Date: 2026-03-10
- Owners: Architecture, Platform, Security

## Context

CBLAero traffic includes authentication, PII, outreach data, and audit payloads. Transport security must be consistent across edge, app, worker, and database paths.

## Decision

1. Enforce HTTPS-only external traffic with TLS 1.2+ (TLS 1.3 preferred).
2. Enforce HTTP to HTTPS redirects and HSTS on authenticated surfaces.
3. Database traffic to Supabase requires TLS (`sslmode=require` minimum, stronger verification mode when supported by client/runtime).
4. Certificates are managed through platform TLS endpoints (Render and Supabase) with automated renewal.
5. No plaintext credentials or connection strings in source control.
6. Secrets are stored only in Render environment secrets for MVP.

## Consequences

- Positive: Strong baseline confidentiality and integrity for all in-transit data.
- Negative: Some legacy tooling may require configuration updates to meet TLS requirements.

## Verification

- TLS and redirect checks as part of deployment validation.
- Security tests fail builds when insecure transport is detected.
- Regular secret scanning and connection-string exposure checks in CI.
