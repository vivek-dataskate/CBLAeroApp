import { isSupabaseConfigured, getSupabaseAdminClient } from '../persistence';
import { maybeCheckBudgetProactive } from './budget-alert';

export interface LlmUsageEntry {
  model: string;
  promptName: string | null;
  promptVersion: string | null;
  module: string;
  action: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  estimatedCostUsd: number;
}

/**
 * Persist a single LLM usage record to the llm_usage_log table.
 * Fire-and-forget — callers should `.catch()` to avoid unhandled rejections.
 * No-op when Supabase is not configured (tests, local dev without DB).
 */
export async function recordLlmUsage(entry: LlmUsageEntry): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const db = getSupabaseAdminClient();
  const { error } = await db.from('llm_usage_log').insert({
    model: entry.model,
    prompt_name: entry.promptName,
    prompt_version: entry.promptVersion,
    module: entry.module,
    action: entry.action,
    input_tokens: entry.inputTokens,
    output_tokens: entry.outputTokens,
    duration_ms: entry.durationMs,
    estimated_cost_usd: entry.estimatedCostUsd,
  });

  if (error) {
    console.warn('[ai/usage-log] Insert failed:', error.message);
  }

  // Proactive budget check — sampled every N calls to avoid per-call overhead
  maybeCheckBudgetProactive().catch((err) => {
    console.warn('[ai/usage-log] Budget check failed:', err instanceof Error ? err.message : err);
  });
}
