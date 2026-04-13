import {
  getSharedAnthropicClient,
  clearClientForTest,
  callLlm,
  loadPrompt,
  registerFallbackPrompt,
} from '@/modules/ai';

/**
 * Unified candidate extraction service.
 *
 * Centralizes LLM-powered extraction from any unstructured content type
 * (PDF resumes, email bodies, email attachments). Each content type has
 * a pre-processor that normalizes to plain text before a shared LLM call.
 */

// ---- Shared Types ----

export interface CandidateExtraction {
  // Core identity
  firstName: string;
  lastName: string;
  middleName?: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;

  // Position details
  jobTitle?: string;
  client?: string;
  location?: string;
  employmentType?: string;
  shiftPreference?: string;
  expectedStartDate?: string;

  // Compensation
  currentRate?: string;
  perDiem?: string;

  // Qualifications
  skills?: string[];
  certifications?: string[];
  aircraftExperience?: string[];
  hasAPLicense?: boolean;
  yearsOfExperience?: string;
  workAuthorization?: string;
  clearance?: string;

  // Availability
  callAvailability?: string;
  interviewAvailability?: string;

  // Social / web presence
  linkedinUrl?: string;

  // Metadata
  ceipalId?: string;
  submittedBy?: string;
  submitterEmail?: string;
  source: string;

  // Catch-all for fields not in the schema
  additionalFields?: Record<string, string>;

  // Tracks which extraction method was used
  extractionMethod?: 'llm' | 'regex' | 'ocr+llm';

  // Whether LLM classified this as a candidate submission email
  isSubmission?: boolean;

  // Role deduction (populated post-extraction)
  deducedRoles?: string[];
  roleDeductionMetadata?: Record<string, unknown>;
}

export type ContentType = 'pdf' | 'email_body' | 'email_attachment';

export interface ExtractionMetadata {
  source: string;
  tenantId: string;
  batchId?: string;
  subject?: string;
}

export interface ExtractionResult {
  extraction: CandidateExtraction | null;
  error?: string;
  extractionModel?: string;
}

// ---- Prompt ----

const EXTRACTION_PROMPT = `You are a candidate data extraction agent for a multi-business staffing company (CBL Solutions — includes CBL Aero, DataSkate, and other divisions).

You will receive text content from a document (resume, email, or attachment). Extract ALL candidate information into structured JSON.

For EMAIL content: First determine if it is a candidate submission email. A submission is ANY email where a recruiter is presenting a candidate for a job role — across ALL business units and industries (aviation, IT, legal, engineering, etc.). If it is NOT a submission (e.g. internal team allocation reports, FYI/status updates, calendar invites, newsletters, reply threads without candidate data, meeting notes, requirement allocation sheets), return:
{"isSubmission": false}

For RESUME/PDF content: Always treat as a candidate submission (isSubmission: true).

If it IS a candidate submission, extract ALL candidate information into structured JSON.

Return ONLY valid JSON matching this schema (omit fields that are not present):
{
  "isSubmission": true,
  "firstName": "string (required)",
  "lastName": "string (required)",
  "middleName": "string",
  "email": "string (required - candidate's email, NOT the recruiter's)",
  "phone": "string",
  "address": "string",
  "city": "string",
  "state": "string",
  "zipCode": "string",
  "country": "string",
  "jobTitle": "string (the position/role being applied for or current role)",
  "client": "string (the client company, e.g. MHIRJ, AeroGuard)",
  "location": "string (job location or candidate location)",
  "employmentType": "string (Contract, Direct Hire, etc.)",
  "shiftPreference": "string",
  "expectedStartDate": "string",
  "currentRate": "string (pay rate including currency)",
  "perDiem": "string",
  "skills": ["array of skill strings"],
  "certifications": ["array of certification strings, e.g. FAA A&P License"],
  "aircraftExperience": ["array of aircraft types, e.g. Boeing 737, Airbus A320"],
  "hasAPLicense": true/false,
  "yearsOfExperience": "string",
  "workAuthorization": "string (e.g. US Citizen, Green Card, H1B)",
  "clearance": "string",
  "callAvailability": "string",
  "interviewAvailability": "string",
  "linkedinUrl": "string (LinkedIn profile URL if present)",
  "ceipalId": "string (numeric ID from Ceipal ATS)",
  "submittedBy": "string (recruiter name who submitted)",
  "submitterEmail": "string (recruiter's email)",
  "additionalFields": {"key": "value for any other relevant data not covered above"}
}

Rules:
- Extract the CANDIDATE's email/phone, not the submitting recruiter's
- Parse the subject line for client, location, role if not in body
- "A&P License: Yes" means hasAPLicense: true and add "FAA A&P License" to certifications
- Split aircraft types into individual entries (e.g. "Boeing 737", "Boeing 747", not "Boeing (737, 747)")
- Normalize phone numbers to include country code if present
- Return ONLY the JSON object, no markdown fencing, no backticks, no explanation
- Use EXACTLY these field names — do not rename or nest them`;

