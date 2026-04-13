import { NextResponse } from "next/server";
import { withAuth } from "@/modules/auth/with-auth";
import {
  getReviewById,
  resolveReview,
  loadCandidateForDedup,
  callMergeCandidatesRpc,
  recordDedupDecision,
  updateCandidateIngestionState,
} from "@/features/candidate-management/infrastructure/dedup-repository";
import { selectWinner, computeMergedFields } from "@/features/candidate-management/application/dedup-merge";

export const POST = withAuth<{ id: string }>(async ({ session, request, params }) => {
  const reviewId = parseInt(params.id, 10);
  if (isNaN(reviewId)) {
    return NextResponse.json({ error: { code: "INVALID_ID", message: "Review ID must be a number" } }, { status: 400 });
  }

  const body = await request.json();
  const decision = body.decision;
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: { code: "INVALID_DECISION", message: "Decision must be 'approved' or 'rejected'" } }, { status: 400 });
  }

  const review = await getReviewById(reviewId, session.tenantId);
  if (!review) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Review not found" } }, { status: 404 });
  }
  if (review.status !== "pending") {
    return NextResponse.json({ error: { code: "ALREADY_RESOLVED", message: `Review already ${review.status}` } }, { status: 409 });
  }

  await resolveReview(reviewId, session.tenantId, decision, session.actorId);

  if (decision === "approved") {
    const [candidateA, candidateB] = await Promise.all([
      loadCandidateForDedup(session.tenantId, review.candidateAId),
      loadCandidateForDedup(session.tenantId, review.candidateBId),
    ]);

    if (candidateA && candidateB) {
      const { winner, loser } = selectWinner(candidateA, candidateB);
      const mergedFields = computeMergedFields(winner, loser);
      try {
        await callMergeCandidatesRpc(winner.id, loser.id, mergedFields, {
          decision_type: "manual_merge",
          confidence_score: review.confidenceScore,
          rationale: `Manual merge approved by ${session.actorId}`,
          actor: session.actorId,
        });
      } catch (mergeErr) {
        // H3 fix: revert review status to pending if merge RPC fails
        await resolveReview(reviewId, session.tenantId, "pending" as "approved", session.actorId);
        console.error(`[DedupResolve] Merge RPC failed, reverted review ${reviewId} to pending:`, mergeErr instanceof Error ? mergeErr.message : mergeErr);
        return NextResponse.json({ error: { code: "MERGE_FAILED", message: "Merge failed — review reverted to pending" } }, { status: 500 });
      }
    }
  } else {
    // C2 fix: Record rejection AND transition both candidates to active
    await recordDedupDecision({
      tenantId: session.tenantId,
      candidateAId: review.candidateAId,
      candidateBId: review.candidateBId,
      decisionType: "manual_reject",
      confidenceScore: review.confidenceScore,
      rationale: `Manual merge rejected by ${session.actorId}`,
      actor: session.actorId,
    });
    // Transition pending_review candidate(s) back to active
    await updateCandidateIngestionState(review.candidateAId, "active");
    await updateCandidateIngestionState(review.candidateBId, "active");
  }

  // Return the merged/winner candidate so UI can display the result
  let mergedCandidate = null;
  if (decision === "approved") {
    mergedCandidate = await loadCandidateForDedup(session.tenantId, review.candidateAId)
      ?? await loadCandidateForDedup(session.tenantId, review.candidateBId);
  }

  return NextResponse.json({ data: { reviewId, decision, resolvedBy: session.actorId, mergedCandidate } });
}, { action: "candidate:write" });
