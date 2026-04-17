"use client";

import { useState, useEffect } from "react";

type Template = {
  id: string;
  agenda: string;
  name: string;
  body: string;
  variables: string[];
  version: number;
};

type CandidateInfo = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
};

type SendSMSModalProps = {
  /** Pre-selected candidates (checkbox mode) */
  candidates?: CandidateInfo[];
  /** Filter-based mode */
  filters?: Record<string, string>;
  filterDescription?: string;
  totalCount?: number;
  /** Close handler */
  onClose: () => void;
  /** Called after successful send */
  onSent?: () => void;
};

const AGENDA_LABELS: Record<string, string> = {
  new_opportunity: "New Opportunity",
  availability_check: "Availability Check",
  job_followup: "Job Follow-up",
  submission_followup: "Submission Follow-up",
  interview_schedule: "Interview Schedule",
  interview_reminder: "Interview Reminder",
  interview_followup: "Interview Follow-up",
  bgv_initiation: "BGV Initiation",
  bgv_followup: "BGV Follow-up",
  offer_extended: "Offer Extended",
  onboarding: "Onboarding",
  reengagement: "Re-engagement",
  general: "General",
};

export default function SendSMSModal({
  candidates,
  filters,
  filterDescription,
  totalCount,
  onClose,
  onSent,
}: SendSMSModalProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [contextParams, setContextParams] = useState<Record<string, string>>({});
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledFor, setScheduledFor] = useState("");
  const [preview, setPreview] = useState<{
    total: number; withPhone: number; withoutPhone: number; optedOut: number;
    sampleRendered: string | null; overLimit?: boolean;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    scheduled: number; skippedNoPhone: number; skippedOptOut: number;
  } | null>(null);

  const isFilterMode = !!filters;
  const candidateIds = candidates?.map((c) => c.id) ?? [];
  const count = isFilterMode ? (totalCount ?? 0) : candidateIds.length;

  // Load templates on mount
  useEffect(() => {
    fetch("/api/outreach/sms/templates")
      .then((r) => r.json())
      .then((j) => setTemplates(j.data ?? []));
  }, []);

  // Fetch preview when template is selected
  useEffect(() => {
    if (!selectedTemplate) { setPreview(null); return; }

    const payload = isFilterMode
      ? { filters, templateId: selectedTemplate.id, contextParams }
      : { candidateIds, templateId: selectedTemplate.id, contextParams };

    fetch("/api/outreach/sms/send/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((j) => setPreview(j.data))
      .catch(() => setPreview(null));
  }, [selectedTemplate, contextParams]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSend() {
    if (!selectedTemplate) return;
    setSending(true);

    const payload: Record<string, unknown> = {
      templateId: selectedTemplate.id,
      contextParams,
    };
    if (isFilterMode) {
      payload.filters = filters;
    } else {
      payload.candidateIds = candidateIds;
    }
    if (scheduleMode === "later" && scheduledFor) {
      payload.scheduledFor = new Date(scheduledFor).toISOString();
    }

    try {
      const res = await fetch("/api/outreach/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (res.ok) {
        setResult(json.data);
        onSent?.();
      } else {
        alert(json.error?.message ?? "Send failed");
      }
    } catch {
      alert("Network error");
    }
    setSending(false);
  }

  // Context param fields that the selected template needs
  const contextVars = selectedTemplate
    ? selectedTemplate.variables.filter(
        (v) => !["first_name", "last_name", "location", "recruiter_name", "tracking_link"].includes(v),
      )
    : [];

  // Group templates by agenda
  const grouped = templates.reduce<Record<string, Template[]>>((acc, t) => {
    (acc[t.agenda] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        {/* Result screen */}
        {result ? (
          <div className="text-center">
            <div className="mb-4 text-4xl">&#9989;</div>
            <h2 className="text-lg font-semibold text-gray-900">SMS Scheduled</h2>
            <p className="mt-2 text-sm text-gray-600">
              <strong>{result.scheduled}</strong> messages scheduled.
              {result.skippedNoPhone > 0 && (
                <> <strong>{result.skippedNoPhone}</strong> skipped (no phone).</>
              )}
              {result.skippedOptOut > 0 && (
                <> <strong>{result.skippedOptOut}</strong> skipped (opted out).</>
              )}
            </p>
            <button
              onClick={onClose}
              className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                {isFilterMode
                  ? `Send SMS to All (${count})`
                  : `Send SMS (${count} selected)`}
              </h2>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                &#x2715;
              </button>
            </div>

            {/* Filter pills (filter mode) */}
            {isFilterMode && filterDescription && (
              <div className="mb-3 flex flex-wrap gap-1">
                {filterDescription.split(" · ").map((f, i) => (
                  <span key={i} className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                    {f}
                  </span>
                ))}
              </div>
            )}

            {/* Candidate preview (checkbox mode) */}
            {!isFilterMode && candidates && (
              <div className="mb-3 text-sm text-gray-600">
                {candidates.slice(0, 5).map((c) => (
                  <span key={c.id} className="mr-2">
                    {c.firstName} {c.lastName}
                    {!c.phone && <span className="ml-1 text-xs text-amber-500">(no phone)</span>}
                  </span>
                ))}
                {candidates.length > 5 && (
                  <span className="text-gray-400">+{candidates.length - 5} more</span>
                )}
              </div>
            )}

            {/* Template selector */}
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-gray-700">Template</label>
              <select
                value={selectedTemplate?.id ?? ""}
                onChange={(e) => {
                  const t = templates.find((t) => t.id === e.target.value);
                  setSelectedTemplate(t ?? null);
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select a template...</option>
                {Object.entries(grouped).map(([agenda, tpls]) => (
                  <optgroup key={agenda} label={AGENDA_LABELS[agenda] ?? agenda}>
                    {tpls.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Context params */}
            {contextVars.length > 0 && (
              <div className="mb-4 space-y-2">
                <p className="text-xs font-medium text-gray-500">Fill in context:</p>
                {contextVars.map((v) => (
                  <div key={v}>
                    <label className="block text-xs text-gray-600">{v.replace(/_/g, " ")}</label>
                    <input
                      value={contextParams[v] ?? ""}
                      onChange={(e) =>
                        setContextParams((prev) => ({ ...prev, [v]: e.target.value }))
                      }
                      className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm"
                      placeholder={v.replace(/_/g, " ")}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Preview */}
            {preview && (
              <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="mb-1 text-xs font-medium text-gray-500">Preview & Summary</p>
                <div className="flex gap-4 text-xs text-gray-600">
                  <span>{preview.withPhone} with phone</span>
                  <span>{preview.withoutPhone} no phone</span>
                  <span>{preview.optedOut} opted out</span>
                </div>
                {preview.sampleRendered && (
                  <p className="mt-2 rounded border border-dashed border-gray-300 bg-white p-2 text-sm text-gray-800">
                    {preview.sampleRendered}
                  </p>
                )}
                {preview.overLimit && (
                  <p className="mt-2 text-xs text-red-600">
                    Over 5,000 candidate limit. Refine your filters.
                  </p>
                )}
              </div>
            )}

            {/* Schedule */}
            <div className="mb-4">
              <div className="flex gap-4">
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    checked={scheduleMode === "now"}
                    onChange={() => setScheduleMode("now")}
                  />
                  Send Now
                </label>
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    checked={scheduleMode === "later"}
                    onChange={() => setScheduleMode("later")}
                  />
                  Schedule for
                </label>
              </div>
              {scheduleMode === "later" && (
                <input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={handleSend}
                disabled={!selectedTemplate || sending || (preview?.overLimit ?? false)}
                className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {sending ? "Sending..." : "Confirm Send"}
              </button>
              <button
                onClick={onClose}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
