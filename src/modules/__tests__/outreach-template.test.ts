import { describe, it, expect } from "vitest";
import {
  renderTemplate,
  computeContentHash,
  extractVariables,
} from "../outreach/template-renderer";
import { validateTemplate } from "../outreach/template-validator";
import {
  isValidAgenda,
  getAgendaLabel,
  SMS_AGENDAS,
} from "../outreach/agenda";

// ── Agenda ─────────────────────────────────────────────────────────────────

describe("agenda", () => {
  it("validates known agendas", () => {
    expect(isValidAgenda("new_opportunity")).toBe(true);
    expect(isValidAgenda("bgv_followup")).toBe(true);
    expect(isValidAgenda("general")).toBe(true);
  });

  it("rejects unknown agendas", () => {
    expect(isValidAgenda("invalid_agenda")).toBe(false);
    expect(isValidAgenda("")).toBe(false);
    expect(isValidAgenda("NEW_OPPORTUNITY")).toBe(false); // case-sensitive
  });

  it("returns display label for agenda", () => {
    expect(getAgendaLabel("new_opportunity")).toBe("New Opportunity");
    expect(getAgendaLabel("bgv_initiation")).toBe("BGV Initiation");
  });

  it("has 13 agenda categories", () => {
    expect(SMS_AGENDAS).toHaveLength(13);
  });
});

// ── Template Renderer ──────────────────────────────────────────────────────

describe("renderTemplate", () => {
  it("substitutes all variables", () => {
    const result = renderTemplate(
      "Hi {{first_name}}, check out {{job_title}} at {{company}}!",
      { first_name: "Sarah", job_title: "A&P Mechanic", company: "Boeing" },
    );
    expect(result.rendered).toBe(
      "Hi Sarah, check out A&P Mechanic at Boeing!",
    );
    expect(result.warnings).toHaveLength(0);
  });

  it("replaces unresolved variables with empty string and warns", () => {
    const result = renderTemplate("Hi {{first_name}}, role: {{job_title}}", {
      first_name: "Sarah",
    });
    expect(result.rendered).toBe("Hi Sarah, role: ");
    expect(result.warnings).toContain("Unresolved variable: {{job_title}}");
  });

  it("handles null/undefined variable values", () => {
    const result = renderTemplate("Hi {{first_name}}", {
      first_name: null,
    });
    expect(result.rendered).toBe("Hi ");
    expect(result.warnings).toContain("Unresolved variable: {{first_name}}");
  });

  it("warns when rendered output exceeds 1600 chars", () => {
    const longBody = "A".repeat(1590) + "{{first_name}}";
    const result = renderTemplate(longBody, {
      first_name: "LongNameThatPushesOverTheLimit",
    });
    expect(result.warnings.some((w) => w.includes("exceeds"))).toBe(true);
  });

  it("does not warn for exactly 1600 chars", () => {
    const body = "A".repeat(1600);
    const result = renderTemplate(body, {});
    expect(result.warnings.some((w) => w.includes("exceeds"))).toBe(false);
  });

  it("produces a content hash", () => {
    const result = renderTemplate("Hello {{first_name}}", {
      first_name: "Sarah",
    });
    expect(result.contentHash).toBeTruthy();
    expect(result.contentHash.length).toBe(64); // SHA-256 hex
  });

  it("produces different hashes for different content", () => {
    const r1 = renderTemplate("Hello {{first_name}}", {
      first_name: "Sarah",
    });
    const r2 = renderTemplate("Hello {{first_name}}", {
      first_name: "Mike",
    });
    expect(r1.contentHash).not.toBe(r2.contentHash);
  });

  it("handles empty template body", () => {
    const result = renderTemplate("", {});
    expect(result.rendered).toBe("");
    expect(result.contentHash).toBeTruthy();
  });

  it("handles unicode and emoji in body", () => {
    const result = renderTemplate("Hi {{first_name}} 🎉 Great news!", {
      first_name: "María",
    });
    expect(result.rendered).toBe("Hi María 🎉 Great news!");
  });

  it("does not substitute partial matches like {first_name}", () => {
    const result = renderTemplate("Hi {first_name} and {{last_name}}", {
      last_name: "Smith",
    });
    expect(result.rendered).toBe("Hi {first_name} and Smith");
  });
});

describe("computeContentHash", () => {
  it("includes phone when provided", () => {
    const h1 = computeContentHash("Hello", "+1234567890");
    const h2 = computeContentHash("Hello");
    expect(h1).not.toBe(h2);
  });

  it("is deterministic", () => {
    const h1 = computeContentHash("same content", "+1234");
    const h2 = computeContentHash("same content", "+1234");
    expect(h1).toBe(h2);
  });
});

describe("extractVariables", () => {
  it("extracts all unique variable names", () => {
    const vars = extractVariables(
      "Hi {{first_name}}, your {{job_title}} at {{company}}. {{first_name}} rocks!",
    );
    expect(vars).toEqual(["first_name", "job_title", "company"]);
  });

  it("returns empty array for no variables", () => {
    expect(extractVariables("No variables here")).toEqual([]);
  });
});

// ── Template Validator ─────────────────────────────────────────────────────

describe("validateTemplate", () => {
  const validTemplate = {
    body: "Hi {{first_name}}, test message. Reply STOP to opt out.",
    agenda: "new_opportunity",
    name: "Test Template",
  };

  it("accepts a valid template", () => {
    const result = validateTemplate(validTemplate);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects missing name", () => {
    const result = validateTemplate({ ...validTemplate, name: "" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Template name is required");
  });

  it("rejects invalid agenda", () => {
    const result = validateTemplate({ ...validTemplate, agenda: "invalid" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Invalid agenda"))).toBe(true);
  });

  it("rejects empty body", () => {
    const result = validateTemplate({ ...validTemplate, body: "" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Template body is required");
  });

  it("rejects body exceeding 1600 chars", () => {
    const result = validateTemplate({
      ...validTemplate,
      body: "A".repeat(1601) + " Reply STOP to opt out.",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("maximum length"))).toBe(true);
  });

  it("rejects template without STOP/opt-out language", () => {
    const result = validateTemplate({
      ...validTemplate,
      body: "Hi {{first_name}}, check this amazing role today!",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("opt-out language"))).toBe(
      true,
    );
  });

  it("accepts template with opt-out as alternative to STOP", () => {
    const result = validateTemplate({
      ...validTemplate,
      body: "Hi {{first_name}}, text opt-out to unsubscribe.",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects script injection", () => {
    const result = validateTemplate({
      ...validTemplate,
      body: "Hi <script>alert(1)</script>. Reply STOP to opt out.",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unsafe content"))).toBe(true);
  });

  it("rejects unknown variables", () => {
    const result = validateTemplate({
      ...validTemplate,
      body: "Hi {{first_name}}, your {{social_security_number}}. STOP to opt out.",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Unknown variable"))).toBe(
      true,
    );
  });

  it("accepts all known variables", () => {
    const result = validateTemplate({
      ...validTemplate,
      body: "{{first_name}} {{last_name}} {{job_title}} {{company}} {{location}} {{recruiter_name}} {{tracking_link}} STOP",
    });
    expect(result.valid).toBe(true);
  });
});
