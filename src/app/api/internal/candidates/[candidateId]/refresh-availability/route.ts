import { NextResponse } from 'next/server';
import { withAuth } from '@/modules/auth/with-auth';
import { resolveRequestTenantId } from '@/app/api/internal/recruiter/csv-upload/shared';
import { computeAvailabilityState } from '@/features/candidate-management/application/availability-scoring';
import { updateAvailabilityStatus } from '@/features/candidate-management/infrastructure/availability-repository';
import { getCandidateById } from '@/features/candidate-management/infrastructure/candidate-repository';
import { recordSyncFailure } from '@/features/candidate-management/infrastructure/sync-error-repository';

export const POST = withAuth<{ candidateId: string }>(
  async ({ session, request, params }) => {
    const tenantId = resolveRequestTenantId(session, request);
    const candidateId = params.candidateId;

    try {
      // Verify candidate exists and belongs to tenant
      const candidate = await getCandidateById(tenantId, candidateId);
      if (!candidate) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Candidate not found' } },
          { status: 404 },
        );
      }

      const previousState = candidate.availabilityStatus;
      const newState = await computeAvailabilityState(tenantId, candidateId);

      // Always update — even if state unchanged, refresh the signal timestamp
      const result = await updateAvailabilityStatus(
        tenantId,
        candidateId,
        newState,
        'manual_refresh',
      );

      console.log(JSON.stringify({
        event: '[AvailabilityRefresh] Single refresh complete',
        tenantId,
        candidateId,
        previousState,
        newState,
        stateChanged: previousState !== newState,
      }));

      return NextResponse.json({
        data: {
          previousState: result.previousState,
          newState: result.newState,
          isStale: false,
          signalId: result.signalId,
        },
      });
    } catch (err) {
      console.error(JSON.stringify({
        event: '[AvailabilityRefresh] Single refresh failed',
        tenantId,
        candidateId,
        error: err instanceof Error ? err.message : String(err),
      }));
      recordSyncFailure('availability_refresh', candidateId, err);
      return NextResponse.json(
        { error: { code: 'REFRESH_FAILED', message: 'Availability refresh failed' } },
        { status: 500 },
      );
    }
  },
  { action: 'candidate:write' },
);
