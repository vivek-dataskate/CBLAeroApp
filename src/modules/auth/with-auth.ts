import { NextRequest, NextResponse } from "next/server";

import type { AuthSession } from "./session";
import type { ProtectedAction } from "./authorization";
import { authorizeAccess } from "./authorization";
import { validateActiveSession } from "./session";
import { extractSessionToken, toErrorCode } from "./api-helpers";

/**
 * Options controlling how withAuth enforces authentication and authorization.
 *
 * Note: Step-up (fresh auth) enforcement is route-specific business logic and is
 * handled inside the handler, not by withAuth. See governance/route.ts and
 * candidates/route.ts for step-up patterns.
 */
export type AuthOptions = {
  /** The RBAC action to authorize (e.g. 'candidate:read'). */
  action: ProtectedAction;
};

/**
 * The authenticated context injected into the handler after auth succeeds.
 */
export type AuthenticatedContext<T = Record<string, string>> = {
  session: AuthSession;
  request: NextRequest;
  params: T;
  traceId: string;
};

/**
 * A route handler that receives an authenticated context.
 * The handler only runs after session validation and RBAC pass.
 */
export type AuthenticatedHandler<T = Record<string, string>> = (
  ctx: AuthenticatedContext<T>,
) => Promise<NextResponse>;

/**
 * Wraps a Next.js route handler with session validation, RBAC authorization, and audit logging.
 *
 * Replaces the inline pattern:
 *   extractSessionToken → validateActiveSession → authorizeAccess → error check → null guard
 *
 * Usage:
 *   export const GET = withAuth(async ({ session, request, traceId }) => {
 *     // Business logic only — auth already enforced
 *     return NextResponse.json({ data: ... });
 *   }, { action: 'candidate:read' });
 */
export function withAuth<T = Record<string, string>>(
  handler: AuthenticatedHandler<T>,
  options: AuthOptions,
): (request: NextRequest, context?: { params?: Promise<T> }) => Promise<NextResponse> {
  return async (request: NextRequest, context?: { params?: Promise<T> }) => {
    const traceId = request.headers.get("x-trace-id") ?? crypto.randomUUID();
    const requestedTenantId =
      request.headers.get("x-active-client-id")?.trim() ||
      request.nextUrl.searchParams.get("tenantId") ||
      null;

    const session = await validateActiveSession(extractSessionToken(request));

    const authz = await authorizeAccess({
      session,
      action: options.action,
      requestedTenantId,
      path: request.nextUrl.pathname,
      method: request.method,
      traceId,
    });

    if (!authz.allowed) {
      console.warn("[withAuth] Access denied", {
        traceId,
        action: options.action,
        reason: authz.reason,
        status: authz.status,
        path: request.nextUrl.pathname,
        hasSession: !!session,
        sessionTenantId: session?.tenantId ?? null,
      });
      return NextResponse.json(
        {
          error: {
            code: toErrorCode(authz.reason),
            message: `Access denied for ${options.action} operation.`,
          },
        },
        { status: authz.status },
      );
    }

    // authorizeAccess returns allowed:true only when session is non-null
    // (see authorization.ts — null session → deny "unauthenticated").
    const authenticatedSession = session!;

    const params = context?.params ? await context.params : ({} as T);

    return handler({ session: authenticatedSession, request, params, traceId });
  };
}
