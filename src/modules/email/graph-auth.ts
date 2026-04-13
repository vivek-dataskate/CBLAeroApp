import { fetchWithRetry } from '../ingestion/fetch-with-retry';

/**
 * Microsoft Graph client credentials token acquisition.
 * Uses the same Azure app registration as SSO (CBL_SSO_* env vars).
 * Requires Mail.ReadShared (or Mail.Read) application permission granted in Azure AD.
 */

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

// Module-level cache: resets on serverless cold starts (acceptable — re-auth is cheap)
let tokenCache: TokenCache | null = null;

function getGraphConfig() {
  const tenantId = process.env.CBL_SSO_ALLOWED_TENANT_ID;
  const clientId = process.env.CBL_SSO_CLIENT_ID;
  const clientSecret = process.env.CBL_SSO_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      'Microsoft Graph auth not configured. Required: CBL_SSO_ALLOWED_TENANT_ID, CBL_SSO_CLIENT_ID, CBL_SSO_CLIENT_SECRET'
    );
  }

  return { tenantId, clientId, clientSecret };
}

export async function acquireGraphToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken;
  }

  const { tenantId, clientId, clientSecret } = getGraphConfig();

  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    // Parse only safe fields — do NOT log raw body (may contain tenant/client IDs)
    let errorCode = 'unknown';
    try {
      const errData = await response.json() as { error?: string; error_description?: string };
      errorCode = errData.error ?? `status_${response.status}`;
    } catch { /* response not JSON */ }
    throw new Error(`[Graph] Token acquisition failed (${response.status}): ${errorCode}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return tokenCache.accessToken;
}

export function clearGraphTokenCacheForTest(): void {
  tokenCache = null;
}
