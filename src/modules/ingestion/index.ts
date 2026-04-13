import { isSupabaseConfigured } from '../persistence';
import { uploadAttachmentToStorage } from '../email/nlp-extract-and-upload';
import {
  findSubmissionByMessageId,
  insertSubmission,
} from '@/features/candidate-management/infrastructure/submission-repository';
import {
  upsertCandidateByEmail,
  insertCandidateNoEmail,
  batchUpsertCandidatesByEmail,
  batchInsertCandidatesNoEmail,
} from '@/features/candidate-management/infrastructure/candidate-repository';
import { deduceRoles } from '@/features/candidate-management/application/role-deduction';
import { updateAvailabilityStatus } from '@/features/candidate-management/infrastructure/availability-repository';

// Re-export sync error/run functions from centralized repository for backward compatibility
export {
  recordSyncFailure,
  listRecentSyncErrors,
  clearSyncErrorsForTest,
  createSyncRun,
  completeSyncRun,
  failSyncRun,
  listSyncRunsCurrentMonth,
  listSyncErrorsByRun,
} from '@/features/candidate-management/infrastructure/sync-error-repository';
export type { SyncError, SyncRun } from '@/features/candidate-management/infrastructure/sync-error-repository';

// Local import for use within this barrel module (re-export above makes it available to consumers)
import { recordSyncFailure } from '@/features/candidate-management/infrastructure/sync-error-repository';

export type IngestionSource = "csv" | "ats" | "email" | "ceipal" | "resume_upload";

// Default tenant for single-tenant MVP
export const DEFAULT_TENANT_ID = 'cbl-aero';

// --- Candidate upsert (real Supabase persistence) ---

/**
 * Batch upsert candidates from ATS. Uses repository functions for DB access.
 * Much faster than individual inserts for bulk loads.
 */
export async function batchUpsertCandidatesFromATS(records: Record<string, unknown>[]): Promise<{ inserted: number; failed: number }> {
  if (!isSupabaseConfigured() || records.length === 0) return { inserted: 0, failed: 0 };

  let failed = 0;

  // Filter out records with no email and no phone
  const validRecords: Record<string, unknown>[] = [];
  for (const record of records) {
    const email = typeof record.email === 'string' ? record.email.trim() : '';
    const phone = typeof record.phone === 'string' ? record.phone.trim() : '';
    if (!email && !phone) {
      recordSyncFailure(String(record.source ?? 'ats'), String(record.firstName ?? 'unknown'),
        new Error('Candidate has no email or phone — cannot insert'));
      failed++;
      continue;
    }
    validRecords.push(record);
  }

  if (validRecords.length === 0) return { inserted: 0, failed };

  const rows = validRecords.map((r) => {
    const source = typeof r.source === 'string' ? r.source : 'ats';
    return mapToCandidateRow(r, source);
  });

  // Split into rows with email (can upsert) and without (insert only)
  const withEmail = rows.filter((r) => r.email);
  const withoutEmail = rows.filter((r) => !r.email);

  let totalInserted = 0;

  // Batch upsert rows that have email — uses partial unique index
  if (withEmail.length > 0) {
    try {
      await batchUpsertCandidatesByEmail(withEmail);
      totalInserted += withEmail.length;
    } catch (upsertErr) {
      console.error(`[Ingestion] Batch upsert (with email) failed: ${upsertErr instanceof Error ? upsertErr.message : upsertErr}`);
      // Fall back to individual inserts
      for (const record of validRecords.filter((r) => r.email)) {
        try { await upsertCandidateFromATS(record); totalInserted++; } catch (err) {
          recordSyncFailure(String(record.source ?? 'ats'), String(record.email ?? 'unknown'), err); failed++;
        }
      }
    }
  }

  // Insert rows without email (no dedup possible)
  if (withoutEmail.length > 0) {
    try {
      await batchInsertCandidatesNoEmail(withoutEmail);
      totalInserted += withoutEmail.length;
    } catch (insertErr) {
      console.error(`[Ingestion] Batch insert (no email) failed: ${insertErr instanceof Error ? insertErr.message : insertErr}`);
      failed += withoutEmail.length;
    }
  }

  console.log(`[Ingestion] Batch upserted ${totalInserted} candidates`);
  return { inserted: totalInserted, failed };
}

