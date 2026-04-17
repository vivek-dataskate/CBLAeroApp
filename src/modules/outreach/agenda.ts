/**
 * SMS template agenda categories — maps recruiting workflow stages to template types.
 */

export const SMS_AGENDAS = [
  "new_opportunity",
  "availability_check",
  "job_followup",
  "submission_followup",
  "interview_schedule",
  "interview_reminder",
  "interview_followup",
  "bgv_initiation",
  "bgv_followup",
  "offer_extended",
  "onboarding",
  "reengagement",
  "general",
] as const;

export type SmsAgenda = (typeof SMS_AGENDAS)[number];

export const SMS_AGENDA_LABELS: Record<SmsAgenda, string> = {
  new_opportunity: "New Opportunity",
  availability_check: "Availability Check",
  job_followup: "Job Follow-up",
  submission_followup: "Submission Follow-up",
  interview_schedule: "Interview Schedule",
  interview_reminder: "Interview Reminder",
  interview_followup: "Interview Follow-up",
  bgv_initiation: "BGV Initiation",
  bgv_followup: "BGV Follow-up",
  offer_extended: "Offer Extended",
  onboarding: "Onboarding",
  reengagement: "Re-engagement",
  general: "General",
};

export function isValidAgenda(value: string): value is SmsAgenda {
  return (SMS_AGENDAS as readonly string[]).includes(value);
}

export function getAgendaLabel(agenda: SmsAgenda): string {
  return SMS_AGENDA_LABELS[agenda];
}