// Register inline fallback so prompt-registry works without DB
registerFallbackPrompt({
  name: 'candidate-extraction',
  version: '1.0.0',
  prompt_text: EXTRACTION_PROMPT,
  model: 'claude-haiku-4-5-20251001',
});

// ---- Re-export client reset for test compatibility ----

export function _resetClientForTest(): void {
  clearClientForTest();
}

// ---- Content Pre-processors ----

const MAX_CONTENT_LENGTH = 10_000;

// Lazy-loaded pdf-parse function — allows test injection via _setPdfParseForTest
let _pdfParseFn: ((buf: Buffer) => Promise<{ text: string }>) | null = null;

async function getPdfParse(): Promise<(buf: Buffer) => Promise<{ text: string }>> {
  if (_pdfParseFn) return _pdfParseFn;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _pdfParseFn = require('pdf-parse/lib/pdf-parse.js');
  return _pdfParseFn!;
}

export function _setPdfParseForTest(fn: ((buf: Buffer) => Promise<{ text: string }>) | null): void {
  _pdfParseFn = fn;
}

/** Sentinel returned when pdf-parse yields no text (scanned image PDF) */
export const PDF_NO_TEXT = '__PDF_NO_TEXT__';

export async function preprocessPdf(content: Buffer): Promise<string> {
  const pdfParse = await getPdfParse();
  const result = await pdfParse(content);
  const text = (result.text as string).trim();
  if (!text) {
    return PDF_NO_TEXT;
  }
  return text.slice(0, MAX_CONTENT_LENGTH);
}

export function preprocessEmailBody(content: string, subject?: string): string {
  const plainBody = content
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (subject) {
    const prefix = `Subject: ${subject}\n\nEmail Body:\n`;
    return (prefix + plainBody).slice(0, MAX_CONTENT_LENGTH);
  }
  return plainBody.slice(0, MAX_CONTENT_LENGTH);
}

// ---- Core Extraction ----

export async function extractCandidateFromDocument(
  content: Buffer | string,
  contentType: ContentType,
  metadata: ExtractionMetadata
): Promise<ExtractionResult> {
  try {
    let plainText: string;
    switch (contentType) {
      case 'pdf':
        if (!(content instanceof Buffer)) {
          return { extraction: null, error: 'PDF content must be a Buffer' };
        }
        plainText = await preprocessPdf(content);
        break;
      case 'email_body':
        if (typeof content !== 'string') {
          return { extraction: null, error: 'Email body content must be a string' };
        }
        plainText = preprocessEmailBody(content, metadata.subject);
        break;
      case 'email_attachment':
        if (content instanceof Buffer) {
          plainText = await preprocessPdf(content);
        } else {
          plainText = String(content).slice(0, MAX_CONTENT_LENGTH);
        }
        break;
      default:
        return { extraction: null, error: `Unsupported content type: ${contentType}` };
    }

    const client = getSharedAnthropicClient();
    if (!client) {
      if (contentType === 'email_body') {
        console.warn('[CandidateExtraction] ANTHROPIC_API_KEY not set — using regex fallback');
        return {
          extraction: extractWithRegex(typeof content === 'string' ? content : '', metadata.subject ?? '', metadata.source),
        };
      }
      return { extraction: null, error: 'ANTHROPIC_API_KEY not configured — cannot extract from PDF without LLM' };
    }

    // Scanned image PDF: send raw PDF as document block for Claude vision OCR
    if (plainText === PDF_NO_TEXT && content instanceof Buffer) {
      console.log('[CandidateExtraction] No extractable text — using PDF vision (OCR fallback)');
      return await extractWithLLMVision(content, metadata.source);
    }

    return await extractWithLLM(plainText, metadata.source, contentType);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { extraction: null, error: message };
  }
}

