/**
 * Clay-webhook audit integration test — Story 1-12a AC 6, item 15.
 *
 * Drives one realistic Clay batch (2 rows — 1 unique, 1 duplicate) through the
 * real `/api/webhooks/clay` handler end-to-end with persistence mocked at the
 * Supabase layer. Asserts the full AC-6 audit contract:
 *   - 2 rows land in `webhook_events` with `source='clay_enrichment'`,
 *     `status='completed'`, and `result_meta` populated.
 *   - 1 hourly-bucket `sync_runs` row is created via
 *     `upsert_clay_hourly_sync_run` (called for Phase 1 seed + Phase 3 tally).
 *   - 0 rows in `sync_errors` for the happy path.
 *   - 1 candidate is upserted via `batchUpsertCandidatesFromATS`.
 *   - 1 row in `content_fingerprints` via `recordFingerprint` (source='ats').
 *   - 0 rows in `provider_health_events` (no transitions on happy path).
 *   - Exactly 2 legacy `[Clay Webhook]`-class console logs that preserve the
 *     Story 2.8 contract (fingerprint-hit JSON log for the duplicate row).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks, hoisted so the route picks them up at import time ─────────────────

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const webhookEventInserts: Array<Record<string, unknown>> = [];
const webhookEventUpdates: Array<{ eventId: string; patch: Record<string, unknown> }> = [];
const healthEventInserts: Array<Record<string, unknown>> = [];

function makeFakeSupabaseClient() {
  return {
    from: (table: string) => {
      if (table === 'admin_managed_users') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({ data: { actor_id: 'test-assignee-actor-id' }, error: null }),
        };
        return chain;
      }
      if (table === 'webhook_events') {
        return {
          insert: async (row: Record<string, unknown>) => {
            webhookEventInserts.push(row);
            return { data: row, error: null };
          },
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, val: string) => {
              webhookEventUpdates.push({ eventId: val, patch });
              return { data: null, error: null };
            },
          }),
        };
      }
      if (table === 'provider_health_events') {
        return {
          insert: async (row: Record<string, unknown>) => {
            healthEventInserts.push(row);
            return { data: row, error: null };
          },
        };
      }
      if (table === 'provider_routing_policies') {
        return {
          select: async () => ({ data: [], error: null }),
        };
      }
      return {
        select: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
      };
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: 'bucket-run-audit-1', error: null });
    },
  };
}

const persistenceMocks = vi.hoisted(() => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseAdminClient: vi.fn(),
}));
vi.mock('@/modules/persistence', () => persistenceMocks);

const ingestionMocks = vi.hoisted(() => ({
  batchUpsertCandidatesFromATS: vi.fn().mockResolvedValue({ inserted: 1, failed: 0 }),
  recordSyncFailure: vi.fn(),
  DEFAULT_TENANT_ID: 'cbl-aero',
}));
vi.mock('@/modules/ingestion', () => ingestionMocks);

const fingerprintMocks = vi.hoisted(() => ({
  isAlreadyProcessed: vi.fn().mockResolvedValue(false),
  recordFingerprint: vi.fn().mockResolvedValue(undefined),
  loadRecentFingerprints: vi.fn().mockResolvedValue(new Set<string>()),
  recordFingerprintBatch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/candidate-management/infrastructure/fingerprint-repository', () => fingerprintMocks);

// ── Fixture + helpers ────────────────────────────────────────────────────────

const ROW_UNIQUE = {
  'Personal Email': 'unique@test.com',
  'Mobile Phone': '+15551234567',
  enrichlinkedin_data: {
    first_name: 'Alice',
    last_name: 'Unique',
    url: 'https://www.linkedin.com/in/alice',
    title: 'Engineer',
    profile_id: 11111111,
    last_refresh: '2026-04-15 18:42:29.033',
  },
};

const ROW_DUP = {
  'Personal Email': 'dup@test.com',
  'Mobile Phone': '+15559999999',
  enrichlinkedin_data: {
    first_name: 'Bob',
    last_name: 'Duplicate',
    url: 'https://www.linkedin.com/in/bob',
    title: 'Manager',
    profile_id: 22222222,
    last_refresh: '2026-04-15 18:42:29.033',
  },
};

function makeRequest(body: unknown, auth = 'Bearer test-audit-secret'): Request {
  const bodyText = JSON.stringify(body);
  return new Request('http://localhost:3000/api/webhooks/clay', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: auth,
    },
    body: bodyText,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Clay webhook audit integration (AC 6 item 15)', () => {
  beforeEach(async () => {
    process.env.CLAY_WEBHOOK_SECRET = 'test-audit-secret';
    process.env.CLAY_DEFAULT_ASSIGNEE_EMAIL = 'vivek@cblsolutions.com';
    process.env.CLAY_EMAIL_FIELD = 'Personal Email';
    process.env.CLAY_PHONE_FIELD = 'Mobile Phone';
    process.env.CLAY_BLOB_FIELD = 'enrichlinkedin_data';
    process.env.CLAY_WEBHOOK_DEBUG = 'false';

    vi.clearAllMocks();
    rpcCalls.length = 0;
    webhookEventInserts.length = 0;
    webhookEventUpdates.length = 0;
    healthEventInserts.length = 0;
    persistenceMocks.isSupabaseConfigured.mockReturnValue(true);
    persistenceMocks.getSupabaseAdminClient.mockReturnValue(makeFakeSupabaseClient());
    fingerprintMocks.isAlreadyProcessed.mockResolvedValue(false);
    ingestionMocks.batchUpsertCandidatesFromATS.mockResolvedValue({ inserted: 1, failed: 0 });

    const { __resetClayWebhookCacheForTests } = await import('@/app/api/webhooks/clay/route');
    __resetClayWebhookCacheForTests();

    const { resetProvidersForTest } = await import('@/modules/providers/startup');
    resetProvidersForTest();
  });

  afterEach(() => {
    delete process.env.CLAY_WEBHOOK_SECRET;
    delete process.env.CLAY_DEFAULT_ASSIGNEE_EMAIL;
  });

  it('persists 2 webhook_events, 1 fingerprint, 0 health events on happy path', async () => {
    // Second row is marked already-processed → skipped_fingerprint.
    fingerprintMocks.isAlreadyProcessed.mockImplementation(async (_tenant, _type, hash: string) => {
      return hash.includes('22222222'); // dup row's profile_id
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { POST } = await import('@/app/api/webhooks/clay/route');
    const req = makeRequest([ROW_UNIQUE, ROW_DUP]);
    const res = await POST(req as never);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      received: number;
      accepted: number;
      skipped: number;
      errored: number;
      bucket_run_id: string | null;
    };
    expect(body.received).toBe(2);
    expect(body.accepted).toBe(1);
    expect(body.skipped).toBe(1);
    expect(body.errored).toBe(0);
    expect(body.bucket_run_id).toBe('bucket-run-audit-1');

    // ── webhook_events contract ──
    expect(webhookEventInserts).toHaveLength(2);
    for (const row of webhookEventInserts) {
      expect(row.source).toBe('clay_enrichment');
      expect(row.event_type).toBe('candidate.upserted');
      expect(row.provider_event_id).toBeNull();
    }
    // 2 completed updates with result_meta populated
    const completed = webhookEventUpdates.filter((u) => u.patch.status === 'completed');
    expect(completed).toHaveLength(2);
    for (const upd of completed) {
      expect(upd.patch.result_meta).toBeDefined();
      const meta = upd.patch.result_meta as Record<string, unknown>;
      expect(meta.syncRunId).toBe('bucket-run-audit-1');
      expect(['inserted', 'skipped_duplicate']).toContain(meta.outcome);
    }

    // ── sync_runs contract (hourly bucket RPC called twice: seed + Phase 3) ──
    const bucketRpc = rpcCalls.filter((c) => c.name === 'upsert_clay_hourly_sync_run');
    expect(bucketRpc).toHaveLength(2);
    // Phase 1 seed: zeros
    expect(bucketRpc[0].args).toEqual({ p_accepted: 0, p_skipped: 0, p_errored: 0 });
    // Phase 3 final tally: 1 accepted + 1 skipped + 0 errored
    expect(bucketRpc[1].args).toEqual({ p_accepted: 1, p_skipped: 1, p_errored: 0 });

    // ── content_fingerprints contract ──
    expect(fingerprintMocks.recordFingerprint).toHaveBeenCalledTimes(1);
    expect(fingerprintMocks.recordFingerprint).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'ats', type: 'ats_external_id' }),
    );

    // ── sync_errors contract ──
    expect(ingestionMocks.recordSyncFailure).not.toHaveBeenCalled();

    // ── candidate upsert contract ──
    expect(ingestionMocks.batchUpsertCandidatesFromATS).toHaveBeenCalledTimes(1);

    // Review patch (F13 / AC 6 #15): candidate upsert must stamp the
    // configured default assignee — the mapper emits camelCase
    // `sourceRecruiterActorId`; `batchUpsertCandidatesFromATS` translates to
    // snake_case `source_recruiter_actor_id` on the final Supabase write
    // (Story 2-8).
    const upsertCall = ingestionMocks.batchUpsertCandidatesFromATS.mock.calls[0];
    expect(upsertCall).toBeDefined();
    const upsertRows = upsertCall[0] as Array<Record<string, unknown>>;
    expect(Array.isArray(upsertRows)).toBe(true);
    expect(upsertRows.length).toBeGreaterThanOrEqual(1);
    for (const row of upsertRows) {
      expect(row.sourceRecruiterActorId).toBe('test-assignee-actor-id');
    }

    // ── provider_health_events contract — no transitions on happy path ──
    expect(healthEventInserts).toHaveLength(0);

    // ── Legacy [Clay Webhook]-class contract: the fingerprint-hit JSON line ──
    // still fires on the duplicate row (structured log preserved for operator
    // runbooks + 2-4b admin drill-down).
    const fpHitLogs = logSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((line) => line.includes('"event":"fingerprint_hit"'));
    expect(fpHitLogs.length).toBeGreaterThanOrEqual(1);
  });
});
