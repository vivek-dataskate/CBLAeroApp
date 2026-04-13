/**
 * Centralized repository for sync_errors table access.
 * All sync error reads/writes go through here — no direct db.from('sync_errors') elsewhere.
 */
import {
  getSupabaseAdminClient,
  isSupabaseConfigured,
} from "@/modules/persistence";

export type SyncError = {
  id: string;
  source: string;
  recordId: string;
  message: string;
  timestamp: string;
};

export type SyncRun = {
  id: string;
  source: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  succeeded: number;
  failed: number;
  total: number;
  errorMessage: string | null;
};

const SYNC_ERROR_MAX = 100;
// In-memory buffer for fast reads; also persisted to Supabase when configured.
const recentSyncErrors: SyncError[] = [];

/**
 * Record a sync failure — persists to Supabase (fire-and-forget) and keeps in-memory buffer.
 * When runId is provided, the error is linked to the parent sync_runs row.
 */
export function recordSyncFailure(source: string, recordId: string, err: unknown, runId?: string | null): void {
  const error: SyncError = {
    id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    source,
    recordId,
    message: err instanceof Error ? (err.stack ?? err.message) : String(err),
    timestamp: new Date().toISOString(),
  };
  recentSyncErrors.unshift(error);
  if (recentSyncErrors.length > SYNC_ERROR_MAX) {
    recentSyncErrors.splice(SYNC_ERROR_MAX);
  }
  // Persist to Supabase (fire-and-forget — don't block the caller)
  if (isSupabaseConfigured()) {
    const db = getSupabaseAdminClient();
    const row: Record<string, unknown> = {
      source,
      record_id: recordId,
      message: error.message,
      occurred_at: error.timestamp,
    };
    if (runId) row.run_id = runId;
    Promise.resolve(
      db.from("sync_errors").insert(row),
    )
      .then(({ error: dbErr }) => {
        if (dbErr) {
          console.error("[SyncError] Failed to persist:", dbErr.message);
          return;
        }
        // Prune rows older than 30 days (fire-and-forget cleanup — covers both tables)
        // Delete sync_errors first (child), then sync_runs (parent) to respect FK
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        Promise.resolve(
          db.from("sync_errors").delete().lt("occurred_at", cutoff),
        ).then(() =>
          db.from("sync_runs").delete().lt("started_at", cutoff).then(() => {}),
        ).catch(() => {});
      })
      .catch((e: unknown) => {
        console.error("[SyncError] Persist transport error:", e instanceof Error ? e.message : e);
      });
  }
}

/**
 * List recent sync errors. Prefers Supabase; falls back to in-memory.
 */
