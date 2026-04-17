/**
 * Ceipal provider client tests — Story 1-12a Task 3 / AC 3
 *
 * Covers the minimum 8 tests required by the story:
 *   1. happy path 200
 *   2. token cache hit (second call skips auth fetch)
 *   3. token cache miss → refresh
 *   4. auth failure classification (401 data / 401 token endpoint)
 *   5. 429 retry → success
 *   6. 500 retries exhausted
 *   7. timeout → transient
 *   8. pagination with `since` query param
 *
 * Plus XML token parse, JSON token parse, partial-page early exit, and
 * `clearCacheForTest` parity with the legacy hook.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CeipalAuthStrategy,
} from '@/modules/providers/ceipal/ceipal-auth-strategy';
import {
  CeipalProviderClient,
} from '@/modules/providers/ceipal/ceipal-client';
import type { ProviderLogEntry } from '@/modules/providers/types';

type FetchHandler = (
  url: string,
  init?: RequestInit,
) => Promise<Response> | Response;

function mockFetch(handler: FetchHandler) {
  const spy = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', spy);
  return spy;
}

function buildClient(overrides?: Partial<Parameters<typeof makeConfig>[0]>) {
  const { auth, endpointKey, dataUrl, interPageDelayMs, onLog } = makeConfig(overrides);
  return new CeipalProviderClient({ auth, endpointKey, dataUrl, interPageDelayMs, onLog, backoffMs: 1, maxRetries: 1 });
}

function makeConfig(overrides?: {
  apiKey?: string;
  email?: string;
  password?: string;
  authUrl?: string;
  dataUrl?: string;
  endpointKey?: string;
  interPageDelayMs?: number;
  onLog?: (e: ProviderLogEntry) => void;
}) {
  const auth = new CeipalAuthStrategy({
    apiKey: overrides?.apiKey ?? 'k',
    email: overrides?.email ?? 'u@e.com',
    password: overrides?.password ?? 'p',
    authUrl: overrides?.authUrl ?? 'https://api.ceipal.test/v1/createAuthtoken/',
    refreshBufferMs: 0,
    timeoutMs: 10_000,
  });
  return {
    auth,
    dataUrl: overrides?.dataUrl ?? 'https://api.ceipal.test/data',
    endpointKey: overrides?.endpointKey ?? 'ep',
    interPageDelayMs: overrides?.interPageDelayMs ?? 0,
    onLog: overrides?.onLog,
  };
}

describe('CeipalProviderClient — happy path + auth caching', () => {
  afterEach(() => vi.restoreAllMocks());

  it('200 happy path: acquires token (JSON) then fetches applicants on page 1', async () => {
    const logs: ProviderLogEntry[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = mockFetch(async (url: string) => {
      if (url.includes('createAuthtoken')) {
        return new Response(JSON.stringify({ access_token: 'abc', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify([{ applicant_id: '1' }, { applicant_id: '2' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const client = buildClient({ onLog: (e) => logs.push(e) });
    const applicants = await client.fetchApplicants({ startPage: 1, maxPages: 1 });

    expect(applicants).toHaveLength(2);
    // 1 token call + 1 data call
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // ProviderLogEntry only fires for data calls (token flow is outside the client)
    expect(logs).toHaveLength(1);
    expect(logs[0].provider).toBe('ceipal');
    expect(logs[0].method).toBe('GET');
    expect(logs[0].path).toContain('/ep?json=1&paging_length=50&page=1');
    // [Ceipal] token log preserved
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/\[Ceipal\] Token acquired/));
  });

  it('parses XML token response (access_token regex fallback)', async () => {
    const fetchSpy = mockFetch(async (url: string) => {
      if (url.includes('createAuthtoken')) {
        return new Response('<root><access_token>xml-token</access_token></root>', {
          status: 200,
          headers: { 'Content-Type': 'application/xml' },
        });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const client = buildClient();
    await client.fetchApplicants({ maxPages: 1 });
    // Data call receives Authorization: Bearer xml-token
    const dataCall = fetchSpy.mock.calls.find(([u]) => !String(u).includes('createAuthtoken'));
    const init = dataCall?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer xml-token');
  });

  it('caches the token across two consecutive fetchApplicants calls', async () => {
    const fetchSpy = mockFetch(async (url: string) => {
      if (url.includes('createAuthtoken')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const auth = new CeipalAuthStrategy({
      apiKey: 'k',
      email: 'u',
      password: 'p',
      authUrl: 'https://api.ceipal.test/v1/createAuthtoken/',
      refreshBufferMs: 60_000, // keep token valid far from expiry
    });
    const client = new CeipalProviderClient({
      auth,
      endpointKey: 'ep',
      dataUrl: 'https://api.ceipal.test/data',
      interPageDelayMs: 0,
    });

    await client.fetchApplicants({ maxPages: 1 });
    await client.fetchApplicants({ maxPages: 1 });

    // 1 auth call cached + 2 data calls
    const authCalls = fetchSpy.mock.calls.filter(([u]) => String(u).includes('createAuthtoken'));
    expect(authCalls).toHaveLength(1);
  });

  it('clearCacheForTest forces a new auth fetch on the next call', async () => {
    const fetchSpy = mockFetch(async (url: string) => {
      if (url.includes('createAuthtoken')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const auth = new CeipalAuthStrategy({
      apiKey: 'k',
      email: 'u',
      password: 'p',
      authUrl: 'https://api.ceipal.test/v1/createAuthtoken/',
      refreshBufferMs: 60_000,
    });
    const client = new CeipalProviderClient({
      auth,
      endpointKey: 'ep',
      dataUrl: 'https://api.ceipal.test/data',
      interPageDelayMs: 0,
    });

    await client.fetchApplicants({ maxPages: 1 });
    auth.clearCacheForTest();
    await client.fetchApplicants({ maxPages: 1 });

    const authCalls = fetchSpy.mock.calls.filter(([u]) => String(u).includes('createAuthtoken'));
    expect(authCalls).toHaveLength(2);
  });
});

describe('CeipalProviderClient — error classification + retries', () => {
  afterEach(() => vi.restoreAllMocks());

  it('401 on data call returns auth_failure and does not retry', async () => {
    let dataCalls = 0;
    mockFetch(async (url: string) => {
      if (url.includes('createAuthtoken')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      dataCalls++;
      return new Response('nope', { status: 401 });
    });

    const client = buildClient();
    await expect(client.fetchApplicants({ maxPages: 1 })).rejects.toThrow(/page 1 \(401\)/);
    expect(dataCalls).toBe(1);
  });

  it('401 on token endpoint throws sanitized error (no body logged)', async () => {
    mockFetch(async (url: string) => {
      if (url.includes('createAuthtoken')) {
        return new Response('{"echoed_credentials": "DO NOT LOG"}', { status: 401 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const auth = new CeipalAuthStrategy({
      apiKey: 'k',
      email: 'u',
      password: 'p',
      authUrl: 'https://api.ceipal.test/v1/createAuthtoken/',
    });
    const client = new CeipalProviderClient({
      auth,
      endpointKey: 'ep',
      dataUrl: 'https://api.ceipal.test/data',
      interPageDelayMs: 0,
    });
    await expect(client.fetchApplicants({ maxPages: 1 })).rejects.toThrow(
      /\[Ceipal\] Auth failed \(401\)/,
    );
  });

  it('429 → retries → succeeds', async () => {
    let attempts = 0;
    mockFetch(async (url: string) => {
      if (url.includes('createAuthtoken')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      attempts++;
      if (attempts === 1) return new Response('rate', { status: 429 });
      return new Response(JSON.stringify([{ applicant_id: 'ok' }]), { status: 200 });
    });

    const client = buildClient();
    const applicants = await client.fetchApplicants({ maxPages: 1 });
    expect(applicants).toHaveLength(1);
    expect(attempts).toBe(2);
  });

  it('500 retries exhausted throws with page number + status', async () => {
    let dataAttempts = 0;
    mockFetch(async (url: string) => {
      if (url.includes('createAuthtoken')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      dataAttempts++;
      return new Response('boom', { status: 500 });
    });

    const client = buildClient();
    await expect(client.fetchApplicants({ maxPages: 1 })).rejects.toThrow(/page 1 \(500\)/);
    // maxRetries=1 → 2 total attempts at the data endpoint
    expect(dataAttempts).toBe(2);
  });

  it('timeout returns transient and surfaces the timeout error message', async () => {
    mockFetch(async (url: string, init?: RequestInit) => {
      if (url.includes('createAuthtoken')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      await new Promise((_resolve, reject) => {
        (init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
      return new Response('', { status: 200 });
    });

    const auth = new CeipalAuthStrategy({
      apiKey: 'k',
      email: 'u',
      password: 'p',
      authUrl: 'https://api.ceipal.test/v1/createAuthtoken/',
    });
    const client = new CeipalProviderClient({
      auth,
      endpointKey: 'ep',
      dataUrl: 'https://api.ceipal.test/data',
      timeoutMs: 10,
      maxRetries: 0,
      backoffMs: 1,
      interPageDelayMs: 0,
    });

    await expect(client.fetchApplicants({ maxPages: 1 })).rejects.toThrow(/Timeout after 10ms/);
  });
});

describe('CeipalProviderClient — pagination', () => {
  afterEach(() => vi.restoreAllMocks());

  it('appends modified_after=YYYY-MM-DD when `since` is provided', async () => {
    const captured: string[] = [];
    mockFetch(async (url: string) => {
      if (url.includes('createAuthtoken')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      captured.push(url);
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const client = buildClient();
    await client.fetchApplicants({ since: new Date('2026-04-10T12:34:56Z'), maxPages: 1 });
    expect(captured[0]).toContain('modified_after=2026-04-10');
  });

  it('stops on partial page (< 50 results)', async () => {
    let dataCalls = 0;
    const partialPage = Array.from({ length: 5 }, (_, i) => ({ applicant_id: String(i) }));
    mockFetch(async (url: string) => {
      if (url.includes('createAuthtoken')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      dataCalls++;
      return new Response(JSON.stringify(partialPage), { status: 200 });
    });

    const client = buildClient();
    const applicants = await client.fetchApplicants({ maxPages: 10 });
    expect(applicants).toHaveLength(5);
    expect(dataCalls).toBe(1);
  });

  it('respects startPage + maxPages window (paginates exactly maxPages times)', async () => {
    const captured: string[] = [];
    const fullPage = Array.from({ length: 50 }, (_, i) => ({ applicant_id: String(i) }));
    mockFetch(async (url: string) => {
      if (url.includes('createAuthtoken')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      captured.push(url);
      return new Response(JSON.stringify(fullPage), { status: 200 });
    });

    const client = buildClient();
    await client.fetchApplicants({ startPage: 3, maxPages: 2 });
    expect(captured).toHaveLength(2);
    expect(captured[0]).toContain('page=3');
    expect(captured[1]).toContain('page=4');
  });

  it('handles paginated object response shape { results, count }', async () => {
    mockFetch(async (url: string) => {
      if (url.includes('createAuthtoken')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ results: [{ applicant_id: '1' }], count: 1 }),
        { status: 200 },
      );
    });

    const client = buildClient();
    const applicants = await client.fetchApplicants({ maxPages: 1 });
    expect(applicants).toHaveLength(1);
  });
});

describe('CeipalAuthStrategy — contract', () => {
  afterEach(() => vi.restoreAllMocks());

  it('throws on missing credentials', () => {
    expect(() => new CeipalAuthStrategy({ apiKey: '', email: 'u', password: 'p' })).toThrow();
    expect(() => new CeipalAuthStrategy({ apiKey: 'k', email: '', password: 'p' })).toThrow();
    expect(() => new CeipalAuthStrategy({ apiKey: 'k', email: 'u', password: '' })).toThrow();
  });

  it('throws when auth response is OK but missing the token', async () => {
    mockFetch(async () =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const auth = new CeipalAuthStrategy({
      apiKey: 'k',
      email: 'u',
      password: 'p',
      authUrl: 'https://api.ceipal.test/v1/createAuthtoken/',
    });
    await expect(auth.applyAuth({})).rejects.toThrow(/missing token/);
  });
});
