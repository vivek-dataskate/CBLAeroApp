/**
 * Repository for candidate channel preferences and opt-out management.
 */

import { getSupabaseAdminClient } from "../persistence";

export type ChannelPreferences = {
  id: string;
  candidateId: string;
  tenantId: string;
  smsOptedIn: boolean;
  smsOptOutAt: string | null;
  smsOptOutReason: string | null;
  emailOptedIn: boolean;
  emailOptOutAt: string | null;
  emailOptOutReason: string | null;
  contactWindows: Record<string, unknown> | null;
  updatedAt: string;
  updatedBy: string | null;
};

function mapRow(row: Record<string, unknown>): ChannelPreferences {
  return {
    id: row.id as string,
    candidateId: row.candidate_id as string,
    tenantId: row.tenant_id as string,
    smsOptedIn: row.sms_opted_in as boolean,
    smsOptOutAt: row.sms_opt_out_at as string | null,
    smsOptOutReason: row.sms_opt_out_reason as string | null,
    emailOptedIn: row.email_opted_in as boolean,
    emailOptOutAt: row.email_opt_out_at as string | null,
    emailOptOutReason: row.email_opt_out_reason as string | null,
    contactWindows: row.contact_windows as Record<string, unknown> | null,
    updatedAt: row.updated_at as string,
    updatedBy: row.updated_by as string | null,
  };
}

/**
 * Get channel preferences for a candidate.
 * Returns null if no preferences exist (defaults apply: opted-in for all).
 */
export async function getChannelPreferences(
  candidateId: string,
  tenantId: string,
): Promise<ChannelPreferences | null> {
  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("candidate_channel_preferences")
    .select("*")
    .eq("candidate_id", candidateId)
    .eq("tenant_id", tenantId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // not found — defaults apply
    throw new Error(`Failed to get channel preferences: ${error.message}`);
  }
  return data ? mapRow(data) : null;
}

/**
 * Record an opt-out for a candidate on a specific channel.
 * Creates the preferences row if it doesn't exist.
 */
export async function recordOptOut(
  candidateId: string,
  tenantId: string,
  channel: "sms" | "email",
  reason: string,
  updatedBy?: string,
): Promise<void> {
  const client = getSupabaseAdminClient();
  const now = new Date().toISOString();

  const optOutFields =
    channel === "sms"
      ? {
          sms_opted_in: false,
          sms_opt_out_at: now,
          sms_opt_out_reason: reason,
        }
      : {
          email_opted_in: false,
          email_opt_out_at: now,
          email_opt_out_reason: reason,
        };

  // Upsert: create if not exists, update if exists
  const { error } = await client
    .from("candidate_channel_preferences")
    .upsert(
      {
        candidate_id: candidateId,
        tenant_id: tenantId,
        ...optOutFields,
        updated_at: now,
        updated_by: updatedBy ?? "system",
      },
      { onConflict: "candidate_id" },
    );

  if (error) throw new Error(`Failed to record opt-out: ${error.message}`);
}
