import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseProviderClient } from '../providers/base-client';
import { BaseWebhookReceiver, type WebhookEventStore } from '../providers/webhook-receiver';
import { WebhookProcessor, type WebhookProcessorStore } from '../providers/webhook-processor';
import { ProviderRegistry } from '../providers/registry';
import { BearerTokenAuth } from '../providers/auth/bearer-token';
import { BearerTokenWebhookAuth } from '../providers/webhook-auth';
import type { WebhookEvent, ProviderHealthEvent, WebhookHandler } from '../providers/types';

/* ------------------------------------------------------------------ */
/*  Integration Test: Outbound call → retry → health update → kill switch */
/* ------------------------------------------------------------------ */

describe('Integration: outbound → retry → health → kill switch', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('full lifecycle: calls, retries, health degrades, kill switch fires', async () => {
    const registry = new ProviderRegistry();
    const healthEvents: ProviderHealthEvent[] = [];
    registry.onHealthEvent = (e) => healthEvents.push(e);

    // Register provider
    const client = new BaseProviderClient({
      name: 'test-api',
      baseUrl: 'https://api.test.com',
      auth: new BearerTokenAuth('token'),
      maxRetries: 0,
      backoffMs: 1,
    });
    registry.register('test-api', client);

    // Phase 1: A few successful calls
    fetchSpy = vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);

    for (let i = 0; i < 10; i++) {
      const result = await client.get('/ok');
      expect(result.ok).toBe(true);
    }
    expect(registry.getMode('test-api')).toBe('normal');

    // Phase 2: Provider starts failing → degraded
    fetchSpy = vi.fn(async () => new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);

    // Push error rate above 30% (need ~5 failures to get 5/15 ≈ 33%)
    for (let i = 0; i < 5; i++) {
      await client.get('/fail');
    }
    // 10 success + 5 failures = 33% error rate
    expect(registry.getMode('test-api')).toBe('degraded');

    // Phase 3: Continued failures → kill switch at 80% / 50 attempts
    for (let i = 0; i < 35; i++) {
      await client.get('/fail');
    }
    // Now: 10 success + 40 failures = 50 attempts, 80% error rate
    expect(registry.getMode('test-api')).toBe('kill_switched');
    expect(registry.isAvailable('test-api')).toBe(false);

    // Verify kill switch event was emitted
    const killEvent = healthEvents.find((e) => e.newMode === 'kill_switched');
    expect(killEvent).toBeDefined();
    expect(killEvent!.provider).toBe('test-api');

    // Phase 4: Manual recovery
    registry.setMode('test-api', 'normal', 'Ops approved recovery');
    expect(registry.getMode('test-api')).toBe('normal');

    registry.clearForTest();
  });
});

/* ------------------------------------------------------------------ */
/*  Integration Test: Webhook receive → validate → dedup → store → process → complete */
/* ------------------------------------------------------------------ */

