import { beforeEach, describe, expect, it } from "vitest";

import {
  CandidateNotFoundError,
  clearCandidateStoreForTest,
  getCandidateById,
  listCandidates,
  seedCandidateForTest,
} from "../candidate-repository";
import type { CandidateDetail } from "../../contracts/candidate";

function makeCandidate(overrides: Partial<CandidateDetail> = {}): CandidateDetail {
  return {
    id: crypto.randomUUID(),
    tenantId: "tenant-a",
    name: "Jane Doe",
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    phone: "5551234567",
    location: "Dallas, TX",
    availabilityStatus: "active",
    ingestionState: "active",
    source: "csv",
    sourceBatchId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    middleName: null,
    homePhone: null,
    workPhone: null,
    address: null,
    city: null,
    state: null,
    country: null,
    postalCode: null,
    currentCompany: "AeroCorp",
    jobTitle: "A&P Mechanic",
    alternateEmail: null,
    skills: [],
    certifications: [],
    experience: [],
    extraAttributes: {},
    workAuthorization: null,
    clearance: null,
    aircraftExperience: [],
    employmentType: null,
    currentRate: null,
    perDiem: null,
    hasApLicense: null,
    yearsOfExperience: null,
    ceipalId: null,
    submittedBy: null,
    submitterEmail: null,
    shiftPreference: null,
    expectedStartDate: null,
    callAvailability: null,
    interviewAvailability: null,
    veteranStatus: null,
    resumeUrl: null,
    linkedinUrl: null,
    deducedRoles: [],
    availabilityLastSignalAt: null,
    ...overrides,
  };
}