const ALLOWED_EXTRACTION_KEYS = new Set([
  'isSubmission', 'firstName', 'lastName', 'middleName', 'email', 'phone',
  'address', 'city', 'state', 'zipCode', 'country',
  'jobTitle', 'client', 'location', 'employmentType', 'shiftPreference', 'expectedStartDate',
  'currentRate', 'perDiem',
  'skills', 'certifications', 'aircraftExperience', 'hasAPLicense', 'yearsOfExperience',
  'workAuthorization', 'clearance',
  'callAvailability', 'interviewAvailability',
  'linkedinUrl',
  'ceipalId', 'submittedBy', 'submitterEmail',
  'additionalFields',
]);

function sanitizeLlmResponse(parsed: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(parsed)) {
    if (ALLOWED_EXTRACTION_KEYS.has(key)) {
      sanitized[key] = parsed[key];
    }
  }
  return sanitized;
}

async function extractWithLLM(
  plainText: string,
  source: string,
  contentType: ContentType
): Promise<ExtractionResult> {
  // Load prompt from registry (DB or fallback)
  const promptRecord = await loadPrompt('candidate-extraction');
  const systemPrompt = promptRecord?.prompt_text ?? EXTRACTION_PROMPT;
  const model = promptRecord?.model ?? 'claude-haiku-4-5-20251001';

  const result = await callLlm(model, systemPrompt, plainText, {
    module: 'candidate-extraction',
    action: 'extract',
    promptName: 'candidate-extraction',
    promptVersion: promptRecord?.version ?? '1.0.0',
  });

  if (!result) {
    return { extraction: null, error: 'LLM call returned null — client unavailable', extractionModel: model };
  }

  let responseText = result.text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  try {
    const parsed = JSON.parse(responseText);

    if (contentType === 'email_body' && parsed.isSubmission === false) {
      return {
        extraction: {
          firstName: '', lastName: '', email: '', source,
          extractionMethod: 'llm' as const, isSubmission: false,
        },
        extractionModel: model,
      };
    }

    // Whitelist known CandidateExtraction keys to prevent LLM injection of internal fields
    const sanitized = sanitizeLlmResponse(parsed);

    // Log fill rate for extraction quality monitoring (dev-standards §21)
    const totalFields = ALLOWED_EXTRACTION_KEYS.size - 1; // exclude isSubmission
    const fieldsPopulated = Object.keys(sanitized).filter(
      (k) => k !== 'isSubmission' && sanitized[k] != null && sanitized[k] !== ''
    ).length;
    const fillRate = Math.round((fieldsPopulated / totalFields) * 100);
    console.log(
      JSON.stringify({
        level: 'info',
        module: 'candidate-extraction',
        action: 'extraction_complete',
        fillRate,
        fieldsPopulated,
        totalFields,
        promptVersion: promptRecord?.version ?? '1.0.0',
      })
    );

    return {
      extraction: {
        ...sanitized,
        source,
        extractionMethod: 'llm' as const,
        isSubmission: contentType === 'pdf' ? true : parsed.isSubmission === true,
      } as CandidateExtraction,
      extractionModel: model,
    };
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error', module: 'candidate-extraction', action: 'parse_llm_response',
      error: err instanceof Error ? err.message : String(err),
      responseSnippet: responseText.slice(0, 200),
    }));
    return { extraction: null, error: 'Failed to parse LLM extraction response', extractionModel: model };
  }
}

/**
 * Vision-based extraction for scanned-image PDFs.
 * Sends the raw PDF as a base64 document block to Claude, which reads it visually.
 * Only called when pdf-parse returns no text.
 */
