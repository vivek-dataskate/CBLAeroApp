import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderRegistry } from '../providers/registry';
import { HealthTracker } from '../providers/health-tracker';
import { BaseProviderClient } from '../providers/base-client';
import { BearerTokenAuth } from '../providers/auth/bearer-token';
import { PostgresHealthEventStore } from '../providers/health-event-store';
import type { ProviderHealthEvent } from '../providers/types';

/* ------------------------------------------------------------------ */
/*  HealthTracker Unit Tests                                           */
/* ------------------------------------------------------------------ */

describe('HealthTracker', () => {
  it('reports healthy with no data', () => {
    const tracker = new HealthTracker();
    const snap = tracker.snapshot();
    expect(snap.status).toBe('healthy');
    expect(snap.errorRate).toBe(0);
    expect(snap.totalAttempts).toBe(0);
  });

  it('tracks success rate correctly', () => {
    const tracker = new HealthTracker();
    for (let i = 0; i < 8; i++) tracker.recordSuccess(50);
    for (let i = 0; i < 2; i++) tracker.recordFailure(100);

    const snap = tracker.snapshot();
    expect(snap.totalAttempts).toBe(10);
    expect(snap.totalFailures).toBe(2);
    expect(snap.errorRate).toBeCloseTo(0.2);
    expect(snap.status).toBe('healthy'); // < 0.3
  });

  it('reports degraded at 30%+ error rate', () => {
    const tracker = new HealthTracker();
    for (let i = 0; i < 7; i++) tracker.recordSuccess(50);
    for (let i = 0; i < 3; i++) tracker.recordFailure(100);

    expect(tracker.snapshot().status).toBe('degraded');
  });

  it('reports unhealthy at 80%+ error rate', () => {
    const tracker = new HealthTracker();
    for (let i = 0; i < 2; i++) tracker.recordSuccess(50);
    for (let i = 0; i < 8; i++) tracker.recordFailure(100);

    expect(tracker.snapshot().status).toBe('unhealthy');
  });

  it('calculates p95 latency', () => {
    const tracker = new HealthTracker();
    // 10 entries: 9 at 50ms, 1 at 500ms
    for (let i = 0; i < 9; i++) tracker.recordSuccess(50);
    tracker.recordSuccess(500);

    const snap = tracker.snapshot();
    // ceil(10 * 0.95) - 1 = 9 → index 9 = 500ms
    expect(snap.p95LatencyMs).toBe(500);
  });

  it('prunes entries outside the window', () => {
    vi.useFakeTimers();
    const tracker = new HealthTracker(1000); // 1 second window

    tracker.recordSuccess(50);
    tracker.recordFailure(50);
    expect(tracker.snapshot().totalAttempts).toBe(2);

    vi.advanceTimersByTime(1100);
    expect(tracker.snapshot().totalAttempts).toBe(0);

    vi.useRealTimers();
  });
});

