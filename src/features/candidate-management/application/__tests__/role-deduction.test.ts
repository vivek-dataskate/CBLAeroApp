import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  deduceRolesHeuristic,
  deduceRolesLlm,
  deduceRoles,
} from "../role-deduction";
import type { RoleTaxonomyEntry } from "../../infrastructure/role-taxonomy-repository";

// Mock the AI modules
vi.mock("@/modules/ai/inference", () => ({
  callLlm: vi.fn(),
}));

vi.mock("@/modules/ai/prompt-registry", () => ({
  loadPrompt: vi.fn().mockResolvedValue(null),
  registerFallbackPrompt: vi.fn(),
}));

// Mock the role-taxonomy-repository
vi.mock("../../infrastructure/role-taxonomy-repository", () => ({
  getAllRoles: vi.fn(),
  findRoleByName: vi.fn(),
  insertRole: vi.fn(),
  getRolesWithAliases: vi.fn(),
}));

// Mock recordSyncFailure (used by role-deduction for error tracking)
vi.mock("@/modules/ingestion", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, recordSyncFailure: vi.fn() };
});

const { callLlm } = await import("@/modules/ai/inference");
const { getAllRoles, insertRole } = await import(
  "../../infrastructure/role-taxonomy-repository"
);

const mockCallLlm = callLlm as ReturnType<typeof vi.fn>;
const mockGetAllRoles = getAllRoles as ReturnType<typeof vi.fn>;
const mockInsertRole = insertRole as ReturnType<typeof vi.fn>;

// Sample taxonomy for tests
const AVIATION_TAXONOMY: RoleTaxonomyEntry[] = [
  {
    id: 1, tenantId: "test", roleName: "A&P Mechanic", category: "aviation",
    aliases: ["A&P Aircraft Maintenance Tech", "AP Mechanic", "Airframe and Powerplant Mechanic", "A&P AIRCRAFT MAINTENANCE TECH III"],
    isActive: true, createdAt: "", updatedAt: "",
  },
  {
    id: 2, tenantId: "test", roleName: "Avionics Technician", category: "aviation",
    aliases: ["Avionics Tech", "AVIONICS TECH"],
    isActive: true, createdAt: "", updatedAt: "",
  },
  {
    id: 3, tenantId: "test", roleName: "Sheet Metal Technician", category: "aviation",
    aliases: ["Sheet Metal Tech", "Aircraft Structures Technician/Sheet Metal"],
    isActive: true, createdAt: "", updatedAt: "",
  },
  {
    id: 4, tenantId: "test", roleName: "QC Inspector", category: "aviation",
    aliases: ["Quality Control Inspector", "QA Inspector"],
    isActive: true, createdAt: "", updatedAt: "",
  },
  {
    id: 5, tenantId: "test", roleName: "Composite Technician", category: "aviation",
    aliases: ["Composite Tech", "Composites Technician"],
    isActive: true, createdAt: "", updatedAt: "",
  },
];

const IT_TAXONOMY: RoleTaxonomyEntry[] = [
  {
    id: 100, tenantId: "test", roleName: "Python Developer", category: "it",
    aliases: [], isActive: true, createdAt: "", updatedAt: "",
  },
  {
    id: 101, tenantId: "test", roleName: "Backend Engineer", category: "it",
    aliases: [], isActive: true, createdAt: "", updatedAt: "",
  },
];

const FULL_TAXONOMY = [...AVIATION_TAXONOMY, ...IT_TAXONOMY];

