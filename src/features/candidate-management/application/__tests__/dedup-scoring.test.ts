import { describe, it, expect } from "vitest";
import { computeIdentityConfidence, routeDedupDecision } from "../dedup-scoring";
import { selectWinner, computeMergedFields, computeFieldDiffs } from "../dedup-merge";
import type { CandidateForDedup } from "../../contracts/dedup";

function makeCandidate(overrides: Partial<CandidateForDedup> = {}): CandidateForDedup {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    tenantId: "cbl-aero",
    email: null,
    phone: null,
    firstName: null,
    lastName: null,
    jobTitle: null,
    location: null,
    city: null,
    state: null,
    skills: [],
    certifications: [],
    aircraftExperience: [],
    extraAttributes: {},
    yearsOfExperience: null,
    resumeUrl: null,
    linkedinUrl: null,
    source: null,
    ingestionState: "pending_dedup",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ============================================================
// computeIdentityConfidence
// ============================================================

describe("computeIdentityConfidence", () => {
  it("returns 98% for email + name match", () => {
    const a = makeCandidate({ email: "john@test.com", firstName: "John", lastName: "Doe" });
    const b = makeCandidate({ email: "JOHN@TEST.COM", firstName: "john", lastName: "doe" });
    const result = computeIdentityConfidence(a, b);
    expect(result.score).toBe(98);
    expect(result.matchType).toBe("email+name");
  });

  it("returns 95% for email match only (names differ)", () => {
    const a = makeCandidate({ email: "john@test.com", firstName: "John", lastName: "Doe" });
    const b = makeCandidate({ email: "john@test.com", firstName: "Jane", lastName: "Smith" });
    const result = computeIdentityConfidence(a, b);
    expect(result.score).toBe(95);
    expect(result.matchType).toBe("email");
  });

  it("returns 85% for phone + name match", () => {
    const a = makeCandidate({ phone: "+1 (713) 555-0123", firstName: "John", lastName: "Doe" });
    const b = makeCandidate({ phone: "17135550123", firstName: "john", lastName: "doe" });
    const result = computeIdentityConfidence(a, b);
    expect(result.score).toBe(85);
    expect(result.matchType).toBe("phone+name");
  });

  it("returns 70% for phone match only (names differ)", () => {
    const a = makeCandidate({ phone: "7135550123", firstName: "John", lastName: "Doe" });
    const b = makeCandidate({ phone: "7135550123", firstName: "Jane", lastName: "Smith" });
    const result = computeIdentityConfidence(a, b);
    expect(result.score).toBe(70);
    expect(result.matchType).toBe("phone");
  });

  it("returns 50% for name match only (no email/phone overlap)", () => {
    const a = makeCandidate({ firstName: "John", lastName: "Doe", phone: "1111111111" });
    const b = makeCandidate({ firstName: "John", lastName: "Doe", phone: "2222222222" });
    const result = computeIdentityConfidence(a, b);
    expect(result.score).toBe(50);
    expect(result.matchType).toBe("name_only");
  });

  it("returns 0% for no field overlap", () => {
    const a = makeCandidate({ email: "a@test.com", firstName: "John", lastName: "Doe" });
    const b = makeCandidate({ email: "b@test.com", firstName: "Jane", lastName: "Smith" });
    const result = computeIdentityConfidence(a, b);
    expect(result.score).toBe(0);
    expect(result.matchType).toBe("none");
  });

  it("handles null email gracefully", () => {
    const a = makeCandidate({ email: null, firstName: "John", lastName: "Doe" });
    const b = makeCandidate({ email: "john@test.com", firstName: "John", lastName: "Doe" });
    const result = computeIdentityConfidence(a, b);
    // Name matches but no phone overlap
    expect(result.score).toBe(50);
  });

  it("handles null phone gracefully", () => {
    const a = makeCandidate({ phone: null, firstName: "John", lastName: "Doe" });
    const b = makeCandidate({ phone: "1234567890", firstName: "John", lastName: "Doe" });
    const result = computeIdentityConfidence(a, b);
    expect(result.score).toBe(50);
  });

  it("handles both null email and phone", () => {
    const a = makeCandidate({ email: null, phone: null });
    const b = makeCandidate({ email: null, phone: null });
    const result = computeIdentityConfidence(a, b);
    expect(result.score).toBe(0);
  });

  it("does NOT strip leading 1 from US phone (matches computeIdentityHash)", () => {
    const a = makeCandidate({ phone: "+1 713-555-0123", firstName: "John", lastName: "Doe" });
    const b = makeCandidate({ phone: "713-555-0123", firstName: "John", lastName: "Doe" });
    // After normalization: "17135550123" vs "7135550123" — DIFFERENT
    const result = computeIdentityConfidence(a, b);
    // Names match but phones don't match
    expect(result.score).toBe(50);
    expect(result.matchType).toBe("name_only");
  });

  it("normalizes empty strings same as null", () => {
    const a = makeCandidate({ email: "", firstName: "", lastName: "" });
    const b = makeCandidate({ email: "", firstName: "", lastName: "" });
    const result = computeIdentityConfidence(a, b);
    expect(result.score).toBe(0);
  });
});

// ============================================================
// routeDedupDecision
// ============================================================

describe("routeDedupDecision", () => {
  it("routes >= 50 to auto_merge", () => {
    expect(routeDedupDecision(50)).toBe("auto_merge");
    expect(routeDedupDecision(70)).toBe("auto_merge");
    expect(routeDedupDecision(85)).toBe("auto_merge");
    expect(routeDedupDecision(95)).toBe("auto_merge");
    expect(routeDedupDecision(98)).toBe("auto_merge");
    expect(routeDedupDecision(100)).toBe("auto_merge");
  });

  it("routes 1-49 to manual_review", () => {
    expect(routeDedupDecision(1)).toBe("manual_review");
    expect(routeDedupDecision(49)).toBe("manual_review");
  });

  it("routes 0 to keep_separate", () => {
    expect(routeDedupDecision(0)).toBe("keep_separate");
  });
});

// ============================================================
// selectWinner
// ============================================================

describe("selectWinner", () => {
  it("prefers active over pending_dedup", () => {
    const a = makeCandidate({ id: "a", ingestionState: "active" });
    const b = makeCandidate({ id: "b", ingestionState: "pending_dedup" });
    const { winner, loser } = selectWinner(a, b);
    expect(winner.id).toBe("a");
    expect(loser.id).toBe("b");
  });

  it("prefers more non-null fields when same state", () => {
    const a = makeCandidate({ id: "a", ingestionState: "pending_dedup", email: "a@test.com", phone: "123" });
    const b = makeCandidate({ id: "b", ingestionState: "pending_dedup", email: "b@test.com" });
    const { winner } = selectWinner(a, b);
    expect(winner.id).toBe("a");
  });

  it("prefers most recently created when tied", () => {
    const a = makeCandidate({ id: "a", createdAt: "2026-01-01T00:00:00Z" });
    const b = makeCandidate({ id: "b", createdAt: "2026-02-01T00:00:00Z" });
    const { winner } = selectWinner(a, b);
    expect(winner.id).toBe("b");
  });
});

// ============================================================
// computeMergedFields
// ============================================================

describe("computeMergedFields", () => {
  it("takes winner's email and stores loser's as alias", () => {
    const winner = makeCandidate({ email: "w@test.com", source: "csv" });
    const loser = makeCandidate({ email: "l@test.com", source: "email" });
    const merged = computeMergedFields(winner, loser);
    expect(merged.email).toBe("w@test.com");
    const extra = merged.extra_attributes as Record<string, unknown>;
    expect(extra.email_aliases).toEqual(["l@test.com"]);
    expect(extra.merged_sources).toEqual(["email"]);
  });

  it("does JSON array union for skills", () => {
    const winner = makeCandidate({ skills: ["A&P", "Boeing 737"] });
    const loser = makeCandidate({ skills: ["A&P", "Airbus A320"] });
    const merged = computeMergedFields(winner, loser);
    expect(merged.skills).toEqual(["A&P", "Boeing 737", "Airbus A320"]);
  });

  it("takes higher years_of_experience", () => {
    const winner = makeCandidate({ yearsOfExperience: 5 });
    const loser = makeCandidate({ yearsOfExperience: 10 });
    const merged = computeMergedFields(winner, loser);
    expect(merged.years_of_experience).toBe(10);
  });

  it("prefers non-null over null for string fields", () => {
    const winner = makeCandidate({ jobTitle: null, location: "Houston" });
    const loser = makeCandidate({ jobTitle: "Mechanic", location: null });
    const merged = computeMergedFields(winner, loser);
    expect(merged.job_title).toBe("Mechanic");
    expect(merged.location).toBe("Houston");
  });

  it("stores additional resumes when both have resume_url", () => {
    const winner = makeCandidate({ resumeUrl: "url-a" });
    const loser = makeCandidate({ resumeUrl: "url-b" });
    const merged = computeMergedFields(winner, loser);
    expect(merged.resume_url).toBe("url-a");
    const extra = merged.extra_attributes as Record<string, unknown>;
    expect(extra.additional_resumes).toEqual(["url-b"]);
  });
});

// ============================================================
// computeFieldDiffs
// ============================================================

describe("computeFieldDiffs", () => {
  it("returns diffs for differing fields only", () => {
    const a = makeCandidate({ email: "a@test.com", firstName: "John", lastName: "Doe" });
    const b = makeCandidate({ email: "b@test.com", firstName: "John", lastName: "Doe" });
    const diffs = computeFieldDiffs(a, b);
    expect(diffs.email).toEqual({ a: "a@test.com", b: "b@test.com" });
    expect(diffs.firstName).toBeUndefined(); // same
    expect(diffs.lastName).toBeUndefined(); // same
  });

  it("returns empty object when identical", () => {
    const a = makeCandidate({ email: "same@test.com" });
    const b = makeCandidate({ email: "same@test.com" });
    const diffs = computeFieldDiffs(a, b);
    expect(diffs.email).toBeUndefined();
  });
});
