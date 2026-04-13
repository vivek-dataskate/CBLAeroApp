import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import {
  getSupabaseAdminClient,
  shouldUseInMemoryPersistenceForTests,
} from "@/modules/persistence";
import { AUTH_ISSUER, getAuthSigningSecret } from "./config";

const CROSS_CLIENT_CONFIRMATION_AUDIENCE = "cblaero-cross-client-confirmation";
const CROSS_CLIENT_CONFIRMATION_TTL_SECONDS = 5 * 60;

type CrossClientConfirmationPayload = JWTPayload & {
  actor_id: string;
  active_client_id: string;
  target_client_id: string;
  action: string;
  path: string;
  method: string;
  intent_hash: string;
};

// In-memory replay prevention (test mode only)
const usedTokenExpirations = new Map<string, number>();

function toSigningKey(): Uint8Array {
  return new TextEncoder().encode(getAuthSigningSecret());
}

function asEpochSeconds(nowMs: number): number {
  return Math.floor(nowMs / 1000);
}

function cleanupExpiredTokens(nowEpochSec: number): void {
  for (const [jti, expiresAtEpochSec] of usedTokenExpirations.entries()) {
    if (expiresAtEpochSec <= nowEpochSec) {
      usedTokenExpirations.delete(jti);
    }
  }
}

export async function issueCrossClientConfirmationToken(input: {
  actorId: string;
  activeClientId: string;
  targetClientId: string;
  action: string;
  path: string;
  method: string;
  intentHash: string;
  nowMs?: number;
}): Promise<{ token: string; expiresAtIso: string }> {
  const nowMs = input.nowMs ?? Date.now();
  const nowEpochSec = Math.floor(nowMs / 1000);
  const expiresAtEpochSec = nowEpochSec + CROSS_CLIENT_CONFIRMATION_TTL_SECONDS;

  const token = await new SignJWT({
    actor_id: input.actorId,
    active_client_id: input.activeClientId,
    target_client_id: input.targetClientId,
    action: input.action,
    path: input.path,
    method: input.method,
    intent_hash: input.intentHash,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(AUTH_ISSUER)
    .setAudience(CROSS_CLIENT_CONFIRMATION_AUDIENCE)
    .setJti(crypto.randomUUID())
    .setIssuedAt(nowEpochSec)
    .setExpirationTime(expiresAtEpochSec)
    .sign(toSigningKey());

  return {
    token,
    expiresAtIso: new Date(expiresAtEpochSec * 1000).toISOString(),
  };
}

export async function verifyCrossClientConfirmationToken(input: {
  token: string;
  actorId: string;
  activeClientId: string;
  targetClientId: string;
  action: string;
  path: string;
  method: string;
  intentHash: string;
}): Promise<{ jti: string; expiresAtEpochSec: number } | null> {
  try {
    const { payload } = await jwtVerify(input.token, toSigningKey(), {
      issuer: AUTH_ISSUER,
      audience: CROSS_CLIENT_CONFIRMATION_AUDIENCE,
      algorithms: ["HS256"],
    });

    const confirmation = payload as CrossClientConfirmationPayload;
    const jti = typeof confirmation.jti === "string" ? confirmation.jti : null;
    const expiresAtEpochSec = typeof confirmation.exp === "number" ? confirmation.exp : null;

    if (!jti || expiresAtEpochSec === null) {
      return null;
    }

    const claimsMatch =
      confirmation.actor_id === input.actorId &&
      confirmation.active_client_id === input.activeClientId &&
      confirmation.target_client_id === input.targetClientId &&
      confirmation.action === input.action &&
      confirmation.path === input.path &&
      confirmation.method === input.method &&
      confirmation.intent_hash === input.intentHash;

    if (!claimsMatch) {
      return null;
    }

    return { jti, expiresAtEpochSec };
  } catch {
    return null;
  }
}

export async function consumeCrossClientConfirmationToken(
  jti: string,
  expiresAtEpochSec: number,
): Promise<boolean> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const nowEpochSec = asEpochSeconds(Date.now());
    cleanupExpiredTokens(nowEpochSec);

    const existing = usedTokenExpirations.get(jti);
    if (existing && existing > nowEpochSec) {
      return false;
    }

    usedTokenExpirations.set(jti, expiresAtEpochSec);
    return true;
  }

  const nowIso = new Date().toISOString();
  const client = getSupabaseAdminClient();
  await client
    .from("cross_client_confirmation_token_uses")
    .delete()
    .lte("expires_at", nowIso);

  const { error } = await client.from("cross_client_confirmation_token_uses").insert({
    jti,
    expires_at: new Date(expiresAtEpochSec * 1000).toISOString(),
    consumed_at: nowIso,
  });

  if (!error) {
    return true;
  }

  if (error.code === "23505") {
    return false;
  }

  throw new Error(`Failed to consume cross-client confirmation token: ${error.message}`);
}

export function clearCrossClientConfirmationStoreForTest(): void {
  if (!shouldUseInMemoryPersistenceForTests()) return;
  usedTokenExpirations.clear();
}
