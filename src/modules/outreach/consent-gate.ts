/**
 * Consent gate — pure check for SMS send eligibility.
 * Always queries fresh (no caching) per TCPA compliance.
 */

import { getChannelPreferences } from "./consent-repository";

export type ConsentCheckResult = {
  allowed: boolean;
  blockedReason: string | null;
};

/**
 * Check if SMS can be sent to a candidate.
 * Always queries fresh opt-out state — NEVER cache this.
 */
export async function canSendSMS(
  candidateId: string,
  tenantId: string,
): Promise<ConsentCheckResult> {
  const prefs = await getChannelPreferences(candidateId, tenantId);

  // No preferences row = default opted-in
  if (!prefs) {
    return { allowed: true, blockedReason: null };
  }

  if (!prefs.smsOptedIn) {
    return {
      allowed: false,
      blockedReason: `Candidate opted out of SMS on ${prefs.smsOptOutAt ?? "unknown date"}`,
    };
  }

  if (prefs.smsOptOutAt) {
    return {
      allowed: false,
      blockedReason: `SMS opt-out recorded at ${prefs.smsOptOutAt}`,
    };
  }

  return { allowed: true, blockedReason: null };
}
