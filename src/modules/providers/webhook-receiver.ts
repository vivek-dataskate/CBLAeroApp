import { randomUUID } from 'crypto';
import type {
  WebhookReceiverConfig,
  WebhookEvent,
  WebhookLogEntry,
} from './types';
import { WebhookRateLimiter } from './webhook-rate-limiter';

const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;
const DEFAULT_REPLAY_WINDOW_MS = 5 * 60 * 1000;
/** Small forward-skew tolerance (30s) for clock drift between provider and us. */
const DEFAULT_FUTURE_SKEW_MS = 30 * 1000;
/** Default cap on items per multi-event batch; override via config.maxEventsPerBatch. */
const DEFAULT_MAX_EVENTS_PER_BATCH = 500;

export interface WebhookReceiveResult {
  accepted: boolean;
  statusCode: number;
  event: WebhookEvent | null;
  /** For multi-event payloads, the list of accepted events. */
  events?: WebhookEvent[];
  reason: string;
}

/**
 * Persistence interface for webhook events.
 *
 * `insertIfNotDuplicate` replaces the prior split `isDuplicate` + `insert` pair
 * to avoid a TOCTOU race: concurrent deliveries of the same provider_event_id
 * both saw "not duplicate" and then the second INSERT would fail on the unique
 * index. Implementations should use `INSERT ... ON CONFLICT DO NOTHING` and
 * return `false` when no row was inserted.
 */
export interface WebhookEventStore {
  /**
   * Insert the event if no row with the same (source, providerEventId) exists.
   * Returns true if inserted, false if it was a duplicate.
   * Null providerEventId is always inserted (no dedup).
   */
  insertIfNotDuplicate(event: WebhookEvent): Promise<boolean>;
}

export class BaseWebhookReceiver {
  private readonly config: Required<
    Pick<
      WebhookReceiverConfig,
      'source' | 'auth' | 'maxPayloadBytes' | 'replayWindowMs' | 'maxEventsPerBatch'
    >
  > &
    Pick<
      WebhookReceiverConfig,
      'extractEventId' | 'extractEventType' | 'extractTimestamp' | 'extractEvents' | 'rateLimitMax' | 'rateLimitWindowMs'
    >;

  private readonly rateLimiter: WebhookRateLimiter;

  public onLog: (entry: WebhookLogEntry) => void = () => {};
  public onEventAccepted: () => void = () => {};
  public onEventRejected: () => void = () => {};

  constructor(
    config: WebhookReceiverConfig,
    private readonly store: WebhookEventStore,
    rateLimiter?: WebhookRateLimiter,
  ) {
    this.config = {
      source: config.source,
      auth: config.auth,
      maxPayloadBytes: config.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
      replayWindowMs: config.replayWindowMs ?? DEFAULT_REPLAY_WINDOW_MS,
      maxEventsPerBatch: config.maxEventsPerBatch ?? DEFAULT_MAX_EVENTS_PER_BATCH,
      extractEventId: config.extractEventId,
      extractEventType: config.extractEventType,
      extractTimestamp: config.extractTimestamp,
      extractEvents: config.extractEvents,
      rateLimitMax: config.rateLimitMax,
      rateLimitWindowMs: config.rateLimitWindowMs,
    };
    this.rateLimiter =
      rateLimiter ??
      new WebhookRateLimiter(
        config.rateLimitMax ?? 100,
        config.rateLimitWindowMs ?? 60_000,
      );
  }

