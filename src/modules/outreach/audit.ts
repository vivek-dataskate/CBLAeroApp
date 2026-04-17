/**
 * Outreach audit log — append-only event logging for SMS/email outreach.
 * NEVER DELETE from this table (Epic 2 postmortem lesson).
 */

import { getSupabaseAdminClient } from "../persistence";

export type OutreachAuditEvent = {
  tenantId: string;
  channel: "sms" | "email";
  sendId?: string;
  candidateId: string;
  senderUserId?: string;
  senderRole?: string;
  templateId?: string;
  templateAgenda?: string;
  deliveryStatus: string;
  contentHash?: string;
  complianceCheckPassed?: boolean;
  blockedReason?: string;
};

/**
 * Log an outreach event to the append-only audit log.
 */
export async function logOutreachEvent(
  event: OutreachAuditEvent,
): Promise<void> {
  try {
    const client = getSupabaseAdminClient();
    const { error } = await client.from("outreach_audit_log").insert({
      tenant_id: event.tenantId,
      channel: event.channel,
      send_id: event.sendId,
      candidate_id: event.candidateId,
      sender_user_id: event.senderUserId,
      sender_role: event.senderRole,
      template_id: event.templateId,
      template_agenda: event.templateAgenda,
      delivery_status: event.deliveryStatus,
      content_hash: event.contentHash,
      compliance_check_passed: event.complianceCheckPassed,
      blocked_reason: event.blockedReason,
    });

    if (error) {
      // Audit logging must never block the send pipeline
      console.error("[outreach-audit] Failed to log event:", error.message);
    }
  } catch (err) {
    console.error("[outreach-audit] Unexpected error:", err);
  }
}
