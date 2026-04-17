import type { AuthStrategy } from '../types';

const DEFAULT_REFRESH_TIMEOUT_MS = 10_000;
const DEFAULT_REFRESH_COOLDOWN_MS = 30_000;

/**
 * OAuth2 client-credentials token with automatic refresh.
 * Caches the access token, coalesces concurrent refreshes via a shared promise,
 * and validates the token response body before caching.
 *
 * Review patch H-2: after a failed refresh, subsequent calls within
 * `refreshCooldownMs` reject fast with the cached error instead of spawning a
 * new fetch against the IdP. Without this, an IdP outage produces one
 * outbound request per caller — storm.
 */
export class OAuthTokenAuth implements AuthStrategy {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private pendingRefresh: Promise<void> | null = null;
  private lastFailureAt = 0;
  private lastFailureError: Error | null = null;
  /**
   * Monotonic counter bumped by every `invalidateCache()` call. A refresh
   * reads this at its START and again before writing `accessToken` — if the
   * counter moved during the fetch, the refresh discards its (now stale)
   * result instead of restoring a token that `invalidateCache()` meant to
   * retire. Prevents the 401-retry race where an in-flight refresh ends up
   * re-caching the revoked token.
   */
  private refreshEpoch = 0;

  constructor(
    private readonly tokenUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    /** Buffer in ms before expiry to trigger refresh (default 30s). */
    private readonly refreshBufferMs: number = 30_000,
    /** Timeout for the token endpoint fetch (default 10s). */
    private readonly refreshTimeoutMs: number = DEFAULT_REFRESH_TIMEOUT_MS,
    /** Cooldown after a failed refresh before we retry the IdP (default 30s). */
    private readonly refreshCooldownMs: number = DEFAULT_REFRESH_COOLDOWN_MS,
    /**
     * OAuth2 `scope` parameter for client_credentials. Required by Microsoft
     * Entra (e.g. `https://graph.microsoft.com/.default`) and most OIDC IdPs
     * that implement scoped client-credentials. Omitted from the request body
     * when null.
     */
    private readonly scope: string | null = null,
  ) {}

  async applyAuth(headers: Record<string, string>): Promise<Record<string, string>> {
    if (this.isExpired()) {
      await this.refreshTokenOnce();
    }
    if (!this.accessToken) {
      throw new Error('OAuthTokenAuth: no access token available after refresh');
    }
    headers['Authorization'] = `Bearer ${this.accessToken}`;
    return headers;
  }

  private isExpired(): boolean {
    return !this.accessToken || Date.now() >= this.expiresAt - this.refreshBufferMs;
  }

  /**
   * Coalesce concurrent refresh attempts: the first caller triggers the refresh,
   * all others await the same in-flight promise.
   */
  private async refreshTokenOnce(): Promise<void> {
    if (this.pendingRefresh) {
      await this.pendingRefresh;
      return;
    }
    if (this.lastFailureError && Date.now() - this.lastFailureAt < this.refreshCooldownMs) {
      throw this.lastFailureError;
    }
    this.pendingRefresh = this.refreshToken()
      .then(() => {
        this.lastFailureError = null;
      })
      .catch((err) => {
        this.lastFailureAt = Date.now();
        this.lastFailureError = err instanceof Error ? err : new Error(String(err));
        throw err;
      })
      .finally(() => {
        this.pendingRefresh = null;
      });
    await this.pendingRefresh;
  }

  private async refreshToken(): Promise<void> {
    const epochAtStart = this.refreshEpoch;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    if (this.scope) body.set('scope', this.scope);

    // Explicit timeout — the token endpoint must not hang all outbound calls.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.refreshTimeoutMs);
    let response: Response;
    try {
      response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw new Error(`OAuth token refresh timed out after ${this.refreshTimeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`OAuth token refresh failed: ${response.status} ${response.statusText}`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error('OAuth token refresh: response body was not valid JSON');
    }

    // Validate response shape — some providers return 200 with an error body.
    if (!data || typeof data !== 'object') {
      throw new Error('OAuth token refresh: response body was not an object');
    }
    const maybe = data as { access_token?: unknown; expires_in?: unknown; error?: unknown };

    if (maybe.error) {
      throw new Error(`OAuth token refresh: provider returned error: ${String(maybe.error)}`);
    }
    if (typeof maybe.access_token !== 'string' || maybe.access_token.length === 0) {
      throw new Error('OAuth token refresh: missing or invalid access_token');
    }
    if (typeof maybe.expires_in !== 'number' || !Number.isFinite(maybe.expires_in) || maybe.expires_in <= 0) {
      throw new Error('OAuth token refresh: missing or invalid expires_in');
    }

    // Discard the result if `invalidateCache()` fired during the fetch.
    // The token we fetched may have been revoked (that's WHY invalidate
    // was called). Writing it back would defeat the 401-recovery path.
    // The next `applyAuth` call will see `accessToken = null` and trigger
    // a FRESH refresh that captures post-invalidate state.
    if (epochAtStart !== this.refreshEpoch) return;

    this.accessToken = maybe.access_token;
    this.expiresAt = Date.now() + maybe.expires_in * 1000;
  }

  /**
   * Invalidate the cached access token so the next `applyAuth` forces a
   * refresh. Used by the 401-recovery path in `GraphProviderClient` — when
   * Graph returns 401 mid-run (token revoked / rotated), the client calls
   * this and retries the request once with a fresh token.
   *
   * Also clears any lingering cooldown from a previous refresh failure so
   * the next call hits the IdP immediately rather than rejecting fast.
   *
   * Note: we intentionally DO NOT clear `pendingRefresh` here — the
   * in-flight promise is allowed to complete on its own, and its
   * `.finally()` cleanup coordinates the singleton invariant. The
   * `refreshEpoch` bump ensures the in-flight refresh cannot write a
   * now-stale token back into `accessToken` after we've cleared it.
   */
  invalidateCache(): void {
    this.accessToken = null;
    this.expiresAt = 0;
    this.lastFailureAt = 0;
    this.lastFailureError = null;
    this.refreshEpoch++;
  }

  /** @deprecated Prefer `invalidateCache()`. Kept for existing test imports. */
  clearTokenForTest(): void {
    this.invalidateCache();
  }
}
