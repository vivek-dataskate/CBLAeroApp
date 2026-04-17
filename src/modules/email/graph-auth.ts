/**
 * Microsoft Graph client credentials token acquisition.
 *
 * Story 1.12b: the token cache + `fetch` call has moved onto the
 * provider framework. `acquireGraphToken()` now delegates to the shared
 * `GraphProviderClient`'s `OAuthTokenAuth` strategy, which:
 *   - caches the access token with a 60s pre-expiry buffer,
 *   - coalesces concurrent refresh attempts,
 *   - cools down after IdP failures (30s) to prevent refresh storms,
 *   - invalidates the cache on 401 (handled inside `GraphProviderClient.request`).
 *
 * This wrapper exists to keep the one remaining legacy caller
 * (`OneDriveResumePollerJob`, which must sign non-Graph signed URLs with the
 * same bearer) working without each caller learning about the client API.
 * Net-new code should prefer `getSharedGraphClient().request(...)` instead.
 */
import { getSharedGraphClient } from '../providers/graph';

export async function acquireGraphToken(): Promise<string> {
  const client = getSharedGraphClient();
  if (!client) {
    throw new Error(
      'Microsoft Graph auth not configured. Required: CBL_SSO_ALLOWED_TENANT_ID, CBL_SSO_CLIENT_ID, CBL_SSO_CLIENT_SECRET',
    );
  }
  return client.getAccessToken();
}

/**
 * Legacy test hook — invalidates the cached Graph token on the shared client.
 * Preserved for existing tests; new tests should use
 * `resetSharedGraphClientForTest()` from `@/modules/providers/graph`.
 */
export function clearGraphTokenCacheForTest(): void {
  const client = getSharedGraphClient();
  client?.auth.invalidateCache();
}
