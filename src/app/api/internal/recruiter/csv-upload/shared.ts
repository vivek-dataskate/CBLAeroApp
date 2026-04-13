import { shouldUseInMemoryPersistenceForTests } from "@/modules/persistence";

/**
 * Resolves the effective tenant ID for a request. Uses the x-active-client-id header
 * only if it is present in the session's clientIds allowlist; otherwise falls back to
 * session.tenantId. withAuth already validates this header via authorizeAccess, but
 * business logic must not re-derive tenantId from the raw header independently.
 */
export function resolveRequestTenantId(
  session: { tenantId: string; clientIds?: string[] },
  request: { headers: { get(name: string): string | null } },
): string {
  const requested = request.headers.get("x-active-client-id")?.trim() || null;
  if (requested) {
    const allowed = session.clientIds ?? [session.tenantId];
    if (allowed.includes(requested)) return requested;
  }
  return session.tenantId;
}

export const MAX_RECRUITER_CSV_ROWS = 10_000;
export const MAX_EXTRA_ATTRIBUTE_KEYS = 64;
export const MAX_EXTRA_ATTRIBUTE_BYTES = 16 * 1024;
export const CSV_PROCESSING_CHUNK_SIZE = 1_000;

export type CsvUploadBatchRow = {
  id: string;
  tenant_id: string;
  source: "csv_upload";
  status:
    | "validating"
    | "running"
    | "paused_on_error_threshold"
    | "complete"
    | "rolled_back";
  total_rows: number;
  imported: number;
  skipped: number;
  errors: number;
  error_threshold_pct: number;
  created_by_actor_id: string | null;
  started_at: string;
  completed_at: string | null;
};

export type CsvUploadRowErrorRow = {
  id: number;
  batch_id: string;
  row_number: number;
  raw_data: Record<string, string>;
  error_code: string;
  error_detail: string | null;
  occurred_at: string;
};

export type CsvCandidateRow = {
  tenant_id: string;
  email: string | null;
  phone: string | null;
  first_name: string;
  last_name: string;
  middle_name: string | null;
  home_phone: string | null;
  work_phone: string | null;
  location: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  current_company: string | null;
  job_title: string | null;
  alternate_email: string | null;
  skills: string[];
  availability_status: "active" | "passive" | "unavailable";
  ingestion_state: "pending_dedup";
  source: "csv_upload";
  source_batch_id: string;
  created_by_actor_id: string | null;
  extra_attributes: Record<string, string>;
};

let inMemoryErrorId = 1;

const inMemoryBatches: CsvUploadBatchRow[] = [];
const inMemoryRowErrors: CsvUploadRowErrorRow[] = [];
const inMemoryCandidates: CsvCandidateRow[] = [];

export function listCsvUploadBatchesForTest(): CsvUploadBatchRow[] {
  return [...inMemoryBatches];
}

export function listCsvUploadErrorsForTest(): CsvUploadRowErrorRow[] {
  return [...inMemoryRowErrors];
}

export function listCsvCandidatesForTest(): CsvCandidateRow[] {
  return [...inMemoryCandidates];
}

export function clearCsvUploadStoreForTest(): void {
  if (!shouldUseInMemoryPersistenceForTests()) return;
  inMemoryBatches.length = 0;
  inMemoryRowErrors.length = 0;
  inMemoryCandidates.length = 0;
  inMemoryErrorId = 1;
}

export function seedCsvUploadBatchForTest(batch: CsvUploadBatchRow): void {
  inMemoryBatches.push(batch);
}

export function seedCsvUploadErrorsForTest(errors: CsvUploadRowErrorRow[]): void {
  for (const error of errors) {
    inMemoryRowErrors.push(error);
    inMemoryErrorId = Math.max(inMemoryErrorId, error.id + 1);
  }
}

export function findCsvUploadBatchForTenant(
  batchId: string,
  tenantId: string,
): CsvUploadBatchRow | null {
  return inMemoryBatches.find((batch) => batch.id === batchId && batch.tenant_id === tenantId) ?? null;
}

