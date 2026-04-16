import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMocks = vi.hoisted(() => ({
  validateActiveSession: vi.fn(),
  revokeSession: vi.fn(),
  shouldUseSecureCookies: vi.fn(() => false),
  getEntraLogoutUrl: vi.fn((postLogoutUri: string) => new URL(`https://login.microsoftonline.com/tenant/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(postLogoutUri)}`)),
}));

vi.mock("@/modules/auth", () => ({
  SESSION_COOKIE_NAME: "cbl_session",
  validateActiveSession: authMocks.validateActiveSession,
  revokeSession: authMocks.revokeSession,
  shouldUseSecureCookies: authMocks.shouldUseSecureCookies,
  getEntraLogoutUrl: authMocks.getEntraLogoutUrl,
}));

import { GET } from "../route";

describe("auth logout route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authMocks.validateActiveSession.mockResolvedValue({
      sessionId: "session-1",
      actorId: "actor-1",
      email: "admin@cblsolutions.com",
      tenantId: "tenant-a",
      role: "admin",
      rememberDevice: false,
      issuedAtEpochSec: 1,
      expiresAtEpochSec: 3601,
    });
  });

  it("clears cookie and redirects even when revocation fails", async () => {
    authMocks.revokeSession.mockRejectedValue(new Error("revocation persistence unavailable"));

    const request = new NextRequest("https://aerodelivery.onrender.com/api/auth/logout", {
      method: "GET",
      headers: {
        cookie: "cbl_session=session-token",
        "x-trace-id": "trace-logout-1",
      },
    });

    const response = await GET(request);

    expect(response.status).toBe(307);
    const redirectUrl = response.headers.get("location") ?? "";
    expect(redirectUrl).toContain("login.microsoftonline.com");
    expect(redirectUrl).toContain("post_logout_redirect_uri");

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("cbl_session=");
    expect(setCookie).toContain("Max-Age=0");

    expect(authMocks.revokeSession).toHaveBeenCalledWith("session-1", 3601);
  });
});
