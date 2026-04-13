export type AvailabilityStatus = "active" | "passive" | "unavailable";
export type IngestionState = "pending_dedup" | "pending_enrichment" | "active" | "rejected" | "pending_review" | "merged";

export type SortByField = 'created_at' | 'years_of_experience' | 'availability_status' | 'first_name' | 'last_name' | 'location' | 'job_title';
export type SortDir = 'asc' | 'desc';

export type CandidateListItem = {
  id: string;
  tenantId: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  availabilityStatus: AvailabilityStatus;
  ingestionState: IngestionState;
  jobTitle: string | null;
  skills: unknown[];
  yearsOfExperience: string | null;
  source: string;
  sourceBatchId: string | null;
  deducedRoles: string[];
  linkedinUrl: string | null;
  availabilityLastSignalAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CandidateDetail = CandidateListItem & {
  middleName: string | null;
  homePhone: string | null;
  workPhone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  currentCompany: string | null;
  jobTitle: string | null;
  alternateEmail: string | null;
  skills: unknown[];
  certifications: unknown[];
  experience: unknown[];
  extraAttributes: Record<string, unknown>;
  // Story 2.3 columns (aviation-specific and ingestion metadata)
  workAuthorization: string | null;
  clearance: string | null;
  aircraftExperience: unknown[];
  employmentType: string | null;
  currentRate: string | null;
  perDiem: string | null;
  hasApLicense: boolean | null;
  yearsOfExperience: string | null;
  ceipalId: string | null;
  submittedBy: string | null;
  submitterEmail: string | null;
  shiftPreference: string | null;
  expectedStartDate: string | null;
  callAvailability: string | null;
  interviewAvailability: string | null;
  veteranStatus: string | null;
  resumeUrl: string | null;
  linkedinUrl: string | null;
  availabilityLastSignalAt: string | null;
};

export type CandidateListParams = {
  tenantId: string;
  // Existing filters
  availabilityStatus?: AvailabilityStatus;
  location?: string;
  certType?: string;
  search?: string;
  // New filters
  email?: string;
  phone?: string;
  jobTitle?: string;
  skills?: string;
  currentCompany?: string;
  state?: string;
  city?: string;
  workAuthorization?: string;
  employmentType?: string;
  source?: string;
  shiftPreference?: string;
  yearsOfExperience?: string;
  veteranStatus?: string;
  hasApLicense?: boolean;
  deducedRole?: string;
  // Date range
  createdAfter?: string;
  createdBefore?: string;
  // Sorting
  sortBy?: SortByField;
  sortDir?: SortDir;
  // Pagination
  cursor?: string;
  limit?: number;
};

export type CandidateListResult = {
  items: CandidateListItem[];
  nextCursor: string | null;
  sortedBy: string;
};
