"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import { isStaleSignal } from "@/features/candidate-management/application/availability-scoring";

type CandidateDetail = {
  id: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  email: string | null;
  alternateEmail: string | null;
  phone: string | null;
  homePhone: string | null;
  workPhone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  availabilityStatus: string;
  ingestionState: string;
  jobTitle: string | null;
  currentCompany: string | null;
  skills: unknown[];
  certifications: unknown[];
  experience: unknown[];
  yearsOfExperience: string | null;
  workAuthorization: string | null;
  clearance: string | null;
  aircraftExperience: unknown[];
  employmentType: string | null;
  currentRate: string | null;
  perDiem: string | null;
  hasApLicense: boolean | null;
  shiftPreference: string | null;
  expectedStartDate: string | null;
  callAvailability: string | null;
  interviewAvailability: string | null;
  veteranStatus: string | null;
  deducedRoles: string[];
  availabilityLastSignalAt: string | null;
  resumeUrl: string | null;
  source: string;
  ceipalId: string | null;
  submittedBy: string | null;
  submitterEmail: string | null;
  extraAttributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

const AVAILABILITY_BADGE: Record<string, string> = {
  active: "bg-green-100 text-green-700 border-green-200",
  passive: "bg-yellow-100 text-yellow-700 border-yellow-200",
  unavailable: "bg-red-100 text-red-700 border-red-200",
};

type AvailabilitySignalRow = {
  id: number;
  newState: string;
  source: string;
  createdAt: string;
};

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-800 break-words">{value}</dd>
    </div>
  );
}

function BoolField({ label, value }: { label: string; value: boolean | null | undefined }) {
  if (value === null || value === undefined) return null;
  return (
    <div>
      <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-800">{value ? "Yes" : "No"}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-6 py-5">
      <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-gray-400 border-b border-gray-100 pb-2">{title}</h2>
      {children}
    </section>
  );
}

