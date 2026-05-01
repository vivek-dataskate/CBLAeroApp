/**
 * Story 3-1 canonical SMS send types.
 *
 * Rows live in `cblaero_app.sms_sends`. The dispatch pipeline transitions
 * `pending → queued → sent | failed | blocked_opt_out | blocked_cooldown |
 *  deferred_window` per architecture §6 and §10.
 */

export const SMS_SEND_STATUS_VALUES = [
  'pending',
  'queued',
  'sent',
  'delivered',
  'failed',
  'bounced',
  'undeliverable',
  'blocked_opt_out',
  'blocked_cooldown',
  'deferred_window',
] as const;
export type SmsSendStatus = (typeof SMS_SEND_STATUS_VALUES)[number];

/** Reference to a campaign grouping a bulk/filter-send's rows together. */
export interface CampaignRef {
  campaignId: string;
  /** Where this campaign originated — 'single_send' means no grouping. */
  source: 'single_send' | 'bulk_send' | 'filter_send';
}

/**
 * SmsSend as loaded from DB. `renderedBody` may be null after GDPR erasure —
 * `renderedBodyHash` remains for audit integrity (NFR18).
 */
export interface SmsSend {
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
  providerIdempotencyKey: string | null;
  status: SmsSendStatus;
  deliveryAttemptCount: number;
  lastAttemptAt: string | null;
  scheduledFor: string;
  sentAt: string | null;
  contactWindowDeferredUntil: string | null;
  blockedReason: string | null;
  senderUserId: string | null;
  trackingToken: string | null;
  trackingUrl: string | null;
  clickedAt: string | null;
  clickCount: number;
  responseReceivedAt: string | null;
  responseBody: string | null;
  responseType: 'opt_out' | 'affirmative' | 'negative' | 'freeform' | null;
  createdAt: string;
}

/**
 * Shape the caller hands to `insertSmsSend` / `insertSmsSendsBulk`. The
 * repository fills in any defaults and never lets the caller set provider
 * fields directly (those only transition inside the dispatch job).
 */
export interface SmsSendInsertRow {
  tenantId: string;
  candidateId: string;
  templateId: string;
  templateVersion: number;
  scheduledFor: string;
  campaignId?: string | null;
  renderedBody?: string | null;
  renderedBodyHash?: string | null;
  contextParams?: Record<string, unknown>;
  senderUserId?: string | null;
  trackingToken?: string | null;
  trackingUrl?: string | null;
  providerIdempotencyKey?: string | null;
}