export async function listRecentSyncErrors(): Promise<SyncError[]> {
  if (isSupabaseConfigured()) {
    const db = getSupabaseAdminClient();
    const { data, error } = await db
      .from("sync_errors")
      .select("id, source, record_id, message, occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(SYNC_ERROR_MAX);
    if (error) {
      console.error("[SyncError] Failed to query sync_errors:", error.message);
    } else if (data) {
      return data.map(
        (r: { id: string; source: string; record_id: string; message: string; occurred_at: string }) => ({
          id: String(r.id),
          source: r.source,
          recordId: r.record_id,
          message: r.message,
          timestamp: r.occurred_at,
        }),
      );
    }
  }
  return [...recentSyncErrors];
}

export function clearSyncErrorsForTest(): void {
  recentSyncErrors.splice(0);
}

// -----------------------------------------------------------------------
// Sync run tracking — batch-level summary of ingestion job execution
// -----------------------------------------------------------------------

/**
 * Create a sync run row at job start. Returns the run id, or null on failure
 * (never throws — run tracking must not block ingestion).
 */
export async function createSyncRun(source: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const db = getSupabaseAdminClient();
    const { data, error } = await db
      .from("sync_runs")
      .insert({ source })
      .select("id")
      .single();
    if (error) {
      console.error("[SyncRun] Failed to create run:", error.message);
      return null;
    }
    return data.id;
  } catch (e) {
    console.error("[SyncRun] Create transport error:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Mark a sync run as complete with final counts. No-op if runId is null.
 */
export async function completeSyncRun(
  runId: string | null,
  counts: { succeeded: number; failed: number; total: number },
): Promise<void> {
  if (!runId || !isSupabaseConfigured()) return;
  try {
    const db = getSupabaseAdminClient();
    const { error } = await db
      .from("sync_runs")
      .update({
        status: "complete",
        completed_at: new Date().toISOString(),
        succeeded: counts.succeeded,
        failed: counts.failed,
        total: counts.total,
      })
      .eq("id", runId);
    if (error) console.error("[SyncRun] Failed to complete run:", error.message);
  } catch (e) {
    console.error("[SyncRun] Complete transport error:", e instanceof Error ? e.message : e);
  }
}

/**
 * Mark a sync run as failed. No-op if runId is null.
 */
export async function failSyncRun(runId: string | null, errorMessage: string): Promise<void> {
  if (!runId || !isSupabaseConfigured()) return;
  try {
    const db = getSupabaseAdminClient();
    const { error: dbErr } = await db
      .from("sync_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: errorMessage.slice(0, 2000),
      })
      .eq("id", runId);
    if (dbErr) console.error("[SyncRun] Failed to mark run as failed:", dbErr.message);
  } catch (e) {
    console.error("[SyncRun] Fail transport error:", e instanceof Error ? e.message : e);
  }
}

/**
 * List sync runs for the current month, ordered by started_at desc.
 */
export async function listSyncRunsCurrentMonth(): Promise<SyncRun[]> {
  if (!isSupabaseConfigured()) return [];
  const db = getSupabaseAdminClient();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const { data, error } = await db
    .from("sync_runs")
    .select("id, source, status, started_at, completed_at, succeeded, failed, total, error_message")
    .gte("started_at", monthStart.toISOString())
    .order("started_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[SyncRun] Failed to list runs:", error.message);
    return [];
  }
  return (data ?? []).map((r: { id: string; source: string; status: string; started_at: string; completed_at: string | null; succeeded: number; failed: number; total: number; error_message: string | null }) => ({
    id: r.id,
    source: r.source,
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    succeeded: r.succeeded,
    failed: r.failed,
    total: r.total,
    errorMessage: r.error_message,
  }));
}

/**
 * List all sync errors for a specific run, ordered by occurred_at desc.
 */
export async function listSyncErrorsByRun(runId: string): Promise<SyncError[]> {
  if (!isSupabaseConfigured()) return [];
  const db = getSupabaseAdminClient();
  const { data, error } = await db
    .from("sync_errors")
    .select("id, source, record_id, message, occurred_at")
    .eq("run_id", runId)
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("[SyncError] Failed to list errors by run:", error.message);
    return [];
  }
  return (data ?? []).map(
    (r: { id: string; source: string; record_id: string; message: string; occurred_at: string }) => ({
      id: String(r.id),
      source: r.source,
      recordId: r.record_id,
      message: r.message,
      timestamp: r.occurred_at,
    }),
  );
}

// -----------------------------------------------------------------------
// Key-value marker storage (uses sync_errors table as lightweight KV store)
// -----------------------------------------------------------------------

/**
 * Read a marker value stored as a sync_errors row (e.g., resume page for initial load).
 */
export async function getMarkerValue(markerSource: string, markerRecordId: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  const db = getSupabaseAdminClient();
  const { data, error } = await db
    .from("sync_errors")
    .select("message")
    .eq("source", markerSource)
    .eq("record_id", markerRecordId)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`[SyncError] Failed to read marker ${markerSource}:`, error.message);
    return null;
  }

  return data?.message ?? null;
}

/**
 * Write a marker value as a sync_errors row.
 */
export async function setMarkerValue(markerSource: string, markerRecordId: string, value: string): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const db = getSupabaseAdminClient();
  const { error } = await db.from("sync_errors").insert({
    source: markerSource,
    record_id: markerRecordId,
    message: value,
  });

  if (error) {
    console.error(`[SyncError] Failed to write marker ${markerSource}:`, error.message);
  }
}
