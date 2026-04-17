/**
 * Outreach module — SMS template management, send pipeline, and engagement tracking.
 * Home for all Epic 3 outreach orchestration code.
 */

export { SMS_AGENDAS, SMS_AGENDA_LABELS, isValidAgenda, getAgendaLabel } from "./agenda";
export type { SmsAgenda } from "./agenda";

export { renderTemplate, computeContentHash, extractVariables } from "./template-renderer";

export { validateTemplate, ALLOWED_VARIABLES } from "./template-validator";

export {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  archiveTemplate,
} from "./sms-template-repository";
export type { SmsTemplate } from "./sms-template-repository";

export { isWithinContactWindow, nextAllowedSendTime, inferTimezone } from "./contact-window";

export { getChannelPreferences, recordOptOut } from "./consent-repository";
export { canSendSMS } from "./consent-gate";

export { generateTrackingToken, buildTrackingUrl, recordClick } from "./tracking";

export { getSMSProvider, StubSMSProvider } from "./sms-provider";
export type { SMSProvider, SendResult } from "./sms-provider";

export {
  createSend,
  createBatchSends,
  getDueSends,
  updateSendStatus,
  getSendHistory,
} from "./send-repository";

export { logOutreachEvent } from "./audit";

export { SMSOutreachJob, registerOutreachJobs } from "./jobs";
