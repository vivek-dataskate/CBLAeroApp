import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all external dependencies
const mocks = vi.hoisted(() => ({
  fetchCeipalApplicants: vi.fn().mockResolvedValue([]),
  mapCeipalApplicantToCandidate: vi.fn((a: any) => ({ firstName: a.first_name, email: a.email_address, source: 'ceipal' })),
  parseInbox: vi.fn().mockResolvedValue([]),
  isSupabaseConfigured: vi.fn(() => false),
  getSupabaseAdminClient: vi.fn(),
  recordSyncFailure: vi.fn(),
  upsertCandidateFromATS: vi.fn().mockResolvedValue(undefined),
  upsertCandidateFromEmailFull: vi.fn().mockResolvedValue(undefined),
  batchUpsertCandidatesFromATS: vi.fn().mockResolvedValue({ inserted: 0, failed: 0 }),
  isAlreadyProcessed: vi.fn().mockResolvedValue(false),
  recordFingerprint: vi.fn().mockResolvedValue(undefined),
  loadRecentFingerprints: vi.fn().mockResolvedValue(new Set()),
  computeFileHash: vi.fn().mockReturnValue('mock-hash'),
  getLastCandidateUpdateBySource: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/modules/ats', () => ({
  fetchCeipalApplicants: mocks.fetchCeipalApplicants,
  mapCeipalApplicantToCandidate: mocks.mapCeipalApplicantToCandidate,
}));

vi.mock('@/modules/email', () => ({
  MicrosoftGraphEmailParser: class {
    parseInbox = mocks.parseInbox;
    processInbox = vi.fn(async (_addrs: string[], _ids: Set<string>, handler: (r: any) => Promise<void>) => {
      const records = await mocks.parseInbox();
      let processed = 0, failed = 0;
      for (const r of records) {
        try {
          await handler(r);
          processed++;
        } catch {
          failed++;
        }
      }
      return { processed, skipped: 0, failed };
    });
    markAsRead = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('@/modules/persistence', () => ({
  isSupabaseConfigured: mocks.isSupabaseConfigured,
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));

vi.mock('@/modules/ingestion/index', () => ({
  recordSyncFailure: mocks.recordSyncFailure,
  upsertCandidateFromATS: mocks.upsertCandidateFromATS,
  upsertCandidateFromEmailFull: mocks.upsertCandidateFromEmailFull,
  batchUpsertCandidatesFromATS: mocks.batchUpsertCandidatesFromATS,
  DEFAULT_TENANT_ID: 'cbl-aero',
  createSyncRun: vi.fn().mockResolvedValue('mock-run-id'),
  completeSyncRun: vi.fn().mockResolvedValue(undefined),
  failSyncRun: vi.fn().mockResolvedValue(undefined),
  mapToCandidateRow: vi.fn((record: any, source: string) => ({ ...record, source })),
}));

vi.mock('@/features/candidate-management/infrastructure/fingerprint-repository', () => ({
  isAlreadyProcessed: mocks.isAlreadyProcessed,
  recordFingerprint: mocks.recordFingerprint,
  loadRecentFingerprints: mocks.loadRecentFingerprints,
  computeFileHash: mocks.computeFileHash,
}));

vi.mock('@/features/candidate-management/infrastructure/candidate-repository', () => ({
  getLastCandidateUpdateBySource: mocks.getLastCandidateUpdateBySource,
}));

vi.mock('@/features/candidate-management/application/role-deduction', () => ({
  deduceRoles: vi.fn().mockResolvedValue({ roles: [], metadata: { source: 'heuristic', confidence: 0, rawJobTitle: null, rawSkills: [], deducedAt: new Date().toISOString() } }),
}));

import { CeipalIngestionJob, EmailIngestionJob, registerIngestionJobs } from '@/modules/ingestion/jobs';

describe('CeipalIngestionJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches applicants and batch-upserts them', async () => {
    mocks.fetchCeipalApplicants.mockResolvedValue([
      { first_name: 'Jane', last_name: 'Doe', email_address: 'jane@test.com' },
      { first_name: 'John', last_name: 'Smith', email_address: 'john@test.com' },
    ]);
    mocks.batchUpsertCandidatesFromATS.mockResolvedValue({ inserted: 2, failed: 0 });

    const job = new CeipalIngestionJob();
    await job.run();

    expect(mocks.fetchCeipalApplicants).toHaveBeenCalledTimes(1);
    expect(mocks.mapCeipalApplicantToCandidate).toHaveBeenCalledTimes(2);
    expect(mocks.batchUpsertCandidatesFromATS).toHaveBeenCalledTimes(1);
    expect(mocks.batchUpsertCandidatesFromATS).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ firstName: 'Jane', source: 'ceipal' }),
        expect.objectContaining({ firstName: 'John', source: 'ceipal' }),
      ])
    );
    expect(mocks.recordSyncFailure).not.toHaveBeenCalled();
  });

  it('records sync failure when batch upsert throws', async () => {
    mocks.fetchCeipalApplicants.mockResolvedValue([
      { first_name: 'Good', last_name: 'One', email_address: 'good@test.com' },
    ]);
    mocks.batchUpsertCandidatesFromATS.mockRejectedValue(new Error('batch insert failed'));

    const job = new CeipalIngestionJob();
    await job.run();

    expect(mocks.batchUpsertCandidatesFromATS).toHaveBeenCalledTimes(1);
    expect(mocks.recordSyncFailure).toHaveBeenCalledWith('ceipal', 'polling', expect.any(Error), expect.anything());
  });

  it('records sync failure on polling error', async () => {
    mocks.fetchCeipalApplicants.mockRejectedValue(new Error('network timeout'));

    const job = new CeipalIngestionJob();
    await job.run();

    expect(mocks.recordSyncFailure).toHaveBeenCalledWith('ceipal', 'polling', expect.any(Error), expect.anything());
    expect(mocks.upsertCandidateFromATS).not.toHaveBeenCalled();
  });

  it('uses DB-backed since date for incremental sync when no explicit since param', async () => {
    const dbDate = new Date('2026-04-01T00:00:00Z');
    mocks.getLastCandidateUpdateBySource.mockResolvedValue(dbDate);
    mocks.fetchCeipalApplicants.mockResolvedValue([]);

    const job = new CeipalIngestionJob();
    await job.run(); // No startPage param → should query DB for since

    const callArgs = mocks.fetchCeipalApplicants.mock.calls[0][0];
    expect(callArgs.since).toBe(dbDate);
  });

  it('does not use DB-backed since when startPage is explicitly provided (initial-load mode)', async () => {
    mocks.getLastCandidateUpdateBySource.mockResolvedValue(new Date());
    mocks.fetchCeipalApplicants.mockResolvedValue([]);

    const job = new CeipalIngestionJob();
    await job.run({ startPage: 100, maxPages: 2 });

    const callArgs = mocks.fetchCeipalApplicants.mock.calls[0][0];
    expect(callArgs.since).toBeUndefined();
  });

  it('skips empty applicant lists without calling batch upsert', async () => {
    mocks.fetchCeipalApplicants.mockResolvedValue([]);

    const job = new CeipalIngestionJob();
    await job.run();

    expect(mocks.batchUpsertCandidatesFromATS).not.toHaveBeenCalled();
  });
});

