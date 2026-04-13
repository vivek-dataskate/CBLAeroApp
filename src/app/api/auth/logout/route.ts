import { NextRequest, NextResponse } from "next/server";

import {
  SESSION_COOKIE_NAME,
  revokeSession,
  shouldUseSecureCookies,
  validateActiveSession,
} from "@/modules/auth";

function getPublicOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();

  if (forwardedHost) {
    const proto = forwardedProto || "https";
    return `${proto}://${forwardedHost}`;
  }

  const configuredAppUrl = process.env.CBL_APP_URL?.trim();
  if (configuredAppUrl) {
    try {
      return new URL(configuredAppUrl).origin;
    } catch {
      // Fall through to runtime request origin.
    }
  }

  return request.nextUrl.origin;
}

async function handleLogout(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get("x-trace-id") ?? crypto.randomUUID();
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const session = await validateActiveSession(sessionToken);

  if (session) {
    try {
      await revokeSession(session.sessionId, session.expiresAtEpochSec);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown session revocation failure.";

      console.error("[auth/logout] revocation failed; clearing cookie anyway", {
        traceId,
        sessionId: session.sessionId,
        message,
      });
    }
  }

  const response = NextResponse.redirect(new URL("/", `${getPublicOrigin(request)}/`));
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}

export async function GET(request: NextRequest) {
  return handleLogout(request);
}

export async function POST(request: NextRequest) {
  return handleLogout(request);
}
