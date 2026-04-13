import { NextResponse } from 'next/server';
import { withAuth } from '@/modules/auth/with-auth';
import { resolveRequestTenantId } from '@/app/api/internal/recruiter/csv-upload/shared';
import { computeAvailabilityState } from '@/features/candidate-management/application/availability-scoring';
import { updateAvailabilityStatus } from '@/features/candidate-management/infrastructure/availability-repository';
import { getCandidateById } from '@/features/candidate-management/infrastructure/candidate-repository';
import { recordSyncFailure } from '@/features/candidate-management/infrastructure/sync-error-repository';

const MAX_BULK_CANDIDATES = 50;

export const POST = withAuth(
  async ({ session, request }) => {
    const tenantId = resolveRequestTenantId(session, request);

    let body: { candidateIds?: string[] };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } },
        { status: 400 },
      );
    }

    const candidateIds = body.candidateIds;
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      return NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'candidateIds must be a non-empty array' } },
        { status: 400 },
      );
    }

    if (candidateIds.length > MAX_BULK_CANDIDATES) {
      return NextResponse.json(
        { error: { code: 'TOO_MANY', message: `Maximum ${MAX_BULK_CANDIDATES} candidates per request` } },
        { status: 400 },
      );
    }

    let refreshed = 0;
    let stateChanged = 0;
    let errors = 0;

    const results = await Promise.allSettled(
      candidateIds.map(async (candidateId) => {
        // Verify candidate belongs to tenant before processing
        const candidate = await getCandidateById(tenantId, candidateId);
        if (!candidate) throw new Error(`Candidate ${candidateId} not found in tenant`);

        const newState = await computeAvailabilityState(tenantId, candidateId);
        const result = await updateAvailabilityStatus(tenantId, candidateId, newState, 'manual_refresh');
        return { candidateId, previousState: result.previousState, newState: result.newState };
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        refreshed++;
        if (result.value.previousState !== result.value.newState) {
          stateChanged++;
        }
      } else {
        errors++;
        recordSyncFailure('availability_refresh_bulk', 'batch', result.reason);
      }
    }

    console.log(JSON.stringify({
      event: '[AvailabilityRefresh] Bulk refresh complete',
      tenantId,
      total: candidateIds.length,
      refreshed,
      stateChanged,
      errors,
    }));

    return NextResponse.json({
      data: { refreshed, stateChanged, errors },
    });
  },
  { action: 'candidate:write' },
);
