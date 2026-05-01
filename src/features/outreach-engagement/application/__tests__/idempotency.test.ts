import { describe, it, expect } from 'vitest';
import { computeSmsIdempotencyKey } from '../idempotency';

describe('computeSmsIdempotencyKey', () => {
  const base = {
    tenantId: 't1',
    candidateId: 'c1',
    templateId: 'tmpl-1',
    templateVersion: 2,
    scheduledFor: '2026-04-24T14:30:00.000Z',
  } as const;

  it('returns a 64-char hex SHA-256 digest', () => {
    const key = computeSmsIdempotencyKey(base);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic across calls', () => {
    expect(computeSmsIdempotencyKey(base)).toBe(computeSmsIdempotencyKey(base));
  });

  it('produces the same key for two timestamps on the same UTC day', () => {
    const morning = computeSmsIdempotencyKey({ ...base, scheduledFor: '2026-04-24T00:00:00.000Z' });
    const evening = computeSmsIdempotencyKey({ ...base, scheduledFor: '2026-04-24T23:59:59.000Z' });
    expect(morning).toBe(evening);
  });

  it('produces different keys for different UTC days', () => {
    const d1 = computeSmsIdempotencyKey({ ...base, scheduledFor: '2026-04-24T23:00:00.000Z' });
    const d2 = computeSmsIdempotencyKey({ ...base, scheduledFor: '2026-04-25T01:00:00.000Z' });
    expect(d1).not.toBe(d2);
  });

  it('is sensitive to every identity field', () => {
    const k0 = computeSmsIdempotencyKey(base);
    expect(computeSmsIdempotencyKey({ ...base, tenantId: 't2' })).not.toBe(k0);
    expect(computeSmsIdempotencyKey({ ...base, candidateId: 'c2' })).not.toBe(k0);
    expect(computeSmsIdempotencyKey({ ...base, templateId: 'tmpl-2' })).not.toBe(k0);
    expect(computeSmsIdempotencyKey({ ...base, templateVersion: 3 })).not.toBe(k0);
  });

  it('empty jobRequirementId matches unset jobRequirementId (backwards compat)', () => {
    const withEmpty = computeSmsIdempotencyKey({ ...base, jobRequirementId: '' });
    const withoutField = computeSmsIdempotencyKey(base);
    expect(withEmpty).toBe(withoutField);
  });

  it('non-empty jobRequirementId produces a different hash (Epic 4 forward-compat)', () => {
    const withJob = computeSmsIdempotencyKey({ ...base, jobRequirementId: 'req-1' });
    const withoutJob = computeSmsIdempotencyKey(base);
    expect(withJob).not.toBe(withoutJob);
  });

  it('throws when tenantId is missing', () => {
    expect(() =>
      computeSmsIdempotencyKey({ ...base, tenantId: '' }),
    ).toThrow(/tenantId required/);
  });

  it('throws when templateVersion is not a positive integer', () => {
    expect(() => computeSmsIdempotencyKey({ ...base, templateVersion: 0 })).toThrow(/positive integer/);
    expect(() => computeSmsIdempotencyKey({ ...base, templateVersion: -1 })).toThrow(/positive integer/);
    expect(() => computeSmsIdempotencyKey({ ...base, templateVersion: Number.NaN })).toThrow(/positive integer/);
  });

  it('throws when scheduledFor is not a valid ISO timestamp', () => {
    expect(() => computeSmsIdempotencyKey({ ...base, scheduledFor: 'not-a-date' })).toThrow(/valid ISO/);
  });
});
