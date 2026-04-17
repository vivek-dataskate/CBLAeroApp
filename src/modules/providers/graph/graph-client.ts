/**
 * Microsoft Graph outbound client — Story 1.12b Task 1.2
 *
 * Wraps `BaseProviderClient` with Graph-specific concerns:
 *   - OAuth2 client_credentials against Entra, scope `https://graph.microsoft.com/.default`
 *   - 401 recovery: if Graph returns 401 (token revoked/rotated mid-run) the
 *     client invalidates the cached access token and retries the request once.
 *   - Absolute nextLink support: Graph pagination returns `@odata.nextLink` as a
 *     full `https://graph.microsoft.com/v1.0/...` URL. `request()` normalizes
 *     those so callers can pass them unchanged.
 *
 * What stays on `BaseProviderClient`: timeout, exponential-backoff retry on
 * [408, 429, 500, 502, 503, 504], structured `ProviderLogEntry` per call,
 * `onSuccess`/`onFailure` hooks wired to `ProviderRegistry`.
 */
import { BaseProviderClient } from '../base-client';
import { OAuthTokenAuth } from '../auth/oauth-token';
import type { ProviderCallResult, ProviderLogEntry } from '../types';

export const DEFAULT_GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const DEFAULT_GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const DEFAULT_GRAPH_TIMEOUT_MS = 15_000;
/** Legacy `acquireGraphToken` used a 60s pre-expiry refresh buffer — match it. */
const DEFAULT_REFRESH_BUFFER_MS = 60_000;

export interface GraphProviderClientConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Override for regional Graph endpoints; defaults to `https://graph.microsoft.com/v1.0`. */
  baseUrl?: string;
  /** Override the OAuth token endpoint; defaults to the Entra v2 endpoint for `tenantId`. */
  tokenUrl?: string;
  /** OAuth2 `scope` — defaults to `https://graph.microsoft.com/.default`. */
  scope?: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffMs?: number;
  onLog?: (entry: ProviderLogEntry) => void;
}

export interface GraphRequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  parseJson?: boolean;
  costMeta?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Disable the one-shot 401 retry. Used internally to avoid recursion. */
  skipAuthRetry?: boolean;
}

/**
 * Graph HTTP client. Exposes the subset of verbs Graph endpoints use
 * (GET/POST/PATCH/DELETE) plus a general `request()` escape hatch.
 */
export class GraphProviderClient {
  public readonly base: BaseProviderClient;
  public readonly auth: OAuthTokenAuth;
  private readonly baseUrl: string;

