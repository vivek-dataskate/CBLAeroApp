import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SESSION_TTL_SECONDS,
  MAX_REMEMBER_DEVICE_SECONDS,
  clearRevokedSessionsForTest,
  extractSessionTokenFromCookieHeader,
  issueSessionToken,
  revokeSession,
  verifySessionToken,
} from "../auth";

describe("auth session controls", () => {
  beforeEach(async () => {
    await clearRevokedSessionsForTest();
  });

  it("issues standard session TTL for non-remembered login", async () => {
    const nowMs = Date.UTC(2026, 2, 11, 12, 0, 0);
    const issued = await issueSessionToken(
      {
        actorId: "actor-1",
        email: "user@cblsolutions.com",
        tenantId: "tenant-1",
        role: "recruiter",
        rememberDevice: false,
      },
      nowMs,
    );

    expect(issued.ttlSeconds).toBe(DEFAULT_SESSION_TTL_SECONDS);

    const verified = await verifySessionToken(issued.token, nowMs + 1_000);
    expect(verified?.actorId).toBe("actor-1");
    expect(verified?.tenantId).toBe("tenant-1");
    expect(verified?.clientIds).toEqual(["tenant-1"]);
    expect(verified?.rememberDevice).toBe(false);
  });

  it("includes explicit client context list in session token", async () => {
    const nowMs = Date.UTC(2026, 2, 11, 12, 0, 0);
    const issued = await issueSessionToken(
      {
        actorId: "actor-multi",
        email: "multi@cblsolutions.com",
        tenantId: "tenant-a",
        clientIds: ["tenant-a", "tenant-b", "tenant-b"],
        role: "delivery-head",
        rememberDevice: false,
      },
      nowMs,
    );

    const verified = await verifySessionToken(issued.token, nowMs + 1_000);
    expect(verified?.clientIds).toEqual(["tenant-a", "tenant-b"]);
  });

  it("issues 30-day session TTL when remember-device is enabled", async () => {
    const nowMs = Date.UTC(2026, 2, 11, 12, 0, 0);
    const issued = await issueSessionToken(
      {
        actorId: "actor-2",
        email: "admin@cblsolutions.com",
        tenantId: "tenant-2",
        role: "admin",
        rememberDevice: true,
      },
      nowMs,
    );

    expect(issued.ttlSeconds).toBe(MAX_REMEMBER_DEVICE_SECONDS);

    const verified = await verifySessionToken(
      issued.token,
      nowMs + (MAX_REMEMBER_DEVICE_SECONDS - 30) * 1_000,
    );
    expect(verified?.rememberDevice).toBe(true);
  });

  it("rejects expired sessions server-side", async () => {
    const nowMs = Date.UTC(2026, 2, 11, 12, 0, 0);
    const issued = await issueSessionToken(
      {
        actorId: "actor-3",
        email: "ops@cblsolutions.com",
        tenantId: "tenant-3",
        role: "delivery-head",
        rememberDevice: false,
      },
      nowMs,
    );

    const verified = await verifySessionToken(
      issued.token,
      nowMs + (DEFAULT_SESSION_TTL_SECONDS + 1) * 1_000,
    );

    expect(verified).toBeNull();
  });

  it("rejects revoked sessions server-side", async () => {
    const nowMs = Date.UTC(2026, 2, 11, 12, 0, 0);
    const issued = await issueSessionToken(
      {
        actorId: "actor-4",
        email: "security@cblsolutions.com",
        tenantId: "tenant-4",
        role: "compliance-officer",
        rememberDevice: false,
      },
      nowMs,
    );

    await revokeSession(issued.session.sessionId, issued.session.expiresAtEpochSec);

    const verified = await verifySessionToken(issued.token, nowMs + 1_000);
    expect(verified).toBeNull();
  });

  it("extracts session token from cookie header", () => {
    const token = extractSessionTokenFromCookieHeader(
      "other=value; cbl_session=session-token-value; path=/",
    );

    expect(token).toBe("session-token-value");
  });
});