  /**
   * Process an inbound webhook through the full validation pipeline.
   * Target: complete in < 100ms (architecture §25).
   */
  async receive(
    rawBody: string | Buffer,
    headers: Record<string, string>,
  ): Promise<WebhookReceiveResult> {
    const start = Date.now();
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');
    const payloadSize = Buffer.byteLength(bodyStr, 'utf-8');

    // 1. Signature validation
    const signatureValid = await this.config.auth.validate(rawBody, headers);
    if (!signatureValid) {
      this.emitLog(start, payloadSize, '', false, false, 'rejected_auth');
      this.onEventRejected();
      return { accepted: false, statusCode: 401, event: null, reason: 'Invalid signature' };
    }

    // 2. Payload size limit
    if (payloadSize > this.config.maxPayloadBytes) {
      this.emitLog(start, payloadSize, '', true, false, 'rejected_size');
      this.onEventRejected();
      return { accepted: false, statusCode: 413, event: null, reason: 'Payload too large' };
    }

    // 3. JSON parse
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyStr);
    } catch {
      this.emitLog(start, payloadSize, '', true, false, 'rejected_parse');
      this.onEventRejected();
      return { accepted: false, statusCode: 400, event: null, reason: 'Invalid JSON' };
    }

    // 4. Replay protection (fail-closed on unparseable; bounded forward skew)
    // Sentinel: treat 0 (and negative) as "no timestamp available" → skip check.
    // Providers that want to enforce replay should return null, not 0.
    if (this.config.extractTimestamp) {
      const ts = this.config.extractTimestamp(parsed);
      if (ts != null && ts !== 0) {
        const eventTime = typeof ts === 'number' ? ts : new Date(ts).getTime();
        if (!Number.isFinite(eventTime) || eventTime <= 0) {
          this.emitLog(start, payloadSize, '', true, false, 'rejected_replay');
          this.onEventRejected();
          return {
            accepted: false,
            statusCode: 400,
            event: null,
            reason: 'Replay check failed: unparseable timestamp',
          };
        }
        const skew = Date.now() - eventTime;
        if (skew > this.config.replayWindowMs || skew < -DEFAULT_FUTURE_SKEW_MS) {
          this.emitLog(start, payloadSize, '', true, false, 'rejected_replay');
          this.onEventRejected();
          return {
            accepted: false,
            statusCode: 400,
            event: null,
            reason: skew > 0 ? 'Replay detected: timestamp too old' : 'Replay detected: timestamp too far in the future',
          };
        }
      }
    }

    // 5. Multi-event fanout vs single-event
    if (this.config.extractEvents) {
      return this.handleMultiEvent(parsed, start, payloadSize);
    }

    return this.handleSingleEvent(parsed, start, payloadSize);
  }

  /* ---------------- Single-event path ---------------- */

  private async handleSingleEvent(
    parsed: unknown,
    start: number,
    payloadSize: number,
  ): Promise<WebhookReceiveResult> {
    const providerEventId = normalizeEventId(this.config.extractEventId?.(parsed));
    const eventType = this.config.extractEventType?.(parsed) ?? 'unknown';

    // Rate limiting BEFORE dedup (so duplicate floods still consume budget)
    if (!this.rateLimiter.allow(this.config.source)) {
      this.emitLog(start, payloadSize, eventType, true, false, 'rejected_rate_limit');
      this.onEventRejected();
      return { accepted: false, statusCode: 429, event: null, reason: 'Rate limit exceeded' };
    }

    const event = this.buildEvent(eventType, providerEventId, parsed);
    const inserted = await this.store.insertIfNotDuplicate(event);

    if (!inserted) {
      this.emitLog(start, payloadSize, eventType, true, true, 'duplicate_skipped');
      return { accepted: false, statusCode: 200, event: null, reason: 'Duplicate event' };
    }

    this.emitLog(start, payloadSize, eventType, true, false, 'accepted');
    this.onEventAccepted();
    return { accepted: true, statusCode: 200, event, reason: 'Accepted' };
  }

  /* ---------------- Multi-event fanout ---------------- */

  private async handleMultiEvent(
    parsed: unknown,
    start: number,
    payloadSize: number,
  ): Promise<WebhookReceiveResult> {
    // extractEvents is user-supplied; catch exceptions so bad payloads
    // surface as 400 rejected_parse rather than 500 uncaught.
    let items: ReturnType<NonNullable<typeof this.config.extractEvents>>;
    try {
      items = this.config.extractEvents!(parsed);
    } catch {
      this.emitLog(start, payloadSize, '', true, false, 'rejected_parse');
      this.onEventRejected();
      return { accepted: false, statusCode: 400, event: null, reason: 'Invalid JSON' };
    }

    // Per-batch item cap — bounds damage from pathological batches.
    if (items.length > this.config.maxEventsPerBatch) {
      this.emitLog(start, payloadSize, 'batch', true, false, 'rejected_size');
      this.onEventRejected();
      return {
        accepted: false,
        statusCode: 413,
        event: null,
        reason: `Batch too large: ${items.length} items (max ${this.config.maxEventsPerBatch})`,
      };
    }

    if (items.length === 0) {
      this.emitLog(start, payloadSize, 'empty', true, false, 'accepted');
      return { accepted: true, statusCode: 200, event: null, events: [], reason: 'Empty batch' };
    }

    // Single rate-limit check per POST (not per item) — a batch is one delivery.
    // The maxEventsPerBatch cap above is what bounds per-batch damage.
    if (!this.rateLimiter.allow(this.config.source)) {
      this.emitLog(start, payloadSize, 'batch', true, false, 'rejected_rate_limit');
      this.onEventRejected();
      return { accepted: false, statusCode: 429, event: null, reason: 'Rate limit exceeded' };
    }

    const accepted: WebhookEvent[] = [];
    let duplicateCount = 0;
    const seenInBatch = new Set<string>();

    for (const item of items) {
      const providerEventId = normalizeEventId(item.eventId);

      // In-batch dedup — skip rows with same event_id within this POST
      if (providerEventId && seenInBatch.has(providerEventId)) {
        duplicateCount++;
        continue;
      }
      if (providerEventId) seenInBatch.add(providerEventId);

      const event = this.buildEvent(item.eventType, providerEventId, item.payload);
      const inserted = await this.store.insertIfNotDuplicate(event);
      if (inserted) {
        accepted.push(event);
        this.onEventAccepted();
      } else {
        duplicateCount++;
      }
    }

    this.emitLog(
      start,
      payloadSize,
      'batch',
      true,
      duplicateCount > 0,
      accepted.length > 0 ? 'accepted' : 'duplicate_skipped',
    );

    return {
      accepted: accepted.length > 0,
      statusCode: 200,
      event: accepted[0] ?? null,
      events: accepted,
      reason: `Batch processed: ${accepted.length} accepted, ${duplicateCount} duplicates`,
    };
  }

  private buildEvent(
    eventType: string,
    providerEventId: string | null,
    rawPayload: unknown,
  ): WebhookEvent {
    return {
      id: randomUUID(),
      source: this.config.source,
      eventType,
      providerEventId,
      rawPayload,
      status: 'pending',
      attemptCount: 0,
      errorMessage: null,
      createdAtIso: new Date().toISOString(),
      processedAtIso: null,
      resultMeta: null,
    };
  }

  private emitLog(
    start: number,
    payloadSize: number,
    eventType: string,
    signatureValid: boolean,
    duplicate: boolean,
    outcome: WebhookLogEntry['outcome'],
  ): void {
    this.onLog({
      source: this.config.source,
      eventType,
      payloadSize,
      signatureValid,
      duplicate,
      processingTimeMs: Date.now() - start,
      outcome,
    });
  }
}

/** Coerce empty strings to null for dedup purposes. */
function normalizeEventId(id: string | null | undefined): string | null {
  if (!id) return null;
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : null;
}
