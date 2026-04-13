import { beforeEach, describe, expect, it } from "vitest";

import { clearAdminGovernanceStoreForTest } from "../admin";
import { authorizeAccess, issueSessionToken } from "../auth";
import {
  clearAuthorizationDenyEventsForTest,
  listAuthorizationDenyEvents,
} from "../audit";

describe("story 1.3 authorization guards", () => {
  beforeEach(async () => {
    await clearAdminGovernanceStoreForTest();
    await clearAuthorizationDenyEventsForTest();
  });

  it("allows role-permitted tenant-scoped access", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-1",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-a",
      role: "recruiter",
      rememberDevice: false,
    });

    const result = await authorizeAccess({
      session: issued.session,
      action: "candidate:read",
      requestedTenantId: "tenant-a",
      path: "/api/internal/candidates",
      method: "GET",
      traceId: "trace-allow-1",
    });

    expect(result).toEqual({ allowed: true });
    expect(await listAuthorizationDenyEvents()).toEqual([]);
  });

  it("allows recruiter write operation within tenant scope", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-2",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-a",
      role: "recruiter",
      rememberDevice: false,
    });

    const result = await authorizeAccess({
      session: issued.session,
      action: "candidate:write",
      requestedTenantId: "tenant-a",
      path: "/api/internal/candidates",
      method: "POST",
      traceId: "trace-forbidden-role",
    });

    expect(result).toEqual({ allowed: true });
    expect(await listAuthorizationDenyEvents()).toHaveLength(0);
  });

  it("denies cross-tenant request and records tenant mismatch", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-3",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin",
      rememberDevice: false,
    });

    const result = await authorizeAccess({
      session: issued.session,
      action: "candidate:read",
      requestedTenantId: "tenant-b",
      path: "/api/internal/candidates",
      method: "GET",
      traceId: "trace-tenant-mismatch",
    });

    expect(result).toEqual({
      allowed: false,
      status: 403,
      reason: "tenant_mismatch",
    });

    const events = await listAuthorizationDenyEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      traceId: "trace-tenant-mismatch",
      actorId: "actor-3",
      role: "admin",
      sessionTenantId: "tenant-a",
      requestedTenantId: "tenant-b",
      reason: "tenant_mismatch",
    });
  });

  it("allows explicitly assigned secondary client access", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-4",
      email: "delivery@cblsolutions.com",
      tenantId: "tenant-a",
      clientIds: ["tenant-a", "tenant-b"],
      role: "delivery-head",
      rememberDevice: false,
    });

    const result = await authorizeAccess({
      session: issued.session,
      action: "candidate:write",
      requestedTenantId: "tenant-b",
      path: "/api/internal/candidates",
      method: "POST",
      traceId: "trace-multi-client-allow",
    });

    expect(result).toEqual({ allowed: true });
    expect(await listAuthorizationDenyEvents()).toHaveLength(0);
  });
});