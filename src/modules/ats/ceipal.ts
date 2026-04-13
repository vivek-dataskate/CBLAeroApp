import { fetchWithRetry } from '../ingestion/fetch-with-retry';

/**
 * Ceipal ATS connector — v1 API
 *
 * Required env vars (set in Render):
 *   CEIPAL_API_KEY      — API key from Ceipal admin panel
 *   CEIPAL_USERNAME     — Ceipal login username
 *   CEIPAL_PASSWORD     — Ceipal login password
 *
 * Auth endpoint:  POST https://api.ceipal.com/v1/createAuthtoken/
 * Data endpoint:  GET  https://api.ceipal.com/getCustomApplicantDetails/{endpoint_key}
 *
 * The endpoint key is embedded in the URL — stored as CEIPAL_ENDPOINT_KEY env var.
 * Default page size: 100 records per page.
 */

const CEIPAL_DEFAULT_AUTH_URL = 'https://api.ceipal.com/v1/createAuthtoken/';
const CEIPAL_DEFAULT_DATA_URL = 'https://api.ceipal.com/getCustomApplicantDetails';
const CEIPAL_PAGE_SIZE = 50;

type CeipalTokenCache = {
  token: string;
  expiresAt: number;
};

// Module-level cache: resets on serverless cold starts (acceptable — re-auth is cheap)
let tokenCache: CeipalTokenCache | null = null;

function getCeipalConfig() {
  const apiKey = process.env.CEIPAL_API_KEY;
  const username = process.env.CEIPAL_USERNAME;
  const password = process.env.CEIPAL_PASSWORD;
  const endpointKey = process.env.CEIPAL_ENDPOINT_KEY;
  const authUrl = process.env.CEIPAL_AUTH_URL || CEIPAL_DEFAULT_AUTH_URL;
  const dataUrl = process.env.CEIPAL_DATA_URL || CEIPAL_DEFAULT_DATA_URL;

  if (!apiKey || !username || !password || !endpointKey) {
    throw new Error(
      'Ceipal not configured. Required env vars: CEIPAL_API_KEY, CEIPAL_USERNAME, CEIPAL_PASSWORD, CEIPAL_ENDPOINT_KEY'
    );
  }

  return { apiKey, username, password, endpointKey, authUrl, dataUrl };
}

async function acquireCeipalToken(): Promise<string> {
  // Return cached token with 5-min buffer
  if (tokenCache && Date.now() < tokenCache.expiresAt - 300_000) {
    return tokenCache.token;
  }

  const { apiKey, username, password, authUrl } = getCeipalConfig();

  const response = await fetchWithRetry(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, email: username, password, json: 1 }),
  });

  if (!response.ok) {
    // Do NOT log response body — may echo back credentials
    throw new Error(`[Ceipal] Auth failed (${response.status}) — check Ceipal admin panel for details`);
  }

  const text = await response.text();

  // Response may be XML or JSON — try both
  let token: string | undefined;
  let expiresIn = 3600; // default 1 hour
  const xmlMatch = text.match(/<access_token>([^<]+)<\/access_token>/);
  if (xmlMatch) {
    token = xmlMatch[1];
  } else {
    try {
      const data = JSON.parse(text) as { token?: string; access_token?: string; expires_in?: number };
      token = data.token ?? data.access_token;
      if (typeof data.expires_in === 'number' && data.expires_in > 0) {
        expiresIn = data.expires_in;
      }
    } catch (parseErr) {
      console.warn('[Ceipal] JSON parse failed for auth response:', parseErr instanceof Error ? parseErr.message : parseErr);
    }
  }

  if (!token) {
    // Truncate and redact — auth response may contain echoed credentials
    throw new Error(`[Ceipal] Auth response missing token (response length: ${text.length})`);
  }

  tokenCache = { token, expiresAt: Date.now() + expiresIn * 1000 };
  console.log(`[Ceipal] Token acquired, expires in ${expiresIn}s`);

  return token;
}

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

/**
 * Fetch all applicants from Ceipal with pagination.
 * Supports optional date filter for incremental sync.
 */
export async function fetchCeipalApplicants(options?: {
  since?: Date;
  maxPages?: number;
  startPage?: number;
}): Promise<CeipalApplicant[]> {
  const token = await acquireCeipalToken();
  const { endpointKey, dataUrl } = getCeipalConfig();
  const baseUrl = `${dataUrl}/${endpointKey}`;

  const all: CeipalApplicant[] = [];
  let page = options?.startPage ?? 1;
  const maxPages = options?.maxPages ?? 50;
  const endPage = page + maxPages - 1;

  while (page <= endPage) {
    const url = `${baseUrl}?json=1&paging_length=${CEIPAL_PAGE_SIZE}&page=${page}` +
      (options?.since ? `&modified_after=${options.since.toISOString().slice(0, 10)}` : '');

    // Delay between pages to avoid connection resets
    if (page > 1) await new Promise((r) => setTimeout(r, 1_000));

    const response = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ceipal fetch failed on page ${page} (${response.status}): ${text}`);
    }

    const data = await response.json() as { results?: CeipalApplicant[]; count?: number } | CeipalApplicant[];

    // Handle both array and paginated object response shapes
    const results = Array.isArray(data) ? data : (data.results ?? []);

    if (results.length === 0) break;

    all.push(...results);

    // Stop if we got a partial page (last page)
    if (results.length < CEIPAL_PAGE_SIZE) break;

    page++;
  }

  if (page > endPage) {
    console.warn(`[Ceipal] maxPages (${maxPages}) reached at page ${page} — results may be truncated. Consider increasing maxPages or using startPage for resumption.`);
  }

  return all;
}

/**
 * Map a Ceipal applicant to the ingestion candidate shape.
 */
export function mapCeipalApplicantToCandidate(a: CeipalApplicant): Record<string, unknown> {
  /** Trim whitespace, return undefined for empty */
  const clean = (v?: string | number | null) => {
    if (v == null) return undefined;
    const s = String(v).trim();
    return s || undefined;
  };
  /** Clean + strip "NA" sentinel — use only for status/flag fields, not names */
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

export function clearCeipalTokenCacheForTest(): void {
  tokenCache = null;
}
