/**
 * SupabaseHealthProvider — Story 1.12c.
 *
 * Unlike Telnyx/Instantly/Clay/Graph, Supabase is NOT wrapped in
 * `BaseProviderClient`. The Supabase JS SDK owns connection pooling, retry,
 * and timeout via PostgREST — wrapping every query would add latency to
 * every DB call and break the fluent API (`client.from().select().eq()`).
 *
 * Instead we add health-only monitoring:
 *   - Periodic lightweight ping against `provider_health_events` every
 *     `pingIntervalMs`
 *   - Success / failure recorded on `ProviderRegistry` so Supabase shows up
 *     alongside every other provider on the admin dashboard
 *   - Explicit mode transition (`normal → degraded`) after N consecutive
 *     ping failures → fires the existing admin-alert sink, same channel
 *     the other providers use
 *   - Auto-recovery: next successful ping transitions back to `normal` when
 *     mode is `degraded` (from any source — ping failures OR statistical
 *     auto-degrade via opt-in query reporting). `kill_switched` still
 *     requires manual failback by design.
 *
 * Architecture ref: architecture.md §25 — Supabase special case.
 */
import type { ProviderRegistry } from '../registry';
import type { ErrorClassification } from '../types';

/**
 * Ceiling on how long a single ping can take before it's treated as a
 * failure. Prevents a hung PostgREST call from leaving `pingInFlight`
 * stuck forever (which would silently suppress every subsequent interval
 * tick). Multiplier chosen so normal slow DBs don't trigger it while still
 * bounding worst-case silence at ≈1 tick.
 */
const PING_TIMEOUT_RATIO = 0.8;

export interface SupabaseHealthProviderConfig {
  registry: ProviderRegistry;
  /**
   * Injected ping function. Production wiring uses a closure around
   * `getSupabaseAdminClient()` that runs a lightweight read; tests inject
   * a mock so behavior is deterministic without hitting Postgres.
   *
   * Must throw on failure; return value is ignored on success.
   */
  pingFn: () => Promise<void>;
  /** Default 30 000 ms (AC 1). */
  pingIntervalMs?: number;
  /**
   * Number of back-to-back failing pings required before transitioning the
   * provider mode to `degraded`. Default 2 — at a 30 s interval, that is
   * >30 s of consecutive failures (AC 2). Clamped to ≥1 to avoid a
   * first-failure-fires-immediately misconfiguration.
   */
  consecutiveFailureThreshold?: number;
  /**
   * Timeout applied to each `pingFn()` invocation. Defaults to
   * `pingIntervalMs * 0.8` so a hung call never persists across more than
   * one tick.
   */
  pingTimeoutMs?: number;
}

export class SupabaseHealthProvider {
  private readonly registry: ProviderRegistry;
  private readonly pingFn: () => Promise<void>;
  private readonly pingIntervalMs: number;
  private readonly threshold: number;
  private readonly pingTimeoutMs: number;

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private pingInFlight = false;

  constructor(config: SupabaseHealthProviderConfig) {
    this.registry = config.registry;
    this.pingFn = config.pingFn;
    this.pingIntervalMs = config.pingIntervalMs ?? 30_000;
    // Clamp to ≥1 — a zero/negative threshold would either never fire or
    // fire on the first failure, both undesirable.
    this.threshold = Math.max(1, config.consecutiveFailureThreshold ?? 2);
    this.pingTimeoutMs =
      config.pingTimeoutMs ?? Math.max(1_000, Math.floor(this.pingIntervalMs * PING_TIMEOUT_RATIO));
  }

  /**
   * Schedule periodic health pings every `pingIntervalMs`. Does NOT fire an
   * immediate first ping — callers that want a priming observation before
   * the first window elapses should `await provider.ping()` explicitly
   * after `start()`. Calling `start()` on an already-running provider is a
   * no-op.
   *
   * Always clears `pingInFlight` so a stop+restart cycle (e.g. a test
   * tearing down then re-initializing) never inherits a stuck flag from a
   * previous in-flight ping.
   */
  start(): void {
    if (this.pingTimer) return;
    this.pingInFlight = false;
    const timer = setInterval(() => void this.ping(), this.pingIntervalMs);
    const unref = (timer as unknown as { unref?: () => void }).unref;
    if (typeof unref === 'function') unref.call(timer);
    this.pingTimer = timer;
  }

