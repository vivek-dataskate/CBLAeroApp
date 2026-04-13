import { NextResponse } from "next/server";
import { withAuth } from "@/modules/auth/with-auth";
import { listPendingReviews } from "@/features/candidate-management/infrastructure/dedup-repository";

export const GET = withAuth(async ({ session }) => {
  const limit = 50;
  const offset = 0;
  const items = await listPendingReviews(session.tenantId, limit, offset);
  return NextResponse.json({ data: items, meta: { count: items.length, limit, offset } });
}, { action: "candidate:read" });
