import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { clearAdminGovernanceStoreForTest } from "@/modules/admin";
import { SESSION_COOKIE_NAME, issueSessionToken } from "@/modules/auth";
import {
  clearAuthorizationDenyEventsForTest,
  clearClientContextConfirmationEventsForTest,
  clearStepUpAttemptEventsForTest,
  listAuthorizationDenyEvents,
  listClientContextConfirmationEvents,
  listStepUpAttemptEvents,
} from "@/modules/audit";
import {
  clearCandidateStoreForTest,
  seedCandidateForTest,
} from "@/features/candidate-management/infrastructure/candidate-repository";
import type { CandidateDetail } from "@/features/candidate-management/contracts/candidate";

import { GET, POST } from "../route";

function makeCandidateFixture(overrides: Partial<CandidateDetail> = {}): CandidateDetail {
  return {
    id: crypto.randomUUID(),
    tenantId: "tenant-a",
    name: "Test Candidate",
    firstName: "Test",
    lastName: "Candidate",
    email: "test@example.com",
    phone: "5550000001",
    location: "Houston, TX",
    availabilityStatus: "active",
    ingestionState: "active",
    source: "csv",
    sourceBatchId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    middleName: null,
    homePhone: null,
    workPhone: null,
    address: null,
    city: null,
    state: null,
    country: null,
    postalCode: null,
    currentCompany: null,
    jobTitle: null,
    alternateEmail: null,
    skills: [],
    certifications: [],
    experience: [],
    extraAttributes: {},
    workAuthorization: null,
    clearance: null,
    aircraftExperience: [],
    employmentType: null,
    currentRate: null,
    perDiem: null,
    hasApLicense: null,
    yearsOfExperience: null,
    ceipalId: null,
    submittedBy: null,
    submitterEmail: null,
    shiftPreference: null,
    expectedStartDate: null,
    callAvailability: null,
    interviewAvailability: null,
    veteranStatus: null,
    resumeUrl: null,
    linkedinUrl: null,
    deducedRoles: [],
    availabilityLastSignalAt: null,
    ...overrides,
  };
}

function buildRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(url, init);
}

function withSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

