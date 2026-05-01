import { describe, it, expect } from 'vitest';
import {
  resolveNextContactWindow,
  isWithinContactWindow,
} from '../contact-window';
import type { CandidateContactWindows } from '../../contracts/contact-window';

const DEFAULT_WINDOWS: CandidateContactWindows = {
  timezone: 'America/Chicago',
  windows: [
    { day: 'mon', start: '08:00', end: '20:00' },
    { day: 'tue', start: '08:00', end: '20:00' },
    { day: 'wed', start: '08:00', end: '20:00' },
    { day: 'thu', start: '08:00', end: '20:00' },
    { day: 'fri', start: '08:00', end: '20:00' },
  ],
};

/** Helper: build a Date from a wall-clock in a tz, using the same utility. */
function at(utcIso: string): Date {
  return new Date(utcIso);
}

describe('resolveNextContactWindow', () => {
  it('returns now when already inside the window (Mon 10:00 CDT)', () => {
    // 2026-04-27 Monday 10:00 America/Chicago (CDT = UTC-5) → 15:00 UTC
    const now = at('2026-04-27T15:00:00.000Z');
    const result = resolveNextContactWindow(now, null, DEFAULT_WINDOWS);
    expect(result.getTime()).toBe(now.getTime());
  });

  it('null candidateWindows → default is used', () => {
    const now = at('2026-04-27T03:00:00.000Z'); // Mon 22:00 Sun CT (outside)
    const result = resolveNextContactWindow(now, null, DEFAULT_WINDOWS);
    expect(result.getTime()).toBeGreaterThan(now.getTime());
  });

  it('undefined candidateWindows → default is used', () => {
    const now = at('2026-04-27T03:00:00.000Z');
    const result = resolveNextContactWindow(now, undefined, DEFAULT_WINDOWS);
    expect(result.getTime()).toBeGreaterThan(now.getTime());
  });

  it('empty windows array → default is used', () => {
    const now = at('2026-04-27T03:00:00.000Z');
    const empty: CandidateContactWindows = { timezone: 'America/Chicago', windows: [] };
    const result = resolveNextContactWindow(now, empty, DEFAULT_WINDOWS);
    expect(result.getTime()).toBeGreaterThan(now.getTime());
  });

  it('malformed candidateWindows → falls back to default silently', () => {
    const now = at('2026-04-27T03:00:00.000Z');
    const bad = { timezone: 'America/Chicago', windows: 'not-an-array' } as unknown as CandidateContactWindows;
    const result = resolveNextContactWindow(now, bad, DEFAULT_WINDOWS);
    expect(result.getTime()).toBeGreaterThan(now.getTime());
  });

  it('early morning (before window) same day → returns window start today', () => {
    // Mon 06:00 CDT (= 11:00 UTC) — before 08:00 start.
    const now = at('2026-04-27T11:00:00.000Z');
    const result = resolveNextContactWindow(now, null, DEFAULT_WINDOWS);
    // Expect Mon 08:00 CDT = 13:00 UTC
    expect(result.toISOString()).toBe('2026-04-27T13:00:00.000Z');
  });

  it('past end of window same day → returns next-day start', () => {
    // Mon 21:00 CDT (= 02:00 UTC Tue) — past 20:00 end.
    const now = at('2026-04-28T02:00:00.000Z');
    const result = resolveNextContactWindow(now, null, DEFAULT_WINDOWS);
    // Expect Tue 08:00 CDT = 13:00 UTC Tue
    expect(result.toISOString()).toBe('2026-04-28T13:00:00.000Z');
  });

  it('Friday past-end skips weekend → returns Monday start', () => {
    // Fri 21:00 CDT 2026-05-01 (= 02:00 UTC Sat 2026-05-02)
    const now = at('2026-05-02T02:00:00.000Z');
    const result = resolveNextContactWindow(now, null, DEFAULT_WINDOWS);
    // Monday 2026-05-04 08:00 CDT = 13:00 UTC
    expect(result.toISOString()).toBe('2026-05-04T13:00:00.000Z');
  });

  it('Saturday morning → returns Monday start', () => {
    const now = at('2026-05-02T12:00:00.000Z'); // Sat 07:00 CDT
    const result = resolveNextContactWindow(now, null, DEFAULT_WINDOWS);
    expect(result.toISOString()).toBe('2026-05-04T13:00:00.000Z');
  });

  it('Sunday late → returns Monday start', () => {
    const now = at('2026-05-04T02:00:00.000Z'); // Sun 21:00 CDT
    const result = resolveNextContactWindow(now, null, DEFAULT_WINDOWS);
    expect(result.toISOString()).toBe('2026-05-04T13:00:00.000Z');
  });

  it('DST spring-forward: 2026-03-08 resolves to correct CDT offset', () => {
    // Just past midnight local Mon 2026-03-09 — but DST flipped Sun 2026-03-08.
    // Sun 2026-03-08 02:00 CST became 03:00 CDT. Any time on Mon 2026-03-09
    // is CDT (UTC-5). 08:00 CDT = 13:00 UTC.
    const now = at('2026-03-09T09:00:00.000Z'); // Mon 04:00 CDT (before window)
    const result = resolveNextContactWindow(now, null, DEFAULT_WINDOWS);
    expect(result.toISOString()).toBe('2026-03-09T13:00:00.000Z');
  });

  it('DST fall-back: 2026-11-02 Mon 08:00 CST = 14:00 UTC', () => {
    // Sun 2026-11-01 02:00 CDT rolls back to 01:00 CST. Mon 2026-11-02 is CST (UTC-6).
    const now = at('2026-11-02T10:00:00.000Z'); // Mon 04:00 CST
    const result = resolveNextContactWindow(now, null, DEFAULT_WINDOWS);
    expect(result.toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });

  it('invalid timezone falls back to UTC and warns', () => {
    const now = at('2026-04-27T05:00:00.000Z'); // Mon 05:00 UTC
    const utcWindows: CandidateContactWindows = {
      timezone: 'Invalid/Zone',
      windows: [{ day: 'mon', start: '08:00', end: '20:00' }],
    };
    const warnings: string[] = [];
    const result = resolveNextContactWindow(now, utcWindows, DEFAULT_WINDOWS, {
      warn: (m) => { warnings.push(m); },
    });
    // UTC Mon 08:00
    expect(result.toISOString()).toBe('2026-04-27T08:00:00.000Z');
    expect(warnings.some((w) => w.includes('invalid timezone'))).toBe(true);
  });

  it('start-of-window exactly — returns now (inclusive)', () => {
    const now = at('2026-04-27T13:00:00.000Z'); // exact Mon 08:00 CDT
    const result = resolveNextContactWindow(now, null, DEFAULT_WINDOWS);
    expect(result.getTime()).toBe(now.getTime());
  });

  it('end-of-window exactly — returns next-day start (exclusive)', () => {
    const now = at('2026-04-28T01:00:00.000Z'); // Mon 20:00 CDT exact
    const result = resolveNextContactWindow(now, null, DEFAULT_WINDOWS);
    expect(result.toISOString()).toBe('2026-04-28T13:00:00.000Z');
  });

  it('one-minute before end → still in-window', () => {
    const now = at('2026-04-28T00:59:00.000Z'); // Mon 19:59 CDT
    const result = resolveNextContactWindow(now, null, DEFAULT_WINDOWS);
    expect(result.getTime()).toBe(now.getTime());
  });

  it('multi-window same day: hits earliest slot first', () => {
    const now = at('2026-04-27T11:00:00.000Z'); // Mon 06:00 CDT (before first)
    const split: CandidateContactWindows = {
      timezone: 'America/Chicago',
      windows: [
        { day: 'mon', start: '09:00', end: '11:00' },
        { day: 'mon', start: '14:00', end: '16:00' },
      ],
    };
    const result = resolveNextContactWindow(now, split, DEFAULT_WINDOWS);
    expect(result.toISOString()).toBe('2026-04-27T14:00:00.000Z'); // Mon 09:00 CDT
  });

  it('multi-window same day: falls through to second slot when past first', () => {
    const now = at('2026-04-27T17:00:00.000Z'); // Mon 12:00 CDT (between slots)
    const split: CandidateContactWindows = {
      timezone: 'America/Chicago',
      windows: [
        { day: 'mon', start: '09:00', end: '11:00' },
        { day: 'mon', start: '14:00', end: '16:00' },
      ],
    };
    const result = resolveNextContactWindow(now, split, DEFAULT_WINDOWS);
    expect(result.toISOString()).toBe('2026-04-27T19:00:00.000Z'); // Mon 14:00 CDT
  });

  it('invalid slot (start >= end) is skipped, valid slot picked', () => {
    // Invalid slot sorts FIRST (start=06:00) so we hit it before the valid one.
    const now = at('2026-04-27T11:00:00.000Z'); // Mon 06:00 CDT
    const bad: CandidateContactWindows = {
      timezone: 'America/Chicago',
      windows: [
        { day: 'mon', start: '06:00', end: '05:00' }, // invalid — sorts first
        { day: 'mon', start: '14:00', end: '16:00' }, // valid
      ],
    };
    const warnings: string[] = [];
    const result = resolveNextContactWindow(now, bad, DEFAULT_WINDOWS, {
      warn: (m) => { warnings.push(m); },
    });
    expect(result.toISOString()).toBe('2026-04-27T19:00:00.000Z'); // Mon 14:00 CDT
    expect(warnings.some((w) => w.includes('start>=end'))).toBe(true);
  });

  it('candidate with only Saturday window → resolves to Saturday', () => {
    const now = at('2026-04-27T10:00:00.000Z'); // Mon 05:00 CDT
    const sat: CandidateContactWindows = {
      timezone: 'America/Chicago',
      windows: [{ day: 'sat', start: '10:00', end: '12:00' }],
    };
    const result = resolveNextContactWindow(now, sat, DEFAULT_WINDOWS);
    // Sat 2026-05-02 10:00 CDT = 15:00 UTC
    expect(result.toISOString()).toBe('2026-05-02T15:00:00.000Z');
  });

  it('throws when defaultWindows is malformed', () => {
    const now = at('2026-04-27T11:00:00.000Z');
    const bad = { timezone: 'America/Chicago', windows: 'oops' } as unknown as CandidateContactWindows;
    expect(() => resolveNextContactWindow(now, null, bad)).toThrow(/malformed/);
  });

  it('respects a different timezone (UTC) cleanly', () => {
    const now = at('2026-04-27T07:00:00.000Z'); // Mon 07:00 UTC (before window)
    const utcWindows: CandidateContactWindows = {
      timezone: 'UTC',
      windows: [{ day: 'mon', start: '08:00', end: '20:00' }],
    };
    const result = resolveNextContactWindow(now, utcWindows, DEFAULT_WINDOWS);
    expect(result.toISOString()).toBe('2026-04-27T08:00:00.000Z');
  });

  it('Asia/Tokyo Sunday evening → Monday morning JST', () => {
    const now = at('2026-04-26T12:00:00.000Z'); // Sun 21:00 JST
    const jp: CandidateContactWindows = {
      timezone: 'Asia/Tokyo',
      windows: [{ day: 'mon', start: '09:00', end: '18:00' }],
    };
    const result = resolveNextContactWindow(now, jp, DEFAULT_WINDOWS);
    // Mon 2026-04-27 09:00 JST = 00:00 UTC
    expect(result.toISOString()).toBe('2026-04-27T00:00:00.000Z');
  });

  it('returns the candidate timezone, not the default, when candidate has a window', () => {
    const now = at('2026-04-27T05:00:00.000Z'); // Mon 00:00 CDT / 05:00 UTC
    const utcWindows: CandidateContactWindows = {
      timezone: 'UTC',
      windows: [{ day: 'mon', start: '06:00', end: '20:00' }],
    };
    const result = resolveNextContactWindow(now, utcWindows, DEFAULT_WINDOWS);
    expect(result.toISOString()).toBe('2026-04-27T06:00:00.000Z');
  });
});

describe('isCandidateContactWindows slot range validation (review patch F6)', () => {
  it('accepts a well-formed window', () => {
    // Via the public contract path — a well-formed window should pass.
    const now = at('2026-04-27T15:00:00.000Z');
    const good: CandidateContactWindows = {
      timezone: 'UTC',
      windows: [{ day: 'mon', start: '08:00', end: '20:00' }],
    };
    const result = resolveNextContactWindow(now, good, DEFAULT_WINDOWS);
    expect(result).toBeInstanceOf(Date);
  });

  it('rejects hour > 23 — falls back to default', () => {
    const now = at('2026-04-27T11:00:00.000Z'); // Mon 06:00 CDT
    // Start="25:00" passes regex but fails range check.
    const bad = {
      timezone: 'UTC',
      windows: [{ day: 'mon', start: '25:00', end: '23:00' }],
    } as unknown as CandidateContactWindows;
    const result = resolveNextContactWindow(now, bad, DEFAULT_WINDOWS);
    // Default CDT window kicks in → Mon 08:00 CDT = 13:00 UTC.
    expect(result.toISOString()).toBe('2026-04-27T13:00:00.000Z');
  });

  it('rejects minute > 59 — falls back to default', () => {
    const now = at('2026-04-27T11:00:00.000Z');
    const bad = {
      timezone: 'UTC',
      windows: [{ day: 'mon', start: '08:60', end: '20:00' }],
    } as unknown as CandidateContactWindows;
    const result = resolveNextContactWindow(now, bad, DEFAULT_WINDOWS);
    expect(result.toISOString()).toBe('2026-04-27T13:00:00.000Z');
  });

  it('rejects the infamous "25:70" — falls back to default instead of normalizing silently', () => {
    const now = at('2026-04-27T11:00:00.000Z');
    const bad = {
      timezone: 'UTC',
      windows: [{ day: 'mon', start: '25:70', end: '27:00' }],
    } as unknown as CandidateContactWindows;
    const result = resolveNextContactWindow(now, bad, DEFAULT_WINDOWS);
    expect(result.toISOString()).toBe('2026-04-27T13:00:00.000Z');
  });

  it('accepts boundary hour=23, minute=59', () => {
    const now = at('2026-04-27T11:00:00.000Z'); // Mon 06:00 CDT
    const boundary: CandidateContactWindows = {
      timezone: 'UTC',
      windows: [{ day: 'mon', start: '00:00', end: '23:59' }],
    };
    const result = resolveNextContactWindow(now, boundary, DEFAULT_WINDOWS);
    // Now is Mon 11:00 UTC, which is inside [00:00, 23:59) → return now.
    expect(result.getTime()).toBe(now.getTime());
  });
});

describe('isWithinContactWindow', () => {
  it('true when inside window', () => {
    const now = at('2026-04-27T15:00:00.000Z'); // Mon 10:00 CDT
    expect(isWithinContactWindow(now, DEFAULT_WINDOWS)).toBe(true);
  });

  it('false when outside window (weekend)', () => {
    const now = at('2026-05-02T15:00:00.000Z'); // Sat
    expect(isWithinContactWindow(now, DEFAULT_WINDOWS)).toBe(false);
  });

  it('false when before window start', () => {
    const now = at('2026-04-27T11:00:00.000Z'); // Mon 06:00 CDT
    expect(isWithinContactWindow(now, DEFAULT_WINDOWS)).toBe(false);
  });

  it('false when malformed', () => {
    const bad = { timezone: 'x', windows: 'oops' } as unknown as CandidateContactWindows;
    expect(isWithinContactWindow(new Date(), bad)).toBe(false);
  });
});
