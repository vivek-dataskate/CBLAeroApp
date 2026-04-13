"use client";

import { useEffect, useMemo, useState } from "react";

type BatchProgressData = {
  batchId: string;
  status: "validating" | "running" | "paused_on_error_threshold" | "complete" | "rolled_back";
  imported: number;
  skipped: number;
  errors: number;
  totalRows: number;
  startedAt: string;
  completedAt: string | null;
  elapsedMs: number | null;
};

type BatchProgressCardProps = {
  batchId: string;
};

const TERMINAL_STATUSES = new Set<BatchProgressData["status"]>([
  "complete",
  "paused_on_error_threshold",
  "rolled_back",
]);

const STATUS_LABELS: Record<BatchProgressData["status"], string> = {
  validating: "Validating",
  running: "Running",
  paused_on_error_threshold: "Paused",
  complete: "Complete",
  rolled_back: "Rolled Back",
};

function formatElapsed(elapsedMs: number | null): string {
  if (elapsedMs === null || elapsedMs < 0) {
    return "N/A";
  }

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

function getProgress(imported: number, skipped: number, totalRows: number): number {
  if (totalRows <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(((imported + skipped) / totalRows) * 100)));
}

export default function BatchProgressCard({ batchId }: BatchProgressCardProps) {
  const [data, setData] = useState<BatchProgressData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      try {
        const response = await fetch(`/api/internal/recruiter/csv-upload/${batchId}`, {
          method: "GET",
          cache: "no-store",
        });

        const payload = await response.json();
        if (!response.ok) {
          setError(payload?.error?.message ?? "Failed to load batch status.");
          // Stop polling on auth errors — retrying won't help
          if ((response.status === 401 || response.status === 403) && pollId) {
            clearInterval(pollId);
            pollId = null;
          }
          return;
        }

        if (!mounted) {
          return;
        }

        setError(null);
        setData(payload.data as BatchProgressData);

        if (TERMINAL_STATUSES.has((payload.data as BatchProgressData).status) && pollId) {
          clearInterval(pollId);
          pollId = null;
        }
      } catch {
        if (mounted) {
          setError("Failed to load batch status.");
        }
      }
    };

    void load();
    pollId = setInterval(() => {
      void load();
    }, 5000);

    return () => {
      mounted = false;
      if (pollId) {
        clearInterval(pollId);
      }
    };
  }, [batchId]);

  const progress = useMemo(
    () => (data ? getProgress(data.imported, data.skipped, data.totalRows) : 0),
    [data],
  );

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Upload Progress</p>
      <p className="mt-1.5 text-xs text-gray-500">Batch {batchId.slice(0, 8)}...</p>

      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}

      {data ? (
        <>
          <p className="mt-2 text-xs font-medium text-gray-700">{STATUS_LABELS[data.status]}</p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100">
            <div
              className="h-1.5 rounded-full bg-cbl-blue transition-all"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>

          <div className="mt-2 grid gap-1.5 text-sm text-gray-500 md:grid-cols-2">
            <p>
              New: <span className="font-medium text-cbl-navy">{data.imported.toLocaleString()}</span>
            </p>
            <p>
              Skipped: <span className="font-medium text-gray-700">{data.skipped.toLocaleString()}</span>
            </p>
            <p>
              Errors: <span className="font-medium text-amber-600">{data.errors.toLocaleString()}</span>
            </p>
            <p>
              Total Rows: <span className="font-medium text-gray-700">{data.totalRows.toLocaleString()}</span>
            </p>
            <p>
              Elapsed: <span className="font-medium text-gray-700">{formatElapsed(data.elapsedMs)}</span>
            </p>
          </div>

          {data.status === "complete" && data.errors > 0 ? (
            <a
              href={`/api/internal/recruiter/csv-upload/${batchId}/error-report`}
              className="mt-3 inline-block text-xs text-gray-600 underline hover:text-gray-800"
            >
              Download error report
            </a>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-xs text-gray-400">Fetching batch status...</p>
      )}
    </section>
  );
}
