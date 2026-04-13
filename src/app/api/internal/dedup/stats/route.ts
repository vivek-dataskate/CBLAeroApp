import { NextResponse } from "next/server";
import { withAuth } from "@/modules/auth/with-auth";
import { getDedupStats } from "@/features/candidate-management/infrastructure/dedup-repository";

export const GET = withAuth(async ({ session }) => {
  const stats = await getDedupStats(session.tenantId);
  return NextResponse.json({ data: stats });
}, { action: "candidate:read" });
