import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSsoAuthorizationRequest,
  isRememberDeviceRequested,
  issueSessionToken,
  revokeSession,
  validateActiveSession,
  verifyAuthStateToken,
} from "../auth";

const ORIGINAL_ENV = { ...process.env };

describe("story 1.2 auth flow coverage", () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      CBL_APP_URL: "https://aerodelivery.onrender.com",
      CBL_SSO_ISSUER: "https://login.microsoftonline.com/test-tenant-id",
      CBL_SSO_CLIENT_ID: "test-client-id",
      CBL_SSO_CLIENT_SECRET: "test-client-secret",
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("creates authorization request and round-trips auth state", async () => {
    const { authorizationUrl, authStateToken } = await createSsoAuthorizationRequest({
      rememberDevice: true,
      returnToPath: "/dashboard",
    });

    expect(authorizationUrl.pathname).toBe("/test-tenant-id/oauth2/v2.0/authorize");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("test-client-id");
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://aerodelivery.onrender.com/api/auth/callback",
    );
    expect(authorizationUrl.searchParams.get("scope")).toBe("openid profile email");
    expect(authorizationUrl.searchParams.get("max_age")).toBeNull();

    const authState = await verifyAuthStateToken(authStateToken);
    expect(authState).not.toBeNull();
    expect(authState?.rememberDevice).toBe(true);
    expect(authState?.returnToPath).toBe("/dashboard");
  });

  it("normalizes unsafe return paths to dashboard", async () => {
    const { authStateToken } = await createSsoAuthorizationRequest({
      rememberDevice: false,
      returnToPath: "https://evil.example/path",
    });

    const authState = await verifyAuthStateToken(authStateToken);
    expect(authState?.returnToPath).toBe("/dashboard");
  });

  it("accepts successful login session then rejects revoked session", async () => {
    const nowMs = Date.UTC(2026, 2, 12, 12, 0, 0);
    const issued = await issueSessionToken(
      {
        actorId: "actor-10",
        email: "recruiter@cblsolutions.com",
        tenantId: "tenant-10",
        role: "recruiter",
        rememberDevice: false,
      },
      nowMs,
    );

    const active = await validateActiveSession(issued.token, nowMs + 1_000);
    expect(active?.actorId).toBe("actor-10");
    expect(active?.tenantId).toBe("tenant-10");

    await revokeSession(issued.session.sessionId, issued.session.expiresAtEpochSec);

    const revoked = await validateActiveSession(issued.token, nowMs + 2_000);
    expect(revoked).toBeNull();
  });

  it("parses remember-device query values", () => {
    expect(isRememberDeviceRequested("true")).toBe(true);
    expect(isRememberDeviceRequested("1")).toBe(true);
    expect(isRememberDeviceRequested("false")).toBe(false);
    expect(isRememberDeviceRequested(null)).toBe(false);
  });
});