describe("deduceRolesHeuristic", () => {
  it("exact role_name match returns confidence 1.0", () => {
    const result = deduceRolesHeuristic("A&P Mechanic", [], AVIATION_TAXONOMY);
    expect(result.roles).toEqual(["A&P Mechanic"]);
    expect(result.confidence).toBe(1.0);
  });

  it("alias containment match returns confidence 0.9", () => {
    const result = deduceRolesHeuristic("A&P Aircraft Maintenance Tech", [], AVIATION_TAXONOMY);
    expect(result.roles).toEqual(["A&P Mechanic"]);
    expect(result.confidence).toBe(0.9);
  });

  it("alias match is case-insensitive", () => {
    const result = deduceRolesHeuristic("a&p aircraft maintenance tech iii", [], AVIATION_TAXONOMY);
    expect(result.roles).toEqual(["A&P Mechanic"]);
    expect(result.confidence).toBe(0.9);
  });

  it("no match returns empty roles and confidence 0", () => {
    const result = deduceRolesHeuristic("Software Developer", [], AVIATION_TAXONOMY);
    expect(result.roles).toEqual([]);
    expect(result.confidence).toBe(0);
  });

  it("empty job title and no skills returns empty", () => {
    const result = deduceRolesHeuristic("", [], AVIATION_TAXONOMY);
    expect(result.roles).toEqual([]);
    expect(result.confidence).toBe(0);
  });

  it("null job title and no skills returns empty", () => {
    const result = deduceRolesHeuristic(null, [], AVIATION_TAXONOMY);
    expect(result.roles).toEqual([]);
    expect(result.confidence).toBe(0);
  });

  it("skills keyword intersection matches", () => {
    const result = deduceRolesHeuristic("Technician", ["avionics"], AVIATION_TAXONOMY);
    expect(result.roles).toContain("Avionics Technician");
  });

  it("enforces max 3 roles cap", () => {
    // Use a title that could match many roles via substring
    const result = deduceRolesHeuristic("Technician Inspector", [], AVIATION_TAXONOMY);
    expect(result.roles.length).toBeLessThanOrEqual(3);
  });

  it("mixed aviation + IT taxonomy works", () => {
    const result = deduceRolesHeuristic("A&P Mechanic", [], FULL_TAXONOMY);
    expect(result.roles).toEqual(["A&P Mechanic"]);
  });

  it("partial substring match returns lower confidence", () => {
    const result = deduceRolesHeuristic("Quality Control Inspector at Boeing", [], AVIATION_TAXONOMY);
    expect(result.roles).toContain("QC Inspector");
    expect(result.confidence).toBe(0.9); // alias match
  });
});

describe("deduceRolesLlm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses valid LLM JSON response and matches against in-memory taxonomy", async () => {
    mockCallLlm.mockResolvedValue({ text: '{"roles": ["A&P Mechanic"]}' });

    const roles = await deduceRolesLlm("A&P Tech", [], [], [], AVIATION_TAXONOMY, "test");
    expect(roles).toEqual(["A&P Mechanic"]);
  });

  it("handles markdown-fenced JSON response", async () => {
    mockCallLlm.mockResolvedValue({ text: '```json\n{"roles": ["Avionics Technician"]}\n```' });

    const roles = await deduceRolesLlm("Avionics Tech", [], [], [], AVIATION_TAXONOMY, "test");
    expect(roles).toEqual(["Avionics Technician"]);
  });

  it("returns empty array when callLlm returns null", async () => {
    mockCallLlm.mockResolvedValue(null);

    const roles = await deduceRolesLlm("A&P Tech", [], [], [], AVIATION_TAXONOMY, "test");
    expect(roles).toEqual([]);
  });

  it("returns empty array on malformed JSON", async () => {
    mockCallLlm.mockResolvedValue({ text: "not json at all" });

    const roles = await deduceRolesLlm("A&P Tech", [], [], [], AVIATION_TAXONOMY, "test");
    expect(roles).toEqual([]);
  });

  it("enforces max 3 roles from LLM", async () => {
    mockCallLlm.mockResolvedValue({ text: '{"roles": ["Role1", "Role2", "Role3", "Role4"]}' });
    // M11 fix: return full RoleTaxonomyEntry shape from mock
    mockInsertRole.mockImplementation((_t: string, name: string) =>
      Promise.resolve({
        id: 999, tenantId: _t, roleName: name, category: "it" as const,
        aliases: [], isActive: true, createdAt: "", updatedAt: "",
      })
    );

    const roles = await deduceRolesLlm("Some Title", [], [], [], [], "test");
    expect(roles.length).toBeLessThanOrEqual(3);
  });

  it("inserts new IT roles when not found in taxonomy", async () => {
    mockCallLlm.mockResolvedValue({ text: '{"roles": ["React Developer"]}' });
    mockInsertRole.mockResolvedValue({
      id: 999, tenantId: "test", roleName: "React Developer", category: "it",
      aliases: [], isActive: true, createdAt: "", updatedAt: "",
    });

    const roles = await deduceRolesLlm("React Dev", [], [], [], AVIATION_TAXONOMY, "test");
    expect(roles).toEqual(["React Developer"]);
    expect(mockInsertRole).toHaveBeenCalledWith("test", "React Developer", "it");
  });

  it("key-whitelist sanitizes to roles only", async () => {
    mockCallLlm.mockResolvedValue({
      text: '{"roles": ["A&P Mechanic"], "confidence": 0.95, "reasoning": "obvious"}',
    });

    const roles = await deduceRolesLlm("A&P Tech", [], [], [], AVIATION_TAXONOMY, "test");
    expect(roles).toEqual(["A&P Mechanic"]); // Only roles returned, not confidence/reasoning
  });

  it("filters out role names exceeding 200 characters", async () => {
    const longRole = "A".repeat(201);
    mockCallLlm.mockResolvedValue({ text: `{"roles": ["${longRole}", "A&P Mechanic"]}` });

    const roles = await deduceRolesLlm("Tech", [], [], [], AVIATION_TAXONOMY, "test");
    expect(roles).toEqual(["A&P Mechanic"]);
  });
});

