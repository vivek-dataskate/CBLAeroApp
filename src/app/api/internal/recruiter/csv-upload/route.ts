import { NextResponse } from "next/server";

import { withAuth } from "@/modules/auth";
import { recordImportBatchAccessEvent } from "@/modules/audit";
import {
  shouldUseInMemoryPersistenceForTests,
} from "@/modules/persistence";
import { deduceRolesHeuristic } from "@/features/candidate-management/application/role-deduction";
import { getAllRoles } from "@/features/candidate-management/infrastructure/role-taxonomy-repository";
import {
  type CanonicalField,
  CANONICAL_FIELDS,
  EMAIL_REGEX,
  FIELD_ALIASES,
  inferFieldForHeader,
  normalizeHeaderKey,
  parseCsv,
} from "@/modules/csv";
import {
  createImportBatch,
  updateImportBatch,
  deleteImportBatchCandidates,
  processImportChunk,
} from "@/features/candidate-management/infrastructure/import-batch-repository";
import {
  computeRowHash,
  loadRecentFingerprints,
  recordFingerprintBatch,
} from "@/features/candidate-management/infrastructure/fingerprint-repository";

import {
  appendInMemoryCsvErrors,
  createInMemoryCsvBatch,
  CSV_PROCESSING_CHUNK_SIZE,
  finalizeInMemoryCsvBatch,
  listCsvUploadBatchesForTest,
  listCsvCandidatesForTest,
  listCsvUploadErrorsForTest,
  markInMemoryCsvBatchRunning,
  MAX_EXTRA_ATTRIBUTE_BYTES,
  resolveRequestTenantId,
  MAX_EXTRA_ATTRIBUTE_KEYS,
  MAX_RECRUITER_CSV_ROWS,
  toBatchStatusPayload,
  upsertInMemoryCandidates,
  clearCsvUploadStoreForTest,
  type CsvCandidateRow,
} from "./shared";

type ColumnMap = Record<string, CanonicalField>;

type PreparedCandidate = CsvCandidateRow & {
  rowNumber: number;
  rawData: Record<string, string>;
  deduced_roles?: string[];
};

type PreparedErrorRow = {
  rowNumber: number;
  rawData: Record<string, string>;
  errorCode: string;
  errorDetail: string;
};

const BLOCKED_EXTRA_ATTRIBUTE_KEYS = new Set(["password", "token", "secret", "api_key"]);

function parseColumnMap(input: string | null): ColumnMap {
  if (!input) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("invalid_column_map");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_column_map");
  }

  const map: ColumnMap = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw new Error("invalid_column_map");
    }

    if (!CANONICAL_FIELDS.has(value as CanonicalField)) {
      throw new Error("invalid_column_map");
    }

    map[key] = value as CanonicalField;
  }

  return map;
}

function normalizeAvailabilityStatus(value: string): "active" | "passive" | "unavailable" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "active" || normalized === "passive" || normalized === "unavailable") {
    return normalized;
  }

  return "passive";
}

function parseSkills(value: string): string[] {
  if (!value.trim()) {
    return [];
  }

  const parts = value
    .split(/[;,|]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return [...new Set(parts)];
}

function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const digits = trimmed.replace(/\D+/g, "");
  if (digits.length < 7) {
    return null;
  }

  return digits;
}

function toEffectiveMapping(headers: string[], columnMap: ColumnMap): ColumnMap {
  const effective: ColumnMap = {};
  for (const header of headers) {
    effective[header] = columnMap[header] ?? inferFieldForHeader(header);
  }
  return effective;
}

