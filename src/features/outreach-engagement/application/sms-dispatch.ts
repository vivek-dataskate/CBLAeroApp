/**
 * Per-row SMS dispatch orchestration — Story 3-1 Task 4.
 *
 * Operates on ONE already-claimed `sms_sends` row. Called from
 * `SmsDispatchJob` (src/modules/ingestion/jobs.ts) in a loop; per-row errors
 * MUST NOT kill the batch (Clay retro lesson). The job is therefore
 * responsible for catching and calling `recordSyncFailure` — this function
 * always resolves to a `DispatchOutcome`.
 */
import { randomUUID } from 'crypto';
import { renderTemplate, TemplateRenderError } from './template-render';
import { computeSmsIdempotencyKey } from './idempotency';
import {
  isWithinContactWindow,
  resolveNextContactWindow,
} from './contact-window';
import type {
  CandidateContactWindows,
} from '../contracts/contact-window';
import type { SmsSend } from '../contracts/sms-send';
import type { SmsTemplate } from '../contracts/sms-template';
import type { SmsProvider } from '../contracts/sms-provider';

export interface CandidateRuntimeSnapshot {
  phone: string | null;
  smsOptedIn: boolean;
  contactWindows: CandidateContactWindows | null;
}

export interface SmsDispatchContext {
  /** Load template row matching the send's frozen (id, version). */
  getTemplate(send: SmsSend): Promise<SmsTemplate>;
  /** Load candidate snapshot (phone + opt-out + windows) at dequeue time. */
  getCandidate(send: SmsSend): Promise<CandidateRuntimeSnapshot>;
  /** Default contact window from `policy_registry`. */
  defaultWindows: CandidateContactWindows;
  /** SMS provider (stub today, Telnyx in Story 3-1b). */
  provider: SmsProvider;
  /** Called at send-complete to persist status transition. */
  updateStatus(patch: {
    id: string;
    status: SmsSend['status'];
    provider?: string | null;
    providerMessageId?: string | null;
    sentAt?: string | null;
    blockedReason?: string | null;
    contactWindowDeferredUntil?: string | null;
  }): Promise<void>;
  /** Appends a row to `outreach_audit_log`. */
  writeAuditLog(row: {
    tenantId: string;
    channel: 'sms';
    sendId: string;
    candidateId: string;
    senderUserId: string | null;
    senderRole: string | null;
    templateId: string;
    templateAgenda: string;
    deliveryStatus: SmsSend['status'];
    contentHash: string | null;
    compliancePassed: boolean | null;
    blockedReason: string | null;
    traceId: string | null;
    correlationId: string | null;
    eventEnvelope: Record<string, unknown> | null;
  }): Promise<void>;
  /** Emits a structured funnel event (JSON line on console). */
  emitFunnelEvent(payload: Record<string, unknown>): void;
  /** `Date.now()` override for deterministic tests. */
  now?: () => Date;
  /**
   * UUID generator override for deterministic tests + the Task 8 envelope
   * snapshot fixture (AC 13 §8.2 — "any drift fails CI"). Defaults to
   * `crypto.randomUUID`.
   */
  eventId?: () => string;
}

export type DispatchOutcome =
  | { kind: 'sent'; providerMessageId: string }
  | { kind: 'failed'; errorMessage: string }
  | { kind: 'blocked_opt_out' }
  | { kind: 'deferred_window'; deferUntil: string }
  | { kind: 'skipped_missing_phone' };

