/**
 * SMS send repository — Story 3-1 Task 2.6.
 *
 * All `sms_sends` access goes through here (dev-standards §4.5). In addition
 * to the CRUD surface, this module owns the dual-write audit-log pattern:
 * every status transition that matters for compliance also appends a row to
 * `cblaero_app.outreach_audit_log`.
 */
import {
  getSupabaseAdminClient,
  isSupabaseConfigured,
  shouldUseInMemoryPersistenceForTests,
} from '@/modules/persistence';
import type {
  SmsSend,
  SmsSendInsertRow,
  SmsSendStatus,
} from '../contracts/sms-send';
import { SMS_SEND_STATUS_VALUES } from '../contracts/sms-send';

export class SmsSendNotFoundError extends Error {
  constructor(msg = 'SMS send not found') {
    super(msg);
    this.name = 'SmsSendNotFoundError';
  }
}

type SmsSendRow = {
  id: string;
  tenant_id: string;
  campaign_id: string | null;
  candidate_id: string;
  template_id: string;
  template_version: number;
  rendered_body: string | null;
  rendered_body_hash: string | null;
  context_params: unknown;
  provider: string | null;
  provider_message_id: string | null;
  provider_idempotency_key: string | null;
  status: string;
  delivery_attempt_count: number;
  last_attempt_at: string | null;
  scheduled_for: string;
  sent_at: string | null;
  contact_window_deferred_until: string | null;
  blocked_reason: string | null;
  sender_user_id: string | null;
  tracking_token: string | null;
  tracking_url: string | null;
  clicked_at: string | null;
  click_count: number;
  response_received_at: string | null;
  response_body: string | null;
  response_type: string | null;
  created_at: string;
};

function toSmsSend(row: SmsSendRow): SmsSend {
  const status: SmsSendStatus = (SMS_SEND_STATUS_VALUES as readonly string[]).includes(row.status)
    ? (row.status as SmsSendStatus)
    : 'failed';
  const responseType =
    row.response_type === 'opt_out' ||
    row.response_type === 'affirmative' ||
    row.response_type === 'negative' ||
    row.response_type === 'freeform'
      ? (row.response_type as SmsSend['responseType'])
      : null;
  const ctx =
    row.context_params && typeof row.context_params === 'object' && !Array.isArray(row.context_params)
      ? (row.context_params as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    tenantId: row.tenant_id,
    campaignId: row.campaign_id,
    candidateId: row.candidate_id,
    templateId: row.template_id,
    templateVersion: row.template_version,
    renderedBody: row.rendered_body,
    renderedBodyHash: row.rendered_body_hash,
    contextParams: ctx,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    providerIdempotencyKey: row.provider_idempotency_key,
    status,
    deliveryAttemptCount: row.delivery_attempt_count,
    lastAttemptAt: row.last_attempt_at,
    scheduledFor: row.scheduled_for,
    sentAt: row.sent_at,
    contactWindowDeferredUntil: row.contact_window_deferred_until,
    blockedReason: row.blocked_reason,
    senderUserId: row.sender_user_id,
    trackingToken: row.tracking_token,
    trackingUrl: row.tracking_url,
    clickedAt: row.clicked_at,
    clickCount: row.click_count,
    responseReceivedAt: row.response_received_at,
    responseBody: row.response_body,
    responseType,
    createdAt: row.created_at,
  };
}

// ── In-memory store (test mode only) ────────────────────────────────────────
const sendStore = new Map<string, SmsSendRow>();
const auditStore: AuditLogRow[] = [];
let nextSendSeq = 1;

