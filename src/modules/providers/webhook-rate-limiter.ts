/**
 * Per-source sliding window rate limiter for inbound webhooks.
 *
 * Architecture ref: architecture.md §25
 * Default: 100 events per 60 seconds per source.
 *
 * Note: state is in-memory; on multi-instance deploys (Render workers), this
 * enforces per-process limits, not global. For strict global limits, back with
 * Redis. Framework-only story 1-12 accepts per-process scope — documented.
 */
export class WebhookRateLimiter {
  /** source → array of timestamps (epoch ms) */
  private readonly windows = new Map<string, number[]>();
  /** Auto-prune every N allow() calls to bound Map size when many sources seen. */
  private readonly autoPruneInterval: number;
  private allowCallCount = 0;

  constructor(
    private readonly maxEvents: number = 100,
    private readonly windowMs: number = 60_000,
    /** Prune empty source entries every N allow() calls (default 1000). */
    autoPruneInterval: number = 1000,
  ) {
    if (maxEvents <= 0) throw new Error('WebhookRateLimiter: maxEvents must be > 0');
    if (windowMs <= 0) throw new Error('WebhookRateLimiter: windowMs must be > 0');
    if (autoPruneInterval <= 0) throw new Error('WebhookRateLimiter: autoPruneInterval must be > 0');
    this.autoPruneInterval = autoPruneInterval;
  }

  /**
   * Returns true if the event is allowed, false if rate-limited.
   * Prunes expired entries on access. Auto-prunes empty source entries
   * every N calls to bound memory growth.
   */
  allow(source: string): boolean {
    this.allowCallCount++;
    if (this.allowCallCount % this.autoPruneInterval === 0) {
      this.pruneEmpty();
    }
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.windows.get(source);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(source, timestamps);
    }

    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= this.maxEvents) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  /** Current count for a source (for monitoring). Prunes expired entries. */
  count(source: string): number {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = this.windows.get(source);
    if (!timestamps) return 0;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }
    return timestamps.length;
  }

  /**
   * Drop empty source entries to bound memory growth when many distinct
   * sources are seen over time. Call periodically (e.g. on a timer or after
   * N allow() calls). Returns number of sources pruned.
   */
  pruneEmpty(): number {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let pruned = 0;
    for (const [source, timestamps] of this.windows.entries()) {
      while (timestamps.length > 0 && timestamps[0] < cutoff) {
        timestamps.shift();
      }
      if (timestamps.length === 0) {
        this.windows.delete(source);
        pruned++;
      }
    }
    return pruned;
  }

  /** Number of distinct sources tracked. */
  sourceCount(): number {
    return this.windows.size;
  }

  /** Clear all state (for tests). */
  clearForTest(): void {
    this.windows.clear();
  }
}
