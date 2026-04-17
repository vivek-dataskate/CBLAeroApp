/**
 * LLM provider interface — Story 1.12b Task 2.1
 *
 * Vendor-agnostic contract every LLM adapter implements so `callLlm()` can
 * switch between Anthropic, OpenAI, Vertex, etc. with zero caller changes.
 * The concrete adapter decides how to call its vendor's SDK/API and how to
 * report health; this file only defines the shape.
 *
 * Architecture ref: architecture.md §25 — LLM swap procedure.
 */
import type Anthropic from '@anthropic-ai/sdk';

/**
 * Content shape accepted by `LLMProvider.call()`. Either a plain string
 * prompt or an array of multi-modal blocks (text + PDF document + image).
 *
 * We currently re-export Anthropic's `ContentBlockParam` as the block shape
 * because:
 *   1. every existing caller in this codebase constructs blocks using the
 *      Anthropic SDK types, and
 *   2. OpenAI / Vertex adapters will convert this generic representation
 *      into their own content format inside their provider.
 *
 * If a non-Anthropic adapter needs a richer block, migrate this type to a
 * project-defined `LLMContentBlock` union at that time.
 */
export type LLMContentBlock = Anthropic.Messages.ContentBlockParam;
export type LLMContent = string | LLMContentBlock[];

export interface LLMCallOptions {
  maxTokens?: number;
  /** Caller-provided module name for structured logs. */
  module?: string;
  /** Caller-provided action name for structured logs. */
  action?: string;
  /** Prompt name from registry (for log attribution). */
  promptName?: string;
  /** Prompt version from registry (for log attribution). */
  promptVersion?: string;
}

export interface LLMResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  inputChars: number;
  outputChars: number;
  durationMs: number;
  model: string;
  estimatedCostUsd: number;
}

/**
 * Vendor-agnostic LLM interface. `call()` returns `null` when the provider is
 * unavailable (no API key / kill_switched / SDK error) rather than throwing —
 * matches the legacy `callLlm()` contract so callers can treat "LLM unavailable"
 * as a graceful degradation path instead of a crash.
 */
export interface LLMProvider {
  /** Provider identity — matches the key in `ProviderRegistry`. */
  readonly name: string;

  call(
    model: string,
    systemPrompt: string,
    userContent: LLMContent,
    opts?: LLMCallOptions,
  ): Promise<LLMResult | null>;
}
