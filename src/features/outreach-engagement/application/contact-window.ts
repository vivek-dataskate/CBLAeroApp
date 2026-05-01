import type {
  CandidateContactWindows,
  ContactWindowDay,
  ContactWindowSlot,
} from '../contracts/contact-window';
import { isCandidateContactWindows } from '../contracts/contact-window';

/**
 * Contact-window resolver (AC 7) — pure, I/O-free.
 *
 * Given the current instant, the candidate's windows, and the tenant default,
 * returns the next permissible send time. If `now` already falls inside a
 * window, returns `now`. Otherwise advances up to 14 days to find the next
 * window start in the candidate's timezone.
 *
 * DST handling: wall-clock arithmetic uses an iterative offset-resolution
 * step so spring-forward / fall-back transitions produce the correct UTC
 * instant without pulling in a full date library (dev-standards: no new
 * date lib — `Intl.DateTimeFormat` is sufficient for our needs).
 */

const MAX_LOOKAHEAD_DAYS = 14;

const DAY_INDEX: Record<ContactWindowDay, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};
const DAY_BY_INDEX: readonly ContactWindowDay[] = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
];

export interface ResolveNextContactWindowOptions {
  /** Structured warn sink — tests stub this. Defaults to `console.warn`. */
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Compute the next in-window instant.
 *
 * @param now              The current wall-clock instant (UTC Date).
 * @param candidateWindows Candidate-specific windows, or null to use default.
 * @param defaultWindows   Tenant default (loaded from policy_registry).
 * @param options          Optional warn sink for invalid-timezone reports.
 */
export function resolveNextContactWindow(
  now: Date,
  candidateWindows: CandidateContactWindows | null | undefined,
  defaultWindows: CandidateContactWindows,
  options?: ResolveNextContactWindowOptions,
): Date {
  const warn = options?.warn ?? defaultWarn;

  // If the candidate row exists but is malformed, fall back to default.
  const effective =
    candidateWindows && isCandidateContactWindows(candidateWindows) && candidateWindows.windows.length > 0
      ? candidateWindows
      : defaultWindows;

  // Default is the contract — it MUST be well-formed. Fail loudly if not.
  if (!isCandidateContactWindows(defaultWindows)) {
    throw new Error('resolveNextContactWindow: defaultWindows is malformed — policy_registry seed missing?');
  }

  let tz = effective.timezone;
  if (!isValidTimezone(tz)) {
    warn(`resolveNextContactWindow: invalid timezone "${tz}" — falling back to UTC`, { timezone: tz });
    tz = 'UTC';
  }

  const byDay = groupByDay(effective.windows);

  for (let delta = 0; delta <= MAX_LOOKAHEAD_DAYS; delta += 1) {
    const candidateInstant = delta === 0 ? now : startOfDayInTz(addDaysInTz(now, delta, tz), tz);
    const parts = getLocalParts(candidateInstant, tz);
    const dayName = DAY_BY_INDEX[parts.weekday];
    const slots = byDay.get(dayName);
    if (!slots || slots.length === 0) continue;

    // Sort slots by start time so we hit the earliest valid slot first.
    const sorted = [...slots].sort((a, b) => compareHHMM(a.start, b.start));

    for (const slot of sorted) {
      if (!isValidSlot(slot)) {
        warn(`resolveNextContactWindow: slot start>=end — skipping`, { slot });
        continue;
      }

      const startInstant = wallClockInTzToUtc(parts.year, parts.month, parts.day, slot.start, tz);
      const endInstant = wallClockInTzToUtc(parts.year, parts.month, parts.day, slot.end, tz);

      if (delta === 0) {
        if (now.getTime() < startInstant.getTime()) return startInstant;
        if (now.getTime() >= startInstant.getTime() && now.getTime() < endInstant.getTime()) {
          return now;
        }
        // now >= end of this slot — try the next slot (same day) or next day.
        continue;
      }

      // delta > 0 — the first usable slot on a future day is the answer.
      return startInstant;
    }
  }

  // 14-day exhaustion — extremely rare. Return the default start as a
  // diagnostic anchor and warn so the operator sees it.
  warn('resolveNextContactWindow: no in-window slot within 14 days — returning 14-day anchor', {
    tz,
    windows: effective.windows,
  });
  const fallbackDay = addDaysInTz(now, MAX_LOOKAHEAD_DAYS, tz);
  const fallbackParts = getLocalParts(fallbackDay, tz);
  return wallClockInTzToUtc(fallbackParts.year, fallbackParts.month, fallbackParts.day, '08:00', tz);
}

/**
 * Returns true when `now` already falls inside a permitted window. Exposed
 * for route-handler gating / unit tests.
 */
export function isWithinContactWindow(
  now: Date,
  windows: CandidateContactWindows,
): boolean {
  if (!isCandidateContactWindows(windows)) return false;
  const tz = isValidTimezone(windows.timezone) ? windows.timezone : 'UTC';
  const parts = getLocalParts(now, tz);
  const dayName = DAY_BY_INDEX[parts.weekday];

  for (const slot of windows.windows) {
    if (slot.day !== dayName) continue;
    if (!isValidSlot(slot)) continue;
    const start = wallClockInTzToUtc(parts.year, parts.month, parts.day, slot.start, tz);
    const end = wallClockInTzToUtc(parts.year, parts.month, parts.day, slot.end, tz);
    if (now.getTime() >= start.getTime() && now.getTime() < end.getTime()) return true;
  }
  return false;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
  hour: number;  // 0-23
  minute: number;
  second: number;
  weekday: number; // 0=sun ... 6=sat
}

function defaultWarn(msg: string, meta?: Record<string, unknown>): void {
  console.warn(
    JSON.stringify({ level: 'warn', module: 'contact-window', action: 'resolve', msg, ...meta }),
  );
}

function groupByDay(windows: ContactWindowSlot[]): Map<ContactWindowDay, ContactWindowSlot[]> {
  const out = new Map<ContactWindowDay, ContactWindowSlot[]>();
  for (const w of windows) {
    const existing = out.get(w.day) ?? [];
    existing.push(w);
    out.set(w.day, existing);
  }
  return out;
}

function isValidSlot(slot: ContactWindowSlot): boolean {
  return compareHHMM(slot.start, slot.end) < 0;
}

function compareHHMM(a: string, b: string): number {
  return a.localeCompare(b);
}

function isValidTimezone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Extract Y/M/D/H/M/S + weekday of `instant` as observed in `tz`. */
function getLocalParts(instant: Date, tz: string): LocalParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }

  // Intl uses 24:00 at midnight for some locales/hour configurations — normalise.
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);

  const weekdayStr = (parts.weekday ?? 'Sun').toLowerCase().slice(0, 3);
  const weekdayMap: Record<string, number> = {
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  };
  const weekday = weekdayMap[weekdayStr] ?? 0;

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second ?? '0'),
    weekday,
  };
}

