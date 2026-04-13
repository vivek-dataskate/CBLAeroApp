import { isSupabaseConfigured, getSupabaseAdminClient, shouldUseInMemoryPersistenceForTests } from '../persistence';

export interface DailyUsageRow {
  date: string;
  model: string;
  promptName: string | null;
  promptVersion: string | null;
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface UsageTotals {
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface AiUsageResult {
  daily: DailyUsageRow[];
  totals: UsageTotals;
}

// In-memory store for tests
let inMemoryUsageLog: Array<{
  model: string;
  prompt_name: string | null;
  prompt_version: string | null;
  module: string;
  action: string;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  estimated_cost_usd: number;
  created_at: string;
}> = [];

export function seedUsageLogForTest(entry: {
  model: string;
  prompt_name: string | null;
  prompt_version: string | null;
  module: string;
  action: string;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  estimated_cost_usd: number;
  created_at: string;
}): void {
  inMemoryUsageLog.push(entry);
}

export function clearUsageLogForTest(): void {
  if (process.env.NODE_ENV !== 'test') return;
  inMemoryUsageLog = [];
}

/**
 * Aggregate LLM usage from llm_usage_log grouped by day, model, prompt_name.
 * Supports filtering by days lookback, model, and promptName.
 */
export async function getAggregatedUsage(params: {
  days?: number;
  model?: string;
  promptName?: string;
}): Promise<AiUsageResult> {
  const days = params.days ?? 7;

  if (shouldUseInMemoryPersistenceForTests() || !isSupabaseConfigured()) {
    return aggregateInMemory(days, params.model, params.promptName);
  }

  const db = getSupabaseAdminClient();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();

  let query = db
    .from('llm_usage_log')
    .select('model, prompt_name, prompt_version, input_tokens, output_tokens, estimated_cost_usd, created_at')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true });

  if (params.model) {
    query = query.eq('model', params.model);
  }
  if (params.promptName) {
    query = query.eq('prompt_name', params.promptName);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to query llm_usage_log: ${error.message}`);
  }

  return aggregateRows(data ?? []);
}

function aggregateInMemory(days: number, model?: string, promptName?: string): AiUsageResult {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceMs = since.getTime();

  let filtered = inMemoryUsageLog.filter(
    (row) => new Date(row.created_at).getTime() >= sinceMs
  );
  if (model) {
    filtered = filtered.filter((row) => row.model === model);
  }
  if (promptName) {
    filtered = filtered.filter((row) => row.prompt_name === promptName);
  }

  return aggregateRows(filtered);
}

interface RawRow {
  model: string;
  prompt_name: string | null;
  prompt_version: string | null;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  created_at: string;
}

function aggregateRows(rows: RawRow[]): AiUsageResult {
  const buckets = new Map<string, DailyUsageRow>();
  const totals: UsageTotals = { callCount: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };

  for (const row of rows) {
    const date = row.created_at.slice(0, 10); // YYYY-MM-DD
    const key = `${date}|${row.model}|${row.prompt_name ?? ''}|${row.prompt_version ?? ''}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        date,
        model: row.model,
        promptName: row.prompt_name,
        promptVersion: row.prompt_version,
        callCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
      };
      buckets.set(key, bucket);
    }

    bucket.callCount += 1;
    bucket.inputTokens += row.input_tokens;
    bucket.outputTokens += row.output_tokens;
    bucket.estimatedCostUsd += Number(row.estimated_cost_usd);

    totals.callCount += 1;
    totals.inputTokens += row.input_tokens;
    totals.outputTokens += row.output_tokens;
    totals.estimatedCostUsd += Number(row.estimated_cost_usd);
  }

  // Round costs to 6 decimal places
  totals.estimatedCostUsd = Math.round(totals.estimatedCostUsd * 1_000_000) / 1_000_000;
  for (const bucket of buckets.values()) {
    bucket.estimatedCostUsd = Math.round(bucket.estimatedCostUsd * 1_000_000) / 1_000_000;
  }

  const daily = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));

  return { daily, totals };
}
