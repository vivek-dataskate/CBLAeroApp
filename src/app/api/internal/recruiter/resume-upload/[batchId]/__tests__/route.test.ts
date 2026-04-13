import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { SESSION_COOKIE_NAME, issueSessionToken } from '@/modules/auth';
import { clearAuthorizationDenyEventsForTest, clearImportBatchAccessEventsForTest } from '@/modules/audit';

import { POST } from '../../route';
import { GET } from '../route';
import { POST as CONFIRM } from '../confirm/route';
import { clearResumeUploadStoreForTest } from '../../shared';
import { _setPdfParseForTest } from '@/features/candidate-management/application/candidate-extraction';
import { clearImportBatchStoreForTest } from '@/features/candidate-management/infrastructure/import-batch-repository';
import { clearSubmissionStoreForTest } from '@/features/candidate-management/infrastructure/submission-repository';
import { clearFingerprintsForTest } from '@/features/candidate-management/infrastructure/fingerprint-repository';

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

const mockPdfParse = vi.fn().mockResolvedValue({ text: 'Jane Smith\njane@test.com' });

const BASE_URL = 'https://aerodelivery.onrender.com';

function withSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

async function uploadResume(token: string) {
  const formData = new FormData();
  formData.append('file', new File(['fake pdf'], 'resume.pdf', { type: 'application/pdf' }));
  const request = new NextRequest(`${BASE_URL}/api/internal/recruiter/resume-upload`, {
    method: 'POST',
    headers: { cookie: withSessionCookie(token) },
    body: formData,
  });
  const response = await POST(request);
  const body = await response.json();
  return body.data as { batchId: string; files: Array<{ submissionId: string; filename: string; status: string }> };
}

