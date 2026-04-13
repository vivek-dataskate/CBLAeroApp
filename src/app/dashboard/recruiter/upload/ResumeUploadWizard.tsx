"use client";

import { useCallback, useRef, useState } from "react";

type FileStatus = "queued" | "processing" | "complete" | "failed" | "skipped";

interface ExtractionResult {
  filename: string;
  status: FileStatus;
  extraction?: Record<string, unknown>;
  error?: string;
  submissionId?: string;
}

interface CandidateCard {
  submissionId: string;
  filename: string;
  extraction: Record<string, unknown>;
  accepted: boolean;
  rejected: boolean;
  edits: Record<string, string>;
}

type WizardStep = 1 | 2 | 3;

const DISPLAY_FIELDS = [
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "location", label: "Location" },
  { key: "jobTitle", label: "Job Title" },
  { key: "client", label: "Client" },
  { key: "employmentType", label: "Employment Type" },
  { key: "skills", label: "Skills" },
  { key: "certifications", label: "Certifications" },
  { key: "aircraftExperience", label: "Aircraft Experience" },
  { key: "hasAPLicense", label: "A&P License" },
  { key: "yearsOfExperience", label: "Experience" },
  { key: "workAuthorization", label: "Work Auth" },
  { key: "clearance", label: "Clearance" },
  { key: "currentRate", label: "Rate" },
];

