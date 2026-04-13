import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCrossClientConfirmationStoreForTest,
  consumeCrossClientConfirmationToken,
  issueCrossClientConfirmationToken,
  verifyCrossClientConfirmationToken,
} from "@/modules/auth/cross-client-confirmation";

const BASE_INPUT = {
  actorId: "actor-1",
  activeClientId: "client-a",
  targetClientId: "client-b",
  action: "candidate:data-export",
  path: "/api/internal/candidates",
  method: "POST",
  intentHash: "abc123hash",
};

describe("cross-client-confirmation (in-memory)", () => {
  beforeEach(() => {
    clearCrossClientConfirmationStoreForTest();
  });

  it("issues a valid token with expiry", async () => {
    const result = await issueCrossClientConfirmationToken(BASE_INPUT);
    expect(result.token).toBeTruthy();
    expect(result.expiresAtIso).toBeTruthy();
    expect(new Date(result.expiresAtIso).getTime()).toBeGreaterThan(Date.now());
  });

  it("verifies a token with matching claims", async () => {
    const { token } = await issueCrossClientConfirmationToken(BASE_INPUT);
    const verified = await verifyCrossClientConfirmationToken({
      token,
      ...BASE_INPUT,
    });
    expect(verified).not.toBeNull();
    expect(verified!.jti).toBeTruthy();
    expect(verified!.expiresAtEpochSec).toBeGreaterThan(0);
  });

  it("rejects token with mismatched claims", async () => {
    const { token } = await issueCrossClientConfirmationToken(BASE_INPUT);
    const verified = await verifyCrossClientConfirmationToken({
      token,
      ...BASE_INPUT,
      actorId: "different-actor",
    });
    expect(verified).toBeNull();
  });

  it("rejects garbage token", async () => {
    const verified = await verifyCrossClientConfirmationToken({
      token: "not-a-jwt",
      ...BASE_INPUT,
    });
    expect(verified).toBeNull();
  });

  it("consumes a token exactly once", async () => {
    const { token } = await issueCrossClientConfirmationToken(BASE_INPUT);
    const verified = await verifyCrossClientConfirmationToken({
      token,
      ...BASE_INPUT,
    });
    expect(verified).not.toBeNull();

    const consumed1 = await consumeCrossClientConfirmationToken(
      verified!.jti,
      verified!.expiresAtEpochSec,
    );
    expect(consumed1).toBe(true);

    const consumed2 = await consumeCrossClientConfirmationToken(
      verified!.jti,
      verified!.expiresAtEpochSec,
    );
    expect(consumed2).toBe(false);
  });

  it("clears store for test", async () => {
    const { token } = await issueCrossClientConfirmationToken(BASE_INPUT);
    const verified = await verifyCrossClientConfirmationToken({
      token,
      ...BASE_INPUT,
    });
    await consumeCrossClientConfirmationToken(
      verified!.jti,
      verified!.expiresAtEpochSec,
    );

    clearCrossClientConfirmationStoreForTest();

    // After clear, same JTI should be consumable again
    const consumedAgain = await consumeCrossClientConfirmationToken(
      verified!.jti,
      verified!.expiresAtEpochSec,
    );
    expect(consumedAgain).toBe(true);
  });
});
