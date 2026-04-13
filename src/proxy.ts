import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  SESSION_COOKIE_NAME,
  type AuthSession,
  shouldUseSecureCookies,
  validateActiveSession,
} from "./modules/auth";

// Story 1.1 baseline proxy envelope for auth and tenant context propagation.
export function applyBaselineContextHeaders(
  incomingHeaders: Headers,
  session: AuthSession | null = null,
): Headers {
  const requestHeaders = new Headers(incomingHeaders);
  const traceId = requestHeaders.get("x-trace-id") ?? crypto.randomUUID();

  requestHeaders.set("x-trace-id", traceId);
  requestHeaders.set("x-tenant-id", session?.tenantId ?? "unknown");
  requestHeaders.set("x-actor-id", session?.actorId ?? "anonymous");
  requestHeaders.set("x-authenticated", session ? "1" : "0");

  return requestHeaders;
}

export async function proxy(request: NextRequest) {
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const session = await validateActiveSession(sessionToken);
  const requestHeaders = applyBaselineContextHeaders(request.headers, session);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  if (sessionToken && !session) {
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: "",
      httpOnly: true,
      secure: shouldUseSecureCookies(),
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
