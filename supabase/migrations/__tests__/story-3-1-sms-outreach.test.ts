// Story 3-1 PR 1 / Task 1.4 — migration + seed RPC structural tests.
//
// These tests run against the migration SQL text and the corresponding
// schema.sql DDL block — no live Supabase required. They catch:
//   * Copy drift (any re-worded seed body that violates TCPA / AC 2).
//   * Dual-Update Rule violations (§4.9) — migration + schema.sql diverge.
//   * Observability-table mutation rules (§3) — no UPDATE / DELETE there.
//   * Anti-reinvention guardrails (AC 14) — service_role grants, RLS gates.
//
// Story acceptance anchors:
//   AC 1  — 13 agenda enum
//   AC 2  — 12 seed templates, ≤ 480 chars, {{first_name}} +
//           {{tracking_link}} + STOP line + identifiable sender
//   AC 7  — policy_registry seed for the default contact window
//   AC 12 — schema delta (provider_idempotency_key, trace_id,
//           correlation_id, event_envelope) + RPCs + RLS + grants
//   AC 14 — no anon grants, no parallel audit tables

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = path.resolve(
  __dirname,
  "..",
  "2026-04-17-story-3-1-sms-outreach.sql",
);
const SCHEMA_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "schema.sql",
);

const migration = readFileSync(MIGRATION_PATH, "utf8");
const schemaSql = readFileSync(SCHEMA_PATH, "utf8");

// The 13 agenda values enforced by sms_templates_agenda_valid CHECK.
const AGENDA_ENUM = [
  "new_opportunity",
  "availability_check",
  "job_followup",
  "submission_followup",
  "interview_schedule",
  "interview_reminder",
  "interview_followup",
  "bgv_initiation",
  "bgv_followup",
  "offer_extended",
  "onboarding",
  "reengagement",
  "general",
];

// Agendas that the seed MUST cover per AC 2 (≥ once; new_opportunity twice).
const REQUIRED_SEED_AGENDAS: Array<[string, number]> = [
  ["new_opportunity", 2],
  ["availability_check", 1],
  ["job_followup", 1],
  ["submission_followup", 1],
  ["interview_schedule", 1],
  ["interview_reminder", 1],
  ["bgv_initiation", 1],
  ["offer_extended", 1],
  ["onboarding", 1],
  ["reengagement", 1],
  ["general", 1],
];

// Parse the 12 jsonb_build_object(...) seed rows in seed_sms_templates.
// Each block looks like:
//   jsonb_build_object(
//     'agenda','...', 'key','...',
//     'name','...',
//     'body','...',
//     'variables', jsonb_build_array(...)
//   )
interface ParsedSeed {
  agenda: string;
  key: string;
  name: string;
  body: string;
  variables: string[];
}

function parseSeeds(sql: string): ParsedSeed[] {
  const seedBlockMatch = sql.match(
    /v_seeds\s+jsonb\s*:=\s*jsonb_build_array\(([\s\S]*?)\);\s*\nbegin/,
  );
  if (!seedBlockMatch) {
    throw new Error("seed_sms_templates: could not locate v_seeds block");
  }
  const block = seedBlockMatch[1];
  const objectRegex = /jsonb_build_object\(([\s\S]*?)\n\s*\)/g;
  const seeds: ParsedSeed[] = [];
  let match: RegExpExecArray | null;
  while ((match = objectRegex.exec(block)) !== null) {
    const inner = match[1];
    const pick = (key: string): string | undefined => {
      const re = new RegExp(`'${key}'\\s*,\\s*'((?:[^']|'')*)'`);
      const m = inner.match(re);
      if (!m) return undefined;
      // Un-escape doubled single quotes back to a single quote.
      return m[1].replace(/''/g, "'");
    };
    const agenda = pick("agenda");
    const key = pick("key");
    const name = pick("name");
    const body = pick("body");
    if (!agenda || !key || !name || !body) continue;
    const varsMatch = inner.match(
      /'variables'\s*,\s*jsonb_build_array\(([^)]*)\)/,
    );
    const variables = varsMatch
      ? [...varsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
      : [];
    seeds.push({ agenda, key, name, body, variables });
  }
  return seeds;
}

