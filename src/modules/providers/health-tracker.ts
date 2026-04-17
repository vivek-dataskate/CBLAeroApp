import type { ErrorClassification, HealthSnapshot, HealthStatus } from './types';

/**
 * Extended snapshot — bundles the kill-switch-relevant non-auth attempt count
 * so callers get a consistent single-prune view (review patch M-3). The
 * original `HealthSnapshot` shape is still returned by `snapshot()` for
 * back-compat; `snapshotWithNonAuthAttempts()` is preferred for new callers.
 */
export interface HealthSnapshotWithNonAuth extends HealthSnapshot {
  nonAuthAttempts: number;
}

/**
 * Rolling 5-minute window health tracker for a single provider.
 * Tracks error rate and p95 latency.
 *
 * Auth failures are recorded separately and EXCLUDED from the kill-switch
 * error rate — they indicate a credential problem, not a provider outage.
 * Retrying auth failures won't help, and they shouldn't trigger the kill switch
 * (which exists to protect against provider outages).
 *
 * Architecture ref: architecture.md §25 — Health monitoring
 */
export class HealthTracker {
  private readonly windowMs: number;
  private readonly entries: Array<{
    timestamp: number;
    durationMs: number;
    success: boolean;
    classification: ErrorClassification | null;
  }> = [];

  constructor(windowMs: number = 5 * 60 * 1000) {
    this.windowMs = windowMs;
  }

  recordSuccess(durationMs: number): void {
    this.entries.push({ timestamp: Date.now(), durationMs, success: true, classification: null });
    this.prune();
  }

  recordFailure(durationMs: number, classification: ErrorClassification = 'transient'): void {
    this.entries.push({ timestamp: Date.now(), durationMs, success: false, classification });
    this.prune();
  }

  /**
   * Snapshot excludes auth_failure entries from the error-rate calculation.
   * They still appear in totalAttempts for visibility, but don't drive the kill switch.
   *
   * Review patch M-3: delegates to `snapshotWithNonAuthAttempts()` so the
   * prune + filter happens in a single pass. The original `snapshot()` shape
   * is preserved for back-compat.
   */
  snapshot(): HealthSnapshot {
    const { nonAuthAttempts: _dropped, ...base } = this.snapshotWithNonAuthAttempts();
    void _dropped;
    return base;
  }

  /**
   * Review patch M-3: single-prune snapshot that returns BOTH the error-rate
   * stats AND the non-auth attempt count. Callers that need both (e.g.
   * `ProviderRegistry.evaluateTransitions`) should use this to avoid the
   * double-prune TOCTOU where `snapshot()` and `nonAuthAttemptCount()` could
   * disagree across a window boundary.
   */
  snapshotWithNonAuthAttempts(): HealthSnapshotWithNonAuth {
    this.prune();
    const total = this.entries.length;
    if (total === 0) {
      return {
        status: 'healthy',
        errorRate: 0,
        p95LatencyMs: 0,
        totalAttempts: 0,
        totalFailures: 0,
        nonAuthAttempts: 0,
      };
    }

    const nonAuthEntries = this.entries.filter((e) => e.classification !== 'auth_failure');
    const nonAuthTotal = nonAuthEntries.length;
    const nonAuthFailures = nonAuthEntries.filter((e) => !e.success).length;
    const errorRate = nonAuthTotal === 0 ? 0 : nonAuthFailures / nonAuthTotal;

    const failures = this.entries.filter((e) => !e.success).length;

    const durations = this.entries.map((e) => e.durationMs).sort((a, b) => a - b);
    const p95Index = Math.min(Math.ceil(total * 0.95) - 1, total - 1);
    const p95LatencyMs = durations[p95Index];

    const status: HealthStatus =
      errorRate >= 0.8 ? 'unhealthy' : errorRate >= 0.3 ? 'degraded' : 'healthy';

    return {
      status,
      errorRate,
      p95LatencyMs,
      totalAttempts: total,
      totalFailures: failures,
      nonAuthAttempts: nonAuthTotal,
    };
  }

  /**
   * Kill-switch-relevant attempt count — excludes auth failures.
   * Used by the registry to gate the KILL_SWITCH_MIN_ATTEMPTS threshold.
   *
   * Prefer `snapshotWithNonAuthAttempts()` when both the error-rate and
   * non-auth count are needed together (review patch M-3).
   */
  nonAuthAttemptCount(): number {
    this.prune();
    return this.entries.filter((e) => e.classification !== 'auth_failure').length;
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.entries.length > 0 && this.entries[0].timestamp <= cutoff) {
      this.entries.shift();
    }
  }

  clearForTest(): void {
    this.entries.length = 0;
  }
}
