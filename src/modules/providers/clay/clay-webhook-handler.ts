/**
 * Clay webhook handler — `WebhookHandler` implementation for Clay rows.
 *
 * Encapsulates the per-row processing that previously lived inline in
 * `src/app/api/webhooks/clay/route.ts` as `processRow()`:
 *   1. Compute Clay fingerprint (null fingerprint → skipped_no_identity).
 *   2. In-request dedup against `seenInBatch` fingerprint set (P8 guard).
 *   3. Persisted dedup via `isAlreadyProcessed` (content_fingerprints).
 *   4. Map Clay row → canonical candidate record.
 *   5. `batchUpsertCandidatesFromATS` (shared ingestion pipeline).
 *   6. `recordFingerprint` after success.
 *
 * The handler records row-level errors via `recordSyncFailure(source, …, bucketRunId)`
 * and returns a `WebhookHandlerResult` whose `meta` holds the full `RowOutcome`
 * plus the traceability fields required by Story 1-12 (syncRunId, candidateId,
 * outcome). The route reads `meta` to build the legacy HTTP response.
 *
 * The handler never throws on row-level errors — it converts them to
 * `{status:'error', error: …}` outcomes so sibling rows in the same batch
 * continue processing (existing Story 2-8 semantics).
 */

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
import type {
  WebhookEvent,
  WebhookHandler,
  WebhookHandlerResult,
} from '../types';

export type RowOutcomeStatus =
  | 'accepted'
  | 'skipped_fingerprint'
  | 'skipped_no_identity'
  | 'error';

export interface RowOutcome {
  status: RowOutcomeStatus;
  fingerprint?: string;
  error?: string;
}

interface ClayWebhookHandlerCtx {
  mapperConfig: ClayMapperConfig;
  bucketRunId: string | null;
  /** In-request dedup set shared across every row in this batch. */
  seenInBatch: Set<string>;
}

export class ClayWebhookHandler implements WebhookHandler {
  constructor(private readonly ctx: ClayWebhookHandlerCtx) {}

  async handle(event: WebhookEvent): Promise<WebhookHandlerResult> {
    const row = event.rawPayload as Record<string, unknown>;
    const outcome = await processClayRow(
      row,
      this.ctx.mapperConfig,
      this.ctx.seenInBatch,
      this.ctx.bucketRunId,
    );

    const mappedOutcome =
      outcome.status === 'accepted'
        ? 'inserted'
        : outcome.status === 'skipped_fingerprint'
          ? 'skipped_duplicate'
          : outcome.status === 'skipped_no_identity'
            ? 'skipped_no_identity'
            : 'error';

    return {
      meta: {
        syncRunId: this.ctx.bucketRunId,
        candidateId: null,
        outcome: mappedOutcome,
        rowStatus: outcome.status,
        fingerprint: outcome.fingerprint,
        error: outcome.error,
      },
    };
  }
}

/**
 * Process a single Clay row. Exported for direct testing / backward-compat
 * with the prior inline `processRow` helper.
 */
export async function processClayRow(
  rawRow: Record<string, unknown>,
  config: ClayMapperConfig,
  seenInBatch: Set<string>,
  bucketRunId: string | null,
): Promise<RowOutcome> {
  // 1. Fingerprint gate (Story 1.11 — mandatory first step per development-standards §3).
  const fingerprint = computeClayFingerprint(rawRow, config);
  if (!fingerprint) {
    return {
      status: 'skipped_no_identity',
      error: 'No profile_id + last_refresh, and no sidecar email',
    };
  }

  // 2a. In-batch dedup (P8): two rows sharing a fingerprint within one request
  //     must not both reach batchUpsert — closes the race window where both
  //     would pass `isAlreadyProcessed` before either is recorded.
  if (seenInBatch.has(fingerprint)) {
    console.log(
      JSON.stringify({
        event: 'fingerprint_hit',
        scope: 'in_batch',
        type: 'ats_external_id',
        source: 'ats',
        tenantId: DEFAULT_TENANT_ID,
        hash: fingerprint.slice(0, 24),
      }),
    );
    return { status: 'skipped_fingerprint', fingerprint };
  }

  // 2b. Persisted fingerprint dedup (content_fingerprints).
  try {
    const seen = await isAlreadyProcessed(DEFAULT_TENANT_ID, 'ats_external_id', fingerprint);
    if (seen) {
      console.log(
        JSON.stringify({
          event: 'fingerprint_hit',
          scope: 'persisted',
          type: 'ats_external_id',
          source: 'ats',
          tenantId: DEFAULT_TENANT_ID,
          hash: fingerprint.slice(0, 24),
        }),
      );
      seenInBatch.add(fingerprint);
      return { status: 'skipped_fingerprint', fingerprint };
    }
  } catch (fpErr) {
    console.error(
      '[ClayWebhook] Fingerprint check failed, continuing without short-circuit:',
      fpErr instanceof Error ? fpErr.message : fpErr,
    );
    // Fall through — better to process twice than lose a row.
  }

  // 3. Map Clay row → canonical candidate record (pure, no I/O).
  const mapped = mapClayRowToCandidate(rawRow, config);

  // 4. Delegate to shared ingestion pipeline. `batchUpsertCandidatesFromATS`
  //    handles email/phone validation, mapToCandidateRow conversion, and
  //    batchUpsertCandidatesByEmail RPC dispatch. Reusing keeps Clay on the
  //    same pipeline as ATS/Ceipal/CSV.
  let batchResult: { inserted: number; failed: number };
  try {
    batchResult = await batchUpsertCandidatesFromATS([
      mapped as unknown as Record<string, unknown>,
    ]);
  } catch (upsertErr) {
    recordSyncFailure(
      'clay_enrichment',
      String(mapped.email ?? 'unknown'),
      upsertErr,
      bucketRunId ?? undefined,
    );
    return {
      status: 'error',
      error: `Upsert transport error: ${upsertErr instanceof Error ? upsertErr.message : String(upsertErr)}`,
    };
  }

  if (batchResult.inserted === 0) {
    // Shared helper rejected the row (no email/phone, or inner failure
    // already logged via recordSyncFailure). Surface as error without
    // double-logging.
    return {
      status: 'error',
      error: 'Row rejected by shared upsert pipeline (see sync_run_errors)',
    };
  }
  seenInBatch.add(fingerprint);

  // 5. Record fingerprint so future re-pushes are no-ops.
  try {
    await recordFingerprint({
      tenantId: DEFAULT_TENANT_ID,
      type: 'ats_external_id',
      hash: fingerprint,
      source: 'ats',
    });
  } catch (fpErr) {
    // Non-fatal — row is already persisted; email uniqueness will catch a future dupe.
    console.error(
      '[ClayWebhook] Fingerprint record failed (non-fatal):',
      fpErr instanceof Error ? fpErr.message : fpErr,
    );
  }

  return { status: 'accepted', fingerprint };
}
