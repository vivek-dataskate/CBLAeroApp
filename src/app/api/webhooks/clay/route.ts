/**
 * Clay Webhook Ingestion Endpoint — Story 2.8
 *
 * Receives per-row HTTP pushes from Clay's "HTTP API" column. Each row goes
 * through the standard dedup/fingerprint/role-deduction pipeline and lands in
 * `candidates` with `source = clay_enrichment`. Recruiter-level attribution
 * is out of scope — every row is stamped to the configured default assignee
 * (`CLAY_DEFAULT_ASSIGNEE_EMAIL`) via `source_recruiter_actor_id`.
 *
 * ── Authentication ──
 * Shared-secret bearer token in the Authorization header:
 *   Authorization: Bearer ${CLAY_WEBHOOK_SECRET}
 * Requests without a valid token are rejected with HTTP 401.
 *
 * ── Payload shapes accepted ──
 *   (1) A single row object:    { ... }
 *   (2) An array of row objects: [ { ... }, { ... } ]
 *   (3) A wrapped payload:       { "rows": [ ... ] }   (Clay templates sometimes nest)
 *
 * ── Response ──
 *   200 OK with per-row outcome counts (even when some rows errored — row-level
 *   errors accumulate in sync_run_errors, but the overall request is "accepted"
 *   so Clay doesn't retry the whole batch on a single bad row).
 *   400 Bad Request — malformed JSON body.
 *   401 Unauthorized — missing/wrong bearer token.
 *   503 Service Unavailable — startup validation failed (e.g. assignee user
 *       doesn't exist), so we refuse to accept any Clay traffic at all.
 *
 * ── Debug mode ──
 * On every request, the full raw payload is logged (stringified) for the first
 * few rollouts so we can inspect exactly what Clay sends. Toggle off via
 * `CLAY_WEBHOOK_DEBUG=false` once the mapper is stable.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  mapClayRowToCandidate,
  computeClayFingerprint,
  type ClayMapperConfig,
} from '@/modules/ingestion/clay-mapper';
import {
  createSyncRun,
  completeSyncRun,
  failSyncRun,
  recordSyncFailure,
  batchUpsertCandidatesFromATS,
  DEFAULT_TENANT_ID,
} from '@/modules/ingestion';
import {
  isAlreadyProcessed,
  recordFingerprint,
} from '@/features/candidate-management/infrastructure/fingerprint-repository';
import { getSupabaseAdminClient, isSupabaseConfigured } from '@/modules/persistence';

// ── Configuration ────────────────────────────────────────────────────────────

const CLAY_WEBHOOK_SECRET = process.env.CLAY_WEBHOOK_SECRET;
const CLAY_DEFAULT_ASSIGNEE_EMAIL = process.env.CLAY_DEFAULT_ASSIGNEE_EMAIL;
// Sidecar column names in the Clay payload. Defaults match the production
// Clay HTTP API column config observed on 2026-04-15 (lowercase `email` / `phone`
// emitted by Clay's default body template, confirmed via webhook.site capture).
// Override via env vars if the Clay column names change.
const CLAY_EMAIL_FIELD = process.env.CLAY_EMAIL_FIELD || 'email';
const CLAY_PHONE_FIELD = process.env.CLAY_PHONE_FIELD || 'phone';
// Top-level key where Clay nests the LinkedIn enrichment blob. Default matches
// the production Clay Enrich Person column (confirmed 2026-04-15). If Clay's
// column is renamed in the UI, override via env var — no code redeploy needed.
const CLAY_BLOB_FIELD = process.env.CLAY_BLOB_FIELD || 'enrichlinkedin_data';
const CLAY_WEBHOOK_DEBUG = (process.env.CLAY_WEBHOOK_DEBUG ?? 'true').toLowerCase() !== 'false';

// Max payload size — Next.js defaults are higher but we want an explicit ceiling
// for webhook requests specifically. 256 KB covers both single-row and small batches.
const MAX_PAYLOAD_BYTES = 256 * 1024;

// ── Startup user ID cache ────────────────────────────────────────────────────
// Lazily resolved on first request; cached for the process lifetime.
// Failing to resolve returns HTTP 503 for every Clay request until the admin
// provisions the user.

let cachedAssigneeUserId: string | null = null;
let cachedAssigneeError: string | null = null;

async function resolveAssigneeUserId(): Promise<{ userId: string | null; error: string | null }> {
  if (cachedAssigneeUserId) return { userId: cachedAssigneeUserId, error: null };
  if (cachedAssigneeError) return { userId: null, error: cachedAssigneeError };

  if (!CLAY_DEFAULT_ASSIGNEE_EMAIL) {
    cachedAssigneeError = 'CLAY_DEFAULT_ASSIGNEE_EMAIL env var is not set';
    return { userId: null, error: cachedAssigneeError };
  }

  if (!isSupabaseConfigured()) {
    // Test/dev mode — let the pipeline run with a synthetic ID so tests still work.
    cachedAssigneeUserId = `test-assignee:${CLAY_DEFAULT_ASSIGNEE_EMAIL}`;
    return { userId: cachedAssigneeUserId, error: null };
  }

  try {
    const client = getSupabaseAdminClient();
    const { data, error } = await client
      .from('admin_managed_users')
      .select('actor_id')
      .eq('tenant_id', DEFAULT_TENANT_ID)
      .eq('email', CLAY_DEFAULT_ASSIGNEE_EMAIL)
      .maybeSingle();

    if (error) {
      // Don't cache the error — transient DB issues shouldn't poison the cache.
      return { userId: null, error: `Failed to query assignee user: ${error.message}` };
    }
    if (!data?.actor_id) {
      cachedAssigneeError =
        `Assignee user ${CLAY_DEFAULT_ASSIGNEE_EMAIL} not found in tenant ${DEFAULT_TENANT_ID}. ` +
        `Provision via admin console (Story 1.4) then restart the process.`;
      return { userId: null, error: cachedAssigneeError };
    }
    cachedAssigneeUserId = data.actor_id as string;
    return { userId: cachedAssigneeUserId, error: null };
  } catch (e) {
    return { userId: null, error: `Assignee resolution transport error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Test hook — clear the cached assignee so unit tests can rerun resolution. */
