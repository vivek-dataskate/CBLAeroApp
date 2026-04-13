import {
  getSupabaseAdminClient,
  shouldUseInMemoryPersistenceForTests,
  toDeterministicVectorLiteral,
} from "../persistence";

export type AuditEnvelope = {
  traceId: string;
  actorId: string | null;
  tenantId: string | null;
};

export type AuthorizationDenyReason =
  | "unauthenticated"
  | "forbidden_role"
  | "tenant_mismatch";

export type AuthorizationDenyEvent = {
  traceId: string;
  actorId: string | null;
  role: string | null;
  sessionTenantId: string | null;
  requestedTenantId: string | null;
  path: string;
  method: string;
  reason: AuthorizationDenyReason;
  occurredAtIso: string;
};

export type ImportBatchAccessEvent = {
  traceId: string;
  actorId: string;
  tenantId: string;
  batchId: string | null;
  action:
    | "list_import_batches"
    | "read_import_batch_detail"
    | "csv_upload_access"
    | "download_csv_error_report"
    | "resume_upload_access"
    | "resume_confirm_access";
  occurredAtIso: string;
};

const IMPORT_BATCH_ACCESS_EVENT_LIMIT = 1000;
const importBatchAccessEvents: ImportBatchAccessEvent[] = [];

export async function recordImportBatchAccessEvent(
  input: Omit<ImportBatchAccessEvent, "occurredAtIso">,
): Promise<ImportBatchAccessEvent> {
  const event: ImportBatchAccessEvent = {
    ...input,
    occurredAtIso: new Date().toISOString(),
  };

  if (isInMemoryMode()) {
    importBatchAccessEvents.push(event);
    if (importBatchAccessEvents.length > IMPORT_BATCH_ACCESS_EVENT_LIMIT) {
      importBatchAccessEvents.splice(
        0,
        importBatchAccessEvents.length - IMPORT_BATCH_ACCESS_EVENT_LIMIT,
      );
    }
    return event;
  }

  const client = getSupabaseAdminClient();
  const { error } = await client.from("audit_import_batch_accesses").insert({
    trace_id: event.traceId,
    actor_id: event.actorId,
    tenant_id: event.tenantId,
    batch_id: event.batchId,
    action: event.action,
    occurred_at: event.occurredAtIso,
  });

  if (error) {
    throw new Error(`Failed to persist import batch access event: ${error.message}`);
  }

  return event;
}

