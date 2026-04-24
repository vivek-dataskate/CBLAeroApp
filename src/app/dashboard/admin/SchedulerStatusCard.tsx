"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";

type ScheduleRun = {
  status: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
};

type ScheduleDefinition = {
  id: number;
  job_key: string;
  name: string;
  cron_expression: string;
  interval_minutes: number | null;
  enabled: boolean;
  next_run_at: string;
  last_claimed_at: string | null;
  last_run: ScheduleRun | null;
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

function relativeTimeFuture(iso: string | null): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return "overdue";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "< 1m";
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  return `in ${Math.floor(hrs / 24)}d`;
}

function intervalMinutesToHuman(minutes: number): string {
  if (minutes < 60 || minutes % 60 !== 0) {
    return minutes === 1 ? 'Every minute' : `Every ${minutes} minutes`;
  }
  const hours = minutes / 60;
  if (hours < 24 || hours % 24 !== 0) {
    return hours === 1 ? 'Every hour' : `Every ${hours} hours`;
  }
  const days = hours / 24;
  return days === 1 ? 'Every day' : `Every ${days} days`;
}

function scheduleToHuman(def: { cron_expression: string; interval_minutes: number | null }): string {
  if (def.interval_minutes && def.interval_minutes > 0) {
    return intervalMinutesToHuman(def.interval_minutes);
  }
  return cronToHuman(def.cron_expression);
}

function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [minute, hour, dom, month, dow] = parts;

  // */N * * * * → Every N minutes
  if (minute.startsWith("*/") && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    const n = Number(minute.slice(2));
    return n === 1 ? "Every minute" : `Every ${n} minutes`;
  }
  // 0 */N * * * → Every N hours
  if (minute === "0" && hour.startsWith("*/") && dom === "*" && month === "*" && dow === "*") {
    const n = Number(hour.slice(2));
    return n === 1 ? "Every hour" : `Every ${n} hours`;
  }
  // 0 * * * * → Every hour
  if (minute === "0" && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    return "Every hour";
  }
  // 0 H * * * → Daily at H:00 UTC
  if (minute === "0" && /^\d+$/.test(hour) && dom === "*" && month === "*" && dow === "*") {
    const h = Number(hour);
    const ampm = h < 12 ? "AM" : "PM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `Daily at ${h12}:00 ${ampm} UTC`;
  }
  // M H * * * → Daily at H:MM UTC
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === "*" && month === "*" && dow === "*") {
    const h = Number(hour);
    const ampm = h < 12 ? "AM" : "PM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `Daily at ${h12}:${minute.padStart(2, "0")} ${ampm} UTC`;
  }
  return cron;
}