export function seedSmsSendForTest(send: SmsSend): void {
  sendStore.set(send.id, {
    id: send.id,
    tenant_id: send.tenantId,
    campaign_id: send.campaignId,
    candidate_id: send.candidateId,
    template_id: send.templateId,
    template_version: send.templateVersion,
    rendered_body: send.renderedBody,
    rendered_body_hash: send.renderedBodyHash,
    context_params: send.contextParams,
    provider: send.provider,
    provider_message_id: send.providerMessageId,
    provider_idempotency_key: send.providerIdempotencyKey,
    status: send.status,
    delivery_attempt_count: send.deliveryAttemptCount,
    last_attempt_at: send.lastAttemptAt,
    scheduled_for: send.scheduledFor,
    sent_at: send.sentAt,
    contact_window_deferred_until: send.contactWindowDeferredUntil,
    blocked_reason: send.blockedReason,
    sender_user_id: send.senderUserId,
    tracking_token: send.trackingToken,
    tracking_url: send.trackingUrl,
    clicked_at: send.clickedAt,
    click_count: send.clickCount,
    response_received_at: send.responseReceivedAt,
    response_body: send.responseBody,
    response_type: send.responseType,
    created_at: send.createdAt,
  });
}

export function clearSmsSendStoreForTest(): void {
  sendStore.clear();
  auditStore.length = 0;
  nextSendSeq = 1;
  optOutStore.clear();
}

export function getAuditLogForTest(): AuditLogRow[] {
  return [...auditStore];
}

function mintSendId(): string {
  return `send-${String(nextSendSeq++).padStart(8, '0')}`;
}

// ── In-memory opt-out index (test mode only) ────────────────────────────────
// Key is `${tenantId}::${candidateId}` → true when the candidate has opted
// out of SMS. Tests populate this via `seedOptOutForTest`.
const optOutStore = new Map<string, boolean>();

export function seedOptOutForTest(tenantId: string, candidateId: string, optedIn: boolean): void {
  optOutStore.set(`${tenantId}::${candidateId}`, optedIn);
}

export async function isCandidateOptedInSms(
  tenantId: string,
  candidateId: string,
): Promise<boolean> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const v = optOutStore.get(`${tenantId}::${candidateId}`);
    // Default opt-IN when no row exists (architecture §6 matches DB default).
    return v === undefined ? true : v;
  }
  if (!isSupabaseConfigured()) return true;
  const db = getSupabaseAdminClient();
  const { data, error } = await db
    .from('candidate_channel_preferences')
    .select('sms_opted_in')
    .eq('tenant_id', tenantId)
    .eq('candidate_id', candidateId)
    .maybeSingle();
  if (error) throw new Error(`[SmsSendRepository] opt-in lookup failed: ${error.message}`);
  if (!data) return true;
  return data.sms_opted_in !== false;
}

// ── Audit log dual-write ────────────────────────────────────────────────────

export type OutreachAuditChannel = 'sms' | 'email';
export type OutreachDeliveryStatus =
  | 'pending'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'bounced'
  | 'undeliverable'
  | 'blocked_opt_out'
  | 'blocked_cooldown'
  | 'deferred_window';

export interface AuditLogRow {
  tenantId: string;
  channel: OutreachAuditChannel;
  sendId: string | null;
  candidateId: string;
  senderUserId: string | null;
  senderRole: string | null;
  templateId: string | null;
  templateAgenda: string | null;
  deliveryStatus: OutreachDeliveryStatus;
  contentHash: string | null;
  compliancePassed: boolean | null;
  blockedReason: string | null;
  traceId: string | null;
  correlationId: string | null;
  eventEnvelope: Record<string, unknown> | null;
}

export async function writeOutreachAuditLog(row: AuditLogRow): Promise<void> {
  if (shouldUseInMemoryPersistenceForTests()) {
    auditStore.push({ ...row });
    return;
  }
  if (!isSupabaseConfigured()) return;

  const db = getSupabaseAdminClient();
  const { error } = await db.from('outreach_audit_log').insert({
    tenant_id: row.tenantId,
    channel: row.channel,
    send_id: row.sendId,
    candidate_id: row.candidateId,
    sender_user_id: row.senderUserId,
    sender_role: row.senderRole,
    template_id: row.templateId,
    template_agenda: row.templateAgenda,
    delivery_status: row.deliveryStatus,
    content_hash: row.contentHash,
    compliance_check_passed: row.compliancePassed,
    blocked_reason: row.blockedReason,
    trace_id: row.traceId,
    correlation_id: row.correlationId,
    event_envelope: row.eventEnvelope,
  });
  if (error) throw new Error(`[SmsSendRepository] audit write failed: ${error.message}`);
}

