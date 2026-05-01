/**
 * Default contact window policy loader — Story 3-1 PR 2 review patch F3.
 *
 * Reads the default SMS contact window from `policy_registry` / `policy_versions`
 * per AC 7 + architecture §24 + dev-standards §29 (DB-as-source-of-truth for
 * admin-editable config).
 *
 * Admin edits via the scheduler admin UI (Story 2-7a) write new rows into
 * `policy_versions`; the most-recent version with `effective_from <= now()`
 * is authoritative. If the row is absent or malformed, we fall back to the
 * hardcoded constant with a warn log.
 *
 * Test mode uses an in-memory override so tests can exercise both the
 * "policy configured" and "policy missing" paths without Supabase.
 */
import {
  getSupabaseAdminClient,
  isSupabaseConfigured,
  shouldUseInMemoryPersistenceForTests,
} from '@/modules/persistence';
import type { CandidateContactWindows } from '../contracts/contact-window';
import { isCandidateContactWindows } from '../contracts/contact-window';
import { HARDCODED_DEFAULT_CONTACT_WINDOW } from '../application/sms-dispatch';

const POLICY_FAMILY = 'outreach_defaults';
const POLICY_KEY = 'sms_default_contact_window';

// ── In-memory override (test mode only) ────────────────────────────────────
// `undefined` = "no override set, use HARDCODED_DEFAULT_CONTACT_WINDOW"
// `null`      = "explicitly simulate missing policy row" (also returns HARDCODED)
// `value`     = "seeded policy value; returned as-is"
let testOverride: CandidateContactWindows | null | undefined = undefined;

export function seedDefaultContactWindowForTest(
  value: CandidateContactWindows | null,
): void {
  testOverride = value;
}

export function clearDefaultContactWindowStoreForTest(): void {
  testOverride = undefined;
}

export async function loadDefaultContactWindow(): Promise<CandidateContactWindows> {
  if (shouldUseInMemoryPersistenceForTests()) {
    if (testOverride === undefined || testOverride === null) {
      return HARDCODED_DEFAULT_CONTACT_WINDOW;
    }
    return testOverride;
  }
  if (!isSupabaseConfigured()) {
    return HARDCODED_DEFAULT_CONTACT_WINDOW;
  }

  try {
    const db = getSupabaseAdminClient();
    const { data: policyRow, error: policyErr } = await db
      .from('policy_registry')
      .select('id')
      .eq('family', POLICY_FAMILY)
      .eq('key', POLICY_KEY)
      .maybeSingle();
    if (policyErr) throw new Error(policyErr.message);
    if (!policyRow) {
      console.warn(
        '[loadDefaultContactWindow] policy_registry row missing — using hardcoded fallback',
      );
      return HARDCODED_DEFAULT_CONTACT_WINDOW;
    }

    const { data: versionRow, error: versionErr } = await db
      .from('policy_versions')
      .select('value')
      .eq('policy_id', policyRow.id)
      .lte('effective_from', new Date().toISOString())
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (versionErr) throw new Error(versionErr.message);
    if (!versionRow?.value) {
      console.warn(
        '[loadDefaultContactWindow] no active policy_versions row — using hardcoded fallback',
      );
      return HARDCODED_DEFAULT_CONTACT_WINDOW;
    }

    if (!isCandidateContactWindows(versionRow.value)) {
      console.warn(
        '[loadDefaultContactWindow] policy_versions.value malformed — using hardcoded fallback',
      );
      return HARDCODED_DEFAULT_CONTACT_WINDOW;
    }

    return versionRow.value;
  } catch (err) {
    console.warn(
      '[loadDefaultContactWindow] DB error — using hardcoded fallback:',
      err instanceof Error ? err.message : err,
    );
    return HARDCODED_DEFAULT_CONTACT_WINDOW;
  }
}
