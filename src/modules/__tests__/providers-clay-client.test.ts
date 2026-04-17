/**
 * Clay outbound client tests — Story 1-12a Task 2 / AC 2
 *
 * Covers the minimum 6-test density called for in the story:
 *   1. happy path 200
 *   2. 429 retry → success
 *   3. 500 retries exhausted
 *   4. 401 returns auth_failure (no retry)
 *   5. timeout abort returns transient
 *   6. estimateCost is not invoked (left undefined on the underlying client)
 *
 * Plus environment-builder coverage so the startup path is exercised without
 * mutating process.env outside the test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClayProviderClient,
  buildClayProviderClientFromEnv,
} from '@/modules/providers/clay/clay-client';
import type { ProviderLogEntry } from '@/modules/providers/types';

function fetchReturning(...responses: Array<Response | (() => Promise<Response>)>) {
  let i = 0;
  return vi.fn(async () => {
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    return typeof next === 'function' ? await next() : next;
  });
}

describe('ClayProviderClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CLAY_API_KEY;
    delete process.env.CLAY_API_BASE_URL;
  });

  it('throws if apiKey is missing', () => {
    expect(() => new ClayProviderClient({ apiKey: '' })).toThrow(/apiKey/);
  });

  it('200 happy path returns ok + emits a ProviderLogEntry tagged clay-outbound', async () => {
    const logs: ProviderLogEntry[] = [];
    const client = new ClayProviderClient({
      apiKey: 'k',
      baseUrl: 'https://api.clay.com',
      maxRetries: 0,
      backoffMs: 1,
      onLog: (e) => logs.push(e),
    });
    vi.stubGlobal(
      'fetch',
      fetchReturning(new Response('{"id":"abc"}', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );

    const result = await client.pushCandidateForEnrichment({ email: 'a@b.com' });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ id: 'abc' });
    expect(logs).toHaveLength(1);
    expect(logs[0].provider).toBe('clay-outbound');
    expect(logs[0].method).toBe('POST');
    expect(logs[0].path).toBe('/v1/enrichment/person');
    expect(logs[0].costEstimate).toBeUndefined();
  });

  it('injects the x-api-key header by default', async () => {
    const fetchSpy = vi.fn(
      async (..._args: unknown[]) => new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const client = new ClayProviderClient({ apiKey: 'k-123', maxRetries: 0, backoffMs: 1 });
    await client.pushCandidateForEnrichment({ email: 'x@y.z' });

    const call = fetchSpy.mock.calls[0];
    const init = call?.[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['x-api-key']).toBe('k-123');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('429 retries then succeeds on retry', async () => {
    vi.stubGlobal(
      'fetch',
      fetchReturning(
        new Response('rate', { status: 429 }),
        new Response('{"id":"ok"}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ),
    );
    const client = new ClayProviderClient({ apiKey: 'k', maxRetries: 1, backoffMs: 1 });
    const result = await client.pushCandidateForEnrichment({ email: 'a@b.com' });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.attempt).toBe(2);
  });

  it('500 retries exhausted → classifies as transient, returns last failure', async () => {
    vi.stubGlobal(
      'fetch',
      fetchReturning(
        new Response('err', { status: 500 }),
        new Response('err', { status: 500 }),
        new Response('err', { status: 500 }),
      ),
    );
    const client = new ClayProviderClient({ apiKey: 'k', maxRetries: 1, backoffMs: 1 });
    const result = await client.pushCandidateForEnrichment({ email: 'a@b.com' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.errorClassification).toBe('transient');
    expect(result.attempt).toBe(2);
  });

  it('401 returns auth_failure and does NOT retry', async () => {
    const fetchSpy = fetchReturning(new Response('nope', { status: 401 }));
    vi.stubGlobal('fetch', fetchSpy);
    const client = new ClayProviderClient({ apiKey: 'k', maxRetries: 3, backoffMs: 1 });
    const result = await client.pushCandidateForEnrichment({ email: 'a@b.com' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.errorClassification).toBe('auth_failure');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('timeout abort classifies as transient', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init?: RequestInit) => {
        await new Promise((_resolve, reject) => {
          (init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
        return new Response('', { status: 200 });
      }),
    );
    const client = new ClayProviderClient({
      apiKey: 'k',
      timeoutMs: 10,
      maxRetries: 0,
      backoffMs: 1,
    });
    const result = await client.pushCandidateForEnrichment({ email: 'a@b.com' });
    expect(result.ok).toBe(false);
    expect(result.errorClassification).toBe('transient');
    expect(result.error).toMatch(/Timeout after 10ms/);
  });
});

describe('buildClayProviderClientFromEnv', () => {
  afterEach(() => {
    delete process.env.CLAY_API_KEY;
    delete process.env.CLAY_API_BASE_URL;
    delete process.env.CLAY_API_KEY_HEADER;
  });

  it('returns null when CLAY_API_KEY is unset', () => {
    expect(buildClayProviderClientFromEnv()).toBeNull();
  });

  it('builds a client when CLAY_API_KEY is set', () => {
    process.env.CLAY_API_KEY = 'k-env';
    process.env.CLAY_API_BASE_URL = 'https://example.test';
    const client = buildClayProviderClientFromEnv();
    expect(client).toBeInstanceOf(ClayProviderClient);
  });
});
