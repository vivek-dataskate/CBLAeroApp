import { getSupabaseAdminClient, isSupabaseConfigured } from '@/modules/persistence';
import { DEFAULT_TENANT_ID } from '@/modules/ingestion';
import type { SchedulerJob, SchedulerRegistration } from '@/modules/ingestion/jobs';

export type ScheduleOutcome = {
  jobKey: string;
  scheduleDefinitionId?: number;
  runId?: string;
  status: 'claimed' | 'started' | 'completed' | 'failed' | 'skipped';
  message: string;
  durationMs: number;
};

const SCHEDULE_CLAIM_STALE_MS = 15 * 60 * 1000;

function parseCronField(field: string, min: number, max: number) {
  if (field === '*') {
    return { type: 'any' as const };
  }
  if (field.startsWith('*/')) {
    const step = Number(field.slice(2));
    if (Number.isNaN(step) || step <= 0) {
      throw new Error(`Unsupported cron step field: ${field}`);
    }
    return { type: 'step' as const, step };
  }
  const value = Number(field);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Unsupported cron field value: ${field}`);
  }
  return { type: 'value' as const, value };
}

type CronField = ReturnType<typeof parseCronField>;

function matchesCronField(field: CronField, value: number): boolean {
  if (field.type === 'any') return true;
  if (field.type === 'step') return value % field.step === 0;
  return field.value === value;
}

export function calculateNextRunAt(cronExpression: string, after = new Date()): string {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Unsupported cron expression: ${cronExpression}`);
  }

  const minuteField = parseCronField(parts[0], 0, 59);
  const hourField = parseCronField(parts[1], 0, 23);
  const domField = parseCronField(parts[2], 1, 31);
  const monthField = parseCronField(parts[3], 1, 12);
  const dowField = parseCronField(parts[4], 0, 6);

  // P1: Use UTC setters/getters consistently — local-time setters cause DST/timezone skew
  const candidate = new Date(after);
  candidate.setUTCSeconds(0, 0); // second arg zeros milliseconds too
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  for (let attempt = 0; attempt < 10080; attempt += 1) {
    const minute = candidate.getUTCMinutes();
    const hour = candidate.getUTCHours();
    const dom = candidate.getUTCDate();
    const month = candidate.getUTCMonth() + 1;
    const dow = candidate.getUTCDay();

    if (
      matchesCronField(minuteField, minute) &&
      matchesCronField(hourField, hour) &&
      matchesCronField(domField, dom) &&
      matchesCronField(monthField, month) &&
      matchesCronField(dowField, dow)
    ) {
      return candidate.toISOString();
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  throw new Error(`Could not compute next run for cron expression: ${cronExpression}`);
}

/** P4: Wraps calculateNextRunAt so a cron-parse failure inside a catch block can't re-throw */
function safeCalculateNextRunAt(cronExpression: string, after: Date, jobKey: string): string {
  try {
    return calculateNextRunAt(cronExpression, after);
  } catch (cronErr) {
    console.error(
      `[GlobalScheduler] Could not compute next run for ${jobKey}, falling back to hourly:`,
      cronErr instanceof Error ? cronErr.message : cronErr,
    );
    return calculateNextRunAt('0 * * * *', after);
  }
}

function normalizeTenantId(tenantId?: string): string {
  return tenantId?.trim() || DEFAULT_TENANT_ID;
}

/** NP6: Strip stack trace lines — prevents PII/credentials in stack frames from being persisted to DB */
function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.split('\n')[0].slice(0, 500);
}

export class GlobalScheduler {
  private readonly registeredJobs = new Map<string, { job: SchedulerJob; metadata: SchedulerRegistration }>();

  register(job: SchedulerJob, metadata?: SchedulerRegistration): void {
    if (!metadata) {
      throw new Error('Scheduler registration metadata is required.');
    }
    if (this.registeredJobs.has(metadata.jobKey)) {
      throw new Error(`Duplicate scheduler registration for jobKey=${metadata.jobKey}`);
    }

    this.registeredJobs.set(metadata.jobKey, { job, metadata });
  }

