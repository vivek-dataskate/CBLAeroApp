/**
 * Story 3-1 canonical SMS template types.
 *
 * Every consumer outside `features/outreach-engagement/` imports from
 * `contracts/` — never from `infrastructure/` (dev-standards §19.1).
 */

/**
 * Agenda enum — must stay in lock-step with the `sms_templates_agenda_valid`
 * CHECK constraint in supabase/schema.sql. Adding a value here without
 * updating the DB CHECK (or vice versa) fails at insert time.
 */
export const SMS_AGENDA_VALUES = [
  'new_opportunity',
  'availability_check',
  'job_followup',
  'submission_followup',
  'interview_schedule',
  'interview_reminder',
  'interview_followup',
  'bgv_initiation',
  'bgv_followup',
  'offer_extended',
  'onboarding',
  'reengagement',
  'general',
] as const;
export type SmsAgenda = (typeof SMS_AGENDA_VALUES)[number];

export const SMS_TEMPLATE_STATUS_VALUES = ['active', 'archived'] as const;
export type SmsTemplateStatus = (typeof SMS_TEMPLATE_STATUS_VALUES)[number];

/**
 * Template as loaded from `cblaero_app.sms_templates`. Templates are
 * append-only: edits create a new row with `version = max(version) + 1`; the
 * prior version is flipped to `archived`. The (tenant_id, template_key,
 * version) tuple is the natural key.
 */
export interface SmsTemplate {
  id: string;
  tenantId: string;
  agenda: SmsAgenda;
  name: string;
  templateKey: string;
  body: string;
  /** Declared mustache placeholders (e.g. ['first_name','tracking_link']). */
  variables: string[];
  version: number;
  status: SmsTemplateStatus;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Minimal projection captured by a scheduled send. Frozen at enqueue time so
 * later template edits never rewrite history (AC 9).
 */
export interface SmsTemplateVersion {
  templateId: string;
  version: number;
}

export function isSmsAgenda(value: unknown): value is SmsAgenda {
  return typeof value === 'string' && (SMS_AGENDA_VALUES as readonly string[]).includes(value);
}
