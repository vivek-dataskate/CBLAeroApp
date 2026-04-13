import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock persistence module
const mocks = vi.hoisted(() => ({
  isSupabaseConfigured: vi.fn(() => false),
  getSupabaseAdminClient: vi.fn(),
}));

vi.mock('@/modules/persistence', () => ({
  isSupabaseConfigured: mocks.isSupabaseConfigured,
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));

vi.mock('@/modules/email/nlp-extract-and-upload', () => ({
  uploadAttachmentToStorage: vi.fn().mockResolvedValue({ filename: 'test.pdf', url: 'https://example.com/test.pdf', size: 100 }),
}));

const submissionMocks = vi.hoisted(() => ({
  findSubmissionByMessageId: vi.fn().mockResolvedValue(null),
  insertSubmission: vi.fn().mockResolvedValue('sub-uuid'),
}));

vi.mock('@/features/candidate-management/infrastructure/submission-repository', () => ({
  findSubmissionByMessageId: submissionMocks.findSubmissionByMessageId,
  insertSubmission: submissionMocks.insertSubmission,
}));

const candidateRepoMocks = vi.hoisted(() => ({
  upsertCandidateByEmail: vi.fn().mockResolvedValue('cand-uuid-1'),
  insertCandidateNoEmail: vi.fn().mockResolvedValue('cand-uuid-2'),
  batchUpsertCandidatesByEmail: vi.fn().mockResolvedValue(undefined),
  batchInsertCandidatesNoEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/features/candidate-management/infrastructure/candidate-repository', () => ({
  upsertCandidateByEmail: candidateRepoMocks.upsertCandidateByEmail,
  insertCandidateNoEmail: candidateRepoMocks.insertCandidateNoEmail,
  batchUpsertCandidatesByEmail: candidateRepoMocks.batchUpsertCandidatesByEmail,
  batchInsertCandidatesNoEmail: candidateRepoMocks.batchInsertCandidatesNoEmail,
}));

import {
  recordSyncFailure,
  listRecentSyncErrors,
  clearSyncErrorsForTest,
  upsertCandidateFromATS,
  upsertCandidateFromEmailFull,
} from '@/modules/ingestion';

describe('Sync Error Store', () => {
  beforeEach(() => {
    clearSyncErrorsForTest();
    vi.clearAllMocks();
    mocks.isSupabaseConfigured.mockReturnValue(false);
  });

  it('records a sync failure with source attribution', async () => {
    recordSyncFailure('ats', 'rec-123', new Error('Connection timeout'));
    const errors = await listRecentSyncErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].source).toBe('ats');
    expect(errors[0].recordId).toBe('rec-123');
    expect(errors[0].message).toBe('Connection timeout');
    expect(errors[0].timestamp).toBeTruthy();
    expect(errors[0].id).toMatch(/^ats-/);
  });

  it('records non-Error values as string messages', async () => {
    recordSyncFailure('email', 'msg-1', 'string error');
    const errors = await listRecentSyncErrors();
    expect(errors[0].message).toBe('string error');
  });

  it('maintains FIFO order (newest first)', async () => {
    recordSyncFailure('ats', 'first', new Error('err1'));
    recordSyncFailure('email', 'second', new Error('err2'));
    const errors = await listRecentSyncErrors();
    expect(errors[0].source).toBe('email');
    expect(errors[1].source).toBe('ats');
  });

  it('caps at 100 entries', async () => {
    for (let i = 0; i < 110; i++) {
      recordSyncFailure('ats', `rec-${i}`, new Error(`err-${i}`));
    }
    const errors = await listRecentSyncErrors();
    expect(errors).toHaveLength(100);
    // Newest should be rec-109
    expect(errors[0].recordId).toBe('rec-109');
  });

  it('clears errors for test isolation', async () => {
    recordSyncFailure('ats', 'rec-1', new Error('err'));
    clearSyncErrorsForTest();
    const errors = await listRecentSyncErrors();
    expect(errors).toHaveLength(0);
  });

  it('returns a copy, not a reference to internal state', async () => {
    recordSyncFailure('ats', 'rec-1', new Error('err'));
    const errors1 = await listRecentSyncErrors();
    const errors2 = await listRecentSyncErrors();
    expect(errors1).not.toBe(errors2);
    expect(errors1).toEqual(errors2);
  });
});

// createIngestionEnvelope test removed — dead code was removed from ingestion module

