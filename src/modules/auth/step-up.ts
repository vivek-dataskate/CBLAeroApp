import type { AuthSession } from "./session";

export const DEFAULT_STEP_UP_MAX_AGE_SECONDS = 5 * 60;

function parseMaxAgeSeconds(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function getStepUpMaxAgeSeconds(): number {
  const fromEnv = parseMaxAgeSeconds(process.env.CBL_STEP_UP_MAX_AGE_SECONDS);
  return fromEnv ?? DEFAULT_STEP_UP_MAX_AGE_SECONDS;
}

export function getSessionAuthAgeSeconds(
  session: AuthSession,
  nowMs = Date.now(),
): number {
  return Math.max(0, Math.floor(nowMs / 1000) - session.issuedAtEpochSec);
}

export function isSessionFreshForStepUp(
  session: AuthSession,
  nowMs = Date.now(),
  maxAgeSeconds = getStepUpMaxAgeSeconds(),
): boolean {
  return getSessionAuthAgeSeconds(session, nowMs) <= maxAgeSeconds;
}

export function buildStepUpReauthenticateUrl(nextPath: string): string {
  const safeNext =
    nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/dashboard/admin";

  return `/api/auth/login?next=${encodeURIComponent(safeNext)}`;
}
