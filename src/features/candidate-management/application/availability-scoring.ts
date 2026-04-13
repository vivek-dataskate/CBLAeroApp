import type { AvailabilityStatus } from '../contracts/candidate';
import { getRecentSelfReport, countEngagementSignals } from '../infrastructure/availability-repository';

const STALE_THRESHOLD_DAYS = 7;
const ENGAGEMENT_WINDOW_DAYS = 90;
const SELF_REPORT_FRESHNESS_DAYS = 7;

/**
 * Determine if an availability signal is stale (>7 days old or null).
 * Used by both API routes and UI components.
 */
export function isStaleSignal(availabilityLastSignalAt: string | null): boolean {
  if (!availabilityLastSignalAt) return true;
  const signalDate = new Date(availabilityLastSignalAt);
  const now = new Date();
  const diffMs = now.getTime() - signalDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays > STALE_THRESHOLD_DAYS;
}

/**
 * Recalculate availability state from engagement signals in prior 90 days.
 *
 * Algorithm:
 * 1. Check self-reported status — if fresh (<7 days), use that state
 * 2. If no fresh self-report, count engagement events in prior 90 days:
 *    - >=3 engagement signals → active
 *    - 1-2 engagement signals → passive
 *    - 0 engagement signals → unavailable
 *
 * For MVP, engagement signals come from candidate_availability_signals rows
 * with source='engagement'. Ingestion paths will insert these in future stories.
 */
export async function computeAvailabilityState(
  tenantId: string,
  candidateId: string,
): Promise<AvailabilityStatus> {
  // Check for fresh self-report via repository
  const selfReportCutoff = new Date();
  selfReportCutoff.setDate(selfReportCutoff.getDate() - SELF_REPORT_FRESHNESS_DAYS);

  const selfReport = await getRecentSelfReport(tenantId, candidateId, selfReportCutoff.toISOString());
  if (selfReport) {
    return selfReport.newState as AvailabilityStatus;
  }

  // Count engagement events in prior 90 days via repository
  const engagementCutoff = new Date();
  engagementCutoff.setDate(engagementCutoff.getDate() - ENGAGEMENT_WINDOW_DAYS);

  const engagementCount = await countEngagementSignals(tenantId, candidateId, engagementCutoff.toISOString());

  if (engagementCount >= 3) return 'active';
  if (engagementCount >= 1) return 'passive';
  return 'unavailable';
}
