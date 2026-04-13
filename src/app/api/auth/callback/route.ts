import { NextRequest, NextResponse } from "next/server";

import {
  AUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  exchangeAuthorizationCode,
  issueSessionToken,
  shouldUseSecureCookies,
  toSsoError,
  verifyAndMapIdentityClaims,
  verifyAuthStateToken,
} from "@/modules/auth";
import { registerOrSyncUserFromSession } from "@/modules/admin";

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

function clearAuthStateCookie(response: NextResponse): void {
  response.cookies.set({
    name: AUTH_STATE_COOKIE_NAME,
    value: "",
    path: "/",
    maxAge: 0,
  });
}

export async function GET(request: NextRequest) {
  const traceId = request.headers.get("x-trace-id") ?? crypto.randomUUID();
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");

  if (!state || !code) {
    console.warn("[auth/callback] missing code or state", {
      traceId,
      hasState: !!state,
      hasCode: !!code,
    });

    return NextResponse.json(
      {
        error: {
          code: "invalid_callback",
          message: "Missing code or state.",
          traceId,
        },
      },
      { status: 400 },
    );
  }

  const authStateCookie = request.cookies.get(AUTH_STATE_COOKIE_NAME)?.value;
  if (!authStateCookie) {
    console.warn("[auth/callback] missing auth state cookie", { traceId });

    return NextResponse.json(
      {
        error: {
          code: "missing_state",
          message: "SSO state cookie not found.",
          traceId,
        },
      },
      { status: 400 },
    );
  }

  const authState = await verifyAuthStateToken(authStateCookie);
  if (!authState || authState.state !== state) {
    console.warn("[auth/callback] state mismatch", {
      traceId,
      hasAuthState: !!authState,
      providedState: state,
      expectedState: authState?.state ?? null,
    });

    return NextResponse.json(
      {
        error: {
          code: "state_mismatch",
          message: "Invalid SSO state.",
          traceId,
        },
      },
      { status: 401 },
    );
  }

  try {
    const exchanged = await exchangeAuthorizationCode(code);
    const identity = await verifyAndMapIdentityClaims(exchanged.id_token, authState.nonce);

    const issued = await issueSessionToken({
      actorId: identity.actorId,
      email: identity.email,
      tenantId: identity.tenantId,
      role: identity.role,
      rememberDevice: authState.rememberDevice,
    });
    try {
      await registerOrSyncUserFromSession(issued.session);
    } catch (syncError: unknown) {
      const message =
        syncError instanceof Error ? syncError.message : "Unknown governance sync failure.";

      // Keep SSO availability independent from governance persistence health.
      console.error("[auth/callback] governance sync failed; continuing login", {
        traceId,
        actorId: issued.session.actorId,
        tenantId: issued.session.tenantId,
        message,
      });
    }

    const destination = new URL(authState.returnToPath, `${getPublicOrigin(request)}/`);
    const response = NextResponse.redirect(destination);

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: issued.token,
      httpOnly: true,
      secure: shouldUseSecureCookies(),
      sameSite: "lax",
      path: "/",
      maxAge: issued.ttlSeconds,
    });
    clearAuthStateCookie(response);

    console.info("[auth/callback] sso login succeeded", {
      traceId,
      actorId: identity.actorId,
      tenantId: identity.tenantId,
      emailDomain: identity.email.split("@")[1] ?? null,
    });

    return response;
  } catch (error: unknown) {
    const ssoError = toSsoError(error);

    console.error("[auth/callback] sso login failed", {
      traceId,
      reason: ssoError.code,
      message: ssoError.message,
      details: ssoError.details,
      origin: getPublicOrigin(request),
      path: request.nextUrl.pathname,
    });

    return NextResponse.json(
      {
        error: {
          code: "auth_failed",
          reason: ssoError.code,
          message: "Unable to complete SSO login.",
          traceId,
        },
      },
      { status: 401 },
    );
  }
}
