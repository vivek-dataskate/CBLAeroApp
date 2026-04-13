export type DedupDecisionType = "auto_merge" | "manual_merge" | "manual_reject" | "keep_separate";

export type ReviewQueueStatus = "pending" | "approved" | "rejected";

export type ConfidenceResult = {
  score: number;
  matchType: string;
  rationale: string;
};

export type DedupDecision = {
  id: number;
  tenantId: string;
  candidateAId: string;
  candidateBId: string;
  decisionType: DedupDecisionType;
  confidenceScore: number;
  rationale: string;
  actor: string;
  traceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ReviewQueueItem = {
  id: number;
  tenantId: string;
  candidateAId: string;
  candidateBId: string;
  confidenceScore: number;
  fieldDiffs: Record<string, { a: unknown; b: unknown }>;
  status: ReviewQueueStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type DedupStats = {
  autoMerged: number;
  manualMerged: number;
  manualRejected: number;
  keptSeparate: number;
  pendingReview: number;
};

export type CandidateForDedup = {
  id: string;
  tenantId: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  skills: unknown[];
  certifications: unknown[];
  aircraftExperience: unknown[];
  extraAttributes: Record<string, unknown>;
  yearsOfExperience: number | null;
  resumeUrl: string | null;
  linkedinUrl: string | null;
  source: string | null;
  ingestionState: string;
  createdAt: string;
  updatedAt: string;
};
