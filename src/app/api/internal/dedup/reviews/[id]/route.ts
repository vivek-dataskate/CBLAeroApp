import { NextResponse } from "next/server";
import { withAuth } from "@/modules/auth/with-auth";
import { getReviewById, loadCandidateForDedup } from "@/features/candidate-management/infrastructure/dedup-repository";

export const GET = withAuth<{ id: string }>(async ({ session, params }) => {
  const reviewId = parseInt(params.id, 10);
  if (isNaN(reviewId)) {
    return NextResponse.json({ error: { code: "INVALID_ID", message: "Review ID must be a number" } }, { status: 400 });
  }

  const review = await getReviewById(reviewId, session.tenantId);
  if (!review) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Review not found" } }, { status: 404 });
  }

  const [candidateA, candidateB] = await Promise.all([
    loadCandidateForDedup(session.tenantId, review.candidateAId),
    loadCandidateForDedup(session.tenantId, review.candidateBId),
  ]);

  return NextResponse.json({ data: { review, candidateA, candidateB } });
}, { action: "candidate:read" });
