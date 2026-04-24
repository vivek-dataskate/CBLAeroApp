import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all external dependencies
const mocks = vi.hoisted(() => ({
  fetchCeipalApplicants: vi.fn().mockResolvedValue([]),
  mapCeipalApplicantToCandidate: vi.fn((a: Record<string, unknown>) => ({ firstName: a.first_name, email: a.email_address, source: 'ceipal', ceipalId: a.email_address })),
  parseInbox: vi.fn().mockResolvedValue([]),
  isSupabaseConfigured: vi.fn(() => false),
  getSupabaseAdminClient: vi.fn(),
  recordSyncFailure: vi.fn(),
  upsertCandidateFromATS: vi.fn().mockResolvedValue(undefined),
  upsertCandidateFromEmailFull: vi.fn().mockResolvedValue(undefined),
  batchUpsertCandidatesFromATS: vi.fn().mockResolvedValue({ inserted: 0, failed: 0 }),
  isAlreadyProcessed: vi.fn().mockResolvedValue(false),
  recordFingerprint: vi.fn().mockResolvedValue(undefined),
  recordFingerprintBatch: vi.fn().mockResolvedValue(undefined),
  checkExistingFingerprints: vi.fn().mockResolvedValue(new Set()),
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
    processInbox = vi.fn(async (_addrs: string[], _ids: Set<string>, handler: (r: Record<string, unknown>) => Promise<void>) => {
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
  mapToCandidateRow: vi.fn((record: Record<string, unknown>, source: string) => ({ ...record, source })),
}));

vi.mock('@/features/candidate-management/infrastructure/fingerprint-repository', () => ({
  isAlreadyProcessed: mocks.isAlreadyProcessed,
  recordFingerprint: mocks.recordFingerprint,
  recordFingerprintBatch: mocks.recordFingerprintBatch,
  checkExistingFingerprints: mocks.checkExistingFingerprints,
  loadRecentFingerprints: mocks.loadRecentFingerprints,
  computeFileHash: mocks.computeFileHash,
}));

vi.mock('@/features/candidate-management/infrastructure/candidate-repository', () => ({
  getLastCandidateUpdateBySource: mocks.getLastCandidateUpdateBySource,
}));

vi.mock('@/features/candidate-management/application/role-deduction', () => ({
  deduceRoles: vi.fn().mockResolvedValue({ roles: [], metadata: { source: 'heuristic', confidence: 0, rawJobTitle: null, rawSkills: [], deducedAt: new Date().toISOString() } }),
}));

const providerMocks = vi.hoisted(() => ({
  ensureProvidersInitialized: vi.fn().mockResolvedValue(undefined),
  getMode: vi.fn(() => 'normal' as 'normal' | 'kill_switched' | null),
  getSharedGraphClient: vi.fn(),
}));

vi.mock('@/modules/providers', () => ({
  ensureProvidersInitialized: providerMocks.ensureProvidersInitialized,
  getProviderRegistry: () => ({ getMode: providerMocks.getMode }),
}));

vi.mock('@/modules/providers/graph', () => ({
  getSharedGraphClient: providerMocks.getSharedGraphClient,
}));

import { CeipalIngestionJob, EmailIngestionJob, OneDriveWordToPdfJob, computeFlatPdfName, wrapTextAsRtf, registerIngestionJobs } from '@/modules/ingestion/jobs';

describe('CeipalIngestionJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches applicants and batch-upserts them', async () => {
    // Page-by-page: first call returns applicants, second returns [] (end of data)
    mocks.fetchCeipalApplicants
      .mockResolvedValueOnce([
        { first_name: 'Jane', last_name: 'Doe', email_address: 'jane@test.com' },
        { first_name: 'John', last_name: 'Smith', email_address: 'john@test.com' },
      ]);
    mocks.checkExistingFingerprints.mockResolvedValue(new Set());
    mocks.batchUpsertCandidatesFromATS.mockResolvedValue({ inserted: 2, failed: 0 });

    const job = new CeipalIngestionJob();
    await job.run();

    // Called with per-page params: startPage=1, maxPages=1
    expect(mocks.fetchCeipalApplicants).toHaveBeenCalledWith(
      expect.objectContaining({ startPage: 1, maxPages: 1 }),
    );
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
    mocks.fetchCeipalApplicants
      .mockResolvedValueOnce([
        { first_name: 'Good', last_name: 'One', email_address: 'good@test.com' },
      ]);
    mocks.checkExistingFingerprints.mockResolvedValue(new Set());
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

  it('records file_sha256 fingerprint for email attachments (cross-source dedup)', async () => {
    const pdfBuffer = Buffer.from('fake-pdf-content');
    mocks.parseInbox.mockResolvedValue([
      {
        id: 'msg-att-1',
        mailbox: 'test@test.com',
        candidate: { firstName: 'Jane', email: 'jane@test.com' },
        subject: 'Resume attached',
        body: '',
        receivedAt: '2026-01-01',
        attachments: [{ filename: 'resume.pdf', content: pdfBuffer }],
      },
    ]);
    mocks.computeFileHash.mockReturnValue('abc123sha');

    const job = new EmailIngestionJob();
    await job.run();

    // Should record both email_message_id AND file_sha256 fingerprints
    expect(mocks.recordFingerprint).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'email_message_id', hash: 'msg-att-1', source: 'email' }),
    );
    expect(mocks.recordFingerprint).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'file_sha256', hash: 'abc123sha', source: 'email' }),
    );
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

    expect(mockScheduler.register).toHaveBeenCalledTimes(8);
    const names = mockScheduler.register.mock.calls.map((c: unknown[]) => (c[0] as { name: string }).name);
    expect(names).toContain('CeipalIngestionJob');
    expect(names).toContain('EmailIngestionJob');
    expect(names).toContain('OneDriveResumePollerJob');
    expect(names).toContain('OneDriveWordToPdfJob');
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

