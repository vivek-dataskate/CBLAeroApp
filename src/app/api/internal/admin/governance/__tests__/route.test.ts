import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { clearAdminGovernanceStoreForTest, registerOrSyncUserFromSession } from "@/modules/admin";
import { SESSION_COOKIE_NAME, issueSessionToken } from "@/modules/auth";
import {
  clearAdminActionEventsForTest,
  clearAuthorizationDenyEventsForTest,
  clearStepUpAttemptEventsForTest,
  listAdminActionEvents,
  listAuthorizationDenyEvents,
  listStepUpAttemptEvents,
} from "@/modules/audit";

import { GET, POST } from "../route";

function withSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

function buildRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(url, init);
}

describe("internal admin governance API", () => {
  beforeEach(async () => {
    await clearAdminGovernanceStoreForTest();
    await clearAuthorizationDenyEventsForTest();
    await clearAdminActionEventsForTest();
    await clearStepUpAttemptEventsForTest();
  });

  it("returns 401 for unauthenticated governance read", async () => {
    const request = buildRequest("https://aerodelivery.onrender.com/api/internal/admin/governance");
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthenticated");

    const denials = await listAuthorizationDenyEvents();
    expect(denials).toHaveLength(1);
    expect(denials[0].reason).toBe("unauthenticated");
  });

  it("denies non-admin governance write", async () => {
    const recruiter = await issueSessionToken({
      actorId: "actor-rec-1",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-a",
      role: "recruiter",
      rememberDevice: false,
    });

    const request = buildRequest("https://aerodelivery.onrender.com/api/internal/admin/governance", {
      method: "POST",
      headers: {
        cookie: withSessionCookie(recruiter.token),
        "content-type": "application/json",
        "x-trace-id": "trace-governance-forbidden",
      },
      body: JSON.stringify({
        action: "invite_user",
        email: "new.user@cblsolutions.com",
        role: "recruiter",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("forbidden");

    const denials = await listAuthorizationDenyEvents();
    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({
      traceId: "trace-governance-forbidden",
      reason: "forbidden_role",
    });
  });

  it("creates invitation through admin governance action", async () => {
    const admin = await issueSessionToken({
      actorId: "actor-admin-1",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin",
      rememberDevice: false,
    });

    const request = buildRequest("https://aerodelivery.onrender.com/api/internal/admin/governance", {
      method: "POST",
      headers: {
        cookie: withSessionCookie(admin.token),
        "content-type": "application/json",
        "x-trace-id": "trace-governance-invite",
      },
      body: JSON.stringify({
        action: "invite_user",
        email: "invitee@cblsolutions.com",
        role: "delivery-head",
        teamIds: ["team-east"],
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.action).toBe("invite_user");
    expect(body.data.invitation.email).toBe("invitee@cblsolutions.com");
    expect(body.data.governance.invitations.length).toBe(1);

    const adminActions = await listAdminActionEvents();
    expect(adminActions).toHaveLength(1);
    expect(adminActions[0]).toMatchObject({
      traceId: "trace-governance-invite",
      actionType: "invite_user",
    });
  });

  it("rejects invalid role transition with validation error", async () => {
    const admin = await issueSessionToken({
      actorId: "actor-admin-2",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin",
      rememberDevice: false,
    });

    await registerOrSyncUserFromSession({
      sessionId: "session-actor-compliance",
      actorId: "actor-compliance",
      email: "compliance@cblsolutions.com",
      tenantId: "tenant-a",
      role: "compliance-officer",
      rememberDevice: false,
      issuedAtEpochSec: 1,
      expiresAtEpochSec: 2,
    });

    const request = buildRequest("https://aerodelivery.onrender.com/api/internal/admin/governance", {
      method: "POST",
      headers: {
        cookie: withSessionCookie(admin.token),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "assign_role",
        targetActorId: "actor-compliance",
        role: "recruiter",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_role_transition");

    const stepUpEvents = await listStepUpAttemptEvents();
    expect(stepUpEvents).toHaveLength(1);
    expect(stepUpEvents[0]).toMatchObject({
      action: "assign_role",
      outcome: "verified",
      reason: null,
    });
  });

  it("requires step-up when admin auth is stale for role assignment", async () => {
    const staleAdmin = await issueSessionToken(
      {
        actorId: "actor-admin-stale",
        email: "admin@cblsolutions.com",
        tenantId: "tenant-a",
        role: "admin",
        rememberDevice: false,
      },
      Date.now() - 15 * 60 * 1000,
    );

    await registerOrSyncUserFromSession({
      sessionId: "session-actor-target-1",
      actorId: "actor-target-1",
      email: "target@cblsolutions.com",
      tenantId: "tenant-a",
      role: "recruiter",
      rememberDevice: false,
      issuedAtEpochSec: 1,
      expiresAtEpochSec: 2,
    });

    const request = buildRequest("https://aerodelivery.onrender.com/api/internal/admin/governance", {
      method: "POST",
      headers: {
        cookie: withSessionCookie(staleAdmin.token),
        "content-type": "application/json",
        "x-trace-id": "trace-step-up-required",
      },
      body: JSON.stringify({
        action: "assign_role",
        targetActorId: "actor-target-1",
        role: "delivery-head",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(428);
    expect(body.error.code).toBe("step_up_required");
    expect(typeof body.error.reauthenticateUrl).toBe("string");

    const stepUpEvents = await listStepUpAttemptEvents();
    expect(stepUpEvents).toHaveLength(1);
    expect(stepUpEvents[0]).toMatchObject({
      traceId: "trace-step-up-required",
      action: "assign_role",
      outcome: "challenged",
      reason: "fresh_auth_required",
    });

    expect(await listAdminActionEvents()).toHaveLength(0);
  });

  it("records verified step-up attempt for successful sensitive operation", async () => {
    const admin = await issueSessionToken({
      actorId: "actor-admin-fresh",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin",
      rememberDevice: false,
    });

    await registerOrSyncUserFromSession({
      sessionId: "session-actor-target-2",
      actorId: "actor-target-2",
      email: "target2@cblsolutions.com",
      tenantId: "tenant-a",
      role: "recruiter",
      rememberDevice: false,
      issuedAtEpochSec: 1,
      expiresAtEpochSec: 2,
    });

    const request = buildRequest("https://aerodelivery.onrender.com/api/internal/admin/governance", {
      method: "POST",
      headers: {
        cookie: withSessionCookie(admin.token),
        "content-type": "application/json",
        "x-trace-id": "trace-step-up-verified",
      },
      body: JSON.stringify({
        action: "assign_role",
        targetActorId: "actor-target-2",
        role: "delivery-head",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.action).toBe("assign_role");
    expect(body.data.user.role).toBe("delivery-head");

    const stepUpEvents = await listStepUpAttemptEvents();
    expect(stepUpEvents).toHaveLength(1);
    expect(stepUpEvents[0]).toMatchObject({
      traceId: "trace-step-up-verified",
      action: "assign_role",
      outcome: "verified",
      reason: null,
    });
  });
});
