"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";

type SyncRun = {
  id: string;
  source: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  succeeded: number;
  failed: number;
  total: number;
  errorMessage: string | null;
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function duration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "running";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    complete: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
    running: "bg-blue-100 text-blue-700",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? "bg-gray-100 text-gray-500"}`}>
      {status}
    </span>
  );
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const PAGE_SIZE = 10;

export default function SyncRunSummaryCard() {
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    fetch("/api/internal/admin/sync-runs")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => setRuns(json.data ?? []))
      .catch((err) => {
        console.error("[SyncRunSummaryCard] Fetch error:", err);
        setFetchError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const monthLabel = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;

  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
        Sync Runs &mdash; {monthLabel}
      </h3>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cbl-navy border-t-transparent" />
          <span className="ml-3 text-sm text-gray-500">Loading sync runs&hellip;</span>
        </div>
      )}

      {!loading && fetchError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          Failed to load sync runs: {fetchError}
        </div>
      )}

      {!loading && !fetchError && runs.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 py-16 text-center">
          <p className="text-sm text-gray-500">No sync runs this month.</p>
        </div>
      )}

      {!loading && !fetchError && runs.length > 0 && (() => {
        const totalPages = Math.ceil(runs.length / PAGE_SIZE);
        const pageRuns = runs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

        return (
        <div>
          <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-gray-100 bg-gray-50/50">
              <tr>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Source</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Started</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Duration</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">OK</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Failed</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Total</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageRuns.map((run) => {
                const isExpanded = expandedRunId === run.id;
                return (
                  <Fragment key={run.id}>
                    <tr
                      className="cursor-pointer text-sm text-gray-700 transition-colors hover:bg-cbl-blue/5"
                      onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                    >
                      <td className="px-3 py-2 font-medium">{run.source}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{relativeTime(run.startedAt)}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{duration(run.startedAt, run.completedAt)}</td>
                      <td className="px-3 py-2 text-green-600">{run.succeeded}</td>
                      <td className={`px-3 py-2 ${run.failed > 0 ? "text-red-600 font-medium" : "text-gray-400"}`}>{run.failed}</td>
                      <td className="px-3 py-2">{run.total}</td>
                      <td className="px-3 py-2"><StatusBadge status={run.status} /></td>
                      <td className="px-3 py-2">
                        {run.failed > 0 && (
                          <Link
                            href={`/dashboard/admin/sync-errors?runId=${run.id}`}
                            className="text-xs font-medium text-cbl-blue hover:text-cbl-blue/80"
                            onClick={(e) => e.stopPropagation()}
                          >
                            View Errors
                          </Link>
                        )}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="border-t border-gray-100 bg-gray-50 px-5 py-3">
                          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                            <dt className="font-semibold text-gray-500">Run ID</dt>
                            <dd className="font-mono text-gray-700">{run.id}</dd>
                            <dt className="font-semibold text-gray-500">Source</dt>
                            <dd className="text-gray-700">{run.source}</dd>
                            <dt className="font-semibold text-gray-500">Status</dt>
                            <dd className="text-gray-700">{run.status}</dd>
                            <dt className="font-semibold text-gray-500">Started At</dt>
                            <dd className="font-mono text-gray-700">{run.startedAt}</dd>
                            <dt className="font-semibold text-gray-500">Completed At</dt>
                            <dd className="font-mono text-gray-700">{run.completedAt ?? "—"}</dd>
                            <dt className="font-semibold text-gray-500">Duration</dt>
                            <dd className="text-gray-700">{duration(run.startedAt, run.completedAt)}</dd>
                            <dt className="font-semibold text-gray-500">Succeeded</dt>
                            <dd className="text-green-600">{run.succeeded}</dd>
                            <dt className="font-semibold text-gray-500">Failed</dt>
                            <dd className={run.failed > 0 ? "font-medium text-red-600" : "text-gray-400"}>{run.failed}</dd>
                            <dt className="font-semibold text-gray-500">Total</dt>
                            <dd className="text-gray-700">{run.total}</dd>
                          </dl>

                          {run.errorMessage && (
                            <div className="mt-3">
                              <p className="text-xs font-semibold text-red-600">Error / Stack Trace</p>
                              <pre className="mt-1 max-h-48 overflow-auto rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 whitespace-pre-wrap break-words font-mono">
                                {run.errorMessage}
                              </pre>
                            </div>
                          )}

                          {run.status === "complete" && !run.errorMessage && run.failed === 0 && (
                            <p className="mt-2 text-xs text-green-600">No errors recorded for this run.</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
              <span className="text-xs text-gray-400">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, runs.length)} of {runs.length} runs
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page <= 0}
                  className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                >
                  Prev
                </button>
                <span className="text-xs text-gray-500">{page + 1}/{totalPages}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
        );
      })()}
    </div>
  );
}
