/**
 * Edge System Provider Framework
 *
 * Vendor-agnostic access layer for all external systems.
 * Architecture ref: architecture.md §25
 */

// Types
export type {
  AuthStrategy,
  WebhookAuthStrategy,
  ErrorClassification,
  HealthStatus,
  ProviderMode,
  HealthSnapshot,
  ProviderHealthEvent,
  ProviderRoutingPolicy,
  ProviderConfig,
  ProviderCallResult,
  CostContext,
  WebhookEventStatus,
  WebhookEvent,
  WebhookReceiverConfig,
  WebhookHandler,
  WebhookHandlerResult,
  WebhookProcessorConfig,
  ProviderLogEntry,
  WebhookLogEntry,
  RegisteredProvider,
} from './types';

// Outbound
export { BaseProviderClient } from './base-client';

// Auth strategies — outbound
export { BearerTokenAuth } from './auth/bearer-token';
export { ApiKeyHeaderAuth } from './auth/api-key-header';
export { OAuthTokenAuth } from './auth/oauth-token';

// Inbound
export { BaseWebhookReceiver } from './webhook-receiver';
export { WebhookRateLimiter } from './webhook-rate-limiter';
export { WebhookProcessor } from './webhook-processor';

// Webhook auth strategies
export {
  BearerTokenWebhookAuth,
  HmacSignatureWebhookAuth,
  ApiKeyWebhookAuth,
} from './webhook-auth';

// Health & Registry
export { ProviderRegistry } from './registry';
export { HealthTracker } from './health-tracker';
export { PostgresHealthEventStore } from './health-event-store';
export type { HealthEventRow } from './health-event-store';