export async function upsertCandidateFromATS(record: Record<string, unknown>): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.log('[Ingestion] Supabase not configured — skipping persist:', record.email ?? record.firstName);
    return;
  }

  const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
  const phone = typeof record.phone === 'string' ? record.phone.trim() : '';
  const source = typeof record.source === 'string' ? record.source : 'ats';

  // Pre-validate: candidates table requires email or phone
  if (!email && !phone) {
    recordSyncFailure(source, String(record.firstName ?? 'unknown'), new Error('Candidate has no email or phone — cannot insert'));
    return;
  }

  const candidateRow = mapToCandidateRow(record, source);

  if (email) {
    await upsertCandidateByEmail(candidateRow);
    console.log(`[Ingestion] Upserted candidate ${email}`);
  } else {
    await insertCandidateNoEmail(candidateRow);
    console.log(`[Ingestion] Inserted candidate (no email): ${record.firstName} ${record.lastName}`);
  }
}

export async function upsertCandidateFromEmailFull(record: {
  id: string;
  subject: string;
  body: string;
  attachments?: Array<{ filename: string; content?: Buffer }>;
  candidate: Record<string, unknown>;
  receivedAt: string;
}): Promise<'processed' | 'dedup_skip' | void> {
  if (!isSupabaseConfigured()) {
    console.log('[Ingestion] Supabase not configured — skipping email persist:', record.subject);
    return;
  }

  const email = typeof record.candidate.email === 'string' ? record.candidate.email.trim().toLowerCase() : '';
  const source = typeof record.candidate.source === 'string' ? record.candidate.source : 'email';

  // 1. Dedup check FIRST — skip all DB writes if this email was already processed
  const existingSub = await findSubmissionByMessageId(record.id, DEFAULT_TENANT_ID);
  if (existingSub) {
    console.log(`[Ingestion] Skipping already-processed email: ${record.subject}`);
    return 'dedup_skip';
  }

  // 1b. Deduce roles from extracted data (LLM path — single email, acceptable latency)
  try {
    const c = record.candidate;
    const roleResult = await deduceRoles(
      {
        jobTitle: typeof c.jobTitle === 'string' ? c.jobTitle : null,
        skills: Array.isArray(c.skills) ? c.skills : [],
        certifications: Array.isArray(c.certifications) ? c.certifications : [],
        aircraftExperience: Array.isArray(c.aircraftExperience) ? c.aircraftExperience : [],
      },
      DEFAULT_TENANT_ID,
    );
    record.candidate.deducedRoles = roleResult.roles;
    record.candidate.roleDeductionMetadata = roleResult.metadata;
  } catch (err) {
    console.warn(`[Ingestion] Role deduction failed for email "${record.subject}":`, err instanceof Error ? err.message : err);
    // Non-fatal — candidate proceeds with empty deduced_roles
  }

  // 2. Upsert the candidate record via repository — single round-trip
  const candidateRow = mapToCandidateRow(record.candidate, source);
  let candidateId: string | null = null;
  const phone = typeof record.candidate.phone === 'string' ? record.candidate.phone.trim() : '';

  if (email) {
    candidateId = await upsertCandidateByEmail(candidateRow);
    console.log(`[Ingestion] Upserted candidate ${email} from email`);
  } else if (phone) {
    candidateId = await insertCandidateNoEmail(candidateRow);
  } else {
    // No email or phone — can't create candidate, but still save submission evidence
    console.warn(`[Ingestion] No email or phone for "${record.subject}" — saving submission evidence only`);
  }

  // 3. Build submission record
  const submissionId = crypto.randomUUID();
  const extractionModel = typeof record.candidate.extractionModel === 'string'
    ? record.candidate.extractionModel
    : (record.candidate.extractionMethod === 'llm' ? 'claude-haiku-4-5-20251001' : 'regex-fallback');

  // 4. Upload attachments to Supabase Storage
  const attachmentMeta: Array<{ filename: string; url: string; size: number }> = [];
  for (const att of record.attachments ?? []) {
    if (!att.content) {
      attachmentMeta.push({ filename: att.filename, url: '', size: 0 });
      continue;
    }
    try {
      const result = await uploadAttachmentToStorage(null, att.content, att.filename, candidateId ?? 'no-candidate', submissionId);
      attachmentMeta.push(result);
    } catch (err) {
      console.warn(`[Ingestion] Attachment upload failed for ${att.filename}:`, err instanceof Error ? err.message : err);
      attachmentMeta.push({ filename: att.filename, url: '', size: att.content.length });
    }
  }

  // 5. Save submission evidence with attachment URLs via repository
  try {
    await insertSubmission({
      id: submissionId,
      tenantId: DEFAULT_TENANT_ID,
      candidateId: candidateId ?? undefined,
      source,
      emailMessageId: record.id,
      emailSubject: record.subject,
      emailBody: record.body,
      emailFrom: typeof record.candidate.submitterEmail === 'string' ? record.candidate.submitterEmail : null,
      emailReceivedAt: record.receivedAt,
      extractedData: record.candidate,
      extractionModel,
      attachments: attachmentMeta,
    });
    const attCount = attachmentMeta.filter((a) => a.url).length;
    console.log(`[Ingestion] Saved submission evidence for ${record.subject} (${attCount} attachments uploaded)`);

    // Record engagement signal — email submission means recruiter talked to candidate
    if (candidateId) {
      updateAvailabilityStatus(DEFAULT_TENANT_ID, candidateId, 'active', 'engagement', {
        source: 'email_submission',
        emailSubject: record.subject,
      }).catch((err) => {
        console.warn(`[Ingestion] Engagement signal failed for ${candidateId}:`, err instanceof Error ? err.message : err);
      });
    }
  } catch (subError) {
    console.error(`[Ingestion] Submission evidence insert failed: ${subError instanceof Error ? subError.message : subError}`);
    recordSyncFailure('email', record.id, subError);
  }
}