describe('GET /api/internal/recruiter/resume-upload/[batchId]', () => {
  beforeEach(() => {
    clearResumeUploadStoreForTest();
    clearImportBatchStoreForTest();
    clearSubmissionStoreForTest();
    clearFingerprintsForTest();
    clearAuthorizationDenyEventsForTest();
    clearImportBatchAccessEventsForTest();
    _setPdfParseForTest(mockPdfParse);
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it('returns 401 without session', async () => {
    const request = new NextRequest(`${BASE_URL}/api/internal/recruiter/resume-upload/some-batch-id`, { method: 'GET' });
    const response = await GET(request, { params: Promise.resolve({ batchId: 'some-batch-id' }) });
    expect(response.status).toBe(401);
  });

  it('returns 404 for non-existent batch', async () => {
    const { token } = await issueSessionToken({ actorId: 'recruiter-1', email: 'rec@test.com', role: 'recruiter', tenantId: 'cbl-aero', rememberDevice: false });
    const request = new NextRequest(`${BASE_URL}/api/internal/recruiter/resume-upload/nonexistent`, { method: 'GET', headers: { cookie: withSessionCookie(token) } });
    const response = await GET(request, { params: Promise.resolve({ batchId: 'nonexistent' }) });
    expect(response.status).toBe(404);
  });

  it('returns batch status after upload', async () => {
    const { token } = await issueSessionToken({ actorId: 'recruiter-1', email: 'rec@test.com', role: 'recruiter', tenantId: 'cbl-aero', rememberDevice: false });
    const uploadData = await uploadResume(token);
    const request = new NextRequest(`${BASE_URL}/api/internal/recruiter/resume-upload/${uploadData.batchId}`, { method: 'GET', headers: { cookie: withSessionCookie(token) } });
    const response = await GET(request, { params: Promise.resolve({ batchId: uploadData.batchId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.batchId).toBe(uploadData.batchId);
    expect(body.data.totalFiles).toBe(1);
    expect(body.data.complete).toBe(1);
  });

  it('enforces tenant isolation', async () => {
    const { token: token1 } = await issueSessionToken({ actorId: 'recruiter-1', email: 'rec@test.com', role: 'recruiter', tenantId: 'cbl-aero', rememberDevice: false });
    const { token: token2 } = await issueSessionToken({ actorId: 'recruiter-2', email: 'rec2@test.com', role: 'recruiter', tenantId: 'other-tenant', rememberDevice: false });
    const uploadData = await uploadResume(token1);
    const request = new NextRequest(`${BASE_URL}/api/internal/recruiter/resume-upload/${uploadData.batchId}`, { method: 'GET', headers: { cookie: withSessionCookie(token2) } });
    const response = await GET(request, { params: Promise.resolve({ batchId: uploadData.batchId }) });
    expect(response.status).toBe(404);
  });
});

describe('POST /api/internal/recruiter/resume-upload/[batchId]/confirm', () => {
  beforeEach(() => {
    clearResumeUploadStoreForTest();
    clearImportBatchStoreForTest();
    clearSubmissionStoreForTest();
    clearFingerprintsForTest();
    clearAuthorizationDenyEventsForTest();
    clearImportBatchAccessEventsForTest();
    _setPdfParseForTest(mockPdfParse);
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it('returns 401 without session', async () => {
    const request = new NextRequest(`${BASE_URL}/api/internal/recruiter/resume-upload/some-batch/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: [], rejected: [] }),
    });
    const response = await CONFIRM(request, { params: Promise.resolve({ batchId: 'some-batch' }) });
    expect(response.status).toBe(401);
  });

  it('returns 400 for invalid body', async () => {
    const { token } = await issueSessionToken({ actorId: 'recruiter-1', email: 'rec@test.com', role: 'recruiter', tenantId: 'cbl-aero', rememberDevice: false });
    const request = new NextRequest(`${BASE_URL}/api/internal/recruiter/resume-upload/some-batch/confirm`, {
      method: 'POST',
      headers: { cookie: withSessionCookie(token), 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: 'not-array', rejected: [] }),
    });
    const response = await CONFIRM(request, { params: Promise.resolve({ batchId: 'some-batch' }) });
    expect(response.status).toBe(400);
  });

  it('confirms candidates and finalizes batch', async () => {
    const { token } = await issueSessionToken({ actorId: 'recruiter-1', email: 'rec@test.com', role: 'recruiter', tenantId: 'cbl-aero', rememberDevice: false });
    const uploadData = await uploadResume(token);
    const submissionId = uploadData.files[0].submissionId;
    const request = new NextRequest(`${BASE_URL}/api/internal/recruiter/resume-upload/${uploadData.batchId}/confirm`, {
      method: 'POST',
      headers: { cookie: withSessionCookie(token), 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: [{ submissionId }], rejected: [] }),
    });
    const response = await CONFIRM(request, { params: Promise.resolve({ batchId: uploadData.batchId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe('complete');
    expect(body.data.imported).toBe(1);
    expect(body.data.skipped).toBe(0);
  });

  it('confirms with edits applied to candidate data', async () => {
    const { token } = await issueSessionToken({ actorId: 'recruiter-1', email: 'rec@test.com', role: 'recruiter', tenantId: 'cbl-aero', rememberDevice: false });
    const uploadData = await uploadResume(token);
    const submissionId = uploadData.files[0].submissionId;
    const request = new NextRequest(`${BASE_URL}/api/internal/recruiter/resume-upload/${uploadData.batchId}/confirm`, {
      method: 'POST',
      headers: { cookie: withSessionCookie(token), 'content-type': 'application/json' },
      body: JSON.stringify({
        confirmed: [{ submissionId, edits: { firstName: 'EditedName', skills: ['Edited Skill'] } }],
        rejected: [],
      }),
    });
    const response = await CONFIRM(request, { params: Promise.resolve({ batchId: uploadData.batchId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.imported).toBe(1);
  });

  it('handles rejections correctly', async () => {
    const { token } = await issueSessionToken({ actorId: 'recruiter-1', email: 'rec@test.com', role: 'recruiter', tenantId: 'cbl-aero', rememberDevice: false });
    const uploadData = await uploadResume(token);
    const submissionId = uploadData.files[0].submissionId;
    const request = new NextRequest(`${BASE_URL}/api/internal/recruiter/resume-upload/${uploadData.batchId}/confirm`, {
      method: 'POST',
      headers: { cookie: withSessionCookie(token), 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: [], rejected: [submissionId] }),
    });
    const response = await CONFIRM(request, { params: Promise.resolve({ batchId: uploadData.batchId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.imported).toBe(0);
    expect(body.data.skipped).toBe(1);
  });

  it('returns 409 when batch is already confirmed (double-confirm guard)', async () => {
    const { token } = await issueSessionToken({ actorId: 'recruiter-1', email: 'rec@test.com', role: 'recruiter', tenantId: 'cbl-aero', rememberDevice: false });
    const uploadData = await uploadResume(token);
    const submissionId = uploadData.files[0].submissionId;

    // First confirm — should succeed
    const firstRequest = new NextRequest(`${BASE_URL}/api/internal/recruiter/resume-upload/${uploadData.batchId}/confirm`, {
      method: 'POST',
      headers: { cookie: withSessionCookie(token), 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: [{ submissionId }], rejected: [] }),
    });
    const firstResponse = await CONFIRM(firstRequest, { params: Promise.resolve({ batchId: uploadData.batchId }) });
    expect(firstResponse.status).toBe(200);

    // Second confirm — should be rejected
    const secondRequest = new NextRequest(`${BASE_URL}/api/internal/recruiter/resume-upload/${uploadData.batchId}/confirm`, {
      method: 'POST',
      headers: { cookie: withSessionCookie(token), 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: [{ submissionId }], rejected: [] }),
    });
    const secondResponse = await CONFIRM(secondRequest, { params: Promise.resolve({ batchId: uploadData.batchId }) });
    expect(secondResponse.status).toBe(409);
    const body = await secondResponse.json();
    expect(body.error.code).toBe('already_confirmed');
  });
});
