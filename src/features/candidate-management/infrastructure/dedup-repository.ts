import {
  getSupabaseAdminClient,
  shouldUseInMemoryPersistenceForTests,
} from "@/modules/persistence";
import type {
  CandidateForDedup,
  DedupDecision,
  DedupDecisionType,
  DedupStats,
  ReviewQueueItem,
  ReviewQueueStatus,
} from "../contracts/dedup";

// ---------------------------------------------------------------------------
// In-memory stores for tests
// ---------------------------------------------------------------------------
const inMemoryDecisions: DedupDecision[] = [];
const inMemoryReviewQueue: ReviewQueueItem[] = [];
let inMemoryIdSeq = 1;

export function clearDedupStoresForTest(): void {
  if (!shouldUseInMemoryPersistenceForTests()) return;
  inMemoryDecisions.length = 0;
  inMemoryReviewQueue.length = 0;
  inMemoryIdSeq = 1;
}

// ---------------------------------------------------------------------------
// Row → domain mappers
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function toCandidateForDedup(row: any): CandidateForDedup {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email ?? null,
    phone: row.phone ?? null,
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    jobTitle: row.job_title ?? null,
    location: row.location ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    skills: Array.isArray(row.skills) ? row.skills : [],
    certifications: Array.isArray(row.certifications) ? row.certifications : [],
    aircraftExperience: Array.isArray(row.aircraft_experience) ? row.aircraft_experience : [],
    extraAttributes: row.extra_attributes ?? {},
    yearsOfExperience: row.years_of_experience ?? null,
    resumeUrl: row.resume_url ?? null,
    linkedinUrl: row.linkedin_url ?? null,
    source: row.source ?? null,
    ingestionState: row.ingestion_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toReviewQueueItem(row: any): ReviewQueueItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    candidateAId: row.candidate_a_id,
    candidateBId: row.candidate_b_id,
    confidenceScore: Number(row.confidence_score),
    fieldDiffs: row.field_diffs ?? {},
    status: row.status,
    resolvedBy: row.resolved_by ?? null,
    resolvedAt: row.resolved_at ?? null,
    createdAt: row.created_at,
  };
}

