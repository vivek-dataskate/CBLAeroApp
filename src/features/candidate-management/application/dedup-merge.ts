import type { CandidateForDedup } from "../contracts/dedup";

/**
 * Determine which candidate is the "winner" (kept) and which is the "loser" (merged away).
 *
 * Priority:
 * 1. Candidate with ingestion_state='active' preferred
 * 2. If tied, prefer more non-null fields
 * 3. If still tied, prefer most recently created
 */
export function selectWinner(a: CandidateForDedup, b: CandidateForDedup): { winner: CandidateForDedup; loser: CandidateForDedup } {
  // Prefer active over non-active
  if (a.ingestionState === "active" && b.ingestionState !== "active") return { winner: a, loser: b };
  if (b.ingestionState === "active" && a.ingestionState !== "active") return { winner: b, loser: a };

  // Both same state — prefer more non-null fields
  const countNonNull = (c: CandidateForDedup) => {
    let count = 0;
    if (c.email) count++;
    if (c.phone) count++;
    if (c.firstName) count++;
    if (c.lastName) count++;
    if (c.jobTitle) count++;
    if (c.location) count++;
    if (c.resumeUrl) count++;
    if (c.linkedinUrl) count++;
    if (c.yearsOfExperience !== null) count++;
    if (Array.isArray(c.skills) && c.skills.length > 0) count++;
    if (Array.isArray(c.certifications) && c.certifications.length > 0) count++;
    if (Array.isArray(c.aircraftExperience) && c.aircraftExperience.length > 0) count++;
    return count;
  };

  const countA = countNonNull(a);
  const countB = countNonNull(b);
  if (countA > countB) return { winner: a, loser: b };
  if (countB > countA) return { winner: b, loser: a };

  // Tied — prefer most recently created
  if (a.createdAt > b.createdAt) return { winner: a, loser: b };
  return { winner: b, loser: a };
}

/**
 * Compute merged field values from winner and loser.
 * Returns a JSONB object for the merge_candidates RPC p_merged_fields parameter.
 */
export function computeMergedFields(
  winner: CandidateForDedup,
  loser: CandidateForDedup,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  // String fields: prefer non-null, then winner's value (winner already selected as having more data)
  merged.first_name = winner.firstName || loser.firstName;
  merged.last_name = winner.lastName || loser.lastName;
  merged.phone = winner.phone || loser.phone;
  merged.email = winner.email || loser.email;
  merged.job_title = winner.jobTitle || loser.jobTitle;
  merged.location = winner.location || loser.location;
  merged.city = winner.city || loser.city;
  merged.state = winner.state || loser.state;
  merged.resume_url = winner.resumeUrl || loser.resumeUrl;
  merged.linkedin_url = winner.linkedinUrl || loser.linkedinUrl;

  // Numeric: prefer higher value
  if (winner.yearsOfExperience !== null && loser.yearsOfExperience !== null) {
    merged.years_of_experience = Math.max(winner.yearsOfExperience, loser.yearsOfExperience);
  } else {
    merged.years_of_experience = winner.yearsOfExperience ?? loser.yearsOfExperience;
  }

  // JSON arrays: true set union (deduplicated by JSON stringification)
  merged.skills = jsonArrayUnion(winner.skills, loser.skills);
  merged.certifications = jsonArrayUnion(winner.certifications, loser.certifications);
  merged.aircraft_experience = jsonArrayUnion(winner.aircraftExperience, loser.aircraftExperience);

  // Extra attributes: deep merge — winner keys take priority
  const mergedExtra = { ...(loser.extraAttributes ?? {}), ...(winner.extraAttributes ?? {}) };

  // Preserve loser's email/source as aliases
  if (loser.email && loser.email !== winner.email) {
    const aliases = Array.isArray(mergedExtra.email_aliases) ? mergedExtra.email_aliases : [];
    if (!aliases.includes(loser.email)) aliases.push(loser.email);
    mergedExtra.email_aliases = aliases;
  }
  if (loser.source && loser.source !== winner.source) {
    const sources = Array.isArray(mergedExtra.merged_sources) ? mergedExtra.merged_sources : [];
    if (!sources.includes(loser.source)) sources.push(loser.source);
    mergedExtra.merged_sources = sources;
  }
  if (loser.resumeUrl && winner.resumeUrl && loser.resumeUrl !== winner.resumeUrl) {
    const resumes = Array.isArray(mergedExtra.additional_resumes) ? mergedExtra.additional_resumes : [];
    if (!resumes.includes(loser.resumeUrl)) resumes.push(loser.resumeUrl);
    mergedExtra.additional_resumes = resumes;
  }

  merged.extra_attributes = mergedExtra;

  return merged;
}

/**
 * Compute field-level diffs for the review queue UI.
 */
export function computeFieldDiffs(
  a: CandidateForDedup,
  b: CandidateForDedup,
): Record<string, { a: unknown; b: unknown }> {
  const diffs: Record<string, { a: unknown; b: unknown }> = {};

  const compare = (key: string, valA: unknown, valB: unknown) => {
    const strA = JSON.stringify(valA ?? null);
    const strB = JSON.stringify(valB ?? null);
    if (strA !== strB) diffs[key] = { a: valA ?? null, b: valB ?? null };
  };

  compare("email", a.email, b.email);
  compare("phone", a.phone, b.phone);
  compare("firstName", a.firstName, b.firstName);
  compare("lastName", a.lastName, b.lastName);
  compare("jobTitle", a.jobTitle, b.jobTitle);
  compare("location", a.location, b.location);
  compare("skills", a.skills, b.skills);
  compare("certifications", a.certifications, b.certifications);
  compare("yearsOfExperience", a.yearsOfExperience, b.yearsOfExperience);
  compare("resumeUrl", a.resumeUrl, b.resumeUrl);
  compare("source", a.source, b.source);

  return diffs;
}

function jsonArrayUnion(a: unknown[], b: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const item of [...(a ?? []), ...(b ?? [])]) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}
