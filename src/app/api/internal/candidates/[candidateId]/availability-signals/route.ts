import { NextResponse } from 'next/server';
import { withAuth } from '@/modules/auth/with-auth';
import { resolveRequestTenantId } from '@/app/api/internal/recruiter/csv-upload/shared';
import { getSignalHistory } from '@/features/candidate-management/infrastructure/availability-repository';

export const GET = withAuth<{ candidateId: string }>(
  async ({ session, request, params }) => {
    const tenantId = resolveRequestTenantId(session, request);
    const candidateId = params.candidateId;

    try {
      const signals = await getSignalHistory(tenantId, candidateId, 5);
      return NextResponse.json({ data: signals });
    } catch (err) {
      console.error(JSON.stringify({
        event: '[AvailabilitySignals] Fetch failed',
        candidateId,
        error: err instanceof Error ? err.message : String(err),
      }));
      return NextResponse.json(
        { error: { code: 'FETCH_FAILED', message: 'Failed to load availability signals' } },
        { status: 500 },
      );
    }
  },
  { action: 'candidate:read' },
);
