import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchClaimedSend,
  HARDCODED_DEFAULT_CONTACT_WINDOW,
  type SmsDispatchContext,
  type CandidateRuntimeSnapshot,
} from '../sms-dispatch';
import type { SmsSend } from '../../contracts/sms-send';
import type { SmsTemplate } from '../../contracts/sms-template';
import type { SmsProvider } from '../../contracts/sms-provider';

function makeSend(overrides: Partial<SmsSend> = {}): SmsSend {
  return {
    id: 'send-1',
    tenantId: 't1',
    campaignId: null,
    candidateId: 'c1',
    templateId: 'tmpl-1',
    templateVersion: 1,
    renderedBody: null,
    renderedBodyHash: 'hash-1',
    contextParams: { first_name: 'Sam' },
    provider: null,
    providerMessageId: null,
    providerIdempotencyKey: null,
    status: 'queued',
    deliveryAttemptCount: 1,
    lastAttemptAt: '2026-04-27T15:00:00.000Z',
    scheduledFor: '2026-04-27T14:00:00.000Z',
    sentAt: null,
    contactWindowDeferredUntil: null,
    blockedReason: null,
    senderUserId: 'u-1',
    trackingToken: 'tok-1',
    trackingUrl: 'https://cbl.aero/t/tok-1',
    clickedAt: null,
    clickCount: 0,
    responseReceivedAt: null,
    responseBody: null,
    responseType: null,
    createdAt: '2026-04-27T13:00:00.000Z',
    ...overrides,
  };
}

