import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { BaseWebhookReceiver, type WebhookEventStore } from '../providers/webhook-receiver';
import { WebhookProcessor, type WebhookProcessorStore } from '../providers/webhook-processor';
import { WebhookRateLimiter } from '../providers/webhook-rate-limiter';
import {
  BearerTokenWebhookAuth,
  HmacSignatureWebhookAuth,
  ApiKeyWebhookAuth,
} from '../providers/webhook-auth';
import type { WebhookEvent, WebhookHandler } from '../providers/types';

/* ------------------------------------------------------------------ */
/*  Mock Store                                                         */
/* ------------------------------------------------------------------ */

function createMockStore(
  opts?: { seenIds?: Set<string> },
): WebhookEventStore & { events: WebhookEvent[]; seen: Set<string> } {
  const events: WebhookEvent[] = [];
  const seen = opts?.seenIds ?? new Set<string>();
  return {
    events,
    seen,
    insertIfNotDuplicate: vi.fn(async (event: WebhookEvent) => {
      if (event.providerEventId && seen.has(event.providerEventId)) return false;
      if (event.providerEventId) seen.add(event.providerEventId);
      events.push(event);
      return true;
    }),
  };
}

function createMockProcessorStore(events: WebhookEvent[] = []): WebhookProcessorStore & {
  completed: string[];
  failed: Array<{ id: string; error: string; attempt: number }>;
  deadLettered: string[];
} {
  const completed: string[] = [];
  const failed: Array<{ id: string; error: string; attempt: number }> = [];
  const deadLettered: string[] = [];
  return {
    completed,
    failed,
    deadLettered,
    claimBatch: vi.fn(async (batchSize: number) => events.splice(0, batchSize)),
    markCompleted: vi.fn(async (id: string, _result?) => { completed.push(id); }),
    markFailed: vi.fn(async (id: string, error: string, attempt: number) => { failed.push({ id, error, attempt }); }),
    markDeadLetter: vi.fn(async (id: string) => { deadLettered.push(id); }),
  };
}

function validHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function makeReceiver(
  store?: WebhookEventStore,
  overrides?: Partial<{
    rateLimiter: WebhookRateLimiter;
    replayWindowMs: number;
    maxPayloadBytes: number;
    extractEventId: (p: unknown) => string | null;
    extractEventType: (p: unknown) => string;
    extractTimestamp: (p: unknown) => string | number | null;
  }>,
) {
  const s = store ?? createMockStore();
  return new BaseWebhookReceiver(
    {
      source: 'test-source',
      auth: new BearerTokenWebhookAuth('webhook-secret-123'),
      extractEventId: overrides?.extractEventId ?? ((p: unknown) => (p as { id?: string }).id ?? null),
      extractEventType: overrides?.extractEventType ?? ((p: unknown) => (p as { type?: string }).type ?? 'test'),
      extractTimestamp: overrides?.extractTimestamp,
      replayWindowMs: overrides?.replayWindowMs,
      maxPayloadBytes: overrides?.maxPayloadBytes,
      rateLimitMax: overrides?.rateLimiter ? undefined : 100,
      rateLimitWindowMs: overrides?.rateLimiter ? undefined : 60_000,
    },
    s,
    overrides?.rateLimiter,
  );
}

/* ------------------------------------------------------------------ */
/*  Webhook Auth Strategy Tests                                        */
/* ------------------------------------------------------------------ */

describe('BearerTokenWebhookAuth', () => {
  it('accepts valid bearer token', async () => {
    const auth = new BearerTokenWebhookAuth('secret-token');
    const valid = await auth.validate('{}', { Authorization: 'Bearer secret-token' });
    expect(valid).toBe(true);
  });

  it('rejects invalid bearer token', async () => {
    const auth = new BearerTokenWebhookAuth('secret-token');
    const valid = await auth.validate('{}', { Authorization: 'Bearer wrong-token0' });
    expect(valid).toBe(false);
  });

  it('rejects missing Authorization header', async () => {
    const auth = new BearerTokenWebhookAuth('secret-token');
    const valid = await auth.validate('{}', {});
    expect(valid).toBe(false);
  });
});

