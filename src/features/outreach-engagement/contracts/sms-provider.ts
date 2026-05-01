/**
 * SmsProvider capability interface — Story 3-1 Task 3 / AC 8.
 *
 * Frozen contract Story 3-1b (Telnyx) will implement. Do NOT rename or
 * re-shape once agreed — the stub and the production provider must be
 * drop-in swappable via `providerRegistry.setMode('sms-stub','kill_switched')`
 * + `setMode('telnyx','normal')`.
 *
 * Mirrors the `LLMProvider` pattern (Story 1.12b): the provider owns its
 * transport (SDK or BaseProviderClient) and reports health directly to the
 * registry — no `wireClient` required.
 */

export interface SmsSendRequest {
  /** E.164 phone number — validated by the caller before reaching here. */
  to: string;
  /** Rendered body, post-template-substitution. Plain text only. */
  body: string;
  /**
   * SHA-256 idempotency key (architecture §11 — §Provider-Level Idempotency).
   * Stable across retries: the provider MUST return the same provider message
   * id for duplicate submissions of the same key within its retention window.
   */
  idempotencyKey: string;
  /** Optional metadata passed through to cost estimation / observability. */
  costMeta?: Record<string, unknown>;
}

export interface SmsSendResult {
  /** Provider-assigned message id — opaque; do not attempt to parse. */
  providerMessageId: string;
  /**
   * Outcome of the send:
   *   'sent'   — provider acknowledged the message and will attempt delivery
   *   'queued' — provider accepted the message into its own queue (deferred)
   *   'failed' — provider rejected the message at submission; no retry
   */
  status: 'sent' | 'queued' | 'failed';
  /** Wall-clock time spent in `send()`. Informational. */
  durationMs: number;
  /** Optional provider-specific error message when `status === 'failed'`. */
  errorMessage?: string;
}

export interface SmsProvider {
  /** Provider identity — matches the key in `ProviderRegistry`. */
  readonly name: string;

  send(req: SmsSendRequest): Promise<SmsSendResult>;
}
