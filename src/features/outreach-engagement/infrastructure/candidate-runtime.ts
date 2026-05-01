/**
 * Runtime candidate snapshot used by the SMS dispatch job.
 *
 * Lives in its own module so tests can seed fake snapshots without mocking
 * Supabase. In test mode `loadCandidateRuntimeSnapshot` reads from an
 * in-memory map populated via `seedCandidateRuntimeForTest`.
 */
import {
  getSupabaseAdminClient,
  isSupabaseConfigured,
  shouldUseInMemoryPersistenceForTests,
} from '@/modules/persistence';
import type { CandidateContactWindows } from '../contracts/contact-window';
import { isCandidateContactWindows } from '../contracts/contact-window';

export interface CandidateRuntimeSnapshot {
  phone: string | null;
  smsOptedIn: boolean;
  contactWindows: CandidateContactWindows | null;
}

// ── In-memory store (test mode only) ────────────────────────────────────────
const store = new Map<string, CandidateRuntimeSnapshot>();

function key(tenantId: string, candidateId: string): string {
  return `${tenantId}::${candidateId}`;
}

export function seedCandidateRuntimeForTest(
  tenantId: string,
  candidateId: string,
  snapshot: Partial<CandidateRuntimeSnapshot>,
): void {
  store.set(key(tenantId, candidateId), {
    phone: snapshot.phone ?? null,
    smsOptedIn: snapshot.smsOptedIn ?? true,
    contactWindows: snapshot.contactWindows ?? null,
  });
}

export function clearCandidateRuntimeStoreForTest(): void {
  store.clear();
}

export async function loadCandidateRuntimeSnapshot(
  tenantId: string,
  candidateId: string,
): Promise<CandidateRuntimeSnapshot> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const row = store.get(key(tenantId, candidateId));
    return row ?? { phone: null, smsOptedIn: true, contactWindows: null };
  }
  if (!isSupabaseConfigured()) {
    return { phone: null, smsOptedIn: true, contactWindows: null };
  }

  const db = getSupabaseAdminClient();
  const [candResult, prefResult] = await Promise.all([
    db
      .from('candidates')
      .select('phone')
      .eq('tenant_id', tenantId)
      .eq('id', candidateId)
      .maybeSingle(),
    db
      .from('candidate_channel_preferences')
      .select('sms_opted_in, contact_windows')
      .eq('tenant_id', tenantId)
      .eq('candidate_id', candidateId)
      .maybeSingle(),
  ]);

  if (candResult.error) {
    throw new Error(
      `[candidate-runtime] candidate lookup failed for ${candidateId}: ${candResult.error.message}`,
    );
  }
  if (prefResult.error) {
    throw new Error(
      `[candidate-runtime] channel prefs lookup failed for ${candidateId}: ${prefResult.error.message}`,
    );
  }

  const phone = (candResult.data?.phone as string | null) ?? null;
  const smsOptedIn = prefResult.data?.sms_opted_in !== false;
  const rawWindows = prefResult.data?.contact_windows as unknown;
  const contactWindows = isCandidateContactWindows(rawWindows) ? rawWindows : null;

  return { phone, smsOptedIn, contactWindows };
}