function makeTemplate(overrides: Partial<SmsTemplate> = {}): SmsTemplate {
  return {
    id: 'tmpl-1',
    tenantId: 't1',
    agenda: 'new_opportunity',
    name: 'N',
    templateKey: 'new_opportunity_v1',
    body: 'Hi {{first_name}} — reply STOP',
    variables: ['first_name'],
    version: 1,
    status: 'active',
    createdBy: 'u-admin',
    updatedBy: 'u-admin',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

interface TestContext extends SmsDispatchContext {
  provider: SmsProvider & { _log: Array<{ to: string; body: string }> };
  statusUpdates: Array<Parameters<SmsDispatchContext['updateStatus']>[0]>;
  auditRows: Array<Parameters<SmsDispatchContext['writeAuditLog']>[0]>;
  funnelEvents: Record<string, unknown>[];
}

function buildContext(options: {
  candidate?: Partial<CandidateRuntimeSnapshot>;
  template?: SmsTemplate;
  providerStatus?: 'sent' | 'queued' | 'failed';
  providerError?: string;
  now?: Date;
}): TestContext {
  const providerLog: Array<{ to: string; body: string }> = [];
  const provider: SmsProvider & { _log: typeof providerLog } = {
    name: 'sms-stub',
    _log: providerLog,
    async send(req) {
      providerLog.push({ to: req.to, body: req.body });
      if (options.providerStatus === 'failed') {
        return {
          providerMessageId: '',
          status: 'failed',
          durationMs: 1,
          errorMessage: options.providerError ?? 'boom',
        };
      }
      return {
        providerMessageId: 'stub_abc123abc123',
        status: options.providerStatus ?? 'sent',
        durationMs: 1,
      };
    },
  };

  const statusUpdates: TestContext['statusUpdates'] = [];
  const auditRows: TestContext['auditRows'] = [];
  const funnelEvents: TestContext['funnelEvents'] = [];

  const candidate: CandidateRuntimeSnapshot = {
    phone: '+15551234567',
    smsOptedIn: true,
    contactWindows: HARDCODED_DEFAULT_CONTACT_WINDOW,
    ...options.candidate,
  };

  return {
    provider,
    defaultWindows: HARDCODED_DEFAULT_CONTACT_WINDOW,
    now: () => options.now ?? new Date('2026-04-27T15:00:00.000Z'),
    getCandidate: async () => candidate,
    getTemplate: async () => options.template ?? makeTemplate(),
    updateStatus: async (patch) => {
      statusUpdates.push(patch);
    },
    writeAuditLog: async (row) => {
      auditRows.push(row);
    },
    emitFunnelEvent: (payload) => {
      funnelEvents.push(payload);
    },
    statusUpdates,
    auditRows,
    funnelEvents,
  };
}

describe('dispatchClaimedSend', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path: renders body, calls provider, marks sent, writes audit, emits funnel event', async () => {
    const send = makeSend();
    const ctx = buildContext({});
    const result = await dispatchClaimedSend(send, ctx);

    expect(result.kind).toBe('sent');
    if (result.kind === 'sent') expect(result.providerMessageId).toBe('stub_abc123abc123');

    // Provider received rendered body (not raw template).
    expect(ctx.provider._log).toHaveLength(1);
    expect(ctx.provider._log[0].body).toBe('Hi Sam — reply STOP');

    // Status transition: sent + provider metadata.
    expect(ctx.statusUpdates).toHaveLength(1);
    expect(ctx.statusUpdates[0]).toMatchObject({
      id: 'send-1',
      status: 'sent',
      provider: 'sms-stub',
      providerMessageId: 'stub_abc123abc123',
    });

    // Audit log + funnel event emitted.
    expect(ctx.auditRows).toHaveLength(1);
    expect(ctx.auditRows[0].deliveryStatus).toBe('sent');
    expect(ctx.funnelEvents).toHaveLength(1);
    expect(ctx.funnelEvents[0].event_type).toBe('outreach.message.sent');
    const payload = (ctx.funnelEvents[0].payload as Record<string, unknown>);
    expect(payload.channel).toBe('sms');
    expect(payload.template_version).toBe(1);
  });

  it('funnel event carries the provider_message_id and template_version', async () => {
    const ctx = buildContext({});
    await dispatchClaimedSend(makeSend(), ctx);
    const event = ctx.funnelEvents[0];
    expect(event).toMatchObject({
      event_type: 'outreach.message.sent',
      schema_version: '1.0.0',
      tenant_id: 't1',
    });
    expect((event.payload as Record<string, unknown>).provider_message_id).toBe('stub_abc123abc123');
  });

  it('funnel event envelope includes all AC 9 fields (review patch F2)', async () => {
    const ctx = buildContext({});
    await dispatchClaimedSend(makeSend(), ctx);
    const event = ctx.funnelEvents[0];
    // AC 9 envelope: event_id, event_type, occurred_at, tenant_id, actor_id,
    // trace_id, span_id, parent_span_id, payload, schema_version.
    expect(Object.keys(event).sort()).toEqual(
      [
        'actor_id',
        'event_id',
        'event_type',
        'occurred_at',
        'parent_span_id',
        'payload',
        'schema_version',
        'span_id',
        'tenant_id',
        'trace_id',
      ].sort(),
    );
    expect(event.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(event.trace_id).toBeNull();
    expect(event.span_id).toBeNull();
    expect(event.parent_span_id).toBeNull();
  });

  it('each dispatch generates a unique event_id (not a static constant)', async () => {
    const ctx = buildContext({});
    await dispatchClaimedSend(makeSend({ id: 'send-1' }), ctx);
    await dispatchClaimedSend(makeSend({ id: 'send-2' }), ctx);
    const [a, b] = ctx.funnelEvents;
    expect(a.event_id).not.toBe(b.event_id);
  });

  it('review patch F7: ctx.eventId hook overrides randomUUID — supports Task 8 snapshot fixture', async () => {
    const ctx = buildContext({});
    let mintedCount = 0;
    ctx.eventId = () => {
      mintedCount += 1;
      return `evt-test-${mintedCount}`;
    };
    await dispatchClaimedSend(makeSend({ id: 'send-A' }), ctx);
    await dispatchClaimedSend(makeSend({ id: 'send-B' }), ctx);
    expect(mintedCount).toBe(2);
    expect(ctx.funnelEvents[0].event_id).toBe('evt-test-1');
    expect(ctx.funnelEvents[1].event_id).toBe('evt-test-2');
  });

  it('opt-out at dequeue: transitions to blocked_opt_out, writes audit, does NOT call provider', async () => {
    const ctx = buildContext({ candidate: { smsOptedIn: false } });
    const result = await dispatchClaimedSend(makeSend(), ctx);

    expect(result.kind).toBe('blocked_opt_out');
    expect(ctx.provider._log).toHaveLength(0);
    expect(ctx.statusUpdates[0]).toMatchObject({
      status: 'blocked_opt_out',
      blockedReason: 'opt_out_at_dequeue',
    });
    expect(ctx.auditRows[0].deliveryStatus).toBe('blocked_opt_out');
    expect(ctx.funnelEvents).toHaveLength(0);
  });

  it('contact-window drift: out-of-window now → deferred_window with future deferUntil', async () => {
    // Saturday 10:00 CDT — outside Mon-Fri default window.
    const ctx = buildContext({ now: new Date('2026-05-02T15:00:00.000Z') });
    const result = await dispatchClaimedSend(makeSend(), ctx);

    expect(result.kind).toBe('deferred_window');
    if (result.kind === 'deferred_window') {
      // Should be Mon 2026-05-04 08:00 CDT = 13:00 UTC
      expect(result.deferUntil).toBe('2026-05-04T13:00:00.000Z');
    }
    expect(ctx.provider._log).toHaveLength(0);
    expect(ctx.statusUpdates[0]).toMatchObject({
      status: 'deferred_window',
      contactWindowDeferredUntil: '2026-05-04T13:00:00.000Z',
    });
  });

  it('missing phone: transitions to failed with blocked_reason=missing_phone', async () => {
    const ctx = buildContext({ candidate: { phone: null } });
    const result = await dispatchClaimedSend(makeSend(), ctx);

    expect(result.kind).toBe('skipped_missing_phone');
    expect(ctx.provider._log).toHaveLength(0);
    expect(ctx.statusUpdates[0]).toMatchObject({
      status: 'failed',
      blockedReason: 'missing_phone',
    });
  });

  it('template render overflow → failed + render_error in blocked_reason', async () => {
    const oversized = makeTemplate({ body: 'x'.repeat(2000) });
    const ctx = buildContext({ template: oversized });
    const result = await dispatchClaimedSend(makeSend(), ctx);

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') expect(result.errorMessage).toMatch(/exceeds/);
    expect(ctx.statusUpdates[0].blockedReason).toMatch(/render_error/);
  });

  it('provider-level failure: transitions to failed with provider error message', async () => {
    const ctx = buildContext({ providerStatus: 'failed', providerError: 'upstream-500' });
    const result = await dispatchClaimedSend(makeSend(), ctx);

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') expect(result.errorMessage).toBe('upstream-500');
    expect(ctx.statusUpdates[0]).toMatchObject({
      status: 'failed',
      blockedReason: 'upstream-500',
    });
    // Audit row written for the failure path.
    expect(ctx.auditRows[0].deliveryStatus).toBe('failed');
    // No funnel event on failure (Epic 10 consumers only count sent events).
    expect(ctx.funnelEvents).toHaveLength(0);
  });

  it('uses the stored provider_idempotency_key when set', async () => {
    const send = makeSend({ providerIdempotencyKey: 'pre-computed-key' });
    let receivedKey = '';
    const ctx = buildContext({});
    ctx.provider.send = async (req) => {
      receivedKey = req.idempotencyKey;
      return { providerMessageId: 'stub_x', status: 'sent', durationMs: 1 };
    };
    await dispatchClaimedSend(send, ctx);
    expect(receivedKey).toBe('pre-computed-key');
  });

  it('computes an idempotency key when none is stored on the send row', async () => {
    const send = makeSend({ providerIdempotencyKey: null });
    let receivedKey = '';
    const ctx = buildContext({});
    ctx.provider.send = async (req) => {
      receivedKey = req.idempotencyKey;
      return { providerMessageId: 'stub_x', status: 'sent', durationMs: 1 };
    };
    await dispatchClaimedSend(send, ctx);
    expect(receivedKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it('falls back to default window when candidate has null contactWindows', async () => {
    // Sun 21:00 CDT (outside default Mon-Fri window → deferred)
    const ctx = buildContext({
      now: new Date('2026-05-04T02:00:00.000Z'),
      candidate: { contactWindows: null },
    });
    const result = await dispatchClaimedSend(makeSend(), ctx);
    expect(result.kind).toBe('deferred_window');
  });

  it('uses candidate-provided contactWindows when present', async () => {
    // UTC Mon 10:00 — inside candidate's 09-18 UTC window, outside Chicago default.
    const ctx = buildContext({
      now: new Date('2026-04-27T10:00:00.000Z'),
      candidate: {
        contactWindows: {
          timezone: 'UTC',
          windows: [{ day: 'mon', start: '09:00', end: '18:00' }],
        },
      },
    });
    const result = await dispatchClaimedSend(makeSend(), ctx);
    expect(result.kind).toBe('sent');
  });

  it('audit log carries trace_id and correlation_id as null when not provided', async () => {
    const ctx = buildContext({});
    await dispatchClaimedSend(makeSend(), ctx);
    expect(ctx.auditRows[0].traceId).toBeNull();
    expect(ctx.auditRows[0].correlationId).toBeNull();
  });

  it('audit log deliveryStatus matches final sms_sends status', async () => {
    const ctx = buildContext({});
    await dispatchClaimedSend(makeSend(), ctx);
    expect(ctx.auditRows[0].deliveryStatus).toBe('sent');
  });

  it('carries costMeta to the provider for cost accounting', async () => {
    let costMeta: Record<string, unknown> | undefined;
    const ctx = buildContext({});
    ctx.provider.send = async (req) => {
      costMeta = req.costMeta;
      return { providerMessageId: 'stub_x', status: 'sent', durationMs: 1 };
    };
    await dispatchClaimedSend(makeSend(), ctx);
    expect(costMeta).toMatchObject({
      tenant_id: 't1',
      template_id: 'tmpl-1',
      template_version: 1,
    });
  });

  it('opt-out write includes content_hash from the send row', async () => {
    const ctx = buildContext({ candidate: { smsOptedIn: false } });
    await dispatchClaimedSend(makeSend({ renderedBodyHash: 'hash-xyz' }), ctx);
    expect(ctx.auditRows[0].contentHash).toBe('hash-xyz');
  });

  it('compliance flag is false on opt-out path, true on sent path', async () => {
    const optedOutCtx = buildContext({ candidate: { smsOptedIn: false } });
    await dispatchClaimedSend(makeSend(), optedOutCtx);
    expect(optedOutCtx.auditRows[0].compliancePassed).toBe(false);

    const sentCtx = buildContext({});
    await dispatchClaimedSend(makeSend(), sentCtx);
    expect(sentCtx.auditRows[0].compliancePassed).toBe(true);
  });

  it('two consecutive dispatches for the same send+day produce the same idempotency key', async () => {
    const keys: string[] = [];
    const ctx = buildContext({});
    ctx.provider.send = async (req) => {
      keys.push(req.idempotencyKey);
      return { providerMessageId: 'stub_x', status: 'sent', durationMs: 1 };
    };
    const send = makeSend({ providerIdempotencyKey: null });
    await dispatchClaimedSend(send, ctx);
    await dispatchClaimedSend(send, ctx);
    expect(keys[0]).toBe(keys[1]);
  });

  it('does NOT emit a funnel event when provider returns failed', async () => {
    const ctx = buildContext({ providerStatus: 'failed', providerError: 'x' });
    await dispatchClaimedSend(makeSend(), ctx);
    expect(ctx.funnelEvents).toHaveLength(0);
  });

  it('does NOT invoke provider when opt-out detected at dequeue', async () => {
    const ctx = buildContext({ candidate: { smsOptedIn: false } });
    await dispatchClaimedSend(makeSend(), ctx);
    expect(ctx.provider._log).toHaveLength(0);
  });

  it('does NOT invoke provider when contact-window drift puts now outside window', async () => {
    const ctx = buildContext({ now: new Date('2026-05-02T15:00:00.000Z') }); // Sat
    await dispatchClaimedSend(makeSend(), ctx);
    expect(ctx.provider._log).toHaveLength(0);
  });

  it('does NOT invoke provider when candidate has no phone', async () => {
    const ctx = buildContext({ candidate: { phone: null } });
    await dispatchClaimedSend(makeSend(), ctx);
    expect(ctx.provider._log).toHaveLength(0);
  });

  it('does NOT invoke provider when template render overflows', async () => {
    const oversized = makeTemplate({ body: 'x'.repeat(2000) });
    const ctx = buildContext({ template: oversized });
    await dispatchClaimedSend(makeSend(), ctx);
    expect(ctx.provider._log).toHaveLength(0);
  });
});
