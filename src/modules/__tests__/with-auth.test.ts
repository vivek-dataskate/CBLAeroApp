import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { clearAdminGovernanceStoreForTest } from "../admin";
import { issueSessionToken } from "../auth";
import { withAuth, type AuthenticatedContext } from "../auth/with-auth";
import {
  clearAuthorizationDenyEventsForTest,
  listAuthorizationDenyEvents,
} from "../audit";

function makeRequest(path: string, method = "GET", headers?: Record<string, string>): NextRequest {
  const url = `http://localhost:3000${path}`;
  return new NextRequest(url, {
    method,
    headers: {
      ...headers,
    },
  });
}

function makeRequestWithCookie(
  path: string,
  token: string,
  method = "GET",
  headers?: Record<string, string>,
): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      cookie: `cbl_session=${token}`,
      ...headers,
    },
  });
}

describe("withAuth middleware wrapper", () => {
  beforeEach(async () => {
    await clearAdminGovernanceStoreForTest();
    await clearAuthorizationDenyEventsForTest();
  });

  it("passes authenticated session to handler for valid session with correct role", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-1",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-a",
      role: "recruiter",
      rememberDevice: false,
    });

    let capturedCtx: AuthenticatedContext | null = null;
    const handler = withAuth(async (ctx) => {
      capturedCtx = ctx;
      return NextResponse.json({ data: { ok: true } });
    }, { action: "candidate:read" });

    const request = makeRequestWithCookie("/api/internal/candidates", issued.token);
    const response = await handler(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.ok).toBe(true);
    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx!.session.actorId).toBe("actor-1");
    expect(capturedCtx!.session.tenantId).toBe("tenant-a");
    expect(capturedCtx!.session.role).toBe("recruiter");
    expect(capturedCtx!.traceId).toBeTruthy();
  });

  it("returns 401 with standard error envelope when no session token", async () => {
    const handler = withAuth(async () => {
      return NextResponse.json({ data: { ok: true } });
    }, { action: "candidate:read" });

    const request = makeRequest("/api/internal/candidates");
    const response = await handler(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthenticated");
    expect(body.error.message).toContain("Access denied");
  });

  it("returns 401 and records audit event for invalid session token", async () => {
    const handler = withAuth(async () => {
      return NextResponse.json({ data: { ok: true } });
    }, { action: "candidate:read" });

    const request = makeRequestWithCookie("/api/internal/candidates", "invalid-token-value");
    const response = await handler(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthenticated");

    const denyEvents = await listAuthorizationDenyEvents();
    expect(denyEvents.length).toBeGreaterThanOrEqual(1);
    expect(denyEvents[0].reason).toBe("unauthenticated");
  });

  it("returns 403 when session role lacks permission for the action", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-2",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-a",
      role: "recruiter",
      rememberDevice: false,
    });

    const handler = withAuth(async () => {
      return NextResponse.json({ data: { ok: true } });
    }, { action: "admin:manage-users" });

    const request = makeRequestWithCookie("/api/internal/admin/governance", issued.token, "POST");
    const response = await handler(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("forbidden");

    const denyEvents = await listAuthorizationDenyEvents();
    expect(denyEvents.length).toBeGreaterThanOrEqual(1);
    expect(denyEvents.some((e: { reason: string }) => e.reason === "forbidden_role")).toBe(true);
  });

  it("uses x-trace-id header when provided", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-3",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin",
      rememberDevice: false,
    });

    let capturedTraceId = "";
    const handler = withAuth(async (ctx) => {
      capturedTraceId = ctx.traceId;
      return NextResponse.json({ data: { ok: true } });
    }, { action: "candidate:read" });

    const request = makeRequestWithCookie(
      "/api/internal/candidates",
      issued.token,
      "GET",
      { "x-trace-id": "custom-trace-123" },
    );
    await handler(request);

    expect(capturedTraceId).toBe("custom-trace-123");
  });

  it("generates a trace ID when x-trace-id header is absent", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-4",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin",
      rememberDevice: false,
    });

    let capturedTraceId = "";
    const handler = withAuth(async (ctx) => {
      capturedTraceId = ctx.traceId;
      return NextResponse.json({ data: { ok: true } });
    }, { action: "candidate:read" });

    const request = makeRequestWithCookie("/api/internal/candidates", issued.token);
    await handler(request);

    expect(capturedTraceId).toBeTruthy();
    // Should look like a UUID
    expect(capturedTraceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reads requestedTenantId from x-active-client-id header", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-5",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      clientIds: ["tenant-a", "tenant-b"],
      role: "admin",
      rememberDevice: false,
    });

    let capturedSession: AuthenticatedContext["session"] | null = null;
    const handler = withAuth(async (ctx) => {
      capturedSession = ctx.session;
      return NextResponse.json({ data: { ok: true } });
    }, { action: "candidate:read" });

    const request = makeRequestWithCookie(
      "/api/internal/candidates",
      issued.token,
      "GET",
      { "x-active-client-id": "tenant-b" },
    );
    const response = await handler(request);

    expect(response.status).toBe(200);
    expect(capturedSession).not.toBeNull();
  });

  it("returns 403 for cross-tenant request with disallowed tenant", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-6",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-a",
      role: "recruiter",
      rememberDevice: false,
    });

    const handler = withAuth(async () => {
      return NextResponse.json({ data: { ok: true } });
    }, { action: "candidate:read" });

    const request = makeRequestWithCookie(
      "/api/internal/candidates",
      issued.token,
      "GET",
      { "x-active-client-id": "tenant-other" },
    );
    const response = await handler(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("tenant_forbidden");
  });

  it("resolves route params from context and passes to handler", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-7",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin",
      rememberDevice: false,
    });

    let capturedParams: { candidateId: string } | null = null;
    const handler = withAuth<{ candidateId: string }>(async (ctx) => {
      capturedParams = ctx.params;
      return NextResponse.json({ data: { ok: true } });
    }, { action: "candidate:read" });

    const request = makeRequestWithCookie(
      "/api/internal/candidates/cand-123",
      issued.token,
    );
    const response = await handler(request, {
      params: Promise.resolve({ candidateId: "cand-123" }),
    });

    expect(response.status).toBe(200);
    expect(capturedParams).toEqual({ candidateId: "cand-123" });
  });

  it("does not call handler when auth fails", async () => {
    let handlerCalled = false;
    const handler = withAuth(async () => {
      handlerCalled = true;
      return NextResponse.json({ data: { ok: true } });
    }, { action: "candidate:read" });

    const request = makeRequest("/api/internal/candidates");
    await handler(request);

    expect(handlerCalled).toBe(false);
  });
});
