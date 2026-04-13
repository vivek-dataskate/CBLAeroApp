import { NextResponse } from "next/server";

import {
  withAuth,
} from "@/modules/auth";
import {
  getCandidateById,
  CandidateNotFoundError,
} from "@/features/candidate-management/infrastructure/candidate-repository";

export const GET = withAuth<{ candidateId: string }>(async ({ session, params }) => {
  try {
    const candidate = await getCandidateById(params.candidateId, session.tenantId);
    return NextResponse.json({
      data: candidate,
      meta: {
        tenantId: session.tenantId,
        readScope: "tenant-isolated",
      },
    });
  } catch (err) {
    if (err instanceof CandidateNotFoundError) {
      return NextResponse.json(
        {
          error: {
            code: "not_found",
            message: "Candidate not found.",
          },
        },
        { status: 404 },
      );
    }
    throw err;
  }
}, { action: "candidate:read" });