/**
 * Convert a local wall-clock (year, month, day, HH:MM) in `tz` to a UTC Date.
 *
 * Algorithm: offset-resolution by two-pass iteration. DST transitions are
 * handled because the first pass establishes the offset band and the second
 * re-checks at the shifted instant — if the offset changed, we reuse the
 * corrected value.
 */
function wallClockInTzToUtc(
  year: number,
  month: number,
  day: number,
  hhmm: string,
  tz: string,
): Date {
  const [hh, mm] = hhmm.split(':').map(Number);
  const tentative = new Date(Date.UTC(year, month - 1, day, hh, mm, 0));
  const offset1 = tzOffsetMs(tentative, tz);
  const adjusted = new Date(tentative.getTime() - offset1);
  const offset2 = tzOffsetMs(adjusted, tz);
  if (offset1 === offset2) return adjusted;
  return new Date(tentative.getTime() - offset2);
}

/**
 * Offset of `tz` relative to UTC at `instant`, in ms. Positive means local is
 * ahead of UTC (e.g. CET = +3_600_000).
 */
function tzOffsetMs(instant: Date, tz: string): number {
  const parts = getLocalParts(instant, tz);
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asIfUtc - instant.getTime();
}

/** Returns an instant `days` calendar-days later than `instant` in `tz`. */
function addDaysInTz(instant: Date, days: number, tz: string): Date {
  const p = getLocalParts(instant, tz);
  // Build wall-clock noon on the target day (noon avoids DST edge cases when
  // iterating by calendar day).
  const targetMs = Date.UTC(p.year, p.month - 1, p.day + days, 12, 0, 0);
  return wallClockInTzToUtc(
    new Date(targetMs).getUTCFullYear(),
    new Date(targetMs).getUTCMonth() + 1,
    new Date(targetMs).getUTCDate(),
    '12:00',
    tz,
  );
}

/** Returns the start-of-day (00:00 local) for the day containing `instant`. */
function startOfDayInTz(instant: Date, tz: string): Date {
  const p = getLocalParts(instant, tz);
  return wallClockInTzToUtc(p.year, p.month, p.day, '00:00', tz);
}

// Re-export for tests.
export const __internal = {
  tzOffsetMs,
  wallClockInTzToUtc,
  getLocalParts,
  addDaysInTz,
  startOfDayInTz,
  DAY_INDEX,
};
