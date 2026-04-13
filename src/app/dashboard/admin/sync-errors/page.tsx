"use client";

import { Fragment, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type SyncError = {
  id: string;
  source: string;
  recordId: string;
  message: string;
  timestamp: string;
};

type ErrorGroup = {
  pattern: string;
  count: number;
  errors: SyncError[];
};

function groupErrors(errors: SyncError[]): ErrorGroup[] {
  const map = new Map<string, SyncError[]>();
  for (const err of errors) {
    const pattern = err.message.slice(0, 60);
    const list = map.get(pattern) ?? [];
    list.push(err);
    map.set(pattern, list);
  }
  return Array.from(map.entries()).map(([pattern, errs]) => ({
    pattern,
    count: errs.length,
    errors: errs,
  }));
}

function SignOutButton() {
  return (
    <form action="/api/auth/logout" method="post">
      <button type="submit" className="rounded-lg border border-white/30 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10">
        Sign Out
      </button>
    </form>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="sticky top-0 z-10 bg-cbl-navy shadow-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <nav className="flex items-center gap-2 text-base font-medium">
            <Link href="/dashboard" className="text-cbl-light hover:text-white">Dashboard</Link>
            <span className="text-cbl-light/40">/</span>
            <Link href="/dashboard/admin" className="text-cbl-light hover:text-white">Admin</Link>
            <span className="text-cbl-light/40">/</span>
            <span className="text-white">Sync Errors</span>
          </nav>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">{children}</main>
      <footer className="bg-cbl-dark">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <p className="text-sm text-cbl-light/60">CBL Aero &middot; Enterprise Portal</p>
        </div>
      </footer>
    </div>
  );
}

function SyncErrorsInner() {
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId");

  const [errors, setErrors] = useState<SyncError[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setLoading(false);
      return;
    }
    fetch(`/api/internal/admin/sync-errors?runId=${encodeURIComponent(runId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => setErrors(json.data ?? []))
      .catch((err) => {
        console.error("[SyncErrorsPage] Fetch error:", err);
        setFetchError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [runId]);

  if (!runId) {
    return (
      <PageShell>
        <div className="rounded-xl border border-gray-200 bg-gray-50 py-16 text-center">
          <p className="text-sm text-gray-500">Select a run from the admin dashboard.</p>
          <Link href="/dashboard/admin" className="mt-2 inline-block text-sm font-medium text-cbl-blue hover:text-cbl-blue/80">
            Back to Admin Dashboard
          </Link>
        </div>
      </PageShell>
    );
  }

  const groups = groupErrors(errors);
  const totalFailed = errors.length;
  const source = errors.length > 0 ? errors[0].source : "unknown";

  return (
    <PageShell>
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cbl-navy border-t-transparent" />
          <span className="ml-3 text-sm text-gray-500">Loading errors&hellip;</span>
        </div>
      )}

      {!loading && fetchError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          Failed to load sync errors: {fetchError}
        </div>
      )}

      {!loading && !fetchError && (
        <>
          {/* Run info bar */}
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-5 py-3">
            <span className="text-sm font-medium text-gray-700">Source: <span className="font-semibold">{source}</span></span>
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">{totalFailed} errors</span>
            <span className="text-xs text-gray-400 font-mono">Run: {runId.slice(0, 8)}&hellip;</span>
          </div>

          {errors.length === 0 && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 py-12 text-center">
              <p className="text-sm text-green-600 font-medium">No errors in this run.</p>
            </div>
          )}

          {groups.length > 0 && (
            <div className="space-y-2">
              {groups.map((group, groupIdx) => {
                const isGroupExpanded = expandedGroup === group.pattern;
                return (
                  <div key={`group-${groupIdx}`} className="rounded-xl border border-gray-200 bg-white">
                    <button
                      type="button"
                      onClick={() => setExpandedGroup(isGroupExpanded ? null : group.pattern)}
                      className="flex w-full items-center justify-between px-5 py-2 text-left transition hover:bg-gray-50"
                    >
                      <span className="text-sm text-gray-700">
                        {group.pattern}{group.errors[0]?.message.length > 60 ? "..." : ""}
                      </span>
                      <span className="ml-3 flex items-center gap-2">
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">{group.count}</span>
                        <span className="text-xs text-gray-400">{isGroupExpanded ? "\u25B2" : "\u25BC"}</span>
                      </span>
                    </button>

                    {isGroupExpanded && (
                      <div className="border-t border-gray-100 px-5 py-2">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="border-b border-gray-100">
                              <th className="py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">Record ID</th>
                              <th className="py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">Timestamp</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {group.errors.map((err) => {
                              const isErrorExpanded = expandedErrorId === err.id;
                              return (
                                <Fragment key={err.id}>
                                  <tr
                                    className="cursor-pointer text-sm text-gray-600 transition-colors hover:bg-red-50/50"
                                    onClick={() => setExpandedErrorId(isErrorExpanded ? null : err.id)}
                                  >
                                    <td className="py-1.5 font-mono text-xs">{err.recordId}</td>
                                    <td className="py-1.5 text-xs text-gray-400">{err.timestamp.slice(0, 19).replace("T", " ")}</td>
                                  </tr>
                                  {isErrorExpanded && (
                                    <tr>
                                      <td colSpan={2} className="bg-gray-50 px-3 py-2">
                                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                                          <dt className="font-semibold text-gray-500">Error ID</dt>
                                          <dd className="font-mono text-gray-700">{err.id}</dd>
                                          <dt className="font-semibold text-gray-500">Source</dt>
                                          <dd className="text-gray-700">{err.source}</dd>
                                          <dt className="font-semibold text-gray-500">Record ID</dt>
                                          <dd className="font-mono text-gray-700">{err.recordId}</dd>
                                          <dt className="font-semibold text-gray-500">Timestamp</dt>
                                          <dd className="font-mono text-gray-700">{err.timestamp}</dd>
                                        </dl>
                                        <div className="mt-2">
                                          <p className="text-xs font-semibold text-red-600">Full Error / Stack Trace</p>
                                          <pre className="mt-1 max-h-48 overflow-auto rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 whitespace-pre-wrap break-words font-mono">
                                            {err.message}
                                          </pre>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}

export default function SyncErrorsPage() {
  return (
    <Suspense fallback={
      <PageShell>
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cbl-navy border-t-transparent" />
          <span className="ml-3 text-sm text-gray-500">Loading&hellip;</span>
        </div>
      </PageShell>
    }>
      <SyncErrorsInner />
    </Suspense>
  );
}
