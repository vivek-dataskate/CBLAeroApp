/**
 * Clay webhook payload mapper (Story 2.8).
 *
 * Pure functions — no I/O, no Supabase, no env reads. All config flows in
 * through the `config` parameter so the route handler (which reads env and
 * resolves the assignee user ID) stays testable too.
 *
 * Clay's HTTP API column fires a JSON payload per row. The payload shape is
 * recruiter-configurable in the Clay UI, so the mapper is deliberately
 * shape-tolerant: it treats every key as optional and falls back gracefully
 * when fields are missing or of unexpected types. The raw payload is always
 * preserved under `extra_attributes.clay.*` so nothing is lost — promoted
 * fields land in typed columns and everything else rides along as JSONB.
 *
 * Consumes the canonical `mapToCandidateRow` function from index.ts via the
 * camelCase record it emits. Do NOT bypass `mapToCandidateRow` — it's the
 * single source of truth for column defaults, guardrails, and extra_attributes
 * normalization.
 */

/** Configuration provided by the webhook route (resolved from env). */
export interface ClayMapperConfig {
  /** Top-level column name in the Clay payload that holds the sidecar personal email. */
  emailField: string;
  /** Top-level column name in the Clay payload that holds the sidecar phone. */
  phoneField: string;
  /**
   * Top-level key where Clay nests the LinkedIn enrichment object. Defaults to
   * `enrichlinkedin_data` (confirmed from production Clay payload 2026-04-15).
   * When set, the mapper reads the nested blob from this exact key instead of
   * probing the fallback list. Override if the Clay Enrich Person column is
   * renamed without deploying code.
   */
  blobField?: string;
  /**
   * CBLAero user ID cached by the webhook route at first request. Every
   * Clay-ingested candidate is stamped with this ID as source provenance.
   */
  defaultAssigneeUserId: string;
}

/** Shape returned by the mapper — compatible with `mapToCandidateRow` in index.ts. */
export interface ClayMappedCandidate {
  // Identity / contact
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;

  // Title / company
  jobTitle: string | null;
  client: string | null; // `current_company` in the DB; `mapToCandidateRow` reads this as `client`

  // Location
  location: string | null;
  city: string | null;
  state: string | null;
  country: string | null;

  // Structured blocks
  experience: unknown[];
  certifications: unknown[];

  // Provenance
  source: string;
  sourceRecruiterActorId: string;

  // Raw payload preservation
  extra_attributes: Record<string, unknown>;
}

/**
 * Parse a Clay `location_name` string into city/state components.
 * Clay tends to emit strings like "Chicago, Illinois, United States" or
 * "San Francisco Bay Area" — the parser is intentionally permissive and
 * returns `null` for both fields when the shape is unfamiliar.
 *
 * Kept as a pure function so it's unit-testable without fixtures.
 */
export function parseClayLocation(locationName: string | null | undefined): {
  city: string | null;
  state: string | null;
} {
  if (!locationName || typeof locationName !== 'string') {
    return { city: null, state: null };
  }

  const parts = locationName
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (parts.length === 0) {
    return { city: null, state: null };
  }

  // Common shapes:
  //   1: "San Francisco Bay Area"              → city only
  //   2: "Chicago, Illinois"                   → city, state
  //   3: "Chicago, Illinois, United States"    → city, state, country (drop country)
  //   4: anything else                         → give up, leave null
  if (parts.length === 1) {
    return { city: parts[0] ?? null, state: null };
  }
  if (parts.length === 2) {
    return { city: parts[0] ?? null, state: parts[1] ?? null };
  }
  if (parts.length === 3) {
    // Assume last is country when parts[2] looks like a country word.
    const last = (parts[2] ?? '').toLowerCase();
    const looksLikeCountry =
      last === 'united states' || last === 'usa' || last === 'us' || last.length > 0;
    if (looksLikeCountry) {
      return { city: parts[0] ?? null, state: parts[1] ?? null };
    }
  }
  return { city: null, state: null };
}

/**
 * Resolve the best-effort `job_title` field from a Clay row.
 * Clay's `title` is usually populated, but sometimes degenerate values
 * like `"--"` or empty strings appear. Fall back to `headline`, then
 * fall back to the latest experience entry if available.
 */
function pickJobTitle(row: Record<string, unknown>): string | null {
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  if (title && title !== '--' && title !== '—') return title;

  const headline = typeof row.headline === 'string' ? row.headline.trim() : '';
  if (headline && headline !== '--' && headline !== '—') return headline;

  const latest = row.latest_experience;
  if (latest && typeof latest === 'object' && 'title' in latest) {
    const latestTitle = typeof (latest as Record<string, unknown>).title === 'string'
      ? ((latest as Record<string, unknown>).title as string).trim()
      : '';
    if (latestTitle && latestTitle !== '--') return latestTitle;
  }

  return null;
}

/**
 * Resolve the best-effort `current_company` field from a Clay row.
 * Prefer `org`; fall back to `latest_experience.company`.
 */
function pickCurrentCompany(row: Record<string, unknown>): string | null {
  const org = typeof row.org === 'string' ? row.org.trim() : '';
  if (org) return org;

  const latest = row.latest_experience;
  if (latest && typeof latest === 'object' && 'company' in latest) {
    const company = typeof (latest as Record<string, unknown>).company === 'string'
      ? ((latest as Record<string, unknown>).company as string).trim()
      : '';
    if (company) return company;
  }

  return null;
}

