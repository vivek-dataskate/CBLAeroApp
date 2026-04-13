import { describe, expect, it } from "vitest";

import {
  buildStepUpReauthenticateUrl,
  getSessionAuthAgeSeconds,
  isSessionFreshForStepUp,
} from "../auth";

describe("step-up helper behavior", () => {
  it("calculates auth age in seconds", () => {
    const authAge = getSessionAuthAgeSeconds(
      {
        sessionId: "sess-1",
        actorId: "actor-1",
        email: "admin@cblsolutions.com",
        tenantId: "tenant-a",
        role: "admin",
        rememberDevice: false,
        issuedAtEpochSec: 100,
        expiresAtEpochSec: 1000,
      },
      130_000,
    );

    expect(authAge).toBe(30);
  });

  it("returns false when auth is stale for step-up", () => {
    const isFresh = isSessionFreshForStepUp(
      {
        sessionId: "sess-2",
        actorId: "actor-1",
        email: "admin@cblsolutions.com",
        tenantId: "tenant-a",
        role: "admin",
        rememberDevice: false,
        issuedAtEpochSec: 100,
        expiresAtEpochSec: 1000,
      },
      700_000,
      300,
    );

    expect(isFresh).toBe(false);
  });

  it("builds a safe re-authentication URL", () => {
    expect(buildStepUpReauthenticateUrl("/dashboard/admin?stepUp=1")).toBe(
      "/api/auth/login?next=%2Fdashboard%2Fadmin%3FstepUp%3D1",
    );

    expect(buildStepUpReauthenticateUrl("https://evil.example.com")).toBe(
      "/api/auth/login?next=%2Fdashboard%2Fadmin",
    );
  });
});