describe('HmacSignatureWebhookAuth', () => {
  it('accepts valid HMAC signature', async () => {
    const secret = 'hmac-secret';
    const body = '{"event":"test"}';
    const sig = createHmac('sha256', secret).update(body).digest('hex');

    const auth = new HmacSignatureWebhookAuth(secret, 'x-signature');
    const valid = await auth.validate(body, { 'x-signature': sig });
    expect(valid).toBe(true);
  });

  it('rejects tampered payload', async () => {
    const secret = 'hmac-secret';
    const sig = createHmac('sha256', secret).update('original').digest('hex');

    const auth = new HmacSignatureWebhookAuth(secret, 'x-signature');
    const valid = await auth.validate('tampered0', { 'x-signature': sig });
    expect(valid).toBe(false);
  });

  it('supports signature prefix (e.g. sha256=)', async () => {
    const secret = 'my-secret';
    const body = '{"data":1}';
    const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

    const auth = new HmacSignatureWebhookAuth(secret, 'x-hub-signature', 'sha256', 'sha256=');
    const valid = await auth.validate(body, { 'x-hub-signature': sig });
    expect(valid).toBe(true);
  });
});

describe('ApiKeyWebhookAuth', () => {
  it('accepts valid API key', async () => {
    const auth = new ApiKeyWebhookAuth('api-key-123', 'x-api-key');
    const valid = await auth.validate('{}', { 'x-api-key': 'api-key-123' });
    expect(valid).toBe(true);
  });

  it('rejects wrong API key', async () => {
    const auth = new ApiKeyWebhookAuth('api-key-123', 'x-api-key');
    const valid = await auth.validate('{}', { 'x-api-key': 'wrong-key00' });
    expect(valid).toBe(false);
  });

  it('returns false (not throw) when byte-lengths differ (multi-byte UTF-8)', async () => {
    // String length 11, but byte length 12+ when contains é
    const auth = new ApiKeyWebhookAuth('api-key-123', 'x-api-key');
    const valid = await auth.validate('{}', { 'x-api-key': 'api-kéy-123' });
    expect(valid).toBe(false); // must not throw RangeError
  });

  it('matches case-insensitive header name', async () => {
    const auth = new ApiKeyWebhookAuth('mykey');
    expect(await auth.validate('{}', { 'X-API-Key': 'mykey' })).toBe(true);
    expect(await auth.validate('{}', { 'x-api-key': 'mykey' })).toBe(true);
    expect(await auth.validate('{}', { 'X-Api-KEY': 'mykey' })).toBe(true);
  });

  it('rejects empty-string secret at construction time', () => {
    expect(() => new ApiKeyWebhookAuth('')).toThrow(/non-empty/);
  });
});

/* ------------------------------------------------------------------ */
/*  Webhook Receiver Pipeline Tests                                    */
/* ------------------------------------------------------------------ */

