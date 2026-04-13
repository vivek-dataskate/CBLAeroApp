import {
  getSupabaseAdminClient,
  shouldUseInMemoryPersistenceForTests,
} from "@/modules/persistence";

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

export type ImportBatchStatus =
  | "validating"
  | "processing"
  | "running"
  | "paused_on_error_threshold"
  | "complete"
  | "rolled_back";

type ImportBatchSource = "csv_upload" | "resume_upload" | "email" | "ceipal" | "onedrive";

export type ImportBatch = {
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
};

export type ImportBatchCreateParams = {
  tenantId: string;
  source: ImportBatchSource;
  status: ImportBatchStatus;
  totalRows: number;
  createdByActorId: string;
};

export type ImportBatchUpdateParams = {
  status?: ImportBatchStatus;
  imported?: number;
  skipped?: number;
  errors?: number;
  completedAt?: string;
};

export type ImportBatchListResult = {
  items: ImportBatch[];
  total: number;
};

// -----------------------------------------------------------------------
// Row type (DB shape)
// -----------------------------------------------------------------------

type ImportBatchRow = {
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
};

// -----------------------------------------------------------------------
// Row mapping
// -----------------------------------------------------------------------

function isImportBatchRow(row: unknown): row is ImportBatchRow {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.tenant_id === "string" && typeof r.status === "string";
}

function toBatch(row: ImportBatchRow): ImportBatch {
  return {
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
  };
}

function toValidatedBatch(data: unknown): ImportBatch {
  if (!isImportBatchRow(data)) {
    throw new Error("Unexpected import_batch row shape from Supabase");
  }
  return toBatch(data);
}

// -----------------------------------------------------------------------
// In-memory store (test mode only)
// -----------------------------------------------------------------------

const batchStore = new Map<string, ImportBatchRow>();

export function seedImportBatchForTest(batch: ImportBatch): void {
  batchStore.set(batch.id, {
    id: batch.id,
    tenant_id: batch.tenantId,
    source: batch.source,
    status: batch.status,
    total_rows: batch.totalRows,
    imported: batch.imported,
    skipped: batch.skipped,
    errors: batch.errors,
    error_threshold_pct: batch.errorThresholdPct,
    created_by_actor_id: batch.createdByActorId,
    started_at: batch.startedAt,
    completed_at: batch.completedAt,
  });
}

export function clearImportBatchStoreForTest(): void {
  if (!shouldUseInMemoryPersistenceForTests()) return;
  batchStore.clear();
}

// -----------------------------------------------------------------------
// Public repository functions
// -----------------------------------------------------------------------

export async function createImportBatch(
  params: ImportBatchCreateParams,
): Promise<{ id: string; startedAt: string }> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const id = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const row: ImportBatchRow = {
      id,
      tenant_id: params.tenantId,
      source: params.source,
      status: params.status,
      total_rows: params.totalRows,
      imported: 0,
      skipped: 0,
      errors: 0,
      error_threshold_pct: 0,
      created_by_actor_id: params.createdByActorId,
      started_at: startedAt,
      completed_at: null,
    };
    batchStore.set(id, row);
    return { id, startedAt };
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("import_batch")
    .insert({
      tenant_id: params.tenantId,
      source: params.source,
      status: params.status,
      total_rows: params.totalRows,
      created_by_actor_id: params.createdByActorId,
    })
    .select("id, started_at")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create import batch: ${error?.message ?? "no data returned"}`);
  }

  return { id: String(data.id), startedAt: String(data.started_at) };
}

export async function getImportBatchById(
  batchId: string,
  tenantId: string,
): Promise<ImportBatch | null> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const row = batchStore.get(batchId);
    if (!row || row.tenant_id !== tenantId) return null;
    return toBatch(row);
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("import_batch")
    .select("*")
    .eq("id", batchId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch import batch: ${error.message}`);
  }

  if (!data) return null;
  return toValidatedBatch(data);
}

export async function updateImportBatch(
  batchId: string,
  updates: ImportBatchUpdateParams,
): Promise<void> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const row = batchStore.get(batchId);
    if (!row) return;
    if (updates.status !== undefined) row.status = updates.status;
    if (updates.imported !== undefined) row.imported = updates.imported;
    if (updates.skipped !== undefined) row.skipped = updates.skipped;
    if (updates.errors !== undefined) row.errors = updates.errors;
    if (updates.completedAt !== undefined) row.completed_at = updates.completedAt;
    return;
  }

  const client = getSupabaseAdminClient();
  const updateData: Record<string, unknown> = {};
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.imported !== undefined) updateData.imported = updates.imported;
  if (updates.skipped !== undefined) updateData.skipped = updates.skipped;
  if (updates.errors !== undefined) updateData.errors = updates.errors;
  if (updates.completedAt !== undefined) updateData.completed_at = updates.completedAt;

  const { error } = await client
    .from("import_batch")
    .update(updateData)
    .eq("id", batchId);

  if (error) {
    throw new Error(`Failed to update import batch: ${error.message}`);
  }
}

