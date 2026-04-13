import Anthropic from '@anthropic-ai/sdk';

let sharedClient: Anthropic | null = null;

/**
 * Returns the shared Anthropic client singleton.
 * Returns null if ANTHROPIC_API_KEY is not set.
 * Lazy-initialized on first call.
 */
export function getSharedAnthropicClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!sharedClient) {
    sharedClient = new Anthropic();
  }
  return sharedClient;
}

/** Reset singleton for test isolation. No-op outside test environment. */
export function clearClientForTest(): void {
  if (process.env.NODE_ENV !== 'test') return;
  sharedClient = null;
}