/**
 * Resolve a nested LinkedIn blob if Clay sends the enriched person data as
 * an object under a single column. The Clay HTTP API column lets recruiters
 * include column references in the payload body, so the exact location of
 * the LinkedIn JSON is recruiter-configurable.
 *
 * Resolution order:
 *   1. If `config.blobField` is explicitly set, use that exact key (no fallback).
 *   2. If the payload already has flat top-level `first_name`/`last_name`/`url`,
 *      treat the whole payload as the LinkedIn blob merged with sidecars.
 *   3. Probe a list of common Clay Enrich Person column names.
 *   4. Give up and return the raw payload (everything still lands in
 *      `extra_attributes.clay.*` so no data is lost).
 */
function extractLinkedInBlob(
  payload: Record<string, unknown>,
  config: ClayMapperConfig,
): Record<string, unknown> {
  // 1. Explicit override via env var wins.
  if (config.blobField) {
    const explicit = payload[config.blobField];
    if (explicit && typeof explicit === 'object' && !Array.isArray(explicit)) {
      return explicit as Record<string, unknown>;
    }
    // If the explicit key was set but missing or wrong type, fall through to
    // the probe list rather than failing — Clay may be sending a partial row
    // and we'd rather best-effort than hard-fail.
  }

  // 2. Flat top-level LinkedIn fields — some recruiters template their HTTP API
  // column body to spread the enrichment columns at the top level.
  if (
    typeof payload.first_name === 'string' ||
    typeof payload.last_name === 'string' ||
    typeof payload.url === 'string'
  ) {
    return payload;
  }

  // 3. Probe common nested keys used in Clay templates. The exact key is chosen
  // by the recruiter when configuring the HTTP API column in Clay, so we probe
  // multiple plausible names and use the first non-empty object we find.
  // Confirmed shapes:
  //   - `enrichlinkedin_data` (observed in production Clay webhook — 2026-04-15)
  //   - `Enrich person` (Clay UI default column name when discovery started)
  const candidateKeys = [
    'enrichlinkedin_data',  // Confirmed — production Clay HTTP API column
    'Enrich person',        // Clay UI default column name
    'enrich_person',
    'linkedin_data',
    'linkedin',
    'LinkedIn',
    'profile',
    'person',
    'enriched',
  ];
  for (const key of candidateKeys) {
    const value = payload[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }

  // 4. Nothing recognizable — return the raw payload so downstream code still
  // sees every key in extra_attributes.clay.*
  return payload;
}

/**
 * Map a single Clay webhook row to the camelCase candidate record shape
 * consumed by `mapToCandidateRow`. The returned object is NOT yet a DB row —
 * it's a canonical intermediate that the ingestion barrel turns into a row
 * with all the standard column defaults.
 */
export function mapClayRowToCandidate(
  rawRow: Record<string, unknown>,
  config: ClayMapperConfig,
): ClayMappedCandidate {
  // Sidecar fields use Clay column display names (e.g. "Personal Email")
  const sidecarEmail = typeof rawRow[config.emailField] === 'string'
    ? (rawRow[config.emailField] as string).trim().toLowerCase()
    : '';
  const sidecarPhone = typeof rawRow[config.phoneField] === 'string'
    ? (rawRow[config.phoneField] as string).trim()
    : '';

  const linkedIn = extractLinkedInBlob(rawRow, config);

  const firstName = typeof linkedIn.first_name === 'string' ? linkedIn.first_name.trim() : '';
  const lastName = typeof linkedIn.last_name === 'string' ? linkedIn.last_name.trim() : '';
  const linkedinUrl = typeof linkedIn.url === 'string' ? linkedIn.url.trim() : '';
  const country = typeof linkedIn.country === 'string' ? linkedIn.country.trim() : '';
  const locationName = typeof linkedIn.location_name === 'string' ? linkedIn.location_name.trim() : '';

  const { city, state } = parseClayLocation(locationName);

  const experience = Array.isArray(linkedIn.experience) ? linkedIn.experience : [];
  const certifications = Array.isArray(linkedIn.certifications) ? linkedIn.certifications : [];

  const jobTitle = pickJobTitle(linkedIn);
  const currentCompany = pickCurrentCompany(linkedIn);

  return {
    firstName,
    lastName,
    email: sidecarEmail || null,
    phone: sidecarPhone || null,
    linkedinUrl: linkedinUrl || null,
    jobTitle,
    client: currentCompany,
    location: locationName || null,
    city,
    state,
    country: country || null,
    experience,
    certifications,
    source: 'clay_enrichment',
    sourceRecruiterActorId: config.defaultAssigneeUserId,
    // Store the entire raw payload under the `clay` namespace — preserves
    // everything Clay sent even if the schema evolves later.
    extra_attributes: {
      clay: rawRow,
    },
  };
}

/**
 * Compute the content fingerprint for a Clay row. Used by the webhook handler
 * to short-circuit re-processing of unchanged rows (Story 1.11 gate).
 *
 * Format: `clay:${profile_id}:${last_refresh}` when both are available.
 * Fallback: `clay:${email}` when profile_id is missing (less stable but
 * prevents complete identity collapse).
 */
export function computeClayFingerprint(
  rawRow: Record<string, unknown>,
  config: ClayMapperConfig,
): string | null {
  const linkedIn = extractLinkedInBlob(rawRow, config);
  const profileId = linkedIn.profile_id;
  const lastRefresh = linkedIn.last_refresh;

  if (profileId !== null && profileId !== undefined && lastRefresh) {
    return `clay:${String(profileId)}:${String(lastRefresh)}`;
  }

  const email = typeof rawRow[config.emailField] === 'string'
    ? (rawRow[config.emailField] as string).trim().toLowerCase()
    : '';
  if (email) return `clay:${email}`;

  return null;
}
