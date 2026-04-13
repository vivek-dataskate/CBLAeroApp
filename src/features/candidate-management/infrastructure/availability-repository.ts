import { getSupabaseAdminClient } from '@/modules/persistence';
import type { AvailabilitySignal, AvailabilitySource } from '../contracts/availability';
import type { AvailabilityStatus } from '../contracts/candidate';

type SignalRow = {
  id: number;
  tenant_id: string;
  candidate_id: string;
  previous_state: string;
  new_state: string;
  source: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

function toSignal(row: SignalRow): AvailabilitySignal {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    candidateId: row.candidate_id,
    previousState: row.previous_state as AvailabilityStatus,
    newState: row.new_state as AvailabilityStatus,
    source: row.source as AvailabilitySource,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

export async function updateAvailabilityStatus(
  tenantId: string,
  candidateId: string,
  newState: AvailabilityStatus,
  source: AvailabilitySource,
  metadata?: Record<string, unknown>,
): Promise<{ signalId: number; previousState: AvailabilityStatus; newState: AvailabilityStatus; source: AvailabilitySource }> {
  const db = getSupabaseAdminClient();
  const { data, error } = await db.rpc('update_availability_status', {
    p_tenant_id: tenantId,
    p_candidate_id: candidateId,
    p_new_state: newState,
    p_source: source,
    p_metadata: metadata ?? {},
  });

  if (error) throw new Error(`update_availability_status failed: ${error.message}`);

  // TODO Story 2.7: emit candidate.availability.updated to outbox
  const result = data as { signal_id: number; previous_state: string; new_state: string; source: string };
  return {
    signalId: result.signal_id,
    previousState: result.previous_state as AvailabilityStatus,
    newState: result.new_state as AvailabilityStatus,
    source: result.source as AvailabilitySource,
  };
}

export async function getSignalHistory(
  tenantId: string,
  candidateId: string,
  limit: number = 20,
): Promise<AvailabilitySignal[]> {
  const db = getSupabaseAdminClient();
  const { data, error } = await db
    .schema('cblaero_app')
    .from('candidate_availability_signals')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('candidate_id', candidateId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getSignalHistory failed: ${error.message}`);
  return (data as SignalRow[]).map(toSignal);
}

export async function getLatestSignal(
  tenantId: string,
  candidateId: string,
): Promise<AvailabilitySignal | null> {
  const signals = await getSignalHistory(tenantId, candidateId, 1);
  return signals[0] ?? null;
}

export async function getRecentSelfReport(
  tenantId: string,
  candidateId: string,
  freshnessDate: string,
): Promise<{ newState: string } | null> {
  const db = getSupabaseAdminClient();
  const { data, error } = await db
    .schema('cblaero_app')
    .from('candidate_availability_signals')
    .select('new_state')
    .eq('tenant_id', tenantId)
    .eq('candidate_id', candidateId)
    .eq('source', 'self_report')
    .gte('created_at', freshnessDate)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw new Error(`getRecentSelfReport failed: ${error.message}`);
  return data && data.length > 0 ? { newState: data[0].new_state } : null;
}

export async function countEngagementSignals(
  tenantId: string,
  candidateId: string,
  sinceDate: string,
): Promise<number> {
  const db = getSupabaseAdminClient();
  const { count, error } = await db
    .schema('cblaero_app')
    .from('candidate_availability_signals')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('candidate_id', candidateId)
    .eq('source', 'engagement')
    .gte('created_at', sinceDate);

  if (error) throw new Error(`countEngagementSignals failed: ${error.message}`);
  return count ?? 0;
}

export async function batchUpdateAvailability(
  tenantId: string,
  candidateIds: string[],
  newState: AvailabilityStatus,
  source: AvailabilitySource,
): Promise<{ succeeded: number; failed: number; results: Array<{ candidateId: string; error?: string }> }> {
  const results = await Promise.allSettled(
    candidateIds.map((id) => updateAvailabilityStatus(tenantId, id, newState, source)),
  );

  let succeeded = 0;
  let failed = 0;
  const details: Array<{ candidateId: string; error?: string }> = [];

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      succeeded++;
      details.push({ candidateId: candidateIds[i] });
    } else {
      failed++;
      details.push({ candidateId: candidateIds[i], error: result.reason?.message ?? String(result.reason) });
    }
  });

  return { succeeded, failed, results: details };
}
