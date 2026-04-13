import {
  getSupabaseAdminClient,
  shouldUseInMemoryPersistenceForTests,
} from "@/modules/persistence";
import type {
  AvailabilityStatus,
  CandidateDetail,
  CandidateListItem,
  CandidateListParams,
  CandidateListResult,
  IngestionState,
  SortByField,
} from "../contracts/candidate";

export class CandidateNotFoundError extends Error {
  constructor() {
    super("Candidate not found.");
    this.name = "CandidateNotFoundError";
  }
}

// -----------------------------------------------------------------------
// In-memory store (test mode only)
// -----------------------------------------------------------------------

const candidateStore = new Map<string, CandidateDetail>();

export function seedCandidateForTest(candidate: CandidateDetail): void {
  candidateStore.set(candidate.id, { ...candidate });
}

export function clearCandidateStoreForTest(): void {
  candidateStore.clear();
}

// -----------------------------------------------------------------------
// Row mapping helpers
// -----------------------------------------------------------------------

type CandidateRow = {
  id: string;
  tenant_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  availability_status: string;
  ingestion_state: string;
  job_title: string | null;
  skills: unknown[];
  deduced_roles: string[];
  availability_last_signal_at: string | null;
  source: string;
  source_batch_id: string | null;
  created_at: string;
  updated_at: string;
  years_of_experience: string | null;
  linkedin_url: string | null;
};

type CandidateDetailRow = CandidateRow & {
  middle_name: string | null;
  home_phone: string | null;
  work_phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  current_company: string | null;
  job_title: string | null;
  alternate_email: string | null;
  skills: unknown[];
  certifications: unknown[];
  experience: unknown[];
  extra_attributes: Record<string, unknown>;
  // Story 2.3 columns
  work_authorization: string | null;
  clearance: string | null;
  aircraft_experience: unknown[];
  employment_type: string | null;
  current_rate: string | null;
  per_diem: string | null;
  has_ap_license: boolean | null;
  years_of_experience: string | null;
  ceipal_id: string | null;
  submitted_by: string | null;
  submitter_email: string | null;
  shift_preference: string | null;
  expected_start_date: string | null;
  call_availability: string | null;
  interview_availability: string | null;
  veteran_status: string | null;
  resume_url: string | null;
  linkedin_url: string | null;
};

function toListItem(row: CandidateRow): CandidateListItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    location: row.location,
    city: row.city,
    state: row.state,
    availabilityStatus: row.availability_status as AvailabilityStatus,
    ingestionState: row.ingestion_state as IngestionState,
    jobTitle: row.job_title,
    skills: Array.isArray(row.skills) ? row.skills : [],
    deducedRoles: Array.isArray(row.deduced_roles) ? row.deduced_roles : [],
    linkedinUrl: row.linkedin_url ?? null,
    availabilityLastSignalAt: row.availability_last_signal_at,
    yearsOfExperience: row.years_of_experience,
    source: row.source,
    sourceBatchId: row.source_batch_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDetail(row: CandidateDetailRow): CandidateDetail {
  return {
    ...toListItem(row),
    middleName: row.middle_name,
    homePhone: row.home_phone,
    workPhone: row.work_phone,
    address: row.address,
    city: row.city,
    state: row.state,
    country: row.country,
    postalCode: row.postal_code,
    currentCompany: row.current_company,
    jobTitle: row.job_title,
    alternateEmail: row.alternate_email,
    skills: Array.isArray(row.skills) ? row.skills : [],
    certifications: Array.isArray(row.certifications) ? row.certifications : [],
    experience: Array.isArray(row.experience) ? row.experience : [],
    extraAttributes:
      row.extra_attributes && typeof row.extra_attributes === "object"
        ? (row.extra_attributes as Record<string, unknown>)
        : {},
    // Story 2.3 columns
    workAuthorization: row.work_authorization,
    clearance: row.clearance,
    aircraftExperience: Array.isArray(row.aircraft_experience) ? row.aircraft_experience : [],
    employmentType: row.employment_type,
    currentRate: row.current_rate,
    perDiem: row.per_diem,
    hasApLicense: row.has_ap_license,
    yearsOfExperience: row.years_of_experience,
    ceipalId: row.ceipal_id,
    submittedBy: row.submitted_by,
    submitterEmail: row.submitter_email,
    shiftPreference: row.shift_preference,
    expectedStartDate: row.expected_start_date,
    callAvailability: row.call_availability,
    interviewAvailability: row.interview_availability,
    veteranStatus: row.veteran_status,
    resumeUrl: row.resume_url,
    linkedinUrl: row.linkedin_url,
  };
}