export default function CandidateDetailPage() {
  const params = useParams();
  const candidateId = params.id as string;
  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [signals, setSignals] = useState<AvailabilitySignalRow[]>([]);

  const loadCandidate = async () => {
    try {
      const res = await fetch(`/api/internal/candidates/${candidateId}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Failed to load candidate.");
        return;
      }
      setCandidate(json.data);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  };

  const loadSignals = async () => {
    try {
      const res = await fetch(`/api/internal/candidates/${candidateId}/availability-signals`);
      if (res.ok) {
        const json = await res.json();
        setSignals(json.data ?? []);
      }
    } catch { /* signal fetch is best-effort */ }
  };

  useEffect(() => { loadCandidate(); loadSignals(); }, [candidateId]);

  const handleRefreshAvailability = async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/internal/candidates/${candidateId}/refresh-availability`, { method: "POST" });
      const json = await res.json();
      if (res.ok) {
        await loadCandidate();
        // Reload signals
        try {
          const sigRes = await fetch(`/api/internal/candidates/${candidateId}/availability-signals`);
          if (sigRes.ok) {
            const sigJson = await sigRes.json();
            setSignals(sigJson.data ?? []);
          }
        } catch { /* signal fetch is best-effort */ }
      } else {
        alert(`Refresh failed: ${json.error?.message ?? "Unknown error"}`);
      }
    } catch (err) {
      alert(`Refresh error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-cbl-navy border-t-transparent" />
          <p className="mt-3 text-sm text-gray-500">Loading candidate...</p>
        </div>
      </div>
    );
  }

  if (error || !candidate) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white">
        <p className="text-red-600">{error ?? "Candidate not found."}</p>
        <Link href="/dashboard/recruiter/candidates" className="text-base font-medium text-cbl-navy hover:text-cbl-blue">
          &larr; Back to Search
        </Link>
      </div>
    );
  }

  const fullName = [candidate.firstName, candidate.middleName, candidate.lastName].filter(Boolean).join(" ");
  const location = [candidate.city, candidate.state, candidate.country].filter(Boolean).join(", ");

  // Skills as string array
  const skillsList = Array.isArray(candidate.skills)
    ? candidate.skills.map(s => typeof s === "string" ? s : JSON.stringify(s))
    : [];

  // Certifications as string array
  const certsList = Array.isArray(candidate.certifications)
    ? candidate.certifications.map(c => {
        if (typeof c === "string") return c;
        if (typeof c === "object" && c !== null && "type" in c) return String((c as Record<string, unknown>).type);
        return JSON.stringify(c);
      })
    : [];

  // Aircraft experience as string array
  const aircraftList = Array.isArray(candidate.aircraftExperience)
    ? candidate.aircraftExperience.map(a => typeof a === "string" ? a : JSON.stringify(a))
    : [];

  // Extra attributes
  const extraEntries = Object.entries(candidate.extraAttributes ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "");

  // Resolve resume URL: prefer top-level column, fall back to extra_attributes
  const resumeUrlStr = candidate.resumeUrl || (candidate.extraAttributes?.resumeUrl ? String(candidate.extraAttributes.resumeUrl) : null) || (candidate.extraAttributes?.ResumeUrl ? String(candidate.extraAttributes.ResumeUrl) : null);

  // Best available phone
  const bestPhone = candidate.phone || candidate.homePhone || candidate.workPhone;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 bg-cbl-navy shadow-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <nav className="flex items-center gap-2 text-base font-medium">
            <Link href="/dashboard" className="text-cbl-light hover:text-white">Dashboard</Link>
            <span className="text-cbl-light/40">/</span>
            <Link href="/dashboard/recruiter/candidates" className="text-cbl-light hover:text-white">Candidates</Link>
            <span className="text-cbl-light/40">/</span>
            <span className="text-white">{fullName}</span>
          </nav>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="rounded-lg border border-white/30 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10">
              Sign Out
            </button>
          </form>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">

          {/* Hero header */}
          <div className="border-b border-gray-200 bg-white px-6 py-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-bold text-gray-900">{fullName}</h1>
                {candidate.jobTitle && <p className="mt-1 text-sm text-gray-600">{candidate.jobTitle}</p>}
                {candidate.deducedRoles && candidate.deducedRoles.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {candidate.deducedRoles.map((role) => (
                      <span key={role} className="inline-block rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700">
                        {role}
                      </span>
                    ))}
                  </div>
                )}
                {candidate.currentCompany && <p className="text-sm text-gray-500">at {candidate.currentCompany}</p>}
                {location && <p className="mt-1 text-sm text-gray-400">{location}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2 text-right">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Availability</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${AVAILABILITY_BADGE[candidate.availabilityStatus] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                      {isStaleSignal(candidate.availabilityLastSignalAt) && (
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-yellow-500" title="Stale signal" />
                      )}
                      {candidate.availabilityStatus}
                      {isStaleSignal(candidate.availabilityLastSignalAt) && (
                        <span className="ml-0.5 font-normal text-yellow-600">Stale</span>
                      )}
                    </span>
                    <button type="button" onClick={handleRefreshAvailability} disabled={refreshing}
                      className="rounded-lg border border-gray-300 p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-50" title="Refresh Availability">
                      <svg className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Source</p>
                  <span className="mt-1 inline-block text-sm text-gray-600">
                    {candidate.source?.replace(/_/g, " ") ?? "unknown"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick actions bar */}
          <div className="flex flex-wrap items-center gap-4 border-b border-gray-200 bg-white px-6 py-4">
            {candidate.email && (
              <a href={`mailto:${candidate.email}`} className="flex items-center gap-1.5 text-sm font-medium text-cbl-navy hover:text-cbl-blue">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
                {candidate.email}
              </a>
            )}
            {bestPhone && (
              <a href={`tel:${bestPhone}`} className="flex items-center gap-1.5 text-sm font-medium text-cbl-navy hover:text-cbl-blue">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" /></svg>
                {bestPhone}
              </a>
            )}
            {resumeUrlStr && (
              <a href={resumeUrlStr} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-cbl-blue/40 bg-cbl-blue/10 px-3 py-1.5 text-sm font-medium text-cbl-blue hover:bg-cbl-blue/20">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                View Resume
              </a>
            )}
            {!candidate.email && !bestPhone && !resumeUrlStr && (
              <span className="text-xs text-gray-400">No contact info available</span>
            )}
          </div>

          {/* Sections with dividers */}
          <div className="divide-y divide-gray-100">

            {/* Contact */}
            <Section title="Contact Information">
              <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
                <Field label="Email" value={candidate.email} />
                <Field label="Alt. Email" value={candidate.alternateEmail} />
                <Field label="Phone" value={candidate.phone} />
                <Field label="Home Phone" value={candidate.homePhone} />
                <Field label="Work Phone" value={candidate.workPhone} />
                {candidate.address && <Field label="Address" value={[candidate.address, candidate.city, candidate.state, candidate.postalCode, candidate.country].filter(Boolean).join(", ")} />}
              </dl>
            </Section>

            {/* Professional */}
            <Section title="Professional Details">
              <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
                <Field label="Job Title" value={candidate.jobTitle} />
                <Field label="Company" value={candidate.currentCompany} />
                <Field label="Experience" value={candidate.yearsOfExperience ? `${candidate.yearsOfExperience} years` : null} />
                <Field label="Employment Type" value={candidate.employmentType} />
                <Field label="Current Rate" value={candidate.currentRate} />
                <Field label="Per Diem" value={candidate.perDiem} />
                <Field label="Shift Preference" value={candidate.shiftPreference} />
                <Field label="Expected Start" value={candidate.expectedStartDate} />
                <Field label="Work Authorization" value={candidate.workAuthorization} />
                <Field label="Clearance" value={candidate.clearance} />
                <BoolField label="A&P License" value={candidate.hasApLicense} />
                <Field label="Veteran Status" value={candidate.veteranStatus} />
              </dl>
            </Section>

            {/* Skills */}
            {skillsList.length > 0 && (
              <Section title="Skills">
                <div className="flex flex-wrap gap-2">
                  {skillsList.map((s, i) => (
                    <span key={i} className="rounded-full border border-cbl-blue/30 bg-cbl-blue/10 px-2.5 py-1 text-xs font-medium text-cbl-blue">{s}</span>
                  ))}
                </div>
              </Section>
            )}

            {/* Certifications */}
            {certsList.length > 0 && (
              <Section title="Certifications">
                <div className="flex flex-wrap gap-2">
                  {certsList.map((c, i) => (
                    <span key={i} className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">{c}</span>
                  ))}
                </div>
              </Section>
            )}

            {/* Aircraft Experience */}
            {aircraftList.length > 0 && (
              <Section title="Aircraft Experience">
                <div className="flex flex-wrap gap-2">
                  {aircraftList.map((a, i) => (
                    <span key={i} className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700">{a}</span>
                  ))}
                </div>
              </Section>
            )}

            {/* Experience History */}
            {Array.isArray(candidate.experience) && candidate.experience.length > 0 && (
              <Section title="Experience History">
                <div className="space-y-3">
                  {candidate.experience.map((exp, i) => (
                    <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
                      {typeof exp === "string" ? exp : <pre className="whitespace-pre-wrap break-words text-xs font-mono">{JSON.stringify(exp, null, 2)}</pre>}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Availability */}
            {(candidate.callAvailability || candidate.interviewAvailability) && (
              <Section title="Availability">
                <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
                  <Field label="Call Availability" value={candidate.callAvailability} />
                  <Field label="Interview Availability" value={candidate.interviewAvailability} />
                </dl>
              </Section>
            )}

            {/* Source & Metadata */}
            <Section title="Source & Metadata">
              <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
                <Field label="Source" value={candidate.source} />
                <Field label="Ceipal ID" value={candidate.ceipalId} />
                <Field label="Submitted By" value={candidate.submittedBy} />
                <Field label="Submitter Email" value={candidate.submitterEmail} />
                <Field label="Added" value={new Date(candidate.createdAt).toLocaleDateString()} />
                <Field label="Last Updated" value={new Date(candidate.updatedAt).toLocaleDateString()} />
              </dl>
            </Section>

            {/* Extra Attributes */}
            {extraEntries.length > 0 && (
              <Section title="Additional Information">
                <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
                  {extraEntries.map(([key, val]) => (
                    <div key={key} className="min-w-0">
                      <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">{key.replace(/_/g, " ")}</dt>
                      <dd className="mt-0.5 text-sm text-gray-800 break-all">{String(val)}</dd>
                    </div>
                  ))}
                </dl>
              </Section>
            )}

            {/* Recent Availability Signals */}
            <Section title="Recent Availability Signals">
              {signals.length === 0 ? (
                <p className="text-sm text-gray-400">No availability signals recorded yet.</p>
              ) : (
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">State</th>
                      <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Source</th>
                      <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {signals.map((s) => (
                      <tr key={s.id} className="text-sm text-gray-700">
                        <td className="px-4 py-2">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${AVAILABILITY_BADGE[s.newState] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                            {s.newState}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500">{s.source.replace(/_/g, " ")}</td>
                        <td className="px-4 py-2 text-xs text-gray-400">
                          {new Date(s.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-cbl-dark">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <p className="text-sm text-cbl-light/60">CBL Aero &middot; Enterprise Portal</p>
        </div>
      </footer>
    </div>
  );
}
