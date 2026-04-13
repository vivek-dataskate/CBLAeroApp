import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, issueSessionToken } from "@/modules/auth";
import {
  clearAuthorizationDenyEventsForTest,
  clearImportBatchAccessEventsForTest,
  listAuthorizationDenyEvents,
} from "@/modules/audit";
import { clearAdminGovernanceStoreForTest } from "@/modules/admin";

import { GET } from "../route";
import {
  GET as GETDetail,
  seedImportBatchDetailErrorsForTest,
  clearImportBatchDetailForTest,
} from "../[batchId]/route";
import {
  seedImportBatchForTest as seedBatchRepo,
  clearImportBatchStoreForTest,
} from "@/features/candidate-management/infrastructure/import-batch-repository";

// Adapter: tests use snake_case batch data, repository expects camelCase ImportBatch
function seedImportBatchForTest(row: {
  id: string;
  tenant_id: string;
  source: string;
  status: string;
  total_rows: number;
  imported: number;
  skipped: number;
  errors: number;
  error_threshold_pct: number;
  created_by_actor_id: string | null;
  started_at: string;
  completed_at: string | null;
}) {
  seedBatchRepo({
    id: row.id,
    tenantId: row.tenant_id,
    source: row.source,
    status: row.status,
    totalRows: row.total_rows,
    imported: row.imported,
    skipped: row.skipped,
    errors: row.errors,
    errorThresholdPct: row.error_threshold_pct,
    createdByActorId: row.created_by_actor_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  });
}

function clearImportBatchesForTest() {
  clearImportBatchStoreForTest();
}

function buildRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(url, init);
}

function withSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

const BASE_URL = "https://aerodelivery.onrender.com";

const SAMPLE_BATCH = {
  id: "batch-uuid-001",
  tenant_id: "tenant-alpha",
  source: "migration" as const,
  status: "complete" as const,
  total_rows: 2000,
  imported: 1980,
  skipped: 0,
  errors: 20,
  error_threshold_pct: 5,
  created_by_actor_id: "actor-admin-1",
  started_at: "2026-03-30T10:00:00.000Z",
  completed_at: "2026-03-30T12:00:00.000Z",
};

describe("GET /api/internal/admin/import-batches", () => {
  beforeEach(async () => {
    clearImportBatchesForTest();
    clearImportBatchDetailForTest();
    await clearAuthorizationDenyEventsForTest();
    await clearImportBatchAccessEventsForTest();
    await clearAdminGovernanceStoreForTest();
  });

  it("returns 401 for unauthenticated requests", async () => {
    const request = buildRequest(`${BASE_URL}/api/internal/admin/import-batches`);
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthenticated");

    const events = await listAuthorizationDenyEvents();
    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe("unauthenticated");
  });

  it("returns 403 for non-admin roles (recruiter)", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-recruiter-1",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "recruiter",
      rememberDevice: false,
    });

    const request = buildRequest(`${BASE_URL}/api/internal/admin/import-batches`, {
      headers: { cookie: withSessionCookie(issued.token) },
    });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("forbidden");

    const events = await listAuthorizationDenyEvents();
    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe("forbidden_role");
  });

  it("returns 403 for compliance-officer role", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-compliance-1",
      email: "compliance@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "compliance-officer",
      rememberDevice: false,
    });

    const request = buildRequest(`${BASE_URL}/api/internal/admin/import-batches`, {
      headers: { cookie: withSessionCookie(issued.token) },
    });
    const response = await GET(request);

    expect(response.status).toBe(403);
  });

  it("returns empty list for admin with no batches", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-admin-1",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "admin",
      rememberDevice: false,
    });

    const request = buildRequest(`${BASE_URL}/api/internal/admin/import-batches`, {
      headers: { cookie: withSessionCookie(issued.token) },
    });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  it("returns seeded batches scoped to admin tenant", async () => {
    seedImportBatchForTest(SAMPLE_BATCH);
    // Batch for different tenant — should not appear
    seedImportBatchForTest({ ...SAMPLE_BATCH, id: "batch-other", tenant_id: "tenant-other" });

    const issued = await issueSessionToken({
      actorId: "actor-admin-1",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "admin",
      rememberDevice: false,
    });

    const request = buildRequest(`${BASE_URL}/api/internal/admin/import-batches`, {
      headers: { cookie: withSessionCookie(issued.token) },
    });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("batch-uuid-001");
    expect(body.data[0].status).toBe("complete");
    expect(body.data[0].imported).toBe(1980);
    expect(body.data[0].totalRows).toBe(2000);
    expect(body.data[0].errors).toBe(20);
    expect(typeof body.data[0].elapsedMs).toBe("number");
    expect(body.meta.total).toBe(1);
  });

  it("includes non-null elapsedMs for completed batch", async () => {
    seedImportBatchForTest(SAMPLE_BATCH);

    const issued = await issueSessionToken({
      actorId: "actor-admin-1",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "admin",
      rememberDevice: false,
    });

    const request = buildRequest(`${BASE_URL}/api/internal/admin/import-batches`, {
      headers: { cookie: withSessionCookie(issued.token) },
    });
    const response = await GET(request);
    const body = await response.json();

    expect(body.data[0].elapsedMs).toBe(
      new Date("2026-03-30T12:00:00.000Z").getTime() -
        new Date("2026-03-30T10:00:00.000Z").getTime(),
    );
  });

  it("returns live elapsedMs for in-progress batch", async () => {
    seedImportBatchForTest({ ...SAMPLE_BATCH, status: "running", completed_at: null });

    const issued = await issueSessionToken({
      actorId: "actor-admin-1",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "admin",
      rememberDevice: false,
    });

    const request = buildRequest(`${BASE_URL}/api/internal/admin/import-batches`, {
      headers: { cookie: withSessionCookie(issued.token) },
    });
    const response = await GET(request);
    const body = await response.json();

    expect(typeof body.data[0].elapsedMs).toBe("number");
    expect(body.data[0].elapsedMs).toBeGreaterThan(0);
  });
});

