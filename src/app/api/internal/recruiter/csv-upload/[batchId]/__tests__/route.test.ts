import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, issueSessionToken } from "@/modules/auth";
import {
  clearAuthorizationDenyEventsForTest,
  clearImportBatchAccessEventsForTest,
} from "@/modules/audit";

import { GET } from "../route";
import { GET as GET_ERROR_REPORT } from "../error-report/route";
import {
  clearCsvUploadStoreForTest,
  seedCsvUploadBatchForTest,
  seedCsvUploadErrorsForTest,
} from "../../shared";

const BASE_URL = "https://aerodelivery.onrender.com";

function withSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

function buildRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(url, init);
}

describe("GET /api/internal/recruiter/csv-upload/[batchId]", () => {
  beforeEach(async () => {
    clearCsvUploadStoreForTest();
    await clearAuthorizationDenyEventsForTest();
    await clearImportBatchAccessEventsForTest();
  });

  it("returns 401 for unauthenticated requests", async () => {
    const request = buildRequest(`${BASE_URL}/api/internal/recruiter/csv-upload/any-batch`, {
      method: "GET",
    });

    const response = await GET(request, {
      params: Promise.resolve({ batchId: "any-batch" }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("unauthenticated");
  });

  it("returns 403 for compliance-officer role", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-compliance-1",
      email: "compliance@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "compliance-officer",
      rememberDevice: false,
    });

    const request = buildRequest(`${BASE_URL}/api/internal/recruiter/csv-upload/any-batch`, {
      method: "GET",
      headers: {
        cookie: withSessionCookie(issued.token),
      },
    });

    const response = await GET(request, {
      params: Promise.resolve({ batchId: "any-batch" }),
    });

    expect(response.status).toBe(403);
  });

  it("returns 404 for unknown batch ID", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-recruiter-1",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "recruiter",
      rememberDevice: false,
    });

    const request = buildRequest(`${BASE_URL}/api/internal/recruiter/csv-upload/unknown-batch`, {
      method: "GET",
      headers: {
        cookie: withSessionCookie(issued.token),
      },
    });

    const response = await GET(request, {
      params: Promise.resolve({ batchId: "unknown-batch" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns 404 for cross-tenant batch access", async () => {
    seedCsvUploadBatchForTest({
      id: "batch-tenant-alpha-1",
      tenant_id: "tenant-alpha",
      source: "csv_upload",
      status: "complete",
      total_rows: 3,
      imported: 3,
      skipped: 0,
      errors: 0,
      error_threshold_pct: 5,
      created_by_actor_id: "actor-recruiter-1",
      started_at: "2026-03-30T12:00:00.000Z",
      completed_at: "2026-03-30T12:00:05.000Z",
    });

    const issued = await issueSessionToken({
      actorId: "actor-recruiter-2",
      email: "other@cblsolutions.com",
      tenantId: "tenant-beta",
      role: "recruiter",
      rememberDevice: false,
    });

    const request = buildRequest(
      `${BASE_URL}/api/internal/recruiter/csv-upload/batch-tenant-alpha-1`,
      {
        method: "GET",
        headers: {
          cookie: withSessionCookie(issued.token),
        },
      },
    );

    const response = await GET(request, {
      params: Promise.resolve({ batchId: "batch-tenant-alpha-1" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns error report CSV with correct headers, content-type, and row data", async () => {
    seedCsvUploadBatchForTest({
      id: "batch-err-report-1",
      tenant_id: "tenant-alpha",
      source: "csv_upload",
      status: "complete",
      total_rows: 2,
      imported: 1,
      skipped: 0,
      errors: 1,
      error_threshold_pct: 5,
      created_by_actor_id: "actor-recruiter-4",
      started_at: "2026-03-30T12:00:00.000Z",
      completed_at: "2026-03-30T12:00:03.000Z",
    });

    seedCsvUploadErrorsForTest([
      {
        id: 1,
        batch_id: "batch-err-report-1",
        row_number: 2,
        raw_data: { name: "", email: "", phone: "" },
        error_code: "missing_identity",
        error_detail: "Row must include name and at least one of email or phone.",
        occurred_at: "2026-03-30T12:00:01.000Z",
      },
    ]);

    const issued = await issueSessionToken({
      actorId: "actor-recruiter-4",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "recruiter",
      rememberDevice: false,
    });

    const request = buildRequest(
      `${BASE_URL}/api/internal/recruiter/csv-upload/batch-err-report-1/error-report`,
      {
        method: "GET",
        headers: { cookie: withSessionCookie(issued.token) },
      },
    );

    const response = await GET_ERROR_REPORT(request, {
      params: Promise.resolve({ batchId: "batch-err-report-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("content-disposition")).toContain("error-report-");

    const body = await response.text();
    const lines = body.split("\n");
    expect(lines[0]).toBe("row_number,error_code,error_detail,raw_data");
    expect(lines[1]).toContain("missing_identity");
    expect(lines[1]).toContain("2");
  });

  it("returns error report CSV with headers only when no errors exist", async () => {
    seedCsvUploadBatchForTest({
      id: "batch-no-errors-1",
      tenant_id: "tenant-alpha",
      source: "csv_upload",
      status: "complete",
      total_rows: 1,
      imported: 1,
      skipped: 0,
      errors: 0,
      error_threshold_pct: 5,
      created_by_actor_id: "actor-recruiter-5",
      started_at: "2026-03-30T12:00:00.000Z",
      completed_at: "2026-03-30T12:00:01.000Z",
    });

    const issued = await issueSessionToken({
      actorId: "actor-recruiter-5",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "recruiter",
      rememberDevice: false,
    });

    const request = buildRequest(
      `${BASE_URL}/api/internal/recruiter/csv-upload/batch-no-errors-1/error-report`,
      {
        method: "GET",
        headers: { cookie: withSessionCookie(issued.token) },
      },
    );

    const response = await GET_ERROR_REPORT(request, {
      params: Promise.resolve({ batchId: "batch-no-errors-1" }),
    });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body.trim()).toBe("row_number,error_code,error_detail,raw_data");
  });

  it("returns seeded batch status payload", async () => {
    seedCsvUploadBatchForTest({
      id: "batch-tenant-alpha-2",
      tenant_id: "tenant-alpha",
      source: "csv_upload",
      status: "running",
      total_rows: 8,
      imported: 3,
      skipped: 0,
      errors: 1,
      error_threshold_pct: 5,
      created_by_actor_id: "actor-recruiter-3",
      started_at: "2026-03-30T12:00:00.000Z",
      completed_at: null,
    });

    const issued = await issueSessionToken({
      actorId: "actor-recruiter-3",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "recruiter",
      rememberDevice: false,
    });

    const request = buildRequest(
      `${BASE_URL}/api/internal/recruiter/csv-upload/batch-tenant-alpha-2`,
      {
        method: "GET",
        headers: {
          cookie: withSessionCookie(issued.token),
        },
      },
    );

    const response = await GET(request, {
      params: Promise.resolve({ batchId: "batch-tenant-alpha-2" }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.batchId).toBe("batch-tenant-alpha-2");
    expect(body.data.status).toBe("running");
    expect(body.data.imported).toBe(3);
    expect(body.data.totalRows).toBe(8);
    expect(body.data.errors).toBe(1);
    expect(typeof body.data.elapsedMs === "number" || body.data.elapsedMs === null).toBe(true);
  });
});
