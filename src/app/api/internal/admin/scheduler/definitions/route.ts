import { NextResponse } from 'next/server';
import { withAuth } from '@/modules/auth';
import { getSupabaseAdminClient, isSupabaseConfigured } from '@/modules/persistence';

export type ScheduleDefinitionSummary = {
  id: number;
  job_key: string;
  name: string;
  cron_expression: string;
  interval_minutes: number | null;
  enabled: boolean;
  next_run_at: string;
  last_claimed_at: string | null;
  last_run: {
    status: string;
    started_at: string | null;
    completed_at: string | null;
    error_message: string | null;
  } | null;
};

export const GET = withAuth(async ({ session }) => {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ data: [] });
  }

  const tenantId = session.tenantId;
  const db = getSupabaseAdminClient();

  try {
    // Fetch all schedule definitions for this tenant
    const { data: definitions, error: defsError } = await db
      .from('schedule_definitions')
      .select('id, job_key, name, cron_expression, interval_minutes, enabled, next_run_at, last_claimed_at')
      .eq('tenant_id', tenantId)
      .order('job_key', { ascending: true });

    if (defsError) {
      console.error('[admin/scheduler/definitions] Failed to list definitions:', defsError.message);
      return NextResponse.json(
        { error: { code: 'database_error', message: 'Failed to load schedule definitions.' } },
        { status: 500 },
      );
    }

    if (!definitions || definitions.length === 0) {
      return NextResponse.json({ data: [] });
    }

    // Fetch latest schedule_run per definition
    const definitionIds = definitions.map((d) => d.id);

    // P1: cap rows — with order(requested_at desc) the first hit per definition_id is the most recent run
    const { data: latestRuns, error: runsError } = await db
      .from('schedule_runs')
      .select('schedule_definition_id, status, started_at, completed_at, error_message, requested_at')
      .in('schedule_definition_id', definitionIds)
      .order('requested_at', { ascending: false })
      .limit(Math.min(definitionIds.length * 20, 200));

    if (runsError) {
      console.warn('[admin/scheduler/definitions] Failed to load run history, continuing without it:', runsError.message);
    }

    // Build a map: definition_id → latest run
    const latestRunByDefinitionId = new Map<number, typeof latestRuns extends (infer T)[] | null ? T : never>();
    for (const run of latestRuns ?? []) {
      if (!latestRunByDefinitionId.has(run.schedule_definition_id)) {
        latestRunByDefinitionId.set(run.schedule_definition_id, run);
      }
    }

    const data: ScheduleDefinitionSummary[] = definitions.map((def) => {
      const latestRun = latestRunByDefinitionId.get(def.id) ?? null;
      return {
        id: def.id,
        job_key: def.job_key,
        name: def.name,
        cron_expression: def.cron_expression,
        interval_minutes: def.interval_minutes ?? null,
        enabled: def.enabled,
        next_run_at: def.next_run_at,
        last_claimed_at: def.last_claimed_at,
        last_run: latestRun
          ? {
              status: latestRun.status,
              started_at: latestRun.started_at,
              completed_at: latestRun.completed_at,
              error_message: latestRun.error_message,
            }
          : null,
      };
    });

    return NextResponse.json({ data });
  } catch (err) {
    console.error('[admin/scheduler/definitions] Unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Unexpected error loading schedule definitions.' } },
      { status: 500 },
    );
  }
}, { action: 'admin:view-scheduler' });
