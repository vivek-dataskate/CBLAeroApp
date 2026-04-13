import { NextResponse } from 'next/server';

import { withAuth } from '@/modules/auth';
import { deprecatePrompt, updatePromptStatus, listPromptVersions } from '@/modules/ai/prompt-registry';
import type { PromptStatus } from '@/modules/ai/prompt-registry';

/**
 * GET /api/internal/admin/prompt-registry?name=candidate-extraction
 * List all versions (including deprecated) for a given prompt name.
 */
export const GET = withAuth(async ({ request }) => {
  const name = request.nextUrl.searchParams.get('name');
  if (!name) {
    return NextResponse.json(
      { error: { code: 'invalid_input', message: 'Query parameter "name" is required.' } },
      { status: 400 },
    );
  }

  try {
    const versions = await listPromptVersions(name);
    return NextResponse.json({ data: { versions } });
  } catch (err) {
    console.error('[admin/prompt-registry] Failed to list versions:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: 'database_error', message: 'Failed to load prompt versions.' } },
      { status: 500 },
    );
  }
}, { action: 'admin:read-prompt-registry' });

const VALID_STATUSES: PromptStatus[] = ['active', 'staged', 'deprecated'];

/**
 * POST /api/internal/admin/prompt-registry
 * Body: { name, version, status } — update prompt status (deprecate, promote, stage)
 */
export const POST = withAuth(async ({ request }) => {
  let body: { name?: string; version?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_input', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const { name, version, status } = body;

  if (!name || !version || !status) {
    return NextResponse.json(
      { error: { code: 'invalid_input', message: 'Fields "name", "version", and "status" are required.' } },
      { status: 400 },
    );
  }

  if (!VALID_STATUSES.includes(status as PromptStatus)) {
    return NextResponse.json(
      { error: { code: 'invalid_input', message: `Status must be one of: ${VALID_STATUSES.join(', ')}` } },
      { status: 400 },
    );
  }

  try {
    const result = status === 'deprecated'
      ? await deprecatePrompt(name, version)
      : await updatePromptStatus(name, version, status as PromptStatus);

    if (!result.success) {
      return NextResponse.json(
        { error: { code: 'update_failed', message: result.error ?? 'Failed to update prompt status.' } },
        { status: 500 },
      );
    }

    return NextResponse.json({
      data: { name, version, status, updated: true },
    });
  } catch (err) {
    console.error('[admin/prompt-registry] Failed to update status:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: 'database_error', message: 'Failed to update prompt status.' } },
      { status: 500 },
    );
  }
}, { action: 'admin:manage-prompt-registry' });