describe("deduceRoles (orchestrator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllRoles.mockResolvedValue(FULL_TAXONOMY);
  });

  it("returns heuristic result when confidence >= 0.5", async () => {
    const result = await deduceRoles(
      { jobTitle: "A&P Mechanic", skills: [] },
      "test",
    );
    expect(result.roles).toEqual(["A&P Mechanic"]);
    expect(result.metadata.source).toBe("heuristic");
    expect(result.metadata.confidence).toBe(1.0);
  });

  it("returns heuristic result in heuristicOnly mode even with low confidence", async () => {
    const result = await deduceRoles(
      { jobTitle: "Unknown Role XYZ", skills: [] },
      "test",
      { heuristicOnly: true },
    );
    expect(result.metadata.source).toBe("heuristic");
    expect(result.roles).toEqual([]);
  });

  it("falls back to LLM when heuristic returns 0 roles", async () => {
    mockCallLlm.mockResolvedValue({ text: '{"roles": ["Data Scientist"]}' });
    mockInsertRole.mockResolvedValue({
      id: 999, tenantId: "test", roleName: "Data Scientist", category: "it",
      aliases: [], isActive: true, createdAt: "", updatedAt: "",
    });

    const result = await deduceRoles(
      { jobTitle: "Chief Data Scientist", skills: ["Machine Learning", "TensorFlow"] },
      "test",
    );
    expect(result.metadata.source).toBe("llm");
    expect(result.roles).toEqual(["Data Scientist"]);
  });

  it("metadata includes rawJobTitle and deducedAt", async () => {
    const result = await deduceRoles(
      { jobTitle: "A&P Mechanic", skills: ["welding"] },
      "test",
    );
    expect(result.metadata.rawJobTitle).toBe("A&P Mechanic");
    expect(result.metadata.rawSkills).toEqual(["welding"]);
    expect(result.metadata.deducedAt).toBeDefined();
  });

  // H10 fix: test that LLM errors don't crash the orchestrator
  it("returns heuristic result when callLlm throws", async () => {
    mockCallLlm.mockRejectedValue(new Error("API timeout"));

    const result = await deduceRoles(
      { jobTitle: "Chief Data Scientist", skills: ["ML"] },
      "test",
    );
    // Should fall back to heuristic (which returns empty for unknown roles) rather than throwing
    expect(result.metadata.source).toBe("heuristic");
    expect(result.roles).toEqual([]);
  });
});