export default function ResumeUploadWizard() {
  const [step, setStep] = useState<WizardStep>(1);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [results, setResults] = useState<ExtractionResult[]>([]);
  const [cards, setCards] = useState<CandidateCard[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [summary, setSummary] = useState<{ imported: number; skipped: number; errors: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Additive file selection — new picks are merged with existing selection, deduped by name
  const onFilesSelected = useCallback((selectedFiles: FileList | null) => {
    if (!selectedFiles) return;
    const accepted: File[] = [];
    const rejected: string[] = [];

    for (let i = 0; i < selectedFiles.length; i++) {
      const f = selectedFiles[i];
      if (f.name.toLowerCase().endsWith(".pdf")) {
        accepted.push(f);
      } else {
        rejected.push(f.name);
      }
    }

    if (rejected.length > 0) {
      setError(
        `Only PDF files are supported. Please convert other formats to PDF before uploading. Rejected: ${rejected.join(", ")}`
      );
    } else {
      setError(null);
    }

    // Merge with existing files, dedup by name
    setFiles((prev) => {
      const existing = new Map(prev.map((f) => [f.name, f]));
      for (const f of accepted) {
        existing.set(f.name, f);
      }
      return [...existing.values()];
    });
  }, []);

  const removeFile = (name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  };

  const onUpload = async () => {
    if (files.length === 0) {
      setError("Select at least one PDF file.");
      return;
    }

    setUploading(true);
    setError(null);
    setStep(2);

    const formData = new FormData();
    for (const f of files) {
      formData.append("file", f);
    }

    try {
      const response = await fetch("/api/internal/recruiter/resume-upload", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? "Upload failed.");
        return;
      }

      const uploadedBatchId = payload.data.batchId as string;
      setBatchId(uploadedBatchId);
      setResults(payload.data.files);

      const successFiles = payload.data.files.filter(
        (f: ExtractionResult) => f.status === "complete" && f.extraction
      );
      const failedFiles = payload.data.files.filter(
        (f: ExtractionResult) => f.status === "failed"
      );

      // Auto-confirm for bulk uploads (6+ files) — skip review step
      if (files.length >= 6) {
        const confirmed = successFiles.map((f: ExtractionResult) => ({
          submissionId: f.submissionId,
        }));
        const rejectedIds: string[] = [];

        try {
          const confirmRes = await fetch(
            `/api/internal/recruiter/resume-upload/${uploadedBatchId}/confirm`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ confirmed, rejected: rejectedIds }),
            }
          );
          const confirmPayload = await confirmRes.json();
          if (confirmRes.ok) {
            setSummary({
              imported: confirmPayload.data.imported,
              skipped: confirmPayload.data.skipped,
              errors: confirmPayload.data.errors ?? failedFiles.length,
            });
            setStep(3);
            return;
          }
          setError(confirmPayload?.error?.message ?? "Auto-confirm failed. Please review and confirm candidates manually.");
        } catch (err) {
          console.error('[ResumeUpload] Auto-confirm failed:', err);
          setError("Auto-confirm failed. Please review and confirm candidates manually.");
        }
      }

      // Manual review (small uploads or auto-confirm failure)
      const successCards: CandidateCard[] = successFiles.map((f: ExtractionResult) => ({
        submissionId: f.submissionId ?? "",
        filename: f.filename,
        extraction: f.extraction as Record<string, unknown>,
        accepted: true,
        rejected: false,
        edits: {},
      }));

      setCards(successCards);
      setStep(3);
    } catch (err) {
      console.error('[ResumeUpload] Upload failed:', err);
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const toggleCard = (index: number, action: "accept" | "reject") => {
    setCards((prev) =>
      prev.map((card, i) => {
        if (i !== index) return card;
        if (action === "accept") return { ...card, accepted: true, rejected: false };
        return { ...card, accepted: false, rejected: true };
      })
    );
  };

  const editCardField = (index: number, key: string, value: string) => {
    setCards((prev) =>
      prev.map((card, i) => {
        if (i !== index) return card;
        return { ...card, edits: { ...card.edits, [key]: value } };
      })
    );
  };

  const onConfirm = async () => {
    if (!batchId) return;
    setConfirming(true);
    setError(null);

    const confirmed = cards
      .filter((c) => c.accepted)
      .map((c) => ({
        submissionId: c.submissionId,
        edits: Object.keys(c.edits).length > 0 ? c.edits : undefined,
      }));

    const rejectedIds = cards.filter((c) => c.rejected).map((c) => c.submissionId);

    try {
      const response = await fetch(`/api/internal/recruiter/resume-upload/${batchId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed, rejected: rejectedIds }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? "Confirmation failed.");
        return;
      }

      setSummary(payload.data);
    } catch (err) {
      console.error('[ResumeUpload] Confirmation failed:', err);
      setError("Confirmation failed. Please try again.");
    } finally {
      setConfirming(false);
    }
  };

  const onStartNew = () => {
    setStep(1);
    setFiles([]);
    setBatchId(null);
    setResults([]);
    setCards([]);
    setSummary(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const completeCount = results.filter((r) => r.status === "complete").length;
  const failedCount = results.filter((r) => r.status === "failed").length;

  return (
    <div className="space-y-6">
      {/* Step 1: File Select */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Step 1 - Select Resumes</p>

        <div className="mt-3 rounded-xl border border-dashed border-gray-300 p-5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            multiple
            onChange={(e) => {
              onFilesSelected(e.target.files);
              // Reset input so the same files can be re-selected if needed
              if (e.target) e.target.value = "";
            }}
            className="text-sm text-gray-700"
          />
          <p className="mt-2 text-xs text-gray-400">
            PDF files only. Select files from multiple folders — each selection adds to the list.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Have Word, RTF, or other formats? Convert to PDF first. For paper resumes, take a photo or scan and save as PDF — our system can read scanned images too.
          </p>
        </div>

        {files.length > 0 && (
          <div className="mt-3">
            <p className="text-sm text-gray-600">{files.length} resume{files.length !== 1 ? "s" : ""} selected</p>
            <div className="mt-1 max-h-40 overflow-y-auto space-y-0.5">
              {files.map((f) => (
                <div key={f.name} className="flex items-center justify-between text-xs text-gray-500">
                  <span className="truncate">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(f.name)}
                    className="ml-2 shrink-0 text-gray-300 hover:text-rose-500"
                    title="Remove"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

        <button
          type="button"
          disabled={files.length === 0 || uploading}
          onClick={() => void onUpload()}
          className="mt-4 rounded-lg border border-cbl-navy bg-cbl-blue/10 px-4 py-2 text-sm text-cbl-blue hover:bg-cbl-blue/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? "Uploading & Extracting..." : "Upload & Extract"}
        </button>
      </section>

      {/* Step 2: Extraction Progress */}
      {step >= 2 && results.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Step 2 - Extraction Results</p>
          <div className="mt-3 grid gap-2 text-sm text-gray-600 md:grid-cols-3">
            <p>Total: <span className="font-medium text-gray-800">{results.length}</span></p>
            <p>Complete: <span className="font-medium text-cbl-navy">{completeCount}</span></p>
            <p>Failed: <span className="font-medium text-rose-600">{failedCount}</span></p>
          </div>

          {failedCount > 0 && (
            <div className="mt-3 space-y-1">
              <p className="text-xs uppercase text-gray-400">Failed Files:</p>
              {results.filter((r) => r.status === "failed").map((r) => (
                <div key={r.filename} className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs">
                  <span className="font-medium text-rose-700">{r.filename}</span>
                  <span className="ml-2 text-rose-500">{r.error}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Step 3: Review & Confirm */}
      {step >= 3 && !summary && cards.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Step 3 - Review & Confirm</p>
          <p className="mt-2 text-xs text-gray-400">
            Review extracted candidates. Edit fields if needed, then accept or reject each.
          </p>

          <div className="mt-4 space-y-4">
            {cards.map((card, index) => (
              <div
                key={card.submissionId}
                className={`rounded-xl border p-4 ${
                  card.rejected
                    ? "border-rose-200 bg-rose-50 opacity-60"
                    : card.accepted
                    ? "border-cbl-blue/30 bg-cbl-blue/10"
                    : "border-gray-200 bg-gray-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700">{card.filename}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => toggleCard(index, "accept")}
                      className={`rounded px-3 py-1 text-xs ${
                        card.accepted
                          ? "bg-cbl-blue/20 text-cbl-blue border border-cbl-blue/40"
                          : "text-gray-400 hover:text-cbl-navy"
                      }`}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleCard(index, "reject")}
                      className={`rounded px-3 py-1 text-xs ${
                        card.rejected
                          ? "bg-rose-100 text-rose-700 border border-rose-300"
                          : "text-gray-400 hover:text-rose-600"
                      }`}
                    >
                      Reject
                    </button>
                  </div>
                </div>

                {!card.rejected && (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {DISPLAY_FIELDS.map(({ key, label }) => {
                      const rawValue = card.extraction[key];
                      const value = Array.isArray(rawValue)
                        ? rawValue.join(", ")
                        : typeof rawValue === "string"
                        ? rawValue
                        : typeof rawValue === "boolean"
                        ? (rawValue ? "Yes" : "No")
                        : "";
                      return (
                        <label key={key} className="text-xs">
                          <span className="text-gray-400">{label}</span>
                          <input
                            type="text"
                            defaultValue={value}
                            onChange={(e) => editCardField(index, key, e.target.value)}
                            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

          {cards.length > 0 && cards.every((c) => c.accepted && Object.keys(c.edits).length === 0) && (
            <p className="mt-3 text-xs text-amber-600">
              All candidates are auto-accepted. Please review the extracted data before confirming — LLM extraction may contain errors.
            </p>
          )}

          <button
            type="button"
            disabled={confirming || cards.filter((c) => c.accepted).length === 0}
            onClick={() => void onConfirm()}
            className="mt-4 rounded-lg border border-cbl-navy bg-cbl-blue/10 px-4 py-2 text-sm text-cbl-blue hover:bg-cbl-blue/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirming ? "Confirming..." : `Confirm ${cards.filter((c) => c.accepted).length} Candidates`}
          </button>
        </section>
      )}

      {/* Summary */}
      {summary && (
        <section className="rounded-xl border border-cbl-blue/30 bg-cbl-blue/10 p-5">
          <p className="text-xs uppercase tracking-[0.15em] text-cbl-navy">Upload Complete</p>
          <div className="mt-3 grid gap-2 text-sm text-gray-600 md:grid-cols-3">
            <p>Imported: <span className="font-medium text-cbl-navy">{summary.imported}</span></p>
            <p>Skipped: <span className="font-medium text-amber-600">{summary.skipped}</span></p>
            <p>Errors: <span className="font-medium text-rose-600">{summary.errors}</span></p>
          </div>
          <button
            type="button"
            onClick={onStartNew}
            className="mt-4 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Upload More Resumes
          </button>
        </section>
      )}
    </div>
  );
}
