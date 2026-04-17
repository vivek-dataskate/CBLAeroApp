/**
 * LLM provider factory — Story 1.12b Task 2.4
 *
 * Picks the right `LLMProvider` implementation based on env configuration.
 * Callers of `callLlm()` never construct providers themselves; this factory
 * is the only place that knows which vendor is active.
 *
 * Priority (first match wins):
 *   1. `ANTHROPIC_API_KEY` → `AnthropicLLMProvider`
 *   2. (future) `OPENAI_API_KEY` → `OpenAILLMProvider`
 *
 * Returns `null` when no LLM vendor is configured — `callLlm()` callers see
 * the legacy "no key → null result" behavior unchanged.
 */
import type { LLMProvider } from './llm-provider';
import { buildAnthropicLLMProvider } from './anthropic-llm-provider';

let sharedProvider: LLMProvider | null | undefined = undefined;

/**
 * Return the active LLM provider for this process.
 *   `undefined` → not yet tried (first access builds from env).
 *   `null` → no vendor configured (callers handle gracefully).
 */
export function getLLMProvider(): LLMProvider | null {
  if (sharedProvider === undefined) {
    sharedProvider = buildAnthropicLLMProvider() ?? null;
  }
  return sharedProvider;
}

/** Inject a pre-built provider — used by tests and startup wiring. */
export function setLLMProvider(provider: LLMProvider | null): void {
  sharedProvider = provider;
}

/**
 * Initialize-once setter for startup wiring — ONLY writes if no provider
 * has been explicitly set yet. Tests that inject a mock via `setLLMProvider`
 * before running `ensureProvidersInitialized` keep their mock; production
 * first-boot always takes the build path.
 *
 * Review patch E7: the unconditional `setLLMProvider(anthropicProvider)`
 * in `startup.ts` used to clobber test-injected mocks when a job's
 * `run()` called `ensureProvidersInitialized()` internally.
 */
export function initializeLLMProviderFromStartup(provider: LLMProvider | null): void {
  if (sharedProvider !== undefined) return;
  sharedProvider = provider;
}

export function resetLLMProviderForTest(): void {
  sharedProvider = undefined;
}
