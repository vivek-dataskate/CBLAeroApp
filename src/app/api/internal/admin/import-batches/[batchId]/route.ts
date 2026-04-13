import { NextResponse } from "next/server";

import { withAuth } from "@/modules/auth";
import { recordImportBatchAccessEvent } from "@/modules/audit";
import {
  shouldUseInMemoryPersistenceForTests,
} from "@/modules/persistence";
import {
  getImportBatchById,
  listImportRowErrors,
  type ImportRowError,
} from "@/features/candidate-management/infrastructure/import-batch-repository";

type ImportBatchDetailResponse = {
  id: string;
  tenantId: string;
  source: string;
  status: string;
  totalRows: number;
  imported: number;
  skipped: number;
  errors: number;
  errorThresholdPct: number;
  createdByActorId: string | null;
  startedAt: string;
  completedAt: string | null;
  elapsedMs: number | null;
  recentErrors: Array<{
    id: number;
    rowNumber: number;
    errorCode: string;
    errorDetail: string | null;
    occurredAt: string;
  }>;
};

// In-memory store for test row errors
const inMemoryRowErrors: ImportRowError[] = [];

export function seedImportBatchDetailErrorsForTest(errors: ImportRowError[]): void {
  if (!shouldUseInMemoryPersistenceForTests()) return;
  inMemoryRowErrors.push(...errors);
}

export function clearImportBatchDetailForTest(): void {
  if (!shouldUseInMemoryPersistenceForTests()) return;
  inMemoryRowErrors.length = 0;
}

export const GET = withAuth<{ batchId: string }>(async ({ session, params, traceId }) => {
  const { batchId } = params;

  try {
    await recordImportBatchAccessEvent({
      traceId,
      actorId: session.actorId,
      tenantId: session.tenantId,
      batchId,
      action: "read_import_batch_detail",
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      module: "admin/import-batches/:batchId",
      action: "audit_event_persist",
      traceId,
      actorId: session.actorId,
      tenantId: session.tenantId,
      batchId,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
  }

  try {
    const batch = await getImportBatchById(batchId, session.tenantId);
    if (!batch) {
      console.log(JSON.stringify({
        level: "warn",
        module: "admin/import-batches/:batchId",
        action: "read_import_batch_detail",
        traceId,
        batchId,
        tenantId: session.tenantId,
        result: "not_found",
        timestamp: new Date().toISOString(),
      }));
      return NextResponse.json(
        { error: { code: "not_found", message: "Import batch not found." } },
        { status: 404 },
      );
    }

    let recentErrors: ImportRowError[] = [];

    if (shouldUseInMemoryPersistenceForTests()) {
      recentErrors = inMemoryRowErrors.filter((e) => e.batchId === batchId).slice(0, 50);
    } else {
      recentErrors = await listImportRowErrors(batchId, 50);
    }

    const startedMs = new Date(batch.startedAt).getTime();
    const completedMs = batch.completedAt ? new Date(batch.completedAt).getTime() : null;
    const elapsedMs = completedMs !== null ? completedMs - startedMs : Date.now() - startedMs;

    const detail: ImportBatchDetailResponse = {
      id: batch.id,
      tenantId: batch.tenantId,
      source: batch.source,
      status: batch.status,
      totalRows: batch.totalRows,
      imported: batch.imported,
      skipped: batch.skipped,
      errors: batch.errors,
      errorThresholdPct: batch.errorThresholdPct,
      createdByActorId: batch.createdByActorId,
      startedAt: batch.startedAt,
      completedAt: batch.completedAt,
      elapsedMs,
      recentErrors: recentErrors.map((e) => ({
        id: e.id,
        rowNumber: e.rowNumber,
        errorCode: e.errorCode,
        errorDetail: e.errorDetail,
        occurredAt: e.occurredAt,
      })),
    };

    return NextResponse.json({ data: detail });
  } catch (err) {
    console.error(JSON.stringify({
      level: "error",
      module: "admin/import-batches/:batchId",
      action: "read_import_batch_detail",
      traceId,
      batchId,
      tenantId: session.tenantId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      timestamp: new Date().toISOString(),
    }));
    return NextResponse.json(
      { error: { code: "database_error", message: "Failed to load import batch detail." } },
      { status: 500 },
    );
  }
}, { action: "admin:read-import-batches" });
