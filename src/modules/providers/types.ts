/**
 * Edge System Provider Framework — Types & Interfaces
 *
 * Architecture ref: architecture.md §25
 * Product code never imports vendor SDKs. One interface per capability,
 * factory function per provider, BaseProviderClient for outbound,
 * BaseWebhookReceiver for inbound.
 */

/* ------------------------------------------------------------------ */
/*  Auth Strategies                                                    */
/* ------------------------------------------------------------------ */

/** Outbound auth strategy — injected into every HTTP request. */
export interface AuthStrategy {
  /** Apply auth to the request headers (mutates and returns headers). */
  applyAuth(headers: Record<string, string>): Promise<Record<string, string>>;
}

/** Inbound webhook auth strategy — validates incoming requests. */
export interface WebhookAuthStrategy {
  /** Returns true if the request signature / token is valid. */
  validate(payload: string | Buffer, headers: Record<string, string>): Promise<boolean>;
}

/* ------------------------------------------------------------------ */
/*  Error Classification                                               */
/* ------------------------------------------------------------------ */

export type ErrorClassification =
  | 'transient'
  | 'rate_limited'
  | 'permanent'
  | 'auth_failure';

/* ------------------------------------------------------------------ */
/*  Health & Routing                                                   */
/* ------------------------------------------------------------------ */

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export type ProviderMode = 'normal' | 'degraded' | 'kill_switched';

export interface HealthSnapshot {
  status: HealthStatus;
  errorRate: number;       // 0..1 rolling 5-min window
  p95LatencyMs: number;
  totalAttempts: number;   // within the window
  totalFailures: number;   // within the window
}

export interface ProviderHealthEvent {
  provider: string;
  previousMode: ProviderMode;
  newMode: ProviderMode;
  reason: string;
  errorRate: number;
  attemptCount: number;
  occurredAtIso: string;
}

export interface ProviderRoutingPolicy {
  channel: string;
  primaryProvider: string;
  fallbackProvider: string | null;
  mode: ProviderMode;
  updatedAtIso: string;
  updatedByActorId: string | null;
  reason: string | null;
}

/* ------------------------------------------------------------------ */
/*  Provider Config                                                    */
/* ------------------------------------------------------------------ */

export interface ProviderConfig {
  /** Unique provider name (e.g. 'telnyx', 'anthropic', 'clay'). */
  name: string;

  /** Base URL for outbound HTTP calls. */
  baseUrl: string;

  /** Auth strategy instance. */
  auth: AuthStrategy;

  /** Request timeout in ms (default 10_000). */
  timeoutMs?: number;

  /** Max retry attempts (default 3). */
  maxRetries?: number;

  /** Backoff multiplier in ms (default 1000). */
  backoffMs?: number;

  /**
   * HTTP status codes that trigger retry.
   * Default: [408, 429, 500, 502, 503, 504] — matches fetchWithRetry (408 + 429 + 5xx)
   * with 501 Not Implemented excluded (permanent error, retrying is waste).
   */
  retryableStatuses?: number[];

  /**
   * Optional cost estimation callback.
   * Receives call metadata including method/path AND any provider-specific
   * extras (model, input/output tokens, page counts) passed via request options.
   * Returns the estimated USD cost.
   */
  estimateCost?: (ctx: CostContext) => number;
}

/** Context passed to estimateCost. Providers extend via `costMeta`. */
export interface CostContext {
  method: string;
  path: string;
  statusCode: number | null;
  durationMs: number;
  /**
   * Free-form provider-specific metadata. Consumers SHOULD pass typed billing
   * fields when relevant so the framework doesn't have to guess:
   *   - `model`: string
   *   - `inputTokens`: number (uncached input tokens, 1x price)
   *   - `outputTokens`: number
   *   - `cacheCreationTokens`: number (Anthropic 1.25x input price)
   *   - `cacheReadTokens`: number (Anthropic 0.1x input price)
   *   - `pages`: number (for vision / PDF page surcharge)
   *   - any additional provider-specific fields
   */
  costMeta?: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
    pages?: number;
    [key: string]: unknown;
  };
}

/* ------------------------------------------------------------------ */
/*  Provider Call Result                                               */
/* ------------------------------------------------------------------ */

export interface ProviderCallResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  errorClassification: ErrorClassification | null;
  durationMs: number;
  attempt: number;
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Webhook Events                                                     */
/* ------------------------------------------------------------------ */

export type WebhookEventStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'dead_letter';

export interface WebhookEvent {
  id: string;
  source: string;
  eventType: string;
  providerEventId: string | null;
  rawPayload: unknown;
  status: WebhookEventStatus;
  attemptCount: number;
  errorMessage: string | null;
  createdAtIso: string;
  processedAtIso: string | null;
  /** Handler result metadata (populated after successful handle()). */
  resultMeta?: Record<string, unknown> | null;
}

/* ------------------------------------------------------------------ */
/*  Webhook Receiver Config                                            */
/* ------------------------------------------------------------------ */

