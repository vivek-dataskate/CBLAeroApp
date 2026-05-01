import { beforeEach, describe, expect, it } from 'vitest';
import {
  StubSmsProvider,
  __getStubSmsLogForTest,
  __clearStubSmsLogForTest,
  buildStubSmsProviderFromEnv,
  getSharedSmsProvider,
  setSharedSmsProvider,
  resetSharedSmsProviderForTest,
  initializeSmsProviderFromStartup,
} from '../index';
import type { SmsProvider } from '@/features/outreach-engagement/contracts/sms-provider';
import { getProviderRegistry } from '../../startup';

describe('StubSmsProvider', () => {
  beforeEach(() => {
    __clearStubSmsLogForTest();
    resetSharedSmsProviderForTest();
    getProviderRegistry().clearForTest();
    getProviderRegistry().register('sms-stub');
  });

  it('reports name "sms-stub"', () => {
    const p = new StubSmsProvider();
    expect(p.name).toBe('sms-stub');
  });

  it('returns status "sent" on happy path', async () => {
    const p = new StubSmsProvider();
    const result = await p.send({
      to: '+15551234567',
      body: 'hi {{first_name}}',
      idempotencyKey: 'abc',
    });
    expect(result.status).toBe('sent');
    expect(result.providerMessageId).toMatch(/^stub_[a-f0-9]{12}$/);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeLessThan(50); // <5ms target — be generous for CI
  });

  it('producedMessageId is deterministic for the same inputs', async () => {
    const p = new StubSmsProvider();
    const a = await p.send({ to: '+15550001', body: 'body', idempotencyKey: 'k1' });
    const b = await p.send({ to: '+15550001', body: 'body', idempotencyKey: 'k1' });
    expect(a.providerMessageId).toBe(b.providerMessageId);
  });

  it('producedMessageId changes when any input changes', async () => {
    const p = new StubSmsProvider();
    const base = await p.send({ to: '+15550001', body: 'body', idempotencyKey: 'k1' });
    const diffTo = await p.send({ to: '+15550002', body: 'body', idempotencyKey: 'k1' });
    const diffBody = await p.send({ to: '+15550001', body: 'OTHER', idempotencyKey: 'k1' });
    const diffKey = await p.send({ to: '+15550001', body: 'body', idempotencyKey: 'k2' });
    expect(new Set([base.providerMessageId, diffTo.providerMessageId, diffBody.providerMessageId, diffKey.providerMessageId]).size).toBe(4);
  });

  it('records every call in the in-memory log', async () => {
    const p = new StubSmsProvider();
    await p.send({ to: '+1', body: 'a', idempotencyKey: 'k1' });
    await p.send({ to: '+2', body: 'b', idempotencyKey: 'k2' });
    const log = __getStubSmsLogForTest();
    expect(log).toHaveLength(2);
    expect(log[0].to).toBe('+1');
    expect(log[1].to).toBe('+2');
  });

  it('log entries carry the providerMessageId and cost metadata', async () => {
    const p = new StubSmsProvider();
    const result = await p.send({
      to: '+15559998888',
      body: 'hi',
      idempotencyKey: 'k',
      costMeta: { campaign_id: 'c-1' },
    });
    const log = __getStubSmsLogForTest();
    expect(log[0].providerMessageId).toBe(result.providerMessageId);
    expect(log[0].costMeta).toEqual({ campaign_id: 'c-1' });
  });

  it('__clearStubSmsLogForTest empties the log', async () => {
    const p = new StubSmsProvider();
    await p.send({ to: '+1', body: 'a', idempotencyKey: 'k' });
    expect(__getStubSmsLogForTest()).toHaveLength(1);
    __clearStubSmsLogForTest();
    expect(__getStubSmsLogForTest()).toHaveLength(0);
  });

  it('returns status "failed" and captures errorMessage when inputs are invalid', async () => {
    const p = new StubSmsProvider();
    const result = await p.send({ to: '', body: 'x', idempotencyKey: 'k' });
    expect(result.status).toBe('failed');
    expect(result.providerMessageId).toBe('');
    expect(result.errorMessage).toMatch(/to required/);
  });

  it('validates body and idempotencyKey are present', async () => {
    const p = new StubSmsProvider();
    const noBody = await p.send({ to: '+1', body: '', idempotencyKey: 'k' });
    expect(noBody.status).toBe('failed');
    expect(noBody.errorMessage).toMatch(/body required/);
    const noKey = await p.send({ to: '+1', body: 'x', idempotencyKey: '' });
    expect(noKey.status).toBe('failed');
    expect(noKey.errorMessage).toMatch(/idempotencyKey required/);
  });

  it('records success on ProviderRegistry (if registered)', async () => {
    const registry = getProviderRegistry();
    const before = registry.getProvider('sms-stub')?.health.totalAttempts ?? 0;
    const p = new StubSmsProvider();
    await p.send({ to: '+1', body: 'ok', idempotencyKey: 'k' });
    const after = registry.getProvider('sms-stub')?.health.totalAttempts ?? 0;
    expect(after).toBe(before + 1);
  });

  it('records failure on ProviderRegistry when send throws (if registered)', async () => {
    const registry = getProviderRegistry();
    const beforeErrors = registry.getProvider('sms-stub')?.health.totalFailures ?? 0;
    const p = new StubSmsProvider();
    await p.send({ to: '', body: 'x', idempotencyKey: 'k' });
    const afterErrors = registry.getProvider('sms-stub')?.health.totalFailures ?? 0;
    expect(afterErrors).toBe(beforeErrors + 1);
  });
});

