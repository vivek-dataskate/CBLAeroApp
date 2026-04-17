/**
 * SMS outreach scheduler jobs — process pending SMS sends.
 */

import type { SchedulerJob, SchedulerRegistration } from "../ingestion/jobs";
import { canSendSMS } from "./consent-gate";
import { isWithinContactWindow, nextAllowedSendTime } from "./contact-window";
import { getTemplate } from "./sms-template-repository";
import { renderTemplate, computeContentHash } from "./template-renderer";
import { getDueSends, updateSendStatus } from "./send-repository";
import { logOutreachEvent } from "./audit";
import { getSMSProvider } from "./sms-provider";
import { buildTrackingUrl } from "./tracking";
import { getSupabaseAdminClient } from "../persistence";

/**
 * SMSOutreachJob — claims pending SMS sends and processes them through the
 * consent → contact window → render → send → audit pipeline.
 */
export class SMSOutreachJob implements SchedulerJob {
  name = "sms-outreach-dispatch";

  async run(): Promise<void> {
    // Resolve tenant ID from env (single-tenant for now)
    const tenantId = process.env.CBL_APP_TENANT_ID;
    if (!tenantId) {
      console.warn("[SMSOutreachJob] CBL_APP_TENANT_ID not set — skipping");
      return;
    }

    const dueSends = await getDueSends(tenantId, 100);
    if (dueSends.length === 0) return;

    console.log(
      `[SMSOutreachJob] Processing ${dueSends.length} pending SMS sends`,
    );

    const provider = getSMSProvider();
    let sent = 0;
    let blocked = 0;
    let deferred = 0;
    let failed = 0;

    for (const send of dueSends) {
      try {
        // 1. Consent gate — always check fresh
        const consent = await canSendSMS(send.candidateId, send.tenantId);
        if (!consent.allowed) {
          await updateSendStatus(send.id, {
            status: "blocked_opt_out",
            blockedReason: consent.blockedReason ?? "opted_out",
          });
          await logOutreachEvent({
            tenantId: send.tenantId,
            channel: "sms",
            sendId: send.id,
            candidateId: send.candidateId,
            senderUserId: send.senderUserId ?? undefined,
            deliveryStatus: "blocked_opt_out",
            complianceCheckPassed: false,
            blockedReason: consent.blockedReason ?? "opted_out",
          });
          blocked++;
          continue;
        }

        // 2. Contact window check
        // Fetch candidate state for timezone inference
        const client = getSupabaseAdminClient();
        const { data: candidate } = await client
          .from("candidates")
          .select("state, extra_attributes")
          .eq("id", send.candidateId)
          .single();

        const candidateForWindow = {
          state: candidate?.state as string | null,
          contactPreferences: null, // TODO: read from candidate_channel_preferences.contact_windows
        };

        if (!isWithinContactWindow(candidateForWindow)) {
          const nextOpen = nextAllowedSendTime(candidateForWindow);
          await updateSendStatus(send.id, {
            status: "deferred_window",
            contactWindowDeferredUntil: nextOpen ?? undefined,
          });
          deferred++;
          continue;
        }

        // 3. Fetch template for metadata
        const template = send.templateId
          ? await getTemplate(send.templateId)
          : null;

        // 4. Render body if not already rendered (for re-sends after deferral)
        let renderedBody = send.renderedBody;
        let contentHash = send.renderedBodyHash;
        if (!renderedBody && template) {
          // For scheduler-processed sends, the body should already be rendered
          // at send creation time. This is a safety fallback.
          const result = renderTemplate(template.body, send.contextParams as Record<string, string>);
          renderedBody = result.rendered;
          contentHash = result.contentHash;
        }

        if (!renderedBody) {
          await updateSendStatus(send.id, {
            status: "failed",
            blockedReason: "No rendered body available",
          });
          failed++;
          continue;
        }

        // 5. Look up candidate phone
        const { data: candidatePhone } = await client
          .from("candidates")
          .select("phone")
          .eq("id", send.candidateId)
          .single();

        const phone = candidatePhone?.phone as string | null;
        if (!phone) {
          await updateSendStatus(send.id, {
            status: "failed",
            blockedReason: "Candidate has no phone number",
          });
          failed++;
          continue;
        }

        // 6. Send via provider
        const idempotencyKey = `${send.tenantId}:${send.id}`;
        const result = await provider.send(phone, renderedBody, idempotencyKey);

        // 7. Update send status
        await updateSendStatus(send.id, {
          status: result.status === "delivered" ? "delivered" : "sent",
          provider: "stub",
          providerMessageId: result.messageId,
          sentAt: new Date(),
        });

        // 8. Audit log
        await logOutreachEvent({
          tenantId: send.tenantId,
          channel: "sms",
          sendId: send.id,
          candidateId: send.candidateId,
          senderUserId: send.senderUserId ?? undefined,
          templateId: send.templateId,
          templateAgenda: template?.agenda,
          deliveryStatus: result.status,
          contentHash: contentHash ?? undefined,
          complianceCheckPassed: true,
        });

        sent++;
      } catch (err) {
        console.error(
          `[SMSOutreachJob] Failed to process send ${send.id}:`,
          err,
        );
        await updateSendStatus(send.id, {
          status: "failed",
          blockedReason:
            err instanceof Error ? err.message : "Unknown error",
        });
        failed++;
      }
    }

    console.log(
      `[SMSOutreachJob] Complete: ${sent} sent, ${blocked} blocked, ${deferred} deferred, ${failed} failed`,
    );
  }
}

/**
 * Register outreach jobs with the global scheduler.
 */
export function registerOutreachJobs(scheduler: {
  register(job: SchedulerJob, metadata?: SchedulerRegistration): void;
}): void {
  scheduler.register(new SMSOutreachJob(), {
    jobKey: "sms-outreach-dispatch",
    scheduleName: "SMS Outreach Dispatch",
    cronExpression: "*/5 * * * *",
    enabled: true,
    policyFamily: "outreach_schedules",
    policyKey: "sms_outreach",
  });
}
