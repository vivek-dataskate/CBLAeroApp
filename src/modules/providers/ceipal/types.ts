/**
 * Ceipal applicant type.
 *
 * Review patch L-4: canonical home is here (inside the provider module) so
 * `providers/ceipal/*` no longer reaches back into `ats/` for a type it owns.
 * `src/modules/ats/ceipal-types.ts` re-exports from this file for
 * back-compat with the legacy import path.
 *
 * SSN is intentionally excluded — PII that must not be stored or logged.
 */
export type CeipalApplicant = {
  first_name: string;
  middle_name?: string;
  last_name: string;
  nick_name?: string;
  email_address: string;
  alternate_email_address?: string;
  home_phone_number?: string;
  mobile_number?: string;
  work_phone_number?: string;
  other_phone?: string;
  date_of_birth?: string;
  work_authorization?: string;
  clearance?: string;
  address?: string;
  city?: string;
  country?: string;
  state?: string;
  zip_code?: string;
  source?: string;
  experience?: string;
  applicant_status?: string;
  job_title?: string;
  skills?: string;
  primary_skills?: string;
  technology?: string;
  relocation?: string;
  gender?: string;
  veteran_status?: string;
  work_authorization_expiry?: string;
  linkedin_profile_url?: string;
  facebook_profile_url?: string;
  twitter_profile_url?: string;
  additional_comments?: string;
  expected_pay?: string;
  applicant_id?: string;
  resume_path?: string;
  referred_by?: string;
  applicant_group?: string;
  ownership?: string;
  tax_terms?: number;
  race_ethnicity?: string;
  disability?: string;
  gpa?: string;
  referral_employee?: string;
  video_reference?: string;
  skype_id?: string;
  // ssn intentionally excluded — PII that must not be stored or logged
  modified_date?: string;
  created_on?: string;
  created_by?: string;
  modified_by?: string;
};