export function listCsvUploadErrorsForBatch(batchId: string): CsvUploadRowErrorRow[] {
  return inMemoryRowErrors
    .filter((error) => error.batch_id === batchId)
    .sort((a, b) => a.row_number - b.row_number);
}

export function createInMemoryCsvBatch(input: {
  tenantId: string;
  totalRows: number;
  createdByActorId: string;
}): CsvUploadBatchRow {
  const batch: CsvUploadBatchRow = {
    id: crypto.randomUUID(),
    tenant_id: input.tenantId,
    source: "csv_upload",
    status: "validating",
    total_rows: input.totalRows,
    imported: 0,
    skipped: 0,
    errors: 0,
    error_threshold_pct: 5,
    created_by_actor_id: input.createdByActorId,
    started_at: new Date().toISOString(),
    completed_at: null,
  };

  inMemoryBatches.push(batch);
  return batch;
}

export function finalizeInMemoryCsvBatch(
  batchId: string,
  input: {
    status: CsvUploadBatchRow["status"];
    imported: number;
    skipped: number;
    errors: number;
  },
): CsvUploadBatchRow | null {
  const batch = inMemoryBatches.find((candidate) => candidate.id === batchId) ?? null;
  if (!batch) {
    return null;
  }

  batch.status = input.status;
  batch.imported = input.imported;
  batch.skipped = input.skipped;
  batch.errors = input.errors;
  batch.completed_at =
    input.status === "complete" ||
    input.status === "paused_on_error_threshold" ||
    input.status === "rolled_back"
      ? new Date().toISOString()
      : null;

  return batch;
}

export function markInMemoryCsvBatchRunning(batchId: string): void {
  const batch = inMemoryBatches.find((candidate) => candidate.id === batchId);
  if (!batch) {
    return;
  }

  batch.status = "running";
}

export function appendInMemoryCsvErrors(
  batchId: string,
  errors: Array<{
    rowNumber: number;
    rawData: Record<string, string>;
    errorCode: string;
    errorDetail: string | null;
  }>,
): void {
  const nowIso = new Date().toISOString();
  for (const error of errors) {
    inMemoryRowErrors.push({
      id: inMemoryErrorId,
      batch_id: batchId,
      row_number: error.rowNumber,
      raw_data: error.rawData,
      error_code: error.errorCode,
      error_detail: error.errorDetail,
      occurred_at: nowIso,
    });
    inMemoryErrorId += 1;
  }
}

export function upsertInMemoryCandidates(rows: CsvCandidateRow[]): { inserted: number; updated: number } {
  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const existingIndex = inMemoryCandidates.findIndex((candidate) => {
      if (candidate.tenant_id !== row.tenant_id) {
        return false;
      }

      if (row.email) {
        return candidate.email === row.email;
      }

      return candidate.phone === row.phone;
    });

    if (existingIndex >= 0) {
      const existing = inMemoryCandidates[existingIndex];
      inMemoryCandidates[existingIndex] = {
        ...existing,
        ...row,
        created_by_actor_id: existing.created_by_actor_id ?? row.created_by_actor_id,
      };
      updated += 1;
    } else {
      inMemoryCandidates.push(row);
      inserted += 1;
    }
  }

  return { inserted, updated };
}

export function toBatchStatusPayload(batch: CsvUploadBatchRow) {
  const startedMs = new Date(batch.started_at).getTime();
  const completedMs = batch.completed_at ? new Date(batch.completed_at).getTime() : Date.now();

  return {
    batchId: batch.id,
    status: batch.status,
    imported: batch.imported,
    skipped: batch.skipped,
    errors: batch.errors,
    totalRows: batch.total_rows,
    startedAt: batch.started_at,
    completedAt: batch.completed_at,
    elapsedMs: Number.isFinite(startedMs) && Number.isFinite(completedMs)
      ? Math.max(0, completedMs - startedMs)
      : null,
  };
}
