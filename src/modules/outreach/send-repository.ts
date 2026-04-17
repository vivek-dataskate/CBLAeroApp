/**
 * Repository for SMS send records — create, update, query.
 */

import { getSupabaseAdminClient } from "../persistence";

export type SmsSend = {
  id: string;
  tenantId: string;
  campaignId: string | null;
  candidateId: string;
  templateId: string;
  templateVersion: number;
  renderedBody: string | null;
  renderedBodyHash: string | null;
  contextParams: Record<string, unknown>;
  provider: string | null;
  providerMessageId: string | null;
  status: string;
  deliveryAttemptCount: number;
  scheduledFor: string;
  sentAt: string | null;
  blockedReason: string | null;
  senderUserId: string | null;
  trackingToken: string | null;
  trackingUrl: string | null;
  clickedAt: string | null;
  clickCount: number;
  createdAt: string;
};

type CreateSendInput = {
  tenantId: string;
  candidateId: string;
  templateId: string;
  templateVersion: number;
  renderedBody: string;
  renderedBodyHash: string;
  contextParams: Record<string, unknown>;
  scheduledFor: Date;
  senderUserId: string;
  trackingToken?: string;
  trackingUrl?: string;
  campaignId?: string;
};

function mapRow(row: Record<string, unknown>): SmsSend {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    campaignId: row.campaign_id as string | null,
    candidateId: row.candidate_id as string,
    templateId: row.template_id as string,
    templateVersion: row.template_version as number,
    renderedBody: row.rendered_body as string | null,
    renderedBodyHash: row.rendered_body_hash as string | null,
    contextParams: (row.context_params as Record<string, unknown>) ?? {},
    provider: row.provider as string | null,
    providerMessageId: row.provider_message_id as string | null,
    status: row.status as string,
    deliveryAttemptCount: row.delivery_attempt_count as number,
    scheduledFor: row.scheduled_for as string,
    sentAt: row.sent_at as string | null,
    blockedReason: row.blocked_reason as string | null,
    senderUserId: row.sender_user_id as string | null,
    trackingToken: row.tracking_token as string | null,
    trackingUrl: row.tracking_url as string | null,
    clickedAt: row.clicked_at as string | null,
    clickCount: (row.click_count as number) ?? 0,
    createdAt: row.created_at as string,
  };
}

/**
 * Create a single SMS send record.
 */
export async function createSend(input: CreateSendInput): Promise<SmsSend> {
  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("sms_sends")
    .insert({
      tenant_id: input.tenantId,
      candidate_id: input.candidateId,
      template_id: input.templateId,
      template_version: input.templateVersion,
      rendered_body: input.renderedBody,
      rendered_body_hash: input.renderedBodyHash,
      context_params: input.contextParams,
      scheduled_for: input.scheduledFor.toISOString(),
      sender_user_id: input.senderUserId,
      tracking_token: input.trackingToken,
      tracking_url: input.trackingUrl,
      campaign_id: input.campaignId,
      status: "pending",
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create SMS send: ${error.message}`);
  return mapRow(data);
}

/**
 * Create multiple SMS send records in a batch.
 */
export async function createBatchSends(
  inputs: CreateSendInput[],
): Promise<number> {
  if (inputs.length === 0) return 0;
  const client = getSupabaseAdminClient();

  const rows = inputs.map((input) => ({
    tenant_id: input.tenantId,
    candidate_id: input.candidateId,
    template_id: input.templateId,
    template_version: input.templateVersion,
    rendered_body: input.renderedBody,
    rendered_body_hash: input.renderedBodyHash,
    context_params: input.contextParams,
    scheduled_for: input.scheduledFor.toISOString(),
    sender_user_id: input.senderUserId,
    tracking_token: input.trackingToken,
    tracking_url: input.trackingUrl,
    campaign_id: input.campaignId,
    status: "pending",
  }));

  // Batch in chunks of 500
  let created = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await client.from("sms_sends").insert(batch);
    if (error)
      throw new Error(
        `Failed to create batch SMS sends (batch ${i}): ${error.message}`,
      );
    created += batch.length;
  }

  return created;
}

/**
 * Get due sends — pending sends whose scheduled_for is in the past.
 */
export async function getDueSends(
  tenantId: string,
  limit: number = 100,
): Promise<SmsSend[]> {
  const client = getSupabaseAdminClient();
  const now = new Date().toISOString();

  const { data, error } = await client
    .from("sms_sends")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed to get due sends: ${error.message}`);
  return (data ?? []).map(mapRow);
}

/**
 * Update the status of a send record.
 */
export async function updateSendStatus(
  id: string,
  updates: {
    status: string;
    provider?: string;
    providerMessageId?: string;
    sentAt?: Date;
    blockedReason?: string;
    contactWindowDeferredUntil?: Date;
  },
): Promise<void> {
  const client = getSupabaseAdminClient();
  const row: Record<string, unknown> = { status: updates.status };
  if (updates.provider) row.provider = updates.provider;
  if (updates.providerMessageId)
    row.provider_message_id = updates.providerMessageId;
  if (updates.sentAt) row.sent_at = updates.sentAt.toISOString();
  if (updates.blockedReason) row.blocked_reason = updates.blockedReason;
  if (updates.contactWindowDeferredUntil)
    row.contact_window_deferred_until =
      updates.contactWindowDeferredUntil.toISOString();
  if (updates.status !== "pending") {
    row.delivery_attempt_count = 1; // will be incremented properly by retry logic in Story 3.5
    row.last_attempt_at = new Date().toISOString();
  }

  const { error } = await client.from("sms_sends").update(row).eq("id", id);
  if (error)
    throw new Error(`Failed to update send status: ${error.message}`);
}

/**
 * Get send history with optional filters.
 */
export async function getSendHistory(params: {
  tenantId: string;
  candidateId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<SmsSend[]> {
  const client = getSupabaseAdminClient();
  let query = client
    .from("sms_sends")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .order("created_at", { ascending: false })
    .limit(params.limit ?? 50);

  if (params.candidateId) query = query.eq("candidate_id", params.candidateId);
  if (params.status) query = query.eq("status", params.status);
  if (params.offset) query = query.range(params.offset, (params.offset ?? 0) + (params.limit ?? 50) - 1);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to get send history: ${error.message}`);
  return (data ?? []).map(mapRow);
}