// ── Send CRUD ───────────────────────────────────────────────────────────────

export async function insertSmsSend(row: SmsSendInsertRow): Promise<SmsSend> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const id = mintSendId();
    const nowIso = new Date().toISOString();
    const persisted: SmsSendRow = {
      id,
      tenant_id: row.tenantId,
      campaign_id: row.campaignId ?? null,
      candidate_id: row.candidateId,
      template_id: row.templateId,
      template_version: row.templateVersion,
      rendered_body: row.renderedBody ?? null,
      rendered_body_hash: row.renderedBodyHash ?? null,
      context_params: row.contextParams ?? {},
      provider: null,
      provider_message_id: null,
      provider_idempotency_key: row.providerIdempotencyKey ?? null,
      status: 'pending',
      delivery_attempt_count: 0,
      last_attempt_at: null,
      scheduled_for: row.scheduledFor,
      sent_at: null,
      contact_window_deferred_until: null,
      blocked_reason: null,
      sender_user_id: row.senderUserId ?? null,
      tracking_token: row.trackingToken ?? null,
      tracking_url: row.trackingUrl ?? null,
      clicked_at: null,
      click_count: 0,
      response_received_at: null,
      response_body: null,
      response_type: null,
      created_at: nowIso,
    };
    sendStore.set(id, persisted);
    return toSmsSend(persisted);
  }

  const db = getSupabaseAdminClient();
  const { data, error } = await db
    .from('sms_sends')
    .insert({
      tenant_id: row.tenantId,
      campaign_id: row.campaignId ?? null,
      candidate_id: row.candidateId,
      template_id: row.templateId,
      template_version: row.templateVersion,
      rendered_body: row.renderedBody ?? null,
      rendered_body_hash: row.renderedBodyHash ?? null,
      context_params: row.contextParams ?? {},
      status: 'pending',
      scheduled_for: row.scheduledFor,
      sender_user_id: row.senderUserId ?? null,
      tracking_token: row.trackingToken ?? null,
      tracking_url: row.trackingUrl ?? null,
      provider_idempotency_key: row.providerIdempotencyKey ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(`[SmsSendRepository] insert failed: ${error.message}`);
  return toSmsSend(data as SmsSendRow);
}

export async function insertSmsSendsBulk(
  rows: SmsSendInsertRow[],
): Promise<{ inserted: number; skipped: number }> {
  if (rows.length === 0) return { inserted: 0, skipped: 0 };
  if (rows.length > 500) {
    throw new Error(`[SmsSendRepository] bulk batch size ${rows.length} exceeds 500`);
  }

  if (shouldUseInMemoryPersistenceForTests()) {
    let inserted = 0;
    let skipped = 0;
    for (const r of rows) {
      if (!r.tenantId || !r.candidateId || !r.templateId || !r.templateVersion || !r.scheduledFor) {
        skipped += 1;
        continue;
      }
      const optedIn = await isCandidateOptedInSms(r.tenantId, r.candidateId);
      if (!optedIn) {
        skipped += 1;
        continue;
      }
      await insertSmsSend(r);
      inserted += 1;
    }
    return { inserted, skipped };
  }

  const db = getSupabaseAdminClient();
  const payload = rows.map((r) => ({
    tenant_id: r.tenantId,
    campaign_id: r.campaignId ?? null,
    candidate_id: r.candidateId,
    template_id: r.templateId,
    template_version: r.templateVersion,
    rendered_body: r.renderedBody ?? null,
    rendered_body_hash: r.renderedBodyHash ?? null,
    context_params: r.contextParams ?? {},
    scheduled_for: r.scheduledFor,
    sender_user_id: r.senderUserId ?? null,
    tracking_token: r.trackingToken ?? null,
    tracking_url: r.trackingUrl ?? null,
    provider_idempotency_key: r.providerIdempotencyKey ?? null,
  }));
  const { data, error } = await db.rpc('insert_sms_sends_bulk', { p_rows: payload });
  if (error) throw new Error(`[SmsSendRepository] bulk RPC failed: ${error.message}`);
  const row = Array.isArray(data) ? (data[0] as { inserted: number; skipped: number }) : (data as { inserted: number; skipped: number });
  return { inserted: Number(row?.inserted ?? 0), skipped: Number(row?.skipped ?? 0) };
}

export async function claimDueSmsSends(
  tenantId: string,
  batchSize: number,
  nowIso?: string,
): Promise<SmsSend[]> {
  if (batchSize <= 0 || batchSize > 500) {
    throw new Error(`[SmsSendRepository] batchSize must be in (0, 500], got ${batchSize}`);
  }

  if (shouldUseInMemoryPersistenceForTests()) {
    const now = nowIso ? new Date(nowIso) : new Date();
    const candidates = [...sendStore.values()]
      .filter(
        (r) =>
          r.tenant_id === tenantId &&
          r.status === 'pending' &&
          new Date(r.scheduled_for).getTime() <= now.getTime(),
      )
      .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))
      .slice(0, batchSize);
    const claimed: SmsSend[] = [];
    for (const row of candidates) {
      const updated: SmsSendRow = {
        ...row,
        status: 'queued',
        delivery_attempt_count: row.delivery_attempt_count + 1,
        last_attempt_at: now.toISOString(),
      };
      sendStore.set(row.id, updated);
      claimed.push(toSmsSend(updated));
    }
    return claimed;
  }

  const db = getSupabaseAdminClient();
  const { data, error } = await db.rpc('claim_due_sms_sends', {
    p_tenant_id: tenantId,
    p_batch_size: batchSize,
    p_now: nowIso ?? new Date().toISOString(),
  });
  if (error) throw new Error(`[SmsSendRepository] claim RPC failed: ${error.message}`);
  return ((data ?? []) as SmsSendRow[]).map(toSmsSend);
}