describe('BaseWebhookReceiver', () => {
  it('accepts valid webhook and stores event', async () => {
    const store = createMockStore();
    const receiver = makeReceiver(store);
    const body = JSON.stringify({ id: 'evt-1', type: 'contact.created', data: {} });

    const result = await receiver.receive(body, validHeaders('webhook-secret-123'));

    expect(result.accepted).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.event).not.toBeNull();
    expect(result.event!.source).toBe('test-source');
    expect(result.event!.eventType).toBe('contact.created');
    expect(result.event!.providerEventId).toBe('evt-1');
    expect(store.events).toHaveLength(1);
  });

  it('rejects invalid signature with 401', async () => {
    const receiver = makeReceiver();
    const result = await receiver.receive('{}', { Authorization: 'Bearer wrong' });

    expect(result.accepted).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.reason).toContain('signature');
  });

  it('rejects oversized payload with 413', async () => {
    const receiver = makeReceiver(undefined, { maxPayloadBytes: 50 });
    const bigBody = JSON.stringify({ data: 'x'.repeat(100) });

    const result = await receiver.receive(bigBody, validHeaders('webhook-secret-123'));

    expect(result.accepted).toBe(false);
    expect(result.statusCode).toBe(413);
  });

  it('rejects invalid JSON with 400', async () => {
    const receiver = makeReceiver();
    const result = await receiver.receive('not-json{', validHeaders('webhook-secret-123'));

    expect(result.accepted).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.reason).toContain('JSON');
  });

  it('rejects replayed event with old timestamp', async () => {
    const receiver = makeReceiver(undefined, {
      replayWindowMs: 5 * 60 * 1000,
      extractTimestamp: (p: unknown) => (p as { ts?: number }).ts ?? null,
    });
    const oldTs = Date.now() - 10 * 60 * 1000; // 10 minutes ago
    const body = JSON.stringify({ id: 'evt-2', type: 'test', ts: oldTs });

    const result = await receiver.receive(body, validHeaders('webhook-secret-123'));

    expect(result.accepted).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.reason).toContain('Replay');
  });

  it('skips duplicate events with 200', async () => {
    const store = createMockStore({ seenIds: new Set(['evt-dup']) });
    const receiver = makeReceiver(store);
    const body = JSON.stringify({ id: 'evt-dup', type: 'test' });

    const result = await receiver.receive(body, validHeaders('webhook-secret-123'));

    expect(result.accepted).toBe(false);
    expect(result.statusCode).toBe(200); // 200 so provider doesn't retry
    expect(result.reason).toContain('Duplicate');
  });

  it('normalizes empty-string event_id to null (no dedup bypass)', async () => {
    const store = createMockStore();
    const receiver = makeReceiver(store);
    const body = JSON.stringify({ id: '', type: 'test' });

    const result = await receiver.receive(body, validHeaders('webhook-secret-123'));

    expect(result.accepted).toBe(true);
    expect(result.event!.providerEventId).toBeNull();
  });

  it('rejects webhooks with unparseable timestamp (fail-closed)', async () => {
    const receiver = makeReceiver(undefined, {
      extractTimestamp: (p: unknown) => (p as { ts?: unknown }).ts as string | number | null,
    });
    const body = JSON.stringify({ id: 'x', type: 'test', ts: 'not-a-date' });

    const result = await receiver.receive(body, validHeaders('webhook-secret-123'));

    expect(result.accepted).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.reason).toContain('unparseable');
  });

  it('rejects webhooks with timestamp too far in the future', async () => {
    const receiver = makeReceiver(undefined, {
      replayWindowMs: 5 * 60 * 1000,
      extractTimestamp: (p: unknown) => (p as { ts?: number }).ts ?? null,
    });
    const futureTs = Date.now() + 10 * 60 * 1000;
    const body = JSON.stringify({ id: 'fx', type: 'test', ts: futureTs });

    const result = await receiver.receive(body, validHeaders('webhook-secret-123'));

    expect(result.accepted).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.reason).toContain('future');
  });

  it('accepts case-variant Authorization header', async () => {
    const store = createMockStore();
    const receiver = makeReceiver(store);
    const body = JSON.stringify({ id: 'a', type: 'test' });

    const result = await receiver.receive(body, { AUTHORIZATION: 'Bearer webhook-secret-123' });

    expect(result.accepted).toBe(true);
  });

  it('skips replay check when extractTimestamp returns 0 (sentinel for "no timestamp")', async () => {
    const store = createMockStore();
    const receiver = makeReceiver(store, {
      replayWindowMs: 5 * 60 * 1000,
      extractTimestamp: () => 0,
    });
    const body = JSON.stringify({ id: 'z', type: 'test' });

    const result = await receiver.receive(body, validHeaders('webhook-secret-123'));

    expect(result.accepted).toBe(true);
  });

  it('rejects batch exceeding maxEventsPerBatch with 413', async () => {
    const store = createMockStore();
    const receiver = new BaseWebhookReceiver(
      {
        source: 'clay',
        auth: new BearerTokenWebhookAuth('webhook-secret-123'),
        maxEventsPerBatch: 5,
        extractEvents: (p: unknown) => {
          const rows = (p as { rows: Array<{ id: string }> }).rows;
          return rows.map((r) => ({ eventId: r.id, eventType: 'row', payload: r }));
        },
      },
      store,
    );
    const body = JSON.stringify({ rows: Array.from({ length: 10 }, (_, i) => ({ id: `r${i}` })) });

    const result = await receiver.receive(body, validHeaders('webhook-secret-123'));

    expect(result.accepted).toBe(false);
    expect(result.statusCode).toBe(413);
    expect(result.reason).toContain('too large');
    expect(store.events).toHaveLength(0);
  });

  it('catches extractEvents exceptions and returns 400 rejected_parse', async () => {
    const store = createMockStore();
    const receiver = new BaseWebhookReceiver(
      {
        source: 'clay',
        auth: new BearerTokenWebhookAuth('webhook-secret-123'),
        extractEvents: () => { throw new Error('bad shape'); },
      },
      store,
    );
    const body = JSON.stringify({ anything: 1 });

    const result = await receiver.receive(body, validHeaders('webhook-secret-123'));

    expect(result.accepted).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.reason).toContain('Invalid JSON');
  });

  it('fans out multi-event payload via extractEvents', async () => {
    const store = createMockStore();
    const receiver = new BaseWebhookReceiver(
      {
        source: 'clay',
        auth: new BearerTokenWebhookAuth('webhook-secret-123'),
        extractEvents: (p: unknown) => {
          const rows = (p as { rows?: Array<{ id: string; data: unknown }> }).rows ?? [];
          return rows.map((r) => ({
            eventId: r.id,
            eventType: 'clay.row',
            payload: r,
          }));
        },
      },
      store,
    );
    const body = JSON.stringify({ rows: [
      { id: 'r1', data: { a: 1 } },
      { id: 'r2', data: { a: 2 } },
      { id: 'r1', data: { a: 1 } }, // duplicate within batch
    ] });

    const result = await receiver.receive(body, validHeaders('webhook-secret-123'));

    expect(result.accepted).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.events!.map((e) => e.providerEventId)).toEqual(['r1', 'r2']);
  });

  it('rate-limits excessive events with 429', async () => {
    const rateLimiter = new WebhookRateLimiter(2, 60_000); // only 2 per minute
    const store = createMockStore();
    const receiver = makeReceiver(store, { rateLimiter });
    const headers = validHeaders('webhook-secret-123');

    await receiver.receive(JSON.stringify({ type: 'a' }), headers);
    await receiver.receive(JSON.stringify({ type: 'b' }), headers);
    const result = await receiver.receive(JSON.stringify({ type: 'c' }), headers);

    expect(result.accepted).toBe(false);
    expect(result.statusCode).toBe(429);
    expect(store.events).toHaveLength(2); // only first 2 stored
  });
});

