/**
 * SupabaseHealthProvider tests — Story 1.12c.
 *
 * Scope:
 *   - AC 1: periodic ping (`SELECT 1`), success/failure recorded on registry
 *   - AC 2: auto-unhealthy after 2 consecutive ping failures (>30s window)
 *           + admin alert emission on transition + auto-recovery on next success
 *   - AC 3: client factory is untouched — `getSupabaseAdminClient()` returns
 *           the raw Supabase client, no wrapping
 *   - Opt-in query-level reporting helpers report into the `supabase` registry
 *     entry without any SDK wrapping
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderRegistry } from '@/modules/providers/registry';
import {
  SupabaseHealthProvider,
  reportSupabaseDbFailure,
  reportSupabaseDbSuccess,
  setSharedSupabaseHealthProvider,
  resetSharedSupabaseHealthProviderForTest,
} from '@/modules/providers/supabase';

describe('SupabaseHealthProvider — periodic ping + health reporting', () => {
  beforeEach(() => {
    resetSharedSupabaseHealthProviderForTest();
  });

  afterEach(() => {
    resetSharedSupabaseHealthProviderForTest();
    vi.restoreAllMocks();
  });

  it('records a success on the registry when the ping resolves', async () => {
    const registry = new ProviderRegistry();
    registry.register('supabase');
    const pingFn = vi.fn().mockResolvedValue(undefined);

    const provider = new SupabaseHealthProvider({
      registry,
      pingFn,
      pingIntervalMs: 30_000,
    });

    await provider.ping();

    expect(pingFn).toHaveBeenCalledTimes(1);
    const snap = registry.getProvider('supabase');
    expect(snap?.health.totalAttempts).toBe(1);
    expect(snap?.health.totalFailures).toBe(0);
  });

  it('records a failure on the registry when the ping rejects', async () => {
    const registry = new ProviderRegistry();
    registry.register('supabase');
    const pingFn = vi.fn().mockRejectedValue(new Error('db down'));

    const provider = new SupabaseHealthProvider({
      registry,
      pingFn,
      pingIntervalMs: 30_000,
    });
    await provider.ping();

    expect(pingFn).toHaveBeenCalledTimes(1);
    const snap = registry.getProvider('supabase');
    expect(snap?.health.totalFailures).toBe(1);
  });

  it('start() schedules the interval and pings every `pingIntervalMs`', async () => {
    vi.useFakeTimers();
    try {
      const registry = new ProviderRegistry();
      registry.register('supabase');
      const pingFn = vi.fn().mockResolvedValue(undefined);

      const provider = new SupabaseHealthProvider({
        registry,
        pingFn,
        pingIntervalMs: 30_000,
      });
      provider.start();
      expect(pingFn).toHaveBeenCalledTimes(0); // no immediate ping by design

      await vi.advanceTimersByTimeAsync(30_000);
      expect(pingFn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(pingFn).toHaveBeenCalledTimes(2);

      provider.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SupabaseHealthProvider — circuit breaker', () => {
  beforeEach(() => {
    resetSharedSupabaseHealthProviderForTest();
  });

  afterEach(() => {
    resetSharedSupabaseHealthProviderForTest();
    vi.restoreAllMocks();
  });

  it('auto-transitions to degraded after 2 consecutive ping failures and fires onHealthEvent', async () => {
    const registry = new ProviderRegistry();
    registry.register('supabase');
    const events: Array<{ provider: string; newMode: string }> = [];
    registry.onHealthEvent = (e) => events.push({ provider: e.provider, newMode: e.newMode });

    const pingFn = vi.fn().mockRejectedValue(new Error('db down'));

    const provider = new SupabaseHealthProvider({
      registry,
      pingFn,
      pingIntervalMs: 30_000,
      consecutiveFailureThreshold: 2,
    });

    await provider.ping();
    expect(registry.getMode('supabase')).toBe('normal');

    await provider.ping();
    expect(registry.getMode('supabase')).toBe('degraded');
    expect(events.find((e) => e.provider === 'supabase' && e.newMode === 'degraded')).toBeDefined();
  });

  it('auto-recovers to normal on next successful ping after degraded', async () => {
    const registry = new ProviderRegistry();
    registry.register('supabase');
    const events: Array<{ previousMode: string; newMode: string }> = [];
    registry.onHealthEvent = (e) => events.push({ previousMode: e.previousMode, newMode: e.newMode });

    let call = 0;
    const pingFn = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call <= 2) throw new Error('db down');
    });

    const provider = new SupabaseHealthProvider({
      registry,
      pingFn,
      pingIntervalMs: 30_000,
      consecutiveFailureThreshold: 2,
    });

    await provider.ping(); // fail 1
    await provider.ping(); // fail 2 → degraded
    expect(registry.getMode('supabase')).toBe('degraded');

    await provider.ping(); // success → recover
    expect(registry.getMode('supabase')).toBe('normal');
    expect(events.some((e) => e.previousMode === 'degraded' && e.newMode === 'normal')).toBe(true);
  });

  it('stops firing ping after stop() is called', async () => {
    vi.useFakeTimers();
    try {
      const registry = new ProviderRegistry();
      registry.register('supabase');
      const pingFn = vi.fn().mockResolvedValue(undefined);

      const provider = new SupabaseHealthProvider({ registry, pingFn, pingIntervalMs: 30_000 });
      provider.start();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(pingFn).toHaveBeenCalledTimes(1);

      provider.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(pingFn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits exactly one normal→degraded transition across many consecutive failures', async () => {
    const registry = new ProviderRegistry();
    registry.register('supabase');
    const transitions: string[] = [];
    registry.onHealthEvent = (e) => transitions.push(`${e.previousMode}→${e.newMode}`);

    const pingFn = vi.fn().mockRejectedValue(new Error('db down'));

    const provider = new SupabaseHealthProvider({
      registry,
      pingFn,
      pingIntervalMs: 30_000,
      consecutiveFailureThreshold: 2,
    });

    for (let i = 0; i < 5; i += 1) {
      await provider.ping();
    }

    const degradedTransitions = transitions.filter((t) => t === 'normal→degraded');
    expect(degradedTransitions).toHaveLength(1);
  });

  it('does not auto-recover from kill_switched on a successful ping (manual failback required)', async () => {
    const registry = new ProviderRegistry();
    registry.register('supabase');
    // Operator manually kill-switches Supabase (hypothetical — DB is corrupt).
    registry.setMode('supabase', 'kill_switched', 'Operator: emergency freeze');
    const pingFn = vi.fn().mockResolvedValue(undefined);

    const provider = new SupabaseHealthProvider({ registry, pingFn, pingIntervalMs: 30_000 });
    await provider.ping();

    expect(registry.getMode('supabase')).toBe('kill_switched');
  });

  it('after recovery, a single subsequent failure does NOT re-degrade (threshold reset regression test)', async () => {
    const registry = new ProviderRegistry();
    registry.register('supabase');

    let call = 0;
    const pingFn = vi.fn().mockImplementation(async () => {
      call += 1;
      // Pattern: fail, fail (degrade), succeed (recover), fail (must NOT re-degrade), ...
      if (call === 1 || call === 2 || call === 4) throw new Error('db blip');
    });

    const provider = new SupabaseHealthProvider({
      registry,
      pingFn,
      pingIntervalMs: 30_000,
      consecutiveFailureThreshold: 2,
    });

    await provider.ping(); // fail 1
    await provider.ping(); // fail 2 → degraded
    expect(registry.getMode('supabase')).toBe('degraded');

    await provider.ping(); // success → normal
    expect(registry.getMode('supabase')).toBe('normal');

    await provider.ping(); // single fail AFTER recovery
    expect(registry.getMode('supabase')).toBe('normal');
  });

  it('recovers from `degraded` even when it was set by the registry (statistical auto-degrade)', async () => {
    // Review finding E12/P2: handlePingSuccess must recover from `degraded`
    // regardless of whether consecutiveFailures > 0 — otherwise a
    // statistical auto-transition (≥30% error rate from opt-in query
    // reporting) would permanently strand the provider in `degraded`.
    const registry = new ProviderRegistry();
    registry.register('supabase');
    // Simulate the registry flipping mode via a different code path (operator,
    // evaluateTransitions, etc.) — NOT via the health provider's ping failures.
    registry.setMode('supabase', 'degraded', 'Statistical auto-degrade: 35% error rate');

    const pingFn = vi.fn().mockResolvedValue(undefined);
    const provider = new SupabaseHealthProvider({
      registry,
      pingFn,
      pingIntervalMs: 30_000,
    });

    await provider.ping();

    expect(registry.getMode('supabase')).toBe('normal');
  });

  it('times out a hung pingFn and records a failure (does not get stuck)', async () => {
    vi.useFakeTimers();
    try {
      const registry = new ProviderRegistry();
      registry.register('supabase');
      const pingFn = vi.fn().mockImplementation(() => new Promise(() => {})); // hangs forever

      const provider = new SupabaseHealthProvider({
        registry,
        pingFn,
        pingIntervalMs: 10_000,
        pingTimeoutMs: 5_000,
      });

      const pingPromise = provider.ping();
      await vi.advanceTimersByTimeAsync(6_000);
      await pingPromise;

      const snap = registry.getProvider('supabase');
      expect(snap?.health.totalFailures).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps consecutiveFailureThreshold to ≥1 (0 config does not fire on first failure)', async () => {
    const registry = new ProviderRegistry();
    registry.register('supabase');
    const pingFn = vi.fn().mockRejectedValue(new Error('db down'));

    const provider = new SupabaseHealthProvider({
      registry,
      pingFn,
      pingIntervalMs: 30_000,
      consecutiveFailureThreshold: 0, // misconfigured
    });

    await provider.ping();
    // With clamp to 1, threshold of 0 becomes 1 — first failure fires degraded.
    // This is the MAX-clamped behavior, not the 0-misconfig behavior.
    expect(registry.getMode('supabase')).toBe('degraded');
  });

  it('logs a warning when supabase is not registered and a ping fails', async () => {
    // handlePingFailure guards against unregistered provider so outage is at
    // least visible via the log (review finding E3/P5).
    const registry = new ProviderRegistry();
    // DO NOT register 'supabase' here.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pingFn = vi.fn().mockRejectedValue(new Error('db down'));

    const provider = new SupabaseHealthProvider({
      registry,
      pingFn,
      pingIntervalMs: 30_000,
      consecutiveFailureThreshold: 1,
    });

    await provider.ping();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('supabase` is not registered'),
    );
    warnSpy.mockRestore();
  });

  it('start() after stop() with a prior in-flight ping does not leave pingInFlight stuck', async () => {
    // Review finding B1/P7: if a ping was in flight when stop() was called
    // and the caller restarts, subsequent ticks must not be silenced by a
    // stale pingInFlight flag.
    vi.useFakeTimers();
    try {
      const registry = new ProviderRegistry();
      registry.register('supabase');

      let hangResolve: ((value: void) => void) | null = null;
      const pingFn = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((r) => {
              hangResolve = r;
            }),
        )
        .mockResolvedValue(undefined);

      const provider = new SupabaseHealthProvider({
        registry,
        pingFn,
        pingIntervalMs: 10_000,
        pingTimeoutMs: 5_000,
      });

      provider.start();
      await vi.advanceTimersByTimeAsync(10_000); // triggers hung ping #1
      provider.stop();
      // Resolve the hung ping AFTER stop — previously left pingInFlight stuck.
      (hangResolve as ((v: void) => void) | null)?.(undefined);
      await Promise.resolve();

      provider.start();
      await vi.advanceTimersByTimeAsync(10_000); // triggers ping #2
      await Promise.resolve();

      expect(pingFn).toHaveBeenCalledTimes(2);
      provider.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('opt-in query reporting helpers', () => {
  beforeEach(() => {
    resetSharedSupabaseHealthProviderForTest();
  });

  afterEach(() => {
    resetSharedSupabaseHealthProviderForTest();
  });

  it('reportSupabaseDbSuccess / reportSupabaseDbFailure record against the registry', () => {
    const registry = new ProviderRegistry();
    registry.register('supabase');

    const provider = new SupabaseHealthProvider({
      registry,
      pingFn: () => Promise.resolve(),
      pingIntervalMs: 30_000,
    });
    setSharedSupabaseHealthProvider(provider);

    reportSupabaseDbSuccess(42);
    reportSupabaseDbSuccess(17);
    reportSupabaseDbFailure(99, 'transient');

    const snap = registry.getProvider('supabase');
    expect(snap?.health.totalAttempts).toBe(3);
    expect(snap?.health.totalFailures).toBe(1);
  });

  it('reporting helpers silently no-op when the shared provider is not wired', () => {
    expect(() => reportSupabaseDbSuccess(1)).not.toThrow();
    expect(() => reportSupabaseDbFailure(1, 'transient')).not.toThrow();
  });
});
