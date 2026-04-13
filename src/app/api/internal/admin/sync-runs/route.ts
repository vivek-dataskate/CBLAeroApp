import { NextResponse } from 'next/server';
import { withAuth } from '@/modules/auth';
import { listSyncRunsCurrentMonth } from '@/modules/ingestion';

export const GET = withAuth(async () => {
  try {
    const data = await listSyncRunsCurrentMonth();
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[admin/sync-runs] Failed to list sync runs:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: 'database_error', message: 'Failed to load sync runs.' } },
      { status: 500 },
    );
  }
}, { action: 'admin:view-sync-runs' });