function toDedupDecision(row: any): DedupDecision {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    candidateAId: row.candidate_a_id,
    candidateBId: row.candidate_b_id,
    decisionType: row.decision_type,
    confidenceScore: Number(row.confidence_score),
    rationale: row.rationale,
    actor: row.actor,
    traceId: row.trace_id ?? null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Core dedup functions
// ---------------------------------------------------------------------------

/**
 * Find candidates whose candidate_identity fingerprint matches the given hash.
 * Returns candidate IDs (excluding the candidate being evaluated).
 */
export async function findIdentityMatches(
  tenantId: string,
  identityHash: string,
  excludeCandidateId?: string,
): Promise<string[]> {
  if (shouldUseInMemoryPersistenceForTests()) return [];

  const db = getSupabaseAdminClient();
  let query = db
    .from("content_fingerprints")
    .select("candidate_id")
    .eq("tenant_id", tenantId)
    .eq("fingerprint_type", "candidate_identity")
    .eq("fingerprint_hash", identityHash)
    .eq("status", "processed")
    .not("candidate_id", "is", null);

  if (excludeCandidateId) {
    query = query.neq("candidate_id", excludeCandidateId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`findIdentityMatches failed: ${error.message}`);
  return (data ?? []).map((r: { candidate_id: string }) => r.candidate_id);
}

/**
 * Pass 2: Raw field query for phone/name matches via RPC with server-side normalization.
 * Uses regexp_replace in Postgres to normalize phone — no TS-side filtering.
 * Also searches pending_review candidates (H5 fix).
 */
export async function findRawFieldMatches(
  tenantId: string,
  normalizedPhone: string,
  firstName: string,
  lastName: string,
  excludeCandidateId?: string,
): Promise<CandidateForDedup[]> {
  if (shouldUseInMemoryPersistenceForTests()) return [];
  if (!normalizedPhone && (!firstName || !lastName)) return [];

  const db = getSupabaseAdminClient();
  const { data, error } = await db.rpc("find_dedup_field_matches", {
    p_tenant_id: tenantId,
    p_normalized_phone: normalizedPhone ?? "",
    p_first_name: firstName ?? "",
    p_last_name: lastName ?? "",
    p_exclude_id: excludeCandidateId ?? null,
  });

  if (error) throw new Error(`findRawFieldMatches RPC failed: ${error.message}`);
  return (data ?? []).map(toCandidateForDedup);
}

/**
 * Load a candidate with all fields needed for dedup evaluation.
 */
export async function loadCandidateForDedup(
  tenantId: string,
  candidateId: string,
): Promise<CandidateForDedup | null> {
  if (shouldUseInMemoryPersistenceForTests()) return null;

  const db = getSupabaseAdminClient();
  const { data, error } = await db
    .from("candidates")
    .select("id, tenant_id, email, phone, first_name, last_name, job_title, location, city, state, skills, certifications, aircraft_experience, extra_attributes, years_of_experience, resume_url, linkedin_url, source, ingestion_state, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("id", candidateId)
    .maybeSingle();

  if (error) throw new Error(`loadCandidateForDedup failed: ${error.message}`);
  return data ? toCandidateForDedup(data) : null;
}

/**
 * List candidates in pending_dedup state for the dedup worker.
 */
export async function listPendingDedupCandidates(
  tenantId: string,
  limit: number = 100,
): Promise<CandidateForDedup[]> {
  if (shouldUseInMemoryPersistenceForTests()) return [];

  const db = getSupabaseAdminClient();
  const { data, error } = await db
    .from("candidates")
    .select("id, tenant_id, email, phone, first_name, last_name, job_title, location, city, state, skills, certifications, aircraft_experience, extra_attributes, years_of_experience, resume_url, linkedin_url, source, ingestion_state, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("ingestion_state", "pending_dedup")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`listPendingDedupCandidates failed: ${error.message}`);
  return (data ?? []).map(toCandidateForDedup);
}

/**
 * Call merge_candidates RPC for atomic merge operation.
 */
export async function callMergeCandidatesRpc(
  winnerId: string,
  loserId: string,
  mergedFields: Record<string, unknown>,
  decision: {
    decision_type: DedupDecisionType;
    confidence_score: number;
    rationale: string;
    actor?: string;
    trace_id?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (shouldUseInMemoryPersistenceForTests()) {
    inMemoryDecisions.push({
      id: inMemoryIdSeq++,
      tenantId: "test",
      candidateAId: winnerId,
      candidateBId: loserId,
      decisionType: decision.decision_type,
      confidenceScore: decision.confidence_score,
      rationale: decision.rationale,
      actor: decision.actor ?? "system",
      traceId: decision.trace_id ?? null,
      metadata: decision.metadata ?? {},
      createdAt: new Date().toISOString(),
    });
    return;
  }

  const db = getSupabaseAdminClient();
  const { error } = await db.rpc("merge_candidates", {
    p_winner_id: winnerId,
    p_loser_id: loserId,
    p_merged_fields: mergedFields,
    p_decision: decision,
  });

  if (error) throw new Error(`merge_candidates RPC failed: ${error.message}`);
  console.log(JSON.stringify({ level: 'info', module: 'DedupRepository', action: 'merge_candidates', winnerId, loserId, decisionType: decision.decision_type, confidence: decision.confidence_score }));
}

/**
 * Update a candidate's ingestion_state (used for promoting to active or pending_review).
 */
export async function updateCandidateIngestionState(
  candidateId: string,
  newState: string,
  tenantId?: string,
): Promise<void> {
  if (shouldUseInMemoryPersistenceForTests()) return;

  const db = getSupabaseAdminClient();
  let query = db
    .from("candidates")
    .update({ ingestion_state: newState, updated_at: new Date().toISOString() })
    .eq("id", candidateId);

  if (tenantId) query = query.eq("tenant_id", tenantId);

  const { error } = await query;
  if (error) throw new Error(`updateCandidateIngestionState failed: ${error.message}`);
}

/**
 * Insert a review queue item for manual review.
 */
export async function createReviewItem(
  tenantId: string,
  candidateAId: string,
  candidateBId: string,
  confidenceScore: number,
  fieldDiffs: Record<string, { a: unknown; b: unknown }>,
): Promise<void> {
  if (shouldUseInMemoryPersistenceForTests()) {
    inMemoryReviewQueue.push({
      id: inMemoryIdSeq++,
      tenantId,
      candidateAId,
      candidateBId,
      confidenceScore,
      fieldDiffs,
      status: "pending",
      resolvedBy: null,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
    });
    return;
  }

  const db = getSupabaseAdminClient();
  const { error } = await db.from("dedup_review_queue").insert({
    tenant_id: tenantId,
    candidate_a_id: candidateAId,
    candidate_b_id: candidateBId,
    confidence_score: confidenceScore,
    field_diffs: fieldDiffs,
  });

  if (error) throw new Error(`createReviewItem failed: ${error.message}`);
  console.log(JSON.stringify({ level: 'info', module: 'DedupRepository', action: 'create_review_item', tenantId, candidateAId, candidateBId, confidenceScore }));
}

/**
 * Record a dedup decision in the audit table.
 */
export async function recordDedupDecision(params: {
  tenantId: string;
  candidateAId: string;
  candidateBId: string;
  decisionType: DedupDecisionType;
  confidenceScore: number;
  rationale: string;
  actor?: string;
  traceId?: string;
}): Promise<void> {
  if (shouldUseInMemoryPersistenceForTests()) {
    inMemoryDecisions.push({
      id: inMemoryIdSeq++,
      tenantId: params.tenantId,
      candidateAId: params.candidateAId,
      candidateBId: params.candidateBId,
      decisionType: params.decisionType,
      confidenceScore: params.confidenceScore,
      rationale: params.rationale,
      actor: params.actor ?? "system",
      traceId: params.traceId ?? null,
      metadata: {},
      createdAt: new Date().toISOString(),
    });
    return;
  }

  const db = getSupabaseAdminClient();
  const { error } = await db.from("dedup_decisions").insert({
    tenant_id: params.tenantId,
    candidate_a_id: params.candidateAId,
    candidate_b_id: params.candidateBId,
    decision_type: params.decisionType,
    confidence_score: params.confidenceScore,
    rationale: params.rationale,
    actor: params.actor ?? "system",
    trace_id: params.traceId ?? null,
  });

  if (error) throw new Error(`recordDedupDecision failed: ${error.message}`);
  console.log(JSON.stringify({ level: 'info', module: 'DedupRepository', action: 'record_decision', tenantId: params.tenantId, type: params.decisionType, confidence: params.confidenceScore }));
}

/**
 * List pending review items (paginated).
 */
export async function listPendingReviews(
  tenantId: string,
  limit: number = 50,
  offset: number = 0,
): Promise<ReviewQueueItem[]> {
  if (shouldUseInMemoryPersistenceForTests()) {
    return inMemoryReviewQueue
      .filter((r) => r.tenantId === tenantId && r.status === "pending")
      .slice(offset, offset + limit);
  }

  const db = getSupabaseAdminClient();
  const { data, error } = await db
    .from("dedup_review_queue")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(`listPendingReviews failed: ${error.message}`);
  return (data ?? []).map(toReviewQueueItem);
}

/**
 * Get a single review item by ID.
 */
export async function getReviewById(
  reviewId: number,
  tenantId: string,
): Promise<ReviewQueueItem | null> {
  if (shouldUseInMemoryPersistenceForTests()) {
    return inMemoryReviewQueue.find((r) => r.id === reviewId && r.tenantId === tenantId) ?? null;
  }

  const db = getSupabaseAdminClient();
  const { data, error } = await db
    .from("dedup_review_queue")
    .select("*")
    .eq("id", reviewId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw new Error(`getReviewById failed: ${error.message}`);
  return data ? toReviewQueueItem(data) : null;
}

/**
 * Resolve a review item (approve or reject).
 */
export async function resolveReview(
  reviewId: number,
  tenantId: string,
  decision: "approved" | "rejected",
  actorId: string,
): Promise<void> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const item = inMemoryReviewQueue.find((r) => r.id === reviewId && r.tenantId === tenantId);
    if (item) {
      item.status = decision;
      item.resolvedBy = actorId;
      item.resolvedAt = new Date().toISOString();
    }
    return;
  }

  const db = getSupabaseAdminClient();
  const { error } = await db
    .from("dedup_review_queue")
    .update({
      status: decision,
      resolved_by: actorId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", reviewId)
    .eq("tenant_id", tenantId);

  if (error) throw new Error(`resolveReview failed: ${error.message}`);
  console.log(JSON.stringify({ level: 'info', module: 'DedupRepository', action: 'resolve_review', reviewId, tenantId, decision, actorId }));
}

/**
 * Get dedup statistics for a tenant.
 */
export async function getDedupStats(tenantId: string): Promise<DedupStats> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const decisions = inMemoryDecisions.filter((d) => d.tenantId === tenantId);
    const pendingReviews = inMemoryReviewQueue.filter((r) => r.tenantId === tenantId && r.status === "pending");
    return {
      autoMerged: decisions.filter((d) => d.decisionType === "auto_merge").length,
      manualMerged: decisions.filter((d) => d.decisionType === "manual_merge").length,
      manualRejected: decisions.filter((d) => d.decisionType === "manual_reject").length,
      keptSeparate: decisions.filter((d) => d.decisionType === "keep_separate").length,
      pendingReview: pendingReviews.length,
    };
  }

  const db = getSupabaseAdminClient();

  // Decision counts via RPC (GROUP BY in SQL — O(1) not O(N))
  const { data: groupData, error: decErr } = await db.rpc("get_dedup_stats", {
    p_tenant_id: tenantId,
  });

  if (decErr) throw new Error(`getDedupStats RPC failed: ${decErr.message}`);

  const stats: DedupStats = { autoMerged: 0, manualMerged: 0, manualRejected: 0, keptSeparate: 0, pendingReview: 0 };
  for (const row of groupData ?? []) {
    const cnt = Number(row.cnt);
    if (row.decision_type === "auto_merge") stats.autoMerged = cnt;
    else if (row.decision_type === "manual_merge") stats.manualMerged = cnt;
    else if (row.decision_type === "manual_reject") stats.manualRejected = cnt;
    else if (row.decision_type === "keep_separate") stats.keptSeparate = cnt;
  }

  // Pending review count
  const { count, error: revErr } = await db
    .from("dedup_review_queue")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "pending");

  if (revErr) throw new Error(`getDedupStats reviews failed: ${revErr.message}`);
  stats.pendingReview = count ?? 0;

  return stats;
}