describe('EmailIngestionJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses inbox and upserts each record', async () => {
    mocks.parseInbox.mockResolvedValue([
      { id: 'msg-1', mailbox: 'test@test.com', candidate: { firstName: 'Jane', email: 'jane@test.com' }, subject: 'Test', body: '', receivedAt: '2026-01-01', attachments: [] },
    ]);

    const job = new EmailIngestionJob();
    await job.run();

    expect(mocks.upsertCandidateFromEmailFull).toHaveBeenCalledTimes(1);
  });

  it('continues processing after per-record error', async () => {
    mocks.parseInbox.mockResolvedValue([
      { id: 'msg-1', mailbox: 'test@test.com', candidate: {}, subject: 'S1', body: '', receivedAt: '', attachments: [] },
      { id: 'msg-2', mailbox: 'test@test.com', candidate: {}, subject: 'S2', body: '', receivedAt: '', attachments: [] },
    ]);
    mocks.upsertCandidateFromEmailFull
      .mockRejectedValueOnce(new Error('db error'))
      .mockResolvedValueOnce(undefined);

    const job = new EmailIngestionJob();
    await job.run();

    // Both records should have been attempted (handler called for each)
    expect(mocks.upsertCandidateFromEmailFull).toHaveBeenCalledTimes(2);
  });

  it('records sync failure on polling error', async () => {
    mocks.parseInbox.mockRejectedValue(new Error('Graph auth failed'));

    const job = new EmailIngestionJob();
    await job.run();

    expect(mocks.recordSyncFailure).toHaveBeenCalledWith('email', 'polling', expect.any(Error), expect.anything());
  });
});

describe('registerIngestionJobs', () => {
  it('registers all 7 ingestion jobs', () => {
    const mockScheduler = { register: vi.fn() };
    registerIngestionJobs(mockScheduler);

    expect(mockScheduler.register).toHaveBeenCalledTimes(7);
    const names = mockScheduler.register.mock.calls.map((c: any) => c[0].name);
    expect(names).toContain('CeipalIngestionJob');
    expect(names).toContain('EmailIngestionJob');
    expect(names).toContain('OneDriveResumePollerJob');
    expect(names).toContain('SavedSearchDigestJob');
    expect(names).toContain('DedupWorkerJob');
    expect(names).toContain('RoleDeductionEnrichmentJob');
    expect(names).toContain('CandidateAvailabilityRefreshJob');
  });

  it('registered jobs implement SchedulerJob interface', () => {
    const mockScheduler = { register: vi.fn() };
    registerIngestionJobs(mockScheduler);

    for (const [job] of mockScheduler.register.mock.calls) {
      expect(job).toHaveProperty('name');
      expect(job).toHaveProperty('run');
      expect(typeof job.run).toBe('function');
    }
  });
});
