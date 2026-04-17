/**
 * Provider framework startup wiring — Story 1-12a Task 4
 *
 * Single idempotent `ensureProvidersInitialized()` entry point that:
 *   1. Builds (or returns the existing) process-wide `ProviderRegistry`.
 *   2. Registers `clay` (inbound), `clay-outbound`, and `ceipal` with their
 *      respective clients (when env vars are configured).
 *   3. Wires `PostgresHealthEventStore` to persist every mode transition
 *      to `cblaero_app.provider_health_events`. Persist failures log to
 *      stderr but never throw — observability must not block ingestion.
 *   4. Restores `mode` from `provider_routing_policies` so kill-switch
 *      state survives restarts (per architecture.md §19). The in-memory
 *      health tracker is intentionally NOT hydrated — counters start fresh
 *      on each process.
 *
 * Call sites:
 *   - `/api/webhooks/clay` (top of POST handler, before `receiver.receive()`)
 *   - `CeipalIngestionJob.run()` (before the first fetch)
 *
 * Idempotency: multiple concurrent callers coalesce on a shared promise.
 */
import { ProviderRegistry } from './registry';
import { PostgresHealthEventStore } from './health-event-store';
import type { HealthEventRow } from './health-event-store';
import { buildClayProviderClientFromEnv } from './clay/clay-client';
import {
  buildCeipalProviderClientFromEnv,
  setSharedCeipalClient,
} from './ceipal';
import type { CeipalProviderClient } from './ceipal/ceipal-client';
import type { CeipalApplicant } from '@/modules/ats/ceipal-types';
import { isSupabaseConfigured, getSupabaseAdminClient } from '@/modules/persistence';

/** The one `ProviderRegistry` the entire app uses. */
let sharedRegistry: ProviderRegistry | null = null;

/**
 * Exposed so callers and tests can get the registry without triggering
 * initialization. Returns a freshly created registry the first time it's
 * called; `ensureProvidersInitialized()` layers registration on top.
 */
export function getProviderRegistry(): ProviderRegistry {
  if (!sharedRegistry) sharedRegistry = new ProviderRegistry();
  return sharedRegistry;
}

let initializationPromise: Promise<void> | null = null;

export interface EnsureProvidersInitializedOptions {
  /** Inject a pre-built registry — primarily for tests. */
  registry?: ProviderRegistry;
  /** Opt out of DB-backed startup (tests, CI without Supabase). */
  skipDb?: boolean;
}

/**
 * Lazy, idempotent startup. Safe to call from every route entry point —
 * only the first concurrent caller does work; the rest await the shared
 * promise.
 */
export function ensureProvidersInitialized(
  options?: EnsureProvidersInitializedOptions,
): Promise<void> {
  if (initializationPromise) return initializationPromise;

  initializationPromise = initializeImpl(options).catch((err) => {
    // If initialization fails, clear the promise so the next caller can retry.
    initializationPromise = null;
    throw err;
  });
  return initializationPromise;
}

export function resetProvidersForTest(): void {
  sharedRegistry = null;
  initializationPromise = null;
}

async function initializeImpl(
  options?: EnsureProvidersInitializedOptions,
): Promise<void> {
  const registry = options?.registry ?? getProviderRegistry();
  sharedRegistry = registry;

  // ── 1. Register providers + wire clients ──
  // 1a. Clay inbound (always registered; no client attached — the webhook
  //     receiver path tracks health indirectly via success/failure tallies
  //     written by the webhook processor in a future story).
  safeRegister(registry, 'clay');

  // 1b. Clay outbound (registered only when CLAY_API_KEY is set).
  const clayClient = buildClayProviderClientFromEnv();
  if (clayClient) {
    safeRegister(registry, 'clay-outbound');
    registry.wireClient('clay-outbound', clayClient.base);
  }

  // 1c. Ceipal outbound (registered only when credentials are set).
  const ceipalClient = buildCeipalProviderClientFromEnv() as
    | CeipalProviderClient<CeipalApplicant>
    | null;
  if (ceipalClient) {
    safeRegister(registry, 'ceipal');
    registry.wireClient('ceipal', ceipalClient.base);
    // Share the singleton so `fetchCeipalApplicants()` uses the registered
    // instance rather than building a second one on first call.
    setSharedCeipalClient(ceipalClient);
  }

  if (options?.skipDb || !isSupabaseConfigured()) return;

  // ── 2. Wire PostgresHealthEventStore ──
  let supabase: ReturnType<typeof getSupabaseAdminClient>;
  try {
    supabase = getSupabaseAdminClient();
  } catch (err) {
    console.error(
      '[providers/startup] Could not acquire Supabase admin client, skipping health-event persistence:',
      err instanceof Error ? err.message : err,
    );
    return;
  }

  const store = new PostgresHealthEventStore(async (row: HealthEventRow) => {
    const { error } = await supabase.from('provider_health_events').insert(row);
    if (error) throw new Error(error.message);
  });
  registry.onHealthEvent = (event) => {
    void store.persist(event).then((r) => {
      if (!r.ok) {
        console.error('[health-event-store] persist failed', r.error, {
          provider: event.provider,
          previousMode: event.previousMode,
          newMode: event.newMode,
        });
      }
    });
  };

  // ── 3. Restore mode from provider_routing_policies ──
  try {
    const { data, error } = await supabase
      .from('provider_routing_policies')
      .select('primary_provider, mode, reason');
    if (error) {
      console.error('[providers/startup] Could not load routing policies:', error.message);
      return;
    }
    type PolicyRow = { primary_provider: string; mode: string; reason: string | null };
    for (const row of (data as PolicyRow[] | null) ?? []) {
      if (row.mode === 'normal') continue; // skip no-op restores
      const mode = row.mode as 'degraded' | 'kill_switched' | 'normal';
      if (mode !== 'degraded' && mode !== 'kill_switched') continue;
      // setMode requires a registered provider; skip silently when the env
      // vars for a provider aren't configured in this environment.
      if (!registry.getProvider(row.primary_provider)) continue;
      registry.setMode(row.primary_provider, mode, row.reason ?? 'Restored from routing policies');
    }
  } catch (err) {
    console.error(
      '[providers/startup] Mode restoration failed (non-fatal):',
      err instanceof Error ? err.message : err,
    );
  }
}

/** Register without clobbering an already-registered provider. */
function safeRegister(registry: ProviderRegistry, name: string): void {
  if (registry.getProvider(name)) return;
  registry.register(name);
}
