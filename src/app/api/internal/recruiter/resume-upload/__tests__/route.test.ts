import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { SESSION_COOKIE_NAME, issueSessionToken } from '@/modules/auth';
import {
  clearAuthorizationDenyEventsForTest,
  clearImportBatchAccessEventsForTest,
} from '@/modules/audit';

import { POST } from '../route';
import { clearResumeUploadStoreForTest } from '../shared';
import { _setPdfParseForTest } from '@/features/candidate-management/application/candidate-extraction';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ isSubmission: true, firstName: 'Jane', lastName: 'Smith', email: 'jane@test.com', skills: ['A&P'] }) }],
        usage: { input_tokens: 50, output_tokens: 20 },
      }),
    },
  })),
}));

const mockPdfParse = vi.fn().mockResolvedValue({ text: 'Jane Smith\njane@test.com\nA&P Mechanic' });

const BASE_URL = 'https://aerodelivery.onrender.com';

function withSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

async function buildResumeUploadRequest(input: {
  token?: string;
  files?: Array<{ name: string; content: string; type?: string }>;
}): Promise<NextRequest> {
  const formData = new FormData();
  for (const f of input.files ?? []) {
    const file = new File([f.content], f.name, { type: f.type ?? 'application/pdf' });
    formData.append('file', file);
  }
  const headers = new Headers();
  if (input.token) headers.set('cookie', withSessionCookie(input.token));
  return new NextRequest(`${BASE_URL}/api/internal/recruiter/resume-upload`, { method: 'POST', headers, body: formData });
}

describe('POST /api/internal/recruiter/resume-upload', () => {
  beforeEach(() => {
    clearResumeUploadStoreForTest();
    clearAuthorizationDenyEventsForTest();
    clearImportBatchAccessEventsForTest();
    _setPdfParseForTest(mockPdfParse);
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it('returns 401 when no session cookie is provided', async () => {
    const request = await buildResumeUploadRequest({ files: [{ name: 'resume.pdf', content: 'fake pdf' }] });
    const response = await POST(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe('unauthenticated');
  });

  it('returns 403 when user lacks recruiter role', async () => {
    const { token } = await issueSessionToken({ actorId: 'viewer-1', email: 'viewer@test.com', role: 'compliance-officer', tenantId: 'cbl-aero', rememberDevice: false });
    const request = await buildResumeUploadRequest({ token, files: [{ name: 'resume.pdf', content: 'fake pdf' }] });
    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it('returns 400 when no files provided', async () => {
    const { token } = await issueSessionToken({ actorId: 'recruiter-1', email: 'rec@test.com', role: 'recruiter', tenantId: 'cbl-aero', rememberDevice: false });
    const request = await buildResumeUploadRequest({ token, files: [] });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('missing_file');
  });

  it('returns 422 when non-PDF files are uploaded', async () => {
    const { token } = await issueSessionToken({ actorId: 'recruiter-1', email: 'rec@test.com', role: 'recruiter', tenantId: 'cbl-aero', rememberDevice: false });
    const request = await buildResumeUploadRequest({ token, files: [{ name: 'resume.docx', content: 'word doc', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }] });
    const response = await POST(request);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe('invalid_file_type');
    expect(body.error.message).toContain('Only PDF files are supported');
  });

  it('successfully processes a valid PDF upload', async () => {
    const { token } = await issueSessionToken({ actorId: 'recruiter-1', email: 'rec@test.com', role: 'recruiter', tenantId: 'cbl-aero', rememberDevice: false });
    const request = await buildResumeUploadRequest({ token, files: [{ name: 'resume.pdf', content: 'fake pdf content' }] });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.batchId).toBeDefined();
    expect(body.data.files).toHaveLength(1);
    expect(body.data.files[0].filename).toBe('resume.pdf');
    expect(body.data.files[0].status).toBe('complete');
    expect(body.data.files[0].extraction.firstName).toBe('Jane');
  });

  it('processes multiple PDF files in a batch', async () => {
    const { token } = await issueSessionToken({ actorId: 'recruiter-1', email: 'rec@test.com', role: 'recruiter', tenantId: 'cbl-aero', rememberDevice: false });
    const request = await buildResumeUploadRequest({ token, files: [{ name: 'r1.pdf', content: 'pdf 1' }, { name: 'r2.pdf', content: 'pdf 2' }, { name: 'r3.pdf', content: 'pdf 3' }] });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.files).toHaveLength(3);
    expect(body.data.files.every((f: { status: string }) => f.status === 'complete')).toBe(true);
  });

  it('admin role can upload resumes', async () => {
    const { token } = await issueSessionToken({ actorId: 'admin-1', email: 'admin@test.com', role: 'admin', tenantId: 'cbl-aero', rememberDevice: false });
    const request = await buildResumeUploadRequest({ token, files: [{ name: 'resume.pdf', content: 'fake pdf' }] });
    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it('delivery-head role can upload resumes', async () => {
    const { token } = await issueSessionToken({ actorId: 'dh-1', email: 'dh@test.com', role: 'delivery-head', tenantId: 'cbl-aero', rememberDevice: false });
    const request = await buildResumeUploadRequest({ token, files: [{ name: 'resume.pdf', content: 'fake pdf' }] });
    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it('handles scanned-image PDFs via vision OCR fallback (AC 8)', async () => {
    mockPdfParse.mockResolvedValueOnce({ text: '' });

    const { token } = await issueSessionToken({ actorId: 'recruiter-1', email: 'rec@test.com', role: 'recruiter', tenantId: 'cbl-aero', rememberDevice: false });
    const request = await buildResumeUploadRequest({ token, files: [{ name: 'scanned.pdf', content: 'scanned image pdf' }] });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.files).toHaveLength(1);
    // Scanned PDFs now succeed via Claude vision — no longer fail
    expect(body.data.files[0].status).toBe('complete');
    expect(body.data.files[0].extraction).toBeDefined();
  });
});
