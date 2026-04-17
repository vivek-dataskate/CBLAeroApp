/**
 * Ceipal auth strategy — Story 1-12a Task 3
 *
 * Implements the Ceipal-specific token-exchange flow as an `AuthStrategy`
 * so it can plug into `BaseProviderClient`. Replaces the module-level
 * `tokenCache` singleton from the legacy `src/modules/ats/ceipal.ts` with
 * instance-scoped state.
 *
 * Auth endpoint: POST https://api.ceipal.com/v1/createAuthtoken/
 *   Request body: { api_key, email, password, json:1 }
 *   Response: XML (<access_token>token</access_token>) OR JSON
 *             ({ token, access_token, expires_in }) — Ceipal returns either
 *             shape depending on account config; both are supported.
 *
 * Token is cached with a 5-minute refresh buffer. The 10-second timeout on the
 * auth fetch mirrors `OAuthTokenAuth.refreshToken` — the auth endpoint must
 * not hang all outbound Ceipal traffic.
 *
 * Security:
 *   - Auth response body is NEVER logged raw (may echo credentials). The
 *     sanitized `[Ceipal] Auth failed (${status}) …` pattern from the legacy
 *     module is preserved exactly.
 */
import type { AuthStrategy } from '../types';

const DEFAULT_AUTH_URL = 'https://api.ceipal.com/v1/createAuthtoken/';
const DEFAULT_REFRESH_BUFFER_MS = 300_000; // 5 minutes
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_EXPIRES_IN_S = 3600; // 1 hour fallback if token endpoint omits expires_in

interface TokenCache {
  token: string;
  expiresAt: number;
}

export interface CeipalAuthStrategyConfig {
  apiKey: string;
  email: string;
  password: string;
  authUrl?: string;
  /** Buffer in ms before expiry to trigger a refresh. */
  refreshBufferMs?: number;
  /** Timeout for the token endpoint fetch. */
  timeoutMs?: number;
}

export class CeipalAuthStrategy implements AuthStrategy {
  private cache: TokenCache | null = null;
  private pendingRefresh: Promise<void> | null = null;

  constructor(private readonly config: CeipalAuthStrategyConfig) {
    if (!config.apiKey || !config.email || !config.password) {
      throw new Error(
        'CeipalAuthStrategy: apiKey, email, password all required (set CEIPAL_API_KEY/USERNAME/PASSWORD)',
      );
    }
  }

  async applyAuth(headers: Record<string, string>): Promise<Record<string, string>> {
    if (this.isExpired()) {
      await this.refreshOnce();
    }
    if (!this.cache) {
      throw new Error('CeipalAuthStrategy: no token available after refresh');
    }
    headers['Authorization'] = `Bearer ${this.cache.token}`;
    return headers;
  }

  private isExpired(): boolean {
    if (!this.cache) return true;
    const buffer = this.config.refreshBufferMs ?? DEFAULT_REFRESH_BUFFER_MS;
    return Date.now() >= this.cache.expiresAt - buffer;
  }

  /**
   * Coalesce concurrent refreshes — mirrors `OAuthTokenAuth` pattern so the
   * first caller triggers the fetch and all others await the same promise.
   */
  private async refreshOnce(): Promise<void> {
    if (this.pendingRefresh) {
      await this.pendingRefresh;
      return;
    }
    this.pendingRefresh = this.refreshToken().finally(() => {
      this.pendingRefresh = null;
    });
    await this.pendingRefresh;
  }

  private async refreshToken(): Promise<void> {
    const url = this.config.authUrl || DEFAULT_AUTH_URL;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.config.apiKey,
          email: this.config.email,
          password: this.config.password,
          json: 1,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw new Error(`[Ceipal] Auth request timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // Do NOT log response body — may echo back credentials. Contract from
      // legacy ceipal.ts:62-63 preserved byte-exact for operator runbooks.
      throw new Error(
        `[Ceipal] Auth failed (${response.status}) — check Ceipal admin panel for details`,
      );
    }

    const text = await response.text();
    let token: string | undefined;
    let expiresIn = DEFAULT_EXPIRES_IN_S;
    // Review patch (F7): track whether the server actually sent a positive
    // `expires_in`. If it sent 0 / negative / missing, we force-refresh on the
    // next call instead of caching the default 3600s for a token the server
    // says is already dead.
    let serverProvidedExpiry = false;

    // Response may be XML or JSON — try XML regex first (faster path).
    const xmlMatch = text.match(/<access_token>([^<]+)<\/access_token>/);
    if (xmlMatch) {
      token = xmlMatch[1];
    } else {
      try {
        const data = JSON.parse(text) as {
          token?: string;
          access_token?: string;
          expires_in?: number;
        };
        token = data.token ?? data.access_token;
        if (typeof data.expires_in === 'number' && data.expires_in > 0) {
          expiresIn = data.expires_in;
          serverProvidedExpiry = true;
        } else if (typeof data.expires_in === 'number') {
          // Server sent a non-positive value (0 / negative) — treat as
          // "token already expired; refresh on next call".
          serverProvidedExpiry = false;
        }
      } catch (parseErr) {
        console.warn(
          '[Ceipal] JSON parse failed for auth response:',
          parseErr instanceof Error ? parseErr.message : parseErr,
        );
      }
    }

    if (!token) {
      // Truncate + redact — auth response may contain echoed credentials.
      throw new Error(`[Ceipal] Auth response missing token (response length: ${text.length})`);
    }

    // XML responses don't carry `expires_in`, so serverProvidedExpiry stays
    // false — but XML is only emitted by Ceipal accounts configured for legacy
    // SOAP-style auth and we keep the default 1h buffer there.
    const expiresAt = serverProvidedExpiry || xmlMatch
      ? Date.now() + expiresIn * 1000
      : Date.now() - 1;
    this.cache = { token, expiresAt };
    console.log(
      serverProvidedExpiry || xmlMatch
        ? `[Ceipal] Token acquired, expires in ${expiresIn}s`
        : '[Ceipal] Token acquired but server reported non-positive expires_in — will force refresh on next call',
    );
  }

  /**
   * Invalidate the cached token so the next `applyAuth` forces a refresh.
   * Used both by the 401 recovery path in `CeipalProviderClient.fetchApplicants`
   * (mid-run token revocation) and by test cleanup.
   *
   * Review patch M-10: renamed from `clearCacheForTest` now that a production
   * caller exists; the old name is kept as a deprecated alias so test imports
   * don't need a rename sweep.
   */
  invalidateCache(): void {
    this.cache = null;
    this.pendingRefresh = null;
  }

  /** @deprecated — review patch M-10 renamed this to `invalidateCache`. */
  clearCacheForTest(): void {
    this.invalidateCache();
  }
}
