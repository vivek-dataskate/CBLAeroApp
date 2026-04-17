/**
 * Anthropic LLM adapter — Story 1.12b Tasks 2.2–2.4.
 *
 * Wraps the official `@anthropic-ai/sdk` client in the vendor-agnostic
 * `LLMProvider` interface. Preserves all behavior of the legacy `callLlm()`
 * wrapper (cost estimation, structured metric logs, usage-log persistence,
 * anomaly detection) so the public `callLlm()` API is unchanged.
 *
 * Why wrap the SDK instead of calling the REST API directly?
 *   - The SDK owns HTTP-level concerns (retries, streaming, MIME correctness).
 *   - Re-implementing those against `BaseProviderClient` buys us nothing in
 *     this story; the benefit is ProviderRegistry health integration which we
 *     can bolt on as success/failure hooks around each SDK call.
 *   - A future OpenAI adapter is a sibling class that implements the same
 *     interface — no caller changes needed.
 *
 * Health reporting: each successful SDK call records a synthetic duration
 * with the registry; SDK errors classify as `transient` unless the SDK
 * exposes a `status` (401/403 → auth_failure, 429 → rate_limited, 5xx →
 * transient, 4xx → permanent).
 */
import Anthropic from '@anthropic-ai/sdk';
import { getSharedAnthropicClient } from './client';
import { recordLlmUsage } from './usage-log';
import type {
  LLMProvider,
  LLMCallOptions,
  LLMContent,
  LLMResult,
} from './llm-provider';
import type { ErrorClassification } from '../providers/types';
import { getProviderRegistry } from '../providers/startup';

/** Anthropic pricing table (per million tokens, USD). */
const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  'claude-haiku-4-5-20251001': { inputPerM: 0.80, outputPerM: 4.00 },
  'claude-sonnet-4-6': { inputPerM: 3.00, outputPerM: 15.00 },
};
const DEFAULT_PRICING = { inputPerM: 3.00, outputPerM: 15.00 };

/**
 * Per-document-page surcharge for Anthropic vision / PDF content. See Epic 2
 * retro D2 — Anthropic bills PDF/image blocks at ~$0.015/page but reports
 * tokens at a lower count; the conservative surcharge adds margin.
 */
const VISION_PAGE_SURCHARGE_USD = 0.011;

function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  documentPageCount: number,
): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  const tokenCost = (inputTokens * pricing.inputPerM + outputTokens * pricing.outputPerM) / 1_000_000;
  const visionSurcharge = documentPageCount * VISION_PAGE_SURCHARGE_USD;
  return tokenCost + visionSurcharge;
}

function countDocumentPages(userContent: LLMContent): number {
  if (!Array.isArray(userContent)) return 0;
  return userContent.filter((block) => {
    const t = (block as { type?: unknown }).type;
    return t === 'document' || t === 'image';
  }).length;
}

/** Classify an Anthropic SDK error for `ProviderRegistry` health tracking. */
function classifySdkError(err: unknown): ErrorClassification {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === 'number') {
    if (status === 429) return 'rate_limited';
    if (status === 401 || status === 403) return 'auth_failure';
    if (status >= 500) return 'transient';
    return 'permanent';
  }
  return 'transient';
}

export class AnthropicLLMProvider implements LLMProvider {
  readonly name = 'anthropic';

  private readonly client: Anthropic;

  constructor(client: Anthropic) {
    this.client = client;
  }

  async call(
    model: string,
    systemPrompt: string,
    userContent: LLMContent,
    opts: LLMCallOptions = {},
  ): Promise<LLMResult | null> {
    const start = Date.now();
    const inputChars = typeof userContent === 'string'
      ? systemPrompt.length + userContent.length
      : systemPrompt.length; // multi-modal — char count not meaningful for binary

    // Refuse traffic when kill-switched. Observability + test hooks restore
    // normal mode; no caller changes needed.
    if (getProviderRegistry().getMode('anthropic') === 'kill_switched') {
      console.warn('[AnthropicLLMProvider] anthropic is kill_switched — refusing call');
      return null;
    }

    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model,
        max_tokens: opts.maxTokens ?? 2048,
        messages: [{ role: 'user', content: userContent as Anthropic.Messages.MessageParam['content'] }],
        system: systemPrompt,
      });
    } catch (err) {
      const durationMs = Date.now() - start;
      const classification = classifySdkError(err);
      getProviderRegistry().recordFailure(this.name, durationMs, classification);
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
          errorClassification: classification,
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
    const documentPageCount = countDocumentPages(userContent);
    const estimatedCostUsd = estimateCost(model, inputTokens, outputTokens, documentPageCount);

    // Report health — cost and tokens don't enter the decision, just latency.
    getProviderRegistry().recordSuccess(this.name, durationMs);

    // Structured metric log — every LLM call gets one (matches legacy format
    // byte-for-byte so existing log-based dashboards keep working).
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
        estimatedCostUsd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
      })
    );

    // Persist usage to DB (fire-and-forget — never block the caller).
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

    // Anomaly detection: warn if output looks like a leaked system prompt or
    // injection echo. Preserved from legacy callLlm.
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
}

/**
 * Build an `AnthropicLLMProvider` from the shared Anthropic client singleton.
 * Returns `null` when `ANTHROPIC_API_KEY` is not set so `callLlm()` callers
 * continue to see the legacy "no key → null result" degradation.
 */
export function buildAnthropicLLMProvider(): AnthropicLLMProvider | null {
  const client = getSharedAnthropicClient();
  if (!client) return null;
  return new AnthropicLLMProvider(client);
}
