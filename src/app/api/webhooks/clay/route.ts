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
import { timingSafeEqual } from 'node:crypto';
import {
  mapClayRowToCandidate,
  computeClayFingerprint,
  type ClayMapperConfig,
} from '@/modules/ingestion/clay-mapper';
import {
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
// P5: default false. Enabling this dumps the full raw Clay payload (candidate PII)
// on every request — acceptable for short rollout windows, not as a persistent
// production setting. Set CLAY_WEBHOOK_DEBUG=true in Render env vars only when
// actively debugging mapper drift, then flip back to false.
const CLAY_WEBHOOK_DEBUG = (process.env.CLAY_WEBHOOK_DEBUG ?? 'false').toLowerCase() === 'true';

// Max payload size — Next.js defaults are higher but we want an explicit ceiling
// for webhook requests specifically. 256 KB covers both single-row and small batches.
const MAX_PAYLOAD_BYTES = 256 * 1024;

// ── Assignee user ID cache (P7: 1-hour TTL) ──────────────────────────────────
// Lazily resolved on first request; re-queried after TTL expiry so that
// operator changes to `admin_managed_users` propagate without a process
// restart. Failing to resolve returns HTTP 503 for every Clay request until
// the admin provisions the user — but the error itself is not cached (so a
// transient Supabase blip doesn't poison the cache).
//
// Prior behaviour (Story 2.8 initial rollout) was "cache forever until process
// restart". The code review flagged that stale IDs could stick across tenant
// changes, deactivations, or data repairs. TTL of 1 hour balances staleness
// tolerance with webhook latency overhead.

const ASSIGNEE_CACHE_TTL_MS = 60 * 60 * 1000;

let cachedAssigneeUserId: string | null = null;
let cachedAssigneeUserIdAt: number = 0;
let cachedAssigneeError: string | null = null;

async function resolveAssigneeUserId(): Promise<{ userId: string | null; error: string | null }> {
  const now = Date.now();
  if (cachedAssigneeUserId && now - cachedAssigneeUserIdAt < ASSIGNEE_CACHE_TTL_MS) {
    return { userId: cachedAssigneeUserId, error: null };
  }
  if (cachedAssigneeError) return { userId: null, error: cachedAssigneeError };

  if (!CLAY_DEFAULT_ASSIGNEE_EMAIL) {
    cachedAssigneeError = 'CLAY_DEFAULT_ASSIGNEE_EMAIL env var is not set';
    return { userId: null, error: cachedAssigneeError };
  }

  if (!isSupabaseConfigured()) {
    // Test/dev mode — let the pipeline run with a synthetic ID so tests still work.
    cachedAssigneeUserId = `test-assignee:${CLAY_DEFAULT_ASSIGNEE_EMAIL}`;
    cachedAssigneeUserIdAt = now;
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
    cachedAssigneeUserIdAt = now;
    return { userId: cachedAssigneeUserId, error: null };
  } catch (e) {
    return { userId: null, error: `Assignee resolution transport error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Test hook — clear the cached assignee so unit tests can rerun resolution. */
export function __resetClayWebhookCacheForTests(): void {
  cachedAssigneeUserId = null;
  cachedAssigneeUserIdAt = 0;
  cachedAssigneeError = null;
}

// ── Payload normalization ────────────────────────────────────────────────────

function normalizePayload(body: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(body)) {
    // P11 (Story 2.8 review): detect double-wrapped arrays like `[[row1, row2]]`.
    // Clay templates occasionally produce this when a column value is itself
    // an array. Flatten one level before filtering. If every entry is an
    // array, flatten; if entries are mixed, treat as-is and let the filter
    // drop invalid ones.
    const allEntriesAreArrays = body.length > 0 && body.every((entry) => Array.isArray(entry));
    const effective = allEntriesAreArrays ? body.flat() : body;
    return effective.filter(
      (r) => r && typeof r === 'object' && !Array.isArray(r),
    ) as Record<string, unknown>[];
  }
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    // P10 (Story 2.8 review): detect wrapped envelope `{ "rows": [...] }`
    // ONLY when `rows` is the SOLE top-level key. Previously any object with
    // a `rows` key that happened to be an array was treated as an envelope,
    // which would silently drop every other column if a recruiter ever added
    // a Clay column literally named `rows`. Since Clay column names are
    // user-defined, this is a production-plausible collision.
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === 'rows' && Array.isArray(obj.rows)) {
      return obj.rows.filter(
        (r) => r && typeof r === 'object' && !Array.isArray(r),
      ) as Record<string, unknown>[];
    }
    // Single-row object (may have a `rows` column alongside other fields)
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
  seenInBatch: Set<string>,
  bucketRunId: string | null,
): Promise<RowOutcome> {
  // 1. Compute fingerprint (Story 1.11 gate — mandatory first step per development-standards §3)
  const fingerprint = computeClayFingerprint(rawRow, config);
  if (!fingerprint) {
    return { status: 'skipped_no_identity', error: 'No profile_id + last_refresh, and no sidecar email' };
  }

  // 2a. P8 (Story 2.8 review): in-memory dedup within the current request.
  //     If a sibling row earlier in the same batch already fingerprinted the
  //     same Clay identity, short-circuit before hitting the DB. This closes
  //     the race window where two rows with the same fingerprint both pass
  //     `isAlreadyProcessed` (because neither has been recorded in the DB yet
  //     by the time the second row is evaluated).
  if (seenInBatch.has(fingerprint)) {
    console.log(JSON.stringify({
      event: 'fingerprint_hit',
      scope: 'in_batch',
      type: 'ats_external_id',
      source: 'ats',
      tenantId: DEFAULT_TENANT_ID,
      hash: fingerprint.slice(0, 24),
    }));
    return { status: 'skipped_fingerprint', fingerprint };
  }

  // 2b. Fingerprint hit in DB? Short-circuit before any mapping or upsert work.
  try {
    const seen = await isAlreadyProcessed(DEFAULT_TENANT_ID, 'ats_external_id', fingerprint);
    if (seen) {
      console.log(JSON.stringify({
        event: 'fingerprint_hit',
        scope: 'persisted',
        type: 'ats_external_id',
        source: 'ats',
        tenantId: DEFAULT_TENANT_ID,
        hash: fingerprint.slice(0, 24),
      }));
      seenInBatch.add(fingerprint);
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
    // P12 (Story 2.8 review): link the error to the hourly bucket run id so
    // the 2.4b error detail page groups Clay errors under the bucket row.
    recordSyncFailure('clay_enrichment', String(mapped.email ?? 'unknown'), upsertErr, bucketRunId ?? undefined);
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
  // Mark seen for the rest of this request so later sibling rows with the
  // same fingerprint short-circuit instead of hitting the DB again.
  seenInBatch.add(fingerprint);

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
  // P1 (Story 2.8 review): constant-time comparison + case/whitespace normalization.
  //   - Plain `!==` on secrets leaks timing info (byte-by-byte oracle). Use
  //     `crypto.timingSafeEqual` over equal-length buffers.
  //   - Auth header may arrive as `"bearer xxx"` (lowercase) or with extra
  //     whitespace / trailing CRLF depending on intermediate proxies. Parse
  //     scheme and token separately and normalize case on the scheme.
  const rawAuth = (request.headers.get('authorization') ?? '').trim();
  const match = rawAuth.match(/^(\S+)\s+(.+)$/);
  let bearerValid = false;
  if (match) {
    const scheme = (match[1] ?? '').toLowerCase();
    const token = (match[2] ?? '').trim();
    if (scheme === 'bearer' && token.length === CLAY_WEBHOOK_SECRET.length) {
      const actual = Buffer.from(token);
      const expected = Buffer.from(CLAY_WEBHOOK_SECRET);
      try {
        bearerValid = timingSafeEqual(actual, expected);
      } catch {
        bearerValid = false;
      }
    }
  }
  if (!bearerValid) {
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

  // ── Body read + size enforcement ──
  // P2 (Story 2.8 review): the old implementation trusted the client-supplied
  // `Content-Length` header — a missing, negative, or spoofed header bypassed
  // the 256 KB cap. Now we read the body into an ArrayBuffer first and
  // enforce the ceiling against the actual byte count before JSON parsing.
  let rawBody: unknown;
  try {
    const bodyBuf = await request.arrayBuffer();
    if (bodyBuf.byteLength > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        {
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: `Payload exceeds ${MAX_PAYLOAD_BYTES} bytes (actual: ${bodyBuf.byteLength})`,
          },
        },
        { status: 413 },
      );
    }
    if (bodyBuf.byteLength === 0) {
      return NextResponse.json(
        { error: { code: 'BAD_JSON', message: 'Request body is empty' } },
        { status: 400 },
      );
    }
    rawBody = JSON.parse(new TextDecoder('utf-8').decode(bodyBuf));
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

  // ── Process rows ──
  // No per-request sync_run is created here. Clay webhooks can fire thousands
  // of times during a backfill, and creating a sync_run per request pollutes
  // the admin dashboard with unreadable noise. Instead, we use a two-phase
  // pattern:
  //   1. BEFORE processing: call `upsert_clay_hourly_sync_run` with zero counts
  //      to get the current hour bucket's `sync_runs.id`. This either creates
  //      the bucket row (first webhook of the hour) or returns the existing id
  //      (subsequent webhooks). No counter increment on this call.
  //   2. Process rows, passing the bucket id to `processRow` so any
  //      `recordSyncFailure` calls link errors back to the bucket row (P12 —
  //      otherwise the 2.4b error detail page shows Clay errors unlinked).
  //   3. AFTER processing: call the same RPC with real counts to increment
  //      the row. The `ON CONFLICT DO UPDATE` path handles this idempotently.
  //
  // RPC errors at either step are swallowed — Clay observability must never
  // block candidate ingestion.
  const config: ClayMapperConfig = {
    emailField: CLAY_EMAIL_FIELD,
    phoneField: CLAY_PHONE_FIELD,
    blobField: CLAY_BLOB_FIELD,
    defaultAssigneeUserId: userId,
  };

  // ── Phase 1: seed the hourly bucket and capture its row id ──
  let bucketId: string | null = null;
  const canWriteBucket = isSupabaseConfigured();
  if (canWriteBucket) {
    try {
      const db = getSupabaseAdminClient();
      const { data, error } = await db.rpc('upsert_clay_hourly_sync_run', {
        p_accepted: 0,
        p_skipped: 0,
        p_errored: 0,
      });
      if (error) {
        console.error('[ClayWebhook] Hourly bucket seed failed:', error.message);
      } else if (data) {
        bucketId = data as string;
      }
    } catch (seedErr) {
      console.error('[ClayWebhook] Hourly bucket seed transport error:',
        seedErr instanceof Error ? seedErr.message : seedErr);
    }
  }

  const counts = { accepted: 0, skipped: 0, errored: 0 };
  const outcomes: RowOutcome[] = [];
  // P8: in-memory dedup set scoped to this request. Prevents two rows with
  // the same fingerprint from both passing the DB fingerprint gate when
  // neither has been recorded yet.
  const seenInBatch = new Set<string>();

  for (const row of rows) {
    try {
      const outcome = await processRow(row, config, seenInBatch, bucketId);
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
      recordSyncFailure('clay_enrichment', 'row-uncaught', rowErr, bucketId ?? undefined);
    }
  }

  // ── Phase 3: increment the bucket counters with the final tally ──
  if (canWriteBucket) {
    try {
      const db = getSupabaseAdminClient();
      const { data, error } = await db.rpc('upsert_clay_hourly_sync_run', {
        p_accepted: counts.accepted,
        p_skipped: counts.skipped,
        p_errored: counts.errored,
      });
      if (error) {
        console.error('[ClayWebhook] Hourly bucket increment failed:', error.message);
      } else if (data && !bucketId) {
        // Fall through: if seed failed but increment succeeded, recover the id
        bucketId = data as string;
      }
    } catch (bucketErr) {
      console.error('[ClayWebhook] Hourly bucket upsert transport error:',
        bucketErr instanceof Error ? bucketErr.message : bucketErr);
    }
  }

  // Response: 200 with per-row outcomes (Clay HTTP API column shows "200" with no retry)
  return NextResponse.json({
    status: 'ok',
    received: rows.length,
    accepted: counts.accepted,
    skipped: counts.skipped,
    errored: counts.errored,
    bucket_run_id: bucketId,
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