  stop(): void {
    if (!this.pingTimer) return;
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /**
   * Run one health ping. Public so startup and tests can trigger a
   * deterministic first observation before letting the interval take over.
   */
  async ping(): Promise<void> {
    if (this.pingInFlight) return;
    this.pingInFlight = true;
    const start = Date.now();
    try {
      await this.runPingWithTimeout();
      const durationMs = Date.now() - start;
      this.registry.recordSuccess('supabase', durationMs);
      this.handlePingSuccess();
    } catch (err) {
      const durationMs = Date.now() - start;
      this.registry.recordFailure('supabase', durationMs, 'transient');
      this.handlePingFailure(err);
    } finally {
      this.pingInFlight = false;
    }
  }

  /**
   * Opt-in query-level reporting for repositories that want their DB
   * operations to feed the `supabase` health window with higher resolution
   * than the ping cadence alone.
   */
  recordQuerySuccess(durationMs: number): void {
    this.registry.recordSuccess('supabase', durationMs);
  }

  recordQueryFailure(
    durationMs: number,
    classification: ErrorClassification = 'transient',
  ): void {
    this.registry.recordFailure('supabase', durationMs, classification);
  }

  private async runPingWithTimeout(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        this.pingFn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`ping timed out after ${this.pingTimeoutMs}ms`)),
            this.pingTimeoutMs,
          );
          const unref = (timer as unknown as { unref?: () => void }).unref;
          if (typeof unref === 'function') unref.call(timer);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private handlePingSuccess(): void {
    this.consecutiveFailures = 0;
    // Recover from `degraded` on the first successful ping — regardless of
    // whether we entered `degraded` via this class's threshold transition
    // or via the registry's statistical auto-degrade (≥30% error rate from
    // opt-in query reporting). `kill_switched` is NOT auto-recovered;
    // manual failback is required for that state.
    if (this.registry.getMode('supabase') !== 'degraded') return;
    this.safeSetMode('normal', 'Supabase health ping recovered — DB reachable again');
  }

  private handlePingFailure(err: unknown): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures < this.threshold) return;
    const mode = this.registry.getMode('supabase');
    if (mode === null) {
      // Unregistered provider — should never happen in production because
      // startup registers `supabase` before constructing the health
      // provider. Log rather than silently swallowing the outage signal.
      console.warn(
        '[SupabaseHealthProvider] ping failed but `supabase` is not registered in ProviderRegistry — outage invisible',
      );
      return;
    }
    if (mode !== 'normal') return;
    const message = err instanceof Error ? err.message : String(err);
    this.safeSetMode(
      'degraded',
      `Supabase health ping failed ${this.consecutiveFailures}x consecutively: ${message}`,
    );
  }

  /**
   * `ProviderRegistry.setMode` validates mode + reason and throws on bad
   * input. We never construct bad input here, but wrapping keeps an
   * exception inside a transition from escaping `void ping()` and becoming
   * an unhandled rejection.
   */
  private safeSetMode(mode: 'normal' | 'degraded', reason: string): void {
    try {
      this.registry.setMode('supabase', mode, reason);
    } catch (err) {
      console.error(
        '[SupabaseHealthProvider] setMode threw — transition not emitted:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Shared singleton + opt-in query reporting helpers                  */
/* ------------------------------------------------------------------ */

let sharedProvider: SupabaseHealthProvider | null = null;

export function setSharedSupabaseHealthProvider(
  provider: SupabaseHealthProvider | null,
): void {
  sharedProvider = provider;
}

export function getSharedSupabaseHealthProvider(): SupabaseHealthProvider | null {
  return sharedProvider;
}

export function resetSharedSupabaseHealthProviderForTest(): void {
  sharedProvider?.stop();
  sharedProvider = null;
}

/**
 * Silent no-op when the provider is not wired so scripts, tests, and one-off
 * invocations can call these without guarding.
 */
export function reportSupabaseDbSuccess(durationMs: number): void {
  sharedProvider?.recordQuerySuccess(durationMs);
}

export function reportSupabaseDbFailure(
  durationMs: number,
  classification: ErrorClassification = 'transient',
): void {
  sharedProvider?.recordQueryFailure(durationMs, classification);
}
