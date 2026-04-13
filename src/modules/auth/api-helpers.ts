import { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "./session";

/**
 * Map authorization deny reasons to API error codes.
 * Shared by all API routes that call authorizeAccess().
 */
export function toErrorCode(reason: "unauthenticated" | "forbidden_role" | "tenant_mismatch"): string {
  if (reason === "unauthenticated") return "unauthenticated";
  if (reason === "tenant_mismatch") return "tenant_forbidden";
  return "forbidden";
}

/**
 * Extract the session token from the Next.js request cookie jar.
 * Shared by all API routes that call validateActiveSession().
 */
export function extractSessionToken(request: NextRequest): string | null {
  return request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
}
