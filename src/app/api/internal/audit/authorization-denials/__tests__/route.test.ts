import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { clearAdminGovernanceStoreForTest } from "@/modules/admin";
import {
  SESSION_COOKIE_NAME,
  authorizeAccess,
  issueSessionToken,
} from "@/modules/auth";
import {
  clearAuthorizationDenyEventsForTest,
  listAuthorizationDenyEvents,
} from "@/modules/audit";

import { GET } from "../route";

function withSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

describe("authorization deny audit API", () => {
  beforeEach(async () => {
    await clearAdminGovernanceStoreForTest();
    await clearAuthorizationDenyEventsForTest();
  });

  it("allows admin to query denied events for their tenant", async () => {
    const recruiter = await issueSessionToken({
      actorId: "actor-rec-1",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-a",
      role: "recruiter",
      rememberDevice: false,
    });

    await authorizeAccess({
      session: recruiter.session,
      action: "audit:read-denials",
      requestedTenantId: "tenant-a",
      path: "/api/internal/candidates",
      method: "GET",
      traceId: "trace-deny-seed",
    });

    const admin = await issueSessionToken({
      actorId: "actor-admin-1",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin",
      rememberDevice: false,
    });

    const request = new NextRequest(
      "https://aerodelivery.onrender.com/api/internal/audit/authorization-denials?tenantId=tenant-a",
      {
        method: "GET",
        headers: {
          cookie: withSessionCookie(admin.token),
        },
      },
    );

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta.count).toBe(1);
    expect(body.data[0].traceId).toBe("trace-deny-seed");
  });

  it("denies recruiter from querying denied events", async () => {
    const recruiter = await issueSessionToken({
      actorId: "actor-rec-2",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-a",
      role: "recruiter",
      rememberDevice: false,
    });

    const request = new NextRequest(
      "https://aerodelivery.onrender.com/api/internal/audit/authorization-denials",
      {
        method: "GET",
        headers: {
          cookie: withSessionCookie(recruiter.token),
          "x-trace-id": "trace-audit-forbidden",
        },
      },
    );

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("forbidden");

    const events = await listAuthorizationDenyEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      traceId: "trace-audit-forbidden",
      reason: "forbidden_role",
      path: "/api/internal/audit/authorization-denials",
    });
  });
});