export interface WebhookReceiverConfig {
  /** Source identifier (e.g. 'clay', 'telnyx'). */
  source: string;

  /** Auth strategy for validating inbound webhooks. */
  auth: WebhookAuthStrategy;

  /** Max payload size in bytes (default 256 * 1024). */
  maxPayloadBytes?: number;

  /** Replay protection window in ms (default 5 * 60 * 1000). */
  replayWindowMs?: number;

  /** Rate limit: max events per window (default 100). */
  rateLimitMax?: number;

  /** Rate limit: sliding window in ms (default 60_000). */
  rateLimitWindowMs?: number;

  /** Extract provider event ID from parsed payload (for dedup). Empty string treated as null. */
  extractEventId?: (payload: unknown) => string | null;

  /** Extract event type from parsed payload. */
  extractEventType?: (payload: unknown) => string;

  /** Extract timestamp from payload for replay protection (ISO string or epoch ms). */
  extractTimestamp?: (payload: unknown) => string | number | null;

  /**
   * Optional — for providers that send arrays of events per POST (e.g. Clay batches).
   * When set, `receive()` fans out one `webhook_events` row per element returned.
   * Takes precedence over single-event `extractEventId`/`extractEventType` when present.
   *
   * IMPORTANT — provider shapes vary. Consumers MUST handle all shapes the provider
   * is known to send, or rows will be silently dropped. For Clay specifically:
   *   - Plain array:      `[{row1}, {row2}]`
   *   - Single object:    `{field1: ..., field2: ...}`
   *   - Wrapped array:    `{"rows": [{row1}, {row2}]}` (when `rows` is the sole key)
   *   - Double-wrapped:   `[[{row1}, {row2}]]` (observed in Story 2.8)
   *
   * Example implementation:
   * ```ts
   * extractEvents: (p: unknown) => {
   *   if (Array.isArray(p) && p.length === 1 && Array.isArray(p[0])) return p[0].map(toEvent);
   *   if (Array.isArray(p)) return p.map(toEvent);
   *   if (p && typeof p === 'object') {
   *     const obj = p as { rows?: unknown[] };
   *     if (Array.isArray(obj.rows)) return obj.rows.map(toEvent);
   *     return [toEvent(p)];
   *   }
   *   return [];
   * }
   * ```
   *
   * Thrown exceptions are caught by the receiver and mapped to `rejected_parse`.
   */
  extractEvents?: (payload: unknown) => Array<{
    eventId: string | null;
    eventType: string;
    payload: unknown;
  }>;

  /**
   * Max events allowed in a single multi-event batch (default 500).
   * Receiver rejects the whole POST with 413 if `extractEvents` returns more items.
   * Bounds damage from pathological batches while keeping per-POST rate-limit semantics.
   */
  maxEventsPerBatch?: number;
}

/* ------------------------------------------------------------------ */
/*  Webhook Handler                                                    */
/* ------------------------------------------------------------------ */

/** Result returned by a webhook handler — stored with the event row for traceability. */
export interface WebhookHandlerResult {
  /** Free-form metadata the handler wants stored (candidate_id, bucket_run_id, per-row outcomes, etc.). */
  meta?: Record<string, unknown>;
  /** Optional human-readable summary ("upserted 42 candidates, skipped 8"). */
  summary?: string;
}

/** Provider-specific handler that processes a webhook event. */
export interface WebhookHandler {
  /**
   * Process the event. Return metadata to be persisted alongside the event row.
   * Throw to signal failure (will be retried or dead-lettered by the processor).
   */
  handle(event: WebhookEvent): Promise<WebhookHandlerResult | void>;
}

/* ------------------------------------------------------------------ */
/*  Webhook Processor Config                                           */
/* ------------------------------------------------------------------ */

export interface WebhookProcessorConfig {
  /** Max processing retries before dead-lettering (default 3). */
  maxRetries?: number;

  /** Backoff multiplier in ms between retries (default 1000). */
  backoffMs?: number;

  /** Batch size for claim query (default 10). */
  batchSize?: number;
}

/* ------------------------------------------------------------------ */
/*  Structured Log Entry                                               */
/* ------------------------------------------------------------------ */

export interface ProviderLogEntry {
  provider: string;
  method: string;
  path: string;
  statusCode: number | null;
  durationMs: number;
  attempt: number;
  error?: string;
  errorClassification?: ErrorClassification;
  costEstimate?: number;
}

export interface WebhookLogEntry {
  source: string;
  eventType: string;
  payloadSize: number;
  signatureValid: boolean;
  duplicate: boolean;
  processingTimeMs: number;
  outcome: 'accepted' | 'rejected_auth' | 'rejected_replay' | 'rejected_size' | 'rejected_parse' | 'rejected_rate_limit' | 'duplicate_skipped';
}

/* ------------------------------------------------------------------ */
/*  Registry Types                                                     */
/* ------------------------------------------------------------------ */

export interface RegisteredProvider {
  name: string;
  mode: ProviderMode;
  health: HealthSnapshot;
  registeredAtIso: string;
}
