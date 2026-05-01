/**
 * Supabase startup-wiring integration test — Story 1.12c.
 *
 * Proves that `ensureProvidersInitialized()` (without `skipDb`) runs the
 * Supabase health-provider wiring end-to-end:
 *   - `supabase` registers in `ProviderRegistry` (AC 1, AC 4)
 *   - The shared `SupabaseHealthProvider` singleton is populated
 *   - The injected ping function calls through the Supabase client to the
 *     real health-event table (AC 1 bullet 1)
 *   - Coexists with existing 1-12a/1-12b wiring — all 5 providers visible
 *     when env is fully configured (AC 4)
 *
 * Uses `vi.mock('@/modules/persistence', ...)` so the Supabase client never
 * makes a real network call. Mock lives in this file only so
 * `providers-startup.test.ts` keeps its `skipDb: true` shape untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ThenableQuery = Promise<{ data: unknown; error: { message: string } | null }> & {
  select: (...args: unknown[]) => ThenableQuery;
  limit: (n: number) => ThenableQuery;
};

const fromCalls: string[] = [];
let nextPingError: string | null = null;

function makeFakeSupabaseClient() {
  return {
    from: (table: string) => {
      fromCalls.push(table);
      if (table === 'provider_routing_policies') {
        return {
          select: async () => ({ data: [], error: null }),
        };
      }
      if (table === 'provider_health_events') {
        // Used by both PostgresHealthEventStore.insert and our ping `select`.
        const thenable = {
          select: () => thenable,
          limit: () => thenable,
          insert: async () => ({ data: null, error: null }),
          then: (resolve: (v: { data: unknown; error: { message: string } | null }) => unknown) =>
            resolve(
              nextPingError
                ? { data: null, error: { message: nextPingError } }
                : { data: [], error: null },
            ),
        } as unknown as ThenableQuery;
        return thenable;
      }
      return {
        select: async () => ({ data: [], error: null }),
        insert: async () => ({ data: null, error: null }),
      };
    },
  };
}

const persistenceMocks = vi.hoisted(() => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseAdminClient: vi.fn(),
  // Stubs so the data-residency guard inside persistence doesn't fire on
  // test env. The real `getSupabaseAdminClient` calls it before building the
  // client; our mocked client bypasses the whole path.
  assertSupabasePersistenceConfigured: vi.fn(),
  shouldUseInMemoryPersistenceForTests: vi.fn(() => false),
}));
vi.mock('@/modules/persistence', () => persistenceMocks);

// Imported *after* vi.mock so startup.ts resolves to the mocked module.
import { ProviderRegistry } from '@/modules/providers/registry';
import {
  ensureProvidersInitialized,
  resetProvidersForTest,
} from '@/modules/providers/startup';
import { getSharedSupabaseHealthProvider } from '@/modules/providers/supabase';
import { resetSharedCeipalClientForTest } from '@/modules/providers/ceipal';
import { resetSharedGraphClientForTest } from '@/modules/providers/graph';
import { resetLLMProviderForTest, clearClientForTest } from '@/modules/ai';

describe('ensureProvidersInitialized — Supabase wiring (Story 1.12c)', () => {
  beforeEach(() => {
    resetProvidersForTest();
    resetSharedCeipalClientForTest();
    resetSharedGraphClientForTest();
    resetLLMProviderForTest();
    clearClientForTest();
    fromCalls.length = 0;
    nextPingError = null;
    persistenceMocks.isSupabaseConfigured.mockReturnValue(true);
    persistenceMocks.getSupabaseAdminClient.mockImplementation(() =>
      makeFakeSupabaseClient() as unknown as ReturnType<
        typeof persistenceMocks.getSupabaseAdminClient
      >,
    );

    delete process.env.CLAY_API_KEY;
    delete process.env.CEIPAL_API_KEY;
    delete process.env.CBL_SSO_CLIENT_ID;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    const provider = getSharedSupabaseHealthProvider();
    provider?.stop();
    resetProvidersForTest();
    resetSharedCeipalClientForTest();
    resetSharedGraphClientForTest();
    resetLLMProviderForTest();
    clearClientForTest();
    vi.restoreAllMocks();
  });

  it('registers supabase + instantiates the shared SupabaseHealthProvider', async () => {
    const registry = new ProviderRegistry();
    await ensureProvidersInitialized({ registry });

    const names = registry.listProviders().map((p) => p.name);
    expect(names).toContain('supabase');
    expect(registry.getMode('supabase')).toBe('normal');
    expect(getSharedSupabaseHealthProvider()).not.toBeNull();
  });

  it('ping function reaches the Supabase client (connectivity probe)', async () => {
    const registry = new ProviderRegistry();
    await ensureProvidersInitialized({ registry });

    const provider = getSharedSupabaseHealthProvider();
    expect(provider).not.toBeNull();

    await provider!.ping();
    // The ping should have hit `provider_health_events` for its lightweight
    // head-count probe (other `from` calls come from routing-policy restore
    // + health-event-store init).
    expect(fromCalls).toContain('provider_health_events');

    const snap = registry.getProvider('supabase');
    expect(snap?.health.totalAttempts).toBeGreaterThanOrEqual(1);
  });

  it('surfaces ping failures to the registry when the DB returns an error', async () => {
    const registry = new ProviderRegistry();
    await ensureProvidersInitialized({ registry });

    const provider = getSharedSupabaseHealthProvider();
    nextPingError = 'connection refused';
    await provider!.ping();

    const snap = registry.getProvider('supabase');
    expect(snap?.health.totalFailures).toBeGreaterThanOrEqual(1);
  });

  it('all 7 providers visible when every env var is configured (AC 4)', async () => {
    process.env.CLAY_API_KEY = 'k';
    process.env.CEIPAL_API_KEY = 'c';
    process.env.CEIPAL_USERNAME = 'u';
    process.env.CEIPAL_PASSWORD = 'p';
    process.env.CEIPAL_ENDPOINT_KEY = 'ep';
    process.env.CBL_SSO_ALLOWED_TENANT_ID = 't';
    process.env.CBL_SSO_CLIENT_ID = 'ci';
    process.env.CBL_SSO_CLIENT_SECRET = 's';
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    const registry = new ProviderRegistry();
    await ensureProvidersInitialized({ registry });

    const names = registry.listProviders().map((p) => p.name).sort();
    // clay (inbound) + clay-outbound + ceipal + graph + anthropic + supabase + sms-stub (Story 3.1)
    expect(names).toContain('clay');
    expect(names).toContain('clay-outbound');
    expect(names).toContain('ceipal');
    expect(names).toContain('graph');
    expect(names).toContain('anthropic');
    expect(names).toContain('supabase');
    expect(names).toContain('sms-stub');
    expect(names).toHaveLength(7);
  });

  it('resetProvidersForTest stops the health ping interval', async () => {
    const registry = new ProviderRegistry();
    await ensureProvidersInitialized({ registry });

    expect(getSharedSupabaseHealthProvider()).not.toBeNull();
    resetProvidersForTest();
    expect(getSharedSupabaseHealthProvider()).toBeNull();
  });

  it('simulated outage: DB fails → degraded → admin alert fires → recovers (Task 3.4)', async () => {
    const registry = new ProviderRegistry();
    const transitions: Array<{ previousMode: string; newMode: string }> = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await ensureProvidersInitialized({ registry });
    const startupOnHealthEvent = registry.onHealthEvent;
    registry.onHealthEvent = (event) => {
      transitions.push({ previousMode: event.previousMode, newMode: event.newMode });
      startupOnHealthEvent(event);
    };

    const provider = getSharedSupabaseHealthProvider();
    expect(provider).not.toBeNull();

    // Simulate outage: two consecutive failures cross the threshold.
    nextPingError = 'connection refused';
    await provider!.ping();
    await provider!.ping();
    expect(registry.getMode('supabase')).toBe('degraded');
    expect(
      transitions.some((t) => t.previousMode === 'normal' && t.newMode === 'degraded'),
    ).toBe(true);

    // Critical-log alert verification: admin-alert sink emits `level:"critical"`
    // structured JSON on every alert-worthy transition (review finding A4/P9).
    const criticalLogCalls = errSpy.mock.calls.filter((args) => {
      const first = args[0];
      return typeof first === 'string' && first.includes('"level":"critical"') && first.includes('"provider":"supabase"');
    });
    expect(criticalLogCalls.length).toBeGreaterThanOrEqual(1);

    // Simulate recovery.
    nextPingError = null;
    await provider!.ping();
    expect(registry.getMode('supabase')).toBe('normal');
    expect(
      transitions.some((t) => t.previousMode === 'degraded' && t.newMode === 'normal'),
    ).toBe(true);

    errSpy.mockRestore();
  });
});
