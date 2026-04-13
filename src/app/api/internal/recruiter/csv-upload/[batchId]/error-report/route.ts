import { NextResponse } from "next/server";

import { withAuth } from "@/modules/auth";
import { recordImportBatchAccessEvent } from "@/modules/audit";
import {
  shouldUseInMemoryPersistenceForTests,
} from "@/modules/persistence";
import { getImportBatchById, listImportRowErrors } from "@/features/candidate-management/infrastructure/import-batch-repository";

import { findCsvUploadBatchForTenant, listCsvUploadErrorsForBatch, resolveRequestTenantId } from "../../shared";

type ImportRowErrorRow = {
  row_number: number;
  error_code: string;
  error_detail: string | null;
  raw_data: Record<string, string>;
};

function escapeCsvValue(value: string): string {
  if (value.includes(",") || value.includes("\n") || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function toCsv(errors: ImportRowErrorRow[]): string {
  const header = "row_number,error_code,error_detail,raw_data";
  if (errors.length === 0) {
    return `${header}\n`;
  }

  const lines = errors.map((error) => {
    const rawData = JSON.stringify(error.raw_data ?? {});
    return [
      String(error.row_number),
      escapeCsvValue(error.error_code),
      escapeCsvValue(error.error_detail ?? ""),
      escapeCsvValue(rawData),
    ].join(",");
  });

  return [header, ...lines].join("\n");
}

export const GET = withAuth<{ batchId: string }>(async ({ session, params, traceId, request }) => {
  const { batchId } = params;
  const tenantId = resolveRequestTenantId(session, request);

  let errors: ImportRowErrorRow[] = [];

  if (shouldUseInMemoryPersistenceForTests()) {
    const batch = findCsvUploadBatchForTenant(batchId, tenantId);
    if (!batch) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Import batch not found." } },
        { status: 404 },
      );
    }

    errors = listCsvUploadErrorsForBatch(batchId).map((error) => ({
      row_number: error.row_number,
      error_code: error.error_code,
      error_detail: error.error_detail,
      raw_data: error.raw_data,
    }));
  } else {
    const batch = await getImportBatchById(batchId, tenantId);

    if (!batch) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Import batch not found." } },
        { status: 404 },
      );
    }

    try {
      const rowErrors = await listImportRowErrors(batchId, 10000);
      errors = rowErrors.map((e) => ({
        row_number: e.rowNumber,
        error_code: e.errorCode,
        error_detail: e.errorDetail,
        raw_data: e.rawData,
      }));
    } catch (err) {
      console.error("[error-report] Failed to load row errors:", err instanceof Error ? err.message : err);
      return NextResponse.json(
        { error: { code: "database_error", message: "Failed to load import row errors." } },
        { status: 500 },
      );
    }
  }

  try {
    await recordImportBatchAccessEvent({
      traceId,
      actorId: session.actorId,
      tenantId,
      batchId,
      action: "download_csv_error_report",
    });
  } catch (error) {
    console.error("[recruiter/csv-upload/:batchId/error-report] failed to persist audit event", {
      traceId,
      batchId,
      tenantId,
      actorId: session.actorId,
      error,
    });
  }

  const csv = toCsv(errors);
  const safePrefix = batchId.slice(0, 8).replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `error-report-${safePrefix}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
    },
  });
}, { action: "recruiter:csv-upload" });
