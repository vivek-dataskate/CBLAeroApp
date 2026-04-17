import type { ErrorClassification, HealthSnapshot, HealthStatus } from './types';

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
   */
  snapshot(): HealthSnapshot {
    this.prune();
    const total = this.entries.length;
    if (total === 0) {
      return { status: 'healthy', errorRate: 0, p95LatencyMs: 0, totalAttempts: 0, totalFailures: 0 };
    }

    // Health/kill-switch math excludes auth failures (credential issues, not outages).
    const nonAuthEntries = this.entries.filter((e) => e.classification !== 'auth_failure');
    const nonAuthTotal = nonAuthEntries.length;
    const nonAuthFailures = nonAuthEntries.filter((e) => !e.success).length;
    const errorRate = nonAuthTotal === 0 ? 0 : nonAuthFailures / nonAuthTotal;

    // Full totals for visibility
    const failures = this.entries.filter((e) => !e.success).length;

    // p95 latency across all entries
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
    };
  }

  /**
   * Kill-switch-relevant attempt count — excludes auth failures.
   * Used by the registry to gate the KILL_SWITCH_MIN_ATTEMPTS threshold.
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
