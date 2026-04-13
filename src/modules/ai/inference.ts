import Anthropic from '@anthropic-ai/sdk';
import { getSharedAnthropicClient } from './client';
import { recordLlmUsage } from './usage-log';

export interface CallLlmOptions {
  maxTokens?: number;
  /** Caller-provided module name for structured logs */
  module?: string;
  /** Caller-provided action name for structured logs */
  action?: string;
  /** Prompt name from registry (for log attribution) */
  promptName?: string;
  /** Prompt version from registry (for log attribution) */
  promptVersion?: string;
}

export interface CallLlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  inputChars: number;
  outputChars: number;
  durationMs: number;
  model: string;
  estimatedCostUsd: number;
}

// Per-million-token pricing (as of 2026-04 Anthropic pricing)
const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  'claude-haiku-4-5-20251001': { inputPerM: 0.80, outputPerM: 4.00 },
  'claude-sonnet-4-6': { inputPerM: 3.00, outputPerM: 15.00 },
};
const DEFAULT_PRICING = { inputPerM: 3.00, outputPerM: 15.00 };

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return (inputTokens * pricing.inputPerM + outputTokens * pricing.outputPerM) / 1_000_000;
}

/**
 * Centralized LLM call wrapper.
 * - Uses the shared Anthropic client singleton
 * - Logs structured metrics with token counts and estimated cost
 * - Persists usage to llm_usage_log (fire-and-forget)
 * - Catches API errors gracefully (returns null + logs)
 * - Returns null if no API key configured
 */
export async function callLlm(
  model: string,
  systemPrompt: string,
  userContent: string | Anthropic.Messages.ContentBlockParam[],
  opts: CallLlmOptions = {}
): Promise<CallLlmResult | null> {
  const client = getSharedAnthropicClient();
  if (!client) return null;

  const start = Date.now();
  const inputChars = typeof userContent === 'string'
    ? systemPrompt.length + userContent.length
    : systemPrompt.length; // multimodal — char count not meaningful for binary

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 2048,
      messages: [{ role: 'user', content: userContent }],
      system: systemPrompt,
    });
  } catch (err) {
    const durationMs = Date.now() - start;
    console.error(
      JSON.stringify({
        level: 'error',
        module: opts.module ?? 'ai',
        action: 'llm_call_failed',
        model,
        promptName: opts.promptName,
        promptVersion: opts.promptVersion,
        inputChars,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return null;
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  const durationMs = Date.now() - start;
  const outputChars = text.length;
  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;
  const estimatedCostUsd = estimateCost(model, inputTokens, outputTokens);

  // Structured metric log — every LLM call gets one
  console.log(
    JSON.stringify({
      level: 'info',
      module: opts.module ?? 'ai',
      action: opts.action ?? 'llm_call',
      model,
      promptName: opts.promptName,
      promptVersion: opts.promptVersion,
      inputTokens,
      outputTokens,
      inputChars,
      outputChars,
      durationMs,
      estimatedCostUsd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000, // 6 decimal places
    })
  );

  // Persist usage to DB (fire-and-forget — never block the caller)
  recordLlmUsage({
    model,
    promptName: opts.promptName ?? null,
    promptVersion: opts.promptVersion ?? null,
    module: opts.module ?? 'ai',
    action: opts.action ?? 'llm_call',
    inputTokens,
    outputTokens,
    durationMs,
    estimatedCostUsd,
  }).catch((err) => {
    console.warn('[ai/usage-log] Failed to persist usage:', err instanceof Error ? err.message : err);
  });

  // Anomaly detection: warn if output looks like a leaked system prompt or injection echo
  if (/system prompt|<\|im_start\|>|^\s*you are a\b/i.test(text)) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        module: opts.module ?? 'ai',
        action: 'anomaly_prompt_echo',
        model,
        outputSnippet: text.slice(0, 100),
      })
    );
  }

  return { text, inputTokens, outputTokens, inputChars, outputChars, durationMs, model, estimatedCostUsd };
}
