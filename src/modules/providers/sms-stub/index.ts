/**
 * Stub SMS provider public surface — Story 3-1 Task 3.2.
 *
 * - `buildStubSmsProviderFromEnv()`: returns a new `StubSmsProvider`. The
 *   stub has no environment dependencies, so the factory always succeeds.
 *   Present for symmetry with `buildCeipalProviderClientFromEnv()` etc.
 * - `getSharedSmsProvider()` / `setSharedSmsProvider()`: module-level
 *   singleton so route handlers and the dispatch job both use the same
 *   instance (shared in-memory call log for test visibility).
 */
export {
  StubSmsProvider,
  __getStubSmsLogForTest,
  __clearStubSmsLogForTest,
} from './stub-sms-provider';
export type { StubSmsLogEntry } from './stub-sms-provider';

import { StubSmsProvider } from './stub-sms-provider';
import type { SmsProvider } from '@/features/outreach-engagement/contracts/sms-provider';

let sharedProvider: SmsProvider | null = null;

export function buildStubSmsProviderFromEnv(): StubSmsProvider {
  return new StubSmsProvider();
}

/**
 * Process-wide SMS provider. Built lazily from env. Callers should prefer
 * this over `new StubSmsProvider()` so Story 3-1b's Telnyx swap only has to
 * update the factory.
 */
export function getSharedSmsProvider(): SmsProvider {
  if (!sharedProvider) sharedProvider = buildStubSmsProviderFromEnv();
  return sharedProvider;
}

/** Inject an alternate provider — used by tests. */
export function setSharedSmsProvider(provider: SmsProvider | null): void {
  sharedProvider = provider;
}

/**
 * Initialize the shared SMS provider from startup wiring.
 *
 * Guard against clobbering a caller-provided provider: only sets when
 * nothing has been set yet. Mirrors `initializeLLMProviderFromStartup`
 * from Story 1.12b (review patch E7) — tests that do
 * `setSharedSmsProvider(mock)` before calling `ensureProvidersInitialized()`
 * must have their mock preserved.
 */
export function initializeSmsProviderFromStartup(provider: SmsProvider): void {
  if (sharedProvider !== null) return;
  sharedProvider = provider;
}

export function resetSharedSmsProviderForTest(): void {
  sharedProvider = null;
}