function prepareRows(input: {
  headers: string[];
  rows: Array<Record<string, string>>;
  tenantId: string;
  batchId: string;
  actorId: string;
  mapping: ColumnMap;
}): {
  candidates: PreparedCandidate[];
  errors: PreparedErrorRow[];
} {
  const candidates: PreparedCandidate[] = [];
  const errors: PreparedErrorRow[] = [];

  for (let index = 0; index < input.rows.length; index += 1) {
    const rawData = input.rows[index];
    const rowNumber = index + 2;

    const mappedValues: Partial<Record<Exclude<CanonicalField, "(ignore)">, string>> = {};
    const extraAttributes: Record<string, string> = {};

    for (const header of input.headers) {
      const value = (rawData[header] ?? "").trim();
      const mappedField = input.mapping[header] ?? "(ignore)";
      if (mappedField !== "(ignore)") {
        mappedValues[mappedField] = value;
      }
    }

    for (const header of input.headers) {
      const mappedField = input.mapping[header] ?? "(ignore)";
      if (mappedField !== "(ignore)") {
        continue;
      }

      const value = (rawData[header] ?? "").trim();
      if (!value) {
        continue;
      }

      const normalizedKey = normalizeHeaderKey(header);
      if (!normalizedKey || BLOCKED_EXTRA_ATTRIBUTE_KEYS.has(normalizedKey)) {
        continue;
      }

      extraAttributes[normalizedKey] = value;
    }

    const extraAttributeKeys = Object.keys(extraAttributes);
    if (extraAttributeKeys.length > MAX_EXTRA_ATTRIBUTE_KEYS) {
      errors.push({
        rowNumber,
        rawData,
        errorCode: "invalid_format",
        errorDetail: `extra_attributes exceeds ${MAX_EXTRA_ATTRIBUTE_KEYS} keys`,
      });
      continue;
    }

    if (Buffer.byteLength(JSON.stringify(extraAttributes), "utf8") > MAX_EXTRA_ATTRIBUTE_BYTES) {
      errors.push({
        rowNumber,
        rawData,
        errorCode: "invalid_format",
        errorDetail: `extra_attributes exceeds ${MAX_EXTRA_ATTRIBUTE_BYTES} bytes`,
      });
      continue;
    }

    const firstName = (mappedValues.first_name ?? "").trim();
    const lastName = (mappedValues.last_name ?? "").trim();
    const email = (mappedValues.email ?? "").trim().toLowerCase();
    const mobile = normalizePhone(mappedValues.mobile ?? "");

    if (!firstName || !lastName || (!email && !mobile)) {
      errors.push({
        rowNumber,
        rawData,
        errorCode: "missing_identity",
        errorDetail: "Row must include first_name, last_name, and at least one of email or mobile.",
      });
      continue;
    }

    if (email && !EMAIL_REGEX.test(email)) {
      errors.push({
        rowNumber,
        rawData,
        errorCode: "invalid_format",
        errorDetail: "Email format is invalid.",
      });
      continue;
    }

    const alternateEmail = (mappedValues.alternate_email ?? "").trim().toLowerCase();
    if (alternateEmail && !EMAIL_REGEX.test(alternateEmail)) {
      errors.push({
        rowNumber,
        rawData,
        errorCode: "invalid_format",
        errorDetail: "Alternate email format is invalid.",
      });
      continue;
    }

    if ((mappedValues.mobile ?? "").trim().length > 0 && !mobile) {
      errors.push({
        rowNumber,
        rawData,
        errorCode: "invalid_format",
        errorDetail: "Mobile phone format is invalid.",
      });
      continue;
    }

    const homePhone = normalizePhone(mappedValues.home_phone ?? "");
    const workPhone = normalizePhone(mappedValues.work_phone ?? "");

    candidates.push({
      rowNumber,
      rawData,
      tenant_id: input.tenantId,
      email: email || null,
      phone: mobile,
      first_name: firstName,
      last_name: lastName,
      middle_name: (mappedValues.middle_name ?? "").trim() || null,
      home_phone: homePhone,
      work_phone: workPhone,
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
      ingestion_state: "pending_dedup",
      source: "csv_upload",
      source_batch_id: input.batchId,
      created_by_actor_id: input.actorId,
      extra_attributes: extraAttributes,
    });
  }

  return { candidates, errors };
}

function isCsvFile(file: File): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return type.includes("csv") || name.endsWith(".csv");
}

