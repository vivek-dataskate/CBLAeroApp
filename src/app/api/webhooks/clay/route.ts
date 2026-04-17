/**
 * Clay Webhook Ingestion Endpoint — Story 2.8 / Story 1-12a
 *
 * Receives per-row HTTP pushes from Clay's "HTTP API" column. Story 1-12a
 * migrated the auth / size / payload-shape / event-fanout plumbing onto
 * `BaseWebhookReceiver`, and the per-row business logic onto a `WebhookHandler`
 * drained synchronously by `WebhookProcessor`. Each row goes through the
 * standard dedup/fingerprint/role-deduction pipeline and lands in `candidates`
 * with `source = clay_enrichment`.
 *
 * Recruiter-level attribution is out of scope — every row is stamped to the
 * configured default assignee (`CLAY_DEFAULT_ASSIGNEE_EMAIL`) via
 * `source_recruiter_actor_id`.
 *
 * ── Authentication ──
 * Shared-secret bearer token in the Authorization header:
 *   Authorization: Bearer ${CLAY_WEBHOOK_SECRET}
 *
 * ── Response ──
 *   200 OK with per-row outcome counts (even when some rows errored — row-level
 *       errors accumulate in sync_errors, but the overall request is "accepted"
 *       so Clay doesn't retry the whole batch on a single bad row).
 *   400 Bad Request — malformed JSON body, empty body, or unrecognized shape.
 *   401 Unauthorized — missing/wrong bearer token.
 *   413 Payload Too Large — > 256 KB.
 *   500 Server Misconfigured — CLAY_WEBHOOK_SECRET not set.
 *   503 Service Unavailable — startup validation failed (assignee user doesn't
 *       exist), so we refuse to accept any Clay traffic at all.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { ClayMapperConfig } from '@/modules/ingestion/clay-mapper';
import { recordSyncFailure } from '@/modules/ingestion';
import { getSupabaseAdminClient, isSupabaseConfigured } from '@/modules/persistence';
import {
  WebhookProcessor,
  BearerTokenWebhookAuth,
  ensureProvidersInitialized,
} from '@/modules/providers';
import {
  createClayWebhookReceiver,
  extractClayRows,
  CLAY_WEBHOOK_SOURCE,
} from '@/modules/providers/clay/clay-webhook-receiver';
import {
  ClayWebhookHandler,
  type RowOutcome,
  type RowOutcomeStatus,
} from '@/modules/providers/clay/clay-webhook-handler';
import { ClayInRequestStore } from '@/modules/providers/clay/clay-in-request-store';
import {
  resolveDefaultAssignee,
  resetClayAssigneeCacheForTests,
} from '@/modules/providers/clay/clay-assignee';

// ── Configuration ────────────────────────────────────────────────────────────

const CLAY_WEBHOOK_SECRET = process.env.CLAY_WEBHOOK_SECRET;
// Sidecar column names in the Clay payload. Defaults match the production
// Clay HTTP API column config observed on 2026-04-15 (lowercase `email` / `phone`
// emitted by Clay's default body template). Override via env vars if the Clay
// column names change.
const CLAY_EMAIL_FIELD = process.env.CLAY_EMAIL_FIELD || 'email';
const CLAY_PHONE_FIELD = process.env.CLAY_PHONE_FIELD || 'phone';
// Top-level key where Clay nests the LinkedIn enrichment blob. Default matches
// the production Clay Enrich Person column. If Clay's column is renamed in the
// UI, override via env var — no code redeploy needed.
const CLAY_BLOB_FIELD = process.env.CLAY_BLOB_FIELD || 'enrichlinkedin_data';
// P5: default false. Enabling dumps first 4000 chars of raw Clay payload on
// every request — acceptable for short rollout windows, not as a persistent
// production setting. Set CLAY_WEBHOOK_DEBUG=true in Render env vars only when
// actively debugging mapper drift, then flip back to false.
const CLAY_WEBHOOK_DEBUG = (process.env.CLAY_WEBHOOK_DEBUG ?? 'false').toLowerCase() === 'true';

// Max payload size — preserved at route layer so the legacy PAYLOAD_TOO_LARGE
// error message (with actual byte count) stays byte-identical. The receiver
// also enforces the same cap as defense in depth.
const MAX_PAYLOAD_BYTES = 256 * 1024;

/** Test hook — clear cached assignee so unit tests can rerun resolution. */
export function __resetClayWebhookCacheForTests(): void {
  resetClayAssigneeCacheForTests();
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  // ── 0. Provider framework init (Task 4) ──
  // Idempotent: first caller does work, subsequent callers await the shared
  // promise. Swallowed so observability wiring can never block ingestion —
  // Clay already has a narrow auth window and we must not add a new failure mode.
  try {
    await ensureProvidersInitialized();
  } catch (initErr) {
    console.error(
      '[ClayWebhook] ensureProvidersInitialized failed (non-fatal):',
      initErr instanceof Error ? initErr.message : initErr,
    );
  }

  // ── 1. Env check ──
  if (!CLAY_WEBHOOK_SECRET) {
    console.error('[ClayWebhook] CLAY_WEBHOOK_SECRET not configured — rejecting all requests');
    return NextResponse.json(
      { error: { code: 'SERVER_MISCONFIGURED', message: 'CLAY_WEBHOOK_SECRET not set on server' } },
      { status: 500 },
    );
  }

  // ── 2. Body read + byte-exact size / empty enforcement ──
  // Kept in the route (not delegated to the framework) so the PAYLOAD_TOO_LARGE
  // error message preserves its "actual: ${N}" detail required by the
  // Story 2.8 P2 review.
  let rawBodyStr: string;
  let rawBodyByteLen: number;
  try {
    const bodyBuf = await request.arrayBuffer();
    rawBodyByteLen = bodyBuf.byteLength;
    if (rawBodyByteLen > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        {
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: `Payload exceeds ${MAX_PAYLOAD_BYTES} bytes (actual: ${rawBodyByteLen})`,
          },
        },
        { status: 413 },
      );
    }
    if (rawBodyByteLen === 0) {
      return NextResponse.json(
        { error: { code: 'BAD_JSON', message: 'Request body is empty' } },
        { status: 400 },
      );
    }
    rawBodyStr = new TextDecoder('utf-8').decode(bodyBuf);
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' } },
      { status: 400 },
    );
  }

  // ── 3. Auth validation (MUST run before assignee resolve + bucket seed) ──
  // Normalize the Authorization header (P1 tolerances: lowercase `bearer`,
  // leading/trailing whitespace) then delegate to `BearerTokenWebhookAuth`
  // for constant-time comparison. Running auth here prevents unauthenticated
  // requests from (a) driving JSON parse + shape-check CPU, (b) querying
  // Supabase for the default assignee, and (c) creating orphan `sync_runs`
  // bucket rows via the Phase 1 seed RPC. Code-review 2026-04-17 finding.
  const rawAuth = (request.headers.get('authorization') ?? '').trim();
  const match = rawAuth.match(/^(\S+)\s+(.+)$/);
  let normalizedAuth = '';
  if (match) {
    const scheme = (match[1] ?? '').toLowerCase();
    const token = (match[2] ?? '').trim();
    if (scheme === 'bearer') normalizedAuth = `Bearer ${token}`;
  }
  const authValidator = new BearerTokenWebhookAuth(CLAY_WEBHOOK_SECRET);
  const authValid = await authValidator.validate(rawBodyStr, { authorization: normalizedAuth });
  if (!authValid) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid bearer token' } },
      { status: 401 },
    );
  }

  // ── 4. Shape pre-check ──
  // The framework's `extractEvents` can't distinguish "empty batch" from
  // "garbage shape" — both return []. We preserve the Story 2.8
  // UNRECOGNIZED_SHAPE 400 error code by parsing here and rejecting bodies
  // that are neither an object, an array of objects, nor a wrapped envelope.
  // The receiver will re-parse internally; two parses are cheap at ≤ 256 KB.
  let preParsed: unknown;
  try {
    preParsed = JSON.parse(rawBodyStr);
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' } },
      { status: 400 },
    );
  }
  if (!isRecognizedClayShape(preParsed)) {
    return NextResponse.json(
      {
        error: {
          code: 'UNRECOGNIZED_SHAPE',
          message: 'Body must be an object, an array of objects, or { rows: [...] }',
        },
      },
      { status: 400 },
    );
  }
  // Use the framework extractor once here so `received` can report the true
  // parsed-row count, independent of framework-accepted event count.
  const extractedRows = extractClayRows(preParsed);

  // ── 5. Assignee resolution (fail-loud if not configured) ──
  const { userId, error: assigneeError } = await resolveDefaultAssignee();
  if (!userId) {
    console.error('[ClayWebhook] Assignee resolution failed:', assigneeError);
    return NextResponse.json(
      { error: { code: 'ASSIGNEE_UNAVAILABLE', message: assigneeError } },
      { status: 503 },
    );
  }

  // ── 6. Phase 1: seed the hourly bucket and capture its row id ──
  // Clay observability is an hourly bucket — see Story 2.8 P12 for the
  // three-phase pattern: (1) seed bucket with zeros to get id,
  // (2) process rows linking errors to the bucket id,
  // (3) upsert final counts. RPC errors are swallowed — observability must
  // never block ingestion.
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
      console.error(
        '[ClayWebhook] Hourly bucket seed transport error:',
        seedErr instanceof Error ? seedErr.message : seedErr,
      );
    }
  }

  // ── 7. Build framework pipeline: receiver + handler + processor ──
  const mapperConfig: ClayMapperConfig = {
    emailField: CLAY_EMAIL_FIELD,
    phoneField: CLAY_PHONE_FIELD,
    blobField: CLAY_BLOB_FIELD,
    defaultAssigneeUserId: userId,
  };

  // In-request dedup set scoped to this POST (P8) — prevents two rows with
  // the same fingerprint from both passing the persisted fingerprint gate
  // when neither has been recorded yet.
  const seenInBatch = new Set<string>();

  const supabase = canWriteBucket ? getSupabaseAdminClient() : null;
  // `SupabaseClient` typing is loose here because the persistence barrel
  // returns `unknown` in test-mocked mode. The store only uses `.from()`.
  const store = new ClayInRequestStore(supabase as never);
  const handler = new ClayWebhookHandler({ mapperConfig, bucketRunId: bucketId, seenInBatch });
  const processor = new WebhookProcessor(store, new Map([[CLAY_WEBHOOK_SOURCE, handler]]));
  const receiver = createClayWebhookReceiver({
    secret: CLAY_WEBHOOK_SECRET,
    store,
    maxPayloadBytes: MAX_PAYLOAD_BYTES,
  });

  // ── 8. Receiver: re-validates auth + extractEvents fanout + webhook_events insert ──
  // All pre-conditions (auth, size, empty body, shape) are already enforced
  // above, so the receiver should always return accepted=true here. The
  // receiver still runs its own auth + extract pass as defense-in-depth.
  // Rate-limit is disabled at the receiver (see createClayWebhookReceiver).
  const headers: Record<string, string> = { authorization: normalizedAuth };
  const received = await receiver.receive(rawBodyStr, headers);

  // ── Debug log (unchanged — temporarily enabled during rollout) ──
  if (CLAY_WEBHOOK_DEBUG) {
    try {
      const preview = rawBodyStr.slice(0, 4000);
      console.log(`[ClayWebhook] 📥 Raw payload (debug): ${preview}`);
    } catch {
      /* non-fatal */
    }
  }

  const events = received.events ?? (received.event ? [received.event] : []);

  // Empty-batch short-circuit — same response as before but also skip the
  // processor drain to avoid an unnecessary claim call.
  if (events.length === 0) {
    // Still run Phase 3 with zeros so the bucket mode stays consistent.
    if (canWriteBucket) {
      await incrementBucket(0, 0, 0);
    }
    return NextResponse.json(
      {
        status: 'ok',
        received: extractedRows.length,
        accepted: 0,
        skipped: 0,
        errored: 0,
        bucket_run_id: bucketId,
        duration_ms: Date.now() - startedAt,
      },
      { status: 200 },
    );
  }

  // ── 9. Processor drain — synchronous, in-request ──
  // Clay batches are small (typically 1-10 rows). Drain loops until queue
  // empties. Defence: cap drain iterations in case handler somehow re-queues.
  const maxDrainIterations = events.length + 2;
  for (let i = 0; i < maxDrainIterations; i++) {
    const processed = await processor.processBatch();
    if (processed === 0) break;
  }

  // ── 10. Collect per-row outcomes ──
  const outcomes: RowOutcome[] = [];
  const counts = { accepted: 0, skipped: 0, errored: 0 };
  for (const event of store.getAllEvents()) {
    const result = store.getResult(event.id);
    let rowStatus: RowOutcomeStatus = 'error';
    let fingerprint: string | undefined;
    let error: string | undefined;

    if (result?.status === 'completed' && result.result?.meta) {
      rowStatus = (result.result.meta as { rowStatus?: RowOutcomeStatus }).rowStatus ?? 'accepted';
      fingerprint = (result.result.meta as { fingerprint?: string }).fingerprint;
      error = (result.result.meta as { error?: string }).error;
    } else if (result?.status === 'failed' || result?.status === 'dead_letter') {
      rowStatus = 'error';
      error = result.error;
      // AC 6 PRESERVE #1: operators grep for `[ClayWebhook]` to detect batch
      // failures — emit the legacy prefix line before recordSyncFailure.
      console.error('[ClayWebhook] Handler failure:', error ?? 'handler failure');
      // Handler-level failures: link to bucket for the 2-4b error drill-down.
      recordSyncFailure(
        'clay_enrichment',
        'row-handler-failure',
        new Error(error ?? 'handler failure'),
        bucketId ?? undefined,
      );
    }

    outcomes.push({ status: rowStatus, fingerprint, error });
    if (rowStatus === 'accepted') counts.accepted += 1;
    else if (rowStatus === 'error') counts.errored += 1;
    else counts.skipped += 1;
  }

  // ── 11. Phase 3: increment the hourly bucket with final tally ──
  if (canWriteBucket) {
    const finalId = await incrementBucket(counts.accepted, counts.skipped, counts.errored);
    if (finalId && !bucketId) bucketId = finalId;
  }

  // ── 12. Response (shape unchanged from Story 2.8 contract) ──
  return NextResponse.json(
    {
      status: 'ok',
      received: extractedRows.length,
      accepted: counts.accepted,
      skipped: counts.skipped,
      errored: counts.errored,
      bucket_run_id: bucketId,
      duration_ms: Date.now() - startedAt,
      outcomes: outcomes.slice(0, 20),
    },
    { status: 200 },
  );
}

