"use client";

import React, { useEffect, useState, useCallback } from "react";

interface DailyUsageRow {
  date: string;
  model: string;
  promptName: string | null;
  promptVersion: string | null;
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

interface UsageTotals {
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

interface BudgetInfo {
  dailyCostUsd: number;
  threshold: number;
  exceeded: boolean;
}

interface AiUsageData {
  daily: DailyUsageRow[];
  totals: UsageTotals;
  budget: BudgetInfo;
}

export default function AiCostDashboard() {
  const [data, setData] = useState<AiUsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/internal/admin/ai-usage?days=${days}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const body = await res.json();
      setData(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load AI usage data");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchUsage(); }, [fetchUsage]);

  if (loading) return <p className="text-sm text-gray-400">Loading usage data...</p>;
  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (!data) return null;

  const dateGroups = new Map<string, { models: Map<string, number>; total: number }>();
  for (const row of data.daily) {
    let group = dateGroups.get(row.date);
    if (!group) { group = { models: new Map(), total: 0 }; dateGroups.set(row.date, group); }
    const prev = group.models.get(row.model) ?? 0;
    group.models.set(row.model, prev + row.estimatedCostUsd);
    group.total += row.estimatedCostUsd;
  }

  const maxDailyCost = Math.max(...[...dateGroups.values()].map((g) => g.total), 0.01);
  const allModels = [...new Set(data.daily.map((r) => r.model))];
  const modelColors: Record<string, string> = {};
  const colorPalette = ["bg-blue-400", "bg-violet-400", "bg-amber-400", "bg-cbl-blue", "bg-rose-400"];
  allModels.forEach((m, i) => { modelColors[m] = colorPalette[i % colorPalette.length]; });

  const promptVersionMap = new Map<string, { version: string; callCount: number; estimatedCostUsd: number; inputTokens: number; outputTokens: number }>();
  for (const row of data.daily) {
    const key = `${row.promptName ?? "unknown"}|${row.promptVersion ?? "?"}`;
    const entry = promptVersionMap.get(key) ?? { version: row.promptVersion ?? "?", callCount: 0, estimatedCostUsd: 0, inputTokens: 0, outputTokens: 0 };
    entry.callCount += row.callCount;
    entry.estimatedCostUsd += row.estimatedCostUsd;
    entry.inputTokens += row.inputTokens;
    entry.outputTokens += row.outputTokens;
    promptVersionMap.set(key, entry);
  }

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {[1, 7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-full border px-2 py-0.5 text-xs transition ${
                days === d ? "border-blue-300 bg-blue-50 font-medium text-blue-700" : "border-gray-200 text-gray-500 hover:border-blue-200"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
        {data.budget.exceeded && (
          <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-medium text-amber-700">
            Over budget: ${data.budget.dailyCostUsd.toFixed(2)}/{data.budget.threshold.toFixed(2)}
          </span>
        )}
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-4 gap-2">
        <MiniStat label="Calls" value={data.totals.callCount.toLocaleString()} />
        <MiniStat label="In Tokens" value={data.totals.inputTokens.toLocaleString()} />
        <MiniStat label="Out Tokens" value={data.totals.outputTokens.toLocaleString()} />
        <MiniStat label="Est. Cost" value={`$${data.totals.estimatedCostUsd.toFixed(4)}`} alert={data.budget.exceeded} />
      </div>

      {/* Daily bar chart */}
      {dateGroups.size > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-400">Daily Cost by Model</p>
          <div className="space-y-1">
            {[...dateGroups.entries()].map(([date, group]) => (
              <div key={date} className="flex items-center gap-2">
                <span className="w-12 text-xs text-gray-400">{date.slice(5)}</span>
                <div className="flex flex-1 gap-px">
                  {allModels.map((model) => {
                    const cost = group.models.get(model) ?? 0;
                    if (cost === 0) return null;
                    const widthPct = Math.max((cost / maxDailyCost) * 100, 3);
                    return <div key={model} className={`${modelColors[model]} h-3 rounded-sm`} style={{ width: `${widthPct}%` }} title={`${model}: $${cost.toFixed(4)}`} />;
                  })}
                </div>
                <span className="w-14 text-right text-xs text-gray-400">${group.total.toFixed(4)}</span>
              </div>
            ))}
          </div>
          {allModels.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {allModels.map((model) => (
                <span key={model} className="flex items-center gap-1 text-xs text-gray-400">
                  <span className={`${modelColors[model]} inline-block h-2 w-2 rounded-sm`} />
                  {model.replace("claude-", "").replace("-20251001", "")}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Prompt version table */}
      {promptVersionMap.size > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-400">Prompt Versions</p>
          <table className="w-full text-left text-xs text-gray-600">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400">
                <th className="pb-1 pr-3">Prompt</th>
                <th className="pb-1 pr-3">Ver</th>
                <th className="pb-1 pr-3 text-right">Calls</th>
                <th className="pb-1 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {[...promptVersionMap.entries()].map(([key, entry]) => {
                const [promptName] = key.split("|");
                return (
                  <tr key={key} className="border-b border-gray-50">
                    <td className="py-1 pr-3 font-mono">{promptName}</td>
                    <td className="py-1 pr-3"><span className="rounded-full bg-gray-100 px-1 py-px text-blue-600">{entry.version}</span></td>
                    <td className="py-1 pr-3 text-right">{entry.callCount}</td>
                    <td className="py-1 text-right">${entry.estimatedCostUsd.toFixed(4)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={`rounded-xl border p-2 ${alert ? "border-amber-200 bg-amber-50" : "border-gray-100 bg-gray-50"}`}>
      <p className="text-xs uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-sm font-semibold ${alert ? "text-amber-700" : "text-gray-800"}`}>{value}</p>
    </div>
  );
}
