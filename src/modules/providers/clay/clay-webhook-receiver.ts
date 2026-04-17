/**
 * Clay webhook receiver — `BaseWebhookReceiver` instantiation for Clay.
 *
 * Story 1-12a, Task 1. Migrates the inbound `/api/webhooks/clay` path onto
 * the provider framework. Keeps the same semantics as the hand-rolled route:
 *   - Bearer token auth (env: CLAY_WEBHOOK_SECRET)
 *   - 256 KB payload ceiling (framework enforces byte-exact, same as prior
 *     P2 route check — but the route still runs its own check first so the
 *     existing PAYLOAD_TOO_LARGE error message is preserved verbatim).
 *   - Fans out all four Clay payload shapes into one webhook_events row per
 *     candidate row, with provider_event_id=null (Clay has no stable per-row
 *     UUID — content-level dedup lives in content_fingerprints).
 *   - source='clay_enrichment' on every row (per Story 2-8 preservation map;
 *     the partial unique index on sync_runs is predicated on this string).
 *   - event_type='candidate.upserted' on every row.
 */

import {
  BaseWebhookReceiver,
  BearerTokenWebhookAuth,
} from '../index';
import type { WebhookReceiverConfig } from '../types';
import type { WebhookEventStore } from '../webhook-receiver';

/** Source string — canonical across sync_runs, webhook_events, recordSyncFailure. */
export const CLAY_WEBHOOK_SOURCE = 'clay_enrichment';
export const CLAY_WEBHOOK_EVENT_TYPE = 'candidate.upserted';
const CLAY_MAX_PAYLOAD_BYTES = 256 * 1024;

/**
 * Extract rows from any of the four known Clay payload shapes:
 *   (1) Flat array:      `[{row1}, {row2}]`
 *   (2) Single object:    `{field1: ..., field2: ...}`
 *   (3) Wrapped array:    `{"rows": [{row1}, {row2}]}` (ONLY when `rows` is the sole key)
 *   (4) Double-wrapped:   `[[{row1}, {row2}]]`
 *
 * Mirrors `normalizePayload()` in the legacy route so parity is byte-exact.
 * Exported for unit/regression tests.
 */
export function extractClayRows(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    // Shape 4: double-wrapped `[[row1, row2]]`. Flatten one level if EVERY
    // entry is itself an array; otherwise take as-is and let the filter below
    // drop malformed entries.
    const allEntriesAreArrays = body.length > 0 && body.every((entry) => Array.isArray(entry));
    const effective = allEntriesAreArrays ? body.flat() : body;
    return effective.filter(
      (r) => r && typeof r === 'object' && !Array.isArray(r),
    ) as Record<string, unknown>[];
  }
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    const keys = Object.keys(obj);
    // Shape 3: `{rows: [...]}` ONLY when `rows` is the sole top-level key.
    // Prior bug: any object with a `rows` key was treated as an envelope,
    // which silently dropped other Clay columns. Clay column names are
    // user-defined so a literal `rows` column is plausible (P10 guard).
    if (keys.length === 1 && keys[0] === 'rows' && Array.isArray(obj.rows)) {
      return obj.rows.filter(
        (r) => r && typeof r === 'object' && !Array.isArray(r),
      ) as Record<string, unknown>[];
    }
    return [obj];
  }
  return [];
}

interface CreateClayWebhookReceiverArgs {
  secret: string;
  store: WebhookEventStore;
  /** Override default 256 KB cap; test-only. */
  maxPayloadBytes?: number;
}

export function createClayWebhookReceiver(args: CreateClayWebhookReceiverArgs): BaseWebhookReceiver {
  const config: WebhookReceiverConfig = {
    source: CLAY_WEBHOOK_SOURCE,
    auth: new BearerTokenWebhookAuth(args.secret),
    maxPayloadBytes: args.maxPayloadBytes ?? CLAY_MAX_PAYLOAD_BYTES,
    // Story 2.8 invariant: Clay's HTTP API column retries whole batches on
    // any non-200. The framework's default 100/min rate-limit would trip
    // during bulk backfills and cause double-counted `sync_runs` bucket
    // increments via retry. Disable per-process rate-limiting here;
    // defense-in-depth for DoS lives at the edge (Render / Cloudflare).
    rateLimitMax: Number.MAX_SAFE_INTEGER,
    extractEvents: (payload: unknown) => {
      const rows = extractClayRows(payload);
      return rows.map((row) => ({
        // provider_event_id=null: Clay rows have no stable UUID. Null values
        // bypass (source, provider_event_id) dedup — content-level dedup
        // lives in content_fingerprints via computeClayFingerprint().
        eventId: null,
        eventType: CLAY_WEBHOOK_EVENT_TYPE,
        payload: row,
      }));
    },
  };

  return new BaseWebhookReceiver(config, args.store);
}
