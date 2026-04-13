/**
 * Email-specific candidate extraction — thin wrapper around the unified service.
 *
 * Re-exports CandidateExtraction type for backwards compatibility.
 * Delegates LLM extraction to the centralized candidate-extraction service.
 */

import {
  extractCandidateFromDocument,
  type CandidateExtraction,
} from '../../features/candidate-management/application/candidate-extraction';
import { uploadFileToStorage } from '../../features/candidate-management/infrastructure/storage';

// Re-export for backwards compatibility
export type { CandidateExtraction };

export async function extractCandidateFromEmail(
  emailBody: string,
  subject: string
): Promise<CandidateExtraction> {
  const result = await extractCandidateFromDocument(emailBody, 'email_body', {
    source: 'email',
    tenantId: 'cbl-aero',
    subject,
  });

  if (result.extraction) {
    return result.extraction;
  }

  // On error, return empty non-submission record (matches previous behavior)
  console.error('[EmailParser] Extraction failed:', result.error);
  return {
    firstName: '',
    lastName: '',
    email: '',
    source: 'email',
    extractionMethod: 'llm' as const,
    isSubmission: false,
  };
}

/**
 * Upload email attachment to Supabase Storage.
 * Delegates to the shared uploadFileToStorage with email-specific path convention.
 * Path: /{candidateId_short}/{submissionId_short}/{filename}
 */
export async function uploadAttachmentToStorage(
  _db: unknown,
  buffer: Buffer,
  filename: string,
  candidateId: string,
  submissionId: string
): Promise<{ filename: string; url: string; size: number }> {
  const candidateShort = candidateId.slice(0, 8);
  const submissionShort = submissionId.slice(0, 8);
  const storagePath = `${candidateShort}/${submissionShort}`;
  const result = await uploadFileToStorage(buffer, filename, storagePath);

  if (!result.url) {
    throw new Error(`Upload failed for ${filename}`);
  }

  return {
    filename,
    url: result.url,
    size: result.size,
  };
}