describe('computeFlatPdfName', () => {
  it('strips spaces from segments and joins with hyphen', () => {
    expect(computeFlatPdfName(['Upload', '6 April A&P'], 'john resume.docx'))
      .toBe('Upload-6AprilA&P-johnresume.pdf');
  });
  it('falls back to plain basename for files at recruiter root', () => {
    expect(computeFlatPdfName([], 'cool resume.docx')).toBe('coolresume.pdf');
  });
  it.each([
    ['.doc',  'old.doc',          'old.pdf'],
    ['.docx', 'new.docx',         'new.pdf'],
    ['.rtf',  'legacy.rtf',       'legacy.pdf'],
    ['.txt',  'cover note.txt',   'covernote.pdf'],
    ['.html', 'web copy.html',    'webcopy.pdf'],
    ['.htm',  'old.htm',          'old.pdf'],
    ['.odt',  'open office.odt',  'openoffice.pdf'],
    ['.md',   'readme.md',        'readme.pdf'],
  ])('strips %s extension', (_label, input, expected) => {
    expect(computeFlatPdfName([], input)).toBe(expected);
  });
});

describe('wrapTextAsRtf', () => {
  it('produces a valid minimal RTF wrapper', () => {
    const result = wrapTextAsRtf('Hello world');
    expect(result).toBe('{\\rtf1\\ansi\\deff0 Hello world}');
  });
  it('escapes RTF metacharacters', () => {
    expect(wrapTextAsRtf('a {b} \\c')).toBe('{\\rtf1\\ansi\\deff0 a \\{b\\} \\\\c}');
  });
  it('converts newlines to \\par', () => {
    expect(wrapTextAsRtf('line1\nline2')).toBe('{\\rtf1\\ansi\\deff0 line1\\par line2}');
  });
  it('encodes non-ASCII as \\u<n>?', () => {
    // 'é' is U+00E9 = 233 (positive in 16-bit signed)
    expect(wrapTextAsRtf('café')).toBe('{\\rtf1\\ansi\\deff0 caf\\u233?}');
  });
});