export function __resetClayWebhookCacheForTests(): void {
  cachedAssigneeUserId = null;
  cachedAssigneeError = null;
}

// ── Payload normalization ────────────────────────────────────────────────────

function normalizePayload(body: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(body)) {
    return body.filter((r) => r && typeof r === 'object' && !Array.isArray(r)) as Record<string, unknown>[];
  }
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    // Handle `{ "rows": [...] }` wrapped payloads — some Clay templates nest.
    if (Array.isArray(obj.rows)) {
      return obj.rows.filter((r) => r && typeof r === 'object' && !Array.isArray(r)) as Record<string, unknown>[];
    }
    // Single-row object
    return [obj];
  }
  return null;
}

// ── Per-row processing ──────────────────────────────────────────────────────

interface RowOutcome {
  status: 'accepted' | 'skipped_fingerprint' | 'skipped_no_identity' | 'error';
  fingerprint?: string;
  error?: string;
}

async function processRow(
  rawRow: Record<string, unknown>,
  config: ClayMapperConfig,
  runId: string | null,
): Promise<RowOutcome> {
  // 1. Compute fingerprint (Story 1.11 gate — mandatory first step per development-standards §3)
  const fingerprint = computeClayFingerprint(rawRow, config);
  if (!fingerprint) {
    return { status: 'skipped_no_identity', error: 'No profile_id + last_refresh, and no sidecar email' };
  }

  // 2. Fingerprint hit? Short-circuit before any mapping or upsert work.
  try {
    const seen = await isAlreadyProcessed(DEFAULT_TENANT_ID, 'ats_external_id', fingerprint);
    if (seen) {
      console.log(JSON.stringify({
        event: 'fingerprint_hit',
        type: 'ats_external_id',
        source: 'ats',
        tenantId: DEFAULT_TENANT_ID,
        hash: fingerprint.slice(0, 24),
      }));
      return { status: 'skipped_fingerprint', fingerprint };
    }
  } catch (fpErr) {
    console.error('[ClayWebhook] Fingerprint check failed, continuing without short-circuit:',
      fpErr instanceof Error ? fpErr.message : fpErr);
    // Fall through — better to process a row twice than lose it.
  }

  // 3. Map Clay row → canonical camelCase candidate record (still pure — no I/O yet)
  const mapped = mapClayRowToCandidate(rawRow, config);

  // 4. Delegate to the shared ingestion path. `batchUpsertCandidatesFromATS` already handles:
  //    - email/phone validation (rejects rows with neither, calls recordSyncFailure)
  //    - `mapToCandidateRow` conversion with source attribution
  //    - with-email upsert vs no-email insert split
  //    - fallback to individual inserts on batch failure
  //    - `batchUpsertCandidatesByEmail` RPC invocation (the canonical upsert path)
  //    Reusing this keeps Clay on the same pipeline as ATS/Ceipal/CSV — no parallel code path.
  //    The record is typed as Record<string, unknown> because the shared helper accepts
  //    camelCase records uniformly; ClayMappedCandidate is a structural subtype.
  let batchResult: { inserted: number; failed: number };
  try {
    batchResult = await batchUpsertCandidatesFromATS([mapped as unknown as Record<string, unknown>]);
  } catch (upsertErr) {
    if (runId) recordSyncFailure('clay_enrichment', String(mapped.email ?? 'unknown'), upsertErr, runId);
    return {
      status: 'error',
      error: `Upsert transport error: ${upsertErr instanceof Error ? upsertErr.message : String(upsertErr)}`,
    };
  }

  if (batchResult.inserted === 0) {
    // The shared helper rejected the row (no email/phone, or an inner failure it already
    // recorded via recordSyncFailure). Surface as an error outcome without double-logging.
    return { status: 'error', error: 'Row rejected by shared upsert pipeline (see sync_run_errors)' };
  }

  // 5. Record fingerprint so future re-pushes (Clay retries, bulk reruns) are no-ops.
  //    Mandatory per development-standards §3 — every ingestion path records fingerprints
  //    after successful processing.
  try {
    await recordFingerprint({
      tenantId: DEFAULT_TENANT_ID,
      type: 'ats_external_id',
      hash: fingerprint,
      source: 'ats',
    });
  } catch (fpErr) {
    // Non-fatal — the row was already persisted, we just couldn't record the fingerprint.
    // A duplicate push will be caught by the candidates email uniqueness constraint instead.
    console.error('[ClayWebhook] Fingerprint record failed (non-fatal):',
      fpErr instanceof Error ? fpErr.message : fpErr);
  }

  return { status: 'accepted', fingerprint };
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  // ── Auth ──
  if (!CLAY_WEBHOOK_SECRET) {
    console.error('[ClayWebhook] CLAY_WEBHOOK_SECRET not configured — rejecting all requests');
    return NextResponse.json(
      { error: { code: 'SERVER_MISCONFIGURED', message: 'CLAY_WEBHOOK_SECRET not set on server' } },
      { status: 500 },
    );
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${CLAY_WEBHOOK_SECRET}`) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid bearer token' } },
      { status: 401 },
    );
  }

  // ── Assignee resolution (fail-loud if not configured) ──
  const { userId, error: assigneeError } = await resolveAssigneeUserId();
  if (!userId) {
    console.error('[ClayWebhook] Assignee resolution failed:', assigneeError);
    return NextResponse.json(
      { error: { code: 'ASSIGNEE_UNAVAILABLE', message: assigneeError } },
      { status: 503 },
    );
  }

  // ── Body parse ──
  let rawBody: unknown;
  try {
    const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
    if (contentLength > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { error: { code: 'PAYLOAD_TOO_LARGE', message: `Payload exceeds ${MAX_PAYLOAD_BYTES} bytes` } },
        { status: 413 },
      );
    }
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' } },
      { status: 400 },
    );
  }

  // ── Debug log (temporarily enabled during rollout) ──
  if (CLAY_WEBHOOK_DEBUG) {
    try {
      const preview = JSON.stringify(rawBody).slice(0, 4000);
      console.log(`[ClayWebhook] 📥 Raw payload (debug): ${preview}`);
    } catch { /* non-fatal */ }
  }

  // ── Normalize to an array of row objects ──
  const rows = normalizePayload(rawBody);
  if (!rows) {
    return NextResponse.json(
      { error: { code: 'UNRECOGNIZED_SHAPE', message: 'Body must be an object, an array of objects, or { rows: [...] }' } },
      { status: 400 },
    );
  }
  if (rows.length === 0) {
    return NextResponse.json(
      { status: 'ok', received: 0, accepted: 0, skipped: 0, errored: 0, duration_ms: Date.now() - startedAt },
      { status: 200 },
    );
  }

  // ── Sync run scaffold ──
  const runId = await createSyncRun('clay_enrichment');

  // ── Process rows ──
  const config: ClayMapperConfig = {
    emailField: CLAY_EMAIL_FIELD,
    phoneField: CLAY_PHONE_FIELD,
    blobField: CLAY_BLOB_FIELD,
    defaultAssigneeUserId: userId,
  };

  const counts = { accepted: 0, skipped: 0, errored: 0 };
  const outcomes: RowOutcome[] = [];

  for (const row of rows) {
    try {
      const outcome = await processRow(row, config, runId);
      outcomes.push(outcome);
      if (outcome.status === 'accepted') counts.accepted += 1;
      else if (outcome.status === 'error') counts.errored += 1;
      else counts.skipped += 1;
    } catch (rowErr) {
      // Defense-in-depth — processRow should handle its own errors, but if anything escapes
      // we log and continue so sibling rows still succeed.
      counts.errored += 1;
      outcomes.push({ status: 'error', error: rowErr instanceof Error ? rowErr.message : String(rowErr) });
      console.error('[ClayWebhook] Uncaught row error:', rowErr);
      if (runId) recordSyncFailure('clay_enrichment', 'row-uncaught', rowErr, runId);
    }
  }

  // ── Close sync run ──
  if (runId) {
    try {
      if (counts.errored > 0 && counts.accepted === 0 && counts.skipped === 0) {
        await failSyncRun(runId, 'All rows errored — see sync_run_errors for details');
      } else {
        await completeSyncRun(runId, {
          succeeded: counts.accepted,
          failed: counts.errored,
          total: rows.length,
        });
      }
    } catch (runErr) {
      console.error('[ClayWebhook] Failed to close sync run:', runErr instanceof Error ? runErr.message : runErr);
    }
  }

  // Response: 200 with per-row outcomes (Clay HTTP API column shows "200" with no retry)
  return NextResponse.json({
    status: 'ok',
    received: rows.length,
    accepted: counts.accepted,
    skipped: counts.skipped,
    errored: counts.errored,
    run_id: runId,
    duration_ms: Date.now() - startedAt,
    // Per-row outcomes included for debugging — trimmed to first 20 entries to keep response small
    outcomes: outcomes.slice(0, 20),
  }, { status: 200 });
}

// Explicitly reject non-POST so accidental GETs return a clean error
export async function GET() {
  return NextResponse.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } },
    { status: 405 },
  );
}