// -----------------------------------------------------------------------
// Public repository functions
// -----------------------------------------------------------------------

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 500;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

// Sort column mapping from API field names to DB column names
const SORT_COLUMN_MAP: Record<SortByField, string> = {
  created_at: "created_at",
  years_of_experience: "years_of_experience",
  availability_status: "availability_status",
  first_name: "first_name",
  last_name: "last_name",
  location: "location",
  job_title: "job_title",
};

const VALID_SORT_FIELDS = new Set<string>(Object.keys(SORT_COLUMN_MAP));

// Composite cursor encoding for stable pagination across non-id sorts
type CompositeCursor = { v: string | number | null; id: string };

function encodeCursor(sortValue: unknown, id: string): string {
  return Buffer.from(JSON.stringify({ v: sortValue ?? null, id })).toString('base64url');
}

function decodeCursor(cursor: string): CompositeCursor {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString()) as CompositeCursor;
  } catch {
    // Fallback: treat as plain id cursor for backward compatibility
    return { v: null, id: cursor };
  }
}

function escapeIlike(value: string): string {
  return value.replace(/[%_]/g, (ch) => `\\${ch}`);
}

function countActiveFilters(params: CandidateListParams): number {
  let count = 0;
  if (params.availabilityStatus) count++;
  if (params.location) count++;
  if (params.certType) count++;
  if (params.search) count++;
  if (params.email) count++;
  if (params.phone) count++;
  if (params.jobTitle) count++;
  if (params.skills) count++;
  if (params.currentCompany) count++;
  if (params.state) count++;
  if (params.city) count++;
  if (params.workAuthorization) count++;
  if (params.employmentType) count++;
  if (params.source) count++;
  if (params.shiftPreference) count++;
  if (params.yearsOfExperience) count++;
  if (params.veteranStatus) count++;
  if (params.hasApLicense !== undefined) count++;
  if (params.deducedRole) count++; // H7 fix: include role filter in active filter count
  if (params.createdAfter) count++;
  if (params.createdBefore) count++;
  return count;
}

function determineSortStrategy(params: CandidateListParams): string {
  if (params.sortBy) {
    return `${params.sortBy}:${params.sortDir ?? "desc"}`;
  }
  const filterCount = countActiveFilters(params);
  return filterCount >= 2 ? "relevance" : "created_at:desc";
}

// In-memory string ilike filter helper
function ilikeMatch(value: string | null | undefined, term: string): boolean {
  if (!value) return false;
  return value.toLowerCase().includes(term.toLowerCase());
}

