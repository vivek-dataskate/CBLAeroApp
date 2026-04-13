import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { SESSION_COOKIE_NAME, issueSessionToken } from '@/modules/auth';
import { clearAuthorizationDenyEventsForTest, listAuthorizationDenyEvents } from '@/modules/audit';
import { clearAdminGovernanceStoreForTest } from '@/modules/admin';
import { seedUsageLogForTest, clearUsageLogForTest } from '@/modules/ai/usage-repository';

import { GET } from '../route';

function buildRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(url, init);
}

function withSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

const BASE_URL = 'https://aerodelivery.onrender.com';

async function buildAdminRequest(url: string) {
  const issued = await issueSessionToken({
    actorId: 'actor-admin-1',
    email: 'admin@cblsolutions.com',
    tenantId: 'tenant-alpha',
    role: 'admin',
    rememberDevice: false,
  });
  return buildRequest(url, {
    headers: { cookie: withSessionCookie(issued.token) },
  });
}

describe('GET /api/internal/admin/ai-usage', () => {
  beforeEach(async () => {
    clearUsageLogForTest();
    await clearAuthorizationDenyEventsForTest();
    await clearAdminGovernanceStoreForTest();
  });

  it('returns 401 for unauthenticated requests', async () => {
    const request = buildRequest(`${BASE_URL}/api/internal/admin/ai-usage`);
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('unauthenticated');

    const events = await listAuthorizationDenyEvents();
    expect(events).toHaveLength(1);
  });

  it('returns 403 for non-admin roles', async () => {
    const issued = await issueSessionToken({
      actorId: 'actor-recruiter-1',
      email: 'recruiter@cblsolutions.com',
      tenantId: 'tenant-alpha',
      role: 'recruiter',
      rememberDevice: false,
    });

    const request = buildRequest(`${BASE_URL}/api/internal/admin/ai-usage`, {
      headers: { cookie: withSessionCookie(issued.token) },
    });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('forbidden');
  });

  it('returns empty usage when no records exist', async () => {
    const request = await buildAdminRequest(`${BASE_URL}/api/internal/admin/ai-usage`);
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.daily).toEqual([]);
    expect(body.data.totals).toEqual({
      callCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    });
    expect(body.data.budget).toBeDefined();
    expect(body.data.budget.exceeded).toBe(false);
  });

  it('returns aggregated usage grouped by day, model, and prompt name', async () => {
    const today = new Date().toISOString().slice(0, 10);
    seedUsageLogForTest({
      model: 'claude-haiku-4-5-20251001',
      prompt_name: 'candidate-extraction',
      prompt_version: '1.0.0',
      module: 'extraction',
      action: 'extract',
      input_tokens: 500,
      output_tokens: 200,
      duration_ms: 1000,
      estimated_cost_usd: 0.001,
      created_at: `${today}T10:00:00.000Z`,
    });
    seedUsageLogForTest({
      model: 'claude-haiku-4-5-20251001',
      prompt_name: 'candidate-extraction',
      prompt_version: '1.0.0',
      module: 'extraction',
      action: 'extract',
      input_tokens: 600,
      output_tokens: 300,
      duration_ms: 1200,
      estimated_cost_usd: 0.0015,
      created_at: `${today}T11:00:00.000Z`,
    });
    seedUsageLogForTest({
      model: 'claude-sonnet-4-6',
      prompt_name: 'classification',
      prompt_version: '1.0.0',
      module: 'classify',
      action: 'classify',
      input_tokens: 1000,
      output_tokens: 100,
      duration_ms: 2000,
      estimated_cost_usd: 0.0045,
      created_at: `${today}T12:00:00.000Z`,
    });

    const request = await buildAdminRequest(`${BASE_URL}/api/internal/admin/ai-usage?days=1`);
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.daily).toHaveLength(2); // 2 groups: haiku+extraction, sonnet+classification
    expect(body.data.totals.callCount).toBe(3);
    expect(body.data.totals.inputTokens).toBe(2100);
    expect(body.data.totals.outputTokens).toBe(600);

    // Check first group (haiku) aggregated correctly
    const haikuGroup = body.data.daily.find(
      (r: { model: string }) => r.model === 'claude-haiku-4-5-20251001'
    );
    expect(haikuGroup).toBeDefined();
    expect(haikuGroup.callCount).toBe(2);
    expect(haikuGroup.inputTokens).toBe(1100);
    expect(haikuGroup.outputTokens).toBe(500);
  });

  it('filters by model query param', async () => {
    const today = new Date().toISOString().slice(0, 10);
    seedUsageLogForTest({
      model: 'claude-haiku-4-5-20251001',
      prompt_name: 'extraction',
      prompt_version: '1.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 100,
      output_tokens: 50,
      duration_ms: 500,
      estimated_cost_usd: 0.001,
      created_at: `${today}T10:00:00.000Z`,
    });
    seedUsageLogForTest({
      model: 'claude-sonnet-4-6',
      prompt_name: 'classify',
      prompt_version: '1.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 200,
      output_tokens: 100,
      duration_ms: 1000,
      estimated_cost_usd: 0.002,
      created_at: `${today}T11:00:00.000Z`,
    });

    const request = await buildAdminRequest(
      `${BASE_URL}/api/internal/admin/ai-usage?days=1&model=claude-haiku-4-5-20251001`
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.daily).toHaveLength(1);
    expect(body.data.daily[0].model).toBe('claude-haiku-4-5-20251001');
    expect(body.data.totals.callCount).toBe(1);
  });

  it('filters by promptName query param', async () => {
    const today = new Date().toISOString().slice(0, 10);
    seedUsageLogForTest({
      model: 'claude-haiku-4-5-20251001',
      prompt_name: 'candidate-extraction',
      prompt_version: '1.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 100,
      output_tokens: 50,
      duration_ms: 500,
      estimated_cost_usd: 0.001,
      created_at: `${today}T10:00:00.000Z`,
    });
    seedUsageLogForTest({
      model: 'claude-haiku-4-5-20251001',
      prompt_name: 'classification',
      prompt_version: '1.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 200,
      output_tokens: 100,
      duration_ms: 1000,
      estimated_cost_usd: 0.002,
      created_at: `${today}T11:00:00.000Z`,
    });

    const request = await buildAdminRequest(
      `${BASE_URL}/api/internal/admin/ai-usage?days=1&promptName=candidate-extraction`
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.daily).toHaveLength(1);
    expect(body.data.daily[0].promptName).toBe('candidate-extraction');
    expect(body.data.totals.callCount).toBe(1);
  });

  it('excludes records older than the requested days window', async () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    const oldDateStr = oldDate.toISOString().slice(0, 10);

    seedUsageLogForTest({
      model: 'claude-haiku-4-5-20251001',
      prompt_name: 'test',
      prompt_version: '1.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 100,
      output_tokens: 50,
      duration_ms: 500,
      estimated_cost_usd: 0.001,
      created_at: `${oldDateStr}T10:00:00.000Z`,
    });

    const request = await buildAdminRequest(`${BASE_URL}/api/internal/admin/ai-usage?days=7`);
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.daily).toHaveLength(0);
    expect(body.data.totals.callCount).toBe(0);
  });
});
