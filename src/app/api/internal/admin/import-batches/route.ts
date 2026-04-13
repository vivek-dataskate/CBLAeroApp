import { NextResponse } from "next/server";

import { withAuth } from "@/modules/auth";
import { recordImportBatchAccessEvent } from "@/modules/audit";
import {
  listImportBatchesByTenant,
} from "@/features/candidate-management/infrastructure/import-batch-repository";

export const GET = withAuth(async ({ session, request, traceId }) => {
  try {
    await recordImportBatchAccessEvent({
      traceId,
      actorId: session.actorId,
      tenantId: session.tenantId,
      batchId: null,
      action: "list_import_batches",
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      module: "admin/import-batches",
      action: "audit_event_persist",
      traceId,
      actorId: session.actorId,
      tenantId: session.tenantId,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
  }

  const pageStr = request.nextUrl.searchParams.get("page") ?? "1";
  const page = Math.max(1, Number.parseInt(pageStr, 10) || 1);
  const pageSize = 20;

  try {
    const result = await listImportBatchesByTenant(session.tenantId, page, pageSize);

    return NextResponse.json({
      data: result.items.map((batch) => {
        const startedMs = new Date(batch.startedAt).getTime();
        const completedMs = batch.completedAt ? new Date(batch.completedAt).getTime() : null;
        const elapsedMs = completedMs !== null ? completedMs - startedMs : Date.now() - startedMs;

        return {
          id: batch.id,
          tenantId: batch.tenantId,
          source: batch.source,
          status: batch.status,
          totalRows: batch.totalRows,
          imported: batch.imported,
          skipped: batch.skipped,
          errors: batch.errors,
          startedAt: batch.startedAt,
          completedAt: batch.completedAt,
          elapsedMs,
        };
      }),
      meta: { page, pageSize, total: result.total },
    });
  } catch (err) {
    console.error(JSON.stringify({
      level: "error",
      module: "admin/import-batches",
      action: "list_import_batches",
      traceId,
      tenantId: session.tenantId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      timestamp: new Date().toISOString(),
    }));
    return NextResponse.json(
      { error: { code: "database_error", message: "Failed to load import batches." } },
      { status: 500 },
    );
  }
}, { action: "admin:read-import-batches" });