describe('OneDriveWordToPdfJob', () => {
  // Folder tree spec shared across cases. Each id maps to that folder's children.
  type Item = { id: string; name: string; size?: number; isFolder?: boolean };

  /**
   * URL-driven graph stub. Routes by URL pattern. The new job NEVER probes
   * single items by path (only listings + create + patch), so we don't even
   * model the 404 probe path anymore — if a test hits one it's a regression.
   */
  function makeGraphStub(opts: {
    rootId: string;
    children: Record<string, Item[]>;
  }) {
    const { rootId, children: initial } = opts;
    // Mutable copy so POST-created folders show up if we re-list.
    const children: Record<string, Item[]> = JSON.parse(JSON.stringify(initial));
    const created: Array<{ parentId: string; name: string; isFolder: boolean; newId: string }> = [];
    const moved: Array<{ itemId: string; newParentId: string }> = [];

    const get = vi.fn(async (url: string) => {
      if (url.includes('/drive/root:/')) {
        return { ok: true, status: 200, data: { id: rootId } };
      }
      const childMatch = url.match(/\/drive\/items\/([^/]+)\/children/);
      if (childMatch) {
        const folderId = childMatch[1];
        const value = (children[folderId] ?? []).map((it) => ({
          id: it.id,
          name: it.name,
          size: it.size ?? 0,
          file: it.isFolder ? undefined : { mimeType: 'application/octet-stream' },
          folder: it.isFolder ? { childCount: (children[it.id] ?? []).length } : undefined,
        }));
        return { ok: true, status: 200, data: { value } };
      }
      // Any /drive/items/X:/Y path-probe is now a regression — surface as a hard 500.
      return { ok: false, status: 500, data: null, error: `Unexpected GET ${url}` };
    });

    const post = vi.fn(async (url: string, body: { name: string; folder?: object }) => {
      const parentMatch = url.match(/\/drive\/items\/([^/]+)\/children/);
      const parentId = parentMatch?.[1] ?? 'unknown';
      const newId = `created-${parentId}-${body.name}`;
      created.push({ parentId, name: body.name, isFolder: !!body.folder, newId });
      // Make the created folder visible in children listings.
      if (body.folder) {
        const list = children[parentId] ?? [];
        list.push({ id: newId, name: body.name, isFolder: true });
        children[parentId] = list;
        children[newId] = [];
      }
      return { ok: true, status: 201, data: { id: newId } };
    });

    const patch = vi.fn(async (url: string, body: { parentReference?: { id: string } }) => {
      const itemMatch = url.match(/\/drive\/items\/([^/]+)$/);
      const itemId = itemMatch?.[1] ?? 'unknown';
      if (body.parentReference?.id) {
        moved.push({ itemId, newParentId: body.parentReference.id });
      }
      return { ok: true, status: 200, data: { id: itemId } };
    });

    const del = vi.fn(async () => ({ ok: true, status: 204, data: null }));

    const getAccessToken = vi.fn().mockResolvedValue('fake-token');

    return { stub: { get, post, patch, delete: del, getAccessToken }, created, moved };
  }

  /** Mock global fetch for binary GET (PDF rendition) + PUT (upload). */
  function mockBinaryFetch() {
    const calls: Array<{ url: string; method: string }> = [];
    let uploadCounter = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      const isUpload = method === 'PUT';
      return {
        ok: true,
        status: isUpload ? 201 : 200,
        arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer, // %PDF
        text: async () => '',
        // uploadFileReturnId expects { id } back from the PUT response
        json: async () => ({ id: `mock-upload-${++uploadCounter}` }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, calls };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    providerMocks.ensureProvidersInitialized.mockResolvedValue(undefined);
    providerMocks.getMode.mockReturnValue('normal');
  });

  it('skips run when graph provider is unregistered', async () => {
    providerMocks.getMode.mockReturnValue(null);
    providerMocks.getSharedGraphClient.mockReturnValue(null);

    await new OneDriveWordToPdfJob().run();

    expect(providerMocks.getSharedGraphClient).not.toHaveBeenCalled();
  });

  it('skips run when graph provider is kill_switched', async () => {
    providerMocks.getMode.mockReturnValue('kill_switched');
    providerMocks.getSharedGraphClient.mockReturnValue(null);

    await new OneDriveWordToPdfJob().run();

    expect(providerMocks.getSharedGraphClient).not.toHaveBeenCalled();
  });

  it('walks deep subfolders, mirrors structure under converted/, and routes flat PDF to pdfs/', async () => {
    const { stub, created, moved } = makeGraphStub({
      rootId: 'root-id',
      children: {
        'root-id': [
          { id: 'recruiter-A', name: 'Roushan Kumar CLT', isFolder: true },
        ],
        'recruiter-A': [
          { id: 'sub1', name: 'Sub1', isFolder: true },
        ],
        'sub1': [
          { id: 'sub2', name: 'Sub2', isFolder: true },
        ],
        'sub2': [
          { id: 'deep-doc', name: 'deep file.docx' },
        ],
      },
    });
    providerMocks.getSharedGraphClient.mockReturnValue(stub);
    const { calls } = mockBinaryFetch();

    await new OneDriveWordToPdfJob().run();

    // pdfs/ + converted/ + Sub1/ + Sub2/ all created under recruiter-A
    expect(created.find((c) => c.parentId === 'recruiter-A' && c.name === 'pdfs')).toBeDefined();
    expect(created.find((c) => c.parentId === 'recruiter-A' && c.name === 'converted')).toBeDefined();
    const convertedId = created.find((c) => c.parentId === 'recruiter-A' && c.name === 'converted')!.newId;
    expect(created.find((c) => c.parentId === convertedId && c.name === 'Sub1')).toBeDefined();
    const sub1MirrorId = created.find((c) => c.parentId === convertedId && c.name === 'Sub1')!.newId;
    expect(created.find((c) => c.parentId === sub1MirrorId && c.name === 'Sub2')).toBeDefined();
    const sub2MirrorId = created.find((c) => c.parentId === sub1MirrorId && c.name === 'Sub2')!.newId;

    // Word file moved into the deepest mirrored folder, preserving original filename
    expect(moved).toContainEqual({ itemId: 'deep-doc', newParentId: sub2MirrorId });

    // PDF uploaded with flat name under pdfs/ — spaces stripped, segments joined by `-`
    const pdfsId = created.find((c) => c.parentId === 'recruiter-A' && c.name === 'pdfs')!.newId;
    const putCall = calls.find((c) => c.method === 'PUT');
    expect(putCall?.url).toContain(`/drive/items/${pdfsId}:/Sub1-Sub2-deepfile.pdf:/content`);

    // PDF rendition fetched against the original item
    const renditionCall = calls.find((c) => c.method === 'GET' && c.url.includes('format=pdf'));
    expect(renditionCall?.url).toContain('/drive/items/deep-doc/content?format=pdf');
  });

  it('skips conversion when flat PDF already exists in pdfs/ but still moves the original', async () => {
    const { stub, created, moved } = makeGraphStub({
      rootId: 'root-id',
      children: {
        'root-id': [
          { id: 'recruiter-B', name: 'Recruiter B', isFolder: true },
        ],
        'recruiter-B': [
          { id: 'pdfs-existing', name: 'pdfs', isFolder: true },
          { id: 'doc-1', name: 'resume.docx' },
        ],
        'pdfs-existing': [
          // Already-converted PDF for resume.docx (no subpath, so flat name is just basename)
          { id: 'old-pdf', name: 'resume.pdf' },
        ],
      },
    });
    providerMocks.getSharedGraphClient.mockReturnValue(stub);
    const { calls } = mockBinaryFetch();

    await new OneDriveWordToPdfJob().run();

    // No PUT (no upload) — flat PDF already in pdfs/
    expect(calls.find((c) => c.method === 'PUT')).toBeUndefined();
    expect(calls.find((c) => c.url.includes('format=pdf'))).toBeUndefined();
    // pdfs/ already existed — not re-created
    expect(created.find((c) => c.name === 'pdfs')).toBeUndefined();
    // Original is still moved to converted/
    expect(moved.some((m) => m.itemId === 'doc-1')).toBe(true);
  });

  it('does not recurse into existing pdfs/ or converted/ folders', async () => {
    const { stub } = makeGraphStub({
      rootId: 'root-id',
      children: {
        'root-id': [
          { id: 'recruiter-C', name: 'Recruiter C', isFolder: true },
        ],
        'recruiter-C': [
          { id: 'pdfs-folder', name: 'pdfs', isFolder: true },
          { id: 'converted-folder', name: 'converted', isFolder: true },
          { id: 'fresh-doc', name: 'fresh.docx' },
        ],
        // If we erroneously recursed, we'd find these and try to reprocess as input
        'pdfs-folder': [{ id: 'stale-pdf', name: 'something.pdf' }],
        'converted-folder': [{ id: 'old-doc', name: 'previously-moved.docx' }],
      },
    });
    providerMocks.getSharedGraphClient.mockReturnValue(stub);
    const { calls } = mockBinaryFetch();

    await new OneDriveWordToPdfJob().run();

    // Exactly one rendition fetched — for fresh.docx, not the .docx inside converted/
    const pdfFetches = calls.filter((c) => c.url.includes('format=pdf'));
    expect(pdfFetches).toHaveLength(1);
    expect(pdfFetches[0].url).toContain('/drive/items/fresh-doc/');
  });

  it('reuses pdfs/ and the converted/ subpath cache across multiple files in the same recruiter', async () => {
    const { stub, created, moved } = makeGraphStub({
      rootId: 'root-id',
      children: {
        'root-id': [
          { id: 'recruiter-D', name: 'Recruiter D', isFolder: true },
        ],
        'recruiter-D': [
          { id: 'sub-x', name: 'X', isFolder: true },
        ],
        // Three sibling .docx in the same subfolder — they all share the same converted/X mirror
        'sub-x': [
          { id: 'doc-a', name: 'a.docx' },
          { id: 'doc-b', name: 'b.docx' },
          { id: 'doc-c', name: 'c.docx' },
        ],
      },
    });
    providerMocks.getSharedGraphClient.mockReturnValue(stub);
    mockBinaryFetch();

    await new OneDriveWordToPdfJob().run();

    // pdfs/, converted/, converted/X each created exactly once — no duplicate creates
    expect(created.filter((c) => c.name === 'pdfs')).toHaveLength(1);
    expect(created.filter((c) => c.name === 'converted')).toHaveLength(1);
    expect(created.filter((c) => c.name === 'X')).toHaveLength(1);
    // All three originals moved into the same converted/X mirror folder
    expect(moved).toHaveLength(3);
    expect(new Set(moved.map((m) => m.newParentId)).size).toBe(1);
  });

  it('reuses an existing converted/ subpath without recreating it', async () => {
    // Pre-existing converted/Upload mirror — initRecruiterCtx walks it and caches its IDs.
    const { stub, created, moved } = makeGraphStub({
      rootId: 'root-id',
      children: {
        'root-id': [{ id: 'rec', name: 'Rec', isFolder: true }],
        'rec': [
          { id: 'upload-input', name: 'Upload', isFolder: true },
          { id: 'converted-existing', name: 'converted', isFolder: true },
        ],
        'upload-input': [{ id: 'doc-x', name: 'x.docx' }],
        'converted-existing': [{ id: 'upload-mirror', name: 'Upload', isFolder: true }],
        'upload-mirror': [],
      },
    });
    providerMocks.getSharedGraphClient.mockReturnValue(stub);
    mockBinaryFetch();

    await new OneDriveWordToPdfJob().run();

    // converted/ and converted/Upload already exist — neither should be created
    expect(created.find((c) => c.name === 'converted')).toBeUndefined();
    expect(created.find((c) => c.name === 'Upload' && c.parentId === 'converted-existing')).toBeUndefined();
    // The original is moved into the existing converted/Upload mirror
    expect(moved).toContainEqual({ itemId: 'doc-x', newParentId: 'upload-mirror' });
  });

  it('makes zero "expected error" Graph calls — no path probes, no folder-create conflicts', async () => {
    const { stub } = makeGraphStub({
      rootId: 'root-id',
      children: {
        'root-id': [{ id: 'rec', name: 'Rec', isFolder: true }],
        'rec': [{ id: 'doc-a', name: 'a.docx' }],
      },
    });
    providerMocks.getSharedGraphClient.mockReturnValue(stub);
    mockBinaryFetch();

    await new OneDriveWordToPdfJob().run();

    // Every graph.get/post/patch result is ok=true. The new design should
    // produce zero non-2xx responses on a happy path. Any 4xx/5xx here would
    // count toward the shared graph provider error rate and risk auto-degrade.
    const allResults = [
      ...stub.get.mock.results.map((r) => r.value),
      ...stub.post.mock.results.map((r) => r.value),
      ...stub.patch.mock.results.map((r) => r.value),
    ];
    const settled = await Promise.all(allResults);
    for (const r of settled) {
      expect(r.ok).toBe(true);
    }
  });

  it('continues processing other files after a per-file failure', async () => {
    const { stub, moved } = makeGraphStub({
      rootId: 'root-id',
      children: {
        'root-id': [{ id: 'recruiter-E', name: 'Recruiter E', isFolder: true }],
        'recruiter-E': [
          { id: 'doc-fail', name: 'broken.docx' },
          { id: 'doc-ok', name: 'ok.docx' },
        ],
      },
    });
    providerMocks.getSharedGraphClient.mockReturnValue(stub);
    let uploadCounter = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.includes('format=pdf') && url.includes('/drive/items/doc-fail/')) {
        return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), text: async () => 'rendition unsupported' } as unknown as Response;
      }
      return {
        ok: true,
        status: method === 'PUT' ? 201 : 200,
        arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
        text: async () => '',
        json: async () => ({ id: `mock-${++uploadCounter}` }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await new OneDriveWordToPdfJob().run();

    expect(moved.some((m) => m.itemId === 'doc-ok')).toBe(true);
    expect(moved.some((m) => m.itemId === 'doc-fail')).toBe(false);
    expect(mocks.recordSyncFailure).toHaveBeenCalledWith(
      'onedrive-word-to-pdf',
      'broken.docx',
      expect.any(Error),
      expect.anything(),
    );
  });

  it('picks up all convertible types (docx, doc, rtf, txt, html, htm, odt, md) and ignores the rest', async () => {
    const { stub, moved } = makeGraphStub({
      rootId: 'root-id',
      children: {
        'root-id': [{ id: 'rec', name: 'Rec', isFolder: true }],
        'rec': [
          // Convertible — should all be processed
          { id: 'f-docx',  name: 'a.docx' },
          { id: 'f-doc',   name: 'b.doc' },
          { id: 'f-rtf',   name: 'c.rtf' },
          { id: 'f-txt',   name: 'd.txt' },
          { id: 'f-html',  name: 'e.html' },
          { id: 'f-htm',   name: 'f.htm' },
          { id: 'f-odt',   name: 'g.odt' },
          { id: 'f-md',    name: 'h.md' },
          // Should be ignored — not text-bearing or shortcuts/lock files
          { id: 'i-jpg',   name: 'photo.jpg' },
          { id: 'i-jpeg',  name: 'photo.jpeg' },
          { id: 'i-png',   name: 'photo.png' },
          { id: 'i-lnk',   name: 'shortcut.lnk' },
          { id: 'i-tmp',   name: '~WRL0001.tmp' },
          { id: 'i-pdf',   name: 'already.pdf' },     // PDFs are downstream's job
          { id: 'i-noext', name: 'mystery' },
        ],
      },
    });
    providerMocks.getSharedGraphClient.mockReturnValue(stub);
    mockBinaryFetch();

    await new OneDriveWordToPdfJob().run();

    const movedIds = new Set(moved.map((m) => m.itemId));
    // All 8 convertible types moved to converted/
    expect(movedIds).toEqual(new Set(['f-docx', 'f-doc', 'f-rtf', 'f-txt', 'f-html', 'f-htm', 'f-odt', 'f-md']));
    // Nothing else touched
    for (const ignored of ['i-jpg', 'i-jpeg', 'i-png', 'i-lnk', 'i-tmp', 'i-pdf', 'i-noext']) {
      expect(movedIds.has(ignored)).toBe(false);
    }
  });

  it('uses RTF-wrap workaround for .txt files (Graph rejects .txt directly)', async () => {
    const { stub, created, moved } = makeGraphStub({
      rootId: 'root-id',
      children: {
        'root-id': [{ id: 'rec', name: 'Rec', isFolder: true }],
        'rec':     [{ id: 'txt-1', name: 'cover.txt' }],
      },
    });
    providerMocks.getSharedGraphClient.mockReturnValue(stub);

    // Track every fetch call so we can verify the RTF-wrap sequence:
    //   1. GET /content (download .txt)
    //   2. PUT /pdfs/.tmp-<uuid>.rtf (upload temp wrapper)
    //   3. GET /content?format=pdf for the temp item (rendition)
    //   4. PUT /pdfs/cover.pdf (final PDF upload)
    // ...and the temp file is deleted via graph.delete (PATCH/DELETE on stub).
    let tempUploadId: string | null = null;
    const fetchCalls: Array<{ url: string; method: string }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      fetchCalls.push({ url, method });
      if (method === 'PUT' && url.includes('.tmp-') && url.endsWith('.rtf:/content')) {
        tempUploadId = `temp-${crypto.randomUUID()}`;
        return {
          ok: true, status: 201,
          arrayBuffer: async () => new ArrayBuffer(0),
          text: async () => '',
          json: async () => ({ id: tempUploadId }),
        } as unknown as Response;
      }
      if (method === 'PUT') {
        return {
          ok: true, status: 201,
          arrayBuffer: async () => new ArrayBuffer(0),
          text: async () => '',
          json: async () => ({ id: 'final-pdf-id' }),
        } as unknown as Response;
      }
      return {
        ok: true, status: 200,
        arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
        text: async () => 'sample text content',
        json: async () => ({}),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await new OneDriveWordToPdfJob().run();

    // pdfs/ folder created (needed before temp upload)
    expect(created.find((c) => c.name === 'pdfs')).toBeDefined();
    // .txt content was downloaded (no ?format=pdf, just /content)
    expect(fetchCalls.some((c) => c.method === 'GET' && c.url.endsWith('/drive/items/txt-1/content'))).toBe(true);
    // Temp .rtf wrapper was uploaded with .tmp- prefix into pdfs/
    const tempPut = fetchCalls.find((c) => c.method === 'PUT' && c.url.includes('.tmp-') && c.url.endsWith('.rtf:/content'));
    expect(tempPut).toBeDefined();
    // PDF rendition was fetched against the TEMP file id (not the original .txt id)
    expect(fetchCalls.some((c) => c.url.includes('format=pdf') && tempUploadId !== null && c.url.includes(`/drive/items/${tempUploadId}/`))).toBe(true);
    // Final PDF uploaded to pdfs/cover.pdf
    expect(fetchCalls.some((c) => c.method === 'PUT' && c.url.endsWith('cover.pdf:/content'))).toBe(true);
    // Temp file was deleted
    expect(stub.delete).toHaveBeenCalledWith(expect.stringContaining(`/drive/items/${tempUploadId}`));
    // Original .txt was moved to converted/
    expect(moved.some((m) => m.itemId === 'txt-1')).toBe(true);
  });

  it('skips oversized files without attempting conversion', async () => {
    const { stub, moved } = makeGraphStub({
      rootId: 'root-id',
      children: {
        'root-id': [{ id: 'recruiter-F', name: 'Recruiter F', isFolder: true }],
        'recruiter-F': [{ id: 'doc-huge', name: 'huge.docx', size: 100 * 1024 * 1024 }],
      },
    });
    providerMocks.getSharedGraphClient.mockReturnValue(stub);
    const { calls } = mockBinaryFetch();

    await new OneDriveWordToPdfJob().run();

    expect(calls.find((c) => c.url.includes('format=pdf'))).toBeUndefined();
    expect(calls.find((c) => c.method === 'PUT')).toBeUndefined();
    expect(moved).toHaveLength(0);
  });
});