/* ------------------------------------------------------------------ */
/*  ProviderRegistry Unit Tests                                        */
/* ------------------------------------------------------------------ */

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;
  let events: ProviderHealthEvent[];

  beforeEach(() => {
    registry = new ProviderRegistry();
    events = [];
    registry.onHealthEvent = (e) => events.push(e);
  });

  afterEach(() => {
    registry.clearForTest();
  });

  it('registers a provider in normal mode', () => {
    registry.register('telnyx');
    expect(registry.getMode('telnyx')).toBe('normal');
    expect(registry.isAvailable('telnyx')).toBe(true);
  });

  it('returns null for unregistered provider', () => {
    expect(registry.getMode('unknown')).toBeNull();
    expect(registry.getProvider('unknown')).toBeNull();
    expect(registry.isAvailable('unknown')).toBe(false);
  });

  it('tracks health via recordSuccess/recordFailure', () => {
    registry.register('clay');
    registry.recordSuccess('clay', 50);
    registry.recordSuccess('clay', 60);
    registry.recordFailure('clay', 100);

    const provider = registry.getProvider('clay')!;
    expect(provider.health.totalAttempts).toBe(3);
    expect(provider.health.totalFailures).toBe(1);
  });

  it('auto-triggers kill switch at >= 80% failure rate with >= 50 attempts', () => {
    registry.register('telnyx');

    // 10 successes + 40 failures = 50 attempts, 80% error rate
    for (let i = 0; i < 10; i++) registry.recordSuccess('telnyx', 50);
    for (let i = 0; i < 40; i++) registry.recordFailure('telnyx', 100);

    expect(registry.getMode('telnyx')).toBe('kill_switched');
    expect(registry.isAvailable('telnyx')).toBe(false);

    // Should have emitted transition events
    const killEvent = events.find((e) => e.newMode === 'kill_switched');
    expect(killEvent).toBeDefined();
    expect(killEvent!.provider).toBe('telnyx');
    expect(killEvent!.reason).toContain('Auto kill-switch');
  });

  it('does NOT auto-trigger kill switch below 50 attempts', () => {
    registry.register('telnyx');

    // 49 failures, 0 successes = 100% error rate but only 49 attempts
    for (let i = 0; i < 49; i++) registry.recordFailure('telnyx', 100);

    // Should be degraded but NOT kill_switched (not enough attempts)
    expect(registry.getMode('telnyx')).toBe('degraded');
  });

  it('auto-degrades at >= 30% error rate with >= 10 attempts', () => {
    registry.register('clay');

    for (let i = 0; i < 7; i++) registry.recordSuccess('clay', 50);
    for (let i = 0; i < 3; i++) registry.recordFailure('clay', 100);

    expect(registry.getMode('clay')).toBe('degraded');
    const degradeEvent = events.find((e) => e.newMode === 'degraded');
    expect(degradeEvent).toBeDefined();
  });

  it('prevents auto-failback — requires manual setMode', () => {
    registry.register('telnyx');

    // Trigger kill switch
    for (let i = 0; i < 10; i++) registry.recordSuccess('telnyx', 50);
    for (let i = 0; i < 40; i++) registry.recordFailure('telnyx', 100);
    expect(registry.getMode('telnyx')).toBe('kill_switched');

    // Even with successes, stays kill_switched
    for (let i = 0; i < 100; i++) registry.recordSuccess('telnyx', 50);
    expect(registry.getMode('telnyx')).toBe('kill_switched');

    // Manual failback
    registry.setMode('telnyx', 'normal', 'Manual recovery approved by ops');
    expect(registry.getMode('telnyx')).toBe('normal');
    expect(registry.isAvailable('telnyx')).toBe(true);

    const failbackEvent = events.find(
      (e) => e.previousMode === 'kill_switched' && e.newMode === 'normal',
    );
    expect(failbackEvent).toBeDefined();
    expect(failbackEvent!.reason).toContain('Manual recovery');
  });

  it('mode transitions emit structured events', () => {
    registry.register('anthropic');
    registry.setMode('anthropic', 'degraded', 'Rate limit approaching');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'anthropic',
      previousMode: 'normal',
      newMode: 'degraded',
      reason: 'Rate limit approaching',
    });
    expect(events[0].occurredAtIso).toBeTruthy();
  });

  it('lists all registered providers', () => {
    registry.register('telnyx');
    registry.register('clay');
    registry.register('anthropic');

    const list = registry.listProviders();
    expect(list).toHaveLength(3);
    expect(list.map((p) => p.name).sort()).toEqual(['anthropic', 'clay', 'telnyx']);
  });

  it('tracks concurrent providers independently', () => {
    registry.register('telnyx');
    registry.register('clay');

    // Make clay unhealthy, telnyx healthy
    for (let i = 0; i < 10; i++) registry.recordSuccess('telnyx', 50);
    for (let i = 0; i < 7; i++) registry.recordSuccess('clay', 50);
    for (let i = 0; i < 3; i++) registry.recordFailure('clay', 100);

    expect(registry.getMode('telnyx')).toBe('normal');
    expect(registry.getMode('clay')).toBe('degraded');
  });

  it('wires health hooks into BaseProviderClient', () => {
    registry.register('test-provider');
    const client = new BaseProviderClient({
      name: 'test-provider',
      baseUrl: 'https://api.example.com',
      auth: new BearerTokenAuth('token'),
    });
    registry.wireClient('test-provider', client);

    // Simulate calling the hooks directly
    client.onSuccess(50);
    client.onFailure(100, 'transient');

    const provider = registry.getProvider('test-provider')!;
    expect(provider.health.totalAttempts).toBe(2);
    expect(provider.health.totalFailures).toBe(1);
  });

  it('setMode rejects invalid mode string', () => {
    registry.register('clay');
    expect(() => registry.setMode('clay', 'off' as never, 'typo')).toThrow(/invalid mode/);
  });

  it('setMode rejects empty reason', () => {
    registry.register('clay');
    expect(() => registry.setMode('clay', 'degraded', '')).toThrow(/reason is required/);
  });

  it('auth_failure does NOT count toward kill-switch threshold', () => {
    registry.register('anthropic');
    // 60 auth failures — should NOT trip kill-switch because auth failures
    // indicate a credential problem, not a provider outage
    for (let i = 0; i < 60; i++) {
      registry.recordFailure('anthropic', 50, 'auth_failure');
    }
    expect(registry.getMode('anthropic')).toBe('normal');
  });

  it('auth_failure does NOT auto-degrade', () => {
    registry.register('anthropic');
    // 20 auth failures — enough to cross degrade threshold on total count,
    // but auth failures are excluded from the error-rate math
    for (let i = 0; i < 20; i++) {
      registry.recordFailure('anthropic', 50, 'auth_failure');
    }
    expect(registry.getMode('anthropic')).toBe('normal');
  });

  it('mixed auth + transient failures: only transient drives kill-switch', () => {
    registry.register('anthropic');
    // 30 auth + 10 success + 40 transient = 80 attempts
    // non-auth = 50 attempts, 40 failures / 50 = 80% → kill switch
    for (let i = 0; i < 30; i++) registry.recordFailure('anthropic', 50, 'auth_failure');
    for (let i = 0; i < 10; i++) registry.recordSuccess('anthropic', 50);
    for (let i = 0; i < 40; i++) registry.recordFailure('anthropic', 50, 'transient');

    expect(registry.getMode('anthropic')).toBe('kill_switched');
  });

  it('degraded provider auto-recovers to normal when error rate falls below 10%', () => {
    registry.register('clay');

    // Drive to degraded: 7 success + 3 failures = 30% error rate
    for (let i = 0; i < 7; i++) registry.recordSuccess('clay', 50);
    for (let i = 0; i < 3; i++) registry.recordFailure('clay', 50, 'transient');
    expect(registry.getMode('clay')).toBe('degraded');

    // Recovery: add 100 successes — error rate drops to ~3%
    for (let i = 0; i < 100; i++) registry.recordSuccess('clay', 50);

    expect(registry.getMode('clay')).toBe('normal');
    const recoverEvent = events.find((e) => e.previousMode === 'degraded' && e.newMode === 'normal');
    expect(recoverEvent).toBeDefined();
    expect(recoverEvent!.reason).toContain('Auto recovered');
  });

  it('kill-switched provider does NOT auto-recover even when fully healthy', () => {
    registry.register('telnyx');

    // Kill-switch
    for (let i = 0; i < 10; i++) registry.recordSuccess('telnyx', 50);
    for (let i = 0; i < 40; i++) registry.recordFailure('telnyx', 50, 'transient');
    expect(registry.getMode('telnyx')).toBe('kill_switched');

    // Long recovery period with all successes
    for (let i = 0; i < 200; i++) registry.recordSuccess('telnyx', 50);

    expect(registry.getMode('telnyx')).toBe('kill_switched');
  });
});

