/**
 * Click tracking — generates unique tokens for SMS links and records engagement.
 */

import { randomBytes } from "crypto";
import { getSupabaseAdminClient } from "../persistence";

/**
 * Generate a URL-safe tracking token (12 chars, base36).
 */
export function generateTrackingToken(): string {
  return randomBytes(9).toString("base64url").slice(0, 12);
}

/**
 * Build the full tracking URL for embedding in SMS messages.
 */
export function buildTrackingUrl(token: string): string {
  const baseUrl =
    process.env.CBL_APP_URL ?? "http://localhost:3000";
  return `${baseUrl}/api/outreach/track/${token}`;
}

/**
 * Record a click event on a tracking token.
 * Idempotent: sets clicked_at on first click, increments click_count on all clicks.
 */
export async function recordClick(token: string): Promise<{
  found: boolean;
  sendId: string | null;
  candidateId: string | null;
}> {
  const client = getSupabaseAdminClient();

  // Look up the send by tracking token
  const { data: send, error: lookupError } = await client
    .from("sms_sends")
    .select("id, candidate_id, clicked_at, click_count")
    .eq("tracking_token", token)
    .single();

  if (lookupError || !send) {
    return { found: false, sendId: null, candidateId: null };
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    click_count: ((send.click_count as number) ?? 0) + 1,
  };

  // Set clicked_at only on first click
  if (!send.clicked_at) {
    updates.clicked_at = now;
  }

  const { error: updateError } = await client
    .from("sms_sends")
    .update(updates)
    .eq("id", send.id);

  if (updateError) {
    console.error(`Failed to record click for token ${token}:`, updateError);
  }

  return {
    found: true,
    sendId: send.id as string,
    candidateId: send.candidate_id as string,
  };
}
