/**
 * Ceipal ATS connector — v1 API
 *
 * Story 1-12a Task 3: HTTP transport migrated onto `BaseProviderClient`. This
 * module retains its public surface (`fetchCeipalApplicants`,
 * `mapCeipalApplicantToCandidate`, `getCeipalCreatedOn`, `CeipalApplicant`,
 * `clearCeipalTokenCacheForTest`) so `CeipalIngestionJob` and the rest of the
 * codebase see zero change — but the underlying calls go through the provider
 * framework with structured logging, auth-failure classification, and
 * registry-driven health tracking.
 *
 * Required env vars (set in Render):
 *   CEIPAL_API_KEY      — API key from Ceipal admin panel
 *   CEIPAL_USERNAME     — Ceipal login username
 *   CEIPAL_PASSWORD     — Ceipal login password
 *   CEIPAL_ENDPOINT_KEY — Ceipal custom applicant endpoint key
 *   CEIPAL_AUTH_URL     — (optional) override auth endpoint
 *   CEIPAL_DATA_URL     — (optional) override data endpoint
 */
import {
  getSharedCeipalClient,
  clearCeipalTokenCacheForTest as _clearCeipalTokenCacheForTest,
} from '@/modules/providers/ceipal';
import type { CeipalApplicant } from './ceipal-types';

export type { CeipalApplicant };

// Review patch M-12: `setSharedCeipalClient` and `resetSharedCeipalClientForTest`
// are provider-framework internals — they used to be re-exported here for
// test-setup convenience. Exposing them on the production ATS module surface
// let any caller swap the singleton mid-run and bypass startup wiring. Import
// them directly from `@/modules/providers/ceipal` in tests that still need
// the low-level reset.

/**
 * Fetch all applicants from Ceipal with pagination.
 * Supports optional date filter for incremental sync.
 *
 * Signature frozen by Story 2-3 preservation contract — internal transport
 * now flows through `CeipalProviderClient` / `BaseProviderClient`.
 */
export async function fetchCeipalApplicants(options?: {
  since?: Date;
  maxPages?: number;
  startPage?: number;
}): Promise<CeipalApplicant[]> {
  const client = getSharedCeipalClient();
  if (!client) {
    throw new Error(
      'Ceipal not configured. Required env vars: CEIPAL_API_KEY, CEIPAL_USERNAME, CEIPAL_PASSWORD, CEIPAL_ENDPOINT_KEY',
    );
  }
  return client.fetchApplicants(options);
}

/** Extract the created_on timestamp from a CEIPAL applicant for cursor tracking. */
export function getCeipalCreatedOn(a: CeipalApplicant): string | undefined {
  return a.created_on?.trim() || undefined;
}

/**
 * Map a Ceipal applicant to the ingestion candidate shape.
 * Pure function — unchanged across the Task 3 migration.
 */
export function mapCeipalApplicantToCandidate(a: CeipalApplicant): Record<string, unknown> {
  /** Trim whitespace, return undefined for empty. */
  const clean = (v?: string | number | null) => {
    if (v == null) return undefined;
    const s = String(v).trim();
    return s || undefined;
  };
  /** Clean + strip "NA" sentinel — use only for status/flag fields, not names. */
  const cleanNA = (v?: string | number | null) => {
    const s = clean(v);
    return s && s !== 'NA' ? s : undefined;
  };

  return {
    firstName: clean(a.first_name) ?? '',
    lastName: clean(a.last_name) ?? '',
    middleName: clean(a.middle_name),
    email: clean(a.email_address) ?? '',
    alternateEmail: clean(a.alternate_email_address),
    phone: clean(a.mobile_number) || clean(a.home_phone_number) || undefined,
    homePhone: clean(a.home_phone_number),
    workPhone: clean(a.work_phone_number),
    address: clean(a.address),
    city: clean(a.city),
    state: clean(a.state),
    country: clean(a.country),
    postalCode: clean(a.zip_code),
    jobTitle: clean(a.job_title),
    skills: a.skills ? a.skills.split(',').map((s) => s.trim()).filter(Boolean) : [],
    workAuthorization: cleanNA(a.work_authorization),
    clearance: cleanNA(a.clearance),
    yearsOfExperience: a.experience != null ? String(a.experience) : undefined,
    currentRate: clean(a.expected_pay),
    veteranStatus: cleanNA(a.veteran_status),
    ceipalId: clean(a.applicant_id),
    createdByActorId: clean(a.created_by),
    linkedinUrl: clean(a.linkedin_profile_url) || undefined,
    source: 'ceipal',
    // Additional fields stored in extra_attributes via additionalFields
    additionalFields: {
      ...(clean(a.resume_path) ? { resumeUrl: clean(a.resume_path) } : {}),
      ...(cleanNA(a.applicant_status) ? { applicantStatus: cleanNA(a.applicant_status) } : {}),
      ...(clean(a.source) ? { originalSource: clean(a.source) } : {}),
      ...(cleanNA(a.relocation) ? { relocation: cleanNA(a.relocation) } : {}),
      ...(clean(a.referred_by) ? { referredBy: clean(a.referred_by) } : {}),
      ...(clean(a.primary_skills) ? { primarySkills: clean(a.primary_skills) } : {}),
      ...(clean(a.technology) ? { technology: clean(a.technology) } : {}),
      ...(clean(a.work_authorization_expiry) ? { workAuthorizationExpiry: clean(a.work_authorization_expiry) } : {}),
      ...(clean(a.additional_comments) ? { comments: clean(a.additional_comments) } : {}),
      ...(clean(a.date_of_birth) ? { dateOfBirth: clean(a.date_of_birth) } : {}),
    },
  };
}

/** Preserved test hook — delegates to the strategy cache on the shared client. */
export function clearCeipalTokenCacheForTest(): void {
  _clearCeipalTokenCacheForTest();
}
