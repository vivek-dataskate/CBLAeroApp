/**
 * SMS template repository — Story 3-1 Task 2.5.
 *
 * All reads/writes to `cblaero_app.sms_templates` route through here — route
 * handlers never `db.from('sms_templates')` directly (dev-standards §4.5).
 *
 * Templates are append-only: `edit` creates a new row with
 * `version = max(version) + 1` and flips the prior row to `archived`.
 */
import {
  getSupabaseAdminClient,
  isSupabaseConfigured,
  shouldUseInMemoryPersistenceForTests,
} from '@/modules/persistence';
import type {
  SmsAgenda,
  SmsTemplate,
  SmsTemplateStatus,
} from '../contracts/sms-template';
import { isSmsAgenda } from '../contracts/sms-template';

export class SmsTemplateNotFoundError extends Error {
  constructor(msg = 'SMS template not found') {
    super(msg);
    this.name = 'SmsTemplateNotFoundError';
  }
}

type SmsTemplateRow = {
  id: string;
  tenant_id: string;
  agenda: string;
  name: string;
  template_key: string;
  body: string;
  variables: unknown;
  version: number;
  status: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

function toSmsTemplate(row: SmsTemplateRow): SmsTemplate {
  if (!isSmsAgenda(row.agenda)) {
    throw new Error(`SmsTemplateRepository: unknown agenda "${row.agenda}" in row ${row.id}`);
  }
  const vars = Array.isArray(row.variables)
    ? (row.variables as unknown[]).filter((v) => typeof v === 'string').map((v) => v as string)
    : [];
  const status =
    row.status === 'active' || row.status === 'archived'
      ? (row.status as SmsTemplateStatus)
      : 'archived';
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agenda: row.agenda,
    name: row.name,
    templateKey: row.template_key,
    body: row.body,
    variables: vars,
    version: row.version,
    status,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── In-memory store (test mode only) ────────────────────────────────────────
const templateStore = new Map<string, SmsTemplateRow>();
let nextTemplateSeq = 1;

export function seedSmsTemplateForTest(template: SmsTemplate): void {
  templateStore.set(template.id, {
    id: template.id,
    tenant_id: template.tenantId,
    agenda: template.agenda,
    name: template.name,
    template_key: template.templateKey,
    body: template.body,
    variables: template.variables,
    version: template.version,
    status: template.status,
    created_by: template.createdBy,
    updated_by: template.updatedBy,
    created_at: template.createdAt,
    updated_at: template.updatedAt,
  });
}

export function clearSmsTemplateStoreForTest(): void {
  templateStore.clear();
  nextTemplateSeq = 1;
}

function mintTemplateId(): string {
  return `tmpl-${String(nextTemplateSeq++).padStart(8, '0')}`;
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function listActiveTemplates(tenantId: string): Promise<SmsTemplate[]> {
  if (shouldUseInMemoryPersistenceForTests()) {
    return [...templateStore.values()]
      .filter((r) => r.tenant_id === tenantId && r.status === 'active')
      .map(toSmsTemplate);
  }
  if (!isSupabaseConfigured()) return [];

  const db = getSupabaseAdminClient();
  const { data, error } = await db
    .from('sms_templates')
    .select(
      'id, tenant_id, agenda, name, template_key, body, variables, version, status, created_by, updated_by, created_at, updated_at',
    )
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('agenda', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(`[SmsTemplateRepository] list failed: ${error.message}`);
  return (data ?? []).map((row) => toSmsTemplate(row as SmsTemplateRow));
}

export async function getTemplateById(
  tenantId: string,
  id: string,
): Promise<SmsTemplate> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const row = templateStore.get(id);
    if (!row || row.tenant_id !== tenantId) throw new SmsTemplateNotFoundError();
    return toSmsTemplate(row);
  }
  if (!isSupabaseConfigured()) throw new SmsTemplateNotFoundError();

  const db = getSupabaseAdminClient();
  const { data, error } = await db
    .from('sms_templates')
    .select(
      'id, tenant_id, agenda, name, template_key, body, variables, version, status, created_by, updated_by, created_at, updated_at',
    )
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`[SmsTemplateRepository] get failed: ${error.message}`);
  if (!data) throw new SmsTemplateNotFoundError();
  return toSmsTemplate(data as SmsTemplateRow);
}

export async function getActiveTemplateByKey(
  tenantId: string,
  templateKey: string,
): Promise<SmsTemplate> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const row = [...templateStore.values()].find(
      (r) => r.tenant_id === tenantId && r.template_key === templateKey && r.status === 'active',
    );
    if (!row) throw new SmsTemplateNotFoundError();
    return toSmsTemplate(row);
  }
  if (!isSupabaseConfigured()) throw new SmsTemplateNotFoundError();

  const db = getSupabaseAdminClient();
  const { data, error } = await db
    .from('sms_templates')
    .select(
      'id, tenant_id, agenda, name, template_key, body, variables, version, status, created_by, updated_by, created_at, updated_at',
    )
    .eq('tenant_id', tenantId)
    .eq('template_key', templateKey)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error(`[SmsTemplateRepository] getByKey failed: ${error.message}`);
  if (!data) throw new SmsTemplateNotFoundError();
  return toSmsTemplate(data as SmsTemplateRow);
}

export interface CreateSmsTemplateParams {
  tenantId: string;
  agenda: SmsAgenda;
  name: string;
  templateKey: string;
  body: string;
  variables: string[];
  actorId: string;
}

