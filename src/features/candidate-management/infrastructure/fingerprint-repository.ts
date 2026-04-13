import { createHash } from "crypto";
import {
  getSupabaseAdminClient,
  shouldUseInMemoryPersistenceForTests,
} from "@/modules/persistence";

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

export type FingerprintType =
  | "file_sha256"
  | "email_message_id"
  | "csv_row_hash"
  | "ats_external_id"
  | "candidate_identity";

export type FingerprintSource =
  | "email"
  | "ats"
  | "csv"
  | "ceipal"
  | "resume_upload"
  | "onedrive"
  | "dedup";

export type FingerprintStatus = "processed" | "failed";

export type ContentFingerprint = {
  id: number;
  tenantId: string;
  fingerprintType: FingerprintType;
  fingerprintHash: string;
  source: FingerprintSource;
  status: FingerprintStatus;
  candidateId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type RecordFingerprintParams = {
  tenantId: string;
  type: FingerprintType;
  hash: string;
  source: FingerprintSource;
  candidateId?: string | null;
  metadata?: Record<string, unknown>;
  status?: FingerprintStatus;
};

// -----------------------------------------------------------------------
// Row type (DB shape)
// -----------------------------------------------------------------------

type FingerprintRow = {
  id: number;
  tenant_id: string;
  fingerprint_type: string;
  fingerprint_hash: string;
  source: string;
  status: string;
  candidate_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

// -----------------------------------------------------------------------
// Row mapping
// -----------------------------------------------------------------------

function toFingerprint(row: FingerprintRow): ContentFingerprint {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    fingerprintType: row.fingerprint_type as FingerprintType,
    fingerprintHash: row.fingerprint_hash,
    source: row.source as FingerprintSource,
    status: row.status as FingerprintStatus,
    candidateId: row.candidate_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

// -----------------------------------------------------------------------
// In-memory store (test mode only)
// -----------------------------------------------------------------------

let nextId = 1;
const fingerprintStore = new Map<string, FingerprintRow>();

function storeKey(tenantId: string, type: string, hash: string): string {
  return `${tenantId}::${type}::${hash}`;
}

export function seedFingerprintsForTest(fingerprint: ContentFingerprint): void {
  const key = storeKey(fingerprint.tenantId, fingerprint.fingerprintType, fingerprint.fingerprintHash);
  fingerprintStore.set(key, {
    id: fingerprint.id,
    tenant_id: fingerprint.tenantId,
    fingerprint_type: fingerprint.fingerprintType,
    fingerprint_hash: fingerprint.fingerprintHash,
    source: fingerprint.source,
    status: fingerprint.status,
    candidate_id: fingerprint.candidateId,
    metadata: fingerprint.metadata,
    created_at: fingerprint.createdAt,
  });
}

export function clearFingerprintsForTest(): void {
  if (!shouldUseInMemoryPersistenceForTests()) return;
  fingerprintStore.clear();
  nextId = 1;
}

// -----------------------------------------------------------------------
// Hash computation utilities
// -----------------------------------------------------------------------

export function computeFileHash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function computeIdentityHash(
  email?: string | null,
  firstName?: string | null,
  lastName?: string | null,
  phone?: string | null,
): string {
  if (email) {
    return createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
  }
  const namePart = `${(firstName ?? "").toLowerCase().trim()}${(lastName ?? "").toLowerCase().trim()}`;
  const phonePart = (phone ?? "").replace(/\D/g, "");
  if (!namePart && !phonePart) return "";
  return createHash("sha256").update(`${namePart}|${phonePart}`).digest("hex");
}

export function computeRowHash(
  email?: string | null,
  firstName?: string | null,
  lastName?: string | null,
  phone?: string | null,
): string {
  const emailPart = (email ?? "").toLowerCase().trim();
  const namePart = `${(firstName ?? "").toLowerCase().trim()}${(lastName ?? "").toLowerCase().trim()}`;
  const phonePart = (phone ?? "").replace(/\D/g, "");
  return createHash("sha256").update(`${emailPart}|${namePart}|${phonePart}`).digest("hex");
}

// -----------------------------------------------------------------------
// Public repository functions
// -----------------------------------------------------------------------

export async function isAlreadyProcessed(
  tenantId: string,
  type: FingerprintType,
  hash: string,
): Promise<boolean> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const key = storeKey(tenantId, type, hash);
    const row = fingerprintStore.get(key);
    return row !== undefined && row.status === "processed";
  }

  // Uses check_and_record_fingerprint RPC in check-only mode (status=null skips recording)
  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("content_fingerprints")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("fingerprint_type", type)
    .eq("fingerprint_hash", hash)
    .eq("status", "processed")
    .maybeSingle();

  if (error) {
    throw new Error(`[Fingerprint] Lookup failed: ${error.message}`);
  }

  return data !== null;
}

export async function recordFingerprint(params: RecordFingerprintParams): Promise<void> {
  const status = params.status ?? "processed";

  if (shouldUseInMemoryPersistenceForTests()) {
    const key = storeKey(params.tenantId, params.type, params.hash);
    const id = nextId++;
    fingerprintStore.set(key, {
      id,
      tenant_id: params.tenantId,
      fingerprint_type: params.type,
      fingerprint_hash: params.hash,
      source: params.source,
      status,
      candidate_id: params.candidateId ?? null,
      metadata: params.metadata ?? {},
      created_at: new Date().toISOString(),
    });
    return;
  }

  const client = getSupabaseAdminClient();
  const { error } = await client.rpc("check_and_record_fingerprint", {
    p_tenant_id: params.tenantId,
    p_type: params.type,
    p_hash: params.hash,
    p_source: params.source,
    p_candidate_id: params.candidateId ?? null,
    p_metadata: params.metadata ?? {},
    p_status: status,
  });

  if (error) {
    throw new Error(`[Fingerprint] Record failed: ${error.message}`);
  }
}

export async function recordFingerprintBatch(
  items: RecordFingerprintParams[],
): Promise<void> {
  if (items.length === 0) return;

  if (shouldUseInMemoryPersistenceForTests()) {
    for (const params of items) {
      const key = storeKey(params.tenantId, params.type, params.hash);
      const id = nextId++;
      fingerprintStore.set(key, {
        id,
        tenant_id: params.tenantId,
        fingerprint_type: params.type,
        fingerprint_hash: params.hash,
        source: params.source,
        status: params.status ?? "processed",
        candidate_id: params.candidateId ?? null,
        metadata: params.metadata ?? {},
        created_at: new Date().toISOString(),
      });
    }
    return;
  }

  const client = getSupabaseAdminClient();
  const rows = items.map((p) => ({
    tenant_id: p.tenantId,
    fingerprint_type: p.type,
    fingerprint_hash: p.hash,
    source: p.source,
    status: p.status ?? "processed",
    candidate_id: p.candidateId ?? null,
    metadata: p.metadata ?? {},
  }));

  const { error } = await client.rpc("upsert_fingerprint_batch", {
    p_fingerprints: rows,
  });

  if (error) {
    throw new Error(`[Fingerprint] Batch record failed: ${error.message}`);
  }
}

export async function loadRecentFingerprints(
  tenantId: string,
  type: FingerprintType,
  days: number = 30,
): Promise<Set<string>> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const result = new Set<string>();
    for (const row of fingerprintStore.values()) {
      if (
        row.tenant_id === tenantId &&
        row.fingerprint_type === type &&
        row.status === "processed"
      ) {
        result.add(row.fingerprint_hash);
      }
    }
    return result;
  }

  const MAX_FINGERPRINTS = 100_000;
  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc("load_recent_fingerprints", {
    p_tenant_id: tenantId,
    p_type: type,
    p_days: days,
    p_max_count: MAX_FINGERPRINTS,
  });

  if (error) {
    throw new Error(`[Fingerprint] Batch load failed: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{ fingerprint_hash: string }>;
  if (rows.length >= MAX_FINGERPRINTS) {
    console.warn(`[Fingerprint] Hit ${MAX_FINGERPRINTS} limit for ${type} — some duplicates may not be caught`);
  }

  return new Set(rows.map((row) => row.fingerprint_hash));
}
