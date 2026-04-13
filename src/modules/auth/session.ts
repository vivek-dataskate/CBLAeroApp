import { jwtVerify, SignJWT, type JWTPayload } from "jose";

import { AUTH_ISSUER, getAuthSigningSecret } from "./config";
import {
  getSupabaseAdminClient,
  shouldUseInMemoryPersistenceForTests,
} from "../persistence";

const SESSION_AUDIENCE = "cblaero-internal";

export const SESSION_COOKIE_NAME = "cbl_session";
export const AUTH_STATE_COOKIE_NAME = "cbl_auth_state";
export const AUTH_STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60;
export const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const MAX_REMEMBER_DEVICE_SECONDS = 30 * 24 * 60 * 60;

export type SessionRole =
  | "recruiter"
  | "delivery-head"
  | "admin"
  | "compliance-officer";

export type AuthSession = {
  sessionId: string;
  actorId: string;
  email: string;
  tenantId: string;
  clientIds?: string[];
  role: SessionRole;
  rememberDevice: boolean;
  issuedAtEpochSec: number;
  expiresAtEpochSec: number;
};

export type AuthContext = {
  actorId: string | null;
  authenticated: boolean;
};

export type IssueSessionInput = {
  actorId: string;
  email: string;
  tenantId: string;
  clientIds?: string[];
  role: SessionRole;
  rememberDevice: boolean;
};

export type IssuedSession = {
  token: string;
  session: AuthSession;
  ttlSeconds: number;
};

type SessionTokenPayload = JWTPayload & {
  actor_id: string;
  email: string;
  tenant_id: string;
  client_ids?: string[];
  role: SessionRole;
  remember_device: boolean;
};

const revokedSessionExpirations = new Map<string, number>();

function isInMemoryMode(): boolean {
  return shouldUseInMemoryPersistenceForTests();
}

function getSigningKey(): Uint8Array {
  return new TextEncoder().encode(getAuthSigningSecret());
}

function asEpochSeconds(nowMs: number): number {
  return Math.floor(nowMs / 1000);
}

function cleanupExpiredRevocations(nowEpochSec: number): void {
  for (const [sessionId, expiresAtEpochSec] of revokedSessionExpirations.entries()) {
    if (expiresAtEpochSec <= nowEpochSec) {
      revokedSessionExpirations.delete(sessionId);
    }
  }
}

