import { describe, expect, it } from "vitest";

import { resolveAuthContext, type AuthSession } from "../auth";
import { resolveTenantContext } from "../tenants";
import { createAuditEnvelope } from "../audit";
// createIngestionEnvelope removed — dead code cleaned up
import { applyBaselineContextHeaders } from "../../proxy";

describe("baseline boundary modules", () => {
  it("provides stable placeholder auth and tenant context", () => {
    expect(resolveAuthContext()).toEqual({
      actorId: null,
      authenticated: false,
    });

    expect(resolveTenantContext()).toEqual({
      tenantId: null,
    });
  });

  it("creates audit and ingestion envelopes", () => {
    expect(createAuditEnvelope("trace-123")).toEqual({
      traceId: "trace-123",
      actorId: null,
      tenantId: null,
    });

    // createIngestionEnvelope test removed (dead code cleaned up)
  });
});

describe("proxy header hardening", () => {
  it("overwrites untrusted actor and tenant headers", () => {
    const incoming = new Headers({
      "x-trace-id": "trace-existing",
      "x-tenant-id": "tenant-spoof",
      "x-actor-id": "actor-spoof",
    });

    const result = applyBaselineContextHeaders(incoming);

    expect(result.get("x-trace-id")).toBe("trace-existing");
    expect(result.get("x-tenant-id")).toBe("unknown");
    expect(result.get("x-actor-id")).toBe("anonymous");
    expect(result.get("x-authenticated")).toBe("0");
  });

  it("adds trace id when missing", () => {
    const result = applyBaselineContextHeaders(new Headers());
    expect(result.get("x-trace-id")).toBeTruthy();
  });

  it("propagates actor and tenant from validated session", () => {
    const session: AuthSession = {
      sessionId: "session-1",
      actorId: "actor-1",
      email: "user@cblsolutions.com",
      tenantId: "tenant-1",
      role: "recruiter",
      rememberDevice: false,
      issuedAtEpochSec: 1,
      expiresAtEpochSec: 2,
    };

    const result = applyBaselineContextHeaders(new Headers(), session);

    expect(result.get("x-tenant-id")).toBe("tenant-1");
    expect(result.get("x-actor-id")).toBe("actor-1");
    expect(result.get("x-authenticated")).toBe("1");
  });
});
