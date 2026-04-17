"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Template = {
  id: string;
  agenda: string;
  name: string;
  body: string;
  variables: string[];
  version: number;
  status: string;
  updatedAt: string;
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

const ALLOWED_VARIABLES = [
  "first_name", "last_name", "job_title", "company", "location",
  "recruiter_name", "interview_date", "interview_time",
  "interview_location", "start_date", "tracking_link",
];

function agendaLabel(agenda: string): string {
  return AGENDA_LABELS[agenda] ?? agenda;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

export default function SMSTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [agendaFilter, setAgendaFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);

  // Form state
  const [formAgenda, setFormAgenda] = useState("new_opportunity");
  const [formName, setFormName] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const url = agendaFilter
        ? `/api/outreach/sms/templates?agenda=${agendaFilter}`
        : "/api/outreach/sms/templates";
      const res = await fetch(url);
      const json = await res.json();
      setTemplates(json.data ?? []);
    } catch {
      console.error("Failed to fetch templates");
    }
    setLoading(false);
  }, [agendaFilter]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  function openCreate() {
    setEditingTemplate(null);
    setFormAgenda("new_opportunity");
    setFormName("");
    setFormBody("");
    setFormError("");
    setShowForm(true);
  }

  function openEdit(t: Template) {
    setEditingTemplate(t);
    setFormAgenda(t.agenda);
    setFormName(t.name);
    setFormBody(t.body);
    setFormError("");
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    setFormError("");

    try {
      if (editingTemplate) {
        const res = await fetch(`/api/outreach/sms/templates/${editingTemplate.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agenda: formAgenda, name: formName, body: formBody }),
        });
        if (!res.ok) {
          const err = await res.json();
          setFormError(err.error?.errors?.join(", ") ?? "Save failed");
          setSaving(false);
          return;
        }
      } else {
        const res = await fetch("/api/outreach/sms/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agenda: formAgenda, name: formName, body: formBody }),
        });
        if (!res.ok) {
          const err = await res.json();
          setFormError(err.error?.errors?.join(", ") ?? "Create failed");
          setSaving(false);
          return;
        }
      }

      setShowForm(false);
      fetchTemplates();
    } catch {
      setFormError("Network error");
    }
    setSaving(false);
  }

  async function handleArchive(id: string) {
    if (!confirm("Archive this template?")) return;
    await fetch(`/api/outreach/sms/templates/${id}`, { method: "DELETE" });
    fetchTemplates();
  }

  function insertVariable(v: string) {
    setFormBody((prev) => prev + `{{${v}}}`);
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-6 py-3">
        <div className="mx-auto max-w-6xl">
          <nav className="flex items-center gap-2 text-sm text-gray-500">
            <Link href="/dashboard" className="hover:text-cbl-navy">Dashboard</Link>
            <span>/</span>
            <Link href="/dashboard/admin" className="hover:text-cbl-navy">Admin</Link>
            <span>/</span>
            <span className="font-medium text-gray-900">SMS Templates</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-6">
        {/* Toolbar */}
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">SMS Templates</h1>
          <div className="flex items-center gap-3">
            <select
              value={agendaFilter}
              onChange={(e) => setAgendaFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">All Agendas</option>
              {Object.entries(AGENDA_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <button
              onClick={openCreate}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Create Template
            </button>
          </div>
        </div>

        {/* Template Form Modal */}
        {showForm && (
          <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-5">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              {editingTemplate ? `Edit Template (v${editingTemplate.version} → v${editingTemplate.version + 1})` : "Create Template"}
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Agenda</label>
                <select
                  value={formAgenda}
                  onChange={(e) => setFormAgenda(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  {Object.entries(AGENDA_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder="Template name"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Body ({formBody.length}/1600 chars)
              </label>
              <textarea
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                rows={4}
                maxLength={1600}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
                placeholder="Hi {{first_name}}, ... Reply STOP to opt out."
              />
            </div>

            {/* Variable inserter */}
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="text-xs text-gray-500 mr-1">Insert:</span>
              {ALLOWED_VARIABLES.map((v) => (
                <button
                  key={v}
                  onClick={() => insertVariable(v)}
                  className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-200"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>

            {/* Preview */}
            {formBody && (
              <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-white p-3">
                <p className="mb-1 text-xs font-medium text-gray-500">Preview:</p>
                <p className="text-sm text-gray-800">
                  {formBody.replace(/\{\{(\w+)\}\}/g, (_m, v) => {
                    const examples: Record<string, string> = {
                      first_name: "Sarah", last_name: "Johnson", job_title: "A&P Mechanic",
                      company: "Boeing", location: "Seattle, WA", recruiter_name: "Mike",
                      interview_date: "Apr 20", interview_time: "2:00 PM",
                      interview_location: "Building 4A", start_date: "May 1",
                      tracking_link: "cbl.aero/t/abc123",
                    };
                    return examples[v] ?? `[${v}]`;
                  })}
                </p>
              </div>
            )}

            {formError && (
              <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {formError}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : editingTemplate ? "Save New Version" : "Create"}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Template List */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : templates.length === 0 ? (
          <div className="rounded-xl border border-gray-200 p-8 text-center text-gray-500">
            No templates found. Create one or check your filters.
          </div>
        ) : (
          <div className="space-y-3">
            {templates.map((t) => (
              <div
                key={t.id}
                className="rounded-xl border border-gray-200 px-5 py-4 hover:border-gray-300"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        {agendaLabel(t.agenda)}
                      </span>
                      <h3 className="text-sm font-semibold text-gray-900">{t.name}</h3>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                        v{t.version}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-600 line-clamp-2">{t.body}</p>
                    <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
                      <span>{t.variables.length} variables</span>
                      <span>Updated {formatDate(t.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="ml-4 flex gap-2">
                    <button
                      onClick={() => openEdit(t)}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleArchive(t.id)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Archive
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
