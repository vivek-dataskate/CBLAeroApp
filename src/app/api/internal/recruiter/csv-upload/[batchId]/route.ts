import { NextResponse } from "next/server";

import { withAuth } from "@/modules/auth";
import { recordImportBatchAccessEvent } from "@/modules/audit";
import { shouldUseInMemoryPersistenceForTests } from "@/modules/persistence";
import { getImportBatchById } from "@/features/candidate-management/infrastructure/import-batch-repository";

import { findCsvUploadBatchForTenant, resolveRequestTenantId, toBatchStatusPayload, type CsvUploadBatchRow } from "../shared";

export const GET = withAuth<{ batchId: string }>(async ({ session, params, traceId, request }) => {
  const { batchId } = params;
  const tenantId = resolveRequestTenantId(session, request);

  if (shouldUseInMemoryPersistenceForTests()) {
    const batch = findCsvUploadBatchForTenant(batchId, tenantId);
    if (!batch) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Import batch not found." } },
        { status: 404 },
      );
    }

    try {
      await recordImportBatchAccessEvent({
        traceId,
        actorId: session.actorId,
        tenantId,
        batchId,
        action: "read_import_batch_detail",
      });
    } catch {
      // Audit is best-effort — do not block status reads
    }

    return NextResponse.json({ data: toBatchStatusPayload(batch), meta: {} });
  }

  const batch = await getImportBatchById(batchId, tenantId);

  if (!batch) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Import batch not found." } },
      { status: 404 },
    );
  }

  const VALID_STATUSES: Set<string> = new Set(["validating", "running", "paused_on_error_threshold", "complete", "rolled_back"]);
  const safeStatus: CsvUploadBatchRow["status"] = VALID_STATUSES.has(batch.status)
    ? (batch.status as CsvUploadBatchRow["status"])
    : "running";

  const batchRow: CsvUploadBatchRow = {
    id: batch.id,
    tenant_id: batch.tenantId,
    source: "csv_upload",
    status: safeStatus,
    total_rows: batch.totalRows,
    imported: batch.imported,
    skipped: batch.skipped,
    errors: batch.errors,
    error_threshold_pct: batch.errorThresholdPct,
    created_by_actor_id: batch.createdByActorId,
    started_at: batch.startedAt,
    completed_at: batch.completedAt,
  };

  try {
    await recordImportBatchAccessEvent({
      traceId,
      actorId: session.actorId,
      tenantId,
      batchId,
      action: "read_import_batch_detail",
    });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", module: "recruiter/csv-upload/status", action: "audit_event", traceId, batchId, error: err instanceof Error ? err.message : String(err) }));
  }

  return NextResponse.json({ data: toBatchStatusPayload(batchRow), meta: {} });
}, { action: "recruiter:csv-upload" });
