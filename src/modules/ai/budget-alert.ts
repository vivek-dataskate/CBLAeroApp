import { getAggregatedUsage } from './usage-repository';

const DEFAULT_BUDGET_THRESHOLD_USD = 10;

// Lightweight proactive check — call counter tracks calls since last check
let callsSinceLastCheck = 0;
let lastCheckResult: { dailyCostUsd: number; threshold: number; exceeded: boolean } | null = null;
const PROACTIVE_CHECK_INTERVAL = 50; // check every 50 LLM calls

/**
 * Check if today's estimated AI spend exceeds the configured threshold.
 * Emits a structured log warning if threshold is exceeded.
 * Returns { dailyCostUsd, threshold, exceeded }.
 *
 * Uses `getAggregatedUsage({ days: 1 })` which returns the last 24h of data.
 * The `totals` field sums all rows — this is the authoritative daily cost.
 */
export async function checkBudgetThreshold(
  thresholdUsd?: number
): Promise<{ dailyCostUsd: number; threshold: number; exceeded: boolean }> {
  const threshold = thresholdUsd ?? DEFAULT_BUDGET_THRESHOLD_USD;

  const { totals } = await getAggregatedUsage({ days: 1 });
  const dailyCostUsd = Math.round(totals.estimatedCostUsd * 1_000_000) / 1_000_000;

  const exceeded = dailyCostUsd >= threshold;
  if (exceeded) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        module: 'ai',
        action: 'budget_alert',
        dailyCostUsd,
        threshold,
      })
    );
  }

  lastCheckResult = { dailyCostUsd, threshold, exceeded };
  callsSinceLastCheck = 0;

  return { dailyCostUsd, threshold, exceeded };
}

/**
 * Lightweight proactive budget check — called after each LLM usage record.
 * Only performs the actual DB check every PROACTIVE_CHECK_INTERVAL calls
 * to avoid per-call aggregation overhead.
 * Fire-and-forget — errors are logged, never thrown.
 */
export async function maybeCheckBudgetProactive(): Promise<void> {
  callsSinceLastCheck += 1;
  if (callsSinceLastCheck < PROACTIVE_CHECK_INTERVAL) return;

  try {
    await checkBudgetThreshold();
  } catch (err) {
    console.warn('[ai/budget-alert] Proactive check failed:', err instanceof Error ? err.message : err);
  }
}

/** Reset counters for test isolation. */
export function clearBudgetAlertForTest(): void {
  if (process.env.NODE_ENV !== 'test') return;
  callsSinceLastCheck = 0;
  lastCheckResult = null;
}
