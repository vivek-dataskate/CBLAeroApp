import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSharedAnthropicClient, clearClientForTest } from '../ai/client';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({ _mocked: true })),
}));

describe('ai/client', () => {
  beforeEach(() => {
    clearClientForTest();
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    clearClientForTest();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns null when ANTHROPIC_API_KEY is not set', () => {
    expect(getSharedAnthropicClient()).toBeNull();
  });

  it('returns Anthropic client when API key is set', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const client = getSharedAnthropicClient();
    expect(client).not.toBeNull();
  });

  it('returns same singleton instance on repeated calls', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const a = getSharedAnthropicClient();
    const b = getSharedAnthropicClient();
    expect(a).toBe(b);
  });

  it('clearClientForTest resets singleton', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const a = getSharedAnthropicClient();
    clearClientForTest();
    const b = getSharedAnthropicClient();
    expect(a).not.toBe(b);
  });
});