export async function createTemplate(params: CreateSmsTemplateParams): Promise<SmsTemplate> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const id = mintTemplateId();
    const nowIso = new Date().toISOString();
    const row: SmsTemplateRow = {
      id,
      tenant_id: params.tenantId,
      agenda: params.agenda,
      name: params.name,
      template_key: params.templateKey,
      body: params.body,
      variables: params.variables,
      version: 1,
      status: 'active',
      created_by: params.actorId,
      updated_by: params.actorId,
      created_at: nowIso,
      updated_at: nowIso,
    };
    templateStore.set(id, row);
    return toSmsTemplate(row);
  }

  const db = getSupabaseAdminClient();
  const { data, error } = await db
    .from('sms_templates')
    .insert({
      tenant_id: params.tenantId,
      agenda: params.agenda,
      name: params.name,
      template_key: params.templateKey,
      body: params.body,
      variables: params.variables,
      version: 1,
      status: 'active',
      created_by: params.actorId,
      updated_by: params.actorId,
    })
    .select(
      'id, tenant_id, agenda, name, template_key, body, variables, version, status, created_by, updated_by, created_at, updated_at',
    )
    .single();
  if (error) throw new Error(`[SmsTemplateRepository] create failed: ${error.message}`);
  return toSmsTemplate(data as SmsTemplateRow);
}

export interface UpdateSmsTemplateParams {
  tenantId: string;
  templateKey: string;
  body: string;
  name?: string;
  variables?: string[];
  actorId: string;
}

/**
 * Append-only edit: creates a new row with `version = max(version) + 1` for
 * the same `template_key` and flips the prior active row to `archived`.
 * Returns the new active row.
 */
export async function bumpTemplateVersion(
  params: UpdateSmsTemplateParams,
): Promise<SmsTemplate> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const rows = [...templateStore.values()].filter(
      (r) => r.tenant_id === params.tenantId && r.template_key === params.templateKey,
    );
    if (rows.length === 0) throw new SmsTemplateNotFoundError();
    const maxVersion = rows.reduce((m, r) => Math.max(m, r.version), 0);
    const prior = rows.find((r) => r.status === 'active');
    const priorAgenda = prior?.agenda ?? rows[0].agenda;
    if (prior) {
      templateStore.set(prior.id, { ...prior, status: 'archived', updated_at: new Date().toISOString() });
    }
    const id = mintTemplateId();
    const nowIso = new Date().toISOString();
    const row: SmsTemplateRow = {
      id,
      tenant_id: params.tenantId,
      agenda: priorAgenda,
      name: params.name ?? prior?.name ?? params.templateKey,
      template_key: params.templateKey,
      body: params.body,
      variables: params.variables ?? prior?.variables ?? [],
      version: maxVersion + 1,
      status: 'active',
      created_by: prior?.created_by ?? params.actorId,
      updated_by: params.actorId,
      created_at: nowIso,
      updated_at: nowIso,
    };
    templateStore.set(id, row);
    return toSmsTemplate(row);
  }

  const db = getSupabaseAdminClient();

  const { data: priorRows, error: priorErr } = await db
    .from('sms_templates')
    .select(
      'id, tenant_id, agenda, name, template_key, body, variables, version, status, created_by, updated_by, created_at, updated_at',
    )
    .eq('tenant_id', params.tenantId)
    .eq('template_key', params.templateKey)
    .order('version', { ascending: false });
  if (priorErr) throw new Error(`[SmsTemplateRepository] bump read failed: ${priorErr.message}`);
  if (!priorRows || priorRows.length === 0) throw new SmsTemplateNotFoundError();

  const prior = priorRows[0] as SmsTemplateRow;
  const active = (priorRows as SmsTemplateRow[]).find((r) => r.status === 'active');

  if (active) {
    const { error: archErr } = await db
      .from('sms_templates')
      .update({ status: 'archived', updated_by: params.actorId })
      .eq('id', active.id);
    if (archErr) throw new Error(`[SmsTemplateRepository] archive prior failed: ${archErr.message}`);
  }

  const { data, error } = await db
    .from('sms_templates')
    .insert({
      tenant_id: params.tenantId,
      agenda: prior.agenda,
      name: params.name ?? prior.name,
      template_key: params.templateKey,
      body: params.body,
      variables: params.variables ?? prior.variables,
      version: prior.version + 1,
      status: 'active',
      created_by: prior.created_by ?? params.actorId,
      updated_by: params.actorId,
    })
    .select(
      'id, tenant_id, agenda, name, template_key, body, variables, version, status, created_by, updated_by, created_at, updated_at',
    )
    .single();
  if (error) throw new Error(`[SmsTemplateRepository] bump insert failed: ${error.message}`);
  return toSmsTemplate(data as SmsTemplateRow);
}

export async function archiveTemplate(
  tenantId: string,
  id: string,
  actorId: string,
): Promise<void> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const row = templateStore.get(id);
    if (!row || row.tenant_id !== tenantId) throw new SmsTemplateNotFoundError();
    templateStore.set(id, {
      ...row,
      status: 'archived',
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    });
    return;
  }

  const db = getSupabaseAdminClient();
  const { error } = await db
    .from('sms_templates')
    .update({ status: 'archived', updated_by: actorId })
    .eq('tenant_id', tenantId)
    .eq('id', id);
  if (error) throw new Error(`[SmsTemplateRepository] archive failed: ${error.message}`);
}
