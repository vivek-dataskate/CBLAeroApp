/**
 * Template validation — enforces body constraints, TCPA compliance, and injection safety.
 */

import { isValidAgenda, type SmsAgenda } from "./agenda";
import { extractVariables } from "./template-renderer";

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

const MAX_BODY_LENGTH = 1600;
const STOP_PATTERNS = [/\bSTOP\b/i, /\bopt[- ]?out\b/i, /\bUNSUBSCRIBE\b/i];
const INJECTION_PATTERNS = [
  /<script\b/i,
  /javascript:/i,
  /on\w+\s*=/i, // onclick=, onerror=, etc.
  /data:\s*text\/html/i,
];

/**
 * Known template variables that can be used in SMS templates.
 */
export const ALLOWED_VARIABLES = new Set([
  "first_name",
  "last_name",
  "job_title",
  "company",
  "location",
  "recruiter_name",
  "interview_date",
  "interview_time",
  "interview_location",
  "start_date",
  "tracking_link",
]);

export function validateTemplate(input: {
  body: string;
  agenda: string;
  name: string;
}): ValidationResult {
  const errors: string[] = [];

  // Name
  if (!input.name || input.name.trim().length === 0) {
    errors.push("Template name is required");
  }

  // Agenda
  if (!isValidAgenda(input.agenda)) {
    errors.push(`Invalid agenda: ${input.agenda}`);
  }

  // Body presence
  if (!input.body || input.body.trim().length === 0) {
    errors.push("Template body is required");
    return { valid: false, errors };
  }

  // Body length
  if (input.body.length > MAX_BODY_LENGTH) {
    errors.push(
      `Body exceeds maximum length of ${MAX_BODY_LENGTH} characters (${input.body.length})`,
    );
  }

  // TCPA: must include STOP/opt-out language
  const hasOptOut = STOP_PATTERNS.some((p) => p.test(input.body));
  if (!hasOptOut) {
    errors.push(
      'Template must include opt-out language (e.g., "Reply STOP to opt out") for TCPA compliance',
    );
  }

  // Injection safety
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input.body)) {
      errors.push("Template body contains potentially unsafe content");
      break;
    }
  }

  // Variable allowlist check
  const usedVars = extractVariables(input.body);
  for (const v of usedVars) {
    if (!ALLOWED_VARIABLES.has(v)) {
      errors.push(`Unknown variable: {{${v}}}. Allowed: ${[...ALLOWED_VARIABLES].join(", ")}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
