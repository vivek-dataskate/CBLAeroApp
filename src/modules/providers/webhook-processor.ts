import type {
  WebhookEvent,
  WebhookHandler,
  WebhookHandlerResult,
  WebhookProcessorConfig,
} from './types';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 1_000;
const DEFAULT_BATCH_SIZE = 10;

/**
 * Persistence interface for the webhook processor.
 * Designed for FOR UPDATE SKIP LOCKED claim pattern.
 */
export interface WebhookProcessorStore {
  /** Claim a batch of pending/failed events using FOR UPDATE SKIP LOCKED. */
  claimBatch(batchSize: number): Promise<WebhookEvent[]>;

  /**
   * Mark an event completed, with optional handler result metadata.
   * Implementations should persist `resultMeta` as JSONB alongside the row.
   */
  markCompleted(eventId: string, result?: WebhookHandlerResult): Promise<void>;

  /**
   * Mark event failed; will be retried on the next batch tick after
   * `nextAttemptAt` has elapsed. If `nextAttemptAt` is undefined the store
   * MAY treat the event as immediately re-claimable (legacy behavior); new
   * stores should persist the timestamp and have `claimBatch` filter by it.
   */
  markFailed(
    eventId: string,
    errorMessage: string,
    attemptCount: number,
    nextAttemptAt?: Date,
  ): Promise<void>;

  /** Mark event permanently failed — exhausted retries. */
  markDeadLetter(eventId: string, errorMessage: string): Promise<void>;
}

/**
 * Background webhook event processor.
 *
 * Behavior (per decision 2B — story 1-12 code review 2026-04-16):
 *   maxRetries = 3 means 4 total attempts (1 initial + 3 retries), then dead-letter.
 *
 * **Decision 3C (deferred, not implemented):** inter-retry backoff is NOT enforced
 * by this processor — failed events are marked `failed` and re-claimed on the
 * next batch tick with no delay. The intended fix is to add a `next_attempt_at`
 * column to `webhook_events` and have `claimBatch` filter by it. `getBackoffMs()`
 * below is provided as a helper for consumer stories that implement this, but
 * it is not called internally. See story 1-12 Review Findings for context.
 *
 * Handlers may return result metadata which is persisted with the event row
 * — useful for linking processing outcomes to upstream observability
 * (e.g. sync_runs.id, candidate_id, per-row outcomes).
 */
export class WebhookProcessor {
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly batchSize: number;

  public onLog: (msg: string, meta?: Record<string, unknown>) => void = () => {};
  /** Fires when an event is dead-lettered or rejected (no handler, exhausted retries). */
  public onEventRejected: () => void = () => {};

  constructor(
    private readonly store: WebhookProcessorStore,
    private readonly handlers: Map<string, WebhookHandler>,
    config?: WebhookProcessorConfig,
  ) {
    this.maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.backoffMs = config?.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.batchSize = config?.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  /** Process one batch. Returns number of events processed. */
  async processBatch(): Promise<number> {
    const events = await this.store.claimBatch(this.batchSize);
    if (events.length === 0) return 0;

    for (const event of events) {
      await this.processEvent(event);
    }
    return events.length;
  }

  private async processEvent(event: WebhookEvent): Promise<void> {
    const handler = this.handlers.get(event.source);
    if (!handler) {
      this.onLog('No handler registered for source', {
        source: event.source,
        eventId: event.id,
      });
      await this.store.markDeadLetter(event.id, `No handler for source: ${event.source}`);
      this.onEventRejected();
      return;
    }

    try {
      const result = await handler.handle(event);
      await this.store.markCompleted(event.id, result ?? undefined);
      this.onLog('Event processed successfully', {
        source: event.source,
        eventId: event.id,
        resultSummary: result && 'summary' in result ? result.summary : undefined,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      const nextAttempt = event.attemptCount + 1;

      // Decision 2B: 4 total attempts (1 initial + maxRetries retries), then dead-letter.
      if (nextAttempt > this.maxRetries) {
        await this.store.markDeadLetter(event.id, errorMessage);
        this.onLog('Event dead-lettered after max retries', {
          source: event.source,
          eventId: event.id,
          attempts: nextAttempt,
          error: errorMessage,
          stack,
        });
        this.onEventRejected();
      } else {
        // Review patch M-4: schedule the next attempt via getBackoffMs so a
        // next_attempt_at-aware store enforces exponential backoff. Legacy
        // stores that ignore the 4th arg continue to re-claim immediately
        // (back-compat), but the contract now passes the timestamp.
        const nextAttemptAt = new Date(Date.now() + this.getBackoffMs(nextAttempt));
        await this.store.markFailed(event.id, errorMessage, nextAttempt, nextAttemptAt);
        this.onLog('Event processing failed, will retry', {
          source: event.source,
          eventId: event.id,
          attempt: nextAttempt,
          maxRetries: this.maxRetries,
          nextAttemptAt: nextAttemptAt.toISOString(),
          error: errorMessage,
          stack,
        });
      }
    }
  }

  /** Configured backoff delay for a given attempt number. */
  getBackoffMs(attempt: number): number {
    return this.backoffMs * Math.pow(2, attempt);
  }
}
