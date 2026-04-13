import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, issueSessionToken } from "@/modules/auth";
import * as authModule from "@/modules/auth";
import * as authorizationSource from "@/modules/auth/authorization";
import * as sessionSource from "@/modules/auth/session";
import {
  clearAuthorizationDenyEventsForTest,
  clearDataResidencyCheckEventsForTest,
  listAuthorizationDenyEvents,
  listDataResidencyCheckEvents,
} from "@/modules/audit";
import * as auditModule from "@/modules/audit";

import { GET } from "../route";

const ENV_KEYS = [
  "CBL_APPROVED_US_REGIONS",
  "CBL_DATA_REGION",
  "CBL_LOG_REGION",
  "CBL_BACKUP_REGION",
] as const;

type EnvSnapshot = Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

const PERSISTENCE_KEYS = [
  "CBL_FORCE_SUPABASE_FOR_TESTS",
  "CBL_SUPABASE_URL",
  "CBL_SUPABASE_SERVICE_ROLE_KEY",
  "CBL_SUPABASE_SCHEMA",
] as const;

type PersistenceSnapshot = Partial<Record<(typeof PERSISTENCE_KEYS)[number], string | undefined>>;

function withSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

function buildRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(url, init);
}

function snapshotEnv(): EnvSnapshot {
  return {
    CBL_APPROVED_US_REGIONS: process.env.CBL_APPROVED_US_REGIONS,
    CBL_DATA_REGION: process.env.CBL_DATA_REGION,
    CBL_LOG_REGION: process.env.CBL_LOG_REGION,
    CBL_BACKUP_REGION: process.env.CBL_BACKUP_REGION,
  };
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (typeof value === "undefined") {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}

describe("internal data residency compliance API", () => {
  let envSnapshot: EnvSnapshot;
  let persistenceSnapshot: PersistenceSnapshot;

  function snapshotPersistenceEnv(): PersistenceSnapshot {
    return {
      CBL_SUPABASE_URL: process.env.CBL_SUPABASE_URL,
      CBL_SUPABASE_SERVICE_ROLE_KEY: process.env.CBL_SUPABASE_SERVICE_ROLE_KEY,
      CBL_SUPABASE_SCHEMA: process.env.CBL_SUPABASE_SCHEMA,
    };
  }

  function restorePersistenceEnv(snapshot: PersistenceSnapshot): void {
    for (const key of PERSISTENCE_KEYS) {
      const value = snapshot[key];
      if (typeof value === "undefined") {
        delete process.env[key];
        continue;
      }

      process.env[key] = value;
    }
  }

  beforeEach(async () => {
    envSnapshot = snapshotEnv();
    persistenceSnapshot = snapshotPersistenceEnv();
    delete process.env.CBL_FORCE_SUPABASE_FOR_TESTS;
    delete process.env.CBL_SUPABASE_URL;
    delete process.env.CBL_SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.CBL_SUPABASE_SCHEMA;
    await clearAuthorizationDenyEventsForTest();
    await clearDataResidencyCheckEventsForTest();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    restoreEnv(envSnapshot);
    restorePersistenceEnv(persistenceSnapshot);
  });

  it("returns 401 for unauthenticated request", async () => {
    const request = buildRequest("https://aerodelivery.onrender.com/api/internal/compliance/data-residency");
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthenticated");

    const denials = await listAuthorizationDenyEvents();
    expect(denials).toHaveLength(1);
    expect(denials[0].reason).toBe("unauthenticated");
  });

  it("denies recruiter from querying residency evidence", async () => {
    const recruiter = await issueSessionToken({
      actorId: "actor-rec-1",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-a",
      role: "recruiter",
      rememberDevice: false,
    });

    const request = buildRequest(
      "https://aerodelivery.onrender.com/api/internal/compliance/data-residency",
      {
        method: "GET",
        headers: {
          cookie: withSessionCookie(recruiter.token),
          "x-trace-id": "trace-residency-forbidden",
        },
      },
    );

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("forbidden");

    const denials = await listAuthorizationDenyEvents();
    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({
      traceId: "trace-residency-forbidden",
      reason: "forbidden_role",
    });
  });

  it("returns pass evidence for compliance officer with approved US regions", async () => {
    process.env.CBL_APPROVED_US_REGIONS = "us-east-1,us-west-2";
    process.env.CBL_DATA_REGION = "us-west-2";
    process.env.CBL_LOG_REGION = "us-east-1";
    process.env.CBL_BACKUP_REGION = "us-west-2";

    const complianceOfficer = await issueSessionToken({
      actorId: "actor-comp-1",
      email: "compliance@cblsolutions.com",
      tenantId: "tenant-a",
      role: "compliance-officer",
      rememberDevice: false,
    });

    const request = buildRequest(
      "https://aerodelivery.onrender.com/api/internal/compliance/data-residency",
      {
        method: "GET",
        headers: {
          cookie: withSessionCookie(complianceOfficer.token),
          "x-trace-id": "trace-residency-pass",
        },
      },
    );

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.current.status).toBe("pass");
    expect(body.data.current.violations).toEqual([]);

    const checks = await listDataResidencyCheckEvents("tenant-a");
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      traceId: "trace-residency-pass",
      status: "pass",
      tenantId: "tenant-a",
    });
  });

  it("returns explicit failure details for non-approved region", async () => {
    process.env.CBL_APPROVED_US_REGIONS = "us-east-1,us-west-2";
    process.env.CBL_DATA_REGION = "eu-central-1";
    process.env.CBL_LOG_REGION = "us-east-1";
    process.env.CBL_BACKUP_REGION = "us-west-2";

    const admin = await issueSessionToken({
      actorId: "actor-admin-1",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin",
      rememberDevice: false,
    });

    const request = buildRequest(
      "https://aerodelivery.onrender.com/api/internal/compliance/data-residency",
      {
        method: "GET",
        headers: {
          cookie: withSessionCookie(admin.token),
          "x-trace-id": "trace-residency-fail",
        },
      },
    );

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(412);
    expect(body.error.code).toBe("data_residency_policy_failed");
    expect(body.error.message).toContain("CBL_DATA_REGION=eu-central-1");
    expect(body.error.message).toContain("approved USA regions: us-east-1, us-west-2");
    expect(body.data.current.status).toBe("fail");

    const checks = await listDataResidencyCheckEvents("tenant-a");
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      traceId: "trace-residency-fail",
      status: "fail",
    });
  });

  it("returns explicit failure details in production semantics without throwing 500", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const mockSession = {
      actorId: "actor-admin-prod-1",
      email: "admin-prod@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin" as const,
      sessionId: "session-prod-1",
      rememberDevice: false,
      issuedAtEpochSec: 1,
      expiresAtEpochSec: 2,
    };
    vi.spyOn(authModule, "validateActiveSession").mockResolvedValue(mockSession);
    vi.spyOn(authModule, "authorizeAccess").mockResolvedValue({ allowed: true });
    // Also mock source modules used by withAuth() wrapper
    vi.spyOn(sessionSource, "validateActiveSession").mockResolvedValue(mockSession);
    vi.spyOn(authorizationSource, "authorizeAccess").mockResolvedValue({ allowed: true });
    const recordSpy = vi
      .spyOn(auditModule, "recordDataResidencyCheckEvent")
      .mockRejectedValue(new Error("audit persistence unavailable"));
    const listSpy = vi
      .spyOn(auditModule, "listDataResidencyCheckEvents")
      .mockResolvedValue([]);

    process.env.CBL_APPROVED_US_REGIONS = "us-east-1,us-west-2";
    process.env.CBL_DATA_REGION = "eu-central-1";
    process.env.CBL_LOG_REGION = "us-east-1";
    process.env.CBL_BACKUP_REGION = "us-west-2";

    const request = buildRequest(
      "https://aerodelivery.onrender.com/api/internal/compliance/data-residency",
      {
        method: "GET",
        headers: {
          "x-trace-id": "trace-residency-prod-fail",
        },
      },
    );

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(412);
    expect(body.error.code).toBe("data_residency_policy_failed");
    expect(body.error.message).toContain("CBL_DATA_REGION=eu-central-1");
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).not.toHaveBeenCalled();
  });
});
