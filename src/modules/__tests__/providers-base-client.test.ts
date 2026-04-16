import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseProviderClient } from '../providers/base-client';
import { BearerTokenAuth } from '../providers/auth/bearer-token';
import { ApiKeyHeaderAuth } from '../providers/auth/api-key-header';
import { OAuthTokenAuth } from '../providers/auth/oauth-token';
import type { ProviderLogEntry, ErrorClassification } from '../providers/types';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createClient(overrides: {
  maxRetries?: number;
  timeoutMs?: number;
  backoffMs?: number;
  retryableStatuses?: number[];
  estimateCost?: (ctx: import('../providers/types').CostContext) => number;
} = {}) {
  const { maxRetries, timeoutMs, backoffMs, retryableStatuses, estimateCost } = overrides;
  return new BaseProviderClient({
    name: 'test-provider',
    baseUrl: 'https://api.example.com',
    auth: new BearerTokenAuth('test-token-123'),
    maxRetries: maxRetries ?? 0,       // no retries by default in tests
    timeoutMs: timeoutMs ?? 5_000,
    backoffMs: backoffMs ?? 10,         // fast backoff in tests
    retryableStatuses,
    estimateCost,
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

function mockFetch(status: number, body: unknown = {}, options?: { delay?: number }) {
  fetchSpy = vi.fn(async () => {
    if (options?.delay) await new Promise((r) => setTimeout(r, options.delay));
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchSpy);
}

function mockFetchSequence(responses: Array<{ status: number; body?: unknown }>) {
  let callIndex = 0;
  fetchSpy = vi.fn(async () => {
    const r = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchSpy);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ */
/*  Auth Injection Tests                                               */
/* ------------------------------------------------------------------ */

describe('BaseProviderClient — auth injection', () => {
  it('injects bearer token into Authorization header', async () => {
    mockFetch(200, { ok: true });
    const client = createClient();
    await client.get('/test');

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers['Authorization']).toBe('Bearer test-token-123');
  });

  it('injects API key into custom header', async () => {
    mockFetch(200, { ok: true });
    const client = new BaseProviderClient({
      name: 'api-key-provider',
      baseUrl: 'https://api.example.com',
      auth: new ApiKeyHeaderAuth('my-key', 'X-Custom-Key'),
      maxRetries: 0,
    });
    await client.get('/test');

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers['X-Custom-Key']).toBe('my-key');
  });

  it('injects API key into default X-API-Key header', async () => {
    mockFetch(200, { ok: true });
    const client = new BaseProviderClient({
      name: 'api-key-provider',
      baseUrl: 'https://api.example.com',
      auth: new ApiKeyHeaderAuth('my-key'),
      maxRetries: 0,
    });
    await client.get('/test');

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers['X-API-Key']).toBe('my-key');
  });
});

/* ------------------------------------------------------------------ */
/*  Retry and Backoff Tests                                            */
/* ------------------------------------------------------------------ */

describe('BaseProviderClient — retry', () => {
  it('retries on 429 status', async () => {
    mockFetchSequence([
      { status: 429 },
      { status: 200, body: { success: true } },
    ]);
    const client = createClient({ maxRetries: 1, backoffMs: 10 });
    const result = await client.get('/test');

    expect(result.ok).toBe(true);
    expect(result.attempt).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries on 503 status', async () => {
    mockFetchSequence([
      { status: 503 },
      { status: 200, body: { data: 'ok' } },
    ]);
    const client = createClient({ maxRetries: 1, backoffMs: 10 });
    const result = await client.get('/test');

    expect(result.ok).toBe(true);
    expect(result.attempt).toBe(2);
  });

  it('retries on 500 status (matches fetchWithRetry behavior)', async () => {
    mockFetchSequence([
      { status: 500 },
      { status: 200, body: { data: 'ok' } },
    ]);
    const client = createClient({ maxRetries: 1, backoffMs: 10 });
    const result = await client.get('/test');

    expect(result.ok).toBe(true);
    expect(result.attempt).toBe(2);
  });

  it('retries on 408 request timeout', async () => {
    mockFetchSequence([
      { status: 408 },
      { status: 200, body: {} },
    ]);
    const client = createClient({ maxRetries: 1, backoffMs: 10 });
    const result = await client.get('/test');

    expect(result.ok).toBe(true);
    expect(result.attempt).toBe(2);
  });

  it('does NOT retry on 400 (permanent error)', async () => {
    mockFetch(400);
    const client = createClient({ maxRetries: 3, backoffMs: 10 });
    const result = await client.get('/test');

    expect(result.ok).toBe(false);
    expect(result.errorClassification).toBe('permanent');
    expect(result.attempt).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 401 (auth failure)', async () => {
    mockFetch(401);
    const client = createClient({ maxRetries: 3, backoffMs: 10 });
    const result = await client.get('/test');

    expect(result.ok).toBe(false);
    expect(result.errorClassification).toBe('auth_failure');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('exhausts all retries and returns last failure', async () => {
    mockFetch(502);
    const client = createClient({ maxRetries: 2, backoffMs: 10 });
    const result = await client.get('/test');

    expect(result.ok).toBe(false);
    expect(result.attempt).toBe(3); // 1 initial + 2 retries
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('applies exponential backoff between retries', async () => {
    const callTimes: number[] = [];
    let callIndex = 0;
    fetchSpy = vi.fn(async () => {
      callTimes.push(Date.now());
      callIndex++;
      const status = callIndex < 3 ? 503 : 200;
      return new Response(JSON.stringify({}), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const client = createClient({ maxRetries: 2, backoffMs: 100 });
    await client.get('/test');

    // backoff: 100ms * 2^0 = 100ms, 100ms * 2^1 = 200ms
    expect(callTimes.length).toBe(3);
    const gap1 = callTimes[1] - callTimes[0];
    const gap2 = callTimes[2] - callTimes[1];
    expect(gap1).toBeGreaterThanOrEqual(90); // ~100ms
    expect(gap2).toBeGreaterThanOrEqual(180); // ~200ms
  });
});

/* ------------------------------------------------------------------ */
/*  Timeout Tests                                                      */
/* ------------------------------------------------------------------ */

describe('BaseProviderClient — timeout', () => {
  it('aborts request that exceeds timeout', async () => {
    // Use real timers for this test since AbortController relies on real setTimeout
    vi.useRealTimers();

    fetchSpy = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response('{}', { status: 200 })), 5_000);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const client = createClient({ timeoutMs: 50 });
    const result = await client.get('/slow');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Timeout');
    expect(result.errorClassification).toBe('transient');
  });
});

/* ------------------------------------------------------------------ */
/*  Structured Logging Tests                                           */
/* ------------------------------------------------------------------ */

describe('BaseProviderClient — logging', () => {
  it('emits structured log on successful request', async () => {
    mockFetch(200, { data: 1 });
    const client = createClient();
    const logs: ProviderLogEntry[] = [];
    client.onLog = (entry) => logs.push(entry);

    await client.get('/users');

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      provider: 'test-provider',
      method: 'GET',
      path: '/users',
      statusCode: 200,
      attempt: 1,
    });
    expect(logs[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('emits structured log with error on failure', async () => {
    mockFetch(500);
    const client = createClient();
    const logs: ProviderLogEntry[] = [];
    client.onLog = (entry) => logs.push(entry);

    await client.get('/fail');

    expect(logs).toHaveLength(1);
    expect(logs[0].error).toBe('HTTP 500');
    expect(logs[0].errorClassification).toBe('transient');
  });

  it('emits log per retry attempt', async () => {
    mockFetchSequence([{ status: 503 }, { status: 200 }]);
    const client = createClient({ maxRetries: 1, backoffMs: 10 });
    const logs: ProviderLogEntry[] = [];
    client.onLog = (entry) => logs.push(entry);

    await client.get('/test');

    expect(logs).toHaveLength(2);
    expect(logs[0].attempt).toBe(1);
    expect(logs[1].attempt).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*  Cost Tracking Hook                                                 */
/* ------------------------------------------------------------------ */

describe('BaseProviderClient — cost tracking', () => {
  it('includes cost estimate in log when estimateCost is set', async () => {
    mockFetch(200, {});
    const client = createClient({
      estimateCost: (ctx) => (ctx.method === 'POST' ? 0.05 : 0.01),
    });
    const logs: ProviderLogEntry[] = [];
    client.onLog = (entry) => logs.push(entry);

    await client.post('/inference', { prompt: 'hello' });

    expect(logs[0].costEstimate).toBe(0.05);
  });

  it('passes costMeta to estimateCost for token-billed providers', async () => {
    mockFetch(200, {});
    let capturedMeta: Record<string, unknown> | undefined;
    const client = new BaseProviderClient({
      name: 'anthropic',
      baseUrl: 'https://api.example.com',
      auth: new BearerTokenAuth('t'),
      maxRetries: 0,
      estimateCost: (ctx) => {
        capturedMeta = ctx.costMeta;
        const tokens = Number(ctx.costMeta?.inputTokens ?? 0) + Number(ctx.costMeta?.outputTokens ?? 0);
        return tokens * 0.000003;
      },
    });
    const logs: ProviderLogEntry[] = [];
    client.onLog = (entry) => logs.push(entry);

    await client.request('POST', '/v1/messages', {
      body: { model: 'claude-sonnet' },
      costMeta: { model: 'claude-sonnet', inputTokens: 1000, outputTokens: 500, pages: 0 },
    });

    expect(capturedMeta).toEqual({ model: 'claude-sonnet', inputTokens: 1000, outputTokens: 500, pages: 0 });
    expect(logs[0].costEstimate).toBeCloseTo(1500 * 0.000003);
  });

  it('catches errors in estimateCost without breaking the request', async () => {
    mockFetch(200, {});
    const client = createClient({
      estimateCost: () => { throw new Error('cost estimation broken'); },
    });
    const logs: ProviderLogEntry[] = [];
    client.onLog = (entry) => logs.push(entry);

    const result = await client.get('/test');
    expect(result.ok).toBe(true);
    expect(logs[0].costEstimate).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Error Classification                                               */
/* ------------------------------------------------------------------ */

describe('BaseProviderClient — error classification', () => {
  it.each([
    [429, 'rate_limited'],
    [401, 'auth_failure'],
    [403, 'auth_failure'],
    [400, 'permanent'],
    [404, 'permanent'],
    [422, 'permanent'],
    [500, 'transient'],
    [502, 'transient'],
    [503, 'transient'],
    [504, 'transient'],
  ] as [number, ErrorClassification][])('classifies HTTP %d as %s', async (status, expected) => {
    mockFetch(status);
    const client = createClient();
    const result = await client.get('/test');

    expect(result.errorClassification).toBe(expected);
  });

  it('does NOT retry HTTP 501 Not Implemented (removed from default whitelist)', async () => {
    mockFetch(501);
    const client = createClient({ maxRetries: 3, backoffMs: 10 });
    const result = await client.get('/test');

    expect(result.ok).toBe(false);
    expect(result.attempt).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('classifies auth-related thrown errors as auth_failure (not transient)', async () => {
    const throwingAuth = {
      applyAuth: async () => { throw new Error('invalid_grant: OAuth token refresh failed'); },
    };
    const client = new BaseProviderClient({
      name: 'oauth-provider',
      baseUrl: 'https://api.example.com',
      auth: throwingAuth,
      maxRetries: 3,
      backoffMs: 10,
    });
    // Stub fetch (shouldn't be called since auth throws first)
    vi.stubGlobal('fetch', vi.fn());

    const result = await client.get('/test');

    expect(result.ok).toBe(false);
    expect(result.errorClassification).toBe('auth_failure');
    expect(result.attempt).toBe(1); // auth_failure short-circuits retry
  });
});

describe('BaseProviderClient — constructor validation', () => {
  it('rejects negative maxRetries', () => {
    expect(() => new BaseProviderClient({
      name: 't',
      baseUrl: 'https://x.com',
      auth: new BearerTokenAuth('t'),
      maxRetries: -1,
    })).toThrow(/maxRetries must be >= 0/);
  });

  it('rejects timeoutMs <= 0', () => {
    expect(() => new BaseProviderClient({
      name: 't',
      baseUrl: 'https://x.com',
      auth: new BearerTokenAuth('t'),
      timeoutMs: 0,
    })).toThrow(/timeoutMs must be > 0/);
  });
});

describe('BearerTokenAuth — constructor validation', () => {
  it('rejects empty token', () => {
    expect(() => new BearerTokenAuth('')).toThrow(/non-empty/);
  });
});

/* ------------------------------------------------------------------ */
/*  Health Reporting Hooks                                             */
/* ------------------------------------------------------------------ */

describe('BaseProviderClient — health reporting', () => {
  it('calls onSuccess for successful requests', async () => {
    mockFetch(200, {});
    const client = createClient();
    const successes: number[] = [];
    client.onSuccess = (ms) => successes.push(ms);

    await client.get('/test');

    expect(successes).toHaveLength(1);
    expect(successes[0]).toBeGreaterThanOrEqual(0);
  });

  it('calls onFailure for failed requests', async () => {
    mockFetch(500);
    const client = createClient();
    const failures: Array<{ ms: number; classification: ErrorClassification }> = [];
    client.onFailure = (ms, c) => failures.push({ ms, classification: c });

    await client.get('/test');

    expect(failures).toHaveLength(1);
    expect(failures[0].classification).toBe('transient');
  });

  it('calls onFailure for each retry attempt', async () => {
    mockFetchSequence([{ status: 503 }, { status: 503 }, { status: 200 }]);
    const client = createClient({ maxRetries: 2, backoffMs: 10 });
    const failures: ErrorClassification[] = [];
    client.onFailure = (_, c) => failures.push(c);

    await client.get('/test');

    expect(failures).toHaveLength(2); // 2 failures before success
  });
});

/* ------------------------------------------------------------------ */
/*  Request Body and URL construction                                  */
/* ------------------------------------------------------------------ */

describe('BaseProviderClient — request construction', () => {
  it('sends JSON body on POST', async () => {
    mockFetch(200, {});
    const client = createClient();
    await client.post('/data', { key: 'value' });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.example.com/data');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ key: 'value' }));
  });

  it('handles empty 200 body without crashing or retrying', async () => {
    fetchSpy = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const client = createClient({ maxRetries: 2 });
    const result = await client.get('/ack');

    expect(result.ok).toBe(true);
    expect(result.data).toBeNull();
    expect(result.attempt).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('handles non-JSON 200 body gracefully (returns null, no retry)', async () => {
    fetchSpy = vi.fn(async () => new Response('OK', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const client = createClient({ maxRetries: 2 });
    const result = await client.get('/plain');

    expect(result.ok).toBe(true);
    expect(result.data).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('strips trailing slash from base URL', async () => {
    mockFetch(200, {});
    const client = new BaseProviderClient({
      name: 'test',
      baseUrl: 'https://api.example.com/',
      auth: new BearerTokenAuth('t'),
      maxRetries: 0,
    });
    await client.get('/path');

    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.example.com/path');
  });
});

/* ------------------------------------------------------------------ */
/*  OAuth Token Auth                                                   */
/* ------------------------------------------------------------------ */

describe('OAuthTokenAuth', () => {
  it('fetches token on first use and caches it', async () => {
    const tokenFetch = vi.fn(async () => new Response(
      JSON.stringify({ access_token: 'oauth-token-1', expires_in: 3600 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', tokenFetch);

    const auth = new OAuthTokenAuth('https://auth.example.com/token', 'cid', 'csecret');
    const headers1: Record<string, string> = {};
    await auth.applyAuth(headers1);
    expect(headers1['Authorization']).toBe('Bearer oauth-token-1');

    const headers2: Record<string, string> = {};
    await auth.applyAuth(headers2);
    expect(headers2['Authorization']).toBe('Bearer oauth-token-1');

    expect(tokenFetch).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent refresh calls into one fetch (no thundering herd)', async () => {
    let resolveFetch: ((r: Response) => void) | null = null;
    const tokenFetch = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal('fetch', tokenFetch);

    const auth = new OAuthTokenAuth('https://auth.example.com/token', 'cid', 'csecret');
    // Fire 5 concurrent applyAuth calls
    const pending = Array.from({ length: 5 }, () => auth.applyAuth({}));

    // Let the refresh kick off
    await Promise.resolve();
    expect(tokenFetch).toHaveBeenCalledTimes(1);

    // Resolve the shared refresh
    resolveFetch!(new Response(
      JSON.stringify({ access_token: 'shared-token', expires_in: 3600 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));

    const results = await Promise.all(pending);
    for (const h of results) expect(h['Authorization']).toBe('Bearer shared-token');
    expect(tokenFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects token response missing access_token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'invalid_client' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    const auth = new OAuthTokenAuth('https://auth.example.com/token', 'cid', 'csecret');
    await expect(auth.applyAuth({})).rejects.toThrow(/invalid_client|access_token/);
  });

  it('rejects token response with missing expires_in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ access_token: 'x' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    const auth = new OAuthTokenAuth('https://auth.example.com/token', 'cid', 'csecret');
    await expect(auth.applyAuth({})).rejects.toThrow(/expires_in/);
  });

  it('refreshes token when expired', async () => {
    let callCount = 0;
    const tokenFetch = vi.fn(async () => {
      callCount++;
      return new Response(
        JSON.stringify({ access_token: `token-${callCount}`, expires_in: 1 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', tokenFetch);

    const auth = new OAuthTokenAuth('https://auth.example.com/token', 'cid', 'csecret', 0);
    const h1: Record<string, string> = {};
    await auth.applyAuth(h1);
    expect(h1['Authorization']).toBe('Bearer token-1');

    // Force expiry
    auth.clearTokenForTest();
    const h2: Record<string, string> = {};
    await auth.applyAuth(h2);
    expect(h2['Authorization']).toBe('Bearer token-2');
    expect(tokenFetch).toHaveBeenCalledTimes(2);
  });
});