  // DN3: Probe DB connectivity before dispatching to guard against cold-start failures
  private async probeReadiness(): Promise<boolean> {
    const db = getSupabaseAdminClient();
    try {
      const { error } = await db.from('schedule_definitions').select('id').limit(1);
      if (error) {
        console.warn('[GlobalScheduler] Readiness probe failed:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[GlobalScheduler] Readiness probe exception:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  async runDueJobs(): Promise<{ outcomes: ScheduleOutcome[] }> {
    if (!isSupabaseConfigured()) {
      return { outcomes: [] };
    }

    // DN3: Validate server readiness before dispatching — prevents cold-start fetch failures
    const isReady = await this.probeReadiness();
    if (!isReady) {
      console.warn('[GlobalScheduler] Server not ready — skipping job dispatch');
      return { outcomes: [] };
    }

    const db = getSupabaseAdminClient();
    await this.ensureScheduleDefinitions();

    const now = new Date();
    const nowIso = now.toISOString();
    const staleThreshold = new Date(now.getTime() - SCHEDULE_CLAIM_STALE_MS).toISOString();

    // DN1: Atomic claim via FOR UPDATE SKIP LOCKED — prevents duplicate claims across instances
    const { data: claimedDefinitions, error: claimError } = await db.rpc('claim_due_schedules', {
      p_tenant_id: DEFAULT_TENANT_ID,
      p_now: nowIso,
      p_stale_threshold: staleThreshold,
      p_limit: 20,
    });

    if (claimError) {
      console.error('[GlobalScheduler] Failed to claim due schedules:', claimError.message);
      return { outcomes: [] };
    }

    const outcomes: ScheduleOutcome[] = [];

    for (const claimedDefinition of claimedDefinitions ?? []) {
      const outcome: ScheduleOutcome = {
        jobKey: claimedDefinition.job_key,
        scheduleDefinitionId: claimedDefinition.id,
        status: 'claimed',
        message: 'Schedule claimed — queued for execution',
        durationMs: 0,
      };
      outcomes.push(outcome);

      const jobRegistration = this.registeredJobs.get(claimedDefinition.job_key);
      const claimedAt = new Date();

      // DN4: Re-resolve policy version at claim time using live registered metadata
      const claimTimePolicyVersionId = jobRegistration?.metadata.policyFamily && jobRegistration?.metadata.policyKey
        ? await this.resolveCurrentPolicyVersionId(jobRegistration.metadata.policyFamily, jobRegistration.metadata.policyKey)
        : claimedDefinition.policy_version_id ?? null;

      // P8: Insert audit record before queuing; skip if record cannot be created
      const runId = await this.insertScheduleRun(
        claimedDefinition.id,
        claimedDefinition.tenant_id,
        claimTimePolicyVersionId,
        nowIso,
      );
      outcome.runId = runId ?? undefined;

      if (!runId) {
        console.error(`[GlobalScheduler] ${claimedDefinition.job_key}: failed to create schedule_run — skipping`);
        await this.updateScheduleDefinitionNextRun(
          claimedDefinition.id,
          safeCalculateNextRunAt(claimedDefinition.cron_expression, claimedAt, claimedDefinition.job_key),
        );
        outcome.status = 'failed';
        outcome.message = 'Failed to create audit run record';
        continue;
      }

      // DN2/DN7: Write outbox event — payload carries context needed by processOutbox() worker
      // NP3: Outbox is mandatory; skip execution if it cannot be written
      const outboxId = await this.insertOutboxEvent(
        claimedDefinition.job_key,
        claimedDefinition.tenant_id,
        runId,
        { cron_expression: claimedDefinition.cron_expression, schedule_definition_id: claimedDefinition.id },
      );

      if (!outboxId) {
        console.error(`[GlobalScheduler] ${claimedDefinition.job_key}: failed to create outbox event — skipping execution`);
        await this.updateScheduleRunStatus(runId, 'failed', 'Failed to create outbox event', null, new Date().toISOString());
        await this.updateScheduleDefinitionNextRun(
          claimedDefinition.id,
          safeCalculateNextRunAt(claimedDefinition.cron_expression, claimedAt, claimedDefinition.job_key),
        );
        outcome.status = 'failed';
        outcome.message = 'Failed to create outbox event';
        continue;
      }

      // Unregistered job: fail fast and advance next_run_at to prevent starvation (P5)
      if (!jobRegistration) {
        const nextRunAt = safeCalculateNextRunAt(claimedDefinition.cron_expression, claimedAt, claimedDefinition.job_key);
        await this.updateScheduleRunStatus(runId, 'failed', 'No registered job for schedule', null, new Date().toISOString());
        await this.updateOutboxEventStatus(outboxId, 'failed', 'No registered job for schedule');
        await this.updateScheduleDefinitionNextRun(claimedDefinition.id, nextRunAt);
        outcome.status = 'failed';
        outcome.message = 'No registered job for schedule';
        continue;
      }

      // Schedule claimed and outbox queued — actual execution handled by processOutbox() (AC 3)
      outcome.status = 'claimed';
      outcome.message = `Queued (runId=${runId}, outboxId=${outboxId})`;
    }

    return { outcomes };
  }

  // DN7: Event-driven worker — consumes pending outbox events and executes the corresponding jobs.
  // AC 3: Workers are consumers of scheduler-issued outbox events; they do not own timer logic.
  async processOutbox(): Promise<{ outcomes: ScheduleOutcome[] }> {
    if (!isSupabaseConfigured()) {
      return { outcomes: [] };
    }

    const db = getSupabaseAdminClient();
    const nowIso = new Date().toISOString();

    // Atomically claim pending outbox events using FOR UPDATE SKIP LOCKED
    const { data: claimedEvents, error: claimError } = await db.rpc('claim_pending_outbox_events', {
      p_tenant_id: DEFAULT_TENANT_ID,
      p_now: nowIso,
      p_limit: 20,
    });

    if (claimError) {
      console.error('[GlobalScheduler] Failed to claim outbox events:', claimError.message);
      return { outcomes: [] };
    }

    const outcomes: ScheduleOutcome[] = [];

    for (const event of claimedEvents ?? []) {
      const payload = (event.payload ?? {}) as { cron_expression?: string; schedule_definition_id?: number };
      const cronExpression = payload.cron_expression;
      const scheduleDefinitionId = payload.schedule_definition_id;

      const outcome: ScheduleOutcome = {
        jobKey: event.job_key,
        scheduleDefinitionId,
        runId: event.schedule_run_id ?? undefined,
        status: 'started',
        message: 'Processing outbox event',
        durationMs: 0,
      };
      outcomes.push(outcome);

      const jobRegistration = this.registeredJobs.get(event.job_key);

      if (!jobRegistration) {
        const errorMsg = 'No registered job for outbox event';
        await this.updateOutboxEventStatus(event.id, 'failed', errorMsg);
        if (event.schedule_run_id) {
          await this.updateScheduleRunStatus(event.schedule_run_id, 'failed', errorMsg, null, new Date().toISOString());
        }
        if (scheduleDefinitionId && cronExpression) {
          await this.updateScheduleDefinitionNextRun(
            scheduleDefinitionId,
            safeCalculateNextRunAt(cronExpression, new Date(), event.job_key),
          );
        }
        outcome.status = 'failed';
        outcome.message = errorMsg;
        continue;
      }

      const startedAtIso = new Date().toISOString();
      if (event.schedule_run_id) {
        await this.updateScheduleRunStatus(event.schedule_run_id, 'started', undefined, startedAtIso, undefined);
      }

      const startMs = Date.now();
      const executionStartedAt = new Date();
      try {
        await jobRegistration.job.run();
        const durationMs = Date.now() - startMs;
        const effectiveCron = cronExpression ?? jobRegistration.metadata.cronExpression;
        const nextRunAt = safeCalculateNextRunAt(effectiveCron, executionStartedAt, event.job_key);

        await this.updateOutboxEventStatus(event.id, 'completed');
        if (event.schedule_run_id) {
          await this.updateScheduleRunStatus(event.schedule_run_id, 'completed', undefined, undefined, new Date().toISOString(), {
            status: 'ok',
            duration_ms: durationMs,
          });
        }
        if (scheduleDefinitionId) {
          await this.updateScheduleDefinitionNextRun(scheduleDefinitionId, nextRunAt);
        }

        outcome.status = 'completed';
        outcome.message = 'Job completed';
        outcome.durationMs = durationMs;
      } catch (err) {
        const durationMs = Date.now() - startMs;
        const errorMessage = sanitizeErrorMessage(err); // NP6: strip stack traces
        const effectiveCron = cronExpression ?? jobRegistration.metadata.cronExpression;
        // P4: safeCalculateNextRunAt absorbs any secondary cron-parse throw inside this catch
        const nextRunAt = safeCalculateNextRunAt(effectiveCron, executionStartedAt, event.job_key);

        await this.updateOutboxEventStatus(event.id, 'failed', errorMessage);
        if (event.schedule_run_id) {
          await this.updateScheduleRunStatus(event.schedule_run_id, 'failed', errorMessage, undefined, new Date().toISOString(), {
            status: 'failed',
            duration_ms: durationMs,
          });
        }
        if (scheduleDefinitionId) {
          await this.updateScheduleDefinitionNextRun(scheduleDefinitionId, nextRunAt);
        }

        outcome.status = 'failed';
        outcome.message = errorMessage;
        outcome.durationMs = durationMs;
      }
    }

    return { outcomes };
  }

  private async ensureScheduleDefinitions(): Promise<void> {
    const db = getSupabaseAdminClient();
    const nowIso = new Date().toISOString();

    for (const { metadata } of this.registeredJobs.values()) {
      const tenantId = normalizeTenantId(metadata.tenantId);

      // NP1: capture and log fetch errors
      const { data: existing, error: fetchError } = await db
        .from('schedule_definitions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('job_key', metadata.jobKey)
        .maybeSingle();

      if (fetchError) {
        console.error(`[GlobalScheduler] Failed to fetch definition for ${metadata.jobKey}:`, fetchError.message);
        continue;
      }

      const policyVersionId = metadata.policyFamily && metadata.policyKey
        ? await this.resolveCurrentPolicyVersionId(metadata.policyFamily, metadata.policyKey)
        : null;

      if (existing) {
        const updates: Record<string, unknown> = {};
        if (policyVersionId && existing.policy_version_id !== policyVersionId) {
          updates.policy_version_id = policyVersionId;
        }
        // P3: Sync cron_expression and name when code changes — prevents stale schedule in DB
        if (existing.cron_expression !== metadata.cronExpression) {
          // NP2: use safe wrapper to prevent throws crashing the definition update loop
          updates.cron_expression = metadata.cronExpression;
          updates.next_run_at = safeCalculateNextRunAt(metadata.cronExpression, new Date(), metadata.jobKey);

          // DN6: Create a new policy version when cron expression changes — AC 2 compliance
          if (metadata.policyFamily && metadata.policyKey) {
            const newVersionId = await this.createPolicyVersionForCronChange(
              metadata.policyFamily,
              metadata.policyKey,
              metadata.cronExpression,
            );
            if (newVersionId) {
              updates.policy_version_id = newVersionId;
            }
          }
        }
        if (existing.name !== metadata.scheduleName) {
          updates.name = metadata.scheduleName;
        }
        if (Object.keys(updates).length > 0) {
          updates.updated_at = nowIso;
          // NP1: log update errors
          const { error: updateError } = await db.from('schedule_definitions').update(updates).eq('id', existing.id);
          if (updateError) {
            console.error(`[GlobalScheduler] Failed to update definition for ${metadata.jobKey}:`, updateError.message);
          }
        }
        continue;
      }

      // NP2: use safe wrapper so a bad cron expression doesn't crash the entire bootstrap
      const nextRunAt = safeCalculateNextRunAt(metadata.cronExpression, new Date(), metadata.jobKey);

      // NP5: upsert with ignoreDuplicates handles concurrent-insert TOCTOU race
      const { error: insertError } = await db.from('schedule_definitions').upsert({
        tenant_id: tenantId,
        name: metadata.scheduleName,
        job_key: metadata.jobKey,
        cron_expression: metadata.cronExpression,
        policy_version_id: policyVersionId,
        enabled: metadata.enabled !== false,
        next_run_at: nextRunAt,
      }, { onConflict: 'tenant_id,job_key', ignoreDuplicates: true });
      // NP1: log insert errors (unique constraint conflicts are silently ignored by ignoreDuplicates)
      if (insertError) {
        console.error(`[GlobalScheduler] Failed to insert definition for ${metadata.jobKey}:`, insertError.message);
      }
    }
  }

  // DN6: Insert a new policy_versions row when a job's cron expression changes in code — satisfies AC 2
  private async createPolicyVersionForCronChange(
    policyFamily: string,
    policyKey: string,
    newCronExpression: string,
  ): Promise<number | null> {
    const db = getSupabaseAdminClient();

    const { data: registry, error: registryError } = await db
      .from('policy_registry')
      .select('id')
      .eq('family', policyFamily)
      .eq('key', policyKey)
      .limit(1)
      .maybeSingle();

    if (registryError || !registry) {
      if (registryError) console.error('[GlobalScheduler] Failed to find policy registry for version creation:', registryError.message);
      return null;
    }

    const { data: newVersion, error: insertError } = await db
      .from('policy_versions')
      .insert({
        policy_id: registry.id,
        value: { cron_expression: newCronExpression },
        effective_from: new Date().toISOString(),
        created_by_actor_id: 'system:scheduler',
      })
      .select('id')
      .single();

    if (insertError || !newVersion) {
      if (insertError) console.error('[GlobalScheduler] Failed to create policy version for cron change:', insertError.message);
      return null;
    }

    console.log(JSON.stringify({ event: 'policy_version_created', family: policyFamily, key: policyKey, version_id: newVersion.id, new_cron: newCronExpression }));
    return newVersion.id;
  }

  private async resolveCurrentPolicyVersionId(policyFamily: string, policyKey: string): Promise<number | null> {
    const db = getSupabaseAdminClient();
    const { data: registry, error: registryError } = await db
      .from('policy_registry')
      .select('id')
      .eq('family', policyFamily)
      .eq('key', policyKey)
      .limit(1)
      .maybeSingle();

    if (registryError || !registry) {
      if (registryError) {
        console.error('[GlobalScheduler] Failed to resolve policy registry:', registryError.message);
      }
      return null;
    }

    const nowIso = new Date().toISOString();
    const { data: version, error: versionError } = await db
      .from('policy_versions')
      .select('id')
      .eq('policy_id', registry.id)
      .lte('effective_from', nowIso)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (versionError || !version) {
      if (versionError) {
        console.error('[GlobalScheduler] Failed to resolve policy version:', versionError.message);
      }
      return null;
    }

    return version.id;
  }

  private async insertScheduleRun(
    scheduleDefinitionId: number,
    tenantId: string,
    policyVersionId: number | null,
    requestedAt: string,
  ): Promise<string | null> {
    const db = getSupabaseAdminClient();
    try {
      const { data, error } = await db
        .from('schedule_runs')
        .insert({
          schedule_definition_id: scheduleDefinitionId,
          tenant_id: tenantId,
          policy_version_id: policyVersionId,
          requested_at: requestedAt,
          claimed_at: requestedAt,
          status: 'claimed',
          worker_id: 'scheduler',
        })
        .select('id')
        .single();
      if (error || !data) {
        console.error('[GlobalScheduler] Failed to insert schedule run:', error?.message);
        return null;
      }
      return data.id;
    } catch (err) {
      console.error('[GlobalScheduler] Failed to insert schedule run:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  // DN2/DN7: Insert outbox event — payload carries execution context for the processOutbox() worker
  private async insertOutboxEvent(
    jobKey: string,
    tenantId: string,
    scheduleRunId: string | null,
    payload?: Record<string, unknown>,
  ): Promise<string | null> {
    const db = getSupabaseAdminClient();
    try {
      const { data, error } = await db
        .from('outbox_events')
        .insert({ job_key: jobKey, tenant_id: tenantId, schedule_run_id: scheduleRunId, status: 'pending', payload: payload ?? null })
        .select('id')
        .single();
      if (error || !data) {
        console.error('[GlobalScheduler] Failed to insert outbox event:', error?.message);
        return null;
      }
      return data.id;
    } catch (err) {
      console.error('[GlobalScheduler] Failed to insert outbox event:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  // DN2: Advance outbox event through its lifecycle (pending → processing → completed/failed)
  private async updateOutboxEventStatus(
    outboxId: string | null,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    errorMessage?: string,
  ): Promise<void> {
    if (!outboxId) return;
    const db = getSupabaseAdminClient();
    const update: Record<string, unknown> = { status };
    if (status === 'processing') update.claimed_at = new Date().toISOString();
    if (status === 'completed' || status === 'failed') update.completed_at = new Date().toISOString();
    if (errorMessage !== undefined) update.error_message = String(errorMessage).slice(0, 2000);
    // NP4: log status update errors so stuck records are visible in logs
    const { error } = await db.from('outbox_events').update(update).eq('id', outboxId);
    if (error) {
      console.error(`[GlobalScheduler] Failed to update outbox event ${outboxId} to '${status}':`, error.message);
    }
  }

  private async updateScheduleRunStatus(
    runId: string | null,
    status: ScheduleOutcome['status'],
    errorMessage?: string,
    startedAt?: string | null,
    completedAt?: string,
    resultPayload?: Record<string, unknown>,
  ): Promise<void> {
    if (!runId) return;
    const db = getSupabaseAdminClient();
    const update: Record<string, unknown> = { status };
    if (errorMessage !== undefined) update.error_message = String(errorMessage).slice(0, 2000);
    if (startedAt) update.started_at = startedAt;
    if (completedAt) update.completed_at = completedAt;
    if (resultPayload !== undefined) update.result_payload = resultPayload;
    // NP4: log status update errors so stuck records are visible in logs
    const { error } = await db.from('schedule_runs').update(update).eq('id', runId);
    if (error) {
      console.error(`[GlobalScheduler] Failed to update schedule run ${runId} to '${status}':`, error.message);
    }
  }

  private async updateScheduleDefinitionNextRun(definitionId: number, nextRunAt: string): Promise<void> {
    const db = getSupabaseAdminClient();
    await db.from('schedule_definitions').update({ next_run_at: nextRunAt, updated_at: new Date().toISOString() }).eq('id', definitionId);
  }
}