describe("Story 3-1 migration (2026-04-17-story-3-1-sms-outreach.sql)", () => {
  // ── Structural deltas (AC 12) ──────────────────────────────────────────

  describe("schema deltas", () => {
    it("adds provider_idempotency_key column to sms_sends", () => {
      expect(migration).toMatch(
        /alter\s+table\s+cblaero_app\.sms_sends\s+add\s+column\s+if\s+not\s+exists\s+provider_idempotency_key\s+text/i,
      );
    });

    it("adds a partial unique index on (tenant_id, provider_idempotency_key)", () => {
      expect(migration).toMatch(
        /idx_sms_sends_provider_idempotency_key[\s\S]*?where\s+provider_idempotency_key\s+is\s+not\s+null/i,
      );
    });

    it("extends sms_sends.status CHECK with 'blocked_cooldown' (arch §10)", () => {
      const checkMatch = migration.match(
        /sms_sends_status_valid[\s\S]*?check\s*\(([^)]*?)\)\)/i,
      );
      expect(checkMatch).not.toBeNull();
      const check = checkMatch![1];
      expect(check).toContain("'blocked_cooldown'");
      expect(check).toContain("'blocked_opt_out'");
      expect(check).toContain("'deferred_window'");
    });

    it("adds trace_id / correlation_id / event_envelope to outreach_audit_log", () => {
      expect(migration).toMatch(/add\s+column\s+if\s+not\s+exists\s+trace_id\s+text/i);
      expect(migration).toMatch(
        /add\s+column\s+if\s+not\s+exists\s+correlation_id\s+text/i,
      );
      expect(migration).toMatch(
        /add\s+column\s+if\s+not\s+exists\s+event_envelope\s+jsonb/i,
      );
    });
  });

  // ── RPCs (AC 6, 12) ────────────────────────────────────────────────────

  describe("RPCs", () => {
    it("defines claim_due_sms_sends(p_tenant_id, p_batch_size, p_now) with FOR UPDATE SKIP LOCKED (F1: tenant isolation)", () => {
      expect(migration).toMatch(
        /create\s+or\s+replace\s+function\s+cblaero_app\.claim_due_sms_sends/i,
      );
      expect(migration).toMatch(/for\s+update\s+skip\s+locked/i);
    });

    it("claim_due_sms_sends takes p_tenant_id as first parameter (multi-tenant isolation — F1)", () => {
      const sig = migration.match(
        /function\s+cblaero_app\.claim_due_sms_sends\s*\(([\s\S]*?)\)\s*returns/i,
      )?.[1];
      expect(sig).toBeDefined();
      expect(sig).toMatch(/p_tenant_id\s+text/);
    });

    it("claim_due_sms_sends filters by tenant_id in WHERE clause (F1)", () => {
      const body = migration.match(
        /function\s+cblaero_app\.claim_due_sms_sends[\s\S]*?\$\$;/i,
      )?.[0];
      expect(body).toBeDefined();
      expect(body).toMatch(/tenant_id\s*=\s*p_tenant_id/i);
    });

    it("claim_due_sms_sends validates p_tenant_id (F1)", () => {
      const body = migration.match(
        /function\s+cblaero_app\.claim_due_sms_sends[\s\S]*?\$\$;/i,
      )?.[0];
      expect(body).toBeDefined();
      expect(body).toMatch(/p_tenant_id\s+is\s+null/i);
    });

    it("claim_due_sms_sends validates p_batch_size upper bound ≤ 500 (F8)", () => {
      const body = migration.match(
        /function\s+cblaero_app\.claim_due_sms_sends[\s\S]*?\$\$;/i,
      )?.[0];
      expect(body).toBeDefined();
      expect(body).toMatch(/p_batch_size\s*>\s*500/i);
    });

    it("claim_due_sms_sends transitions claimed rows to 'queued'", () => {
      const body = migration.match(
        /function\s+cblaero_app\.claim_due_sms_sends[\s\S]*?\$\$;/i,
      )?.[0];
      expect(body).toBeDefined();
      expect(body).toMatch(/status\s*=\s*'queued'/i);
      expect(body).toMatch(/delivery_attempt_count\s*=\s*coalesce/i);
    });

    it("defines insert_sms_sends_bulk(p_rows jsonb) returning (inserted, skipped)", () => {
      expect(migration).toMatch(
        /create\s+or\s+replace\s+function\s+cblaero_app\.insert_sms_sends_bulk/i,
      );
      expect(migration).toMatch(
        /returns\s+table\s*\(\s*inserted\s+integer\s*,\s*skipped\s+integer\s*\)/i,
      );
    });

    it("insert_sms_sends_bulk rejects batches > 500 (dev-standards §4.4)", () => {
      expect(migration).toMatch(/jsonb_array_length\s*\(\s*p_rows\s*\)\s*>\s*500/);
    });

    it("insert_sms_sends_bulk pre-checks sms_opted_in scoped to tenant_id (arch §6 + F6)", () => {
      const body = migration.match(
        /function\s+cblaero_app\.insert_sms_sends_bulk[\s\S]*?\$\$;/i,
      )?.[0];
      expect(body).toBeDefined();
      expect(body).toMatch(/candidate_channel_preferences/);
      expect(body).toMatch(/sms_opted_in/);
      expect(body).toMatch(/and\s+tenant_id\s*=\s*v_row\s*->>\s*'tenant_id'/i);
    });

    it("insert_sms_sends_bulk guards required fields before casting (F7 — bad row skipped, not aborted)", () => {
      const body = migration.match(
        /function\s+cblaero_app\.insert_sms_sends_bulk[\s\S]*?\$\$;/i,
      )?.[0];
      expect(body).toBeDefined();
      expect(body).toMatch(/v_row\s*->>\s*'candidate_id'\s*\)\s+is\s+null/i);
      expect(body).toMatch(/v_row\s*->>\s*'tenant_id'\s*\)\s+is\s+null/i);
      expect(body).toMatch(/v_row\s*->>\s*'scheduled_for'\s*\)\s+is\s+null/i);
    });

    it("defines seed_sms_templates(p_tenant_id, p_actor_id) RPC", () => {
      expect(migration).toMatch(
        /create\s+or\s+replace\s+function\s+cblaero_app\.seed_sms_templates/i,
      );
    });

    it("seed_sms_templates inserts ON CONFLICT DO NOTHING (idempotent)", () => {
      const body = migration.match(
        /function\s+cblaero_app\.seed_sms_templates[\s\S]*?\$\$;/i,
      )?.[0];
      expect(body).toBeDefined();
      expect(body).toMatch(/on\s+conflict[\s\S]*?do\s+nothing/i);
    });

    it("seed_sms_templates rejects missing p_tenant_id", () => {
      const body = migration.match(
        /function\s+cblaero_app\.seed_sms_templates[\s\S]*?\$\$;/i,
      )?.[0];
      expect(body).toBeDefined();
      expect(body).toMatch(/p_tenant_id\s+is\s+null\s+or\s+length\(p_tenant_id\)/i);
    });
  });

  // ── Seed copy compliance (AC 2) ────────────────────────────────────────

  describe("seed_sms_templates body copy (AC 2)", () => {
    const seeds = parseSeeds(migration);

    it("declares exactly 12 templates", () => {
      expect(seeds).toHaveLength(12);
    });

    it("all template_keys are unique", () => {
      const keys = seeds.map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("every agenda is in the 13-value CHECK enum (AC 1)", () => {
      for (const s of seeds) {
        expect(AGENDA_ENUM).toContain(s.agenda);
      }
    });

    it.each(REQUIRED_SEED_AGENDAS)(
      "covers required agenda %s at least %i time(s)",
      (agenda, min) => {
        const count = seeds.filter((s) => s.agenda === agenda).length;
        expect(count).toBeGreaterThanOrEqual(min);
      },
    );

    it("every body contains {{first_name}} (AC 2 required placeholder)", () => {
      for (const s of seeds) {
        expect(s.body, `template ${s.key} missing {{first_name}}`).toContain(
          "{{first_name}}",
        );
      }
    });

    it("every body contains {{tracking_link}} (AC 2 required placeholder)", () => {
      for (const s of seeds) {
        expect(s.body, `template ${s.key} missing {{tracking_link}}`).toContain(
          "{{tracking_link}}",
        );
      }
    });

    it("every body contains TCPA opt-out instruction (NFR24)", () => {
      for (const s of seeds) {
        expect(
          s.body.toLowerCase(),
          `template ${s.key} missing opt-out instruction`,
        ).toMatch(/reply\s+stop\s+to\s+opt\s+out/);
      }
    });

    it("every body identifies the sender (CBL Aero + sender_name or literal)", () => {
      // AC 2: "identifies the sender as 'CBL Aero — Mike' or equivalent".
      // Templates use {{sender_name}} + literal "CBL Aero" brand.
      for (const s of seeds) {
        expect(s.body, `template ${s.key} missing CBL Aero brand`).toMatch(
          /CBL\s+Aero/,
        );
      }
    });

    it("every body is ≤ 480 characters (AC 2: 3 SMS segment ceiling)", () => {
      for (const s of seeds) {
        expect(
          s.body.length,
          `template ${s.key} exceeds 480 chars (actual ${s.body.length})`,
        ).toBeLessThanOrEqual(480);
      }
    });

    it("every body is ≤ 1600 characters (sms_templates_body_length CHECK)", () => {
      for (const s of seeds) {
        expect(s.body.length).toBeLessThanOrEqual(1600);
      }
    });

    it("every variables[] includes 'first_name' and 'tracking_link'", () => {
      for (const s of seeds) {
        expect(s.variables, `template ${s.key} variables[]`).toContain(
          "first_name",
        );
        expect(s.variables, `template ${s.key} variables[]`).toContain(
          "tracking_link",
        );
      }
    });

    it("every placeholder in body appears in variables[] (or is 'sender_name')", () => {
      // sender_name is expected in bodies but declared in variables[]; the
      // exception is interview_reminder which uses {{interview_time}} and
      // omits {{sender_name}} (tone = system reminder, not recruiter).
      for (const s of seeds) {
        const placeholders = [
          ...s.body.matchAll(/\{\{([a-z_]+)\}\}/g),
        ].map((m) => m[1]);
        for (const p of placeholders) {
          expect(
            s.variables,
            `template ${s.key} uses {{${p}}} without declaring in variables[]`,
          ).toContain(p);
        }
      }
    });

    it("no body carries the TODO sentinel (PM copy is locked in, Task 1.3)", () => {
      for (const s of seeds) {
        expect(s.body).not.toMatch(/TODO\[pm-approval-pending/);
      }
    });
  });

  // ── RLS policies (AC 12) ───────────────────────────────────────────────

  describe("RLS policies", () => {
    it("sms_templates has an admin-only INSERT policy", () => {
      expect(migration).toMatch(
        /create\s+policy\s+sms_templates_admin_insert\s+on\s+cblaero_app\.sms_templates[\s\S]*?with\s+check[\s\S]*?'role'[\s\S]*?'admin'/i,
      );
    });

    it("sms_templates has an admin-only UPDATE policy", () => {
      expect(migration).toMatch(
        /create\s+policy\s+sms_templates_admin_update\s+on\s+cblaero_app\.sms_templates[\s\S]*?'admin'/i,
      );
    });

    it("sms_sends has a tenant-scoped INSERT policy", () => {
      expect(migration).toMatch(
        /create\s+policy\s+sms_sends_tenant_insert[\s\S]*?tenant_id\s*=\s*\(\(current_setting/i,
      );
    });

    it("sms_sends has a tenant-scoped UPDATE policy", () => {
      expect(migration).toMatch(
        /create\s+policy\s+sms_sends_tenant_update[\s\S]*?tenant_id\s*=\s*\(\(current_setting/i,
      );
    });

    it("sms_sends SELECT policy is tenant-scoped — NOT permissive USING (true) (F4)", () => {
      // Drop policy + recreate with tenant filter; this guards against regression
      // to the original `USING (true)` which exposed all tenants' send records.
      expect(migration).toMatch(/drop\s+policy\s+if\s+exists\s+sms_sends_read/i);
      const policy = migration.match(
        /create\s+policy\s+sms_sends_read[\s\S]*?;/i,
      )?.[0];
      expect(policy).toBeDefined();
      expect(policy).toMatch(/tenant_id\s*=\s*\(\(current_setting/i);
      expect(policy).not.toMatch(/using\s*\(\s*true\s*\)/i);
    });

    it("sms_templates SELECT policy is tenant-scoped — NOT permissive USING (true) (F4)", () => {
      expect(migration).toMatch(/drop\s+policy\s+if\s+exists\s+sms_templates_read/i);
      const policy = migration.match(
        /create\s+policy\s+sms_templates_read[\s\S]*?;/i,
      )?.[0];
      expect(policy).toBeDefined();
      expect(policy).toMatch(/tenant_id\s*=\s*\(\(current_setting/i);
      expect(policy).not.toMatch(/using\s*\(\s*true\s*\)/i);
    });
  });

  // ── Grants (AC 12 + AC 14 + retro guardrail) ───────────────────────────

  describe("grants", () => {
    it("grants to service_role are present for sms_templates, sms_sends, audit_log, and all 3 RPCs", () => {
      expect(migration).toMatch(/grant\s+all\s+on\s+cblaero_app\.sms_templates\s+to\s+service_role/i);
      expect(migration).toMatch(/grant\s+all\s+on\s+cblaero_app\.sms_sends\s+to\s+service_role/i);
      expect(migration).toMatch(/grant\s+all\s+on\s+cblaero_app\.outreach_audit_log\s+to\s+service_role/i);
      expect(migration).toMatch(/grant\s+execute\s+on\s+function\s+cblaero_app\.claim_due_sms_sends\s*\(\s*text\s*,\s*integer\s*,\s*timestamptz\s*\)\s+to\s+service_role/i);
      expect(migration).toMatch(/grant\s+execute\s+on\s+function\s+cblaero_app\.insert_sms_sends_bulk\s*\(\s*jsonb\s*\)\s+to\s+service_role/i);
      expect(migration).toMatch(/grant\s+execute\s+on\s+function\s+cblaero_app\.seed_sms_templates\s*\(\s*text\s*,\s*text\s*\)\s+to\s+service_role/i);
    });

    it("outreach_audit_log grants SELECT only to authenticated — NOT INSERT (F3: no RLS INSERT policy exists)", () => {
      // Audit rows written via service_role repositories only.
      // GRANT INSERT to authenticated with no RLS INSERT policy is a dead letter in Postgres.
      const auditGrantLine = migration
        .split("\n")
        .find((l) => /outreach_audit_log\s+to\s+authenticated/i.test(l));
      expect(auditGrantLine).toBeDefined();
      expect(auditGrantLine).not.toMatch(/\binsert\b/i);
      expect(auditGrantLine).toMatch(/\bselect\b/i);
    });

    it("grants to authenticated are limited to SELECT/INSERT/UPDATE (no DELETE)", () => {
      const grantLines = migration
        .split("\n")
        .filter((l) => /grant[\s\S]*?to\s+authenticated/i.test(l));
      expect(grantLines.length).toBeGreaterThan(0);
      for (const line of grantLines) {
        expect(line).not.toMatch(/\bdelete\b/i);
      }
    });

    it("NO grants to the anon role (Epic 2 retro guardrail)", () => {
      expect(migration).not.toMatch(/to\s+anon\b/i);
    });
  });

  // ── Observability guardrail (dev-standards §3) ─────────────────────────

  describe("observability-table guardrails", () => {
    it("migration does NOT UPDATE or DELETE rows in observability tables", () => {
      const observabilityTables = [
        "sync_runs",
        "sync_errors",
        "audit_authorization_denials",
        "outreach_audit_log",
        "webhook_events",
        "provider_health_events",
      ];
      for (const t of observabilityTables) {
        const updateRe = new RegExp(`update\\s+cblaero_app\\.${t}\\b`, "i");
        const deleteRe = new RegExp(`delete\\s+from\\s+cblaero_app\\.${t}\\b`, "i");
        expect(migration, `found UPDATE on ${t}`).not.toMatch(updateRe);
        expect(migration, `found DELETE on ${t}`).not.toMatch(deleteRe);
      }
    });

    it("migration is declarative-only on outreach_audit_log (ALTER TABLE columns, no row mutation)", () => {
      // outreach_audit_log gets trace_id/correlation_id/event_envelope
      // columns added, but no INSERT/UPDATE/DELETE of rows (writes happen
      // from application code at send time — append-only).
      const rowMutationRe =
        /\b(insert\s+into|update|delete\s+from)\s+cblaero_app\.outreach_audit_log\b/i;
      expect(migration).not.toMatch(rowMutationRe);
    });
  });

  // ── Policy registry seed (AC 7) ────────────────────────────────────────

  describe("policy_registry seed: sms_default_contact_window (AC 7)", () => {
    it("inserts the outreach_defaults/sms_default_contact_window row", () => {
      expect(migration).toMatch(/'outreach_defaults'\s*,\s*'sms_default_contact_window'/);
    });

    it("seed value declares Mon–Fri 08:00–20:00 America/Chicago windows", () => {
      expect(migration).toMatch(/'America\/Chicago'/);
      for (const day of ["mon", "tue", "wed", "thu", "fri"]) {
        const re = new RegExp(`'day'\\s*,\\s*'${day}'`);
        expect(migration, `missing ${day} window`).toMatch(re);
      }
      // Weekends must NOT be seeded (AC 7 default = Mon–Fri only).
      for (const day of ["sat", "sun"]) {
        const re = new RegExp(`'day'\\s*,\\s*'${day}'`);
        expect(migration, `unexpected ${day} window`).not.toMatch(re);
      }
    });

    it("policy_versions insert is idempotent (guarded by NOT EXISTS)", () => {
      expect(migration).toMatch(/not\s+exists\s*\(\s*select\s+1\s+from\s+cblaero_app\.policy_versions/i);
    });
  });

  // ── Idempotency (safe to re-run) ───────────────────────────────────────

  describe("idempotency", () => {
    it("all ALTER TABLE ADD COLUMN statements use IF NOT EXISTS", () => {
      const addColumns = migration.match(/add\s+column\b[^,;\n]*/gi) ?? [];
      expect(addColumns.length).toBeGreaterThan(0);
      for (const stmt of addColumns) {
        expect(stmt, `non-idempotent: ${stmt}`).toMatch(/if\s+not\s+exists/i);
      }
    });

    it("all CREATE INDEX statements use IF NOT EXISTS", () => {
      const indexes = migration.match(/create\s+(?:unique\s+)?index\b[^;]*/gi) ?? [];
      expect(indexes.length).toBeGreaterThan(0);
      for (const stmt of indexes) {
        expect(stmt, `non-idempotent: ${stmt}`).toMatch(/if\s+not\s+exists/i);
      }
    });

    it("all CREATE POLICY statements are preceded by a matching DROP POLICY IF EXISTS", () => {
      const policyNames = [
        ...migration.matchAll(/create\s+policy\s+(\w+)/gi),
      ].map((m) => m[1]);
      expect(policyNames.length).toBeGreaterThan(0);
      for (const name of policyNames) {
        const dropRe = new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+${name}`, "i");
        expect(migration, `CREATE POLICY ${name} missing DROP IF EXISTS`).toMatch(dropRe);
      }
    });

    it("RPCs use CREATE OR REPLACE (re-runnable)", () => {
      const fns = migration.match(/create\s+(?:or\s+replace\s+)?function/gi) ?? [];
      expect(fns.length).toBeGreaterThanOrEqual(3);
      for (const stmt of fns) {
        expect(stmt).toMatch(/create\s+or\s+replace\s+function/i);
      }
    });

    it("policy_registry insert uses ON CONFLICT DO NOTHING", () => {
      const policyInsertMatch = migration.match(
        /insert\s+into\s+cblaero_app\.policy_registry[\s\S]*?on\s+conflict[\s\S]*?do\s+nothing/i,
      );
      expect(policyInsertMatch).not.toBeNull();
    });
  });
});

describe("Story 3-1 schema.sql parity (Dual-Update Rule §4.9)", () => {
  it("schema.sql declares provider_idempotency_key on sms_sends", () => {
    expect(schemaSql).toMatch(/sms_sends[\s\S]*?provider_idempotency_key\s+text/i);
  });

  it("schema.sql sms_sends_status_valid CHECK includes 'blocked_cooldown'", () => {
    const checkMatch = schemaSql.match(
      /sms_sends_status_valid[\s\S]*?CHECK\s*\(\([\s\S]*?\)\)/,
    );
    expect(checkMatch).not.toBeNull();
    expect(checkMatch![0]).toContain("'blocked_cooldown'");
  });

  it("schema.sql declares trace_id/correlation_id/event_envelope on outreach_audit_log", () => {
    const table = schemaSql.match(
      /create\s+table\s+if\s+not\s+exists\s+cblaero_app\.outreach_audit_log[\s\S]*?\);/i,
    )?.[0];
    expect(table).toBeDefined();
    expect(table).toMatch(/trace_id\s+text/);
    expect(table).toMatch(/correlation_id\s+text/);
    expect(table).toMatch(/event_envelope\s+jsonb/);
  });

  it("schema.sql defines claim_due_sms_sends, insert_sms_sends_bulk, seed_sms_templates", () => {
    expect(schemaSql).toMatch(/FUNCTION\s+cblaero_app\.claim_due_sms_sends/i);
    expect(schemaSql).toMatch(/FUNCTION\s+cblaero_app\.insert_sms_sends_bulk/i);
    expect(schemaSql).toMatch(/FUNCTION\s+cblaero_app\.seed_sms_templates/i);
  });

  it("schema.sql seed_sms_templates contains the exact same 12 bodies as the migration", () => {
    const migrationSeeds = parseSeeds(migration);
    const schemaSeeds = parseSeeds(schemaSql);
    expect(schemaSeeds).toHaveLength(migrationSeeds.length);
    const byKey = (arr: ParsedSeed[]) =>
      new Map(arr.map((s) => [s.key, s] as const));
    const mMap = byKey(migrationSeeds);
    const sMap = byKey(schemaSeeds);
    for (const [key, mSeed] of mMap) {
      const sSeed = sMap.get(key);
      expect(sSeed, `schema.sql missing key ${key}`).toBeDefined();
      expect(sSeed!.body, `body drift for ${key}`).toBe(mSeed.body);
      expect(sSeed!.agenda).toBe(mSeed.agenda);
      expect(sSeed!.variables).toEqual(mSeed.variables);
    }
  });

  it("schema.sql has RLS policies for sms_templates admin-only writes", () => {
    expect(schemaSql).toMatch(/sms_templates_admin_insert/);
    expect(schemaSql).toMatch(/sms_templates_admin_update/);
  });

  it("schema.sql has RLS policies for sms_sends tenant R/W", () => {
    expect(schemaSql).toMatch(/sms_sends_tenant_insert/);
    expect(schemaSql).toMatch(/sms_sends_tenant_update/);
  });

  it("schema.sql sms_sends_read + sms_templates_read are tenant-scoped (not USING true) — F4", () => {
    const sendsRead = schemaSql.match(/create\s+policy\s+sms_sends_read[\s\S]*?;/i)?.[0];
    expect(sendsRead).toBeDefined();
    expect(sendsRead).toMatch(/tenant_id\s*=\s*\(\(current_setting/i);
    expect(sendsRead).not.toMatch(/using\s*\(\s*true\s*\)/i);

    const tmplRead = schemaSql.match(/create\s+policy\s+sms_templates_read[\s\S]*?;/i)?.[0];
    expect(tmplRead).toBeDefined();
    expect(tmplRead).toMatch(/tenant_id\s*=\s*\(\(current_setting/i);
    expect(tmplRead).not.toMatch(/using\s*\(\s*true\s*\)/i);
  });

  it("schema.sql contains GRANT statements for sms_templates, sms_sends, audit_log, and RPCs (F2)", () => {
    expect(schemaSql).toMatch(/grant\s+all\s+on\s+cblaero_app\.sms_templates\s+to\s+service_role/i);
    expect(schemaSql).toMatch(/grant\s+all\s+on\s+cblaero_app\.sms_sends\s+to\s+service_role/i);
    expect(schemaSql).toMatch(/grant\s+all\s+on\s+cblaero_app\.outreach_audit_log\s+to\s+service_role/i);
    expect(schemaSql).toMatch(/grant\s+execute\s+on\s+function\s+cblaero_app\.claim_due_sms_sends/i);
    expect(schemaSql).toMatch(/grant\s+execute\s+on\s+function\s+cblaero_app\.insert_sms_sends_bulk/i);
    expect(schemaSql).toMatch(/grant\s+execute\s+on\s+function\s+cblaero_app\.seed_sms_templates/i);
  });

  it("schema.sql outreach_audit_log grants SELECT only to authenticated (not INSERT) — F3", () => {
    const auditLine = schemaSql
      .split("\n")
      .find((l) => /outreach_audit_log\s+to\s+authenticated/i.test(l));
    expect(auditLine).toBeDefined();
    expect(auditLine).not.toMatch(/\binsert\b/i);
    expect(auditLine).toMatch(/\bselect\b/i);
  });

  it("schema.sql contains policy_registry seed for outreach_defaults/sms_default_contact_window (F10)", () => {
    expect(schemaSql).toMatch(/'outreach_defaults'\s*,\s*'sms_default_contact_window'/);
    expect(schemaSql).toMatch(/not\s+exists\s*\(\s*select\s+1\s+from\s+cblaero_app\.policy_versions/i);
  });

  it("schema.sql claim_due_sms_sends includes p_tenant_id parameter (F1 parity)", () => {
    const sig = schemaSql.match(
      /FUNCTION\s+cblaero_app\.claim_due_sms_sends\s*\(([\s\S]*?)\)\s*RETURNS/i,
    )?.[1];
    expect(sig).toBeDefined();
    expect(sig).toMatch(/p_tenant_id\s+text/i);
  });
});
