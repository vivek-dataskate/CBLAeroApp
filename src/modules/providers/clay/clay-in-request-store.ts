/**
 * In-request store for the Clay webhook pipeline.
 *
 * Satisfies both `WebhookEventStore` (used by `BaseWebhookReceiver` when
 * fanning out batch rows) and `WebhookProcessorStore` (used by `WebhookProcessor`
 * when draining events synchronously). Kept in one class because Clay processes
 * events inline in the HTTP request — there is no separate claim/mark loop.
 *
 * Persistence to `webhook_events` is best-effort: Supabase insert/update errors
 * are logged and swallowed so observability never blocks ingestion (architecture
 * §25, same principle as `PostgresHealthEventStore`).
 */
import type { WebhookEvent, WebhookHandlerResult } from '../types';
import type { WebhookEventStore } from '../webhook-receiver';
import type { WebhookProcessorStore } from '../webhook-processor';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ClayEventResult {
  status: 'completed' | 'failed' | 'dead_letter';
  result?: WebhookHandlerResult;
  error?: string;
}

export class ClayInRequestStore implements WebhookEventStore, WebhookProcessorStore {
  private readonly queue: WebhookEvent[] = [];
  private readonly eventsById = new Map<string, WebhookEvent>();
  private readonly results = new Map<string, ClayEventResult>();

  constructor(
    /** Supabase admin client — when undefined, persistence is skipped entirely. */
    private readonly supabase?: SupabaseClient | null,
  ) {}

  /* WebhookEventStore ---------------------------------------------------- */

  async insertIfNotDuplicate(event: WebhookEvent): Promise<boolean> {
    this.queue.push(event);
    this.eventsById.set(event.id, event);
    await this.bestEffort('insert', async () => {
      const sb = this.supabase;
      if (!sb) return;
      const builder = sb.from('webhook_events') as unknown as {
        insert?: (row: Record<string, unknown>) => Promise<unknown>;
      };
      if (typeof builder.insert !== 'function') return;
      await builder.insert({
        id: event.id,
        source: event.source,
        event_type: event.eventType,
        provider_event_id: event.providerEventId,
        raw_payload: event.rawPayload,
        status: event.status,
        attempt_count: event.attemptCount,
        error_message: event.errorMessage,
        created_at: event.createdAtIso,
        processed_at: event.processedAtIso,
        result_meta: event.resultMeta,
      });
    });
    return true;
  }

  /* WebhookProcessorStore ------------------------------------------------ */

  async claimBatch(batchSize: number): Promise<WebhookEvent[]> {
    return this.queue.splice(0, batchSize);
  }

  async markCompleted(eventId: string, result?: WebhookHandlerResult): Promise<void> {
    this.results.set(eventId, { status: 'completed', result });
    await this.upsertTerminal(eventId, 'update-completed', {
      status: 'completed',
      processed_at: new Date().toISOString(),
      result_meta: result?.meta ?? null,
    });
  }

  async markFailed(
    eventId: string,
    errorMessage: string,
    attemptCount: number,
    nextAttemptAt?: Date,
  ): Promise<void> {
    this.results.set(eventId, { status: 'failed', error: errorMessage });
    await this.upsertTerminal(eventId, 'update-failed', {
      status: 'failed',
      attempt_count: attemptCount,
      error_message: errorMessage,
      next_attempt_at: nextAttemptAt?.toISOString() ?? null,
    });
  }

  async markDeadLetter(eventId: string, errorMessage: string): Promise<void> {
    this.results.set(eventId, { status: 'dead_letter', error: errorMessage });
    await this.upsertTerminal(eventId, 'update-dead-letter', {
      status: 'dead_letter',
      error_message: errorMessage,
      processed_at: new Date().toISOString(),
    });
  }

  /**
   * Review patch M-5: write terminal rows via UPDATE then, if that fails,
   * fall back to UPSERT so a row with no prior `insertIfNotDuplicate`
   * (e.g., insert returned a transient 5xx that best-effort swallowed) still
   * lands in the terminal state instead of being stuck at `pending` forever.
   */
  private async upsertTerminal(
    eventId: string,
    op: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const sb = this.supabase;
    if (!sb) return;
    const event = this.eventsById.get(eventId);

    await this.bestEffort(op, async () => {
      const builder = sb.from('webhook_events') as unknown as {
        update?: (row: Record<string, unknown>) => {
          eq: (col: string, val: string) => Promise<{ data?: unknown; error?: { message?: string } | null; count?: number | null }>;
        };
        upsert?: (row: Record<string, unknown>) => Promise<{ error?: { message?: string } | null }>;
      };
      if (typeof builder.update !== 'function') return;
      const updateResp = await builder.update(patch).eq('id', eventId);
      const updateErr = (updateResp as { error?: { message?: string } | null })?.error;
      if (!updateErr) return;

      // Fallback upsert — ensures we never strand a terminal event because
      // the earlier insert was swallowed (bestEffort). Requires `id` PK.
      if (typeof builder.upsert !== 'function' || !event) {
        throw new Error(updateErr.message ?? 'update failed and no upsert fallback available');
      }
      const upsertResp = await builder.upsert({
        id: event.id,
        source: event.source,
        event_type: event.eventType,
        provider_event_id: event.providerEventId,
        raw_payload: event.rawPayload,
        attempt_count: event.attemptCount,
        created_at: event.createdAtIso,
        ...patch,
      });
      const upsertErr = upsertResp?.error;
      if (upsertErr) throw new Error(upsertErr.message ?? 'upsert fallback failed');
    });
  }

  /* Accessors ------------------------------------------------------------ */

  /** Iterate events in the order they were received (even after claim). */
  getAllEvents(): WebhookEvent[] {
    return [...this.eventsById.values()];
  }

  getResult(eventId: string): ClayEventResult | undefined {
    return this.results.get(eventId);
  }

  private async bestEffort(op: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      console.error(
        `[clay-webhook-store] ${op} failed (non-fatal):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