describe("internal candidates API authorization", () => {
  beforeEach(async () => {
    await clearAdminGovernanceStoreForTest();
    await clearAuthorizationDenyEventsForTest();
    await clearClientContextConfirmationEventsForTest();
    await clearStepUpAttemptEventsForTest();
    clearCandidateStoreForTest();
  });

  it("returns 401 for unauthenticated requests", async () => {
    const request = buildRequest("https://aerodelivery.onrender.com/api/internal/candidates");
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthenticated");

    const events = await listAuthorizationDenyEvents();
    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe("unauthenticated");
  });

  it("returns 401 before parsing malformed write body when unauthenticated", async () => {
    const request = buildRequest("https://aerodelivery.onrender.com/api/internal/candidates", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "{",
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthenticated");

    const events = await listAuthorizationDenyEvents();
    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe("unauthenticated");
    expect(events[0].method).toBe("POST");
  });

  it("allows role-permitted tenant read with required filter", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-admin",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin",
      rememberDevice: false,
    });

    const request = buildRequest(
      "https://aerodelivery.onrender.com/api/internal/candidates?tenantId=tenant-a&availability_status=active",
      {
        method: "GET",
        headers: {
          cookie: withSessionCookie(issued.token),
        },
      },
    );

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta.tenantId).toBe("tenant-a");
    expect(Array.isArray(body.data)).toBe(true);
    expect(await listAuthorizationDenyEvents()).toHaveLength(0);
  });

  it("returns 400 when no pre-filter is provided", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-admin-nofilter",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin",
      rememberDevice: false,
    });

    const request = buildRequest(
      "https://aerodelivery.onrender.com/api/internal/candidates?tenantId=tenant-a",
      {
        method: "GET",
        headers: { cookie: withSessionCookie(issued.token) },
      },
    );

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("filter_required");
  });

  it("returns paginated candidate list with nextCursor when more results exist", async () => {
    for (let i = 1; i <= 4; i++) {
      seedCandidateForTest(
        makeCandidateFixture({ id: `00000000-0000-0000-0000-00000000000${i}`, tenantId: "tenant-a", availabilityStatus: "active" }),
      );
    }

    const issued = await issueSessionToken({
      actorId: "actor-admin-paginate",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin",
      rememberDevice: false,
    });

    const response = await GET(
      buildRequest(
        "https://aerodelivery.onrender.com/api/internal/candidates?availability_status=active&limit=2",
        { headers: { cookie: withSessionCookie(issued.token) } },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.meta.nextCursor).not.toBeNull();
  });

  it("denies cross-tenant access attempts", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-admin-2",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin",
      rememberDevice: false,
    });

    const request = buildRequest(
      "https://aerodelivery.onrender.com/api/internal/candidates?tenantId=tenant-b",
      {
        method: "GET",
        headers: {
          cookie: withSessionCookie(issued.token),
          "x-trace-id": "trace-cross-tenant",
        },
      },
    );

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("tenant_forbidden");

    const events = await listAuthorizationDenyEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      traceId: "trace-cross-tenant",
      reason: "tenant_mismatch",
      requestedTenantId: "tenant-b",
      sessionTenantId: "tenant-a",
    });
  });

  it("allows recruiter write operations by role", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-rec",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-a",
      role: "recruiter",
      rememberDevice: false,
    });

    const request = buildRequest("https://aerodelivery.onrender.com/api/internal/candidates", {
      method: "POST",
      headers: {
        cookie: withSessionCookie(issued.token),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tenantId: "tenant-a",
        activeClientId: "tenant-a",
        candidateIds: ["cand-1", "cand-2"],
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.updated).toBe(2);
    expect(body.data.tenantId).toBe("tenant-a");
    expect(body.meta.activeClientId).toBe("tenant-a");
    expect(body.meta.targetClientId).toBe("tenant-a");
    expect(await listAuthorizationDenyEvents()).toHaveLength(0);
  });

  it("requires step-up for stale communication-history reads", async () => {
    const staleIssued = await issueSessionToken(
      {
        actorId: "actor-admin-stale-read",
        email: "admin@cblsolutions.com",
        tenantId: "tenant-a",
        role: "admin",
        rememberDevice: false,
      },
      Date.now() - 10 * 60 * 1000,
    );

    const request = buildRequest(
      "https://aerodelivery.onrender.com/api/internal/candidates?tenantId=tenant-a&view=communication-history",
      {
        method: "GET",
        headers: {
          cookie: withSessionCookie(staleIssued.token),
          "x-trace-id": "trace-stepup-read-challenged",
        },
      },
    );

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(428);
    expect(body.error.code).toBe("step_up_required");
    expect(typeof body.error.reauthenticateUrl).toBe("string");

    const events = await listStepUpAttemptEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      traceId: "trace-stepup-read-challenged",
      action: "candidate:communication-history-access",
      outcome: "challenged",
      reason: "fresh_auth_required",
    });
  });

  it("allows fresh communication-history reads and records verified step-up", async () => {
    const freshIssued = await issueSessionToken({
      actorId: "actor-admin-fresh-read",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin",
      rememberDevice: false,
    });

    const request = buildRequest(
      "https://aerodelivery.onrender.com/api/internal/candidates?tenantId=tenant-a&includeCommunicationHistory=true&availability_status=active",
      {
        method: "GET",
        headers: {
          cookie: withSessionCookie(freshIssued.token),
          "x-trace-id": "trace-stepup-read-verified",
        },
      },
    );

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);

    const events = await listStepUpAttemptEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      traceId: "trace-stepup-read-verified",
      action: "candidate:communication-history-access",
      outcome: "verified",
      reason: null,
    });
  });

  it("requires step-up for stale export writes", async () => {
    const staleIssued = await issueSessionToken(
      {
        actorId: "actor-admin-stale-export",
        email: "admin@cblsolutions.com",
        tenantId: "tenant-a",
        role: "admin",
        rememberDevice: false,
      },
      Date.now() - 10 * 60 * 1000,
    );

    const request = buildRequest("https://aerodelivery.onrender.com/api/internal/candidates", {
      method: "POST",
      headers: {
        cookie: withSessionCookie(staleIssued.token),
        "content-type": "application/json",
        "x-trace-id": "trace-stepup-export-challenged",
      },
      body: JSON.stringify({
        tenantId: "tenant-a",
        activeClientId: "tenant-a",
        action: "export",
        format: "csv",
        candidateIds: ["cand-1", "cand-2"],
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(428);
    expect(body.error.code).toBe("step_up_required");

    const events = await listStepUpAttemptEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      traceId: "trace-stepup-export-challenged",
      action: "candidate:data-export",
      outcome: "challenged",
      reason: "fresh_auth_required",
    });
  });

  it("allows fresh export writes and records verified step-up", async () => {
    const freshIssued = await issueSessionToken({
      actorId: "actor-admin-fresh-export",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin",
      rememberDevice: false,
    });

    const request = buildRequest("https://aerodelivery.onrender.com/api/internal/candidates", {
      method: "POST",
      headers: {
        cookie: withSessionCookie(freshIssued.token),
        "content-type": "application/json",
        "x-trace-id": "trace-stepup-export-verified",
      },
      body: JSON.stringify({
        tenantId: "tenant-a",
        activeClientId: "tenant-a",
        action: "export",
        format: "csv",
        candidateIds: ["cand-3"],
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("queued");
    expect(body.data.format).toBe("csv");
    expect(body.data.candidateCount).toBe(1);
    expect(body.meta.activeClientId).toBe("tenant-a");
    expect(body.meta.targetClientId).toBe("tenant-a");

    const events = await listStepUpAttemptEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      traceId: "trace-stepup-export-verified",
      action: "candidate:data-export",
      outcome: "verified",
      reason: null,
    });
  });

  it("requires explicit confirmation for cross-client exports", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-delivery-cross",
      email: "delivery@cblsolutions.com",
      tenantId: "tenant-a",
      clientIds: ["tenant-a", "tenant-b"],
      role: "delivery-head",
      rememberDevice: false,
    });

    const request = buildRequest("https://aerodelivery.onrender.com/api/internal/candidates", {
      method: "POST",
      headers: {
        cookie: withSessionCookie(issued.token),
        "content-type": "application/json",
        "x-trace-id": "trace-cross-client-confirm-required",
      },
      body: JSON.stringify({
        tenantId: "tenant-b",
        activeClientId: "tenant-a",
        action: "export",
        format: "csv",
        candidateIds: ["cand-b-1"],
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("cross_client_confirmation_required");
    expect(body.error.activeClientId).toBe("tenant-a");
    expect(body.error.targetClientId).toBe("tenant-b");

    const confirmationEvents = await listClientContextConfirmationEvents();
    expect(confirmationEvents).toHaveLength(1);
    expect(confirmationEvents[0]).toMatchObject({
      traceId: "trace-cross-client-confirm-required",
      activeClientId: "tenant-a",
      targetClientId: "tenant-b",
      outcome: "required",
      action: "candidate:data-export",
    });
  });

  it("allows confirmed cross-client exports for authorized multi-client actors", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-delivery-cross-confirmed",
      email: "delivery@cblsolutions.com",
      tenantId: "tenant-a",
      clientIds: ["tenant-a", "tenant-b"],
      role: "delivery-head",
      rememberDevice: false,
    });

    const firstRequest = buildRequest("https://aerodelivery.onrender.com/api/internal/candidates", {
      method: "POST",
      headers: {
        cookie: withSessionCookie(issued.token),
        "content-type": "application/json",
        "x-trace-id": "trace-cross-client-confirmed-initial",
      },
      body: JSON.stringify({
        tenantId: "tenant-b",
        activeClientId: "tenant-a",
        action: "export",
        format: "json",
        candidateIds: ["cand-b-2", "cand-b-3"],
      }),
    });

    const firstResponse = await POST(firstRequest);
    const firstBody = await firstResponse.json();

    expect(firstResponse.status).toBe(409);
    expect(firstBody.error.code).toBe("cross_client_confirmation_required");
    expect(typeof firstBody.error.confirmationToken).toBe("string");

    const request = buildRequest("https://aerodelivery.onrender.com/api/internal/candidates", {
      method: "POST",
      headers: {
        cookie: withSessionCookie(issued.token),
        "content-type": "application/json",
        "x-trace-id": "trace-cross-client-confirmed",
      },
      body: JSON.stringify({
        tenantId: "tenant-b",
        activeClientId: "tenant-a",
        crossClientConfirmationToken: firstBody.error.confirmationToken,
        action: "export",
        format: "json",
        candidateIds: ["cand-b-2", "cand-b-3"],
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.tenantId).toBe("tenant-b");
    expect(body.data.format).toBe("json");
    expect(body.meta.activeClientId).toBe("tenant-a");
    expect(body.meta.targetClientId).toBe("tenant-b");

    const confirmationEvents = await listClientContextConfirmationEvents();
    expect(confirmationEvents).toHaveLength(2);
    const confirmedEvent = confirmationEvents.find((event) => event.outcome === "confirmed");
    expect(confirmedEvent).toMatchObject({
      traceId: "trace-cross-client-confirmed",
      activeClientId: "tenant-a",
      targetClientId: "tenant-b",
      outcome: "confirmed",
      action: "candidate:data-export",
    });
  });

  it("rejects invalid cross-client confirmation token", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-delivery-cross-invalid-token",
      email: "delivery@cblsolutions.com",
      tenantId: "tenant-a",
      clientIds: ["tenant-a", "tenant-b"],
      role: "delivery-head",
      rememberDevice: false,
    });

    const request = buildRequest("https://aerodelivery.onrender.com/api/internal/candidates", {
      method: "POST",
      headers: {
        cookie: withSessionCookie(issued.token),
        "content-type": "application/json",
        "x-trace-id": "trace-cross-client-invalid-token",
      },
      body: JSON.stringify({
        tenantId: "tenant-b",
        activeClientId: "tenant-a",
        crossClientConfirmationToken: "not-a-valid-token",
        action: "export",
        format: "csv",
        candidateIds: ["cand-b-5"],
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("cross_client_confirmation_required");
    expect(typeof body.error.confirmationToken).toBe("string");

    const confirmationEvents = await listClientContextConfirmationEvents();
    expect(confirmationEvents).toHaveLength(1);
    expect(confirmationEvents[0]).toMatchObject({
      traceId: "trace-cross-client-invalid-token",
      activeClientId: "tenant-a",
      targetClientId: "tenant-b",
      outcome: "required",
      action: "candidate:data-export",
    });
  });

  it("rejects confirmation tokens when request intent drifts", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-delivery-cross-intent-drift",
      email: "delivery@cblsolutions.com",
      tenantId: "tenant-a",
      clientIds: ["tenant-a", "tenant-b"],
      role: "delivery-head",
      rememberDevice: false,
    });

    const challengeRequest = buildRequest(
      "https://aerodelivery.onrender.com/api/internal/candidates",
      {
        method: "POST",
        headers: {
          cookie: withSessionCookie(issued.token),
          "content-type": "application/json",
          "x-trace-id": "trace-cross-client-intent-drift-initial",
        },
        body: JSON.stringify({
          tenantId: "tenant-b",
          activeClientId: "tenant-a",
          action: "export",
          format: "csv",
          candidateIds: ["cand-b-10"],
        }),
      },
    );

    const challengeResponse = await POST(challengeRequest);
    const challengeBody = await challengeResponse.json();

    expect(challengeResponse.status).toBe(409);
    expect(challengeBody.error.code).toBe("cross_client_confirmation_required");
    expect(typeof challengeBody.error.confirmationToken).toBe("string");

    const mismatchedConfirmRequest = buildRequest(
      "https://aerodelivery.onrender.com/api/internal/candidates",
      {
        method: "POST",
        headers: {
          cookie: withSessionCookie(issued.token),
          "content-type": "application/json",
          "x-trace-id": "trace-cross-client-intent-drift-mismatch",
        },
        body: JSON.stringify({
          tenantId: "tenant-b",
          activeClientId: "tenant-a",
          crossClientConfirmationToken: challengeBody.error.confirmationToken,
          action: "export",
          format: "json",
          candidateIds: ["cand-b-10"],
        }),
      },
    );

    const mismatchedConfirmResponse = await POST(mismatchedConfirmRequest);
    const mismatchedConfirmBody = await mismatchedConfirmResponse.json();

    expect(mismatchedConfirmResponse.status).toBe(409);
    expect(mismatchedConfirmBody.error.code).toBe("cross_client_confirmation_required");
  });

  it("rejects replayed cross-client confirmation tokens", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-delivery-cross-replay",
      email: "delivery@cblsolutions.com",
      tenantId: "tenant-a",
      clientIds: ["tenant-a", "tenant-b"],
      role: "delivery-head",
      rememberDevice: false,
    });

    const challengeRequest = buildRequest(
      "https://aerodelivery.onrender.com/api/internal/candidates",
      {
        method: "POST",
        headers: {
          cookie: withSessionCookie(issued.token),
          "content-type": "application/json",
          "x-trace-id": "trace-cross-client-replay-initial",
        },
        body: JSON.stringify({
          tenantId: "tenant-b",
          activeClientId: "tenant-a",
          action: "export",
          format: "csv",
          candidateIds: ["cand-b-6"],
        }),
      },
    );

    const challengeResponse = await POST(challengeRequest);
    const challengeBody = await challengeResponse.json();

    expect(challengeResponse.status).toBe(409);
    expect(typeof challengeBody.error.confirmationToken).toBe("string");

    const token = challengeBody.error.confirmationToken as string;

    const confirmRequest = buildRequest(
      "https://aerodelivery.onrender.com/api/internal/candidates",
      {
        method: "POST",
        headers: {
          cookie: withSessionCookie(issued.token),
          "content-type": "application/json",
          "x-trace-id": "trace-cross-client-replay-confirmed",
        },
        body: JSON.stringify({
          tenantId: "tenant-b",
          activeClientId: "tenant-a",
          crossClientConfirmationToken: token,
          action: "export",
          format: "csv",
          candidateIds: ["cand-b-6"],
        }),
      },
    );

    const confirmResponse = await POST(confirmRequest);
    expect(confirmResponse.status).toBe(200);

    const replayRequest = buildRequest(
      "https://aerodelivery.onrender.com/api/internal/candidates",
      {
        method: "POST",
        headers: {
          cookie: withSessionCookie(issued.token),
          "content-type": "application/json",
          "x-trace-id": "trace-cross-client-replay-reused",
        },
        body: JSON.stringify({
          tenantId: "tenant-b",
          activeClientId: "tenant-a",
          crossClientConfirmationToken: token,
          action: "export",
          format: "csv",
          candidateIds: ["cand-b-7"],
        }),
      },
    );

    const replayResponse = await POST(replayRequest);
    const replayBody = await replayResponse.json();

    expect(replayResponse.status).toBe(409);
    expect(replayBody.error.code).toBe("cross_client_confirmation_required");
  });

  it("allows active client selection when client is authorized", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-delivery-active-selection",
      email: "delivery@cblsolutions.com",
      tenantId: "tenant-a",
      clientIds: ["tenant-a", "tenant-b"],
      role: "delivery-head",
      rememberDevice: false,
    });

    const request = buildRequest("https://aerodelivery.onrender.com/api/internal/candidates", {
      method: "POST",
      headers: {
        cookie: withSessionCookie(issued.token),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tenantId: "tenant-b",
        activeClientId: "tenant-b",
        candidateIds: ["cand-a-1"],
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta.activeClientId).toBe("tenant-b");
    expect(body.meta.targetClientId).toBe("tenant-b");
    expect(await listClientContextConfirmationEvents()).toHaveLength(0);
  });

  it("rejects unauthorized active client identifiers in request scope", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-delivery-active-mismatch",
      email: "delivery@cblsolutions.com",
      tenantId: "tenant-a",
      clientIds: ["tenant-a", "tenant-b"],
      role: "delivery-head",
      rememberDevice: false,
    });

    const request = buildRequest("https://aerodelivery.onrender.com/api/internal/candidates", {
      method: "POST",
      headers: {
        cookie: withSessionCookie(issued.token),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tenantId: "tenant-b",
        activeClientId: "tenant-c",
        candidateIds: ["cand-b-4"],
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("active_client_forbidden");
    expect(await listClientContextConfirmationEvents()).toHaveLength(0);
  });
});