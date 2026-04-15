import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/modules/auth';
import { getSupabaseAdminClient, isSupabaseConfigured } from '@/modules/persistence';
import { calculateNextRunAt, createPolicyVersionForCronChange } from '@/modules/ingestion/scheduler';

// Map from policy-registry keys used in jobs.ts (policyKey) to policyFamily
// This allows the PATCH route to create versioned policy entries when cron changes.
// Keyed by job_key → { policyFamily, policyKey }
const JOB_POLICY_MAP: Record<string, { policyFamily: string; policyKey: string }> = {
  'ceipal-sync':          { policyFamily: 'ingestion_schedules', policyKey: 'ceipal_sync' },
  'email-sync':           { policyFamily: 'ingestion_schedules', policyKey: 'email_sync' },
  'onedrive-sync':        { policyFamily: 'ingestion_schedules', policyKey: 'onedrive_sync' },
  'saved-search-digest':  { policyFamily: 'ingestion_schedules', policyKey: 'saved_search_digest' },
  'dedup':                { policyFamily: 'ingestion_schedules', policyKey: 'dedup' },
  'role-enrichment':      { policyFamily: 'ingestion_schedules', policyKey: 'role_enrichment' },
  'availability-refresh': { policyFamily: 'refresh_cadences',    policyKey: 'candidate_availability' },
};

type PatchBody = {
  cron_expression?: string;
  enabled?: boolean;
  next_run_at?: string;
};

export const PATCH = withAuth(async ({ session, request, params }) => {
  const { id: rawId } = await (params as unknown as Promise<{ id: string }>);
  const id = Number(rawId);

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json(
      { error: { code: 'INVALID_ID', message: 'Schedule definition ID must be a positive integer.' } },
      { status: 400 },
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: { code: 'service_unavailable', message: 'Database not configured.' } },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null) as PatchBody | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: { code: 'INVALID_BODY', message: 'Request body must be a JSON object.' } },
      { status: 400 },
    );
  }

  const { cron_expression, enabled, next_run_at } = body;

  // At least one field required
  if (cron_expression === undefined && enabled === undefined && next_run_at === undefined) {
    return NextResponse.json(
      { error: { code: 'MISSING_FIELDS', message: 'At least one of cron_expression, enabled, next_run_at is required.' } },
      { status: 400 },
    );
  }

  // P3: disallow combining cron_expression and next_run_at — the cron-derived value would be silently overwritten
  if (cron_expression !== undefined && next_run_at !== undefined) {
    return NextResponse.json(
      { error: { code: 'CONFLICTING_FIELDS', message: 'Provide only one of cron_expression or next_run_at, not both.' } },
      { status: 400 },
    );
  }

  const db = getSupabaseAdminClient();
  const tenantId = session.tenantId;

  // Verify ownership — reject 403 if definition belongs to a different tenant
  const { data: definition, error: fetchError } = await db
    .from('schedule_definitions')
    .select('id, tenant_id, job_key, cron_expression, enabled')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    console.error('[admin/scheduler/definitions/[id]] Fetch error:', fetchError.message);
    return NextResponse.json(
      { error: { code: 'database_error', message: 'Failed to fetch schedule definition.' } },
      { status: 500 },
    );
  }

  if (!definition) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Schedule definition not found.' } },
      { status: 404 },
    );
  }

  if (definition.tenant_id !== tenantId) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Access denied to this schedule definition.' } },
      { status: 403 },
    );
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  // Validate and apply cron_expression change
  if (cron_expression !== undefined) {
    if (typeof cron_expression !== 'string' || cron_expression.trim() === '') {
      return NextResponse.json(
        { error: { code: 'INVALID_CRON', message: 'cron_expression must be a non-empty string.' } },
        { status: 400 },
      );
    }

    let nextRunAt: string;
    try {
      nextRunAt = calculateNextRunAt(cron_expression.trim());
    } catch {
      return NextResponse.json(
        { error: { code: 'INVALID_CRON', message: 'Invalid cron expression. Use 5-part UTC cron (e.g. "0 2 * * *").' } },
        { status: 400 },
      );
    }

    updates.cron_expression = cron_expression.trim();
    updates.next_run_at = nextRunAt;

    // Create a new policy version for this cron change (AC 2)
    // P4: wrap in try/catch so a policy-version failure doesn't silently skip the cron update
    const policyEntry = JOB_POLICY_MAP[definition.job_key];
    if (policyEntry) {
      const actorId = `admin:${session.actorId}`;
      try {
        const newVersionId = await createPolicyVersionForCronChange(
          policyEntry.policyFamily,
          policyEntry.policyKey,
          cron_expression.trim(),
          actorId,
        );
        if (newVersionId) {
          updates.policy_version_id = newVersionId;
        }
      } catch (policyErr) {
        console.error('[admin/scheduler/definitions/[id]] Failed to create policy version:', policyErr instanceof Error ? policyErr.message : policyErr);
        return NextResponse.json(
          { error: { code: 'policy_version_error', message: 'Failed to create policy version for cron change.' } },
          { status: 500 },
        );
      }
    }
  }

  // Validate and apply enabled toggle
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: { code: 'INVALID_ENABLED', message: 'enabled must be a boolean.' } },
        { status: 400 },
      );
    }
    updates.enabled = enabled;
  }

  // Validate and apply next_run_at override
  if (next_run_at !== undefined) {
    if (typeof next_run_at !== 'string' || isNaN(Date.parse(next_run_at))) {
      return NextResponse.json(
        { error: { code: 'INVALID_NEXT_RUN_AT', message: 'next_run_at must be a valid ISO 8601 datetime string.' } },
        { status: 400 },
      );
    }
    updates.next_run_at = new Date(next_run_at).toISOString();
  }

  // P2: include tenant_id in the update filter to prevent cross-tenant TOCTOU race
  const { data: updated, error: updateError } = await db
    .from('schedule_definitions')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('*')
    .single();

  if (updateError || !updated) {
    console.error('[admin/scheduler/definitions/[id]] Update error:', updateError?.message);
    return NextResponse.json(
      { error: { code: 'database_error', message: 'Failed to update schedule definition.' } },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: updated });
}, { action: 'admin:manage-scheduler' });
