"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ProviderHealthSummary = {
  name: string;
  mode: "normal" | "degraded" | "kill_switched";
  status: "healthy" | "degraded" | "unhealthy";
  errorRate: number;
  p95LatencyMs: number;
  totalAttempts: number;
  totalFailures: number;
  registeredAtIso: string;
};

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ModeBadge({ mode }: { mode: ProviderHealthSummary["mode"] }) {
  const styles: Record<ProviderHealthSummary["mode"], string> = {
    normal: "bg-green-100 text-green-700",
    degraded: "bg-yellow-100 text-yellow-700",
    kill_switched: "bg-red-100 text-red-700",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[mode]}`}>
      {mode === "kill_switched" ? "kill-switched" : mode}
    </span>
  );
}

function StatusDot({ status }: { status: ProviderHealthSummary["status"] }) {
  const color = status === "healthy" ? "bg-green-500" : status === "degraded" ? "bg-yellow-500" : "bg-red-500";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-label={status} />;
}

export default function ProviderHealthCard() {
  const [providers, setProviders] = useState<ProviderHealthSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);
  const loadGenRef = useRef(0);

  const load = useCallback(() => {
    abortCtrlRef.current?.abort();
    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;
    const gen = ++loadGenRef.current;

    setLoading(true);
    fetch("/api/internal/admin/providers", { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (gen !== loadGenRef.current) return;
        setProviders(json.data ?? []);
        setFetchError(null);
      })
      .catch((err) => {
        if (err.name === "AbortError" || gen !== loadGenRef.current) return;
        console.error("[ProviderHealthCard] Fetch error:", err);
        setFetchError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (gen !== loadGenRef.current) return;
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    // Defer first load to a microtask so React's
    // "no setState in effect body" rule is satisfied — load() calls
    // setLoading(true) synchronously, which must not run during the effect.
    queueMicrotask(load);
    // Refresh every 30s so the card tracks the rolling 5-minute health window
    // roughly in lockstep with the Supabase ping cadence.
    const timer = setInterval(load, 30_000);
    return () => {
      clearInterval(timer);
      abortCtrlRef.current?.abort();
    };
  }, [load]);

  if (fetchError) {
    return (
      <div className="text-sm text-red-600">
        Failed to load provider health: {fetchError}
      </div>
    );
  }

  if (loading && providers.length === 0) {
    return <div className="text-sm text-gray-500">Loading provider health…</div>;
  }

  if (providers.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        No providers registered. Check environment configuration.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <th className="pb-2 pr-2"></th>
            <th className="pb-2 pr-2">Provider</th>
            <th className="pb-2 pr-2">Mode</th>
            <th className="pb-2 pr-2">Error Rate</th>
            <th className="pb-2 pr-2">p95 Latency</th>
            <th className="pb-2 pr-2">Attempts (5m)</th>
            <th className="pb-2 pr-2">Failures</th>
            <th className="pb-2 pr-2">Registered</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => (
            <tr key={p.name} className="border-b border-gray-100 last:border-0">
              <td className="py-2 pr-2"><StatusDot status={p.status} /></td>
              <td className="py-2 pr-2 font-medium text-gray-800">{p.name}</td>
              <td className="py-2 pr-2"><ModeBadge mode={p.mode} /></td>
              <td className="py-2 pr-2 tabular-nums text-gray-600">
                {p.totalAttempts === 0 ? "—" : `${(p.errorRate * 100).toFixed(1)}%`}
              </td>
              <td className="py-2 pr-2 tabular-nums text-gray-600">
                {p.totalAttempts === 0 ? "—" : `${Math.round(p.p95LatencyMs)}ms`}
              </td>
              <td className="py-2 pr-2 tabular-nums text-gray-600">{p.totalAttempts}</td>
              <td className="py-2 pr-2 tabular-nums text-gray-600">{p.totalFailures}</td>
              <td className="py-2 pr-2 text-xs text-gray-500">{relativeTime(p.registeredAtIso)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-gray-400">
        Rolling 5-minute window. Refreshes every 30 seconds. Modes:{" "}
        <span className="font-medium text-green-700">normal</span> ·{" "}
        <span className="font-medium text-yellow-700">degraded</span> ·{" "}
        <span className="font-medium text-red-700">kill-switched</span>.
      </p>
    </div>
  );
}