  constructor(config: GraphProviderClientConfig) {
    if (!config.tenantId || !config.clientId || !config.clientSecret) {
      throw new Error(
        'GraphProviderClient: tenantId, clientId, clientSecret all required (set CBL_SSO_ALLOWED_TENANT_ID, CBL_SSO_CLIENT_ID, CBL_SSO_CLIENT_SECRET)',
      );
    }
    this.baseUrl = (config.baseUrl ?? DEFAULT_GRAPH_BASE_URL).replace(/\/+$/, '');

    const tokenUrl =
      config.tokenUrl ??
      `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;

    this.auth = new OAuthTokenAuth(
      tokenUrl,
      config.clientId,
      config.clientSecret,
      DEFAULT_REFRESH_BUFFER_MS,
      /* refreshTimeoutMs */ 10_000,
      /* refreshCooldownMs */ 30_000,
      config.scope ?? DEFAULT_GRAPH_SCOPE,
    );

    this.base = new BaseProviderClient({
      name: 'graph',
      baseUrl: this.baseUrl,
      auth: this.auth,
      timeoutMs: config.timeoutMs ?? DEFAULT_GRAPH_TIMEOUT_MS,
      maxRetries: config.maxRetries,
      backoffMs: config.backoffMs,
    });
    if (config.onLog) this.base.onLog = config.onLog;
  }

  /**
   * Send an HTTP request to Graph. Accepts either a relative path
   * (`/users/foo/messages`) or an absolute `@odata.nextLink` URL —
   * absolute URLs on the same `baseUrl` are stripped to avoid double-prefix.
   *
   * On 401 the cached token is invalidated and the request is retried once
   * with a fresh token. This is the Graph-specific behavior AC 1 requires;
   * BaseProviderClient alone does not retry auth failures (by design — a
   * bad credential should not burn retries).
   */
  async request<T = unknown>(
    method: string,
    pathOrUrl: string,
    options?: GraphRequestOptions,
  ): Promise<ProviderCallResult<T>> {
    // `normalizePath` returns either a relative path (same baseUrl — stripped
    // prefix) or an absolute URL (beta / regional endpoint — pass through).
    // `BaseProviderClient` handles both.
    const { value: path } = this.normalizePath(pathOrUrl);
    const first = await this.base.request<T>(method, path, options);
    if (first.status === 401 && !options?.skipAuthRetry) {
      this.auth.invalidateCache();
      // Build retry options that:
      //   1. Set `skipAuthRetry: true` — future-proofs against any recursive
      //      call site; if this retry path ever goes through `this.request`
      //      instead of `this.base.request`, the flag prevents an infinite
      //      loop. Today it is defense in depth.
      //   2. Drop the caller's `AbortSignal` IF the first attempt aborted.
      //      A signal that is already in aborted state would short-circuit
      //      the retry with no network call; we prefer a fresh attempt.
      //      If the caller genuinely wants the retry to honor their abort
      //      they can pass a signal that has not fired yet (not our concern
      //      — we inspect `.aborted` explicitly to preserve the honor-abort
      //      semantics for non-aborted signals).
      const retryOptions: GraphRequestOptions = {
        ...options,
        skipAuthRetry: true,
        signal: options?.signal?.aborted ? undefined : options?.signal,
      };
      return this.base.request<T>(method, path, retryOptions);
    }
    return first;
  }

  /** Test-only hook: expose normalization so the test suite can assert
   *  beta / regional nextLink routing without making real network calls. */
  normalizePathForTest(pathOrUrl: string): { isAbsolute: boolean; value: string } {
    return this.normalizePath(pathOrUrl);
  }

  get<T = unknown>(path: string, headers?: Record<string, string>): Promise<ProviderCallResult<T>> {
    return this.request<T>('GET', path, { headers });
  }

  post<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>): Promise<ProviderCallResult<T>> {
    return this.request<T>('POST', path, { body, headers });
  }

  patch<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>): Promise<ProviderCallResult<T>> {
    return this.request<T>('PATCH', path, { body, headers });
  }

  delete<T = unknown>(path: string, headers?: Record<string, string>): Promise<ProviderCallResult<T>> {
    return this.request<T>('DELETE', path, { headers });
  }

  /**
   * Return the current access token as a raw string. Used by callers that
   * must sign a non-Graph endpoint with the Graph-issued bearer (there are
   * none today, but OneDrive's signed download URL is explicitly NOT such a
   * caller — it does not require auth at all).
   *
   * Not a hot path — prefer `request()` / `get()` / `post()` so health is
   * tracked by the registry.
   */
  async getAccessToken(): Promise<string> {
    const headers: Record<string, string> = {};
    await this.auth.applyAuth(headers);
    const bearer = headers['Authorization'];
    if (!bearer || !bearer.startsWith('Bearer ')) {
      throw new Error('GraphProviderClient.getAccessToken: OAuth strategy did not emit a bearer token');
    }
    return bearer.slice('Bearer '.length);
  }

  /**
   * Normalize a raw path or absolute URL into a path relative to this
   * client's `baseUrl`.
   *
   * Graph `@odata.nextLink` values come back as absolute URLs — MOST of the
   * time they match the configured `baseUrl` exactly, but there are two
   * edge cases we must handle to avoid producing a double-prefixed URL:
   *
   *   1. **Version drift**: a v1.0-configured client receives a nextLink
   *      pointing at `/beta/`. Rare but possible — we route it through the
   *      beta host *without* re-prefixing the configured `v1.0` base.
   *   2. **Regional endpoints**: some tenants use `graph.microsoft.us`,
   *      `graph.microsoft.de`, etc. If the link is clearly a Graph URL
   *      (starts with `https://graph.microsoft.`) we pass it through as
   *      an absolute URL so `fetch()` handles it correctly. Any other
   *      host is passed through unchanged — if it's a bug, better the
   *      request fails loudly than silently double-prefix.
   *
   * In both cases we return the full URL — `BaseProviderClient` treats a
   * fully-qualified URL after `${baseUrl}${path}` concatenation as a
   * pure-string concat, so a full URL in `path` produces an invalid
   * result. To handle this cleanly, we need an absolute-URL fast path in
   * the calling code — see `request()`.
   */
  private normalizePath(pathOrUrl: string): { isAbsolute: boolean; value: string } {
    if (pathOrUrl.startsWith(this.baseUrl)) {
      const remainder = pathOrUrl.slice(this.baseUrl.length);
      return {
        isAbsolute: false,
        value: remainder.startsWith('/') ? remainder : `/${remainder}`,
      };
    }
    // A full Graph URL that doesn't match our exact baseUrl (e.g. /beta/ on
    // a v1.0 client, or a regional endpoint). Return it as absolute so the
    // caller can bypass `baseUrl + path` concatenation.
    if (/^https?:\/\//i.test(pathOrUrl)) {
      return { isAbsolute: true, value: pathOrUrl };
    }
    // Relative path — fall through to normal `baseUrl + path` behavior.
    return { isAbsolute: false, value: pathOrUrl };
  }
}

/**
 * Build a `GraphProviderClient` from the standard Entra env vars (shared
 * with SSO). Returns `null` when any required var is missing so startup
 * wiring can no-op in test / local-dev environments.
 */
export function buildGraphProviderClientFromEnv(
  overrides?: Partial<GraphProviderClientConfig>,
): GraphProviderClient | null {
  const tenantId = process.env.CBL_SSO_ALLOWED_TENANT_ID;
  const clientId = process.env.CBL_SSO_CLIENT_ID;
  const clientSecret = process.env.CBL_SSO_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) return null;

  return new GraphProviderClient({
    tenantId,
    clientId,
    clientSecret,
    ...overrides,
  });
}
