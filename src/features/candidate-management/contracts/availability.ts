import type { AvailabilityStatus } from './candidate';

export type AvailabilitySource = 'self_report' | 'engagement' | 'manual_refresh' | 'system';

export type AvailabilitySignal = {
  id: number;
  tenantId: string;
  candidateId: string;
  previousState: AvailabilityStatus;
  newState: AvailabilityStatus;
  source: AvailabilitySource;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type RefreshResult = {
  previousState: AvailabilityStatus;
  newState: AvailabilityStatus;
  isStale: boolean;
  signalId: number;
};

export type BulkRefreshResult = {
  refreshed: number;
  stateChanged: number;
  errors: number;
};

export type StaleSignalInfo = {
  isStale: boolean;
  lastSignalAt: string | null;
  daysSinceLastSignal: number | null;
};
