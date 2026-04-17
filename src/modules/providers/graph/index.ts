/**
 * Microsoft Graph provider module — Story 1.12b
 *
 * Public surface the email / ingestion jobs consume so the rest of the
 * codebase never has to know about `BaseProviderClient` or the Graph auth
 * details.
 */
export {
  GraphProviderClient,
  buildGraphProviderClientFromEnv,
  DEFAULT_GRAPH_BASE_URL,
} from './graph-client';
export type {
  GraphProviderClientConfig,
  GraphRequestOptions,
} from './graph-client';

import {
  GraphProviderClient,
  buildGraphProviderClientFromEnv,
} from './graph-client';

let sharedClient: GraphProviderClient | null | undefined = undefined;

/**
 * Process-wide Graph client, built on first use from env.
 *   `undefined` → not yet tried (first access builds from env).
 *   `null` → env missing; caller must handle (tests, local dev without Entra).
 *   `GraphProviderClient` → ready.
 */
export function getSharedGraphClient(): GraphProviderClient | null {
  if (sharedClient === undefined) {
    sharedClient = buildGraphProviderClientFromEnv() ?? null;
  }
  return sharedClient;
}

/** Inject a pre-built client — used by startup wiring and tests. */
export function setSharedGraphClient(client: GraphProviderClient | null): void {
  sharedClient = client;
}

export function resetSharedGraphClientForTest(): void {
  sharedClient = undefined;
}
