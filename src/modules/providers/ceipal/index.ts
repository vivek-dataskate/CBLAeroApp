/**
 * Ceipal provider module — Story 1-12a Task 3
 *
 * Public surface the legacy `src/modules/ats/ceipal.ts` re-exports so the rest
 * of the codebase never has to know about `BaseProviderClient`.
 *
 * - `getSharedCeipalClient()`: singleton that lazily builds a client from env.
 *   Returns `null` when Ceipal env vars are absent (tests, local dev).
 * - `clearCeipalTokenCacheForTest()`: delegates to the auth strategy on the
 *   shared client. Preserved for test hook compatibility.
 * - `resetSharedCeipalClientForTest()`: forces the next `getSharedCeipalClient()`
 *   call to rebuild — used when tests swap env vars.
 */
export { CeipalAuthStrategy } from './ceipal-auth-strategy';
export type { CeipalAuthStrategyConfig } from './ceipal-auth-strategy';
export {
  CeipalProviderClient,
  buildCeipalProviderClientFromEnv,
} from './ceipal-client';
export type {
  CeipalProviderClientConfig,
  FetchApplicantsOptions,
  CeipalApplicantMinimal,
} from './ceipal-client';

import type { CeipalApplicant } from '@/modules/ats/ceipal-types';
import {
  CeipalProviderClient,
  buildCeipalProviderClientFromEnv,
} from './ceipal-client';

let sharedClient: CeipalProviderClient<CeipalApplicant> | null | undefined = undefined;

/**
 * Process-wide Ceipal client, built on first use from env. `undefined` =
 * "not yet tried"; `null` = "env missing, caller must handle".
 */
export function getSharedCeipalClient(): CeipalProviderClient<CeipalApplicant> | null {
  if (sharedClient === undefined) {
    sharedClient =
      (buildCeipalProviderClientFromEnv() as CeipalProviderClient<CeipalApplicant> | null) ?? null;
  }
  return sharedClient;
}

/** Inject a pre-built client — used by startup wiring and tests. */
export function setSharedCeipalClient(
  client: CeipalProviderClient<CeipalApplicant> | null,
): void {
  sharedClient = client;
}

export function resetSharedCeipalClientForTest(): void {
  sharedClient = undefined;
}

/**
 * Preserved test hook — clears the cached Ceipal token on the shared client
 * so the next call forces a refresh. No-op when no client has been built yet.
 */
export function clearCeipalTokenCacheForTest(): void {
  sharedClient?.auth.clearCacheForTest();
}