function asSessionRole(value: unknown): SessionRole | null {
  if (
    value === "recruiter" ||
    value === "delivery-head" ||
    value === "admin" ||
    value === "compliance-officer"
  ) {
    return value;
  }

  return null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeClientIds(input: unknown, fallbackTenantId: string): string[] {
  const values = Array.isArray(input) ? input : [];
  const unique = new Set<string>();

  for (const value of values) {
    const normalized = asNonEmptyString(value);
    if (normalized) {
      unique.add(normalized);
    }
  }

  unique.add(fallbackTenantId);
  return [...unique];
}

function toSession(payload: SessionTokenPayload): AuthSession | null {
  const sessionId = asNonEmptyString(payload.jti);
  const actorId = asNonEmptyString(payload.actor_id);
  const email = asNonEmptyString(payload.email);
  const tenantId = asNonEmptyString(payload.tenant_id);
  const role = asSessionRole(payload.role);
  const issuedAtEpochSec = typeof payload.iat === "number" ? payload.iat : null;
  const expiresAtEpochSec = typeof payload.exp === "number" ? payload.exp : null;

  if (
    !sessionId ||
    !actorId ||
    !email ||
    !tenantId ||
    !role ||
    issuedAtEpochSec === null ||
    expiresAtEpochSec === null
  ) {
    return null;
  }

  const clientIds = normalizeClientIds(payload.client_ids, tenantId);

  return {
    sessionId,
    actorId,
    email,
    tenantId,
    clientIds,
    role,
    rememberDevice: payload.remember_device === true,
    issuedAtEpochSec,
    expiresAtEpochSec,
  };
}

export function getSessionTtlSeconds(rememberDevice: boolean): number {
  return rememberDevice ? MAX_REMEMBER_DEVICE_SECONDS : DEFAULT_SESSION_TTL_SECONDS;
}

export async function issueSessionToken(
  input: IssueSessionInput,
  nowMs = Date.now(),
): Promise<IssuedSession> {
  const nowEpochSec = asEpochSeconds(nowMs);
  const ttlSeconds = getSessionTtlSeconds(input.rememberDevice);
  const expiresAtEpochSec = nowEpochSec + ttlSeconds;
  const sessionId = crypto.randomUUID();
  const clientIds = normalizeClientIds(input.clientIds, input.tenantId);

  const token = await new SignJWT({
    actor_id: input.actorId,
    email: input.email,
    tenant_id: input.tenantId,
    client_ids: clientIds,
    role: input.role,
    remember_device: input.rememberDevice,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(AUTH_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setJti(sessionId)
    .setIssuedAt(nowEpochSec)
    .setExpirationTime(expiresAtEpochSec)
    .sign(getSigningKey());

  return {
    token,
    ttlSeconds,
    session: {
      sessionId,
      actorId: input.actorId,
      email: input.email,
      tenantId: input.tenantId,
      clientIds,
      role: input.role,
      rememberDevice: input.rememberDevice,
      issuedAtEpochSec: nowEpochSec,
      expiresAtEpochSec,
    },
  };
}

export async function revokeSession(
  sessionId: string,
  expiresAtEpochSec: number,
): Promise<void> {
  if (isInMemoryMode()) {
    cleanupExpiredRevocations(asEpochSeconds(Date.now()));
    revokedSessionExpirations.set(sessionId, expiresAtEpochSec);
    return;
  }

  const client = getSupabaseAdminClient();
  const { error } = await client.from("auth_session_revocations").upsert(
    {
      session_id: sessionId,
      expires_at: new Date(expiresAtEpochSec * 1000).toISOString(),
      revoked_at: new Date().toISOString(),
    },
    {
      onConflict: "session_id",
    },
  );

  if (error) {
    throw new Error(`Failed to revoke session: ${error.message}`);
  }
}

export async function clearRevokedSessionsForTest(): Promise<void> {
  if (isInMemoryMode()) {
    revokedSessionExpirations.clear();
    return;
  }

  const client = getSupabaseAdminClient();
  const { error } = await client
    .from("auth_session_revocations")
    .delete()
    .neq("session_id", "");

  if (error) {
    throw new Error(`Failed to clear revoked sessions: ${error.message}`);
  }
}

export async function isSessionRevoked(
  sessionId: string,
  nowMs = Date.now(),
): Promise<boolean> {
  if (isInMemoryMode()) {
    const nowEpochSec = asEpochSeconds(nowMs);
    cleanupExpiredRevocations(nowEpochSec);

    const expiresAtEpochSec = revokedSessionExpirations.get(sessionId);
    if (!expiresAtEpochSec) {
      return false;
    }

    if (expiresAtEpochSec <= nowEpochSec) {
      revokedSessionExpirations.delete(sessionId);
      return false;
    }

    return true;
  }

  const nowEpochSec = asEpochSeconds(nowMs);
  const nowIso = new Date(nowMs).toISOString();

  const client = getSupabaseAdminClient();

  const { error: cleanupError } = await client
    .from("auth_session_revocations")
    .delete()
    .lte("expires_at", nowIso);

  if (cleanupError) {
    throw new Error(`Failed to cleanup revoked sessions: ${cleanupError.message}`);
  }

  const { data, error } = await client
    .from("auth_session_revocations")
    .select("expires_at")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to query revoked session: ${error.message}`);
  }

  if (!data) {
    return false;
  }

  const expiresAtEpochSec = Math.floor(new Date(data.expires_at).getTime() / 1000);
  if (expiresAtEpochSec <= nowEpochSec) {
    const { error: deleteError } = await client
      .from("auth_session_revocations")
      .delete()
      .eq("session_id", sessionId);

    if (deleteError) {
      throw new Error(`Failed to delete expired revocation: ${deleteError.message}`);
    }

    return false;
  }

  return true;
}

export async function verifySessionToken(
  token: string,
  nowMs = Date.now(),
): Promise<AuthSession | null> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), {
      issuer: AUTH_ISSUER,
      audience: SESSION_AUDIENCE,
      algorithms: ["HS256"],
      currentDate: new Date(nowMs),
    });

    const session = toSession(payload as SessionTokenPayload);
    if (!session || (await isSessionRevoked(session.sessionId, nowMs))) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

export async function validateActiveSession(
  sessionToken: string | null,
  nowMs = Date.now(),
): Promise<AuthSession | null> {
  if (!sessionToken) {
    return null;
  }

  return verifySessionToken(sessionToken, nowMs);
}

export function resolveAuthContext(session: AuthSession | null = null): AuthContext {
  if (!session) {
    return {
      actorId: null,
      authenticated: false,
    };
  }

  return {
    actorId: session.actorId,
    authenticated: true,
  };
}

export function extractSessionTokenFromCookieHeader(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  const entries = cookieHeader.split(";");
  for (const rawEntry of entries) {
    const entry = rawEntry.trim();
    if (!entry.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      continue;
    }

    const value = entry.slice(SESSION_COOKIE_NAME.length + 1);
    if (!value) {
      return null;
    }

    return decodeURIComponent(value);
  }

  return null;
}