export async function listImportBatchAccessEvents(
  tenantId?: string,
): Promise<ImportBatchAccessEvent[]> {
  if (isInMemoryMode()) {
    const events = [...importBatchAccessEvents];
    return tenantId ? events.filter((event) => event.tenantId === tenantId) : events;
  }

  const client = getSupabaseAdminClient();
  const query = tenantId
    ? client
        .from("audit_import_batch_accesses")
        .select("trace_id, actor_id, tenant_id, batch_id, action, occurred_at")
        .eq("tenant_id", tenantId)
    : client
        .from("audit_import_batch_accesses")
        .select("trace_id, actor_id, tenant_id, batch_id, action, occurred_at");

  const { data, error } = await query
    .order("occurred_at", { ascending: false })
    .limit(IMPORT_BATCH_ACCESS_EVENT_LIMIT);

  if (error) {
    throw new Error(`Failed to list import batch access events: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    traceId: row.trace_id,
    actorId: row.actor_id,
    tenantId: row.tenant_id,
    batchId: row.batch_id,
    action: row.action as ImportBatchAccessEvent["action"],
    occurredAtIso: row.occurred_at,
  }));
}

export async function clearImportBatchAccessEventsForTest(): Promise<void> {
  if (isInMemoryMode()) {
    importBatchAccessEvents.length = 0;
    return;
  }

  const client = getSupabaseAdminClient();
  const { error } = await client.from("audit_import_batch_accesses").delete().gte("id", 0);
  if (error) {
    throw new Error(`Failed to clear import batch access events: ${error.message}`);
  }
}

export type AdminActionType =
  | "invite_user"
  | "assign_role"
  | "update_team_membership";

export type AdminActionEvent = {
  traceId: string;
  actorId: string;
  tenantId: string;
  targetActorId: string | null;
  actionType: AdminActionType;
  details: Record<string, string | number | boolean | null>;
  occurredAtIso: string;
};

export type StepUpAttemptOutcome = "challenged" | "verified";

export type StepUpAttemptReason = "fresh_auth_required" | null;

export type StepUpAttemptEvent = {
  traceId: string;
  actorId: string;
  tenantId: string;
  role: string;
  path: string;
  method: string;
  action: string;
  outcome: StepUpAttemptOutcome;
  reason: StepUpAttemptReason;
  occurredAtIso: string;
};

export type ClientContextConfirmationOutcome = "required" | "confirmed";

export type ClientContextConfirmationEvent = {
  traceId: string;
  actorId: string;
  role: string;
  tenantId: string;
  activeClientId: string;
  targetClientId: string;
  action: string;
  path: string;
  method: string;
  outcome: ClientContextConfirmationOutcome;
  occurredAtIso: string;
};

export type DataResidencyCheckStatus = "pass" | "fail";

export type DataResidencyCheckTargets = {
  data: string | null;
  logs: string | null;
  backups: string | null;
};

export type DataResidencyCheckEvent = {
  traceId: string;
  actorId: string | null;
  tenantId: string | null;
  status: DataResidencyCheckStatus;
  approvedRegions: string[];
  checkedTargets: DataResidencyCheckTargets;
  violations: string[];
  occurredAtIso: string;
};

const AUTHORIZATION_DENY_EVENT_LIMIT = 1000;
const ADMIN_ACTION_EVENT_LIMIT = 1000;
const STEP_UP_ATTEMPT_EVENT_LIMIT = 1000;
const CLIENT_CONTEXT_CONFIRMATION_EVENT_LIMIT = 1000;
const DATA_RESIDENCY_CHECK_EVENT_LIMIT = 1000;
const authorizationDenyEvents: AuthorizationDenyEvent[] = [];
const adminActionEvents: AdminActionEvent[] = [];
const stepUpAttemptEvents: StepUpAttemptEvent[] = [];
const clientContextConfirmationEvents: ClientContextConfirmationEvent[] = [];
const dataResidencyCheckEvents: DataResidencyCheckEvent[] = [];

function vectorAuditEnabled(): boolean {
  return process.env.CBL_VECTOR_AUDIT_ENABLED !== "false";
}

function vectorDimensions(): number {
  const parsed = Number.parseInt(process.env.CBL_VECTOR_DIMENSIONS ?? "8", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8;
}

function vectorTableName(): string {
  return process.env.CBL_VECTOR_AUDIT_TABLE?.trim() || "audit_event_vectors";
}

function isInMemoryMode(): boolean {
  return shouldUseInMemoryPersistenceForTests();
}

async function insertVectorAudit(
  sourceTable: string,
  sourceEventId: number,
  tenantId: string | null,
  textPayload: string,
): Promise<void> {
  if (isInMemoryMode() || !vectorAuditEnabled()) {
    return;
  }

  const client = getSupabaseAdminClient();
  const vector = toDeterministicVectorLiteral(textPayload, vectorDimensions());

  // Vector persistence is best-effort so primary audit flow remains available.
  await client.from(vectorTableName()).insert({
    source_table: sourceTable,
    source_event_id: sourceEventId,
    tenant_id: tenantId,
    payload_text: textPayload,
    embedding: vector,
  });
}

export function createAuditEnvelope(traceId: string): AuditEnvelope {
  return {
    traceId,
    actorId: null,
    tenantId: null,
  };
}

export async function recordAuthorizationDenyEvent(
  input: Omit<AuthorizationDenyEvent, "occurredAtIso">,
): Promise<AuthorizationDenyEvent> {
  const event: AuthorizationDenyEvent = {
    ...input,
    occurredAtIso: new Date().toISOString(),
  };

  if (isInMemoryMode()) {
    authorizationDenyEvents.push(event);
    if (authorizationDenyEvents.length > AUTHORIZATION_DENY_EVENT_LIMIT) {
      authorizationDenyEvents.splice(
        0,
        authorizationDenyEvents.length - AUTHORIZATION_DENY_EVENT_LIMIT,
      );
    }

    return event;
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("audit_authorization_denials")
    .insert({
      trace_id: event.traceId,
      actor_id: event.actorId,
      role: event.role,
      session_tenant_id: event.sessionTenantId,
      requested_tenant_id: event.requestedTenantId,
      path: event.path,
      method: event.method,
      reason: event.reason,
      occurred_at: event.occurredAtIso,
    })
    .select("id, occurred_at")
    .single();

  if (error) {
    throw new Error(`Failed to persist authorization deny event: ${error.message}`);
  }

  await insertVectorAudit(
    "audit_authorization_denials",
    Number(data.id),
    event.sessionTenantId,
    JSON.stringify(event),
  );

  return event;
}

export async function listAuthorizationDenyEvents(): Promise<AuthorizationDenyEvent[]> {
  if (isInMemoryMode()) {
    return [...authorizationDenyEvents];
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("audit_authorization_denials")
    .select(
      "trace_id, actor_id, role, session_tenant_id, requested_tenant_id, path, method, reason, occurred_at",
    )
    .order("occurred_at", { ascending: false })
    .limit(AUTHORIZATION_DENY_EVENT_LIMIT);

  if (error) {
    throw new Error(`Failed to list authorization deny events: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    traceId: row.trace_id,
    actorId: row.actor_id,
    role: row.role,
    sessionTenantId: row.session_tenant_id,
    requestedTenantId: row.requested_tenant_id,
    path: row.path,
    method: row.method,
    reason: row.reason,
    occurredAtIso: row.occurred_at,
  }));
}

