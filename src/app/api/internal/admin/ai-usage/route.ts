import { NextResponse } from 'next/server';

import { withAuth } from '@/modules/auth';
import { getAggregatedUsage } from '@/modules/ai/usage-repository';
import { checkBudgetThreshold } from '@/modules/ai/budget-alert';

export const GET = withAuth(async ({ request }) => {
  const daysParam = request.nextUrl.searchParams.get('days');
  const modelParam = request.nextUrl.searchParams.get('model') || undefined;
  const promptNameParam = request.nextUrl.searchParams.get('promptName') || undefined;
  const days = daysParam ? Math.max(1, Math.min(90, Number.parseInt(daysParam, 10) || 7)) : 7;

  try {
    const [usage, budget] = await Promise.all([
      getAggregatedUsage({ days, model: modelParam, promptName: promptNameParam }),
      checkBudgetThreshold(),
    ]);

    return NextResponse.json({
      data: {
        daily: usage.daily,
        totals: usage.totals,
        budget: {
          dailyCostUsd: budget.dailyCostUsd,
          threshold: budget.threshold,
          exceeded: budget.exceeded,
        },
      },
    });
  } catch (err) {
    console.error('[admin/ai-usage] Failed to aggregate usage:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: 'database_error', message: 'Failed to load AI usage data.' } },
      { status: 500 },
    );
  }
}, { action: 'admin:read-ai-usage' });