export async function listCandidates(params: CandidateListParams): Promise<CandidateListResult> {
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const sortStrategy = determineSortStrategy(params);

  if (shouldUseInMemoryPersistenceForTests()) {
    let candidates = [...candidateStore.values()].filter(
      (c) => c.tenantId === params.tenantId && c.ingestionState === "active",
    );

    // Existing filters
    if (params.availabilityStatus) {
      candidates = candidates.filter((c) => c.availabilityStatus === params.availabilityStatus);
    }
    if (params.location) {
      candidates = candidates.filter((c) => ilikeMatch(c.location, params.location!));
    }
    if (params.certType) {
      const ct = params.certType.toLowerCase();
      candidates = candidates.filter((c) =>
        Array.isArray(c.certifications) &&
        c.certifications.some(
          (cert) =>
            typeof cert === "object" &&
            cert !== null &&
            typeof (cert as Record<string, unknown>).type === "string" &&
            ((cert as Record<string, unknown>).type as string).toLowerCase() === ct,
        ),
      );
    }
    if (params.search) {
      const terms = params.search.toLowerCase().split(/\s+/).filter(Boolean);
      candidates = candidates.filter((c) => {
        const haystack = `${c.firstName} ${c.lastName}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
    }

    // New filters
    if (params.email) {
      candidates = candidates.filter((c) => ilikeMatch(c.email, params.email!));
    }
    if (params.phone) {
      candidates = candidates.filter((c) => ilikeMatch(c.phone, params.phone!));
    }
    if (params.jobTitle) {
      candidates = candidates.filter((c) => ilikeMatch(c.jobTitle, params.jobTitle!));
    }
    if (params.skills) {
      const sk = params.skills.toLowerCase();
      candidates = candidates.filter((c) =>
        Array.isArray(c.skills) &&
        c.skills.some((s) => typeof s === "string" ? s.toLowerCase().includes(sk) :
          (typeof s === "object" && s !== null && JSON.stringify(s).toLowerCase().includes(sk))),
      );
    }
    if (params.currentCompany) {
      candidates = candidates.filter((c) => ilikeMatch(c.currentCompany, params.currentCompany!));
    }
    if (params.state) {
      candidates = candidates.filter((c) => ilikeMatch(c.state, params.state!));
    }
    if (params.city) {
      candidates = candidates.filter((c) => ilikeMatch(c.city, params.city!));
    }
    if (params.workAuthorization) {
      candidates = candidates.filter((c) => ilikeMatch(c.workAuthorization, params.workAuthorization!));
    }
    if (params.employmentType) {
      candidates = candidates.filter((c) => c.employmentType === params.employmentType);
    }
    if (params.source) {
      candidates = candidates.filter((c) => c.source === params.source);
    }
    if (params.shiftPreference) {
      candidates = candidates.filter((c) => ilikeMatch(c.shiftPreference, params.shiftPreference!));
    }
    if (params.yearsOfExperience) {
      const minYoe = parseFloat(params.yearsOfExperience);
      candidates = candidates.filter((c) => {
        const yoe = c.yearsOfExperience ? parseFloat(c.yearsOfExperience) : 0;
        return yoe >= minYoe;
      });
    }
    if (params.veteranStatus) {
      candidates = candidates.filter((c) => c.veteranStatus === params.veteranStatus);
    }
    if (params.hasApLicense !== undefined) {
      candidates = candidates.filter((c) => c.hasApLicense === params.hasApLicense);
    }
    if (params.deducedRole) {
      const role = params.deducedRole;
      candidates = candidates.filter((c) =>
        Array.isArray(c.deducedRoles) && c.deducedRoles.includes(role),
      );
    }
    if (params.createdAfter) {
      candidates = candidates.filter((c) => c.createdAt >= params.createdAfter!);
    }
    if (params.createdBefore) {
      const endOfDay = `${params.createdBefore}T23:59:59.999Z`;
      candidates = candidates.filter((c) => c.createdAt <= endOfDay);
    }

    // Sort (with ID tiebreaker for deterministic ordering)
    const NUMERIC_SORT_FIELDS = new Set(["years_of_experience"]);

    if (sortStrategy === "relevance") {
      const avOrder: Record<string, number> = { active: 1, passive: 2, unavailable: 3 };
      candidates.sort((a, b) => {
        const avDiff = (avOrder[a.availabilityStatus] ?? 4) - (avOrder[b.availabilityStatus] ?? 4);
        if (avDiff !== 0) return avDiff;
        const yoeA = a.yearsOfExperience ? parseFloat(a.yearsOfExperience) : 0;
        const yoeB = b.yearsOfExperience ? parseFloat(b.yearsOfExperience) : 0;
        if (yoeB !== yoeA) return yoeB - yoeA;
        const dateDiff = b.createdAt.localeCompare(a.createdAt);
        if (dateDiff !== 0) return dateDiff;
        return b.id.localeCompare(a.id);
      });
    } else if (params.sortBy) {
      const dir = params.sortDir === "asc" ? 1 : -1;
      const field = params.sortBy;
      const camelField = toCamelCase(field);
      const isNumeric = NUMERIC_SORT_FIELDS.has(field);
      candidates.sort((a, b) => {
        const aRaw = (a as unknown as Record<string, unknown>)[camelField];
        const bRaw = (b as unknown as Record<string, unknown>)[camelField];
        let cmp: number;
        if (isNumeric) {
          const aNum = aRaw ? parseFloat(String(aRaw)) : 0;
          const bNum = bRaw ? parseFloat(String(bRaw)) : 0;
          cmp = aNum - bNum;
        } else {
          cmp = String(aRaw ?? "").localeCompare(String(bRaw ?? ""));
        }
        if (cmp !== 0) return cmp * dir;
        return a.id.localeCompare(b.id); // ID tiebreaker (ascending)
      });
    } else {
      // Default: created_at DESC with ID tiebreaker
      candidates.sort((a, b) => {
        const dateDiff = b.createdAt.localeCompare(a.createdAt);
        if (dateDiff !== 0) return dateDiff;
        return b.id.localeCompare(a.id);
      });
    }

    // Cursor-based pagination using composite cursor
    if (params.cursor) {
      const decoded = decodeCursor(params.cursor);
      const cursorIdx = candidates.findIndex((c) => c.id === decoded.id);
      if (cursorIdx >= 0) {
        candidates = candidates.slice(cursorIdx + 1);
      }
    }

    const hasMore = candidates.length > limit;
    const page = candidates.slice(0, limit);
    let nextCursor: string | null = null;
    if (hasMore && page.length > 0) {
      const last = page[page.length - 1];
      const sortVal = params.sortBy
        ? (last as unknown as Record<string, unknown>)[toCamelCase(params.sortBy)]
        : last.createdAt;
      nextCursor = encodeCursor(sortVal, last.id);
    }

    return { items: page.map((c) => ({ ...c })), nextCursor, sortedBy: sortStrategy };
  }

  // All filtering, sorting, and pagination handled by search_candidates RPC
  const client = getSupabaseAdminClient();
  const rpcParams: Record<string, unknown> = {
    p_tenant_id: params.tenantId,
    p_limit: limit,
    p_sort_by: params.sortBy ?? "created_at",
    p_sort_dir: params.sortDir ?? "desc",
  };

  if (params.search) rpcParams.p_search = params.search;
  if (params.email) rpcParams.p_email = params.email;
  if (params.jobTitle) rpcParams.p_job_title = params.jobTitle;
  if (params.skills) rpcParams.p_skills = params.skills;
  if (params.city) rpcParams.p_city = params.city;
  if (params.state) rpcParams.p_state = params.state;
  if (params.availabilityStatus) rpcParams.p_availability_status = params.availabilityStatus;
  if (params.workAuthorization) rpcParams.p_work_authorization = params.workAuthorization;
  if (params.source) rpcParams.p_source = params.source;
  if (params.employmentType) rpcParams.p_employment_type = params.employmentType;
  if (params.yearsOfExperience) rpcParams.p_years_of_experience = parseFloat(params.yearsOfExperience);
  if (params.veteranStatus) rpcParams.p_veteran_status = params.veteranStatus;
  if (params.hasApLicense !== undefined) rpcParams.p_has_ap_license = params.hasApLicense;
  if (params.certType) rpcParams.p_cert_type = params.certType;
  if (params.currentCompany) rpcParams.p_current_company = params.currentCompany;
  if (params.phone) rpcParams.p_phone = params.phone;
  if (params.shiftPreference) rpcParams.p_shift_preference = params.shiftPreference;
  if (params.deducedRole) rpcParams.p_deduced_role = params.deducedRole;
  if (params.createdAfter) rpcParams.p_created_after = params.createdAfter;
  if (params.createdBefore) rpcParams.p_created_before = params.createdBefore;

  // Cursor pagination: decode cursor and pass to RPC
  if (params.cursor) {
    const decoded = decodeCursor(params.cursor);
    rpcParams.p_cursor_id = decoded.id;
    rpcParams.p_cursor_created_at = decoded.v;
  }

  const { data, error } = await client.rpc("search_candidates", rpcParams);

  if (error) {
    throw new Error(`Failed to list candidates: ${error.message}`);
  }

  const rows = (data ?? []) as CandidateRow[];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  let nextCursor: string | null = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = encodeCursor(last.created_at, last.id);
  }

  return { items: page.map(toListItem), nextCursor, sortedBy: sortStrategy };
}

function toCamelCase(snakeCase: string): string {
  return snakeCase.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export async function getCandidateById(
  candidateId: string,
  tenantId: string,
): Promise<CandidateDetail> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const candidate = candidateStore.get(candidateId);
    if (!candidate || candidate.tenantId !== tenantId) {
      throw new CandidateNotFoundError();
    }
    return { ...candidate };
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc("get_candidate_detail", {
    p_candidate_id: candidateId,
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(`Failed to fetch candidate: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new CandidateNotFoundError();
  }

  return toDetail(row as CandidateDetailRow);
}

export async function findCandidateIdsByEmails(
  emails: string[],
  tenantId: string,
): Promise<Map<string, string>> {
  if (emails.length === 0) return new Map();

  if (shouldUseInMemoryPersistenceForTests()) {
    const result = new Map<string, string>();
    for (const c of candidateStore.values()) {
      if (c.tenantId === tenantId && c.email && emails.includes(c.email)) {
        result.set(c.email, c.id);
      }
    }
    return result;
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc("find_candidate_ids_by_emails", {
    p_tenant_id: tenantId,
    p_emails: emails,
  });

  if (error) {
    throw new Error(`Failed to find candidates by emails: ${error.message}`);
  }

  const result = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ id: string; email: string }>) {
    if (row.email) result.set(row.email, row.id);
  }
  return result;
}

export async function countCandidatesBySource(source: string): Promise<number> {
  if (shouldUseInMemoryPersistenceForTests()) {
    let count = 0;
    for (const c of candidateStore.values()) {
      if (c.source === source) count++;
    }
    return count;
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc("count_candidates_by_source", {
    p_source: source,
  });

  if (error) {
    throw new Error(`Failed to count candidates by source: ${error.message}`);
  }

  return Number(data ?? 0);
}

// -----------------------------------------------------------------------
// Candidate upsert functions (centralized — all ingestion paths use these)
// -----------------------------------------------------------------------

/**
 * Upsert a single candidate via RPC. Handles email dedup server-side.
 * If email exists for tenant, updates the record; otherwise inserts new.
 * Returns the candidate ID.
 */
export async function upsertCandidateByEmail(
  candidateRow: Record<string, unknown>,
): Promise<string> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const id = (candidateRow.id as string) ?? crypto.randomUUID();
    candidateStore.set(id, { id, tenantId: candidateRow.tenant_id as string } as CandidateDetail);
    return id;
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc("upsert_candidate", {
    p_candidate: candidateRow,
  });

  if (error) {
    throw new Error(`Candidate upsert failed: ${error.message}`);
  }

  return String(data);
}

/**
 * Insert a candidate without email (no dedup possible). Returns the candidate ID.
 * Uses the same RPC — it detects missing email and does a plain insert.
 */
export async function insertCandidateNoEmail(
  candidateRow: Record<string, unknown>,
): Promise<string> {
  if (shouldUseInMemoryPersistenceForTests()) {
    const id = crypto.randomUUID();
    candidateStore.set(id, { id, tenantId: candidateRow.tenant_id as string } as CandidateDetail);
    return id;
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc("upsert_candidate", {
    p_candidate: candidateRow,
  });

  if (error) {
    throw new Error(`Candidate insert failed: ${error.message}`);
  }

  return String(data);
}

/**
 * Batch upsert candidates via RPC. Handles email dedup server-side per row.
 * Rows with email get upserted (update if exists); rows without get inserted.
 */
export async function batchUpsertCandidatesByEmail(
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;

  if (shouldUseInMemoryPersistenceForTests()) {
    for (const row of rows) {
      const id = crypto.randomUUID();
      candidateStore.set(id, { id, tenantId: row.tenant_id as string } as CandidateDetail);
    }
    return;
  }

  const client = getSupabaseAdminClient();
  const { error } = await client.rpc("upsert_candidate_batch", {
    p_candidates: rows,
  });

  if (error) {
    throw new Error(`Batch candidate upsert failed: ${error.message}`);
  }
}

/**
 * Batch insert candidates without email. Uses same batch RPC — it handles
 * rows without email as plain inserts.
 */
export async function batchInsertCandidatesNoEmail(
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;

  if (shouldUseInMemoryPersistenceForTests()) {
    for (const row of rows) {
      const id = crypto.randomUUID();
      candidateStore.set(id, { id, tenantId: row.tenant_id as string } as CandidateDetail);
    }
    return;
  }

  const client = getSupabaseAdminClient();
  const { error } = await client.rpc("upsert_candidate_batch", {
    p_candidates: rows,
  });

  if (error) {
    throw new Error(`Batch candidate insert failed: ${error.message}`);
  }
}

export async function getLastCandidateUpdateBySource(source: string): Promise<Date | undefined> {
  if (shouldUseInMemoryPersistenceForTests()) {
    let latest: string | undefined;
    for (const c of candidateStore.values()) {
      if (c.source === source) {
        if (!latest || c.updatedAt > latest) latest = c.updatedAt;
      }
    }
    return latest ? new Date(latest) : undefined;
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc("get_last_candidate_update_by_source", {
    p_source: source,
  });

  if (error) {
    throw new Error(`Failed to get last update by source: ${error.message}`);
  }

  return data ? new Date(data as string) : undefined;
}