export async function clearAuthorizationDenyEventsForTest(): Promise<void> {
  if (isInMemoryMode()) {
    authorizationDenyEvents.length = 0;
    return;
  }

  const client = getSupabaseAdminClient();
  const { error } = await client.from("audit_authorization_denials").delete().gte("id", 0);
  if (error) {
    throw new Error(`Failed to clear authorization deny events: ${error.message}`);
  }
}

export async function recordAdminActionEvent(
  input: Omit<AdminActionEvent, "occurredAtIso">,
): Promise<AdminActionEvent> {
  const event: AdminActionEvent = {
    ...input,
    occurredAtIso: new Date().toISOString(),
  };

  if (isInMemoryMode()) {
    adminActionEvents.push(event);
    if (adminActionEvents.length > ADMIN_ACTION_EVENT_LIMIT) {
      adminActionEvents.splice(0, adminActionEvents.length - ADMIN_ACTION_EVENT_LIMIT);
    }

    return event;
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("audit_admin_actions")
    .insert({
      trace_id: event.traceId,
      actor_id: event.actorId,
      tenant_id: event.tenantId,
      target_actor_id: event.targetActorId,
      action_type: event.actionType,
      details: event.details,
      occurred_at: event.occurredAtIso,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to persist admin action event: ${error.message}`);
  }

  await insertVectorAudit(
    "audit_admin_actions",
    Number(data.id),
    event.tenantId,
    JSON.stringify(event),
  );

  return event;
}

export async function listAdminActionEvents(
  tenantId?: string,
): Promise<AdminActionEvent[]> {
  if (isInMemoryMode()) {
    const events = [...adminActionEvents];
    return tenantId ? events.filter((event) => event.tenantId === tenantId) : events;
  }

  const client = getSupabaseAdminClient();
  const query = tenantId
    ? client
        .from("audit_admin_actions")
        .select("trace_id, actor_id, tenant_id, target_actor_id, action_type, details, occurred_at")
        .eq("tenant_id", tenantId)
    : client
        .from("audit_admin_actions")
        .select("trace_id, actor_id, tenant_id, target_actor_id, action_type, details, occurred_at");

  const { data, error } = await query
    .order("occurred_at", { ascending: false })
    .limit(ADMIN_ACTION_EVENT_LIMIT);

  if (error) {
    throw new Error(`Failed to list admin action events: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    traceId: row.trace_id,
    actorId: row.actor_id,
    tenantId: row.tenant_id,
    targetActorId: row.target_actor_id,
    actionType: row.action_type,
    details: row.details as Record<string, string | number | boolean | null>,
    occurredAtIso: row.occurred_at,
  }));
}

export async function clearAdminActionEventsForTest(): Promise<void> {
  if (isInMemoryMode()) {
    adminActionEvents.length = 0;
    return;
  }

  const client = getSupabaseAdminClient();
  const { error } = await client.from("audit_admin_actions").delete().gte("id", 0);
  if (error) {
    throw new Error(`Failed to clear admin action events: ${error.message}`);
  }
}

