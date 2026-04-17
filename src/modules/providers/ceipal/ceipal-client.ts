/**
 * Ceipal ATS outbound client — Story 1-12a Task 3
 *
 * Wraps `BaseProviderClient` with Ceipal-specific pagination + cursor logic.
 * The exported `fetchApplicants()` keeps the signature + behavior of the
 * legacy `fetchCeipalApplicants()` so `CeipalIngestionJob` callers see zero
 * difference (Story 2-3 preservation contract).
 *
 * What moves: HTTP transport → `BaseProviderClient` (timeout, retry with
 * exponential backoff on [408, 429, 500, 502, 503, 504], structured
 * `ProviderLogEntry` per call, health reporting via registry hooks).
 *
 * What stays: pagination (50 rows/page, 50-page cap), `since` cursor
 * (`modified_after=YYYY-MM-DD`), 1-second inter-page delay, partial-page
 * early exit.
 */
import { BaseProviderClient } from '../base-client';
import { CeipalAuthStrategy } from './ceipal-auth-strategy';
import type { ProviderCallResult, ProviderLogEntry } from '../types';

const DEFAULT_DATA_URL = 'https://api.ceipal.com/getCustomApplicantDetails';
const CEIPAL_PAGE_SIZE = 50;
const CEIPAL_DEFAULT_MAX_PAGES = 50;
const CEIPAL_INTER_PAGE_DELAY_MS = 1_000;

export interface CeipalProviderClientConfig {
  auth: CeipalAuthStrategy;
  endpointKey: string;
  dataUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffMs?: number;
  onLog?: (entry: ProviderLogEntry) => void;
  /** Inter-page delay, exposed for tests so they don't wait a real second. */
  interPageDelayMs?: number;
}

export interface CeipalApplicantMinimal {
  applicant_id?: string;
  [key: string]: unknown;
}

export interface FetchApplicantsOptions {
  since?: Date;
  startPage?: number;
  maxPages?: number;
}

/**
 * Client for Ceipal's applicant search API. The only exposed "business"
 * method today is `fetchApplicants`; further endpoints get their own method
 * as they are needed.
 */
export class CeipalProviderClient<TApplicant = CeipalApplicantMinimal> {
  public readonly base: BaseProviderClient;
  /** Exposed so the test hook `clearCeipalTokenCacheForTest()` can flush the strategy cache. */
  public readonly auth: CeipalAuthStrategy;
  private readonly dataPath: string;
  private readonly interPageDelayMs: number;

  constructor(config: CeipalProviderClientConfig) {
    if (!config.endpointKey || config.endpointKey.trim().length === 0) {
      throw new Error('CeipalProviderClient: endpointKey is required (set CEIPAL_ENDPOINT_KEY)');
    }
    this.auth = config.auth;
    this.base = new BaseProviderClient({
      name: 'ceipal',
      baseUrl: config.dataUrl ?? DEFAULT_DATA_URL,
      auth: config.auth,
      timeoutMs: config.timeoutMs ?? 10_000,
      maxRetries: config.maxRetries,
      backoffMs: config.backoffMs,
    });
    if (config.onLog) {
      this.base.onLog = config.onLog;
    }
    this.dataPath = `/${config.endpointKey}`;
    this.interPageDelayMs = config.interPageDelayMs ?? CEIPAL_INTER_PAGE_DELAY_MS;
  }

  /**
   * Paginated applicant fetch. Returns the concatenated result across pages.
   * Honors:
   *   - `since?: Date`    → appends `modified_after=YYYY-MM-DD` query param
   *   - `startPage`       → default 1
   *   - `maxPages`        → default 50 (caps total pages fetched)
   *
   * Semantics match legacy `fetchCeipalApplicants()` byte-for-byte:
   *   - 1-second delay between pages (skipped on first page)
   *   - empty-results page → break
   *   - partial page (< CEIPAL_PAGE_SIZE results) → break (end of data)
   *   - maxPages reached → warn + return
   *   - non-ok HTTP → throw with the Ceipal error text
   */
  async fetchApplicants(options?: FetchApplicantsOptions): Promise<TApplicant[]> {
    const all: TApplicant[] = [];
    let page = options?.startPage ?? 1;
    const maxPages = options?.maxPages ?? CEIPAL_DEFAULT_MAX_PAGES;
    const endPage = page + maxPages - 1;
    const sinceStr = options?.since ? options.since.toISOString().slice(0, 10) : null;

    while (page <= endPage) {
      if (page > (options?.startPage ?? 1)) {
        await new Promise((r) => setTimeout(r, this.interPageDelayMs));
      }

      const qs =
        `?json=1&paging_length=${CEIPAL_PAGE_SIZE}&page=${page}` +
        (sinceStr ? `&modified_after=${sinceStr}` : '');
      const result: ProviderCallResult<
        { results?: TApplicant[]; count?: number } | TApplicant[]
      > = await this.base.request('GET', `${this.dataPath}${qs}`, {
        costMeta: { endpoint: 'applicant/search' },
      });

      if (!result.ok) {
        throw new Error(
          `Ceipal fetch failed on page ${page} (${result.status}): ${result.error ?? 'unknown error'}`,
        );
      }

      const data = result.data;
      const results: TApplicant[] = Array.isArray(data)
        ? data
        : ((data as { results?: TApplicant[] } | null)?.results ?? []);

      if (results.length === 0) break;
      all.push(...results);

      // Partial page → end of data
      if (results.length < CEIPAL_PAGE_SIZE) break;
      page++;
    }

    if (page > endPage) {
      console.warn(
        `[Ceipal] maxPages (${maxPages}) reached at page ${page} — results may be truncated. Consider increasing maxPages or using startPage for resumption.`,
      );
    }

    return all;
  }
}

export interface BuildCeipalClientFromEnvOptions {
  onLog?: (entry: ProviderLogEntry) => void;
  interPageDelayMs?: number;
}

/** Build a `CeipalProviderClient` from the standard Ceipal env vars. */
export function buildCeipalProviderClientFromEnv(
  options?: BuildCeipalClientFromEnvOptions,
): CeipalProviderClient | null {
  const apiKey = process.env.CEIPAL_API_KEY;
  const email = process.env.CEIPAL_USERNAME;
  const password = process.env.CEIPAL_PASSWORD;
  const endpointKey = process.env.CEIPAL_ENDPOINT_KEY;
  if (!apiKey || !email || !password || !endpointKey) return null;

  const authUrl = process.env.CEIPAL_AUTH_URL;
  const dataUrl = process.env.CEIPAL_DATA_URL;

  const auth = new CeipalAuthStrategy({ apiKey, email, password, authUrl });
  return new CeipalProviderClient({
    auth,
    endpointKey,
    dataUrl,
    onLog: options?.onLog,
    interPageDelayMs: options?.interPageDelayMs,
  });
}
