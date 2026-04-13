import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, issueSessionToken } from "@/modules/auth";
import {
  clearAuthorizationDenyEventsForTest,
  clearImportBatchAccessEventsForTest,
} from "@/modules/audit";
import { clearFingerprintsForTest } from "@/features/candidate-management/infrastructure/fingerprint-repository";

import { GET as GET_ERROR_REPORT } from "../[batchId]/error-report/route";
import {
  POST,
  clearCsvUploadStoreForTest,
  listCsvCandidatesForTest,
  listCsvUploadBatchesForTest,
} from "../route";

const BASE_URL = "https://aerodelivery.onrender.com";

function withSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

function buildRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(url, init);
}

function buildCsv(rows: string[]): string {
  return rows.join("\n");
}

async function buildMultipartUploadRequest(input: {
  token?: string;
  csv: string;
  fileName?: string;
  columnMap?: Record<string, string>;
  headers?: Record<string, string>;
}): Promise<NextRequest> {
  const formData = new FormData();
  const file = new File([input.csv], input.fileName ?? "candidates.csv", { type: "text/csv" });
  formData.append("file", file);

  if (input.columnMap) {
    formData.append("columnMap", JSON.stringify(input.columnMap));
  }

  const headers = new Headers(input.headers ?? {});
  if (input.token) {
    headers.set("cookie", withSessionCookie(input.token));
  }

  return buildRequest(`${BASE_URL}/api/internal/recruiter/csv-upload`, {
    method: "POST",
    headers,
    body: formData,
  });
}

