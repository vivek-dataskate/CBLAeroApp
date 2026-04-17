import { NextResponse } from "next/server";
import { withAuth } from "@/modules/auth/with-auth";
import { getSendHistory } from "@/modules/outreach/send-repository";

/**
 * GET /api/outreach/sms/sends — list SMS send history.
 * Accessible by recruiter + admin.
 */
export const GET = withAuth(
  async ({ session, request }) => {
    const tenantId =
      request.headers.get("x-active-client-id") ?? session.tenantId;

    const params = request.nextUrl.searchParams;
    const candidateId = params.get("candidateId") ?? undefined;
    const status = params.get("status") ?? undefined;
    const limit = parseInt(params.get("limit") ?? "50", 10);
    const offset = parseInt(params.get("offset") ?? "0", 10);

    const sends = await getSendHistory({
      tenantId,
      candidateId,
      status,
      limit: Math.min(limit, 200),
      offset,
    });

    return NextResponse.json({ data: sends });
  },
  { action: "outreach:read" },
);
