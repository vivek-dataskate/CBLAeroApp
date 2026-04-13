import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, issueSessionToken } from "@/modules/auth";
import {
  clearCandidateStoreForTest,
  seedCandidateForTest,
} from "@/features/candidate-management/infrastructure/candidate-repository";
import type { CandidateDetail } from "@/features/candidate-management/contracts/candidate";

import { GET } from "../route";

function buildRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(url, init);
}

function withSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

function makeCandidate(overrides: Partial<CandidateDetail> = {}): CandidateDetail {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    tenantId: "tenant-a",
    name: "John Smith",
    firstName: "John",
    lastName: "Smith",
    email: "john@example.com",
    phone: "5559876543",
    location: "Phoenix, AZ",
    availabilityStatus: "active",
    ingestionState: "active",
    source: "csv",
    sourceBatchId: "batch-uuid-1",
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-02-15T00:00:00.000Z",
    middleName: null,
    homePhone: null,
    workPhone: null,
    address: "123 Main St",
    city: "Phoenix",
    state: "AZ",
    country: "US",
    postalCode: "85001",
    currentCompany: "AeroTech",
    jobTitle: "A&P Mechanic",
    alternateEmail: null,
    skills: [{ name: "turbine engines" }],
    certifications: [{ type: "A&P", issuer: "FAA" }],
    experience: [{ company: "Delta", years: 5 }],
    extraAttributes: { badge_eligible: true },
    workAuthorization: null,
    clearance: null,
    aircraftExperience: [],
    employmentType: null,
    currentRate: null,
    perDiem: null,
    hasApLicense: true,
    yearsOfExperience: "15",
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

describe("GET /api/internal/candidates/[candidateId]", () => {
  beforeEach(() => {
    clearCandidateStoreForTest();
  });

  it("returns 401 for unauthenticated requests", async () => {
    const request = buildRequest(
      "https://app.cbl.aero/api/internal/candidates/some-id",
    );
    const response = await GET(request, {
      params: Promise.resolve({ candidateId: "some-id" }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthenticated");
  });

  it("allows compliance-officer to read candidate profiles", async () => {
    const candidate = makeCandidate({ id: "00000000-0000-0000-0000-000000000002" });
    seedCandidateForTest(candidate);

    const issued = await issueSessionToken({
      actorId: "actor-compliance",
      email: "compliance@cblsolutions.com",
      tenantId: "tenant-a",
      role: "compliance-officer",
      rememberDevice: false,
    });

    const response = await GET(
      buildRequest("https://app.cbl.aero/api/internal/candidates/00000000-0000-0000-0000-000000000002", {
        headers: { cookie: withSessionCookie(issued.token) },
      }),
      { params: Promise.resolve({ candidateId: "00000000-0000-0000-0000-000000000002" }) },
    );

    expect(response.status).toBe(200);
  });

  it("returns full candidate detail for authenticated recruiter", async () => {
    const candidate = makeCandidate();
    seedCandidateForTest(candidate);

    const issued = await issueSessionToken({
      actorId: "actor-recruiter",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-a",
      role: "recruiter",
      rememberDevice: false,
    });

    const response = await GET(
      buildRequest("https://app.cbl.aero/api/internal/candidates/00000000-0000-0000-0000-000000000001", {
        headers: { cookie: withSessionCookie(issued.token) },
      }),
      { params: Promise.resolve({ candidateId: "00000000-0000-0000-0000-000000000001" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(body.data.name).toBe("John Smith");
    expect(body.data.jobTitle).toBe("A&P Mechanic");
    expect(body.data.source).toBe("csv");
    expect(body.data.sourceBatchId).toBe("batch-uuid-1");
    expect(body.data.ingestionState).toBe("active");
    expect(body.data.createdAt).toBe("2026-01-15T00:00:00.000Z");
    expect(body.data.updatedAt).toBe("2026-02-15T00:00:00.000Z");
    expect(Array.isArray(body.data.skills)).toBe(true);
    expect(Array.isArray(body.data.certifications)).toBe(true);
    expect(Array.isArray(body.data.experience)).toBe(true);
    expect(body.meta.tenantId).toBe("tenant-a");
    expect(body.meta.readScope).toBe("tenant-isolated");
  });

  it("returns 404 when candidate id not found", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-recruiter-missing",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-a",
      role: "recruiter",
      rememberDevice: false,
    });

    const response = await GET(
      buildRequest("https://app.cbl.aero/api/internal/candidates/00000000-0000-0000-0000-000000000099", {
        headers: { cookie: withSessionCookie(issued.token) },
      }),
      { params: Promise.resolve({ candidateId: "00000000-0000-0000-0000-000000000099" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("returns 404 for cross-tenant access (tenant isolation)", async () => {
    const candidate = makeCandidate({ tenantId: "tenant-a" });
    seedCandidateForTest(candidate);

    const issued = await issueSessionToken({
      actorId: "actor-recruiter-b",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-b",
      role: "recruiter",
      rememberDevice: false,
    });

    const response = await GET(
      buildRequest("https://app.cbl.aero/api/internal/candidates/00000000-0000-0000-0000-000000000001", {
        headers: { cookie: withSessionCookie(issued.token) },
      }),
      { params: Promise.resolve({ candidateId: "00000000-0000-0000-0000-000000000001" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("returns extra_attributes in detail response", async () => {
    const candidate = makeCandidate({ extraAttributes: { badge_eligible: true, faa_verified: false } });
    seedCandidateForTest(candidate);

    const issued = await issueSessionToken({
      actorId: "actor-admin-detail",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin",
      rememberDevice: false,
    });

    const response = await GET(
      buildRequest("https://app.cbl.aero/api/internal/candidates/00000000-0000-0000-0000-000000000001", {
        headers: { cookie: withSessionCookie(issued.token) },
      }),
      { params: Promise.resolve({ candidateId: "00000000-0000-0000-0000-000000000001" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.extraAttributes).toEqual({ badge_eligible: true, faa_verified: false });
  });
});
