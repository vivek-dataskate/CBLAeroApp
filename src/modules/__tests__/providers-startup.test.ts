/**
 * Provider startup wiring tests — Story 1-12a Task 4 / AC 4
 *
 * `ensureProvidersInitialized()` must:
 *   1. Register the three story-1-12a providers (when env is configured).
 *   2. Be idempotent — concurrent callers share a promise, subsequent calls
 *      no-op.
 *   3. Wire `PostgresHealthEventStore` so every mode transition audits.
 *   4. Restore `mode` from `provider_routing_policies` on first run.
 *   5. Never throw for observability failures — `skipDb=true` is the test
 *      mode that bypasses Supabase entirely.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderRegistry } from '@/modules/providers/registry';
import {
  ensureProvidersInitialized,
  resetProvidersForTest,
} from '@/modules/providers/startup';
import { resetSharedCeipalClientForTest } from '@/modules/providers/ceipal';

describe('ensureProvidersInitialized', () => {
  beforeEach(() => {
    resetProvidersForTest();
    resetSharedCeipalClientForTest();
    // Clear env vars so each test asserts a deterministic starting state.
    delete process.env.CLAY_API_KEY;
    delete process.env.CLAY_API_BASE_URL;
    delete process.env.CEIPAL_API_KEY;
    delete process.env.CEIPAL_USERNAME;
    delete process.env.CEIPAL_PASSWORD;
    delete process.env.CEIPAL_ENDPOINT_KEY;
  });

  afterEach(() => {
    resetProvidersForTest();
    resetSharedCeipalClientForTest();
    vi.restoreAllMocks();
  });

  it('registers only clay (inbound) when no env vars are set', async () => {
    const registry = new ProviderRegistry();
    await ensureProvidersInitialized({ registry, skipDb: true });

    const names = registry.listProviders().map((p) => p.name).sort();
    expect(names).toEqual(['clay']);
  });

  it('registers clay + clay-outbound when CLAY_API_KEY is set', async () => {
    process.env.CLAY_API_KEY = 'k';
    const registry = new ProviderRegistry();
    await ensureProvidersInitialized({ registry, skipDb: true });

    const names = registry.listProviders().map((p) => p.name).sort();
    expect(names).toEqual(['clay', 'clay-outbound']);
  });

  it('registers ceipal + clay providers when all env vars are set', async () => {
    process.env.CLAY_API_KEY = 'k';
    process.env.CEIPAL_API_KEY = 'c';
    process.env.CEIPAL_USERNAME = 'u';
    process.env.CEIPAL_PASSWORD = 'p';
    process.env.CEIPAL_ENDPOINT_KEY = 'ep';

    const registry = new ProviderRegistry();
    await ensureProvidersInitialized({ registry, skipDb: true });

    const names = registry.listProviders().map((p) => p.name).sort();
    expect(names).toEqual(['ceipal', 'clay', 'clay-outbound']);
    expect(registry.getMode('ceipal')).toBe('normal');
    expect(registry.getMode('clay')).toBe('normal');
    expect(registry.getMode('clay-outbound')).toBe('normal');
  });

  it('is idempotent — concurrent callers share a promise, second call no-ops', async () => {
    const registry = new ProviderRegistry();
    const spy = vi.spyOn(registry, 'register');
    await Promise.all([
      ensureProvidersInitialized({ registry, skipDb: true }),
      ensureProvidersInitialized({ registry, skipDb: true }),
    ]);
    await ensureProvidersInitialized({ registry, skipDb: true });

    // `clay` is registered exactly once — all other subsequent calls no-op.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('clay');
  });
});
