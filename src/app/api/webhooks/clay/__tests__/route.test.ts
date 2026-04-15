/**
 * Integration-lite tests for the Clay webhook route (Story 2.8).
 *
 * These tests mock the Supabase/persistence layer and the candidate repository
 * but exercise the real route handler end-to-end: auth, payload normalization,
 * mapper, fingerprint gate, upsert dispatch, and sync_run lifecycle.
 *
 * Tests that depend on a real database live in the integration test suite
 * and are skipped in CI without Supabase credentials.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks (hoisted so the module under test picks them up at import time) ──
//
// Strategy: mock at the webhook's direct import boundary (@/modules/ingestion and
// the fingerprint repo) rather than mocking deep inside the ingestion barrel.
// This keeps the tests focused on the webhook handler's responsibilities — auth,
// payload normalization, fingerprint gate, sync_run lifecycle — without coupling
// to the internal details of `batchUpsertCandidatesFromATS`.

const persistenceMocks = vi.hoisted(() => ({
  isSupabaseConfigured: vi.fn(() => false),
  getSupabaseAdminClient: vi.fn(),
}));
vi.mock('@/modules/persistence', () => persistenceMocks);

// Mock the ingestion barrel module that the webhook imports from directly.
// batchUpsertCandidatesFromATS is the shared ingestion entry point we delegate to;
// createSyncRun / completeSyncRun / failSyncRun / recordSyncFailure are sync-run
// lifecycle helpers; DEFAULT_TENANT_ID is a constant we pass through.
const ingestionMocks = vi.hoisted(() => ({
  batchUpsertCandidatesFromATS: vi.fn().mockResolvedValue({ inserted: 1, failed: 0 }),
  createSyncRun: vi.fn().mockResolvedValue('run-fake-1'),
  completeSyncRun: vi.fn().mockResolvedValue(undefined),
  failSyncRun: vi.fn().mockResolvedValue(undefined),
  recordSyncFailure: vi.fn(),
  DEFAULT_TENANT_ID: 'cbl-aero',
  // Re-exports from the barrel that other code might touch — kept as pass-through stubs
  listRecentSyncErrors: vi.fn().mockResolvedValue([]),
  clearSyncErrorsForTest: vi.fn(),
  listSyncRunsCurrentMonth: vi.fn().mockResolvedValue([]),
  listSyncErrorsByRun: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/modules/ingestion', () => ingestionMocks);

const fingerprintMocks = vi.hoisted(() => ({
  isAlreadyProcessed: vi.fn().mockResolvedValue(false),
  recordFingerprint: vi.fn().mockResolvedValue(undefined),
  loadRecentFingerprints: vi.fn().mockResolvedValue(new Set<string>()),
  recordFingerprintBatch: vi.fn().mockResolvedValue(undefined),
  isAlreadyProcessedByFile: vi.fn().mockResolvedValue(false),
  computeFileHash: vi.fn(),
}));
vi.mock('@/features/candidate-management/infrastructure/fingerprint-repository', () => fingerprintMocks);

// Configure env before importing the route
beforeEach(async () => {
  process.env.CLAY_WEBHOOK_SECRET = 'test-secret-abc123';
  process.env.CLAY_DEFAULT_ASSIGNEE_EMAIL = 'vivek@cblsolutions.com';
  process.env.CLAY_EMAIL_FIELD = 'Personal Email';
  process.env.CLAY_PHONE_FIELD = 'Mobile Phone';
  process.env.CLAY_WEBHOOK_DEBUG = 'false';
  // Reset all mocks between tests
  vi.clearAllMocks();
  persistenceMocks.isSupabaseConfigured.mockReturnValue(false);
  fingerprintMocks.isAlreadyProcessed.mockResolvedValue(false);
  ingestionMocks.batchUpsertCandidatesFromATS.mockResolvedValue({ inserted: 1, failed: 0 });
  ingestionMocks.createSyncRun.mockResolvedValue('run-fake-1');

  // Reset cached assignee user ID between tests
  const { __resetClayWebhookCacheForTests } = await import('@/app/api/webhooks/clay/route');
  __resetClayWebhookCacheForTests();
});

afterEach(() => {
  delete process.env.CLAY_WEBHOOK_SECRET;
  delete process.env.CLAY_DEFAULT_ASSIGNEE_EMAIL;
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const bodyText = JSON.stringify(body);
  return new Request('http://localhost:3000/api/webhooks/clay', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(bodyText.length),
      authorization: 'Bearer test-secret-abc123',
      ...headers,
    },
    body: bodyText,
  });
}

const SAMPLE_ROW = {
  'Personal Email': 'sotoisis27@gmail.com',
  'Mobile Phone': '+17733298878',
  'Enrich person': {
    first_name: 'Isis',
    last_name: 'Soto',
    url: 'https://www.linkedin.com/in/isis-soto-34b54725a',
    title: 'Billing Coordinator',
    headline: '--',
    country: 'United States',
    org: 'Seyfarth Shaw LLP',
    location_name: 'Chicago, Illinois, United States',
    profile_id: 1070321963,
    last_refresh: '2026-04-15 18:42:29.033',
    experience: [],
    certifications: null,
  },
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('POST /api/webhooks/clay — auth', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const req = makeRequest(SAMPLE_ROW, { authorization: '' });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when Authorization header is wrong', async () => {
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const req = makeRequest(SAMPLE_ROW, { authorization: 'Bearer wrong-secret' });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it('returns 500 when CLAY_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.CLAY_WEBHOOK_SECRET;
    // Re-import so the module captures the new env
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const req = makeRequest(SAMPLE_ROW);
    const res = await POST(req as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('SERVER_MISCONFIGURED');
    // Restore for subsequent tests
    process.env.CLAY_WEBHOOK_SECRET = 'test-secret-abc123';
  });
});

describe('POST /api/webhooks/clay — payload handling', () => {
  it('accepts a single row object', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const res = await POST(makeRequest(SAMPLE_ROW) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(1);
    expect(body.accepted).toBe(1);
    expect(body.errored).toBe(0);
    expect(ingestionMocks.batchUpsertCandidatesFromATS).toHaveBeenCalledTimes(1);
  });

  it('accepts an array of rows', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const secondRow = {
      ...SAMPLE_ROW,
      'Personal Email': 'second@example.com',
      'Enrich person': { ...SAMPLE_ROW['Enrich person'], profile_id: 2, last_refresh: '2026-04-15 19:00:00' },
    };
    const res = await POST(makeRequest([SAMPLE_ROW, secondRow]) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(2);
    expect(body.accepted).toBe(2);
    expect(ingestionMocks.batchUpsertCandidatesFromATS).toHaveBeenCalledTimes(2);
  });

  it('accepts a wrapped { rows: [...] } payload', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const res = await POST(makeRequest({ rows: [SAMPLE_ROW] }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(1);
    expect(body.accepted).toBe(1);
  });

  it('returns 400 for garbage body shapes (e.g., a string)', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const res = await POST(makeRequest('not an object') as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('UNRECOGNIZED_SHAPE');
  });

  it('returns 200 with zero counts for an empty array', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const res = await POST(makeRequest([]) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(0);
    expect(body.accepted).toBe(0);
    expect(ingestionMocks.batchUpsertCandidatesFromATS).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/clay — fingerprint gate', () => {
  it('short-circuits a row whose fingerprint has already been processed', async () => {
    fingerprintMocks.isAlreadyProcessed.mockResolvedValue(true);
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const res = await POST(makeRequest(SAMPLE_ROW) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accepted).toBe(0);
    expect(body.skipped).toBe(1);
    expect(body.errored).toBe(0);
    // Critical: upsert was NOT called for the short-circuited row
    expect(ingestionMocks.batchUpsertCandidatesFromATS).not.toHaveBeenCalled();
  });

  it('still records a fingerprint for successfully accepted rows', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    await POST(makeRequest(SAMPLE_ROW) as never);
    expect(fingerprintMocks.recordFingerprint).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ats_external_id',
        source: 'ats',
      }),
    );
  });
});

describe('POST /api/webhooks/clay — row-level error containment', () => {
  it('continues processing sibling rows when one row is rejected by the shared pipeline', async () => {
    // Simulate shared pipeline rejecting the second row (e.g., missing email+phone).
    // First call succeeds (1 inserted), second call rejects (0 inserted, 1 failed).
    ingestionMocks.batchUpsertCandidatesFromATS
      .mockResolvedValueOnce({ inserted: 1, failed: 0 })
      .mockResolvedValueOnce({ inserted: 0, failed: 1 });

    const goodRow = SAMPLE_ROW;
    const secondRow = {
      ...SAMPLE_ROW,
      'Personal Email': 'second@example.com',
      'Enrich person': { ...SAMPLE_ROW['Enrich person'], profile_id: 2, last_refresh: '2026-04-15 19:00:00' },
    };
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const res = await POST(makeRequest([goodRow, secondRow]) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(2);
    expect(body.accepted).toBe(1);
    expect(body.errored).toBe(1);
    // Shared pipeline was called for both rows (batch of 1 each)
    expect(ingestionMocks.batchUpsertCandidatesFromATS).toHaveBeenCalledTimes(2);
  });

  it('records sync_run as failed when all rows error', async () => {
    // Row has a valid fingerprint but the shared pipeline rejects it (0 inserted)
    ingestionMocks.batchUpsertCandidatesFromATS.mockResolvedValue({ inserted: 0, failed: 1 });
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const res = await POST(makeRequest(SAMPLE_ROW) as never);
    expect(res.status).toBe(200);
    expect(ingestionMocks.failSyncRun).toHaveBeenCalled();
  });

  it('skips rows with no fingerprint-eligible identity before calling the shared pipeline', async () => {
    // Row has no profile_id, no last_refresh, AND no sidecar email → null fingerprint
    const noIdentityRow = {
      'Mobile Phone': '+15550000000',
      'Enrich person': { first_name: 'NoId', last_name: 'Row' },
    };
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const res = await POST(makeRequest(noIdentityRow) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe(1);
    expect(body.accepted).toBe(0);
    // Shared pipeline was NOT called — the fingerprint gate short-circuited first
    expect(ingestionMocks.batchUpsertCandidatesFromATS).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/clay — sync run lifecycle', () => {
  it('creates a sync_run for every request', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    await POST(makeRequest(SAMPLE_ROW) as never);
    expect(ingestionMocks.createSyncRun).toHaveBeenCalledWith('clay_enrichment');
  });

  it('completes the sync_run with accurate counts on success', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    await POST(makeRequest(SAMPLE_ROW) as never);
    expect(ingestionMocks.completeSyncRun).toHaveBeenCalledWith('run-fake-1', {
      succeeded: 1,
      failed: 0,
      total: 1,
    });
  });
});
