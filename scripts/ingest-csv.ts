/**
 * CLI script to ingest a recruiter CSV file directly into Supabase,
 * bypassing the HTTP API auth layer. Uses the same parsing, validation,
 * and mapping logic as the recruiter CSV upload route.
 *
 * Usage:  npx tsx scripts/ingest-csv.ts <path-to-csv> [tenant-id]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";

// Load .env.local manually (no dotenv dependency)
const envPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

// ── Constants ────────────────────────────────────────────────────────
const MAX_RECRUITER_CSV_ROWS = 10_000;
const CSV_PROCESSING_CHUNK_SIZE = 1_000;
const MAX_EXTRA_ATTRIBUTE_KEYS = 64;
const MAX_EXTRA_ATTRIBUTE_BYTES = 16_384;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLOCKED_EXTRA_ATTRIBUTE_KEYS = new Set(["password", "token", "secret", "api_key"]);

// ── Types ────────────────────────────────────────────────────────────
type CanonicalField =
  | "first_name" | "last_name" | "middle_name"
  | "email" | "alternate_email"
  | "mobile" | "home_phone" | "work_phone"
  | "address" | "city" | "state" | "country" | "postal_code"
  | "current_company" | "job_title"
  | "skills" | "availability_status"
  | "(ignore)";

type ColumnMap = Record<string, CanonicalField>;

type ParsedCsv = { headers: string[]; rows: Array<Record<string, string>> };

type PreparedCandidate = {
  rowNumber: number;
  rawData: Record<string, string>;
  tenant_id: string;
  email: string | null;
  phone: string | null;
  first_name: string;
  last_name: string;
  middle_name: string | null;
  home_phone: string | null;
  work_phone: string | null;
  location: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  current_company: string | null;
  job_title: string | null;
  alternate_email: string | null;
  skills: string[];
  availability_status: string;
  ingestion_state: string;
  source: string;
  source_batch_id: string;
  extra_attributes: Record<string, string>;
};

type PreparedErrorRow = {
  rowNumber: number;
  rawData: Record<string, string>;
  errorCode: string;
  errorDetail: string;
};

// ── Alias map (copied from route.ts) ────────────────────────────────
const FIELD_ALIASES: Record<string, Exclude<CanonicalField, "(ignore)">> = {
  first_name: "first_name", firstname: "first_name", given_name: "first_name",
  last_name: "last_name", lastname: "last_name", surname: "last_name", family_name: "last_name",
  middle_name: "middle_name", middlename: "middle_name",
  email: "email", email_address: "email",
  alternate_email: "alternate_email", alternate_email_address: "alternate_email",
  secondary_email: "alternate_email", other_email: "alternate_email",
  mobile: "mobile", mobile_phone: "mobile", mobile_number: "mobile",
  cell: "mobile", cell_phone: "mobile", phone: "mobile", phone_number: "mobile",
  home_phone: "home_phone", home_phone_number: "home_phone",
  work_phone: "work_phone", work_phone_number: "work_phone", office_phone: "work_phone",
  address: "address", street_address: "address",
  city: "city", state: "state", province: "state",
  country: "country",
  postal_code: "postal_code", zip: "postal_code", zip_code: "postal_code", postcode: "postal_code",
  current_company: "current_company", company: "current_company",
  employer: "current_company", organization: "current_company",
  job_title: "job_title", title: "job_title", position: "job_title", role: "job_title",
  skills: "skills", skill: "skills",
  availability: "availability_status", availability_status: "availability_status",
};

// ── Helpers (copied from route.ts) ───────────────────────────────────
function normalizeHeaderKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
      continue;
    }
    if (char === "," && !inQuotes) { cells.push(current.trim()); current = ""; continue; }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(text: string): ParsedCsv {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (cells[i] ?? "").trim(); });
    return row;
  });
  return { headers, rows };
}

function inferFieldForHeader(header: string): CanonicalField {
  return FIELD_ALIASES[normalizeHeaderKey(header)] ?? "(ignore)";
}

function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D+/g, "");
  return digits.length >= 7 ? digits : null;
}

function parseSkills(value: string): string[] {
  if (!value.trim()) return [];
  const parts = value.split(/[;,|]/).map(p => p.trim()).filter(p => p.length > 0);
  return [...new Set(parts)];
}

function normalizeAvailabilityStatus(value: string): "active" | "passive" | "unavailable" {
  const n = value.trim().toLowerCase();
  if (n === "active" || n === "passive" || n === "unavailable") return n;
  return "passive";
}

function toEffectiveMapping(headers: string[]): ColumnMap {
  const effective: ColumnMap = {};
  for (const header of headers) {
    effective[header] = inferFieldForHeader(header);
  }
  return effective;
}

function prepareRows(input: {
  headers: string[];
  rows: Array<Record<string, string>>;
  tenantId: string;
  batchId: string;
  mapping: ColumnMap;
}): { candidates: PreparedCandidate[]; errors: PreparedErrorRow[] } {
  const candidates: PreparedCandidate[] = [];
  const errors: PreparedErrorRow[] = [];

  for (let index = 0; index < input.rows.length; index++) {
    const rawData = input.rows[index];
    const rowNumber = index + 2;

    const mappedValues: Partial<Record<Exclude<CanonicalField, "(ignore)">, string>> = {};
    const extraAttributes: Record<string, string> = {};

    for (const header of input.headers) {
      const value = (rawData[header] ?? "").trim();
      const mappedField = input.mapping[header] ?? "(ignore)";
      if (mappedField !== "(ignore)") mappedValues[mappedField] = value;
    }

    for (const header of input.headers) {
      const mappedField = input.mapping[header] ?? "(ignore)";
      if (mappedField !== "(ignore)") continue;
      const value = (rawData[header] ?? "").trim();
      if (!value) continue;
      const normalizedKey = normalizeHeaderKey(header);
      if (!normalizedKey || BLOCKED_EXTRA_ATTRIBUTE_KEYS.has(normalizedKey)) continue;
      extraAttributes[normalizedKey] = value;
    }

    if (Object.keys(extraAttributes).length > MAX_EXTRA_ATTRIBUTE_KEYS) {
      errors.push({ rowNumber, rawData, errorCode: "invalid_format", errorDetail: `extra_attributes exceeds ${MAX_EXTRA_ATTRIBUTE_KEYS} keys` });
      continue;
    }
    if (Buffer.byteLength(JSON.stringify(extraAttributes), "utf8") > MAX_EXTRA_ATTRIBUTE_BYTES) {
      errors.push({ rowNumber, rawData, errorCode: "invalid_format", errorDetail: `extra_attributes exceeds ${MAX_EXTRA_ATTRIBUTE_BYTES} bytes` });
      continue;
    }

    const firstName = (mappedValues.first_name ?? "").trim();
    const lastName = (mappedValues.last_name ?? "").trim();
    const email = (mappedValues.email ?? "").trim().toLowerCase();
    const mobile = normalizePhone(mappedValues.mobile ?? "");

    if (!firstName || !lastName || (!email && !mobile)) {
      errors.push({ rowNumber, rawData, errorCode: "missing_identity", errorDetail: "Row must include first_name, last_name, and at least one of email or mobile." });
      continue;
    }
    if (email && !EMAIL_REGEX.test(email)) {
      errors.push({ rowNumber, rawData, errorCode: "invalid_format", errorDetail: "Email format is invalid." });
      continue;
    }
    const alternateEmail = (mappedValues.alternate_email ?? "").trim().toLowerCase();
    if (alternateEmail && !EMAIL_REGEX.test(alternateEmail)) {
      errors.push({ rowNumber, rawData, errorCode: "invalid_format", errorDetail: "Alternate email format is invalid." });
      continue;
    }
    if ((mappedValues.mobile ?? "").trim().length > 0 && !mobile) {
      errors.push({ rowNumber, rawData, errorCode: "invalid_format", errorDetail: "Mobile phone format is invalid." });
      continue;
    }

    candidates.push({
      rowNumber, rawData,
      tenant_id: input.tenantId,
      email: email || null,
      phone: mobile,
      first_name: firstName,
      last_name: lastName,
      middle_name: (mappedValues.middle_name ?? "").trim() || null,
      home_phone: normalizePhone(mappedValues.home_phone ?? ""),
      work_phone: normalizePhone(mappedValues.work_phone ?? ""),
      location: null,
      address: (mappedValues.address ?? "").trim() || null,
      city: (mappedValues.city ?? "").trim() || null,
      state: (mappedValues.state ?? "").trim() || null,
      country: (mappedValues.country ?? "").trim() || null,
      postal_code: (mappedValues.postal_code ?? "").trim() || null,
      current_company: (mappedValues.current_company ?? "").trim() || null,
      job_title: (mappedValues.job_title ?? "").trim() || null,
      alternate_email: alternateEmail || null,
      skills: parseSkills(mappedValues.skills ?? ""),
      availability_status: normalizeAvailabilityStatus(mappedValues.availability_status ?? ""),
      ingestion_state: "pending_enrichment",
      source: "csv_upload",
      source_batch_id: input.batchId,
      extra_attributes: extraAttributes,
    });
  }

  return { candidates, errors };
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const csvPath = process.argv[2];
  const tenantId = process.argv[3] ?? "cbl-staffing";

  if (!csvPath) {
    console.error("Usage: npx tsx scripts/ingest-csv.ts <csv-path> [tenant-id]");
    process.exit(1);
  }

  const resolvedPath = path.resolve(csvPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  // Supabase client
  const url = process.env.CBL_SUPABASE_URL!;
  const key = process.env.CBL_SUPABASE_SERVICE_ROLE_KEY!;
  const schema = process.env.CBL_SUPABASE_SCHEMA!;
  if (!url || !key || !schema) {
    console.error("Missing CBL_SUPABASE_URL, CBL_SUPABASE_SERVICE_ROLE_KEY, or CBL_SUPABASE_SCHEMA");
    process.exit(1);
  }
  const client = createClient(url, key, {
    db: { schema },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Reading ${resolvedPath}...`);
  const text = fs.readFileSync(resolvedPath, "utf-8");
  const csv = parseCsv(text);

  console.log(`Parsed ${csv.rows.length} data rows, ${csv.headers.length} columns`);
  if (csv.rows.length > MAX_RECRUITER_CSV_ROWS) {
    console.error(`Row limit exceeded: ${csv.rows.length} > ${MAX_RECRUITER_CSV_ROWS}`);
    process.exit(1);
  }
  if (csv.headers.length === 0 || csv.rows.length === 0) {
    console.error("CSV is empty (no header or no data rows)");
    process.exit(1);
  }

  // Infer mapping
  const mapping = toEffectiveMapping(csv.headers);
  console.log("\nColumn mapping:");
  for (const [header, field] of Object.entries(mapping)) {
    console.log(`  ${header.padEnd(30)} → ${field}`);
  }

  // Create import_batch
  const { data: batchRow, error: batchError } = await client
    .from("import_batch")
    .insert({
      tenant_id: tenantId,
      source: "csv_upload",
      status: "validating",
      total_rows: csv.rows.length,
      created_by_actor_id: "cli-script",
    })
    .select("id, started_at")
    .single();

  if (batchError || !batchRow) {
    console.error("Failed to create import batch:", batchError?.message);
    process.exit(1);
  }

  const batchId = String(batchRow.id);
  console.log(`\nCreated import_batch ${batchId}`);

  // Mark running
  await client.from("import_batch").update({ status: "running" }).eq("id", batchId);

  // Prepare rows
  const prepared = prepareRows({
    headers: csv.headers,
    rows: csv.rows,
    tenantId,
    batchId,
    mapping,
  });

  console.log(`\nValidation results:`);
  console.log(`  Valid candidates: ${prepared.candidates.length}`);
  console.log(`  Error rows:       ${prepared.errors.length}`);

  if (prepared.errors.length > 0) {
    const byCode: Record<string, number> = {};
    for (const e of prepared.errors) {
      byCode[e.errorCode] = (byCode[e.errorCode] ?? 0) + 1;
    }
    console.log(`  Error breakdown:  ${JSON.stringify(byCode)}`);
    // Show first 5 errors
    console.log(`  Sample errors:`);
    for (const e of prepared.errors.slice(0, 5)) {
      const name = `${e.rawData["First Name"] ?? ""} ${e.rawData["Last Name"] ?? ""}`.trim();
      console.log(`    Row ${e.rowNumber}: [${e.errorCode}] ${e.errorDetail} ${name ? `(${name})` : ""}`);
    }
  }

  // Process via RPC in chunks
  const toRpcCandidate = (c: PreparedCandidate) => ({
    row_number: c.rowNumber,
    raw_data: c.rawData,
    tenant_id: c.tenant_id,
    email: c.email,
    phone: c.phone,
    first_name: c.first_name,
    last_name: c.last_name,
    middle_name: c.middle_name,
    home_phone: c.home_phone,
    work_phone: c.work_phone,
    location: c.location,
    address: c.address,
    city: c.city,
    state: c.state,
    country: c.country,
    postal_code: c.postal_code,
    current_company: c.current_company,
    job_title: c.job_title,
    alternate_email: c.alternate_email,
    skills: c.skills,
    availability_status: c.availability_status,
    ingestion_state: c.ingestion_state,
    source: c.source,
    source_batch_id: c.source_batch_id,
    extra_attributes: c.extra_attributes,
  });

  const toRpcError = (e: PreparedErrorRow) => ({
    row_number: e.rowNumber,
    raw_data: e.rawData,
    error_code: e.errorCode,
    error_detail: e.errorDetail,
  });

  const allCandidates = prepared.candidates.map(toRpcCandidate);
  const allErrors = prepared.errors.map(toRpcError);

  let imported = 0;
  let skipped = 0;
  let errors = 0;
  const totalChunks = Math.ceil(Math.max(allCandidates.length, 1) / CSV_PROCESSING_CHUNK_SIZE);

  console.log(`\nProcessing ${totalChunks} chunk(s)...`);

  for (let start = 0; start < Math.max(allCandidates.length, 1); start += CSV_PROCESSING_CHUNK_SIZE) {
    const chunkIndex = Math.floor(start / CSV_PROCESSING_CHUNK_SIZE) + 1;
    const candidateChunk = allCandidates.slice(start, start + CSV_PROCESSING_CHUNK_SIZE);
    const errorChunk = start === 0 ? allErrors : [];

    const { data, error } = await client.rpc("process_import_chunk", {
      p_batch_id: batchId,
      p_candidates: candidateChunk,
      p_error_rows: errorChunk,
      p_total_imported: imported,
      p_total_skipped: skipped,
      p_total_errors: errors,
    });

    if (error) {
      console.error(`Chunk ${chunkIndex} failed:`, error.message);
      // Compensating cleanup
      await client.from("candidates").delete().eq("source_batch_id", batchId);
      await client.from("import_batch").update({ status: "rolled_back", completed_at: new Date().toISOString() }).eq("id", batchId);
      console.error("Batch rolled back.");
      process.exit(1);
    }

    const rpcResult = Array.isArray(data) ? data[0] : null;
    if (!rpcResult) {
      console.error(`Chunk ${chunkIndex} returned no result`);
      process.exit(1);
    }

    imported = Number(rpcResult.imported);
    skipped = Number(rpcResult.skipped);
    errors = Number(rpcResult.errors);
    console.log(`  Chunk ${chunkIndex}/${totalChunks}: imported=${imported} skipped=${skipped} errors=${errors}`);
  }

  // Finalize batch
  const completedAt = new Date().toISOString();
  await client.from("import_batch").update({
    status: "complete",
    imported,
    skipped,
    errors,
    completed_at: completedAt,
  }).eq("id", batchId);

  console.log(`\n${"=".repeat(50)}`);
  console.log(`DONE — Batch ${batchId}`);
  console.log(`${"=".repeat(50)}`);
  console.log(`  Total rows:  ${csv.rows.length}`);
  console.log(`  Imported:    ${imported}`);
  console.log(`  Skipped:     ${skipped}`);
  console.log(`  Errors:      ${errors}`);
  console.log(`  Status:      complete`);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