/* ------------------------------------------------------------------ */
/*  Rate Limiter Tests                                                 */
/* ------------------------------------------------------------------ */

describe('WebhookRateLimiter', () => {
  it('allows events within limit', () => {
    const limiter = new WebhookRateLimiter(3, 60_000);
    expect(limiter.allow('src')).toBe(true);
    expect(limiter.allow('src')).toBe(true);
    expect(limiter.allow('src')).toBe(true);
    expect(limiter.allow('src')).toBe(false);
  });

  it('tracks sources independently', () => {
    const limiter = new WebhookRateLimiter(1, 60_000);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('b')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
    expect(limiter.allow('b')).toBe(false);
  });

  it('reports count per source', () => {
    const limiter = new WebhookRateLimiter(10, 60_000);
    limiter.allow('x');
    limiter.allow('x');
    expect(limiter.count('x')).toBe(2);
    expect(limiter.count('y')).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Webhook Processor Tests                                            */
/* ------------------------------------------------------------------ */

describe('WebhookProcessor', () => {
  const makeEvent = (id: string, source: string, attempts = 0): WebhookEvent => ({
    id,
    source,
    eventType: 'test',
    providerEventId: `prov-${id}`,
    rawPayload: { data: 1 },
    status: 'processing',
    attemptCount: attempts,
    errorMessage: null,
    createdAtIso: new Date().toISOString(),
    processedAtIso: null,
  });

  it('processes events with registered handler', async () => {
    const event = makeEvent('e1', 'clay');
    const store = createMockProcessorStore([event]);
    const handler: WebhookHandler = { handle: vi.fn(async () => {}) };
    const processor = new WebhookProcessor(store, new Map([['clay', handler]]));

    const count = await processor.processBatch();

    expect(count).toBe(1);
    expect(handler.handle).toHaveBeenCalledWith(event);
    expect(store.completed).toContain('e1');
  });

  it('dead-letters events with no handler', async () => {
    const event = makeEvent('e2', 'unknown-source');
    const store = createMockProcessorStore([event]);
    const processor = new WebhookProcessor(store, new Map());

    await processor.processBatch();

    expect(store.deadLettered).toContain('e2');
  });

  it('marks event as failed when handler throws (under max retries)', async () => {
    const event = makeEvent('e3', 'clay', 0); // attempt 0, max is 3
    const store = createMockProcessorStore([event]);
    const handler: WebhookHandler = {
      handle: vi.fn(async () => { throw new Error('parse error'); }),
    };
    const processor = new WebhookProcessor(store, new Map([['clay', handler]]), { maxRetries: 3 });

    await processor.processBatch();

    expect(store.failed).toHaveLength(1);
    expect(store.failed[0]).toMatchObject({ id: 'e3', attempt: 1 });
    expect(store.deadLettered).toHaveLength(0);
  });

  it('dead-letters event after max retries exhausted (decision 2B: 4 total attempts)', async () => {
    // Decision 2B: maxRetries=3 means 4 total attempts; dead-letter on attempt 4
    const event = makeEvent('e4', 'clay', 3); // already had 3 attempts → next=4 > maxRetries=3 → dead-letter
    const store = createMockProcessorStore([event]);
    const handler: WebhookHandler = {
      handle: vi.fn(async () => { throw new Error('persistent error'); }),
    };
    const processor = new WebhookProcessor(store, new Map([['clay', handler]]), { maxRetries: 3 });

    await processor.processBatch();

    expect(store.deadLettered).toContain('e4');
    expect(store.failed).toHaveLength(0);
  });

  it('still retries on attempt 3 (the 3rd retry of maxRetries=3)', async () => {
    const event = makeEvent('e5', 'clay', 2); // attempt 2 → next=3 <= maxRetries=3 → retry
    const store = createMockProcessorStore([event]);
    const handler: WebhookHandler = {
      handle: vi.fn(async () => { throw new Error('still failing'); }),
    };
    const processor = new WebhookProcessor(store, new Map([['clay', handler]]), { maxRetries: 3 });

    await processor.processBatch();

    expect(store.failed).toHaveLength(1);
    expect(store.failed[0].attempt).toBe(3);
    expect(store.deadLettered).toHaveLength(0);
  });

  it('stores handler result metadata with the completed event', async () => {
    const event = makeEvent('e-result', 'clay');
    const store = createMockProcessorStore([event]);
    const handler: WebhookHandler = {
      handle: vi.fn(async () => ({
        meta: { candidateId: 'cand-42', syncRunId: 'run-9' },
        summary: 'upserted 1 candidate',
      })),
    };
    const processor = new WebhookProcessor(store, new Map([['clay', handler]]));

    await processor.processBatch();

    expect(store.completed).toContain('e-result');
    const completeCall = (store.markCompleted as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(completeCall[0]).toBe('e-result');
    expect(completeCall[1]).toMatchObject({
      meta: { candidateId: 'cand-42', syncRunId: 'run-9' },
      summary: 'upserted 1 candidate',
    });
  });

  it('returns 0 when no events to process', async () => {
    const store = createMockProcessorStore([]);
    const processor = new WebhookProcessor(store, new Map());

    const count = await processor.processBatch();
    expect(count).toBe(0);
  });
});