describe("POST /api/internal/recruiter/csv-upload", () => {
  beforeEach(async () => {
    clearCsvUploadStoreForTest();
    clearFingerprintsForTest();
    await clearAuthorizationDenyEventsForTest();
    await clearImportBatchAccessEventsForTest();
  });

  it("returns 401 for unauthenticated requests", async () => {
    const request = await buildMultipartUploadRequest({
      csv: buildCsv(["first_name,last_name,email", "Jane,Doe,jane@example.com"]),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
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

    const request = await buildMultipartUploadRequest({
      token: issued.token,
      csv: buildCsv(["first_name,last_name,email", "Jane,Doe,jane@example.com"]),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
  });

  it("returns 422 and does not create a batch when row count exceeds 10,000", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-recruiter-1",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "recruiter",
      rememberDevice: false,
    });

    const rows = ["first_name,last_name,email"];
    for (let index = 0; index < 10001; index += 1) {
      rows.push(`Candidate,${index},candidate${index}@example.com`);
    }

    const request = await buildMultipartUploadRequest({
      token: issued.token,
      csv: buildCsv(rows),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("row_limit_exceeded");
    expect(listCsvUploadBatchesForTest()).toHaveLength(0);
  });

  it("processes a valid CSV and returns complete batch summary", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-recruiter-2",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "recruiter",
      rememberDevice: false,
    });

    const request = await buildMultipartUploadRequest({
      token: issued.token,
      csv: buildCsv([
        "first_name,last_name,email,mobile",
        "Jane,Doe,jane@example.com,5551112233",
        "John,Roe,john@example.com,5551113344",
        "Mia,Poe,mia@example.com,5551114455",
      ]),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("complete");
    expect(body.data.imported).toBe(3);
    expect(body.data.errors).toBe(0);
    expect(body.data.totalRows).toBe(3);
  });

  it("records per-row validation errors while importing valid rows", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-recruiter-3",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "recruiter",
      rememberDevice: false,
    });

    const request = await buildMultipartUploadRequest({
      token: issued.token,
      csv: buildCsv([
        "first_name,last_name,email",
        "Jane,Doe,jane@example.com",
        "John,Roe,john@example.com",
        ",,",
      ]),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.imported).toBe(2);
    expect(body.data.errors).toBe(1);
  });

  it("stores unmapped columns inside extra_attributes with normalized keys", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-recruiter-4",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "recruiter",
      rememberDevice: false,
    });

    const request = await buildMultipartUploadRequest({
      token: issued.token,
      csv: buildCsv([
        "first_name,last_name,email,Current Team,FavoriteTool",
        "Jane,Doe,jane@example.com,Blue Hawks,Torque Wrench",
      ]),
      columnMap: {
        first_name: "first_name",
        last_name: "last_name",
        email: "email",
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);

    const candidates = listCsvCandidatesForTest();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].extra_attributes).toMatchObject({
      current_team: "Blue Hawks",
      favoritetool: "Torque Wrench",
    });
  });

  it("drops blocked sensitive keys from extra_attributes", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-recruiter-5",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "recruiter",
      rememberDevice: false,
    });

    const request = await buildMultipartUploadRequest({
      token: issued.token,
      csv: buildCsv([
        "first_name,last_name,email,password,token,secret,api_key",
        "Jane,Doe,jane@example.com,my-secret,abc123,s3cr3t,key-xyz",
      ]),
      columnMap: {
        first_name: "first_name",
        last_name: "last_name",
        email: "email",
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);

    const candidates = listCsvCandidatesForTest();
    expect(candidates[0].extra_attributes.password).toBeUndefined();
    expect(candidates[0].extra_attributes.token).toBeUndefined();
    expect(candidates[0].extra_attributes.secret).toBeUndefined();
    expect(candidates[0].extra_attributes.api_key).toBeUndefined();
  });

  it("sets created_by_actor_id on new candidates and preserves it on upsert", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-recruiter-creator",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "recruiter",
      rememberDevice: false,
    });

    const request = await buildMultipartUploadRequest({
      token: issued.token,
      csv: buildCsv([
        "first_name,last_name,email",
        "Jane,Doe,jane-creator@example.com",
      ]),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const candidates = listCsvCandidatesForTest();
    const jane = candidates.find((c) => c.email === "jane-creator@example.com");
    expect(jane).toBeDefined();
    expect(jane!.created_by_actor_id).toBe("actor-recruiter-creator");

    // Re-upload same candidate with a different actor — created_by_actor_id should be preserved
    const secondUser = await issueSessionToken({
      actorId: "actor-recruiter-updater",
      email: "updater@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "recruiter",
      rememberDevice: false,
    });

    const updateRequest = await buildMultipartUploadRequest({
      token: secondUser.token,
      csv: buildCsv([
        "first_name,last_name,email",
        "Jane,Updated,jane-creator@example.com",
      ]),
    });

    const updateResponse = await POST(updateRequest);
    expect(updateResponse.status).toBe(200);

    const updatedCandidates = listCsvCandidatesForTest();
    const updatedJane = updatedCandidates.find((c) => c.email === "jane-creator@example.com");
    expect(updatedJane).toBeDefined();
    expect(updatedJane!.created_by_actor_id).toBe("actor-recruiter-creator");
    expect(updatedJane!.last_name).toBe("Updated");
  });

  it("rejects oversized extra_attributes payload rows as invalid_format", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-recruiter-6",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "recruiter",
      rememberDevice: false,
    });

    const oversizedValue = "x".repeat(17000);

    const request = await buildMultipartUploadRequest({
      token: issued.token,
      csv: buildCsv([
        "first_name,last_name,email,Notes",
        `Jane,Doe,jane@example.com,${oversizedValue}`,
      ]),
      columnMap: {
        first_name: "first_name",
        last_name: "last_name",
        email: "email",
      },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.imported).toBe(0);
    expect(body.data.errors).toBe(1);
  });

  it("accepts '(ignore)' as columnMap wire value and populates extra_attributes (regression: client-server contract)", async () => {
    const issued = await issueSessionToken({
      actorId: "actor-recruiter-9",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "recruiter",
      rememberDevice: false,
    });

    // Simulate what CsvUploadWizard sends: explicit "(ignore)" for unmapped columns.
    const request = await buildMultipartUploadRequest({
      token: issued.token,
      csv: buildCsv([
        "first_name,last_name,email,Department,Seniority",
        "Jane,Doe,jane@example.com,Engineering,Senior",
      ]),
      columnMap: {
        first_name: "first_name",
        last_name: "last_name",
        email: "email",
        Department: "(ignore)",
        Seniority: "(ignore)",
      },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.imported).toBe(1);
    expect(body.data.errors).toBe(0);

    const candidates = listCsvCandidatesForTest();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].extra_attributes).toMatchObject({
      department: "Engineering",
      seniority: "Senior",
    });
  });

  it("returns 404 for cross-tenant error report access", async () => {
    const uploader = await issueSessionToken({
      actorId: "actor-recruiter-7",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-alpha",
      role: "recruiter",
      rememberDevice: false,
    });

    const uploadRequest = await buildMultipartUploadRequest({
      token: uploader.token,
      csv: buildCsv([
        "first_name,last_name,email",
        "Jane,Doe,jane@example.com",
        ",,",
      ]),
    });

    const uploadResponse = await POST(uploadRequest);
    const uploadBody = await uploadResponse.json();
    const batchId = String(uploadBody.data.batchId);

    const otherTenant = await issueSessionToken({
      actorId: "actor-recruiter-8",
      email: "other@cblsolutions.com",
      tenantId: "tenant-beta",
      role: "recruiter",
      rememberDevice: false,
    });

    const reportRequest = buildRequest(
      `${BASE_URL}/api/internal/recruiter/csv-upload/${batchId}/error-report`,
      {
        method: "GET",
        headers: {
          cookie: withSessionCookie(otherTenant.token),
        },
      },
    );

    const reportResponse = await GET_ERROR_REPORT(reportRequest, {
      params: Promise.resolve({ batchId }),
    });

    expect(reportResponse.status).toBe(404);
  });
});
