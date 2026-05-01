import { beforeEach, describe, expect, it } from 'vitest';
import {
  insertSmsSend,
  insertSmsSendsBulk,
  claimDueSmsSends,
  updateSmsSendStatus,
  getSmsSendById,
  writeOutreachAuditLog,
  getAuditLogForTest,
  clearSmsSendStoreForTest,
  seedOptOutForTest,
  isCandidateOptedInSms,
  SmsSendNotFoundError,
} from '../sms-send-repository';

describe('SmsSendRepository (in-memory)', () => {
  beforeEach(() => {
    clearSmsSendStoreForTest();
  });

  describe('insertSmsSend', () => {
    it('creates a pending row with default contextParams={}', async () => {
      const row = await insertSmsSend({
        tenantId: 't1',
        candidateId: 'c1',
        templateId: 'tmpl-1',
        templateVersion: 1,
        scheduledFor: '2026-04-24T14:00:00.000Z',
      });
      expect(row.status).toBe('pending');
      expect(row.contextParams).toEqual({});
      expect(row.tenantId).toBe('t1');
      expect(row.id).toMatch(/^send-/);
    });

    it('persists all optional fields supplied by the caller', async () => {
      const row = await insertSmsSend({
        tenantId: 't1',
        candidateId: 'c1',
        templateId: 'tmpl-1',
        templateVersion: 2,
        scheduledFor: '2026-04-24T14:00:00.000Z',
        campaignId: 'cmp-1',
        renderedBody: 'Hi Sam',
        renderedBodyHash: 'hash-1',
        contextParams: { first_name: 'Sam' },
        senderUserId: 'u-1',
        trackingToken: 'tok-abc',
        trackingUrl: 'https://cbl.aero/t/tok-abc',
        providerIdempotencyKey: 'idk-1',
      });
      expect(row.campaignId).toBe('cmp-1');
      expect(row.renderedBody).toBe('Hi Sam');
      expect(row.renderedBodyHash).toBe('hash-1');
      expect(row.contextParams).toEqual({ first_name: 'Sam' });
      expect(row.senderUserId).toBe('u-1');
      expect(row.trackingToken).toBe('tok-abc');
      expect(row.trackingUrl).toBe('https://cbl.aero/t/tok-abc');
      expect(row.providerIdempotencyKey).toBe('idk-1');
    });

    it('getSmsSendById returns the row', async () => {
      const created = await insertSmsSend({
        tenantId: 't1',
        candidateId: 'c1',
        templateId: 'tmpl-1',
        templateVersion: 1,
        scheduledFor: '2026-04-24T14:00:00.000Z',
      });
      const fetched = await getSmsSendById(created.id);
      expect(fetched.id).toBe(created.id);
    });

    it('getSmsSendById throws for unknown id', async () => {
      await expect(getSmsSendById('send-unknown')).rejects.toBeInstanceOf(SmsSendNotFoundError);
    });
  });

  describe('insertSmsSendsBulk', () => {
    it('inserts each valid row and returns inserted/skipped counts', async () => {
      const rows = [
        { tenantId: 't1', candidateId: 'c1', templateId: 'tmpl-1', templateVersion: 1, scheduledFor: '2026-04-24T14:00:00.000Z' },
        { tenantId: 't1', candidateId: 'c2', templateId: 'tmpl-1', templateVersion: 1, scheduledFor: '2026-04-24T14:00:00.000Z' },
      ];
      const result = await insertSmsSendsBulk(rows);
      expect(result.inserted).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it('skips opted-out candidates and counts them as skipped', async () => {
      seedOptOutForTest('t1', 'c2', false);
      const rows = [
        { tenantId: 't1', candidateId: 'c1', templateId: 'tmpl-1', templateVersion: 1, scheduledFor: '2026-04-24T14:00:00.000Z' },
        { tenantId: 't1', candidateId: 'c2', templateId: 'tmpl-1', templateVersion: 1, scheduledFor: '2026-04-24T14:00:00.000Z' },
      ];
      const result = await insertSmsSendsBulk(rows);
      expect(result.inserted).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('skips rows missing required fields', async () => {
      const rows = [
        { tenantId: 't1', candidateId: 'c1', templateId: 'tmpl-1', templateVersion: 1, scheduledFor: '2026-04-24T14:00:00.000Z' },
        { tenantId: '', candidateId: 'c2', templateId: 'tmpl-1', templateVersion: 1, scheduledFor: '2026-04-24T14:00:00.000Z' },
      ];
      const result = await insertSmsSendsBulk(rows);
      expect(result.inserted).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('returns 0/0 for an empty array', async () => {
      const result = await insertSmsSendsBulk([]);
      expect(result).toEqual({ inserted: 0, skipped: 0 });
    });

    it('throws when batch size exceeds 500', async () => {
      const rows = Array.from({ length: 501 }, (_, i) => ({
        tenantId: 't1',
        candidateId: `c${i}`,
        templateId: 'tmpl-1',
        templateVersion: 1,
        scheduledFor: '2026-04-24T14:00:00.000Z',
      }));
      await expect(insertSmsSendsBulk(rows)).rejects.toThrow(/exceeds 500/);
    });
  });

  describe('claimDueSmsSends', () => {
    it('claims only rows whose scheduled_for is <= now', async () => {
      await insertSmsSend({
        tenantId: 't1',
        candidateId: 'c1',
        templateId: 'tmpl-1',
        templateVersion: 1,
        scheduledFor: '2026-04-24T13:00:00.000Z', // past
      });
      await insertSmsSend({
        tenantId: 't1',
        candidateId: 'c2',
        templateId: 'tmpl-1',
        templateVersion: 1,
        scheduledFor: '2026-04-24T16:00:00.000Z', // future
      });
      const claimed = await claimDueSmsSends('t1', 50, '2026-04-24T14:00:00.000Z');
      expect(claimed).toHaveLength(1);
      expect(claimed[0].candidateId).toBe('c1');
    });

    it('claims batches up to batchSize', async () => {
      for (let i = 0; i < 10; i += 1) {
        await insertSmsSend({
          tenantId: 't1',
          candidateId: `c${i}`,
          templateId: 'tmpl-1',
          templateVersion: 1,
          scheduledFor: '2026-04-24T13:00:00.000Z',
        });
      }
      const claimed = await claimDueSmsSends('t1', 3, '2026-04-24T14:00:00.000Z');
      expect(claimed).toHaveLength(3);
    });

    it('transitions rows to queued and increments delivery_attempt_count', async () => {
      const created = await insertSmsSend({
        tenantId: 't1',
        candidateId: 'c1',
        templateId: 'tmpl-1',
        templateVersion: 1,
        scheduledFor: '2026-04-24T13:00:00.000Z',
      });
      expect(created.status).toBe('pending');
      expect(created.deliveryAttemptCount).toBe(0);

      const claimed = await claimDueSmsSends('t1', 10, '2026-04-24T14:00:00.000Z');
      expect(claimed).toHaveLength(1);
      expect(claimed[0].status).toBe('queued');
      expect(claimed[0].deliveryAttemptCount).toBe(1);
    });

    it('does not re-claim already-queued rows on a second call', async () => {
      await insertSmsSend({
        tenantId: 't1',
        candidateId: 'c1',
        templateId: 'tmpl-1',
        templateVersion: 1,
        scheduledFor: '2026-04-24T13:00:00.000Z',
      });
      const firstPass = await claimDueSmsSends('t1', 10, '2026-04-24T14:00:00.000Z');
      const secondPass = await claimDueSmsSends('t1', 10, '2026-04-24T14:00:00.000Z');
      expect(firstPass).toHaveLength(1);
      expect(secondPass).toHaveLength(0);
    });

    it('scopes to tenantId (no cross-tenant claims)', async () => {
      await insertSmsSend({
        tenantId: 't1',
        candidateId: 'c1',
        templateId: 'tmpl-1',
        templateVersion: 1,
        scheduledFor: '2026-04-24T13:00:00.000Z',
      });
      await insertSmsSend({
        tenantId: 't2',
        candidateId: 'c1',
        templateId: 'tmpl-1',
        templateVersion: 1,
        scheduledFor: '2026-04-24T13:00:00.000Z',
      });
      const t1 = await claimDueSmsSends('t1', 10, '2026-04-24T14:00:00.000Z');
      const t2 = await claimDueSmsSends('t2', 10, '2026-04-24T14:00:00.000Z');
      expect(t1).toHaveLength(1);
      expect(t2).toHaveLength(1);
      expect(t1[0].tenantId).toBe('t1');
      expect(t2[0].tenantId).toBe('t2');
    });

    it('throws when batchSize is out of bounds', async () => {
      await expect(claimDueSmsSends('t1', 0)).rejects.toThrow(/batchSize/);
      await expect(claimDueSmsSends('t1', 501)).rejects.toThrow(/batchSize/);
    });
  });

  describe('updateSmsSendStatus', () => {
    it('transitions pending → sent with provider metadata', async () => {
      const created = await insertSmsSend({
        tenantId: 't1',
        candidateId: 'c1',
        templateId: 'tmpl-1',
        templateVersion: 1,
        scheduledFor: '2026-04-24T13:00:00.000Z',
      });
      await updateSmsSendStatus({
        id: created.id,
        status: 'sent',
        provider: 'sms-stub',
        providerMessageId: 'stub_abc123',
        sentAt: '2026-04-24T14:05:00.000Z',
      });
      const refetched = await getSmsSendById(created.id);
      expect(refetched.status).toBe('sent');
      expect(refetched.provider).toBe('sms-stub');
      expect(refetched.providerMessageId).toBe('stub_abc123');
      expect(refetched.sentAt).toBe('2026-04-24T14:05:00.000Z');
    });

    it('transitions claimed → blocked_opt_out with reason', async () => {
      const created = await insertSmsSend({
        tenantId: 't1',
        candidateId: 'c1',
        templateId: 'tmpl-1',
        templateVersion: 1,
        scheduledFor: '2026-04-24T13:00:00.000Z',
      });
      await updateSmsSendStatus({
        id: created.id,
        status: 'blocked_opt_out',
        blockedReason: 'opt_out_at_dequeue',
      });
      const refetched = await getSmsSendById(created.id);
      expect(refetched.status).toBe('blocked_opt_out');
      expect(refetched.blockedReason).toBe('opt_out_at_dequeue');
    });

    it('throws when id is unknown', async () => {
      await expect(
        updateSmsSendStatus({ id: 'unknown', status: 'sent' }),
      ).rejects.toBeInstanceOf(SmsSendNotFoundError);
    });
  });

  describe('opt-in lookup', () => {
    it('defaults to true when no preference row exists', async () => {
      const opted = await isCandidateOptedInSms('t1', 'c1');
      expect(opted).toBe(true);
    });

    it('returns false when the candidate has opted out', async () => {
      seedOptOutForTest('t1', 'c1', false);
      expect(await isCandidateOptedInSms('t1', 'c1')).toBe(false);
    });

    it('returns true when explicitly opted in', async () => {
      seedOptOutForTest('t1', 'c1', true);
      expect(await isCandidateOptedInSms('t1', 'c1')).toBe(true);
    });

    it('is tenant-scoped', async () => {
      seedOptOutForTest('t1', 'c1', false);
      expect(await isCandidateOptedInSms('t1', 'c1')).toBe(false);
      expect(await isCandidateOptedInSms('t2', 'c1')).toBe(true);
    });
  });

  describe('writeOutreachAuditLog', () => {
    it('appends a row to the audit log', async () => {
      await writeOutreachAuditLog({
        tenantId: 't1',
        channel: 'sms',
        sendId: 'send-1',
        candidateId: 'c1',
        senderUserId: 'u1',
        senderRole: 'recruiter',
        templateId: 'tmpl-1',
        templateAgenda: 'new_opportunity',
        deliveryStatus: 'sent',
        contentHash: 'hash-1',
        compliancePassed: true,
        blockedReason: null,
        traceId: 'trace-1',
        correlationId: 'corr-1',
        eventEnvelope: { event_type: 'outreach.message.sent' },
      });
      const log = getAuditLogForTest();
      expect(log).toHaveLength(1);
      expect(log[0].channel).toBe('sms');
      expect(log[0].deliveryStatus).toBe('sent');
      expect(log[0].eventEnvelope).toEqual({ event_type: 'outreach.message.sent' });
    });

    it('records multiple appends in order', async () => {
      for (let i = 0; i < 3; i += 1) {
        await writeOutreachAuditLog({
          tenantId: 't1',
          channel: 'sms',
          sendId: `send-${i}`,
          candidateId: 'c1',
          senderUserId: null,
          senderRole: null,
          templateId: null,
          templateAgenda: null,
          deliveryStatus: 'sent',
          contentHash: null,
          compliancePassed: null,
          blockedReason: null,
          traceId: null,
          correlationId: null,
          eventEnvelope: null,
        });
      }
      const log = getAuditLogForTest();
      expect(log).toHaveLength(3);
    });
  });
});
