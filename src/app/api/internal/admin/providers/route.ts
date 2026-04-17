/**
 * Admin Providers API — Story 1.12c AC 1 bullet 4.
 *
 * Exposes the in-memory ProviderRegistry state so the admin dashboard can
 * render a live view of every registered provider (mode + health snapshot).
 *
 * The endpoint is read-only and server-side only — requires the session to
 * pass `admin:view-providers` authorization. The data is ephemeral (in-
 * memory rolling 5-minute window), so a refresh from the client simply
 * re-reads the registry on demand.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/modules/auth';
import {
  ensureProvidersInitialized,
  getProviderRegistry,
} from '@/modules/providers';
import type { RegisteredProvider } from '@/modules/providers';

export type ProviderHealthSummary = {
  name: string;
  mode: RegisteredProvider['mode'];
  status: RegisteredProvider['health']['status'];
  errorRate: number;
  p95LatencyMs: number;
  totalAttempts: number;
  totalFailures: number;
  registeredAtIso: string;
};

export const GET = withAuth(async () => {
  try {
    // Idempotent — safe to call on every request. Ensures the registry has
    // providers + health wiring even on a cold route.
    await ensureProvidersInitialized();
  } catch (err) {
    // Initialization failure must NOT block the dashboard from seeing the
    // partially-initialized state — `getProviderRegistry()` below still
    // returns whatever was registered before the failure.
    console.warn(
      '[admin/providers] ensureProvidersInitialized failed; returning partial registry:',
      err instanceof Error ? err.message : String(err),
    );
  }

  const registry = getProviderRegistry();
  const data: ProviderHealthSummary[] = registry.listProviders().map((p) => ({
    name: p.name,
    mode: p.mode,
    status: p.health.status,
    errorRate: p.health.errorRate,
    p95LatencyMs: p.health.p95LatencyMs,
    totalAttempts: p.health.totalAttempts,
    totalFailures: p.health.totalFailures,
    registeredAtIso: p.registeredAtIso,
  }));

  return NextResponse.json({ data });
}, { action: 'admin:view-providers' });
