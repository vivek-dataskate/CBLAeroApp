import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadDefaultContactWindow,
  seedDefaultContactWindowForTest,
  clearDefaultContactWindowStoreForTest,
} from '../contact-window-policy';
import { HARDCODED_DEFAULT_CONTACT_WINDOW } from '../../application/sms-dispatch';

describe('loadDefaultContactWindow (review patch F3 — dev-standards §29)', () => {
  beforeEach(() => {
    clearDefaultContactWindowStoreForTest();
  });

  it('returns the hardcoded fallback when no policy override is seeded (simulates missing policy_registry row)', async () => {
    const result = await loadDefaultContactWindow();
    expect(result).toEqual(HARDCODED_DEFAULT_CONTACT_WINDOW);
  });

  it('returns the seeded override when admin has published a custom window', async () => {
    const override = {
      timezone: 'UTC',
      windows: [
        { day: 'mon' as const, start: '10:00', end: '18:00' },
        { day: 'sat' as const, start: '10:00', end: '14:00' },
      ],
    };
    seedDefaultContactWindowForTest(override);
    const result = await loadDefaultContactWindow();
    expect(result).toEqual(override);
  });

  it('explicit null override still returns the hardcoded fallback (simulates malformed DB row)', async () => {
    seedDefaultContactWindowForTest(null);
    const result = await loadDefaultContactWindow();
    expect(result).toEqual(HARDCODED_DEFAULT_CONTACT_WINDOW);
  });

  it('admin override edits pick up on the next call (DB-as-source-of-truth)', async () => {
    const first = await loadDefaultContactWindow();
    expect(first.windows.length).toBeGreaterThan(0);

    seedDefaultContactWindowForTest({
      timezone: 'America/New_York',
      windows: [{ day: 'wed' as const, start: '12:00', end: '13:00' }],
    });
    const second = await loadDefaultContactWindow();
    expect(second.timezone).toBe('America/New_York');
    expect(second.windows).toHaveLength(1);
  });

  it('clearing the store reverts to the hardcoded fallback', async () => {
    seedDefaultContactWindowForTest({
      timezone: 'UTC',
      windows: [{ day: 'mon' as const, start: '09:00', end: '17:00' }],
    });
    clearDefaultContactWindowStoreForTest();
    const result = await loadDefaultContactWindow();
    expect(result).toEqual(HARDCODED_DEFAULT_CONTACT_WINDOW);
  });
});
