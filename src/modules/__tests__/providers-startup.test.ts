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
import { resetSharedGraphClientForTest } from '@/modules/providers/graph';
import {
  resetLLMProviderForTest,
  setLLMProvider,
  getLLMProvider,
  clearClientForTest,
} from '@/modules/ai';
import type { LLMProvider } from '@/modules/ai';

describe('ensureProvidersInitialized', () => {
  beforeEach(() => {
    resetProvidersForTest();
    resetSharedCeipalClientForTest();
    resetSharedGraphClientForTest();
    resetLLMProviderForTest();
    clearClientForTest();
    // Clear env vars so each test asserts a deterministic starting state.
    delete process.env.CLAY_API_KEY;
    delete process.env.CLAY_API_BASE_URL;
    delete process.env.CEIPAL_API_KEY;
    delete process.env.CEIPAL_USERNAME;
    delete process.env.CEIPAL_PASSWORD;
    delete process.env.CEIPAL_ENDPOINT_KEY;
    // Story 1.12b additions: Graph + Anthropic env.
    delete process.env.CBL_SSO_ALLOWED_TENANT_ID;
    delete process.env.CBL_SSO_CLIENT_ID;
    delete process.env.CBL_SSO_CLIENT_SECRET;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    resetProvidersForTest();
    resetSharedCeipalClientForTest();
    resetSharedGraphClientForTest();
    resetLLMProviderForTest();
    clearClientForTest();
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

  it('registers graph provider when Entra SSO env is configured (Story 1.12b)', async () => {
    process.env.CBL_SSO_ALLOWED_TENANT_ID = 't';
    process.env.CBL_SSO_CLIENT_ID = 'c';
    process.env.CBL_SSO_CLIENT_SECRET = 's';

    const registry = new ProviderRegistry();
    await ensureProvidersInitialized({ registry, skipDb: true });

    const names = registry.listProviders().map((p) => p.name).sort();
    expect(names).toContain('graph');
    expect(registry.getMode('graph')).toBe('normal');
  });

  it('registers anthropic provider when ANTHROPIC_API_KEY is set (Story 1.12b)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    const registry = new ProviderRegistry();
    await ensureProvidersInitialized({ registry, skipDb: true });

    const names = registry.listProviders().map((p) => p.name).sort();
    expect(names).toContain('anthropic');
    expect(registry.getMode('anthropic')).toBe('normal');
  });

  it('preserves a test-injected LLMProvider mock across ensureProvidersInitialized (review patch 7)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const mock: LLMProvider = {
      name: 'test-mock',
      call: vi.fn().mockResolvedValue(null),
    };
    setLLMProvider(mock);

    const registry = new ProviderRegistry();
    await ensureProvidersInitialized({ registry, skipDb: true });

    // Startup used `initializeLLMProviderFromStartup` which is a no-op when a
    // provider was already injected — mock wins.
    expect(getLLMProvider()).toBe(mock);
  });
});