export async function listImportBatchesByTenant(
  tenantId: string,
  page: number = 1,
  pageSize: number = 20,
): Promise<ImportBatchListResult> {
  const offset = (page - 1) * pageSize;

  if (shouldUseInMemoryPersistenceForTests()) {
    const tenantBatches = [...batchStore.values()]
      .filter((b) => b.tenant_id === tenantId)
      .sort((a, b) => b.started_at.localeCompare(a.started_at));

    return {
      items: tenantBatches.slice(offset, offset + pageSize).map(toBatch),
      total: tenantBatches.length,
    };
  }

  const client = getSupabaseAdminClient();
  const { data, error, count } = await client
    .from("import_batch")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenantId)
    .order("started_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) {
    throw new Error(`Failed to list import batches: ${error.message}`);
  }

  return {
    items: (data ?? []).map((row) => toValidatedBatch(row)),
    total: count ?? 0,
  };
}

export type ImportRowError = {
  id: number;
  batchId: string;
  rowNumber: number;
  errorCode: string;
  errorDetail: string | null;
  occurredAt: string;
  rawData: Record<string, string>;
};

export async function listImportRowErrors(
  batchId: string,
  limit: number = 50,
): Promise<ImportRowError[]> {
  if (shouldUseInMemoryPersistenceForTests()) {
    return []; // In-memory row errors handled by route-specific test stores
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("import_row_error")
    .select("id, batch_id, row_number, error_code, error_detail, occurred_at, raw_data")
    .eq("batch_id", batchId)
    .order("row_number", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list import row errors: ${error.message}`);
  }

  return (data ?? []).map((row: { id: number; batch_id: string; row_number: number; error_code: string; error_detail: string | null; occurred_at: string; raw_data?: Record<string, string> }) => ({
    id: row.id,
    batchId: row.batch_id,
    rowNumber: row.row_number,
    errorCode: row.error_code,
    errorDetail: row.error_detail,
    occurredAt: row.occurred_at,
    rawData: row.raw_data ?? {},
  }));
}

export async function processImportChunk(params: {
  batchId: string;
  candidates: Array<Record<string, unknown>>;
  errorRows: Array<Record<string, unknown>>;
  totalImported: number;
  totalSkipped: number;
  totalErrors: number;
}): Promise<{ imported: number; skipped: number; errors: number }> {
  if (shouldUseInMemoryPersistenceForTests()) {
    // In-memory mode: count candidates as imported (no actual DB write)
    return {
      imported: params.candidates.length,
      skipped: 0,
      errors: params.errorRows.length,
    };
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc("process_import_chunk", {
    p_batch_id: params.batchId,
    p_candidates: params.candidates,
    p_error_rows: params.errorRows,
    p_total_imported: params.totalImported,
    p_total_skipped: params.totalSkipped,
    p_total_errors: params.totalErrors,
  });

  if (error) {
    throw new Error(`Failed to process import chunk: ${error.message}`);
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result) {
    throw new Error("process_import_chunk RPC returned no result");
  }

  return {
    imported: Number(result.imported ?? 0),
    skipped: Number(result.skipped ?? 0),
    errors: Number(result.errors ?? 0),
  };
}

export async function getLatestMigrationBatch(
  tenantId: string,
): Promise<ImportBatch | null> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const migrationBatches = [...batchStore.values()]
      .filter((b) => b.tenant_id === tenantId && b.source === "migration")
      .sort((a, b) => b.started_at.localeCompare(a.started_at));
    return migrationBatches.length > 0 ? toBatch(migrationBatches[0]) : null;
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("import_batch")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("source", "migration")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch latest migration batch: ${error.message}`);
  }

  if (!data) return null;
  return toValidatedBatch(data);
}

export async function deleteImportBatchCandidates(batchId: string): Promise<void> {
  if (shouldUseInMemoryPersistenceForTests()) {
    // In-memory: no-op (candidates tracked separately)
    return;
  }

  const client = getSupabaseAdminClient();
  const { error } = await client.rpc("rollback_import_batch", {
    p_batch_id: batchId,
  });

  if (error) {
    throw new Error(`Failed to rollback import batch: ${error.message}`);
  }
}