describe("GET /api/internal/admin/import-batches/[batchId]", () => {
  beforeEach(async () => {
    clearImportBatchesForTest();
    clearImportBatchDetailForTest();
    await clearAuthorizationDenyEventsForTest();
    await clearImportBatchAccessEventsForTest();
    await clearAdminGovernanceStoreForTest();
  });

  it("returns 401 for unauthenticated requests", async () => {
    const request = buildRequest(
      `${BASE_URL}/api/internal/admin/import-batches/batch-uuid-001`,
    );
    const response = await GETDetail(request, {
      params: Promise.resolve({ batchId: "batch-uuid-001" }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthenticated");
  });

  it("returns 403 for non-admin role", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-recruiter-1",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "recruiter",
      rememberDevice: false,
    });

    const request = buildRequest(
      `${BASE_URL}/api/internal/admin/import-batches/batch-uuid-001`,
      { headers: { cookie: withSessionCookie(issued.token) } },
    );
    const response = await GETDetail(request, {
      params: Promise.resolve({ batchId: "batch-uuid-001" }),
    });

    expect(response.status).toBe(403);
  });

  it("returns 404 when batch not found for tenant", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-admin-1",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "admin",
      rememberDevice: false,
    });

    const request = buildRequest(
      `${BASE_URL}/api/internal/admin/import-batches/nonexistent`,
      { headers: { cookie: withSessionCookie(issued.token) } },
    );
    const response = await GETDetail(request, {
      params: Promise.resolve({ batchId: "nonexistent" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns 404 when batch belongs to different tenant", async () => {
    seedImportBatchForTest({ ...SAMPLE_BATCH, tenant_id: "tenant-other" });

    const issued = await issueSessionToken({
      actorId: "actor-admin-1",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "admin",
      rememberDevice: false,
    });

    const request = buildRequest(
      `${BASE_URL}/api/internal/admin/import-batches/batch-uuid-001`,
      { headers: { cookie: withSessionCookie(issued.token) } },
    );
    const response = await GETDetail(request, {
      params: Promise.resolve({ batchId: "batch-uuid-001" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns batch detail with row errors for admin", async () => {
    const errorRows = [
      {
        id: 1,
        batchId: "batch-uuid-001",
        rowNumber: 42,
        errorCode: "missing_identity",
        errorDetail: "Row must have at least one of: email, phone",
        occurredAt: "2026-03-30T10:05:00.000Z",
        rawData: {},
      },
    ];
    seedImportBatchForTest(SAMPLE_BATCH);
    seedImportBatchDetailErrorsForTest(errorRows);

    const issued = await issueSessionToken({
      actorId: "actor-admin-1",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "admin",
      rememberDevice: false,
    });

    const request = buildRequest(
      `${BASE_URL}/api/internal/admin/import-batches/batch-uuid-001`,
      { headers: { cookie: withSessionCookie(issued.token) } },
    );
    const response = await GETDetail(request, {
      params: Promise.resolve({ batchId: "batch-uuid-001" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.id).toBe("batch-uuid-001");
    expect(body.data.status).toBe("complete");
    expect(body.data.imported).toBe(1980);
    expect(body.data.errorThresholdPct).toBe(5);
    expect(body.data.recentErrors).toHaveLength(1);
    expect(body.data.recentErrors[0].rowNumber).toBe(42);
    expect(body.data.recentErrors[0].errorCode).toBe("missing_identity");
  });
});