describe("candidate-repository (in-memory)", () => {
  beforeEach(() => {
    clearCandidateStoreForTest();
  });

  describe("listCandidates", () => {
    it("returns empty array when no candidates exist", async () => {
      const result = await listCandidates({
        tenantId: "tenant-a",
        availabilityStatus: "active",
      });
      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it("returns candidates matching tenantId and availability filter", async () => {
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000001", tenantId: "tenant-a", availabilityStatus: "active" }));
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000002", tenantId: "tenant-a", availabilityStatus: "passive" }));
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000003", tenantId: "tenant-b", availabilityStatus: "active" }));

      const result = await listCandidates({ tenantId: "tenant-a", availabilityStatus: "active" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("00000000-0000-0000-0000-000000000001");
    });

    it("filters out non-active ingestion_state candidates", async () => {
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000010", ingestionState: "active" }));
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000011", ingestionState: "pending_dedup" }));
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000012", ingestionState: "pending_enrichment" }));
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000013", ingestionState: "rejected" }));

      const result = await listCandidates({ tenantId: "tenant-a", availabilityStatus: "active" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("00000000-0000-0000-0000-000000000010");
    });

    it("filters by location substring (case-insensitive)", async () => {
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000020", location: "Dallas, TX" }));
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000021", location: "Houston, TX" }));

      const result = await listCandidates({ tenantId: "tenant-a", location: "dallas" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("00000000-0000-0000-0000-000000000020");
    });

    it("filters by cert_type within certifications JSONB array", async () => {
      seedCandidateForTest(
        makeCandidate({
          id: "00000000-0000-0000-0000-000000000030",
          certifications: [{ type: "A&P", issuer: "FAA" }],
        }),
      );
      seedCandidateForTest(
        makeCandidate({
          id: "00000000-0000-0000-0000-000000000031",
          certifications: [{ type: "CFI", issuer: "FAA" }],
        }),
      );

      const result = await listCandidates({ tenantId: "tenant-a", certType: "a&p" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("00000000-0000-0000-0000-000000000030");
    });

    it("implements cursor-based pagination correctly", async () => {
      for (let i = 1; i <= 5; i++) {
        seedCandidateForTest(
          makeCandidate({ id: `00000000-0000-0000-0000-00000000000${i}`, availabilityStatus: "active" }),
        );
      }

      const page1 = await listCandidates({ tenantId: "tenant-a", availabilityStatus: "active", limit: 3 });
      expect(page1.items).toHaveLength(3);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await listCandidates({
        tenantId: "tenant-a",
        availabilityStatus: "active",
        limit: 3,
        cursor: page1.nextCursor!,
      });
      expect(page2.items).toHaveLength(2);
      expect(page2.nextCursor).toBeNull();

      const allIds = [...page1.items, ...page2.items].map((c) => c.id);
      expect(new Set(allIds).size).toBe(5);
    });

    it("respects max limit of 100", async () => {
      for (let i = 1; i <= 5; i++) {
        seedCandidateForTest(makeCandidate({ id: `00000000-0000-0000-0000-0000000000a${i}`, availabilityStatus: "active" }));
      }
      const result = await listCandidates({ tenantId: "tenant-a", availabilityStatus: "active", limit: 200 });
      expect(result.items.length).toBeLessThanOrEqual(100);
    });

    it("isolates tenants — tenant-b cannot see tenant-a candidates", async () => {
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000040", tenantId: "tenant-a" }));

      const result = await listCandidates({ tenantId: "tenant-b", availabilityStatus: "active" });
      expect(result.items).toHaveLength(0);
    });

    // New filter tests
    it("filters by email substring (case-insensitive)", async () => {
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000100", email: "jane@example.com" }));
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000101", email: "bob@other.com" }));

      const result = await listCandidates({ tenantId: "tenant-a", email: "example" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("00000000-0000-0000-0000-000000000100");
    });

    it("filters by jobTitle substring", async () => {
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000110", jobTitle: "A&P Mechanic" }));
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000111", jobTitle: "Pilot" }));

      const result = await listCandidates({ tenantId: "tenant-a", jobTitle: "mechanic" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("00000000-0000-0000-0000-000000000110");
    });

    it("filters by skills array content", async () => {
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000120", skills: ["welding", "sheet metal"] }));
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000121", skills: ["avionics"] }));

      const result = await listCandidates({ tenantId: "tenant-a", skills: "welding" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("00000000-0000-0000-0000-000000000120");
    });

    it("filters by employmentType (exact match)", async () => {
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000130", employmentType: "contract" }));
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000131", employmentType: "full-time" }));

      const result = await listCandidates({ tenantId: "tenant-a", employmentType: "contract" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("00000000-0000-0000-0000-000000000130");
    });

    it("filters by yearsOfExperience (gte numeric)", async () => {
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000140", yearsOfExperience: "10" }));
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000141", yearsOfExperience: "3" }));
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000142", yearsOfExperience: null }));

      const result = await listCandidates({ tenantId: "tenant-a", yearsOfExperience: "5" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("00000000-0000-0000-0000-000000000140");
    });

    it("filters by hasApLicense (boolean)", async () => {
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000150", hasApLicense: true }));
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000151", hasApLicense: false }));

      const result = await listCandidates({ tenantId: "tenant-a", hasApLicense: true });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("00000000-0000-0000-0000-000000000150");
    });

    it("accepts any single filter (not just original 3)", async () => {
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000160", source: "ceipal" }));

      const result = await listCandidates({ tenantId: "tenant-a", source: "ceipal" });
      expect(result.items).toHaveLength(1);
    });

    // Sort tests
    it("default sort: single filter returns results by created_at DESC", async () => {
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000200", createdAt: "2026-01-01T00:00:00Z" }));
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000201", createdAt: "2026-03-01T00:00:00Z" }));
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000202", createdAt: "2026-02-01T00:00:00Z" }));

      const result = await listCandidates({ tenantId: "tenant-a", availabilityStatus: "active" });
      expect(result.items[0].id).toBe("00000000-0000-0000-0000-000000000201");
      expect(result.items[1].id).toBe("00000000-0000-0000-0000-000000000202");
      expect(result.items[2].id).toBe("00000000-0000-0000-0000-000000000200");
      expect(result.sortedBy).toBe("created_at:desc");
    });

    it("relevance sort: multi-filter returns available first, then by experience", async () => {
      seedCandidateForTest(makeCandidate({
        id: "00000000-0000-0000-0000-000000000210",
        availabilityStatus: "passive",
        yearsOfExperience: "15",
        location: "Houston",
        jobTitle: "Mechanic",
      }));
      seedCandidateForTest(makeCandidate({
        id: "00000000-0000-0000-0000-000000000211",
        availabilityStatus: "active",
        yearsOfExperience: "5",
        location: "Houston",
        jobTitle: "Mechanic",
      }));
      seedCandidateForTest(makeCandidate({
        id: "00000000-0000-0000-0000-000000000212",
        availabilityStatus: "active",
        yearsOfExperience: "10",
        location: "Houston",
        jobTitle: "Mechanic",
      }));

      const result = await listCandidates({
        tenantId: "tenant-a",
        location: "Houston",
        jobTitle: "Mechanic",
      });

      // Active candidates first, then by experience DESC
      expect(result.items[0].id).toBe("00000000-0000-0000-0000-000000000212"); // active, 10y
      expect(result.items[1].id).toBe("00000000-0000-0000-0000-000000000211"); // active, 5y
      expect(result.items[2].id).toBe("00000000-0000-0000-0000-000000000210"); // passive, 15y
      expect(result.sortedBy).toBe("relevance");
    });

    it("explicit sort: sort_by=years_of_experience&sort_dir=desc", async () => {
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000220", yearsOfExperience: "3" }));
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000221", yearsOfExperience: "10" }));
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000222", yearsOfExperience: "7" }));

      const result = await listCandidates({
        tenantId: "tenant-a",
        availabilityStatus: "active",
        sortBy: "years_of_experience",
        sortDir: "desc",
      });

      expect(result.sortedBy).toBe("years_of_experience:desc");
    });

    it("includes jobTitle and skills in CandidateListItem", async () => {
      seedCandidateForTest(makeCandidate({
        id: "00000000-0000-0000-0000-000000000230",
        jobTitle: "Avionics Tech",
        skills: ["soldering", "wiring"],
      }));

      const result = await listCandidates({ tenantId: "tenant-a", availabilityStatus: "active" });
      expect(result.items[0].jobTitle).toBe("Avionics Tech");
      expect(result.items[0].skills).toEqual(["soldering", "wiring"]);
    });
  });

  describe("getCandidateById", () => {
    it("returns full candidate detail when found", async () => {
      const candidate = makeCandidate({
        id: "00000000-0000-0000-0000-000000000050",
        tenantId: "tenant-a",
        jobTitle: "Senior A&P",
        skills: [{ name: "jet engines" }],
      });
      seedCandidateForTest(candidate);

      const result = await getCandidateById("00000000-0000-0000-0000-000000000050", "tenant-a");
      expect(result.id).toBe("00000000-0000-0000-0000-000000000050");
      expect(result.jobTitle).toBe("Senior A&P");
      expect(result.skills).toEqual([{ name: "jet engines" }]);
      expect(result.source).toBe("csv");
      expect(result.ingestionState).toBe("active");
    });

    it("throws CandidateNotFoundError when id not found", async () => {
      await expect(
        getCandidateById("00000000-0000-0000-0000-000000000099", "tenant-a"),
      ).rejects.toThrow(CandidateNotFoundError);
    });

    it("throws CandidateNotFoundError when id exists but tenant mismatches", async () => {
      seedCandidateForTest(makeCandidate({ id: "00000000-0000-0000-0000-000000000060", tenantId: "tenant-a" }));

      await expect(
        getCandidateById("00000000-0000-0000-0000-000000000060", "tenant-b"),
      ).rejects.toThrow(CandidateNotFoundError);
    });

    it("returns all source and ingestion metadata fields", async () => {
      const batchId = crypto.randomUUID();
      const candidate = makeCandidate({
        id: "00000000-0000-0000-0000-000000000070",
        source: "ats",
        sourceBatchId: batchId,
        ingestionState: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      });
      seedCandidateForTest(candidate);

      const result = await getCandidateById("00000000-0000-0000-0000-000000000070", "tenant-a");
      expect(result.source).toBe("ats");
      expect(result.sourceBatchId).toBe(batchId);
      expect(result.ingestionState).toBe("active");
      expect(result.createdAt).toBe("2026-01-01T00:00:00.000Z");
      expect(result.updatedAt).toBe("2026-02-01T00:00:00.000Z");
    });
  });
});
