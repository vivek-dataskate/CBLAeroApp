/**
 * Centralized LLM call wrapper.
 *
 * Story 1.12b: the vendor-specific HTTP, cost, logging, and health paths
 * moved into `AnthropicLLMProvider`. `callLlm()` is now a thin adapter that
 * pulls the current `LLMProvider` from the factory and delegates to it —
 * swapping Anthropic → OpenAI later requires a new provider class and env
 * var, with ZERO caller changes.
 *
 * The public signature, return type, and null-on-unavailable semantics are
 * unchanged. Callers (resume extraction, role deduction, scoring) see no
 * difference.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { getLLMProvider } from './llm-factory';
import type { LLMCallOptions, LLMResult } from './llm-provider';

// Re-export the legacy-named options and result types so callers that import
// from `inference.ts` keep compiling without a rename sweep.
export type CallLlmOptions = LLMCallOptions;
export type CallLlmResult = LLMResult;

/**
 * Invoke the active LLM provider. Returns `null` when:
 *   - no vendor is configured (`ANTHROPIC_API_KEY` unset), or
 *   - the provider is kill-switched via `ProviderRegistry`, or
 *   - the underlying SDK call errored (error is logged; caller handles null).
 */
export async function callLlm(
  model: string,
  systemPrompt: string,
  userContent: string | Anthropic.Messages.ContentBlockParam[],
  opts: CallLlmOptions = {}
): Promise<CallLlmResult | null> {
  const provider = getLLMProvider();
  if (!provider) return null;
  return provider.call(model, systemPrompt, userContent, opts);
}