describe('upsertCandidateFromATS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSyncErrorsForTest();
  });

  it('skips persist when Supabase is not configured', async () => {
    mocks.isSupabaseConfigured.mockReturnValue(false);
    await upsertCandidateFromATS({ firstName: 'Jane', email: 'jane@test.com' });
    expect(candidateRepoMocks.upsertCandidateByEmail).not.toHaveBeenCalled();
  });

  it('rejects candidates with no email and no phone', async () => {
    // isSupabaseConfigured must be false so recordSyncFailure stays in-memory only
    mocks.isSupabaseConfigured.mockReturnValue(true);
    // Provide a mock client in case recordSyncFailure fires
    mocks.getSupabaseAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: null }),
        delete: vi.fn().mockReturnValue({ lt: vi.fn().mockReturnValue({ then: vi.fn() }) }),
      }),
    });
    await upsertCandidateFromATS({ firstName: 'NoContact', source: 'ats' });
    // Read errors back — need to switch to in-memory since Supabase mock returns empty
    mocks.isSupabaseConfigured.mockReturnValue(false);
    const errors = await listRecentSyncErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('no email or phone');
  });

  it('upserts new candidate by email via repository', async () => {
    mocks.isSupabaseConfigured.mockReturnValue(true);

    await upsertCandidateFromATS({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@test.com',
      phone: '555-1234',
      source: 'ceipal',
    });

    expect(candidateRepoMocks.upsertCandidateByEmail).toHaveBeenCalledTimes(1);
    const upsertedRow = candidateRepoMocks.upsertCandidateByEmail.mock.calls[0][0];
    expect(upsertedRow.first_name).toBe('Jane');
    expect(upsertedRow.last_name).toBe('Doe');
    expect(upsertedRow.email).toBe('jane@test.com');
    expect(upsertedRow.source).toBe('ceipal');
    expect(upsertedRow.tenant_id).toBe('cbl-aero');
  });

  it('throws on upsert failure', async () => {
    candidateRepoMocks.upsertCandidateByEmail.mockRejectedValueOnce(
      new Error('Candidate upsert failed: constraint violation'),
    );
    mocks.isSupabaseConfigured.mockReturnValue(true);

    await expect(
      upsertCandidateFromATS({ firstName: 'Bad', email: 'bad@test.com', source: 'ats' })
    ).rejects.toThrow('Candidate upsert failed: constraint violation');
  });
});

describe('upsertCandidateFromEmailFull', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSyncErrorsForTest();
    submissionMocks.findSubmissionByMessageId.mockResolvedValue(null);
    submissionMocks.insertSubmission.mockResolvedValue('sub-uuid');
    candidateRepoMocks.upsertCandidateByEmail.mockResolvedValue('cand-uuid-1');
    candidateRepoMocks.insertCandidateNoEmail.mockResolvedValue('cand-uuid-2');
  });

  it('skips persist when Supabase is not configured', async () => {
    mocks.isSupabaseConfigured.mockReturnValue(false);
    await upsertCandidateFromEmailFull({
      id: 'msg-1',
      subject: 'Test',
      body: '<p>Test body</p>',
      candidate: { firstName: 'Jane', lastName: 'Doe', email: 'jane@test.com', source: 'email' },
      receivedAt: '2026-03-31T00:00:00Z',
    });
    expect(candidateRepoMocks.upsertCandidateByEmail).not.toHaveBeenCalled();
  });

  it('inserts new candidate and submission with attachments', async () => {
    mocks.isSupabaseConfigured.mockReturnValue(true);

    await upsertCandidateFromEmailFull({
      id: 'msg-new',
      subject: 'MHI | Tucson | A&P Tech | Jane',
      body: '<p>Candidate details</p>',
      candidate: { firstName: 'Jane', lastName: 'Doe', email: 'jane@test.com', source: 'email', extractionMethod: 'llm' },
      receivedAt: '2026-03-31T12:00:00Z',
    });

    expect(candidateRepoMocks.upsertCandidateByEmail).toHaveBeenCalledTimes(1);
    expect(submissionMocks.insertSubmission).toHaveBeenCalledTimes(1);
    const subParams = submissionMocks.insertSubmission.mock.calls[0][0];
    expect(subParams.emailSubject).toBe('MHI | Tucson | A&P Tech | Jane');
    expect(subParams.extractionModel).toBe('claude-haiku-4-5-20251001');
    expect(subParams.candidateId).toBe('cand-uuid-1');
  });

  it('skips already-processed email by message ID (dedup before any DB writes)', async () => {
    mocks.isSupabaseConfigured.mockReturnValue(true);

    // Mock submission dedup to return an existing submission
    submissionMocks.findSubmissionByMessageId.mockResolvedValueOnce({ id: 'sub-existing' });

    await upsertCandidateFromEmailFull({
      id: 'msg-duplicate',
      subject: 'Already processed',
      body: '<p>body</p>',
      candidate: { firstName: 'Jane', lastName: 'Doe', email: 'jane@test.com', source: 'email' },
      receivedAt: '2026-03-31T12:00:00Z',
    });

    // Neither candidate upsert nor submission insert should be called — dedup skipped everything
    expect(candidateRepoMocks.upsertCandidateByEmail).not.toHaveBeenCalled();
    expect(submissionMocks.insertSubmission).not.toHaveBeenCalled();
  });

  it('upserts existing candidate by email dedup', async () => {
    candidateRepoMocks.upsertCandidateByEmail.mockResolvedValue('cand-existing');
    mocks.isSupabaseConfigured.mockReturnValue(true);

    await upsertCandidateFromEmailFull({
      id: 'msg-update',
      subject: 'Updated submission',
      body: '<p>body</p>',
      candidate: { firstName: 'Jane', lastName: 'Doe', email: 'jane@test.com', source: 'email' },
      receivedAt: '2026-03-31T12:00:00Z',
    });

    expect(candidateRepoMocks.upsertCandidateByEmail).toHaveBeenCalledTimes(1);
    expect(submissionMocks.insertSubmission).toHaveBeenCalledTimes(1);
  });
});
