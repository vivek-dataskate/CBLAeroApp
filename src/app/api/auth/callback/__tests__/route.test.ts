import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMocks = vi.hoisted(() => ({
  exchangeAuthorizationCode: vi.fn(),
  verifyAndMapIdentityClaims: vi.fn(),
  issueSessionToken: vi.fn(),
  verifyAuthStateToken: vi.fn(),
  toSsoError: vi.fn((error: unknown) => error),
  shouldUseSecureCookies: vi.fn(() => false),
}));

const adminMocks = vi.hoisted(() => ({
  registerOrSyncUserFromSession: vi.fn(),
}));

vi.mock("@/modules/auth", () => ({
  AUTH_STATE_COOKIE_NAME: "cbl_auth_state",
  SESSION_COOKIE_NAME: "cbl_session",
  exchangeAuthorizationCode: authMocks.exchangeAuthorizationCode,
  verifyAndMapIdentityClaims: authMocks.verifyAndMapIdentityClaims,
  issueSessionToken: authMocks.issueSessionToken,
  verifyAuthStateToken: authMocks.verifyAuthStateToken,
  toSsoError: authMocks.toSsoError,
  shouldUseSecureCookies: authMocks.shouldUseSecureCookies,
}));

vi.mock("@/modules/admin", () => ({
  registerOrSyncUserFromSession: adminMocks.registerOrSyncUserFromSession,
}));

import { GET } from "../route";

describe("auth callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authMocks.verifyAuthStateToken.mockResolvedValue({
      state: "state-1",
      nonce: "nonce-1",
      rememberDevice: false,
      returnToPath: "/dashboard",
    });

    authMocks.exchangeAuthorizationCode.mockResolvedValue({
      id_token: "id-token",
    });

    authMocks.verifyAndMapIdentityClaims.mockResolvedValue({
      actorId: "actor-1",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin",
    });

    authMocks.issueSessionToken.mockResolvedValue({
      token: "session-token",
      ttlSeconds: 3600,
      session: {
        sessionId: "session-1",
        actorId: "actor-1",
        email: "admin@cblsolutions.com",
        tenantId: "tenant-a",
        role: "admin",
        rememberDevice: false,
        issuedAtEpochSec: 1,
        expiresAtEpochSec: 3601,
      },
    });
  });

  it("continues login when governance sync fails", async () => {
    adminMocks.registerOrSyncUserFromSession.mockRejectedValue(
      new Error("Failed to query managed user by actor: Invalid schema: cblaero_app"),
    );

    const request = new NextRequest(
      "https://aerodelivery.onrender.com/api/auth/callback?state=state-1&code=code-1",
      {
        headers: {
          cookie: "cbl_auth_state=auth-state-token",
          "x-trace-id": "trace-auth-callback-1",
        },
      },
    );

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://aerodelivery.onrender.com/dashboard");

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("cbl_session=session-token");
    expect(setCookie).toContain("cbl_auth_state=");

    expect(adminMocks.registerOrSyncUserFromSession).toHaveBeenCalledTimes(1);
  });
});
