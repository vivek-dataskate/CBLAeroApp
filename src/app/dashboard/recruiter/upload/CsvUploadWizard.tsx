"use client";

import { useMemo, useState } from "react";

import { type CanonicalField, EMAIL_REGEX, FIELD_ALIASES, normalizeHeaderKey, parseCsv, type ParsedCsv } from "@/modules/csv";

import BatchProgressCard from "./BatchProgressCard";

type ValidationSummary = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateDetectedCount: number;
  byErrorCode: {
    missing_identity: number;
    invalid_format: number;
    row_limit_exceeded: number;
  };
};

const MAX_ROWS = 10_000;

const FIELD_OPTIONS: CanonicalField[] = [
  "first_name",
  "last_name",
  "middle_name",
  "email",
  "alternate_email",
  "mobile",
  "home_phone",
  "work_phone",
  "address",
  "city",
  "state",
  "country",
  "postal_code",
  "current_company",
  "job_title",
  "skills",
  "availability_status",
  "(ignore)",
];

const FIELD_LABELS: Record<CanonicalField, string> = {
  first_name: "First Name",
  last_name: "Last Name",
  middle_name: "Middle Name",
  email: "Email",
  alternate_email: "Alternate Email",
  mobile: "Mobile",
  home_phone: "Home Phone",
  work_phone: "Work Phone",
  address: "Address",
  city: "City",
  state: "State",
  country: "Country",
  postal_code: "Postal Code",
  current_company: "Current Company",
  job_title: "Job Title",
  skills: "Skills",
  availability_status: "Availability Status",
  "(ignore)": "Additional Attribute",
};

function inferMapping(headers: string[]): Record<string, CanonicalField> {
  const map: Record<string, CanonicalField> = {};
  for (const header of headers) {
    map[header] = FIELD_ALIASES[normalizeHeaderKey(header)] ?? "(ignore)";
  }
  return map;
}

function phoneLooksValid(value: string): boolean {
  const digits = value.replace(/\D+/g, "");
  return digits.length >= 7;
}

function validateRows(
  parsed: ParsedCsv,
  mapping: Record<string, CanonicalField>,
): ValidationSummary {
  const summary: ValidationSummary = {
    totalRows: parsed.rows.length,
    validRows: 0,
    invalidRows: 0,
    duplicateDetectedCount: 0,
    byErrorCode: {
      missing_identity: 0,
      invalid_format: 0,
      row_limit_exceeded: parsed.rows.length > MAX_ROWS ? parsed.rows.length - MAX_ROWS : 0,
    },
  };

  const seenIdentity = new Set<string>();

  for (let index = 0; index < parsed.rows.length; index += 1) {
    const row = parsed.rows[index];

    const mappedValue = (field: CanonicalField) => {
      const header = Object.keys(mapping).find((key) => mapping[key] === field);
      return header ? row[header] ?? "" : "";
    };

    const firstName = mappedValue("first_name").trim();
    const lastName = mappedValue("last_name").trim();
    const email = mappedValue("email").trim().toLowerCase();
    const mobile = mappedValue("mobile").trim();

    if (!firstName || !lastName || (!email && !mobile)) {
      summary.byErrorCode.missing_identity += 1;
      summary.invalidRows += 1;
      continue;
    }

    if ((email && !EMAIL_REGEX.test(email)) || (mobile && !phoneLooksValid(mobile))) {
      summary.byErrorCode.invalid_format += 1;
      summary.invalidRows += 1;
      continue;
    }

    const identityKey = email || mobile.replace(/\D+/g, "");
    if (seenIdentity.has(identityKey)) {
      summary.duplicateDetectedCount += 1;
    } else {
      seenIdentity.add(identityKey);
    }

    summary.validRows += 1;
  }

  return summary;
}

function requiredMappingsSatisfied(mapping: Record<string, CanonicalField>): boolean {
  const values = Object.values(mapping);
  return (
    values.includes("first_name") &&
    values.includes("last_name") &&
    (values.includes("email") || values.includes("mobile"))
  );
}

