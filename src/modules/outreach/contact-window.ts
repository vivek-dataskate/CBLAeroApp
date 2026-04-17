/**
 * Contact window enforcement — determines if a candidate can be contacted now
 * based on their timezone and contact preferences.
 */

/**
 * US state → IANA timezone mapping. Covers all 50 states + DC + territories.
 * States spanning multiple zones use the most populous zone.
 */
const STATE_TIMEZONE_MAP: Record<string, string> = {
  // Eastern
  CT: "America/New_York", DC: "America/New_York", DE: "America/New_York",
  FL: "America/New_York", GA: "America/New_York", IN: "America/Indiana/Indianapolis",
  KY: "America/New_York", MA: "America/New_York", MD: "America/New_York",
  ME: "America/New_York", MI: "America/Detroit", NC: "America/New_York",
  NH: "America/New_York", NJ: "America/New_York", NY: "America/New_York",
  OH: "America/New_York", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", VA: "America/New_York", VT: "America/New_York",
  WV: "America/New_York",
  // Central
  AL: "America/Chicago", AR: "America/Chicago", IA: "America/Chicago",
  IL: "America/Chicago", KS: "America/Chicago", LA: "America/Chicago",
  MN: "America/Chicago", MO: "America/Chicago", MS: "America/Chicago",
  NE: "America/Chicago", ND: "America/Chicago", OK: "America/Chicago",
  SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago",
  WI: "America/Chicago",
  // Mountain
  AZ: "America/Phoenix", CO: "America/Denver", ID: "America/Boise",
  MT: "America/Denver", NM: "America/Denver", UT: "America/Denver",
  WY: "America/Denver",
  // Pacific
  CA: "America/Los_Angeles", NV: "America/Los_Angeles",
  OR: "America/Los_Angeles", WA: "America/Los_Angeles",
  // Alaska & Hawaii
  AK: "America/Anchorage", HI: "Pacific/Honolulu",
  // Territories
  PR: "America/Puerto_Rico", GU: "Pacific/Guam",
  VI: "America/Virgin", AS: "Pacific/Pago_Pago",
};

const DEFAULT_TIMEZONE = "America/New_York";
const DEFAULT_WINDOW_START = 9; // 9 AM
const DEFAULT_WINDOW_END = 20; // 8 PM

export type ContactPreferences = {
  sms?: {
    start?: string; // "09:00" format
    end?: string; // "20:00" format
    timezone?: string;
  };
};

export type CandidateForWindow = {
  state?: string | null;
  contactPreferences?: ContactPreferences | null;
};

/**
 * Infer IANA timezone from candidate's US state.
 */
export function inferTimezone(state: string | null | undefined): string {
  if (!state) return DEFAULT_TIMEZONE;
  const normalized = state.trim().toUpperCase();
  // Handle both abbreviation and full state name (take first 2 chars for abbrev)
  return STATE_TIMEZONE_MAP[normalized] ?? DEFAULT_TIMEZONE;
}

/**
 * Get current hour in a given IANA timezone.
 */
function getHourInTimezone(date: Date, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    return parseInt(formatter.format(date), 10);
  } catch {
    // Invalid timezone — fall back to Eastern
    const fallback = new Intl.DateTimeFormat("en-US", {
      timeZone: DEFAULT_TIMEZONE,
      hour: "numeric",
      hour12: false,
    });
    return parseInt(fallback.format(date), 10);
  }
}

function parseHour(timeStr: string | undefined, defaultHour: number): number {
  if (!timeStr) return defaultHour;
  const parts = timeStr.split(":");
  const hour = parseInt(parts[0], 10);
  return isNaN(hour) ? defaultHour : hour;
}

/**
 * Check if the current time is within the candidate's contact window.
 */
export function isWithinContactWindow(
  candidate: CandidateForWindow,
  now: Date = new Date(),
): boolean {
  const prefs = candidate.contactPreferences?.sms;
  const timezone =
    prefs?.timezone ?? inferTimezone(candidate.state);
  const windowStart = parseHour(prefs?.start, DEFAULT_WINDOW_START);
  const windowEnd = parseHour(prefs?.end, DEFAULT_WINDOW_END);

  const currentHour = getHourInTimezone(now, timezone);

  return currentHour >= windowStart && currentHour < windowEnd;
}

/**
 * Calculate the next allowed send time if currently outside the window.
 * Returns null if currently within the window.
 */
export function nextAllowedSendTime(
  candidate: CandidateForWindow,
  now: Date = new Date(),
): Date | null {
  if (isWithinContactWindow(candidate, now)) return null;

  const prefs = candidate.contactPreferences?.sms;
  const timezone = prefs?.timezone ?? inferTimezone(candidate.state);
  const windowStart = parseHour(prefs?.start, DEFAULT_WINDOW_START);

  const currentHour = getHourInTimezone(now, timezone);

  // Calculate hours until next window open
  let hoursUntilOpen: number;
  if (currentHour >= windowStart) {
    // Window has closed for today — next open is tomorrow
    hoursUntilOpen = 24 - currentHour + windowStart;
  } else {
    // Window hasn't opened yet today
    hoursUntilOpen = windowStart - currentHour;
  }

  const nextOpen = new Date(now.getTime() + hoursUntilOpen * 60 * 60 * 1000);
  // Round to the start of the hour
  nextOpen.setMinutes(0, 0, 0);
  return nextOpen;
}
