/**
 * Repository for SMS template CRUD — all DB access for sms_templates table.
 */

import { getSupabaseAdminClient } from "../persistence";
import type { SmsAgenda } from "./agenda";

export type SmsTemplate = {
  id: string;
  tenantId: string;
  agenda: SmsAgenda;
  name: string;
  templateKey: string;
  body: string;
  variables: string[];
  version: number;
  status: "active" | "archived";
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type CreateTemplateInput = {
  tenantId: string;
  agenda: SmsAgenda;
  name: string;
  templateKey: string;
  body: string;
  variables: string[];
  createdBy: string;
};

type UpdateTemplateInput = {
  name?: string;
  body?: string;
  variables?: string[];
  agenda?: SmsAgenda;
  updatedBy: string;
};

function mapRow(row: Record<string, unknown>): SmsTemplate {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    agenda: row.agenda as SmsAgenda,
    name: row.name as string,
    templateKey: row.template_key as string,
    body: row.body as string,
    variables: (row.variables as string[]) ?? [],
    version: row.version as number,
    status: row.status as "active" | "archived",
    createdBy: row.created_by as string | null,
    updatedBy: row.updated_by as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * List active templates for a tenant, optionally filtered by agenda.
 */
export async function listTemplates(
  tenantId: string,
  agenda?: SmsAgenda,
): Promise<SmsTemplate[]> {
  const client = getSupabaseAdminClient();
  let query = client
    .from("sms_templates")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .order("agenda")
    .order("name");

  if (agenda) {
    query = query.eq("agenda", agenda);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list templates: ${error.message}`);
  return (data ?? []).map(mapRow);
}

/**
 * Get a single template by ID.
 */
export async function getTemplate(id: string): Promise<SmsTemplate | null> {
  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("sms_templates")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // not found
    throw new Error(`Failed to get template: ${error.message}`);
  }
  return data ? mapRow(data) : null;
}

/**
 * Create a new template. Returns the created template.
 */
export async function createTemplate(
  input: CreateTemplateInput,
): Promise<SmsTemplate> {
  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("sms_templates")
    .insert({
      tenant_id: input.tenantId,
      agenda: input.agenda,
      name: input.name,
      template_key: input.templateKey,
      body: input.body,
      variables: input.variables,
      version: 1,
      status: "active",
      created_by: input.createdBy,
      updated_by: input.createdBy,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create template: ${error.message}`);
  return mapRow(data);
}

/**
 * Update a template — creates a new version row. Archives the previous active version.
 */
export async function updateTemplate(
  id: string,
  input: UpdateTemplateInput,
): Promise<SmsTemplate> {
  const client = getSupabaseAdminClient();

  // Fetch current version
  const existing = await getTemplate(id);
  if (!existing) throw new Error(`Template not found: ${id}`);

  // Archive the current version
  await client
    .from("sms_templates")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", id);

  // Insert new version
  const { data, error } = await client
    .from("sms_templates")
    .insert({
      tenant_id: existing.tenantId,
      agenda: input.agenda ?? existing.agenda,
      name: input.name ?? existing.name,
      template_key: existing.templateKey,
      body: input.body ?? existing.body,
      variables: input.variables ?? existing.variables,
      version: existing.version + 1,
      status: "active",
      created_by: existing.createdBy,
      updated_by: input.updatedBy,
    })
    .select()
    .single();

  if (error)
    throw new Error(`Failed to create new template version: ${error.message}`);
  return mapRow(data);
}

/**
 * Archive a template (soft delete).
 */
export async function archiveTemplate(id: string): Promise<void> {
  const client = getSupabaseAdminClient();
  const { error } = await client
    .from("sms_templates")
    .update({
      status: "archived",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(`Failed to archive template: ${error.message}`);
}
