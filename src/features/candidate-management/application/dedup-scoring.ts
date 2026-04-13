import type { CandidateForDedup, ConfidenceResult } from "../contracts/dedup";

/**
 * Deterministic identity confidence scoring.
 * Same inputs always produce the same score — no ML, no probabilistic matching.
 *
 * Phone normalization MUST match computeIdentityHash in fingerprint-repository.ts:
 *   .replace(/\D/g, "") — strips non-digits only, does NOT strip leading "1".
 */

function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

function normalizeName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  return `${(firstName ?? "").toLowerCase().trim()} ${(lastName ?? "").toLowerCase().trim()}`.trim();
}

export function computeIdentityConfidence(
  candidateA: CandidateForDedup,
  candidateB: CandidateForDedup,
): ConfidenceResult {
  const emailA = candidateA.email?.toLowerCase().trim() ?? "";
  const emailB = candidateB.email?.toLowerCase().trim() ?? "";
  const phoneA = normalizePhone(candidateA.phone);
  const phoneB = normalizePhone(candidateB.phone);
  const nameA = normalizeName(candidateA.firstName, candidateA.lastName);
  const nameB = normalizeName(candidateB.firstName, candidateB.lastName);

  const emailMatch = emailA !== "" && emailB !== "" && emailA === emailB;
  const phoneMatch = phoneA !== "" && phoneB !== "" && phoneA === phoneB;
  const nameMatch = nameA !== "" && nameB !== "" && nameA === nameB;

  // Email exact + name match → 98% (auto-merge)
  if (emailMatch && nameMatch) {
    return { score: 98, matchType: "email+name", rationale: `Email exact match (${emailA}) + name match (${nameA})` };
  }

  // Email exact match → 95% (auto-merge)
  if (emailMatch) {
    return { score: 95, matchType: "email", rationale: `Email exact match (${emailA}), names differ: "${nameA}" vs "${nameB}"` };
  }

  // Phone + name match → 85% (manual review)
  if (phoneMatch && nameMatch) {
    return { score: 85, matchType: "phone+name", rationale: `Phone match (${phoneA}) + name match (${nameA})` };
  }

  // Phone match only → 70% (manual review — borderline)
  if (phoneMatch) {
    return { score: 70, matchType: "phone", rationale: `Phone match (${phoneA}), names differ: "${nameA}" vs "${nameB}"` };
  }

  // Name match only → 50% (keep separate)
  if (nameMatch) {
    return { score: 50, matchType: "name_only", rationale: `Name match (${nameA}), no email/phone overlap` };
  }

  // No field overlap → 0%
  return { score: 0, matchType: "none", rationale: "No matching fields" };
}

/**
 * Route a confidence score to the appropriate action.
 */
export function routeDedupDecision(score: number): "auto_merge" | "manual_review" | "keep_separate" {
  if (score >= 50) return "auto_merge";
  if (score > 0) return "manual_review";
  return "keep_separate";
}
