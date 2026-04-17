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

// Track RPC calls to upsert_clay_hourly_sync_run so tests can assert on the
// payload (the hourly bucket RPC is the new Story 2.8 observability surface
// after the 2026-04-15 hourly-bucket refactor).
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

// Fake Supabase admin client that handles both:
//   (1) `.from('admin_managed_users').select().eq().eq().maybeSingle()` for
//       assignee resolution — always returns a fixed test user
//   (2) `.rpc('upsert_clay_hourly_sync_run', args)` for the hourly bucket upsert
//       — records calls into `rpcCalls` for assertions
function makeFakeSupabaseClient() {
  const userQueryBuilder = {
    select: () => userQueryBuilder,
    eq: () => userQueryBuilder,
    maybeSingle: () =>
      Promise.resolve({ data: { actor_id: 'test-assignee-actor-id' }, error: null }),
  };
  return {
    from: (_table: string) => userQueryBuilder,
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: 'bucket-run-fake-1', error: null });
    },
  };
}

const persistenceMocks = vi.hoisted(() => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseAdminClient: vi.fn(),
}));
vi.mock('@/modules/persistence', () => persistenceMocks);

// Mock the ingestion barrel module that the webhook imports from directly.
// batchUpsertCandidatesFromATS is the shared ingestion entry point we delegate to;
// recordSyncFailure is the error-logging helper (no sync_run lifecycle calls
// anymore — the webhook uses the upsert_clay_hourly_sync_run RPC via the
// mocked Supabase admin client above).
const ingestionMocks = vi.hoisted(() => ({
  batchUpsertCandidatesFromATS: vi.fn().mockResolvedValue({ inserted: 1, failed: 0 }),
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
  rpcCalls.length = 0;
  persistenceMocks.isSupabaseConfigured.mockReturnValue(true);
  persistenceMocks.getSupabaseAdminClient.mockReturnValue(makeFakeSupabaseClient());
  fingerprintMocks.isAlreadyProcessed.mockResolvedValue(false);
  ingestionMocks.batchUpsertCandidatesFromATS.mockResolvedValue({ inserted: 1, failed: 0 });

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
        type: 'clay_profile_id',
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

  it('records hourly bucket with errored count when all rows error', async () => {
    // Row has a valid fingerprint but the shared pipeline rejects it (0 inserted).
    // Under the P12 two-phase pattern: phase 1 seeds with zeros, phase 3 increments with real counts.
    ingestionMocks.batchUpsertCandidatesFromATS.mockResolvedValue({ inserted: 0, failed: 1 });
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const res = await POST(makeRequest(SAMPLE_ROW) as never);
    expect(res.status).toBe(200);
    // Two RPC calls expected: seed (zeros) + increment (real counts).
    const bucketCalls = rpcCalls.filter((c) => c.name === 'upsert_clay_hourly_sync_run');
    expect(bucketCalls).toHaveLength(2);
    // Seed call — all zeros
    expect(bucketCalls[0]?.args).toEqual({ p_accepted: 0, p_skipped: 0, p_errored: 0 });
    // Increment call — real counts (1 errored)
    expect(bucketCalls[1]?.args).toEqual({ p_accepted: 0, p_skipped: 0, p_errored: 1 });
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

describe('POST /api/webhooks/clay — hourly bucket aggregation (two-phase)', () => {
  it('calls upsert_clay_hourly_sync_run RPC exactly twice per request (seed + increment)', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    await POST(makeRequest(SAMPLE_ROW) as never);
    const bucketCalls = rpcCalls.filter((c) => c.name === 'upsert_clay_hourly_sync_run');
    // Two calls: seed (zeros, for bucket id) + increment (real counts)
    expect(bucketCalls).toHaveLength(2);
  });

  it('seeds with zeros first, then increments with real counts', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    await POST(makeRequest(SAMPLE_ROW) as never);
    const bucketCalls = rpcCalls.filter((c) => c.name === 'upsert_clay_hourly_sync_run');
    expect(bucketCalls[0]?.args).toEqual({ p_accepted: 0, p_skipped: 0, p_errored: 0 });
    expect(bucketCalls[1]?.args).toEqual({ p_accepted: 1, p_skipped: 0, p_errored: 0 });
  });

  it('aggregates a batch of 3 rows into a single increment call with total counts', async () => {
    const row1 = SAMPLE_ROW;
    const row2 = {
      ...SAMPLE_ROW,
      'Personal Email': 'row2@example.com',
      'Enrich person': { ...SAMPLE_ROW['Enrich person'], profile_id: 2, last_refresh: '2026-04-15 19:00:00' },
    };
    const row3 = {
      ...SAMPLE_ROW,
      'Personal Email': 'row3@example.com',
      'Enrich person': { ...SAMPLE_ROW['Enrich person'], profile_id: 3, last_refresh: '2026-04-15 19:01:00' },
    };
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    await POST(makeRequest([row1, row2, row3]) as never);
    const bucketCalls = rpcCalls.filter((c) => c.name === 'upsert_clay_hourly_sync_run');
    // Still 2 calls per request regardless of batch size
    expect(bucketCalls).toHaveLength(2);
    expect(bucketCalls[1]?.args).toEqual({ p_accepted: 3, p_skipped: 0, p_errored: 0 });
  });

  it('reports bucket_run_id in the response body', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const res = await POST(makeRequest(SAMPLE_ROW) as never);
    const body = await res.json();
    // Bucket run id is captured from the first (seed) RPC call
    expect(body.bucket_run_id).toBe('bucket-run-fake-1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Code review regression tests (2026-04-16) — covers patches P1, P2, P8, P10, P11
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/webhooks/clay — P1 bearer normalization', () => {
  it('accepts lowercase bearer scheme (case-insensitive)', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const req = makeRequest(SAMPLE_ROW, { authorization: 'bearer test-secret-abc123' });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
  });

  it('accepts Bearer with extra leading/trailing whitespace in header', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const req = makeRequest(SAMPLE_ROW, { authorization: '  Bearer test-secret-abc123  ' });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
  });

  it('rejects non-bearer scheme (e.g. Basic)', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const req = makeRequest(SAMPLE_ROW, { authorization: 'Basic test-secret-abc123' });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it('rejects bearer token with different length (constant-time comparison guard)', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    // A shorter token — length mismatch short-circuits before timingSafeEqual
    const req = makeRequest(SAMPLE_ROW, { authorization: 'Bearer short' });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/webhooks/clay — P2 byte-based size enforcement', () => {
  it('enforces 256 KB ceiling against actual body size, not Content-Length header', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    // Build a payload > 256 KB by stuffing junk into a field
    const bigPayload = {
      ...SAMPLE_ROW,
      padding: 'x'.repeat(300_000),
    };
    const bodyText = JSON.stringify(bigPayload);
    const req = new Request('http://localhost:3000/api/webhooks/clay', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Lie about content-length — claim it's small
        'content-length': '10',
        authorization: 'Bearer test-secret-abc123',
      },
      body: bodyText,
    });
    const res = await POST(req as never);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    // Error message includes actual byte count
    expect(body.error.message).toContain('actual:');
  });

  it('rejects empty body with 400 BAD_JSON', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const req = new Request('http://localhost:3000/api/webhooks/clay', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '0',
        authorization: 'Bearer test-secret-abc123',
      },
      body: '',
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_JSON');
  });
});

describe('POST /api/webhooks/clay — P8 in-batch fingerprint dedup', () => {
  it('dedupes two rows in the same request sharing the same fingerprint', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    // Two rows with identical profile_id + last_refresh → identical fingerprint
    const dupe = SAMPLE_ROW;
    const res = await POST(makeRequest([dupe, dupe]) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(2);
    expect(body.accepted).toBe(1);
    expect(body.skipped).toBe(1);
    // Shared pipeline was called ONCE for the first row, not twice
    expect(ingestionMocks.batchUpsertCandidatesFromATS).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/webhooks/clay — P10 rows wrapper collision', () => {
  it('does not misread a row with a literal "rows" column as a batch envelope', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const rowWithRowsColumn = {
      ...SAMPLE_ROW,
      rows: [{ note: 'some metadata' }],  // Clay column literally named "rows"
    };
    const res = await POST(makeRequest(rowWithRowsColumn) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    // The whole object is treated as a single row — NOT as an envelope
    expect(body.received).toBe(1);
    expect(body.accepted).toBe(1);
    // The shared pipeline receives the row with the candidate fields intact
    expect(ingestionMocks.batchUpsertCandidatesFromATS).toHaveBeenCalledTimes(1);
  });

  it('still treats a SOLE-key {rows: [...]} envelope as a batch wrapper', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const envelope = { rows: [SAMPLE_ROW] };
    const res = await POST(makeRequest(envelope) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(1);
    expect(body.accepted).toBe(1);
  });
});

describe('POST /api/webhooks/clay — P11 double-wrapped array flattening', () => {
  it('flattens [[row1, row2]] to process both rows', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/webhooks/clay/route');
    const row2 = {
      ...SAMPLE_ROW,
      'Personal Email': 'row2@example.com',
      'Enrich person': { ...SAMPLE_ROW['Enrich person'], profile_id: 2, last_refresh: '2026-04-15 19:00:00' },
    };
    const res = await POST(makeRequest([[SAMPLE_ROW, row2]]) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(2);
    expect(body.accepted).toBe(2);
  });
});
