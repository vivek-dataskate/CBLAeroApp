import { NextRequest, NextResponse } from "next/server";

import {
  AUTH_STATE_COOKIE_MAX_AGE_SECONDS,
  AUTH_STATE_COOKIE_NAME,
  createSsoAuthorizationRequest,
  isRememberDeviceRequested,
  shouldUseSecureCookies,
} from "@/modules/auth";

export async function GET(request: NextRequest) {
  try {
    const rememberDevice = isRememberDeviceRequested(
      request.nextUrl.searchParams.get("remember"),
    );
    const returnToPath = request.nextUrl.searchParams.get("next");

    const { authorizationUrl, authStateToken } = await createSsoAuthorizationRequest({
      rememberDevice,
      returnToPath,
    });

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set({
      name: AUTH_STATE_COOKIE_NAME,
      value: authStateToken,
      httpOnly: true,
      secure: shouldUseSecureCookies(),
      sameSite: "lax",
      path: "/",
      maxAge: AUTH_STATE_COOKIE_MAX_AGE_SECONDS,
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: { code: "auth_config_error", message: "SSO is not configured." } },
      { status: 500 },
    );
  }
}
