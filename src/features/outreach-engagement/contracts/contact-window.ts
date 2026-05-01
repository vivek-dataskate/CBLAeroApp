/**
 * Story 3-1 canonical contact-window types (AC 7).
 *
 * Shape matches `candidate_channel_preferences.contact_windows` JSONB and
 * the default policy seeded at `policy_registry.family='outreach_defaults',
 * key='sms_default_contact_window'`.
 */

export const CONTACT_WINDOW_DAY_VALUES = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
] as const;
export type ContactWindowDay = (typeof CONTACT_WINDOW_DAY_VALUES)[number];

export interface ContactWindowSlot {
  day: ContactWindowDay;
  /** `HH:MM` 24-hour local-time string in the candidate's timezone. */
  start: string;
  /** `HH:MM` 24-hour local-time string in the candidate's timezone. */
  end: string;
}

export interface CandidateContactWindows {
  /** IANA timezone identifier, e.g. 'America/Chicago'. */
  timezone: string;
  windows: ContactWindowSlot[];
}

export function isContactWindowDay(value: unknown): value is ContactWindowDay {
  return typeof value === 'string' && (CONTACT_WINDOW_DAY_VALUES as readonly string[]).includes(value);
}

/**
 * Narrowing type-guard for runtime-loaded JSONB. Returns true only when the
 * shape is a well-formed CandidateContactWindows — otherwise callers should
 * fall back to the default policy.
 *
 * Validates BOTH the HH:MM format AND the semantic range (hours 0-23,
 * minutes 0-59). Without the range check, values like `"25:70"` passed the
 * regex and were silently normalized by `Date.UTC(...,25,70,...)` into the
 * next day — sending SMS at the wrong wall-clock time (review patch F6).
 */
export function isCandidateContactWindows(value: unknown): value is CandidateContactWindows {
  if (!value || typeof value !== 'object') return false;
  const v = value as { timezone?: unknown; windows?: unknown };
  if (typeof v.timezone !== 'string' || v.timezone.length === 0) return false;
  if (!Array.isArray(v.windows)) return false;
  for (const w of v.windows) {
    if (!w || typeof w !== 'object') return false;
    const slot = w as { day?: unknown; start?: unknown; end?: unknown };
    if (!isContactWindowDay(slot.day)) return false;
    if (!isValidHHMM(slot.start)) return false;
    if (!isValidHHMM(slot.end)) return false;
  }
  return true;
}

function isValidHHMM(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hh, mm] = value.split(':').map(Number);
  if (hh < 0 || hh > 23) return false;
  if (mm < 0 || mm > 59) return false;
  return true;
}