describe('shared SMS provider singleton', () => {
  beforeEach(() => {
    resetSharedSmsProviderForTest();
    __clearStubSmsLogForTest();
  });

  it('buildStubSmsProviderFromEnv returns a StubSmsProvider', () => {
    const p = buildStubSmsProviderFromEnv();
    expect(p).toBeInstanceOf(StubSmsProvider);
    expect(p.name).toBe('sms-stub');
  });

  it('getSharedSmsProvider returns the same instance across calls', () => {
    const a = getSharedSmsProvider();
    const b = getSharedSmsProvider();
    expect(a).toBe(b);
  });

  it('setSharedSmsProvider replaces the singleton (for Story 3-1b swap)', () => {
    const first = getSharedSmsProvider();
    const replacement: typeof first = {
      name: 'telnyx',
      async send() {
        return { providerMessageId: 'telnyx-1', status: 'sent', durationMs: 1 };
      },
    };
    setSharedSmsProvider(replacement);
    expect(getSharedSmsProvider()).toBe(replacement);
    expect(getSharedSmsProvider()).not.toBe(first);
  });

  it('resetSharedSmsProviderForTest forces a rebuild on next get', () => {
    const a = getSharedSmsProvider();
    resetSharedSmsProviderForTest();
    const b = getSharedSmsProvider();
    expect(a).not.toBe(b);
  });
});

describe('initializeSmsProviderFromStartup — review patch F4', () => {
  beforeEach(() => {
    resetSharedSmsProviderForTest();
  });

  it('sets the provider when none is currently set', () => {
    const mock: SmsProvider = {
      name: 'first-init',
      async send() {
        return { providerMessageId: 'x', status: 'sent', durationMs: 0 };
      },
    };
    initializeSmsProviderFromStartup(mock);
    expect(getSharedSmsProvider()).toBe(mock);
  });

  it('does NOT overwrite a previously-set provider (preserves test-injected mocks)', () => {
    const testMock: SmsProvider = {
      name: 'test-mock',
      async send() {
        return { providerMessageId: 'mock', status: 'sent', durationMs: 0 };
      },
    };
    setSharedSmsProvider(testMock);

    const startupBuilt: SmsProvider = {
      name: 'startup-stub',
      async send() {
        return { providerMessageId: 'startup', status: 'sent', durationMs: 0 };
      },
    };
    initializeSmsProviderFromStartup(startupBuilt);

    // test-injected mock wins — the startup init is a no-op when already set.
    expect(getSharedSmsProvider()).toBe(testMock);
    expect(getSharedSmsProvider().name).toBe('test-mock');
  });

  it('is idempotent — multiple initializeSmsProviderFromStartup calls no-op after the first', () => {
    const first = buildStubSmsProviderFromEnv();
    const second = buildStubSmsProviderFromEnv();
    initializeSmsProviderFromStartup(first);
    initializeSmsProviderFromStartup(second);
    expect(getSharedSmsProvider()).toBe(first);
  });
});
