import { describe, expect, it } from 'vitest';
import { calculateNextRunAt } from '@/modules/ingestion/scheduler';

describe('GlobalScheduler cron helper', () => {
  it('calculates next run for every 15 minutes', () => {
    const next = calculateNextRunAt('*/15 * * * *', new Date('2026-04-14T00:07:10.000Z'));
    expect(next).toBe('2026-04-14T00:15:00.000Z');
  });

  it('calculates next run on the hour', () => {
    const next = calculateNextRunAt('0 * * * *', new Date('2026-04-14T01:23:45.000Z'));
    expect(next).toBe('2026-04-14T02:00:00.000Z');
  });

  it('calculates next run every 4 hours', () => {
    const next = calculateNextRunAt('0 */4 * * *', new Date('2026-04-14T01:05:00.000Z'));
    expect(next).toBe('2026-04-14T04:00:00.000Z');
  });

  it('calculates next daily run after the current time', () => {
    const next = calculateNextRunAt('0 6 * * *', new Date('2026-04-14T06:00:00.000Z'));
    expect(next).toBe('2026-04-15T06:00:00.000Z');
  });
});