async function processSupabaseBatch(input: {
  batchId: string;
  candidates: PreparedCandidate[];
  errors: PreparedErrorRow[];
}): Promise<{ imported: number; skipped: number; errors: number }> {
  const toRpcCandidate = (candidate: PreparedCandidate) => ({
    row_number: candidate.rowNumber,
    raw_data: candidate.rawData,
    tenant_id: candidate.tenant_id,
    email: candidate.email,
    phone: candidate.phone,
    first_name: candidate.first_name,
    last_name: candidate.last_name,
    middle_name: candidate.middle_name,
    home_phone: candidate.home_phone,
    work_phone: candidate.work_phone,
    location: candidate.location,
    address: candidate.address,
    city: candidate.city,
    state: candidate.state,
    country: candidate.country,
    postal_code: candidate.postal_code,
    current_company: candidate.current_company,
    job_title: candidate.job_title,
    alternate_email: candidate.alternate_email,
    skills: candidate.skills,
    availability_status: candidate.availability_status,
    ingestion_state: candidate.ingestion_state,
    source: candidate.source,
    source_batch_id: candidate.source_batch_id,
    created_by_actor_id: candidate.created_by_actor_id,
    extra_attributes: candidate.extra_attributes,
    deduced_roles: candidate.deduced_roles ?? [],
  });

  const toRpcError = (error: PreparedErrorRow) => ({
    row_number: error.rowNumber,
    raw_data: error.rawData,
    error_code: error.errorCode,
    error_detail: error.errorDetail,
  });

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  const allCandidates = input.candidates.map(toRpcCandidate);
  const allErrors = input.errors.map(toRpcError);

  if (allCandidates.length === 0 && allErrors.length === 0) {
    return { imported: 0, skipped: 0, errors: 0 };
  }

  // Chunk candidates and errors independently so large error sets are not truncated
  const maxLen = Math.max(allCandidates.length, allErrors.length);
  for (let start = 0; start < maxLen; start += CSV_PROCESSING_CHUNK_SIZE) {
    const candidateChunk = allCandidates.slice(start, start + CSV_PROCESSING_CHUNK_SIZE);
    const errorChunk = allErrors.slice(start, start + CSV_PROCESSING_CHUNK_SIZE);

    const result = await processImportChunk({
      batchId: input.batchId,
      candidates: candidateChunk,
      errorRows: errorChunk,
      totalImported: imported,
      totalSkipped: skipped,
      totalErrors: errors,
    });

    imported += result.imported;
    skipped += result.skipped;
    errors += result.errors;
  }

  return { imported, skipped, errors };
}

function processInMemoryBatch(input: {
  batchId: string;
  candidates: PreparedCandidate[];
  errors: PreparedErrorRow[];
}): { imported: number; skipped: number; errors: number } {
  appendInMemoryCsvErrors(
    input.batchId,
    input.errors.map((error) => ({
      rowNumber: error.rowNumber,
      rawData: error.rawData,
      errorCode: error.errorCode,
      errorDetail: error.errorDetail,
    })),
  );

  const { inserted, updated } = upsertInMemoryCandidates(
    input.candidates.map((candidate) => ({
      tenant_id: candidate.tenant_id,
      email: candidate.email,
      phone: candidate.phone,
      first_name: candidate.first_name,
      last_name: candidate.last_name,
      middle_name: candidate.middle_name,
      home_phone: candidate.home_phone,
      work_phone: candidate.work_phone,
      location: candidate.location,
      address: candidate.address,
      city: candidate.city,
      state: candidate.state,
      country: candidate.country,
      postal_code: candidate.postal_code,
      current_company: candidate.current_company,
      job_title: candidate.job_title,
      alternate_email: candidate.alternate_email,
      skills: candidate.skills,
      availability_status: candidate.availability_status,
      ingestion_state: candidate.ingestion_state,
      source: candidate.source,
      source_batch_id: candidate.source_batch_id,
      created_by_actor_id: candidate.created_by_actor_id,
      extra_attributes: candidate.extra_attributes,
      deduced_roles: candidate.deduced_roles ?? [],
    })),
  );

  return {
    imported: inserted,
    skipped: updated,
    errors: input.errors.length,
  };
}

