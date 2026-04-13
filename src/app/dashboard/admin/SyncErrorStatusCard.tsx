"use client";

import React, { useState } from "react";
import type { SyncError } from "@/modules/ingestion";

type Props = {
  errors: SyncError[];
};

const PAGE_SIZE = 5;

export default function SyncErrorStatusCard({ errors }: Props) {
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(errors.length / PAGE_SIZE));
  const visible = errors.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Ingestion Errors {errors.length > 0 && <span className="ml-1 text-red-500">({errors.length})</span>}
        </h3>
        {totalPages > 1 && (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg px-1.5 py-0.5 hover:bg-gray-100 disabled:opacity-30"
            >
              Prev
            </button>
            <span>{page + 1}/{totalPages}</span>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg px-1.5 py-0.5 hover:bg-gray-100 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {errors.length === 0 ? (
        <p className="mt-2 text-sm text-gray-400">No sync errors reported.</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100">
          {visible.map((err) => {
            const isExpanded = expandedId === err.id;
            return (
              <li key={err.id} className="py-1.5">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : err.id)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-400" />
                    <span className="truncate text-sm font-medium text-gray-700">
                      [{err.source}] {err.recordId?.slice(0, 20) ?? "unknown"}
                    </span>
                  </div>
                  <span className="ml-2 flex-shrink-0 text-xs text-gray-400">
                    {err.timestamp?.slice(5, 16).replace("T", " ") ?? ""}
                  </span>
                </button>
                {isExpanded && (
                  <div className="mt-1 ml-4 rounded-xl bg-red-50 p-2 text-sm text-red-700">
                    {err.message || "No details available"}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
