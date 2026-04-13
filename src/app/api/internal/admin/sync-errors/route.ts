import { NextResponse } from 'next/server';
import { withAuth } from '@/modules/auth';
import { listSyncErrorsByRun } from '@/modules/ingestion';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withAuth(async ({ request }) => {
  const runId = request.nextUrl.searchParams.get('runId');
  if (!runId || !UUID_RE.test(runId)) {
    return NextResponse.json(
      { error: { code: 'invalid_param', message: 'Valid runId (UUID) query parameter is required.' } },
      { status: 400 },
    );
  }

  try {
    const data = await listSyncErrorsByRun(runId);
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[admin/sync-errors] Failed to list sync errors:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: 'database_error', message: 'Failed to load sync errors.' } },
      { status: 500 },
    );
  }
}, { action: 'admin:view-sync-errors' });