describe('Integration: webhook receive → validate → dedup → store → process → complete', () => {
  it('full webhook lifecycle: receive → store → process → complete', async () => {
    // In-memory stores (new TOCTOU-safe interface)
    const events: WebhookEvent[] = [];
    const receiverStore: WebhookEventStore = {
      insertIfNotDuplicate: async (event) => {
        if (event.providerEventId && events.some((e) => e.providerEventId === event.providerEventId)) {
          return false;
        }
        events.push(event);
        return true;
      },
    };

    // Set up receiver
    const receiver = new BaseWebhookReceiver(
      {
        source: 'clay',
        auth: new BearerTokenWebhookAuth('clay-secret'),
        extractEventId: (p: unknown) => (p as { id?: string }).id ?? null,
        extractEventType: (p: unknown) => (p as { type?: string }).type ?? 'enrichment',
        rateLimitMax: 100,
        rateLimitWindowMs: 60_000,
      },
      receiverStore,
    );

    // Step 1: Receive valid webhook
    const payload = JSON.stringify({
      id: 'clay-evt-001',
      type: 'enrichment.completed',
      data: { candidate: 'John Doe' },
    });
    const result = await receiver.receive(payload, {
      Authorization: 'Bearer clay-secret',
    });

    expect(result.accepted).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('pending');
    expect(events[0].providerEventId).toBe('clay-evt-001');

    // Step 2: Receive duplicate → should be skipped
    const dupResult = await receiver.receive(payload, {
      Authorization: 'Bearer clay-secret',
    });
    expect(dupResult.accepted).toBe(false);
    expect(dupResult.statusCode).toBe(200); // 200 so provider doesn't retry
    expect(dupResult.reason).toContain('Duplicate');
    expect(events).toHaveLength(1); // no new event stored

    // Step 3: Process the event
    const processed: string[] = [];
    const processorStore: WebhookProcessorStore = {
      claimBatch: async (batchSize) => {
        const batch = events.filter((e) => e.status === 'pending').slice(0, batchSize);
        batch.forEach((e) => { e.status = 'processing'; });
        return batch;
      },
      markCompleted: async (id) => {
        const e = events.find((ev) => ev.id === id);
        if (e) { e.status = 'completed'; e.processedAtIso = new Date().toISOString(); }
        processed.push(id);
      },
      markFailed: async (id, _error, attempt) => {
        const e = events.find((ev) => ev.id === id);
        if (e) { e.status = 'failed'; e.attemptCount = attempt; }
      },
      markDeadLetter: async (id, error) => {
        const e = events.find((ev) => ev.id === id);
        if (e) { e.status = 'dead_letter'; e.errorMessage = error; }
      },
    };

    const handler: WebhookHandler = {
      handle: vi.fn(async (event: WebhookEvent) => {
        // Simulate processing
        expect(event.providerEventId).toBe('clay-evt-001');
      }),
    };

    const processor = new WebhookProcessor(
      processorStore,
      new Map([['clay', handler]]),
    );

    const count = await processor.processBatch();
    expect(count).toBe(1);
    expect(handler.handle).toHaveBeenCalledOnce();
    expect(events[0].status).toBe('completed');
    expect(events[0].processedAtIso).toBeTruthy();
  });

  it('webhook dead-letter lifecycle: receive → fail × 4 → dead letter (decision 2B)', async () => {
    const events: WebhookEvent[] = [];
    const receiverStore: WebhookEventStore = {
      insertIfNotDuplicate: async (event) => { events.push(event); return true; },
    };

    const receiver = new BaseWebhookReceiver(
      {
        source: 'telnyx',
        auth: new BearerTokenWebhookAuth('telnyx-secret'),
        extractEventId: (p: unknown) => (p as { id?: string }).id ?? null,
        extractEventType: () => 'sms.delivered',
      },
      receiverStore,
    );

    // Receive event
    await receiver.receive(
      JSON.stringify({ id: 'tel-001', type: 'sms.delivered' }),
      { Authorization: 'Bearer telnyx-secret' },
    );

    // Processor with failing handler
    const processorStore: WebhookProcessorStore = {
      claimBatch: async (batchSize) => {
        const batch = events.filter((e) => e.status === 'pending' || e.status === 'failed').slice(0, batchSize);
        batch.forEach((e) => { e.status = 'processing'; });
        return batch;
      },
      markCompleted: async (id) => {
        const e = events.find((ev) => ev.id === id);
        if (e) e.status = 'completed';
      },
      markFailed: async (id, error, attempt) => {
        const e = events.find((ev) => ev.id === id);
        if (e) { e.status = 'failed'; e.attemptCount = attempt; e.errorMessage = error; }
      },
      markDeadLetter: async (id, error) => {
        const e = events.find((ev) => ev.id === id);
        if (e) { e.status = 'dead_letter'; e.errorMessage = error; }
      },
    };

    const failingHandler: WebhookHandler = {
      handle: async () => { throw new Error('Processing failed'); },
    };

    const processor = new WebhookProcessor(
      processorStore,
      new Map([['telnyx', failingHandler]]),
      { maxRetries: 3 },
    );

    // Decision 2B: maxRetries=3 → 4 total attempts before dead-letter
    // Attempt 1 (initial) → failed (0 → 1)
    await processor.processBatch();
    expect(events[0].status).toBe('failed');
    expect(events[0].attemptCount).toBe(1);

    // Attempt 2 → failed (1 → 2)
    await processor.processBatch();
    expect(events[0].status).toBe('failed');
    expect(events[0].attemptCount).toBe(2);

    // Attempt 3 → failed (2 → 3)
    await processor.processBatch();
    expect(events[0].status).toBe('failed');
    expect(events[0].attemptCount).toBe(3);

    // Attempt 4 → dead_letter (3 → 4 > maxRetries=3)
    await processor.processBatch();
    expect(events[0].status).toBe('dead_letter');
    expect(events[0].errorMessage).toContain('Processing failed');
  });
});