// Explicitly reject non-POST so accidental GETs return a clean error.
export async function GET() {
  return NextResponse.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } },
    { status: 405 },
  );
}

/**
 * Accept: an object, an array (of any items — the extractor filters), or a
 * `{rows: [...]}` envelope. Reject: strings, numbers, null, arrays nested one
 * level too deep that aren't all-arrays (e.g. `[["x"]]` of strings), etc.
 *
 * Mirrors the legacy `normalizePayload()` null-vs-empty-array distinction
 * that the receiver's `extractEvents` can't natively express.
 */
function isRecognizedClayShape(body: unknown): boolean {
  // Review patch L-2: reject arrays whose entries are all empty arrays
  // (e.g. `[[]]`) — these parse cleanly but extract zero rows and surfaced
  // as silent empty-batch responses. Explicitly reject so operators get the
  // UNRECOGNIZED_SHAPE 400 instead.
  if (Array.isArray(body)) {
    if (body.length === 0) return true; // empty batch — valid, Clay sends these
    const allEmptyArrays = body.every(
      (entry) => Array.isArray(entry) && entry.length === 0,
    );
    if (allEmptyArrays) return false;
    return true;
  }
  if (body && typeof body === 'object') return true;
  return false;
}

async function incrementBucket(
  accepted: number,
  skipped: number,
  errored: number,
): Promise<string | null> {
  try {
    const db = getSupabaseAdminClient();
    const { data, error } = await db.rpc('upsert_clay_hourly_sync_run', {
      p_accepted: accepted,
      p_skipped: skipped,
      p_errored: errored,
    });
    if (error) {
      console.error('[ClayWebhook] Hourly bucket increment failed:', error.message);
      return null;
    }
    return (data as string) ?? null;
  } catch (bucketErr) {
    console.error(
      '[ClayWebhook] Hourly bucket upsert transport error:',
      bucketErr instanceof Error ? bucketErr.message : bucketErr,
    );
    return null;
  }
}
