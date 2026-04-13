import Link from "next/link";

import { recordImportBatchAccessEvent } from "@/modules/audit";
import {
  getLatestMigrationBatch,
} from "@/features/candidate-management/infrastructure/import-batch-repository";

type MigrationStatusCardProps = {
  tenantId: string;
  actorId?: string;
  traceId?: string;
};

const STATUS_LABELS: Record<string, string> = {
  running: "Running",
  validating: "Validating",
  complete: "Complete",
  paused_on_error_threshold: "Paused",
  rolled_back: "Rolled back",
};

const STATUS_COLORS: Record<string, string> = {
  running: "text-blue-600",
  validating: "text-gray-600",
  complete: "text-green-600",
  paused_on_error_threshold: "text-amber-600",
  rolled_back: "text-gray-400",
};

function progressPercent(imported: number, totalRows: number): number {
  if (totalRows <= 0) return 0;
  return Math.min(100, Math.round((imported / totalRows) * 100));
}

function formatElapsedMs(startedAt: string, completedAt: string | null): string {
  const startedMs = Number(new Date(startedAt));
  if (!Number.isFinite(startedMs)) return "N/A";
  const endMs = completedAt ? Number(new Date(completedAt)) : Date.now();
  if (!Number.isFinite(endMs) || endMs < startedMs) return "N/A";
  const elapsedSec = Math.floor((endMs - startedMs) / 1000);
  const hours = Math.floor(elapsedSec / 3600);
  const minutes = Math.floor((elapsedSec % 3600) / 60);
  const seconds = elapsedSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export default async function MigrationStatusCard({
  tenantId,
  actorId,
  traceId: parentTraceId,
}: MigrationStatusCardProps) {
  const traceId = parentTraceId ?? crypto.randomUUID();

  if (actorId) {
    try {
      await recordImportBatchAccessEvent({
        traceId, actorId, tenantId, batchId: null, action: "list_import_batches",
      });
    } catch (error) {
      console.error(JSON.stringify({
        level: "error", module: "MigrationStatusCard", action: "audit_event_persist",
        traceId, error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  let batch: Awaited<ReturnType<typeof getLatestMigrationBatch>> = null;
  try {
    batch = await getLatestMigrationBatch(tenantId);
  } catch (error) {
    console.error(JSON.stringify({
      level: "error", module: "MigrationStatusCard", action: "fetch_latest_migration_batch",
      traceId, error: error instanceof Error ? error.message : String(error),
    }));
  }

  if (!batch) {
    return <p className="text-sm text-gray-400">No migration data available.</p>;
  }

  const pct = progressPercent(batch.imported, batch.totalRows);
  const statusLabel = STATUS_LABELS[batch.status] ?? batch.status;
  const statusColor = STATUS_COLORS[batch.status] ?? "text-gray-500";

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${statusColor}`}>{statusLabel}</span>
        <Link
          href={`/api/internal/admin/import-batches/${batch.id}`}
          className="text-xs text-blue-500 hover:text-blue-700"
        >
          Details
        </Link>
      </div>

      <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100">
        <div
          className="h-1.5 rounded-full bg-blue-500 transition-all"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>

      <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-gray-400">
        <span><span className="font-medium text-gray-700">{batch.imported.toLocaleString()}</span> imported</span>
        <span><span className="font-medium text-gray-700">{batch.totalRows.toLocaleString()}</span> total</span>
        {batch.errors > 0 && (
          <span><span className="font-medium text-amber-600">{batch.errors.toLocaleString()}</span> errors</span>
        )}
        <span>{formatElapsedMs(batch.startedAt, batch.completedAt)} elapsed</span>
        <span className="ml-auto text-gray-300">Batch {batch.id.slice(0, 8)}</span>
      </div>
    </div>
  );
}
