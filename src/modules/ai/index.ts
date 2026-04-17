export { getSharedAnthropicClient, clearClientForTest } from './client';
export { loadPrompt, registerFallbackPrompt, clearFallbackPromptsForTest, deprecatePrompt, updatePromptStatus, listPromptVersions } from './prompt-registry';
export type { PromptRecord, PromptStatus } from './prompt-registry';
export { callLlm } from './inference';
export type { CallLlmOptions, CallLlmResult } from './inference';
export { recordLlmUsage } from './usage-log';
export type { LlmUsageEntry } from './usage-log';
export { getAggregatedUsage, clearUsageLogForTest, seedUsageLogForTest } from './usage-repository';
export type { DailyUsageRow, UsageTotals, AiUsageResult } from './usage-repository';
export { checkBudgetThreshold, maybeCheckBudgetProactive, clearBudgetAlertForTest } from './budget-alert';

// Story 1.12b — LLM provider framework
export {
  getLLMProvider,
  setLLMProvider,
  initializeLLMProviderFromStartup,
  resetLLMProviderForTest,
} from './llm-factory';
export type {
  LLMProvider,
  LLMCallOptions,
  LLMContent,
  LLMContentBlock,
  LLMResult,
} from './llm-provider';
export {
  AnthropicLLMProvider,
  buildAnthropicLLMProvider,
} from './anthropic-llm-provider';