export async function recordStepUpAttemptEvent(
  input: Omit<StepUpAttemptEvent, "occurredAtIso">,
): Promise<StepUpAttemptEvent> {
  const event: StepUpAttemptEvent = {
    ...input,
    occurredAtIso: new Date().toISOString(),
  };

  if (isInMemoryMode()) {
    stepUpAttemptEvents.push(event);
    if (stepUpAttemptEvents.length > STEP_UP_ATTEMPT_EVENT_LIMIT) {
      stepUpAttemptEvents.splice(0, stepUpAttemptEvents.length - STEP_UP_ATTEMPT_EVENT_LIMIT);
    }

    return event;
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("audit_step_up_attempts")
    .insert({
      trace_id: event.traceId,
      actor_id: event.actorId,
      tenant_id: event.tenantId,
      role: event.role,
      path: event.path,
      method: event.method,
      action: event.action,
      outcome: event.outcome,
      reason: event.reason,
      occurred_at: event.occurredAtIso,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to persist step-up attempt event: ${error.message}`);
  }

  await insertVectorAudit(
    "audit_step_up_attempts",
    Number(data.id),
    event.tenantId,
    JSON.stringify(event),
  );

  return event;
}

export async function listStepUpAttemptEvents(
  tenantId?: string,
): Promise<StepUpAttemptEvent[]> {
  if (isInMemoryMode()) {
    const events = [...stepUpAttemptEvents];
    return tenantId ? events.filter((event) => event.tenantId === tenantId) : events;
  }

  const client = getSupabaseAdminClient();
  const query = tenantId
    ? client
        .from("audit_step_up_attempts")
        .select("trace_id, actor_id, tenant_id, role, path, method, action, outcome, reason, occurred_at")
        .eq("tenant_id", tenantId)
    : client
        .from("audit_step_up_attempts")
        .select("trace_id, actor_id, tenant_id, role, path, method, action, outcome, reason, occurred_at");

  const { data, error } = await query
    .order("occurred_at", { ascending: false })
    .limit(STEP_UP_ATTEMPT_EVENT_LIMIT);

  if (error) {
    throw new Error(`Failed to list step-up attempt events: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    traceId: row.trace_id,
    actorId: row.actor_id,
    tenantId: row.tenant_id,
    role: row.role,
    path: row.path,
    method: row.method,
    action: row.action,
    outcome: row.outcome,
    reason: row.reason,
    occurredAtIso: row.occurred_at,
  }));
}

export async function clearStepUpAttemptEventsForTest(): Promise<void> {
  if (isInMemoryMode()) {
    stepUpAttemptEvents.length = 0;
    return;
  }

  const client = getSupabaseAdminClient();
  const { error } = await client.from("audit_step_up_attempts").delete().gte("id", 0);
  if (error) {
    throw new Error(`Failed to clear step-up attempt events: ${error.message}`);
  }
}

export async function recordClientContextConfirmationEvent(
  input: Omit<ClientContextConfirmationEvent, "occurredAtIso">,
): Promise<ClientContextConfirmationEvent> {
  const event: ClientContextConfirmationEvent = {
    ...input,
    occurredAtIso: new Date().toISOString(),
  };

  if (isInMemoryMode()) {
    clientContextConfirmationEvents.push(event);
    if (clientContextConfirmationEvents.length > CLIENT_CONTEXT_CONFIRMATION_EVENT_LIMIT) {
      clientContextConfirmationEvents.splice(
        0,
        clientContextConfirmationEvents.length - CLIENT_CONTEXT_CONFIRMATION_EVENT_LIMIT,
      );
    }

    return event;
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("audit_client_context_confirmations")
    .insert({
      trace_id: event.traceId,
      actor_id: event.actorId,
      role: event.role,
      tenant_id: event.tenantId,
      active_client_id: event.activeClientId,
      target_client_id: event.targetClientId,
      action: event.action,
      path: event.path,
      method: event.method,
      outcome: event.outcome,
      occurred_at: event.occurredAtIso,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to persist client context confirmation event: ${error.message}`);
  }

  await insertVectorAudit(
    "audit_client_context_confirmations",
    Number(data.id),
    event.tenantId,
    JSON.stringify(event),
  );

  return event;
}

export async function listClientContextConfirmationEvents(
  tenantId?: string,
): Promise<ClientContextConfirmationEvent[]> {
  if (isInMemoryMode()) {
    const events = [...clientContextConfirmationEvents];
    return tenantId ? events.filter((event) => event.tenantId === tenantId) : events;
  }

  const client = getSupabaseAdminClient();
  const query = tenantId
    ? client
        .from("audit_client_context_confirmations")
        .select(
          "trace_id, actor_id, role, tenant_id, active_client_id, target_client_id, action, path, method, outcome, occurred_at",
        )
        .eq("tenant_id", tenantId)
    : client
        .from("audit_client_context_confirmations")
        .select(
          "trace_id, actor_id, role, tenant_id, active_client_id, target_client_id, action, path, method, outcome, occurred_at",
        );

  const { data, error } = await query
    .order("occurred_at", { ascending: false })
    .limit(CLIENT_CONTEXT_CONFIRMATION_EVENT_LIMIT);

  if (error) {
    throw new Error(`Failed to list client context confirmation events: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    traceId: row.trace_id,
    actorId: row.actor_id,
    role: row.role,
    tenantId: row.tenant_id,
    activeClientId: row.active_client_id,
    targetClientId: row.target_client_id,
    action: row.action,
    path: row.path,
    method: row.method,
    outcome: row.outcome,
    occurredAtIso: row.occurred_at,
  }));
}

