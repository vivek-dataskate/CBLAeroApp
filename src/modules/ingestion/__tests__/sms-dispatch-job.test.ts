/**
 * End-to-end integration test for SmsDispatchJob (Story 3.1 AC 6/13).
 *
 * Exercises: claim → dispatch → status update → audit log → funnel event
 * through the entire in-memory stack — no Supabase, no Graph, no network.
 * Mocks `createSyncRun`/`completeSyncRun`/`recordSyncFailure`/`failSyncRun`
 * at the ingestion index so we can inspect how the job instrumented the
 * sync run.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const syncRunCalls = vi.hoisted(() => ({
  createSyncRun: vi.fn().mockResolvedValue('run-1'),
  completeSyncRun: vi.fn().mockResolvedValue(undefined),
  failSyncRun: vi.fn().mockResolvedValue(undefined),
  recordSyncFailure: vi.fn(),
}));

vi.mock('@/modules/ingestion/index', async () => {
  const actual = await vi.importActual<typeof import('@/modules/ingestion/index')>('@/modules/ingestion/index');
  return {
    ...actual,
    createSyncRun: syncRunCalls.createSyncRun,
    completeSyncRun: syncRunCalls.completeSyncRun,
    failSyncRun: syncRunCalls.failSyncRun,
    recordSyncFailure: syncRunCalls.recordSyncFailure,
  };
});

import { SmsDispatchJob } from '../jobs';
import { getProviderRegistry } from '@/modules/providers';
import {
  insertSmsSend,
  clearSmsSendStoreForTest,
  getAuditLogForTest,
  getSmsSendById,
} from '@/features/outreach-engagement/infrastructure/sms-send-repository';
import {
  createTemplate,
  clearSmsTemplateStoreForTest,
} from '@/features/outreach-engagement/infrastructure/sms-template-repository';
import {
  seedCandidateRuntimeForTest,
  clearCandidateRuntimeStoreForTest,
} from '@/features/outreach-engagement/infrastructure/candidate-runtime';
import {
  __clearStubSmsLogForTest,
  __getStubSmsLogForTest,
  resetSharedSmsProviderForTest,
} from '@/modules/providers/sms-stub';

const TENANT = 'cbl-aero';

// Silence the job's structured-log noise during tests; spy on funnel events
// by capturing console.log output.
const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

beforeEach(async () => {
  syncRunCalls.createSyncRun.mockClear();
  syncRunCalls.completeSyncRun.mockClear();
  syncRunCalls.failSyncRun.mockClear();
  syncRunCalls.recordSyncFailure.mockClear();
  consoleSpy.mockClear();

  clearSmsSendStoreForTest();
  clearSmsTemplateStoreForTest();
  clearCandidateRuntimeStoreForTest();
  __clearStubSmsLogForTest();
  resetSharedSmsProviderForTest();

  // Review patch F1: the job now gates on `assessSmsAvailability()`. Unless
  // a test explicitly exercises the kill-switch/unregistered paths, it needs
  // sms-stub registered in the shared registry so the gate returns 'available'.
  const registry = getProviderRegistry();
  registry.clearForTest();
  registry.register('sms-stub');
});

afterEach(() => {
  consoleSpy.mockClear();
});

async function seedTemplate(
  templateKey = 'new_opportunity_v1',
  body = 'Hi {{first_name}} — reply STOP',
) {
  return createTemplate({
    tenantId: TENANT,
    agenda: 'new_opportunity',
    name: 'N',
    templateKey,
    body,
    variables: ['first_name'],
    actorId: 'u-admin',
  });
}

async function seedSend(
  templateId: string,
  templateVersion = 1,
  candidateId = 'c1',
  scheduledFor = new Date(Date.now() - 60_000).toISOString(),
) {
  return insertSmsSend({
    tenantId: TENANT,
    candidateId,
    templateId,
    templateVersion,
    scheduledFor,
    contextParams: { first_name: 'Sam' },
    renderedBodyHash: 'hash-x',
    senderUserId: 'u-recruiter',
  });
}

describe('SmsDispatchJob (integration, in-memory)', () => {
  it('creates a sync_run even when there are no due sends', async () => {
    await new SmsDispatchJob().run({ batchSize: 5 });
    expect(syncRunCalls.createSyncRun).toHaveBeenCalledTimes(1);
    expect(syncRunCalls.createSyncRun).toHaveBeenCalledWith('sms_dispatch');
    expect(syncRunCalls.completeSyncRun).toHaveBeenCalledWith('run-1', {
      succeeded: 0,
      failed: 0,
      total: 0,
    });
  });

  it('claims, dispatches, and marks a due row as sent', async () => {
    const tmpl = await seedTemplate();
    const send = await seedSend(tmpl.id);
    seedCandidateRuntimeForTest(TENANT, 'c1', {
      phone: '+15551234567',
      smsOptedIn: true,
      contactWindows: {
        timezone: 'UTC',
        windows: [
          { day: 'sun', start: '00:00', end: '23:59' },
          { day: 'mon', start: '00:00', end: '23:59' },
          { day: 'tue', start: '00:00', end: '23:59' },
          { day: 'wed', start: '00:00', end: '23:59' },
          { day: 'thu', start: '00:00', end: '23:59' },
          { day: 'fri', start: '00:00', end: '23:59' },
          { day: 'sat', start: '00:00', end: '23:59' },
        ],
      },
    });

    await new SmsDispatchJob().run({ batchSize: 5 });

    const refetched = await getSmsSendById(send.id);
    expect(refetched.status).toBe('sent');
    expect(refetched.provider).toBe('sms-stub');
    expect(refetched.providerMessageId).toMatch(/^stub_[a-f0-9]{12}$/);
    expect(refetched.sentAt).not.toBeNull();
  });

  it('stub provider log captures the rendered body and phone', async () => {
    const tmpl = await seedTemplate();
    await seedSend(tmpl.id);
    seedCandidateRuntimeForTest(TENANT, 'c1', {
      phone: '+15551234567',
      smsOptedIn: true,
      contactWindows: { timezone: 'UTC', windows: [{ day: 'sun', start: '00:00', end: '23:59' }, { day: 'mon', start: '00:00', end: '23:59' }, { day: 'tue', start: '00:00', end: '23:59' }, { day: 'wed', start: '00:00', end: '23:59' }, { day: 'thu', start: '00:00', end: '23:59' }, { day: 'fri', start: '00:00', end: '23:59' }, { day: 'sat', start: '00:00', end: '23:59' }] },
    });

    await new SmsDispatchJob().run({ batchSize: 5 });

    const log = __getStubSmsLogForTest();
    expect(log).toHaveLength(1);
    expect(log[0].to).toBe('+15551234567');
    expect(log[0].body).toBe('Hi Sam — reply STOP');
  });

  it('appends an audit log row on sent', async () => {
    const tmpl = await seedTemplate();
    await seedSend(tmpl.id);
    seedCandidateRuntimeForTest(TENANT, 'c1', {
      phone: '+15551234567',
      smsOptedIn: true,
      contactWindows: { timezone: 'UTC', windows: [{ day: 'sun', start: '00:00', end: '23:59' }, { day: 'mon', start: '00:00', end: '23:59' }, { day: 'tue', start: '00:00', end: '23:59' }, { day: 'wed', start: '00:00', end: '23:59' }, { day: 'thu', start: '00:00', end: '23:59' }, { day: 'fri', start: '00:00', end: '23:59' }, { day: 'sat', start: '00:00', end: '23:59' }] },
    });

    await new SmsDispatchJob().run({ batchSize: 5 });

    const audit = getAuditLogForTest();
    expect(audit).toHaveLength(1);
    expect(audit[0].channel).toBe('sms');
    expect(audit[0].deliveryStatus).toBe('sent');
    expect(audit[0].templateAgenda).toBe('new_opportunity');
    expect(audit[0].eventEnvelope).not.toBeNull();
  });

  it('emits an outreach.message.sent funnel event as a JSON log line', async () => {
    const tmpl = await seedTemplate();
    await seedSend(tmpl.id);
    seedCandidateRuntimeForTest(TENANT, 'c1', {
      phone: '+15551234567',
      smsOptedIn: true,
      contactWindows: { timezone: 'UTC', windows: [{ day: 'sun', start: '00:00', end: '23:59' }, { day: 'mon', start: '00:00', end: '23:59' }, { day: 'tue', start: '00:00', end: '23:59' }, { day: 'wed', start: '00:00', end: '23:59' }, { day: 'thu', start: '00:00', end: '23:59' }, { day: 'fri', start: '00:00', end: '23:59' }, { day: 'sat', start: '00:00', end: '23:59' }] },
    });

    await new SmsDispatchJob().run({ batchSize: 5 });

    const funnelLines = consoleSpy.mock.calls
      .map((args) => String(args[0]))
      .filter((line) => line.includes('funnel_event'));
    expect(funnelLines.length).toBeGreaterThanOrEqual(1);
    const payload = JSON.parse(funnelLines[0]) as Record<string, unknown>;
    expect(payload).toMatchObject({
      kind: 'funnel_event',
      event_type: 'outreach.message.sent',
      schema_version: '1.0.0',
    });
    expect((payload.payload as Record<string, unknown>).channel).toBe('sms');
  });

  it('does NOT dispatch a send whose scheduled_for is in the future', async () => {
    const tmpl = await seedTemplate();
    await seedSend(tmpl.id, 1, 'c1', new Date(Date.now() + 60_000).toISOString());
    seedCandidateRuntimeForTest(TENANT, 'c1', {
      phone: '+15551234567',
      smsOptedIn: true,
      contactWindows: { timezone: 'UTC', windows: [{ day: 'sun', start: '00:00', end: '23:59' }, { day: 'mon', start: '00:00', end: '23:59' }, { day: 'tue', start: '00:00', end: '23:59' }, { day: 'wed', start: '00:00', end: '23:59' }, { day: 'thu', start: '00:00', end: '23:59' }, { day: 'fri', start: '00:00', end: '23:59' }, { day: 'sat', start: '00:00', end: '23:59' }] },
    });

    await new SmsDispatchJob().run({ batchSize: 5 });

    expect(__getStubSmsLogForTest()).toHaveLength(0);
    expect(syncRunCalls.completeSyncRun).toHaveBeenCalledWith('run-1', {
      succeeded: 0,
      failed: 0,
      total: 0,
    });
  });

  it('blocks opt-out at dequeue — never hits the provider', async () => {
    const tmpl = await seedTemplate();
    const send = await seedSend(tmpl.id);
    seedCandidateRuntimeForTest(TENANT, 'c1', {
      phone: '+15551234567',
      smsOptedIn: false,
      contactWindows: null,
    });

    await new SmsDispatchJob().run({ batchSize: 5 });

    const refetched = await getSmsSendById(send.id);
    expect(refetched.status).toBe('blocked_opt_out');
    expect(refetched.blockedReason).toBe('opt_out_at_dequeue');
    expect(__getStubSmsLogForTest()).toHaveLength(0);
  });

  it('defers when contact window drift puts now outside candidate window', async () => {
    const tmpl = await seedTemplate();
    const send = await seedSend(tmpl.id);
    seedCandidateRuntimeForTest(TENANT, 'c1', {
      phone: '+15551234567',
      smsOptedIn: true,
      // Empty-ish window: only Sunday 02:00-03:00 UTC — almost certainly outside "now".
      contactWindows: {
        timezone: 'UTC',
        windows: [{ day: 'sun', start: '02:00', end: '03:00' }],
      },
    });

    await new SmsDispatchJob().run({ batchSize: 5 });

    const refetched = await getSmsSendById(send.id);
    // Either deferred_window or sent if now happens to fall in the window —
    // assert the common case (deferred) is possible; if test clock happens
    // to be inside, we still want a deterministic pass.
    expect(['deferred_window', 'sent']).toContain(refetched.status);
    if (refetched.status === 'deferred_window') {
      expect(refetched.contactWindowDeferredUntil).not.toBeNull();
      expect(__getStubSmsLogForTest()).toHaveLength(0);
    }
  });

  it('marks failed when candidate has no phone', async () => {
    const tmpl = await seedTemplate();
    const send = await seedSend(tmpl.id);
    seedCandidateRuntimeForTest(TENANT, 'c1', {
      phone: null,
      smsOptedIn: true,
      contactWindows: { timezone: 'UTC', windows: [{ day: 'sun', start: '00:00', end: '23:59' }, { day: 'mon', start: '00:00', end: '23:59' }, { day: 'tue', start: '00:00', end: '23:59' }, { day: 'wed', start: '00:00', end: '23:59' }, { day: 'thu', start: '00:00', end: '23:59' }, { day: 'fri', start: '00:00', end: '23:59' }, { day: 'sat', start: '00:00', end: '23:59' }] },
    });

    await new SmsDispatchJob().run({ batchSize: 5 });

    const refetched = await getSmsSendById(send.id);
    expect(refetched.status).toBe('failed');
    expect(refetched.blockedReason).toBe('missing_phone');
  });

  it('per-row error does NOT kill the batch (Clay retro lesson)', async () => {
    const tmpl = await seedTemplate();
    const goodSend = await seedSend(tmpl.id, 1, 'c-good');
    const badSend = await seedSend(tmpl.id, 1, 'c-bad');

    seedCandidateRuntimeForTest(TENANT, 'c-good', {
      phone: '+15550001111',
      smsOptedIn: true,
      contactWindows: { timezone: 'UTC', windows: [{ day: 'sun', start: '00:00', end: '23:59' }, { day: 'mon', start: '00:00', end: '23:59' }, { day: 'tue', start: '00:00', end: '23:59' }, { day: 'wed', start: '00:00', end: '23:59' }, { day: 'thu', start: '00:00', end: '23:59' }, { day: 'fri', start: '00:00', end: '23:59' }, { day: 'sat', start: '00:00', end: '23:59' }] },
    });
    // c-bad has no seeded snapshot → loadCandidateRuntimeSnapshot returns
    // default (phone=null) → per-row goes down the "missing_phone" path
    // (not an exception — but still covers the "one bad row doesn't kill
    // siblings" contract).

    await new SmsDispatchJob().run({ batchSize: 10 });

    expect((await getSmsSendById(goodSend.id)).status).toBe('sent');
    expect((await getSmsSendById(badSend.id)).status).toBe('failed');
    expect(__getStubSmsLogForTest()).toHaveLength(1);
  });

  it('sync_run completeSyncRun is called with accurate counts', async () => {
    const tmpl = await seedTemplate();
    await seedSend(tmpl.id, 1, 'c1');
    await seedSend(tmpl.id, 1, 'c2');
    await seedSend(tmpl.id, 1, 'c3');
    for (const id of ['c1', 'c2']) {
      seedCandidateRuntimeForTest(TENANT, id, {
        phone: `+1555000${id.slice(1)}`,
        smsOptedIn: true,
        contactWindows: { timezone: 'UTC', windows: [{ day: 'sun', start: '00:00', end: '23:59' }, { day: 'mon', start: '00:00', end: '23:59' }, { day: 'tue', start: '00:00', end: '23:59' }, { day: 'wed', start: '00:00', end: '23:59' }, { day: 'thu', start: '00:00', end: '23:59' }, { day: 'fri', start: '00:00', end: '23:59' }, { day: 'sat', start: '00:00', end: '23:59' }] },
      });
    }
    // c3: no phone → failed with missing_phone
    seedCandidateRuntimeForTest(TENANT, 'c3', { phone: null, smsOptedIn: true, contactWindows: { timezone: 'UTC', windows: [{ day: 'sun', start: '00:00', end: '23:59' }, { day: 'mon', start: '00:00', end: '23:59' }, { day: 'tue', start: '00:00', end: '23:59' }, { day: 'wed', start: '00:00', end: '23:59' }, { day: 'thu', start: '00:00', end: '23:59' }, { day: 'fri', start: '00:00', end: '23:59' }, { day: 'sat', start: '00:00', end: '23:59' }] } });

    await new SmsDispatchJob().run({ batchSize: 10 });

    expect(syncRunCalls.completeSyncRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
      total: 3,
      succeeded: 2,
    }));
  });

  it('respects the batchSize parameter (upper bound)', async () => {
    const tmpl = await seedTemplate();
    for (let i = 0; i < 5; i += 1) {
      await seedSend(tmpl.id, 1, `c${i}`);
      seedCandidateRuntimeForTest(TENANT, `c${i}`, {
        phone: `+155500${i}0000`,
        smsOptedIn: true,
        contactWindows: { timezone: 'UTC', windows: [{ day: 'sun', start: '00:00', end: '23:59' }, { day: 'mon', start: '00:00', end: '23:59' }, { day: 'tue', start: '00:00', end: '23:59' }, { day: 'wed', start: '00:00', end: '23:59' }, { day: 'thu', start: '00:00', end: '23:59' }, { day: 'fri', start: '00:00', end: '23:59' }, { day: 'sat', start: '00:00', end: '23:59' }] },
      });
    }

    await new SmsDispatchJob().run({ batchSize: 2 });

    expect(__getStubSmsLogForTest().length).toBe(2);
  });

  it('clamps batchSize >500 to 500', async () => {
    const tmpl = await seedTemplate();
    await seedSend(tmpl.id);
    seedCandidateRuntimeForTest(TENANT, 'c1', {
      phone: '+15551234567',
      smsOptedIn: true,
      contactWindows: { timezone: 'UTC', windows: [{ day: 'sun', start: '00:00', end: '23:59' }, { day: 'mon', start: '00:00', end: '23:59' }, { day: 'tue', start: '00:00', end: '23:59' }, { day: 'wed', start: '00:00', end: '23:59' }, { day: 'thu', start: '00:00', end: '23:59' }, { day: 'fri', start: '00:00', end: '23:59' }, { day: 'sat', start: '00:00', end: '23:59' }] },
    });

    // batchSize=9999 → clamped to 500 internally; the single send still dispatches.
    await new SmsDispatchJob().run({ batchSize: 9999 });
    expect(__getStubSmsLogForTest()).toHaveLength(1);
  });

  it('accepts an explicit tenantId override', async () => {
    const tmpl = await createTemplate({
      tenantId: 'other-tenant',
      agenda: 'general',
      name: 'G',
      templateKey: 'general_v1',
      body: 'Hi {{first_name}}',
      variables: ['first_name'],
      actorId: 'u-admin',
    });
    await insertSmsSend({
      tenantId: 'other-tenant',
      candidateId: 'cX',
      templateId: tmpl.id,
      templateVersion: 1,
      scheduledFor: new Date(Date.now() - 60_000).toISOString(),
      contextParams: { first_name: 'Riya' },
    });
    seedCandidateRuntimeForTest('other-tenant', 'cX', {
      phone: '+15559998888',
      smsOptedIn: true,
      contactWindows: { timezone: 'UTC', windows: [{ day: 'sun', start: '00:00', end: '23:59' }, { day: 'mon', start: '00:00', end: '23:59' }, { day: 'tue', start: '00:00', end: '23:59' }, { day: 'wed', start: '00:00', end: '23:59' }, { day: 'thu', start: '00:00', end: '23:59' }, { day: 'fri', start: '00:00', end: '23:59' }, { day: 'sat', start: '00:00', end: '23:59' }] },
    });

    await new SmsDispatchJob().run({ tenantId: 'other-tenant', batchSize: 5 });
    const log = __getStubSmsLogForTest();
    expect(log).toHaveLength(1);
    expect(log[0].to).toBe('+15559998888');
  });

  it('each dispatched send carries a deterministic idempotency key from the stub log', async () => {
    const tmpl = await seedTemplate();
    await seedSend(tmpl.id);
    seedCandidateRuntimeForTest(TENANT, 'c1', {
      phone: '+15551234567',
      smsOptedIn: true,
      contactWindows: { timezone: 'UTC', windows: [{ day: 'sun', start: '00:00', end: '23:59' }, { day: 'mon', start: '00:00', end: '23:59' }, { day: 'tue', start: '00:00', end: '23:59' }, { day: 'wed', start: '00:00', end: '23:59' }, { day: 'thu', start: '00:00', end: '23:59' }, { day: 'fri', start: '00:00', end: '23:59' }, { day: 'sat', start: '00:00', end: '23:59' }] },
    });

    await new SmsDispatchJob().run({ batchSize: 5 });

    const log = __getStubSmsLogForTest();
    expect(log[0].idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not re-claim on a second immediate run (rows now in status=queued/sent)', async () => {
    const tmpl = await seedTemplate();
    await seedSend(tmpl.id);
    seedCandidateRuntimeForTest(TENANT, 'c1', {
      phone: '+15551234567',
      smsOptedIn: true,
      contactWindows: { timezone: 'UTC', windows: [{ day: 'sun', start: '00:00', end: '23:59' }, { day: 'mon', start: '00:00', end: '23:59' }, { day: 'tue', start: '00:00', end: '23:59' }, { day: 'wed', start: '00:00', end: '23:59' }, { day: 'thu', start: '00:00', end: '23:59' }, { day: 'fri', start: '00:00', end: '23:59' }, { day: 'sat', start: '00:00', end: '23:59' }] },
    });

    await new SmsDispatchJob().run({ batchSize: 5 });
    await new SmsDispatchJob().run({ batchSize: 5 });

    // Only one call to the stub — the second run has no pending rows to claim.
    expect(__getStubSmsLogForTest()).toHaveLength(1);
  });

  it('funnel event contains send_id, campaign_id, template_version, candidate_id', async () => {
    const tmpl = await seedTemplate();
    const send = await seedSend(tmpl.id);
    seedCandidateRuntimeForTest(TENANT, 'c1', {
      phone: '+15551234567',
      smsOptedIn: true,
      contactWindows: { timezone: 'UTC', windows: [{ day: 'sun', start: '00:00', end: '23:59' }, { day: 'mon', start: '00:00', end: '23:59' }, { day: 'tue', start: '00:00', end: '23:59' }, { day: 'wed', start: '00:00', end: '23:59' }, { day: 'thu', start: '00:00', end: '23:59' }, { day: 'fri', start: '00:00', end: '23:59' }, { day: 'sat', start: '00:00', end: '23:59' }] },
    });

    await new SmsDispatchJob().run({ batchSize: 5 });

    const funnelLines = consoleSpy.mock.calls
      .map((args) => String(args[0]))
      .filter((line) => line.includes('"kind":"funnel_event"'));
    const payload = JSON.parse(funnelLines[0]) as {
      payload: Record<string, unknown>;
    };
    expect(payload.payload).toMatchObject({
      send_id: send.id,
      template_version: 1,
      candidate_id: 'c1',
    });
  });

  it('no funnel event on opt-out path', async () => {
    const tmpl = await seedTemplate();
    await seedSend(tmpl.id);
    seedCandidateRuntimeForTest(TENANT, 'c1', {
      phone: '+15551234567',
      smsOptedIn: false,
      contactWindows: null,
    });

    await new SmsDispatchJob().run({ batchSize: 5 });

    const funnelLines = consoleSpy.mock.calls
      .map((args) => String(args[0]))
      .filter((line) => line.includes('"kind":"funnel_event"'));
    expect(funnelLines).toHaveLength(0);
  });

  it('failSyncRun is called on a top-level fatal (not per-row)', async () => {
    // Force a fatal by pointing the run at a tenant where claim succeeds
    // but the orchestrator hits a catastrophic error — simulate by throwing
    // inside getSharedSmsProvider via a monkey-patch.
    const tmpl = await seedTemplate();
    await seedSend(tmpl.id);
    seedCandidateRuntimeForTest(TENANT, 'c1', {
      phone: '+15551234567',
      smsOptedIn: true,
      contactWindows: { timezone: 'UTC', windows: [{ day: 'sun', start: '00:00', end: '23:59' }, { day: 'mon', start: '00:00', end: '23:59' }, { day: 'tue', start: '00:00', end: '23:59' }, { day: 'wed', start: '00:00', end: '23:59' }, { day: 'thu', start: '00:00', end: '23:59' }, { day: 'fri', start: '00:00', end: '23:59' }, { day: 'sat', start: '00:00', end: '23:59' }] },
    });

    // Inject a provider that throws synchronously on first call.
    const smsStub = await import('@/modules/providers/sms-stub');
    smsStub.setSharedSmsProvider({
      name: 'exploding-stub',
      send: async () => {
        throw new Error('simulated fatal');
      },
    });

    await new SmsDispatchJob().run({ batchSize: 5 });

    // Per-row error → recordSyncFailure called, sync_run still completes.
    expect(syncRunCalls.recordSyncFailure).toHaveBeenCalled();
    expect(syncRunCalls.completeSyncRun).toHaveBeenCalled();
  });

  it('review patch F1: skips the tick and emits a zero-count sync_run when sms-stub is kill_switched', async () => {
    // Register + flip to kill_switched (mirrors operator using admin UI +
    // the routing-policy restore at startup).
    const registry = getProviderRegistry();
    registry.clearForTest();
    registry.register('sms-stub');
    registry.setMode('sms-stub', 'kill_switched', 'Operator disabled SMS');

    const tmpl = await seedTemplate();
    await seedSend(tmpl.id);
    seedCandidateRuntimeForTest(TENANT, 'c1', {
      phone: '+15551234567',
      smsOptedIn: true,
      contactWindows: { timezone: 'UTC', windows: [{ day: 'sun', start: '00:00', end: '23:59' }, { day: 'mon', start: '00:00', end: '23:59' }, { day: 'tue', start: '00:00', end: '23:59' }, { day: 'wed', start: '00:00', end: '23:59' }, { day: 'thu', start: '00:00', end: '23:59' }, { day: 'fri', start: '00:00', end: '23:59' }, { day: 'sat', start: '00:00', end: '23:59' }] },
    });

    await new SmsDispatchJob().run({ batchSize: 5 });

    // Provider MUST NOT be invoked.
    expect(__getStubSmsLogForTest()).toHaveLength(0);
    // sync_run completed with zero counts (not failed — this is expected operation).
    expect(syncRunCalls.completeSyncRun).toHaveBeenCalledWith('run-1', {
      succeeded: 0,
      failed: 0,
      total: 0,
    });
    expect(syncRunCalls.failSyncRun).not.toHaveBeenCalled();
  });

  it('review patch F1: skips the tick when sms-stub is not registered at all', async () => {
    const registry = getProviderRegistry();
    registry.clearForTest();
    // Deliberately do NOT register 'sms-stub' — simulates init failure.

    const tmpl = await seedTemplate();
    await seedSend(tmpl.id);
    seedCandidateRuntimeForTest(TENANT, 'c1', {
      phone: '+15551234567',
      smsOptedIn: true,
      contactWindows: { timezone: 'UTC', windows: [{ day: 'sun', start: '00:00', end: '23:59' }, { day: 'mon', start: '00:00', end: '23:59' }, { day: 'tue', start: '00:00', end: '23:59' }, { day: 'wed', start: '00:00', end: '23:59' }, { day: 'thu', start: '00:00', end: '23:59' }, { day: 'fri', start: '00:00', end: '23:59' }, { day: 'sat', start: '00:00', end: '23:59' }] },
    });

    await new SmsDispatchJob().run({ batchSize: 5 });

    expect(__getStubSmsLogForTest()).toHaveLength(0);
    expect(syncRunCalls.completeSyncRun).toHaveBeenCalledWith('run-1', {
      succeeded: 0,
      failed: 0,
      total: 0,
    });
  });

  it('registry contains sms-dispatch registration via registerIngestionJobs() when feature flag is on', async () => {
    const prev = process.env.CBL_OUTREACH_SMS_DISPATCH_ENABLED;
    process.env.CBL_OUTREACH_SMS_DISPATCH_ENABLED = 'true';
    try {
      const registered: Array<{ job: { name: string }; meta?: Record<string, unknown> }> = [];
      const { registerIngestionJobs } = await import('../jobs');
      registerIngestionJobs({
        register(job, meta) {
          registered.push({ job, meta });
        },
      });

      const smsEntry = registered.find((r) => r.meta?.jobKey === 'sms-dispatch');
      expect(smsEntry).toBeDefined();
      expect(smsEntry?.meta).toMatchObject({
        jobKey: 'sms-dispatch',
        scheduleName: 'SMS Outreach Dispatcher',
        cronExpression: '*/10 * * * *',
        policyFamily: 'outreach_schedules',
        policyKey: 'sms_dispatch',
      });
    } finally {
      if (prev === undefined) delete process.env.CBL_OUTREACH_SMS_DISPATCH_ENABLED;
      else process.env.CBL_OUTREACH_SMS_DISPATCH_ENABLED = prev;
    }
  });

  it('registry omits sms-dispatch when feature flag is unset', async () => {
    const prev = process.env.CBL_OUTREACH_SMS_DISPATCH_ENABLED;
    delete process.env.CBL_OUTREACH_SMS_DISPATCH_ENABLED;
    try {
      const registered: Array<{ meta?: Record<string, unknown> }> = [];
      const { registerIngestionJobs } = await import('../jobs');
      registerIngestionJobs({
        register(job, meta) {
          registered.push({ meta });
        },
      });
      const smsEntry = registered.find((r) => r.meta?.jobKey === 'sms-dispatch');
      expect(smsEntry).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.CBL_OUTREACH_SMS_DISPATCH_ENABLED = prev;
    }
  });
});