// --- Map extracted data to candidates table columns ---

export function mapToCandidateRow(record: Record<string, unknown>, source: string, overrides?: { ingestion_state?: string }) {
  const str = (key: string) => typeof record[key] === 'string' ? record[key].trim() : null;
  const firstName = str('firstName') ?? '';
  const lastName = str('lastName') ?? '';

  return {
    tenant_id: DEFAULT_TENANT_ID,
    first_name: firstName,
    last_name: lastName,
    middle_name: str('middleName'),
    email: str('email')?.toLowerCase() || null,
    alternate_email: str('alternateEmail') || null,
    phone: str('phone') || null,
    home_phone: str('homePhone'),
    work_phone: str('workPhone'),
    address: str('address'),
    city: str('city'),
    state: str('state'),
    country: str('country'),
    postal_code: str('zipCode') ?? str('postalCode'),
    location: str('location'),
    job_title: str('jobTitle'),
    current_company: str('client'),
    source,
    work_authorization: str('workAuthorization'),
    clearance: str('clearance'),
    aircraft_experience: Array.isArray(record.aircraftExperience) ? record.aircraftExperience : [],
    employment_type: str('employmentType'),
    current_rate: str('currentRate'),
    per_diem: str('perDiem'),
    has_ap_license: typeof record.hasAPLicense === 'boolean' ? record.hasAPLicense : null,
    years_of_experience: str('yearsOfExperience'),
    ceipal_id: str('ceipalId'),
    submitted_by: str('submittedBy'),
    submitter_email: str('submitterEmail'),
    shift_preference: str('shiftPreference'),
    expected_start_date: str('expectedStartDate'),
    call_availability: str('callAvailability'),
    interview_availability: str('interviewAvailability'),
    veteran_status: str('veteranStatus'),
    linkedin_url: str('linkedinUrl'),
    skills: Array.isArray(record.skills) ? record.skills : [],
    certifications: Array.isArray(record.certifications) ? record.certifications : [],
    availability_status: 'active',
    ingestion_state: overrides?.ingestion_state ?? 'pending_dedup',
    created_by_actor_id: str('createdByActorId'),
    extra_attributes: record.additionalFields && typeof record.additionalFields === 'object'
      ? record.additionalFields
      : (record.extra_attributes && typeof record.extra_attributes === 'object' ? record.extra_attributes : {}),
    deduced_roles: Array.isArray(record.deducedRoles) ? record.deducedRoles
      : (Array.isArray(record.deduced_roles) ? record.deduced_roles : []),
  };
}
