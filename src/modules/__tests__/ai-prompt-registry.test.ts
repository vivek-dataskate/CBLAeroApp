import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadPrompt,
  registerFallbackPrompt,
  clearFallbackPromptsForTest,
} from '../ai/prompt-registry';

// No Supabase configured in test env → all loads use fallback

describe('ai/prompt-registry', () => {
  beforeEach(() => {
    clearFallbackPromptsForTest();
  });

  it('returns null for unregistered prompt name', async () => {
    const result = await loadPrompt('nonexistent');
    expect(result).toBeNull();
  });

  it('returns fallback prompt after registration', async () => {
    registerFallbackPrompt({
      name: 'test-prompt',
      version: '1.0.0',
      prompt_text: 'You are a test assistant.',
      model: 'claude-haiku-4-5-20251001',
    });

    const result = await loadPrompt('test-prompt');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test-prompt');
    expect(result!.version).toBe('1.0.0');
    expect(result!.prompt_text).toBe('You are a test assistant.');
    expect(result!.model).toBe('claude-haiku-4-5-20251001');
  });

  it('overwrites fallback when re-registered with same name', async () => {
    registerFallbackPrompt({
      name: 'evolving',
      version: '1.0.0',
      prompt_text: 'v1',
      model: 'claude-haiku-4-5-20251001',
    });
    registerFallbackPrompt({
      name: 'evolving',
      version: '2.0.0',
      prompt_text: 'v2',
      model: 'claude-haiku-4-5-20251001',
    });

    const result = await loadPrompt('evolving');
    expect(result!.version).toBe('2.0.0');
    expect(result!.prompt_text).toBe('v2');
  });

  it('clearFallbackPromptsForTest removes all fallbacks', async () => {
    registerFallbackPrompt({
      name: 'temp',
      version: '1.0.0',
      prompt_text: 'temporary',
      model: 'claude-haiku-4-5-20251001',
    });
    clearFallbackPromptsForTest();

    const result = await loadPrompt('temp');
    expect(result).toBeNull();
  });
});