async function extractWithLLMVision(
  pdfBuffer: Buffer,
  source: string,
): Promise<ExtractionResult> {
  const promptRecord = await loadPrompt('candidate-extraction');
  const systemPrompt = promptRecord?.prompt_text ?? EXTRACTION_PROMPT;
  const model = promptRecord?.model ?? 'claude-haiku-4-5-20251001';

  // Send PDF as a document content block — Claude reads it visually
  const contentBlocks = [
    {
      type: 'document' as const,
      source: {
        type: 'base64' as const,
        media_type: 'application/pdf' as const,
        data: pdfBuffer.toString('base64'),
      },
    },
    {
      type: 'text' as const,
      text: 'Extract candidate data from this resume PDF.',
    },
  ];

  const result = await callLlm(model, systemPrompt, contentBlocks, {
    module: 'candidate-extraction',
    action: 'extract_vision',
    promptName: 'candidate-extraction',
    promptVersion: promptRecord?.version ?? '1.0.0',
  });

  if (!result) {
    return { extraction: null, error: 'LLM vision call returned null — client unavailable', extractionModel: model };
  }

  let responseText = result.text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  try {
    const parsed = JSON.parse(responseText);
    const sanitized = sanitizeLlmResponse(parsed);

    const totalFields = ALLOWED_EXTRACTION_KEYS.size - 1;
    const fieldsPopulated = Object.keys(sanitized).filter(
      (k) => k !== 'isSubmission' && sanitized[k] != null && sanitized[k] !== ''
    ).length;
    const fillRate = Math.round((fieldsPopulated / totalFields) * 100);
    console.log(
      JSON.stringify({
        level: 'info', module: 'candidate-extraction', action: 'extraction_complete_vision',
        fillRate, fieldsPopulated, totalFields, promptVersion: promptRecord?.version ?? '1.0.0',
      })
    );

    return {
      extraction: {
        ...sanitized,
        source,
        extractionMethod: 'ocr+llm' as const,
        isSubmission: true,
      } as CandidateExtraction,
      extractionModel: model,
    };
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error', module: 'candidate-extraction', action: 'parse_vision_response',
      error: err instanceof Error ? err.message : String(err),
      responseSnippet: responseText.slice(0, 200),
    }));
    return { extraction: null, error: 'Failed to parse LLM vision response', extractionModel: model };
  }
}

function extractWithRegex(emailBody: string, subject: string, source: string): CandidateExtraction {
  const text = emailBody.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');

  const fullNameMatch = text.match(/Full\s*(?:Legal\s*)?Name[:\s]+([^\n|]+?)(?=\s*(?:Position|Role|Email|Contact|Address|$))/i);
  const firstNameMatch = text.match(/First\s*Name[:\s]+([^\n<|]+)/i);
  const lastNameMatch = text.match(/Last\s*Name[:\s]+([^\n<|]+)/i);

  let firstName = firstNameMatch?.[1]?.trim() ?? '';
  let lastName = lastNameMatch?.[1]?.trim() ?? '';
  if (!firstName && fullNameMatch) {
    const parts = fullNameMatch[1].trim().split(/\s+/);
    firstName = parts[0] ?? '';
    lastName = parts.slice(1).join(' ');
  }

  const emailMatch = text.match(/E-?mail[:\s]+([^\s<\n|]+@[^\s<\n|]+)/i);
  const phoneMatch = text.match(/(?:Contact\s*Number|Phone|Mobile|Cell)[:\s]+([\d\s\-().+]{7,20})/i);
  const positionMatch = text.match(/Position[:\s]+([^\n|]+?)(?=\s*(?:Full|Role|Address|Contact|Email|Work Auth|$))/i);
  const workAuthMatch = text.match(/Work\s*Authorization[:\s]+([^\n|]+?)(?=\s*(?:Current|Rate|Specific|#|Expected|$))/i);
  const ceipalIdMatch = text.match(/Ci?epal\s*ID[:\s]+(\d+)/i);

  const subjectParts = subject.split('|').map((s) => s.trim());

  return {
    firstName,
    lastName,
    email: emailMatch?.[1]?.trim() ?? '',
    phone: phoneMatch?.[1]?.trim() ?? undefined,
    jobTitle: positionMatch?.[1]?.trim() ?? subjectParts[0] ?? undefined,
    client: subjectParts.length >= 3 ? subjectParts[2] : undefined,
    location: subjectParts.length >= 4 ? subjectParts[3] : undefined,
    employmentType: subjectParts.length >= 2 ? subjectParts[1] : undefined,
    workAuthorization: workAuthMatch?.[1]?.trim() ?? undefined,
    ceipalId: ceipalIdMatch?.[1] ?? undefined,
    source,
    extractionMethod: 'regex',
  };
}
