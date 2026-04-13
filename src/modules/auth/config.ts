export const AUTH_ISSUER = "cblaero-auth";

const TEST_ONLY_SIGNING_SECRET = "test-only-signing-secret-change-in-production";

export function getAuthSigningSecret(): string {
  const configured = process.env.CBL_SESSION_SECRET;
  if (configured && configured.length >= 32) {
    return configured;
  }

  if (process.env.NODE_ENV === "test") {
    return TEST_ONLY_SIGNING_SECRET;
  }

  throw new Error(
    "Missing or weak CBL_SESSION_SECRET. Configure a value with at least 32 characters.",
  );
}

export function shouldUseSecureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}