export interface UpdateSmsSendStatusParams {
  id: string;
  status: SmsSendStatus;
  provider?: string | null;
  providerMessageId?: string | null;
  sentAt?: string | null;
  blockedReason?: string | null;
  contactWindowDeferredUntil?: string | null;
}

export async function updateSmsSendStatus(
  params: UpdateSmsSendStatusParams,
): Promise<void> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const row = sendStore.get(params.id);
    if (!row) throw new SmsSendNotFoundError();
    sendStore.set(params.id, {
      ...row,
      status: params.status,
      provider: params.provider ?? row.provider,
      provider_message_id: params.providerMessageId ?? row.provider_message_id,
      sent_at: params.sentAt ?? row.sent_at,
      blocked_reason: params.blockedReason ?? row.blocked_reason,
      contact_window_deferred_until:
        params.contactWindowDeferredUntil ?? row.contact_window_deferred_until,
    });
    return;
  }

  const db = getSupabaseAdminClient();
  const patch: Record<string, unknown> = { status: params.status };
  if (params.provider !== undefined) patch.provider = params.provider;
  if (params.providerMessageId !== undefined) patch.provider_message_id = params.providerMessageId;
  if (params.sentAt !== undefined) patch.sent_at = params.sentAt;
  if (params.blockedReason !== undefined) patch.blocked_reason = params.blockedReason;
  if (params.contactWindowDeferredUntil !== undefined) {
    patch.contact_window_deferred_until = params.contactWindowDeferredUntil;
  }
  const { error } = await db.from('sms_sends').update(patch).eq('id', params.id);
  if (error) throw new Error(`[SmsSendRepository] update status failed: ${error.message}`);
}

export async function getSmsSendById(id: string): Promise<SmsSend> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const row = sendStore.get(id);
    if (!row) throw new SmsSendNotFoundError();
    return toSmsSend(row);
  }
  const db = getSupabaseAdminClient();
  const { data, error } = await db.from('sms_sends').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`[SmsSendRepository] get failed: ${error.message}`);
  if (!data) throw new SmsSendNotFoundError();
  return toSmsSend(data as SmsSendRow);
}
