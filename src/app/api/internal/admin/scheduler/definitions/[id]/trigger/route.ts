import { NextResponse } from 'next/server';
import { withAuth } from '@/modules/auth';
import { getSupabaseAdminClient, isSupabaseConfigured } from '@/modules/persistence';
import { GlobalScheduler } from '@/modules/ingestion/scheduler';
import { registerIngestionJobs } from '@/modules/ingestion/jobs';

export const POST = withAuth(async ({ session, params }) => {
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

  const db = getSupabaseAdminClient();
  const tenantId = session.tenantId;

  // Verify ownership
  const { data: definition, error: fetchError } = await db
    .from('schedule_definitions')
    .select('id, tenant_id, job_key, cron_expression, enabled')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    console.error('[admin/scheduler/trigger] Fetch error:', fetchError.message);
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

  // Backdate next_run_at and clear last_claimed_at so claim_due_schedules picks it up immediately
  const backdatedAt = new Date(Date.now() - 2000).toISOString(); // 2 seconds in the past
  const { error: updateError } = await db
    .from('schedule_definitions')
    .update({ next_run_at: backdatedAt, last_claimed_at: null, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (updateError) {
    console.error('[admin/scheduler/trigger] Failed to backdate definition:', updateError.message);
    return NextResponse.json(
      { error: { code: 'database_error', message: 'Failed to prepare schedule for immediate execution.' } },
      { status: 500 },
    );
  }

  // Run scheduler in-process — same as the machine-auth jobs route
  const start = Date.now();
  const scheduler = new GlobalScheduler();
  registerIngestionJobs(scheduler);

  const scheduleResult = await scheduler.runDueJobs();
  // DN2: scope processOutbox to only the outbox event created for this specific definition's run
  const triggeredOutcome = scheduleResult.outcomes.find((o) => o.scheduleDefinitionId === id);
  const workerResult = await scheduler.processOutbox(
    triggeredOutcome?.runId ? { scheduleRunId: triggeredOutcome.runId } : undefined,
  );

  console.log(JSON.stringify({
    event: 'admin_scheduler_trigger',
    actor_id: session.actorId,
    definition_id: id,
    job_key: definition.job_key,
    tenant_id: tenantId,
    duration_ms: Date.now() - start,
  }));

  return NextResponse.json({
    status: 'ok',
    job_key: definition.job_key,
    duration_ms: Date.now() - start,
    scheduler_outcomes: scheduleResult.outcomes,
    worker_outcomes: workerResult.outcomes,
  });
}, { action: 'admin:manage-scheduler' });