export async function clearClientContextConfirmationEventsForTest(): Promise<void> {
  if (isInMemoryMode()) {
    clientContextConfirmationEvents.length = 0;
    return;
  }

  const client = getSupabaseAdminClient();
  const { error } = await client
    .from("audit_client_context_confirmations")
    .delete()
    .gte("id", 0);
  if (error) {
    throw new Error(`Failed to clear client context confirmation events: ${error.message}`);
  }
}

export async function recordDataResidencyCheckEvent(
  input: Omit<DataResidencyCheckEvent, "occurredAtIso">,
): Promise<DataResidencyCheckEvent> {
  const event: DataResidencyCheckEvent = {
    ...input,
    occurredAtIso: new Date().toISOString(),
  };

  if (isInMemoryMode()) {
    dataResidencyCheckEvents.push(event);
    if (dataResidencyCheckEvents.length > DATA_RESIDENCY_CHECK_EVENT_LIMIT) {
      dataResidencyCheckEvents.splice(
        0,
        dataResidencyCheckEvents.length - DATA_RESIDENCY_CHECK_EVENT_LIMIT,
      );
    }

    return event;
  }

  let client;
  try {
    client = getSupabaseAdminClient();
  } catch (error) {
    if (event.status === "fail") {
      return event;
    }

    throw error;
  }

  const { data, error } = await client
    .from("audit_data_residency_checks")
    .insert({
      trace_id: event.traceId,
      actor_id: event.actorId,
      tenant_id: event.tenantId,
      status: event.status,
      approved_regions: event.approvedRegions,
      checked_targets: event.checkedTargets,
      violations: event.violations,
      occurred_at: event.occurredAtIso,
    })
    .select("id")
    .single();

  if (error) {
    if (event.status === "fail") {
      return event;
    }

    throw new Error(`Failed to persist data residency check event: ${error.message}`);
  }

  await insertVectorAudit(
    "audit_data_residency_checks",
    Number(data.id),
    event.tenantId,
    JSON.stringify(event),
  );

  return event;
}

export async function listDataResidencyCheckEvents(
  tenantId?: string,
): Promise<DataResidencyCheckEvent[]> {
  if (isInMemoryMode()) {
    const events = [...dataResidencyCheckEvents];
    return tenantId ? events.filter((event) => event.tenantId === tenantId) : events;
  }

  const client = getSupabaseAdminClient();
  const query = tenantId
    ? client
        .from("audit_data_residency_checks")
        .select(
          "trace_id, actor_id, tenant_id, status, approved_regions, checked_targets, violations, occurred_at",
        )
        .eq("tenant_id", tenantId)
    : client
        .from("audit_data_residency_checks")
        .select(
          "trace_id, actor_id, tenant_id, status, approved_regions, checked_targets, violations, occurred_at",
        );

  const { data, error } = await query
    .order("occurred_at", { ascending: false })
    .limit(DATA_RESIDENCY_CHECK_EVENT_LIMIT);

  if (error) {
    throw new Error(`Failed to list data residency check events: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    traceId: row.trace_id,
    actorId: row.actor_id,
    tenantId: row.tenant_id,
    status: row.status,
    approvedRegions: Array.isArray(row.approved_regions) ? row.approved_regions : [],
    checkedTargets: row.checked_targets as DataResidencyCheckTargets,
    violations: Array.isArray(row.violations) ? row.violations : [],
    occurredAtIso: row.occurred_at,
  }));
}

export async function clearDataResidencyCheckEventsForTest(): Promise<void> {
  if (isInMemoryMode()) {
    dataResidencyCheckEvents.length = 0;
    return;
  }

  const client = getSupabaseAdminClient();
  const { error } = await client.from("audit_data_residency_checks").delete().gte("id", 0);
  if (error) {
    if (error.message.includes("Could not find the table")) {
      return;
    }

    throw new Error(`Failed to clear data residency check events: ${error.message}`);
  }
}