export async function dispatchClaimedSend(
  send: SmsSend,
  ctx: SmsDispatchContext,
): Promise<DispatchOutcome> {
  const now = (ctx.now ?? (() => new Date()))();

  // 1. Load runtime snapshot — opt-out + contact window re-check at dequeue.
  const candidate = await ctx.getCandidate(send);

  // Consent sync (architecture §6): opt-out after enqueue still wins.
  if (!candidate.smsOptedIn) {
    await ctx.updateStatus({
      id: send.id,
      status: 'blocked_opt_out',
      blockedReason: 'opt_out_at_dequeue',
    });
    await ctx.writeAuditLog({
      tenantId: send.tenantId,
      channel: 'sms',
      sendId: send.id,
      candidateId: send.candidateId,
      senderUserId: send.senderUserId,
      senderRole: null,
      templateId: send.templateId,
      templateAgenda: '',
      deliveryStatus: 'blocked_opt_out',
      contentHash: send.renderedBodyHash,
      compliancePassed: false,
      blockedReason: 'opt_out_at_dequeue',
      traceId: null,
      correlationId: null,
      eventEnvelope: null,
    });
    return { kind: 'blocked_opt_out' };
  }

  // Contact-window drift (AC 7): dispatcher may have been paused; verify window.
  const effectiveWindows = candidate.contactWindows ?? ctx.defaultWindows;
  if (!isWithinContactWindow(now, effectiveWindows)) {
    const nextStart = resolveNextContactWindow(
      now,
      candidate.contactWindows,
      ctx.defaultWindows,
    );
    await ctx.updateStatus({
      id: send.id,
      status: 'deferred_window',
      contactWindowDeferredUntil: nextStart.toISOString(),
    });
    return { kind: 'deferred_window', deferUntil: nextStart.toISOString() };
  }

  if (!candidate.phone) {
    await ctx.updateStatus({
      id: send.id,
      status: 'failed',
      blockedReason: 'missing_phone',
    });
    return { kind: 'skipped_missing_phone' };
  }

  // 2. Load template and render body against the frozen version.
  const template = await ctx.getTemplate(send);

  let rendered: string;
  try {
    const r = renderTemplate(template.body, send.contextParams);
    rendered = r.rendered;
  } catch (err) {
    const msg = err instanceof TemplateRenderError ? err.message : String(err);
    await ctx.updateStatus({
      id: send.id,
      status: 'failed',
      blockedReason: `render_error: ${msg}`,
    });
    return { kind: 'failed', errorMessage: msg };
  }

  // 3. Provider-level idempotency key (architecture §11).
  const idempotencyKey =
    send.providerIdempotencyKey ??
    computeSmsIdempotencyKey({
      tenantId: send.tenantId,
      candidateId: send.candidateId,
      templateId: send.templateId,
      templateVersion: send.templateVersion,
      scheduledFor: send.scheduledFor,
    });

  // 4. Invoke the provider.
  const result = await ctx.provider.send({
    to: candidate.phone,
    body: rendered,
    idempotencyKey,
    costMeta: {
      tenant_id: send.tenantId,
      template_id: send.templateId,
      template_version: send.templateVersion,
    },
  });

  if (result.status === 'failed') {
    await ctx.updateStatus({
      id: send.id,
      status: 'failed',
      provider: ctx.provider.name,
      blockedReason: result.errorMessage ?? 'provider_failed',
    });
    await ctx.writeAuditLog({
      tenantId: send.tenantId,
      channel: 'sms',
      sendId: send.id,
      candidateId: send.candidateId,
      senderUserId: send.senderUserId,
      senderRole: null,
      templateId: send.templateId,
      templateAgenda: template.agenda,
      deliveryStatus: 'failed',
      contentHash: send.renderedBodyHash,
      compliancePassed: true,
      blockedReason: result.errorMessage ?? 'provider_failed',
      traceId: null,
      correlationId: null,
      eventEnvelope: null,
    });
    return { kind: 'failed', errorMessage: result.errorMessage ?? 'provider_failed' };
  }

  // 5. Sent. Persist status + audit + funnel event.
  const sentAtIso = now.toISOString();
  await ctx.updateStatus({
    id: send.id,
    status: 'sent',
    provider: ctx.provider.name,
    providerMessageId: result.providerMessageId,
    sentAt: sentAtIso,
  });

  // F2 (review patch): architecture §17 Communication Patterns envelope —
  // all fields required even when null, so Epic 10 consumers keyed on the
  // schema_version shape never observe missing keys. Background jobs have
  // no request trace context, so trace_id/span_id/parent_span_id are null.
  // F7 (review-pass-2 patch): event_id is generated via the injectable
  // `ctx.eventId` hook so Task 8's envelope snapshot fixture can pin a
  // deterministic UUID — same pattern as `ctx.now`.
  const mintEventId = ctx.eventId ?? randomUUID;
  const envelope: Record<string, unknown> = {
    event_id: mintEventId(),
    event_type: 'outreach.message.sent',
    occurred_at: sentAtIso,
    tenant_id: send.tenantId,
    actor_id: send.senderUserId,
    trace_id: null,
    span_id: null,
    parent_span_id: null,
    payload: {
      send_id: send.id,
      campaign_id: send.campaignId,
      template_id: send.templateId,
      template_version: send.templateVersion,
      template_agenda: template.agenda,
      candidate_id: send.candidateId,
      channel: 'sms',
      provider: ctx.provider.name,
      provider_message_id: result.providerMessageId,
      contact_window_respected: true,
    },
    schema_version: '1.0.0',
  };

  await ctx.writeAuditLog({
    tenantId: send.tenantId,
    channel: 'sms',
    sendId: send.id,
    candidateId: send.candidateId,
    senderUserId: send.senderUserId,
    senderRole: null,
    templateId: send.templateId,
    templateAgenda: template.agenda,
    deliveryStatus: 'sent',
    contentHash: send.renderedBodyHash,
    compliancePassed: true,
    blockedReason: null,
    traceId: null,
    correlationId: null,
    eventEnvelope: envelope,
  });

  ctx.emitFunnelEvent(envelope);

  return { kind: 'sent', providerMessageId: result.providerMessageId };
}

/**
 * Load the default contact window from `policy_registry` / `policy_versions`.
 * Used as fallback when a candidate has no `contact_windows` of their own
 * (AC 7).
 *
 * Returns the hard-coded architecture default (Mon-Fri 08:00-20:00 America/
 * Chicago) when the policy row is missing so dispatch never hard-fails on a
 * policy-registry lookup issue.
 */
export const HARDCODED_DEFAULT_CONTACT_WINDOW: CandidateContactWindows = {
  timezone: 'America/Chicago',
  windows: [
    { day: 'mon', start: '08:00', end: '20:00' },
    { day: 'tue', start: '08:00', end: '20:00' },
    { day: 'wed', start: '08:00', end: '20:00' },
    { day: 'thu', start: '08:00', end: '20:00' },
    { day: 'fri', start: '08:00', end: '20:00' },
  ],
};