export default function CsvUploadWizard() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv>({ headers: [], rows: [] });
  const [previewRows, setPreviewRows] = useState<Array<Record<string, string>>>([]);
  const [mapping, setMapping] = useState<Record<string, CanonicalField>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);

  const validationSummary = useMemo(() => validateRows(parsed, mapping), [parsed, mapping]);

  const softLimitWarning = parsed.rows.length > MAX_ROWS;

  const onFileSelected = async (nextFile: File | null) => {
    setSubmitError(null);
    setBatchId(null);

    if (!nextFile) {
      setFile(null);
      setParsed({ headers: [], rows: [] });
      setPreviewRows([]);
      setMapping({});
      setStep(1);
      return;
    }

    const text = await nextFile.text();
    const parsedCsv = parseCsv(text);

    setFile(nextFile);
    setParsed(parsedCsv);
    setPreviewRows(parsedCsv.rows.slice(0, 5));
    setMapping(inferMapping(parsedCsv.headers));
    setStep(2);
  };

  const onUpload = async () => {
    if (!file) {
      setSubmitError("Choose a CSV file before uploading.");
      return;
    }

    if (softLimitWarning) {
      setSubmitError(`CSV exceeds ${MAX_ROWS.toLocaleString()} row limit. Split the file and retry.`);
      return;
    }

    if (!requiredMappingsSatisfied(mapping)) {
      setSubmitError("Map name and at least one of email or phone before uploading.");
      return;
    }

    setUploading(true);
    setSubmitError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("columnMap", JSON.stringify(mapping));

    try {
      const response = await fetch("/api/internal/recruiter/csv-upload", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        if (payload?.error?.code === "row_limit_exceeded") {
          setSubmitError(
            payload?.error?.message ??
              `CSV exceeds ${MAX_ROWS.toLocaleString()} row limit. Split the file and retry.`,
          );
        } else {
          setSubmitError(payload?.error?.message ?? "Upload failed.");
        }
        return;
      }

      setBatchId(String(payload.data.batchId));
    } catch {
      setSubmitError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Step 1 - File Select</p>
        <div className="mt-2 rounded-lg border border-dashed border-gray-300 p-4">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              void onFileSelected(selected);
            }}
            className="text-xs text-gray-600"
          />
          <p className="mt-1.5 text-sm text-gray-400">
            Max {MAX_ROWS.toLocaleString()} rows per upload.
          </p>
          {file ? <p className="mt-1.5 text-sm text-gray-500">Selected: {file.name}</p> : null}
          {softLimitWarning ? (
            <p className="mt-1.5 text-sm text-amber-600">
              This file appears to exceed {MAX_ROWS.toLocaleString()} rows and will be rejected on upload.
            </p>
          ) : null}
        </div>
      </section>

      {step >= 2 ? (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Step 2 - Column Mapping</p>
          <p className="mt-1.5 text-sm text-gray-400">
            Columns mapped as <b>Additional Attribute</b> are stored under candidate extra_attributes.
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {parsed.headers.map((header) => (
              <label key={header} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-gray-600">{header}</span>
                <select
                  value={mapping[header] ?? "(ignore)"}
                  onChange={(event) => {
                    const value = event.target.value as CanonicalField;
                    setMapping((current) => ({ ...current, [header]: value }));
                  }}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-sm text-gray-700"
                >
                  {FIELD_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {FIELD_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {!requiredMappingsSatisfied(mapping) ? (
            <p className="mt-2 text-sm text-amber-600">
              Required: First Name, Last Name, and at least one of Email or Mobile.
            </p>
          ) : null}

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm text-gray-500">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-100">
                  {parsed.headers.map((header) => (
                    <th key={header} className="pr-3 pb-1 font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, index) => (
                  <tr key={`${index}-${row[parsed.headers[0]] ?? "row"}`}>
                    {parsed.headers.map((header) => (
                      <td key={`${index}-${header}`} className="pr-3 py-0.5 align-top text-gray-600">
                        {row[header] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={() => setStep(3)}
            disabled={!requiredMappingsSatisfied(mapping)}
            className="mt-3 rounded-lg border border-gray-300 bg-gray-50 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next: Validation Preview
          </button>
        </section>
      ) : null}

      {step >= 3 ? (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Step 3 - Validation Preview</p>
          <div className="mt-2 grid gap-1.5 text-xs text-gray-600 md:grid-cols-2">
            <p>
              Total rows: <span className="font-medium text-gray-800">{validationSummary.totalRows.toLocaleString()}</span>
            </p>
            <p>
              Valid rows: <span className="font-medium text-cbl-navy">{validationSummary.validRows.toLocaleString()}</span>
            </p>
            <p>
              Invalid rows: <span className="font-medium text-amber-600">{validationSummary.invalidRows.toLocaleString()}</span>
            </p>
            <p>
              Duplicates detected: <span className="font-medium text-gray-800">{validationSummary.duplicateDetectedCount.toLocaleString()}</span>
            </p>
          </div>

          <div className="mt-2 text-sm text-gray-400">
            <p>missing_identity: {validationSummary.byErrorCode.missing_identity}</p>
            <p>invalid_format: {validationSummary.byErrorCode.invalid_format}</p>
            <p>row_limit_exceeded: {validationSummary.byErrorCode.row_limit_exceeded}</p>
          </div>

          {submitError ? <p className="mt-2 text-xs text-red-600">{submitError}</p> : null}

          <button
            type="button"
            disabled={uploading}
            onClick={() => {
              void onUpload();
            }}
            className="mt-3 rounded-lg border border-cbl-blue/40 bg-cbl-blue/10 px-3 py-1.5 text-xs text-cbl-blue hover:bg-cbl-blue/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Upload CSV"}
          </button>
        </section>
      ) : null}

      {batchId ? <BatchProgressCard batchId={batchId} /> : null}
    </div>
  );
}