/* ------------------------------------------------------------------ */
/*  PostgresHealthEventStore                                           */
/* ------------------------------------------------------------------ */

describe('PostgresHealthEventStore', () => {
  it('maps ProviderHealthEvent to the expected DB row shape', async () => {
    const rows: unknown[] = [];
    const store = new PostgresHealthEventStore(async (row) => { rows.push(row); });
    const result = await store.persist({
      provider: 'telnyx',
      previousMode: 'normal',
      newMode: 'kill_switched',
      reason: 'Auto kill-switch',
      errorRate: 0.85,
      attemptCount: 52,
      occurredAtIso: '2026-04-16T12:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      provider: 'telnyx',
      previous_mode: 'normal',
      new_mode: 'kill_switched',
      reason: 'Auto kill-switch',
      error_rate: 0.85,
      attempt_count: 52,
      occurred_at: '2026-04-16T12:00:00.000Z',
    });
  });

  it('does not throw when insert fails — returns error result', async () => {
    const store = new PostgresHealthEventStore(async () => { throw new Error('db down'); });
    const result = await store.persist({
      provider: 'x',
      previousMode: 'normal',
      newMode: 'degraded',
      reason: 'r',
      errorRate: 0.5,
      attemptCount: 20,
      occurredAtIso: new Date().toISOString(),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('db down');
  });
});
