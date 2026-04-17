/**
 * Ceipal audit integration test — Story 1-12a AC 6, item 16.
 *
 * Fires one Ceipal page fetch through `fetchCeipalApplicants` (the Story-2-3
 * public surface the rest of the app uses). Asserts:
 *   - exactly one `ProviderLogEntry` JSON line is emitted with `provider='ceipal'`
 *   - the legacy `[Ceipal] Token acquired` log line is preserved (Story-2-3
 *     operator-runbook contract)
 *   - the provider registry sees the successful data call (mode stays `normal`)
 *
 * The `createSyncRun('ceipal') → completeSyncRun(runId, counts)` cycle is
 * covered by the existing `src/modules/__tests__/ingestion-jobs.test.ts`
 * Ceipal suite; this test focuses on the provider-framework logging + registry
 * contracts that are new in Story 1-12a.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderLogEntry } from '@/modules/providers/types';
import { CeipalProviderClient } from '@/modules/providers/ceipal/ceipal-client';
import { CeipalAuthStrategy } from '@/modules/providers/ceipal/ceipal-auth-strategy';
import { ProviderRegistry } from '@/modules/providers/registry';

function mockFetchWithTokenAndPage(applicants: unknown[]) {
  return vi.fn(async (url: string) => {
    if (url.includes('createAuthtoken')) {
      return new Response(
        JSON.stringify({ access_token: 'tok-audit', expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify(applicants), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

describe('Ceipal audit integration (AC 6 item 16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits exactly one ProviderLogEntry per data call and preserves [Ceipal] token log', async () => {
    const applicants = [
      { applicant_id: 'a1', first_name: 'Alice', last_name: 'A', email_address: 'a@test.com' },
      { applicant_id: 'a2', first_name: 'Bob', last_name: 'B', email_address: 'b@test.com' },
    ];
    vi.stubGlobal('fetch', mockFetchWithTokenAndPage(applicants));

    const logs: ProviderLogEntry[] = [];
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const auth = new CeipalAuthStrategy({
      apiKey: 'k',
      email: 'u@e.com',
      password: 'p',
      authUrl: 'https://api.ceipal.test/v1/createAuthtoken/',
    });
    const client = new CeipalProviderClient({
      auth,
      endpointKey: 'ep-audit',
      dataUrl: 'https://api.ceipal.test/data',
      interPageDelayMs: 0,
      onLog: (e) => logs.push(e),
    });

    const registry = new ProviderRegistry();
    registry.register('ceipal');
    registry.wireClient('ceipal', client.base);

    const result = await client.fetchApplicants({ maxPages: 1 });

    // Data shape ok
    expect(result).toHaveLength(2);

    // ── exactly one ProviderLogEntry with provider='ceipal' ──
    expect(logs).toHaveLength(1);
    const entry = logs[0];
    expect(entry.provider).toBe('ceipal');
    expect(entry.method).toBe('GET');
    expect(entry.path).toContain('/ep-audit?json=1&paging_length=50&page=1');
    expect(entry.statusCode).toBe(200);
    expect(entry.attempt).toBe(1);
    expect(entry.error).toBeUndefined();
    expect(entry.errorClassification).toBeUndefined();

    // ── [Ceipal] prefix preserved (Story 2-3 operator-runbook contract) ──
    const tokenLog = consoleLogSpy.mock.calls
      .map((c) => String(c[0]))
      .find((line) => line.includes('[Ceipal] Token acquired'));
    expect(tokenLog).toMatch(/\[Ceipal\] Token acquired, expires in 3600s/);

    // ── health registry: success wired, mode stays normal ──
    const provider = registry.getProvider('ceipal');
    expect(provider?.mode).toBe('normal');
    expect(provider?.health.totalAttempts).toBe(1);
    expect(provider?.health.totalFailures).toBe(0);
  });

  it('records the failure classification on the registry for a 500 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('createAuthtoken')) {
          return new Response(
            JSON.stringify({ access_token: 't', expires_in: 3600 }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('server err', { status: 500 });
      }),
    );

    const auth = new CeipalAuthStrategy({
      apiKey: 'k',
      email: 'u@e.com',
      password: 'p',
      authUrl: 'https://api.ceipal.test/v1/createAuthtoken/',
    });
    const client = new CeipalProviderClient({
      auth,
      endpointKey: 'ep',
      dataUrl: 'https://api.ceipal.test/data',
      interPageDelayMs: 0,
      maxRetries: 0,
    });

    const registry = new ProviderRegistry();
    registry.register('ceipal');
    registry.wireClient('ceipal', client.base);

    await expect(client.fetchApplicants({ maxPages: 1 })).rejects.toThrow(/500/);

    const provider = registry.getProvider('ceipal');
    // Failure recorded on the tracker
    expect(provider?.health.totalFailures).toBe(1);
    // Below the 30% / 10-attempt degrade threshold, so mode stays normal.
    expect(provider?.mode).toBe('normal');
  });
});
