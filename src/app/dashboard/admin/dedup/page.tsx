"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type ReviewItem = {
  id: number;
  candidateAId: string;
  candidateBId: string;
  confidenceScore: number;
  fieldDiffs: Record<string, { a: unknown; b: unknown }>;
  status: string;
  createdAt: string;
};

type DedupStats = {
  autoMerged: number;
  manualMerged: number;
  manualRejected: number;
  keptSeparate: number;
  pendingReview: number;
};

type CandidateProfile = {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  location: string | null;
  skills: string[];
  source: string | null;
  createdAt: string;
};

type ExpandedReview = {
  review: ReviewItem;
  candidateA: CandidateProfile | null;
  candidateB: CandidateProfile | null;
};

function candidateLabel(c: CandidateProfile | null): string {
  if (!c) return "Unknown";
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
  return name || c.email || "Unknown";
}

export default function DedupReviewDashboard() {
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [stats, setStats] = useState<DedupStats | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedCache, setExpandedCache] = useState<Map<number, ExpandedReview>>(new Map());
  const [loadingExpand, setLoadingExpand] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [resolvedMap, setResolvedMap] = useState<Map<number, { decision: "approved" | "rejected"; mergedCandidate?: CandidateProfile | null }>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [reviewsRes, statsRes] = await Promise.all([
        fetch("/api/internal/dedup/reviews"),
        fetch("/api/internal/dedup/stats"),
      ]);
      if (reviewsRes.ok) { const r = await reviewsRes.json(); setReviews(r.data ?? []); }
      if (statsRes.ok) { const s = await statsRes.json(); setStats(s.data ?? null); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleExpand = async (reviewId: number) => {
    if (expandedId === reviewId) { setExpandedId(null); return; }
    setExpandedId(reviewId);

    // Use cache if available
    if (expandedCache.has(reviewId)) return;

    setLoadingExpand(true);
    try {
      const res = await fetch(`/api/internal/dedup/reviews/${reviewId}`);
      if (res.ok) {
        const data = await res.json();
        setExpandedCache((prev) => new Map(prev).set(reviewId, data.data));
      }
    } catch { /* ignore */ }
    finally { setLoadingExpand(false); }
  };

  const handleResolve = async (reviewId: number, decision: "approved" | "rejected") => {
    const actionLabel = decision === "approved" ? "merge" : "keep separate";
    setActionLoading(reviewId);
    setError(null);
    try {
      const res = await fetch(`/api/internal/dedup/reviews/${reviewId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error?.message ?? `Failed to ${actionLabel}`);
        return;
      }
      const json = await res.json();
      // Mark as resolved (keep in list showing merged result)
      setResolvedMap((prev) => new Map(prev).set(reviewId, { decision, mergedCandidate: json.data?.mergedCandidate ?? null }));
      setExpandedId(reviewId);
      // Refresh stats
      const statsRes = await fetch("/api/internal/dedup/stats");
      if (statsRes.ok) { const s = await statsRes.json(); setStats(s.data ?? null); }
    } catch (err) {
      setError(err instanceof Error ? err.message : `${actionLabel} failed`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkAction = async (decision: "approved" | "rejected") => {
    for (const id of [...selected]) { await handleResolve(id, decision); }
    setSelected(new Set());
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  // Build display label for each review from expanded cache or fieldDiffs
  function reviewLabel(r: ReviewItem): string {
    const cached = expandedCache.get(r.id);
    if (cached) {
      const nameA = candidateLabel(cached.candidateA);
      const nameB = candidateLabel(cached.candidateB);
      return `${nameA}  ↔  ${nameB}`;
    }
    // Fallback: show email or name from fieldDiffs if available
    const emailDiff = r.fieldDiffs.email;
    if (emailDiff) {
      return `${emailDiff.a ?? "?"} ↔ ${emailDiff.b ?? "?"}`;
    }
    const nameDiff = r.fieldDiffs.first_name;
    if (nameDiff) {
      return `${nameDiff.a ?? "?"} ↔ ${nameDiff.b ?? "?"}`;
    }
    return `Candidate A ↔ B`;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-cbl-navy border-t-transparent" />
          <p className="mt-3 text-sm text-gray-500">Loading review queue...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-cbl-navy shadow-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <nav className="flex items-center gap-2 text-base font-medium">
              <Link href="/dashboard" className="text-cbl-light hover:text-white">Dashboard</Link>
              <span className="text-cbl-light/40">/</span>
              <Link href="/dashboard/admin" className="text-cbl-light hover:text-white">Admin</Link>
              <span className="text-cbl-light/40">/</span>
              <span className="text-white">Dedup Review</span>
            </nav>
          </div>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="rounded-lg border border-white/30 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10">
              Sign Out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">

        {error && (
          <div className="mt-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">&times;</button>
          </div>
        )}

        {/* Legend */}
        <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm text-blue-800">
          <p className="font-semibold">How dedup review works:</p>
          <ul className="mt-1.5 list-inside list-disc space-y-1 text-sm">
            <li><strong>Merge</strong> — These ARE the same person. Combine into one record, keeping the best data from each.</li>
            <li><strong>Keep Separate</strong> — These are NOT the same person. Mark both as active, no merge.</li>
          </ul>
        </div>

        {/* Stats */}
        {stats && (
          <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              { label: "Auto-Merged", value: stats.autoMerged, color: "text-green-600" },
              { label: "Manual Merged", value: stats.manualMerged, color: "text-blue-600" },
              { label: "Kept Separate", value: stats.keptSeparate, color: "text-gray-500" },
              { label: "Rejected", value: stats.manualRejected, color: "text-orange-600" },
              { label: "Pending", value: stats.pendingReview, color: "text-amber-600 font-bold" },
            ].map(({ label, value, color }) => (
              <article key={label} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
                <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
              </article>
            ))}
          </section>
        )}

        {/* Bulk actions */}
        {reviews.length > 0 && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-5 py-3">
            <span className="text-sm text-gray-600">{reviews.length} pending review{reviews.length === 1 ? "" : "s"}</span>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => {
                  const highConf = reviews.filter((r) => r.confidenceScore >= 90).map((r) => r.id);
                  setSelected(new Set(highConf));
                }}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
              >
                Select all &ge;90%
              </button>
              {selected.size > 0 && (
                <>
                  <button onClick={() => handleBulkAction("approved")} className="rounded-lg bg-cbl-navy px-4 py-1.5 text-xs font-medium text-white hover:bg-cbl-blue">
                    Merge {selected.size} selected
                  </button>
                  <button onClick={() => handleBulkAction("rejected")} className="rounded-lg border border-gray-300 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">
                    Keep Separate {selected.size} selected
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Review list */}
        {reviews.length === 0 ? (
          <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 py-12 text-center">
            <p className="text-sm text-gray-500">No pending reviews.</p>
            <p className="mt-1 text-sm text-gray-400">All duplicate candidates have been resolved.</p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {reviews.map((r, idx) => {
              const isExpanded = expandedId === r.id;
              const cached = expandedCache.get(r.id);
              const isActioning = actionLoading === r.id;
              const resolved = resolvedMap.get(r.id);

              return (
                <div key={r.id} className={`rounded-xl border bg-white transition-shadow ${
                  resolved ? (resolved.decision === "approved" ? "border-green-300" : "border-blue-300") :
                  isExpanded ? "border-cbl-blue/40 shadow-md" : "border-gray-200"
                }`}>
                  {/* Resolved: show outcome + merged record */}
                  {resolved && (
                    <div className={`rounded-t-xl px-5 py-4 ${resolved.decision === "approved" ? "bg-green-50" : "bg-blue-50"}`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-semibold ${resolved.decision === "approved" ? "text-green-700" : "text-blue-700"}`}>
                          {resolved.decision === "approved" ? "Merged" : "Kept Separate"}
                        </span>
                        <button onClick={() => { setReviews((prev) => prev.filter((rv) => rv.id !== r.id)); setResolvedMap((prev) => { const n = new Map(prev); n.delete(r.id); return n; }); }}
                          className="text-xs text-gray-400 hover:text-gray-600">Dismiss</button>
                      </div>

                      {resolved.decision === "approved" && resolved.mergedCandidate && (
                        <div className="mt-3 rounded-xl border border-green-200 bg-white p-5">
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-xs font-bold uppercase tracking-wide text-green-600">Merged Record</p>
                            <a href={`/dashboard/recruiter/candidates/${resolved.mergedCandidate.id}`} target="_blank" rel="noopener noreferrer"
                              className="rounded-lg bg-cbl-navy px-3 py-1.5 text-xs font-medium text-white hover:bg-cbl-blue">
                              Open Profile →
                            </a>
                          </div>
                          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                            <FieldRow label="Name" value={`${resolved.mergedCandidate.firstName ?? ""} ${resolved.mergedCandidate.lastName ?? ""}`.trim()} />
                            <FieldRow label="Email" value={resolved.mergedCandidate.email} />
                            <FieldRow label="Phone" value={resolved.mergedCandidate.phone} />
                            <FieldRow label="Job Title" value={resolved.mergedCandidate.jobTitle} />
                            <FieldRow label="Location" value={resolved.mergedCandidate.location} />
                            <FieldRow label="Source" value={resolved.mergedCandidate.source} />
                          </dl>
                          {Array.isArray(resolved.mergedCandidate.skills) && resolved.mergedCandidate.skills.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {resolved.mergedCandidate.skills.map((s: string, i: number) => (
                                <span key={i} className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">{s}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {resolved.decision === "rejected" && (
                        <p className="mt-2 text-sm text-blue-600">Both candidates remain as separate active records.</p>
                      )}
                    </div>
                  )}

                  {/* Row header */}
                  {!resolved && (
                  <div className="flex items-center gap-3 px-5 py-4">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} className="h-4 w-4 rounded border-gray-300" />

                    <span className="w-6 text-center text-xs font-bold text-gray-300">{idx + 1}</span>

                    <button onClick={() => handleExpand(r.id)} className="flex flex-1 items-center gap-3 text-left min-w-0">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-800">{reviewLabel(r)}</p>
                        <p className="mt-0.5 text-xs text-gray-400">
                          {Object.keys(r.fieldDiffs).length} field difference{Object.keys(r.fieldDiffs).length === 1 ? "" : "s"}
                          {" · "}
                          {new Date(r.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                        r.confidenceScore >= 90 ? "bg-green-100 text-green-700" :
                        r.confidenceScore >= 80 ? "bg-yellow-100 text-yellow-700" :
                        "bg-orange-100 text-orange-700"
                      }`}>
                        {r.confidenceScore}%
                      </span>
                    </button>

                    <div className="flex gap-2 shrink-0 ml-2">
                      <button
                        onClick={() => handleResolve(r.id, "approved")}
                        disabled={isActioning}
                        className="rounded-lg bg-cbl-navy px-4 py-1.5 text-xs font-medium text-white hover:bg-cbl-blue disabled:opacity-50"
                      >
                        {isActioning ? "..." : "Merge"}
                      </button>
                      <button
                        onClick={() => handleResolve(r.id, "rejected")}
                        disabled={isActioning}
                        className="rounded-lg border border-gray-300 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                      >
                        Keep Separate
                      </button>
                    </div>
                  </div>
                  )}

                  {/* Expanded: side-by-side comparison */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 px-5 py-5 bg-gray-50/50">
                      {loadingExpand && !cached ? (
                        <p className="py-4 text-center text-sm text-gray-400">Loading candidate details...</p>
                      ) : cached ? (
                        <>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            {[
                              { label: "Candidate A", candidate: cached.candidateA, id: r.candidateAId },
                              { label: "Candidate B", candidate: cached.candidateB, id: r.candidateBId },
                            ].map(({ label, candidate: c, id }) => (
                              <div key={label} className="rounded-xl border border-gray-200 bg-white p-5">
                                <div className="mb-3 flex items-center justify-between">
                                  <p className="text-xs font-bold uppercase tracking-wide text-gray-400">{label}</p>
                                  <a
                                    href={`/dashboard/recruiter/candidates/${id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs font-medium text-cbl-navy hover:text-cbl-blue"
                                  >
                                    View Profile →
                                  </a>
                                </div>
                                {c ? (
                                  <dl className="space-y-2 text-sm">
                                    <FieldRow label="Name" value={`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim()} />
                                    <FieldRow label="Email" value={c.email} />
                                    <FieldRow label="Phone" value={c.phone} />
                                    <FieldRow label="Job Title" value={c.jobTitle} />
                                    <FieldRow label="Location" value={c.location} />
                                    <FieldRow label="Source" value={c.source} />
                                    <FieldRow label="Added" value={new Date(c.createdAt).toLocaleDateString()} />
                                    {Array.isArray(c.skills) && c.skills.length > 0 && (
                                      <div>
                                        <dt className="text-xs text-gray-400">Skills</dt>
                                        <dd className="mt-1 flex flex-wrap gap-1.5">
                                          {c.skills.slice(0, 5).map((s, i) => (
                                            <span key={i} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{s}</span>
                                          ))}
                                          {c.skills.length > 5 && <span className="text-xs text-gray-400">+{c.skills.length - 5} more</span>}
                                        </dd>
                                      </div>
                                    )}
                                  </dl>
                                ) : <p className="text-sm text-gray-400">Candidate not found</p>}
                              </div>
                            ))}
                          </div>

                          {/* Field differences */}
                          {Object.keys(cached.review.fieldDiffs).length > 0 && (
                            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-amber-700">Field Differences</p>
                              <div className="space-y-1.5">
                                {Object.entries(cached.review.fieldDiffs).map(([field, diff]) => (
                                  <div key={field} className="flex items-baseline gap-2 text-sm">
                                    <span className="w-28 shrink-0 font-medium text-gray-500">{field}</span>
                                    <span className="rounded-lg bg-red-100 px-2 py-0.5 text-red-700">{String(diff.a ?? "—")}</span>
                                    <span className="text-gray-300">→</span>
                                    <span className="rounded-lg bg-green-100 px-2 py-0.5 text-green-700">{String(diff.b ?? "—")}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="py-4 text-center text-sm text-gray-400">Failed to load details. Click to retry.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
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

function FieldRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-xs text-gray-400">{label}</dt>
      <dd className="text-gray-700">{value}</dd>
    </div>
  );
}
