import type { ProviderHealthEvent } from './types';

/**
 * Persistence hook for provider health transitions.
 *
 * Canonical shape for the `cblaero_app.provider_health_events` table.
 * Consumer stories (1-12a/b/c) wire this to their Supabase client
 * rather than reimplementing the insert logic per migration.
 *
 * `persist()` NEVER throws — it returns `{ ok, error? }`. Callers MUST check
 * the result and log errors themselves. Using `.catch()` on the promise
 * will not surface errors. See example below.
 *
 * Usage:
 *   const store = new PostgresHealthEventStore(async (row) => {
 *     await supabase.from('provider_health_events').insert(row);
 *   });
 *   registry.onHealthEvent = async (e) => {
 *     const r = await store.persist(e);
 *     if (!r.ok) logger.error('provider_health_events insert failed', { error: r.error, event: e });
 *   };
 */
export interface HealthEventRow {
  provider: string;
  previous_mode: string;
  new_mode: string;
  reason: string;
  error_rate: number;
  attempt_count: number;
  occurred_at: string;
}

export class PostgresHealthEventStore {
  constructor(
    private readonly insert: (row: HealthEventRow) => Promise<void>,
  ) {}

  /**
   * Persist a single health event. Non-throwing — callers should log errors.
   * We never want a logging failure to crash the request or worker loop that
   * triggered the transition.
   */
  async persist(event: ProviderHealthEvent): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.insert({
        provider: event.provider,
        previous_mode: event.previousMode,
        new_mode: event.newMode,
        reason: event.reason,
        error_rate: event.errorRate,
        attempt_count: event.attemptCount,
        occurred_at: event.occurredAtIso,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