export const POST = withAuth(async ({ session, request, traceId }) => {
  const tenantId = resolveRequestTenantId(session, request);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    console.warn(JSON.stringify({ level: "warn", module: "recruiter/csv-upload", action: "parse_form_data", traceId, error: err instanceof Error ? err.message : String(err) }));
    return NextResponse.json(
      { error: { code: "invalid_form_data", message: "Expected multipart/form-data payload." } },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: { code: "missing_file", message: "CSV file is required." } },
      { status: 400 },
    );
  }

  if (!isCsvFile(file)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_file_type",
          message: "Only CSV files are supported for recruiter uploads.",
        },
      },
      { status: 415 },
    );
  }

  // Guard against memory exhaustion before reading the full file: 50 MB is far more than
  // any legitimate 10,000-row CSV but prevents egregious payloads from consuming server heap.
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      {
        error: {
          code: "file_too_large",
          message: "CSV file must be smaller than 50 MB.",
        },
      },
      { status: 413 },
    );
  }

  let columnMap: ColumnMap = {};
  try {
    columnMap = parseColumnMap((formData.get("columnMap") as string | null) ?? null);
  } catch (err) {
    console.warn(JSON.stringify({ level: "warn", module: "recruiter/csv-upload", action: "parse_column_map", traceId, error: err instanceof Error ? err.message : String(err) }));
    return NextResponse.json(
      {
        error: {
          code: "invalid_column_map",
          message: "columnMap must be valid JSON mapping CSV headers to canonical fields.",
        },
      },
      { status: 400 },
    );
  }

  const csv = parseCsv(await file.text());
  if (csv.rows.length > MAX_RECRUITER_CSV_ROWS) {
    return NextResponse.json(
      {
        error: {
          code: "row_limit_exceeded",
          message: `Recruiter CSV uploads are limited to ${MAX_RECRUITER_CSV_ROWS.toLocaleString()} rows.`,
        },
      },
      { status: 422 },
    );
  }

  if (csv.headers.length === 0 || csv.rows.length === 0) {
    return NextResponse.json(
      {
        error: {
          code: "empty_csv",
          message: "CSV must include a header row and at least one data row.",
        },
      },
      { status: 422 },
    );
  }

  const effectiveMapping = toEffectiveMapping(csv.headers, columnMap);

  let batchId = "";
  let startedAtIso = new Date().toISOString();

  if (shouldUseInMemoryPersistenceForTests()) {
    const batch = createInMemoryCsvBatch({
      tenantId,
      totalRows: csv.rows.length,
      createdByActorId: session.actorId,
    });
    batchId = batch.id;
    startedAtIso = batch.started_at;
    markInMemoryCsvBatchRunning(batch.id);
  } else {
    try {
      const batch = await createImportBatch({
        tenantId,
        source: "csv_upload",
        status: "validating",
        totalRows: csv.rows.length,
        createdByActorId: session.actorId,
      });
      batchId = batch.id;
      startedAtIso = batch.startedAt;

      await updateImportBatch(batchId, { status: "running" });
    } catch (err) {
      console.error(JSON.stringify({ level: "error", module: "recruiter/csv-upload", action: "create_batch", traceId, tenantId, error: err instanceof Error ? err.message : String(err) }));
      return NextResponse.json(
        { error: { code: "database_error", message: "Failed to create import batch." } },
        { status: 500 },
      );
    }
  }

  const prepared = prepareRows({
    headers: csv.headers,
    rows: csv.rows,
    tenantId,
    batchId,
    actorId: session.actorId,
    mapping: effectiveMapping,
  });

  // Fingerprint gate: pre-load known row hashes and filter out duplicates
  const knownHashes = await loadRecentFingerprints(tenantId, "csv_row_hash");
  const originalCount = prepared.candidates.length;
  prepared.candidates = prepared.candidates.filter((c) => {
    const hash = computeRowHash(c.email, c.first_name, c.last_name, c.phone);
    if (knownHashes.has(hash)) {
      return false;
    }
    return true;
  });
  const skippedByFingerprint = originalCount - prepared.candidates.length;
  if (skippedByFingerprint > 0) {
    console.log(JSON.stringify({ level: "info", module: "recruiter/csv-upload", action: "fingerprint_gate", traceId, batchId, skipped: skippedByFingerprint, total: originalCount, timestamp: new Date().toISOString() }));
  }

  // Heuristic-only role deduction for CSV batch (NO LLM — keeps upload fast)
  // Unclassified candidates (deduced_roles=[]) will be picked up by enrichment job later
  try {
    const taxonomy = await getAllRoles(tenantId);
    if (taxonomy.length > 0) {
      for (const candidate of prepared.candidates) {
        const jobTitle = typeof candidate.job_title === 'string' ? candidate.job_title : null;
        const skills = Array.isArray(candidate.skills) ? candidate.skills.filter((s: unknown): s is string => typeof s === 'string') : [];
        const result = deduceRolesHeuristic(jobTitle, skills, taxonomy);
        candidate.deduced_roles = result.roles;
      }
    }
  } catch (err) {
    console.warn(JSON.stringify({ level: 'warn', module: 'recruiter/csv-upload', action: 'role_deduction_batch_failed', traceId, batchId, error: err instanceof Error ? err.message : String(err) }));
    // Non-fatal — candidates proceed with empty deduced_roles
  }

  try {
    const processed = shouldUseInMemoryPersistenceForTests()
      ? processInMemoryBatch({
          batchId,
          candidates: prepared.candidates,
          errors: prepared.errors,
        })
      : await processSupabaseBatch({
          batchId,
          candidates: prepared.candidates,
          errors: prepared.errors,
        });

    // Record fingerprints for processed candidates in a single batch upsert.
    // Isolated from the main try/catch: fingerprint failure must NOT trigger candidate rollback.
    if (prepared.candidates.length > 0) {
      try {
        await recordFingerprintBatch(
          prepared.candidates.map((c) => ({
            tenantId,
            type: "csv_row_hash" as const,
            hash: computeRowHash(c.email, c.first_name, c.last_name, c.phone),
            source: "csv" as const,
          })),
        );
      } catch (fpError) {
        console.error(JSON.stringify({
          level: "error",
          module: "recruiter/csv-upload",
          action: "fingerprint_batch_record",
          traceId,
          batchId,
          candidateCount: prepared.candidates.length,
          error: fpError instanceof Error ? fpError.message : String(fpError),
          timestamp: new Date().toISOString(),
        }));
      }
    }

    if (shouldUseInMemoryPersistenceForTests()) {
      const updated = finalizeInMemoryCsvBatch(batchId, {
        status: "complete",
        imported: processed.imported,
        skipped: processed.skipped,
        errors: processed.errors,
      });

      await recordImportBatchAccessEvent({
        traceId,
        actorId: session.actorId,
        tenantId,
        batchId,
        action: "csv_upload_access",
      });

      return NextResponse.json({
        data: {
          ...(updated ? toBatchStatusPayload(updated) : null),
          batchId,
          status: "complete",
          imported: processed.imported,
          skipped: processed.skipped,
          errors: processed.errors,
          totalRows: csv.rows.length,
          startedAt: startedAtIso,
          completedAt: new Date().toISOString(),
        },
        meta: {},
      });
    }

    const completedAtIso = new Date().toISOString();
    await updateImportBatch(batchId, {
      status: "complete",
      imported: processed.imported,
      skipped: processed.skipped,
      errors: processed.errors,
      completedAt: completedAtIso,
    });

    await recordImportBatchAccessEvent({
      traceId,
      actorId: session.actorId,
      tenantId,
      batchId,
      action: "csv_upload_access",
    });

    return NextResponse.json({
      data: {
        batchId,
        status: "complete",
        imported: processed.imported,
        skipped: processed.skipped,
        errors: processed.errors,
        totalRows: csv.rows.length,
        startedAt: startedAtIso,
        completedAt: completedAtIso,
      },
      meta: {},
    });
  } catch (error) {
    if (shouldUseInMemoryPersistenceForTests()) {
      finalizeInMemoryCsvBatch(batchId, {
        status: "rolled_back",
        imported: 0,
        skipped: 0,
        errors: prepared.errors.length,
      });
    } else {
      try {
        await deleteImportBatchCandidates(batchId);
      } catch (deleteError) {
        console.error("[recruiter/csv-upload] compensating candidate delete failed", { traceId, batchId, deleteError });
      }
      try {
        await updateImportBatch(batchId, { status: "rolled_back", completedAt: new Date().toISOString() });
      } catch (rollbackError) {
        console.error("[recruiter/csv-upload] batch rollback status update failed", { traceId, batchId, rollbackError });
      }
    }

    console.error("[recruiter/csv-upload] batch failed", { traceId, batchId, error });

    return NextResponse.json(
      { error: { code: "processing_error", message: "Failed to process CSV upload." } },
      { status: 500 },
    );
  }
}, { action: "recruiter:csv-upload" });

export { clearCsvUploadStoreForTest, listCsvUploadBatchesForTest, listCsvUploadErrorsForTest, listCsvCandidatesForTest };
