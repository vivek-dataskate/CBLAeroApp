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
import type { BaseProviderClient } from './base-client';
import type { ProviderLogEntry } from './types';
import { isSupabaseConfigured, getSupabaseAdminClient } from '@/modules/persistence';

/** The one `ProviderRegistry` the entire app uses. */
let sharedRegistry: ProviderRegistry | null = null;

/**
 * Exposed so callers and tests can get the registry without triggering
 * initialization. Returns a freshly created registry the first time it's
 * called; `ensureProvidersInitialized()` layers registration on top.
 *
 * ⚠️ Review patch L-7: this bypasses init. Any PRODUCTION consumer must
 * `await ensureProvidersInitialized()` before calling this — otherwise the
 * registry has no providers registered, no health-event store wired, and no
 * kill-switch mode restored. Tests may call this directly with an injected
 * `resetProvidersForTest()` sequence.
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

/**
 * Review patch H-3: split initialization so transient Supabase failures do
 * not permanently block DB wiring. Provider registration always succeeds
 * (pure in-memory) — the first call does it once. DB wiring (health event
 * store + routing-policy restore) is retried on every call until one
 * succeeds. Once DB wiring is live, subsequent calls fast-path to the
 * existing promise.
 */
let dbWiringComplete = false;

export function resetProvidersForTest(): void {
  sharedRegistry = null;
  initializationPromise = null;
  dbWiringComplete = false;
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
    attachProviderLogSink(clayClient.base);
  }

  // 1c. Ceipal outbound (registered only when credentials are set).
  const ceipalClient = buildCeipalProviderClientFromEnv() as
    | CeipalProviderClient<CeipalApplicant>
    | null;
  if (ceipalClient) {
    safeRegister(registry, 'ceipal');
    registry.wireClient('ceipal', ceipalClient.base);
    attachProviderLogSink(ceipalClient.base);
    // Share the singleton so `fetchCeipalApplicants()` uses the registered
    // instance rather than building a second one on first call.
    setSharedCeipalClient(ceipalClient);
  }

  if (options?.skipDb || !isSupabaseConfigured() || dbWiringComplete) return;

  // ── 2. Wire PostgresHealthEventStore ──
  // Review patch H-3: a failure here used to resolve the initialization
  // promise silently, permanently skipping DB wiring for the process
  // lifetime. Now we THROW — the caller's .catch in ensureProvidersInitialized
  // clears `initializationPromise` so the NEXT caller retries. Provider
  // registration (above) is in-memory and idempotent, so the retry is cheap.
  let supabase: ReturnType<typeof getSupabaseAdminClient>;
  try {
    supabase = getSupabaseAdminClient();
  } catch (err) {
    throw new Error(
      `[providers/startup] Could not acquire Supabase admin client — will retry on next caller: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
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
  const { data, error } = await supabase
    .from('provider_routing_policies')
    .select('primary_provider, mode, reason');
  if (error) {
    throw new Error(
      `[providers/startup] Could not load routing policies — will retry on next caller: ${error.message}`,
    );
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

  dbWiringComplete = true;
}

/** Register without clobbering an already-registered provider. */
function safeRegister(registry: ProviderRegistry, name: string): void {
  if (registry.getProvider(name)) return;
  registry.register(name);
}

/**
 * Sentinel marker placed on the client so we can detect whether a caller has
 * already set a custom `onLog` (review patch M-11). Startup should NEVER
 * overwrite a constructor-provided sink.
 */
const LOG_SINK_SENTINEL = Symbol.for('cblaero.provider.defaultLogSink');

/**
 * Review patch (F11 / AC 6 #6): `BaseProviderClient.onLog` defaults to a
 * no-op. AC 6 #6 explicitly requires each outbound call emits a
 * `ProviderLogEntry` JSON line that downstream log aggregators can parse.
 * Attach a default stdout JSON sink at startup so the structured stream is
 * live in production.
 *
 * Review patch M-11: guard against overwriting a caller-provided `onLog`.
 * We tag our default sink with `LOG_SINK_SENTINEL`; if the current `onLog`
 * is not the default and not our tagged sink, leave it alone.
 */
function attachProviderLogSink(base: BaseProviderClient): void {
  type TaggedSink = ((entry: ProviderLogEntry) => void) & { [LOG_SINK_SENTINEL]?: true };
  const current = base.onLog as TaggedSink | undefined;
  // Default `onLog` in BaseProviderClient is an empty arrow function — its
  // `.length` is 0 and body is empty. Detect "never overridden" by checking
  // for our sentinel OR the empty-body default.
  const isDefault = !current || current.toString().replace(/\s/g, '') === '()=>{}';
  const isOurs = current?.[LOG_SINK_SENTINEL] === true;
  if (!isDefault && !isOurs) return;

  const sink: TaggedSink = (entry: ProviderLogEntry) => {
    try {
      console.log(JSON.stringify({ kind: 'provider_log', ...entry }));
    } catch {
      // Non-fatal: circular reference in a custom cost metric should never
      // block outbound traffic. Swallow and move on.
    }
  };
  sink[LOG_SINK_SENTINEL] = true;
  base.onLog = sink;
}
