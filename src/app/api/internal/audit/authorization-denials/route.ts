import { NextResponse } from "next/server";

import { withAuth } from "@/modules/auth";
import { listAuthorizationDenyEvents } from "@/modules/audit";

export const GET = withAuth(async ({ session, request }) => {
  const requestedTenantId = request.nextUrl.searchParams.get("tenantId");

  const events = (await listAuthorizationDenyEvents()).filter((event) => {
    if (!requestedTenantId) {
      return event.sessionTenantId === session.tenantId;
    }

    return event.sessionTenantId === requestedTenantId;
  });

  return NextResponse.json({
    data: events,
    meta: {
      count: events.length,
      tenantId: session.tenantId,
    },
  });
}, { action: "audit:read-denials" });
