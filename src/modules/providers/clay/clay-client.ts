/**
 * Clay outbound API client — Story 1.12a Task 2
 *
 * Thin wrapper around `BaseProviderClient` configured for Clay's REST API
 * (https://api.clay.com) using `x-api-key` header auth.
 *
 * NOT WIRED to product code in this story — created so the Epic 3 outbound-Clay
 * enrichment work can consume it directly. The `pushCandidateForEnrichment`
 * method is a stub signature only; the exact payload shape is deferred until
 * the Epic 3 requirements land.
 *
 * Registration: `providerRegistry.register('clay-outbound', client)` is wired
 * from `src/modules/providers/startup.ts`.
 */
import {
  ApiKeyHeaderAuth,
  BaseProviderClient,
} from '../index';
import type { ProviderCallResult, ProviderLogEntry } from '../types';

/**
 * Shape of the profile pushed to Clay for enrichment. The concrete fields
 * required by Clay's enrichment endpoint will be defined in Epic 3. This
 * placeholder keeps the type surface honest until then.
 */
export interface ClayOutboundProfile {
  email?: string;
  linkedinUrl?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  [extra: string]: unknown;
}

const DEFAULT_CLAY_BASE_URL = 'https://api.clay.com';
const DEFAULT_CLAY_API_KEY_HEADER = 'x-api-key';

export interface ClayProviderClientConfig {
  apiKey: string;
  baseUrl?: string;
  headerName?: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffMs?: number;
  onLog?: (entry: ProviderLogEntry) => void;
}

/**
 * Outbound Clay client. Consumers should prefer the typed methods over the
 * raw `request()` escape hatch — any new endpoint gets its own method so the
 * payload shape lives in this module, not in product code.
 */
export class ClayProviderClient {
  public readonly base: BaseProviderClient;

  constructor(config: ClayProviderClientConfig) {
    if (!config.apiKey || config.apiKey.trim().length === 0) {
      throw new Error('ClayProviderClient: apiKey is required');
    }
    this.base = new BaseProviderClient({
      name: 'clay-outbound',
      baseUrl: config.baseUrl ?? DEFAULT_CLAY_BASE_URL,
      auth: new ApiKeyHeaderAuth(config.apiKey, config.headerName ?? DEFAULT_CLAY_API_KEY_HEADER),
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      backoffMs: config.backoffMs,
    });
    if (config.onLog) {
      this.base.onLog = config.onLog;
    }
  }

  /**
   * Epic 3 placeholder. The Clay enrichment API path + payload shape will be
   * finalised when the outbound enrichment story lands — this method exists
   * so registry wiring + happy-path tests can exercise it, but it is not
   * called by any product code in this story.
   */
  async pushCandidateForEnrichment(
    profile: ClayOutboundProfile,
  ): Promise<ProviderCallResult<{ id?: string }>> {
    return this.base.request<{ id?: string }>(
      'POST',
      '/v1/enrichment/person',
      { body: profile, costMeta: { endpoint: 'enrichment/person' } },
    );
  }
}

/**
 * Build a `ClayProviderClient` from the standard env vars. Returns `null`
 * when `CLAY_API_KEY` isn't set so startup wiring can no-op in environments
 * that haven't enabled outbound Clay yet (tests, local dev without the key).
 */
export function buildClayProviderClientFromEnv(): ClayProviderClient | null {
  const apiKey = process.env.CLAY_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) return null;
  const baseUrl = process.env.CLAY_API_BASE_URL || DEFAULT_CLAY_BASE_URL;
  const headerName = process.env.CLAY_API_KEY_HEADER || DEFAULT_CLAY_API_KEY_HEADER;
  return new ClayProviderClient({ apiKey, baseUrl, headerName });
}