function StatusBadge({ status, enabled }: { status?: string; enabled: boolean }) {
  if (!enabled) {
    return (
      <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
        paused
      </span>
    );
  }
  const styles: Record<string, string> = {
    completed: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
    skipped: "bg-yellow-100 text-yellow-700",
    claimed: "bg-blue-100 text-blue-700",
    started: "bg-blue-100 text-blue-700",
    pending: "bg-blue-50 text-blue-500",
  };
  const label = status ?? "—";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[label] ?? "bg-gray-100 text-gray-500"}`}>
      {label}
    </span>
  );
}

type EditingNextRun = { id: number; value: string };
type EditingCron = { id: number; amount: number; unit: 'minutes' | 'hours' };

function parseCronToInterval(cron: string): { amount: number; unit: 'minutes' | 'hours' } | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dom, month, dow] = parts;
  if (dom !== '*' || month !== '*' || dow !== '*') return null;
  // */N * * * * → every N minutes
  if (minute.startsWith('*/') && hour === '*') {
    return { amount: Number(minute.slice(2)), unit: 'minutes' };
  }
  // 0 */N * * * → every N hours
  if (minute === '0' && hour.startsWith('*/')) {
    return { amount: Number(hour.slice(2)), unit: 'hours' };
  }
  // 0 * * * * → every 1 hour
  if (minute === '0' && hour === '*') {
    return { amount: 1, unit: 'hours' };
  }
  return null;
}

export default function SchedulerStatusCard({ compact = false }: { compact?: boolean }) {
  const [definitions, setDefinitions] = useState<ScheduleDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState<number | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);
  const [rowError, setRowError] = useState<Record<number, string>>({});
  const [editingNextRun, setEditingNextRun] = useState<EditingNextRun | null>(null);
  const [savingNextRun, setSavingNextRun] = useState<number | null>(null);
  const [editingCron, setEditingCron] = useState<EditingCron | null>(null);
  const [savingCron, setSavingCron] = useState<number | null>(null);
  // DN1: simple inline toast — no external library
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // P8: ref tracks current abort controller so cleanup can cancel in-flight requests
  const abortCtrlRef = useRef<AbortController | null>(null);
  // P9: generation counter detects and discards stale responses from concurrent load() calls
  const loadGenRef = useRef(0);

  const load = useCallback(() => {
    // Cancel any in-flight request before issuing a new one
    abortCtrlRef.current?.abort();
    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;
    const gen = ++loadGenRef.current;

    setLoading(true);
    fetch("/api/internal/admin/scheduler/definitions", { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (gen !== loadGenRef.current) return; // stale response
        setDefinitions(json.data ?? []);
      })
      .catch((err) => {
        if (err.name === 'AbortError' || gen !== loadGenRef.current) return;
        console.error("[SchedulerStatusCard] Fetch error:", err);
        setFetchError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (gen !== loadGenRef.current) return;
        setLoading(false);
      });
  }, []);

  // P8: abort any in-flight fetch on unmount
  useEffect(() => {
    load();
    return () => abortCtrlRef.current?.abort();
  }, [load]);

  // DN1: auto-dismiss toast after 3 seconds
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const clearRowError = (id: number) =>
    setRowError((prev) => { const next = { ...prev }; delete next[id]; return next; });

  const handleTrigger = async (def: ScheduleDefinition) => {
    setTriggering(def.id);
    clearRowError(def.id);
    try {
      const r = await fetch(`/api/internal/admin/scheduler/definitions/${def.id}/trigger`, { method: "POST" });
      const json = await r.json();
      if (!r.ok) throw new Error(json?.error?.message ?? `HTTP ${r.status}`);
      setToast({ message: `${def.name} triggered successfully`, type: 'success' }); // DN1
      load();
    } catch (err) {
      setRowError((prev) => ({ ...prev, [def.id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setTriggering(null);
    }
  };

  const handleToggleEnabled = async (def: ScheduleDefinition) => {
    setToggling(def.id);
    clearRowError(def.id);
    try {
      const r = await fetch(`/api/internal/admin/scheduler/definitions/${def.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !def.enabled }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json?.error?.message ?? `HTTP ${r.status}`);
      setToast({ message: `${def.name} ${!def.enabled ? 'enabled' : 'paused'}`, type: 'success' }); // DN1
      load();
    } catch (err) {
      setRowError((prev) => ({ ...prev, [def.id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setToggling(null);
    }
  };

  const handleSaveNextRun = async (def: ScheduleDefinition) => {
    if (!editingNextRun || editingNextRun.id !== def.id) return;
    // P6: validate datetime before calling toISOString
    const d = new Date(editingNextRun.value);
    if (!editingNextRun.value || isNaN(d.getTime())) {
      setRowError((prev) => ({ ...prev, [def.id]: 'Invalid date/time value. Use the datetime picker.' }));
      return;
    }
    setSavingNextRun(def.id);
    clearRowError(def.id);
    try {
      const r = await fetch(`/api/internal/admin/scheduler/definitions/${def.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ next_run_at: d.toISOString() }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json?.error?.message ?? `HTTP ${r.status}`);
      setEditingNextRun(null);
      setToast({ message: `Next run time updated for ${def.name}`, type: 'success' }); // DN1
      load();
    } catch (err) {
      setRowError((prev) => ({ ...prev, [def.id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setSavingNextRun(null);
    }
  };

  const handleSaveCron = async (def: ScheduleDefinition) => {
    if (!editingCron || editingCron.id !== def.id) return;
    const { amount, unit } = editingCron;
    if (amount < 5 && unit === 'minutes') {
      setRowError((prev) => ({ ...prev, [def.id]: 'Minimum interval is 5 minutes.' }));
      return;
    }
    if ((unit === 'hours' && amount > 168) || (unit === 'minutes' && amount > 10080)) {
      setRowError((prev) => ({ ...prev, [def.id]: 'Maximum interval is 168 hours (1 week).' }));
      return;
    }
    const newIntervalMinutes = unit === 'hours' ? amount * 60 : amount;
    if (newIntervalMinutes === def.interval_minutes) {
      setEditingCron(null);
      return;
    }
    setSavingCron(def.id);
    clearRowError(def.id);
    try {
      const r = await fetch(`/api/internal/admin/scheduler/definitions/${def.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval_minutes: newIntervalMinutes }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json?.error?.message ?? `HTTP ${r.status}`);
      setEditingCron(null);
      setToast({ message: `Schedule updated: ${intervalMinutesToHuman(newIntervalMinutes)}`, type: 'success' });
      load();
    } catch (err) {
      setRowError((prev) => ({ ...prev, [def.id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setSavingCron(null);
    }
  };

  return (
    <div className="relative">
      {/* DN1: Auto-dismissing success/error toast */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-opacity ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.message}
        </div>
      )}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cbl-navy border-t-transparent" />
          <span className="ml-3 text-sm text-gray-500">Loading schedules&hellip;</span>
        </div>
      )}

      {!loading && fetchError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          Failed to load schedules: {fetchError}
        </div>
      )}

      {!loading && !fetchError && definitions.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 py-16 text-center">
          <p className="text-sm text-gray-500">
            No schedule definitions found. Run the scheduler once to bootstrap them.
          </p>
        </div>
      )}

      {!loading && !fetchError && definitions.length > 0 && compact && (
        <ul className="divide-y divide-gray-100">
          {definitions.map((def) => {
            const isTriggeringThis = triggering === def.id;
            const isTogglingThis = toggling === def.id;
            const err = rowError[def.id];

            return (
              <li key={def.id} className="py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-cbl-navy">{def.name}</span>
                      <StatusBadge status={def.last_run?.status} enabled={def.enabled} />
                    </div>
                    {editingCron?.id === def.id ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="text-xs text-gray-500">Every</span>
                        <input
                          type="number"
                          min={editingCron.unit === 'minutes' ? 5 : 1}
                          max={editingCron.unit === 'minutes' ? 10080 : 168}
                          value={editingCron.amount}
                          onChange={(e) => setEditingCron({ ...editingCron, amount: Number(e.target.value) })}
                          className="w-14 rounded border border-gray-300 px-1.5 py-0.5 text-xs focus:border-cbl-blue focus:outline-none"
                        />
                        <select
                          value={editingCron.unit}
                          onChange={(e) => setEditingCron({ ...editingCron, unit: e.target.value as 'minutes' | 'hours' })}
                          className="rounded border border-gray-300 px-1 py-0.5 text-xs focus:border-cbl-blue focus:outline-none"
                        >
                          <option value="minutes">min</option>
                          <option value="hours">hrs</option>
                        </select>
                        <button
                          onClick={() => handleSaveCron(def)}
                          disabled={savingCron === def.id}
                          className="rounded bg-cbl-blue px-2 py-0.5 text-xs font-medium text-white hover:bg-cbl-blue/80 disabled:opacity-50"
                        >
                          {savingCron === def.id ? "…" : "Save"}
                        </button>
                        <button onClick={() => setEditingCron(null)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          if (def.interval_minutes && def.interval_minutes > 0) {
                            const useHours = def.interval_minutes >= 60 && def.interval_minutes % 60 === 0;
                            setEditingCron({
                              id: def.id,
                              amount: useHours ? def.interval_minutes / 60 : def.interval_minutes,
                              unit: useHours ? 'hours' : 'minutes',
                            });
                            return;
                          }
                          const parsed = parseCronToInterval(def.cron_expression);
                          setEditingCron(parsed ? { id: def.id, ...parsed } : { id: def.id, amount: 60, unit: 'minutes' });
                        }}
                        className="text-xs text-gray-400 hover:text-cbl-blue"
                        title="Click to edit schedule"
                      >
                        {scheduleToHuman(def)} · {relativeTimeFuture(def.next_run_at)}
                      </button>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => handleTrigger(def)}
                      disabled={isTriggeringThis}
                      className="rounded-lg bg-cbl-navy px-2.5 py-1 text-xs font-medium text-white hover:bg-cbl-navy/80 disabled:opacity-50"
                    >
                      {isTriggeringThis ? "…" : "Run"}
                    </button>
                    <button
                      onClick={() => handleToggleEnabled(def)}
                      disabled={isTogglingThis}
                      className={`rounded-lg border px-2 py-1 text-xs font-medium disabled:opacity-50 ${
                        def.enabled
                          ? "border-gray-300 text-gray-500 hover:border-red-300 hover:text-red-600"
                          : "border-green-300 text-green-700 hover:bg-green-50"
                      }`}
                    >
                      {isTogglingThis ? "…" : def.enabled ? "Pause" : "Enable"}
                    </button>
                  </div>
                </div>
                {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
                {def.last_run?.status === "failed" && def.last_run.error_message && (
                  <p className="mt-1 text-xs text-amber-700">Last error: {def.last_run.error_message}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!loading && !fetchError && definitions.length > 0 && !compact && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-gray-100 bg-gray-50/50">
              <tr>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Job</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Schedule</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Last Run</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Next Run</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {definitions.map((def) => {
                const isTriggeringThis = triggering === def.id;
                const isTogglingThis = toggling === def.id;
                const isSavingNextRunThis = savingNextRun === def.id;
                const isEditingNextRunThis = editingNextRun?.id === def.id;
                const err = rowError[def.id];

                return (
                  <Fragment key={def.id}>
                    <tr className="text-sm text-gray-700">
                      <td className="px-3 py-3">
                        <span className="font-medium text-cbl-navy">{def.name}</span>
                        <br />
                        <span className="font-mono text-xs text-gray-400">{def.job_key}</span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-xs text-gray-700" title={def.interval_minutes ? `interval_minutes=${def.interval_minutes}` : def.cron_expression}>
                          {scheduleToHuman(def)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={def.last_run?.status} enabled={def.enabled} />
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-500">
                        {relativeTime(def.last_run?.completed_at ?? def.last_run?.started_at ?? null)}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-500">
                        {isEditingNextRunThis ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="datetime-local"
                              value={editingNextRun.value}
                              onChange={(e) => setEditingNextRun({ id: def.id, value: e.target.value })}
                              className="rounded border border-gray-300 px-1 py-0.5 text-xs focus:border-cbl-blue focus:outline-none"
                            />
                            <button
                              onClick={() => handleSaveNextRun(def)}
                              disabled={isSavingNextRunThis}
                              className="rounded bg-cbl-blue px-2 py-0.5 text-xs font-medium text-white hover:bg-cbl-blue/80 disabled:opacity-50"
                            >
                              {isSavingNextRunThis ? "…" : "Set"}
                            </button>
                            <button
                              onClick={() => setEditingNextRun(null)}
                              className="text-xs text-gray-400 hover:text-gray-600"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              const d = new Date(def.next_run_at);
                              const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
                                .toISOString()
                                .slice(0, 16);
                              setEditingNextRun({ id: def.id, value: local });
                            }}
                            title="Click to override next run time"
                            className="underline-offset-2 hover:text-cbl-blue hover:underline"
                          >
                            {relativeTimeFuture(def.next_run_at)}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleTrigger(def)}
                            disabled={isTriggeringThis}
                            className="rounded-lg bg-cbl-navy px-2.5 py-1 text-xs font-medium text-white hover:bg-cbl-navy/80 disabled:opacity-50"
                          >
                            {isTriggeringThis ? "Running…" : "Run now"}
                          </button>
                          <button
                            onClick={() => handleToggleEnabled(def)}
                            disabled={isTogglingThis}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
                              def.enabled
                                ? "border-gray-300 text-gray-600 hover:border-red-300 hover:text-red-600"
                                : "border-green-300 text-green-700 hover:bg-green-50"
                            }`}
                          >
                            {isTogglingThis ? "…" : def.enabled ? "Pause" : "Enable"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {err && (
                      <tr key={`err-${def.id}`}>
                        <td colSpan={6} className="bg-red-50 px-4 py-2 text-xs text-red-700">{err}</td>
                      </tr>
                    )}
                    {def.last_run?.status === "failed" && def.last_run.error_message && (
                      <tr key={`detail-${def.id}`}>
                        <td colSpan={6} className="border-t border-gray-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                          <span className="font-semibold">Last error:</span> {def.last_run.error_message}
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
}
