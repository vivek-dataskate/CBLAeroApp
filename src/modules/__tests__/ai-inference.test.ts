import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callLlm } from '../ai/inference';
import { clearClientForTest } from '../ai/client';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// Mock usage-log to avoid Supabase calls in tests
vi.mock('../ai/usage-log', () => ({
  recordLlmUsage: vi.fn().mockResolvedValue(undefined),
}));

function mockApiResponse(text: string, inputTokens = 50, outputTokens = 20) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

describe('ai/inference — callLlm', () => {
  beforeEach(() => {
    clearClientForTest();
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    clearClientForTest();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns null when no API key configured', async () => {
    const result = await callLlm('claude-haiku-4-5-20251001', 'system', 'user');
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('calls Anthropic API and returns structured result with tokens and cost', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockCreate.mockResolvedValue(mockApiResponse('{"firstName":"John"}', 100, 30));

    const result = await callLlm('claude-haiku-4-5-20251001', 'Extract data', 'John Doe resume', {
      module: 'test',
      action: 'extract',
      promptName: 'test-prompt',
      promptVersion: '1.0.0',
    });

    expect(result).not.toBeNull();
    expect(result!.text).toBe('{"firstName":"John"}');
    expect(result!.model).toBe('claude-haiku-4-5-20251001');
    expect(result!.inputTokens).toBe(100);
    expect(result!.outputTokens).toBe(30);
    expect(result!.inputChars).toBe('Extract data'.length + 'John Doe resume'.length);
    expect(result!.outputChars).toBe('{"firstName":"John"}'.length);
    expect(result!.durationMs).toBeGreaterThanOrEqual(0);
    // Haiku pricing: (100 * 0.80 + 30 * 4.00) / 1M = 0.00020
    expect(result!.estimatedCostUsd).toBeCloseTo(0.0002, 5);

    expect(mockCreate).toHaveBeenCalledWith({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: 'John Doe resume' }],
      system: 'Extract data',
    });
  });

  it('uses custom maxTokens from options', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockCreate.mockResolvedValue(mockApiResponse('ok'));

    await callLlm('claude-haiku-4-5-20251001', 'sys', 'usr', { maxTokens: 512 });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 512 })
    );
  });

  it('logs structured metrics with token counts', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockCreate.mockResolvedValue(mockApiResponse('response', 80, 15));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await callLlm('claude-haiku-4-5-20251001', 'sys', 'usr', {
      module: 'test-mod',
      action: 'test-act',
      promptName: 'pname',
      promptVersion: '2.0',
    });

    expect(logSpy).toHaveBeenCalled();
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged.level).toBe('info');
    expect(logged.module).toBe('test-mod');
    expect(logged.action).toBe('test-act');
    expect(logged.model).toBe('claude-haiku-4-5-20251001');
    expect(logged.promptName).toBe('pname');
    expect(logged.promptVersion).toBe('2.0');
    expect(logged.inputTokens).toBe(80);
    expect(logged.outputTokens).toBe(15);
    expect(typeof logged.estimatedCostUsd).toBe('number');
    expect(typeof logged.durationMs).toBe('number');

    logSpy.mockRestore();
  });

  it('persists usage via recordLlmUsage', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockCreate.mockResolvedValue(mockApiResponse('data', 200, 50));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { recordLlmUsage } = await import('../ai/usage-log');

    await callLlm('claude-haiku-4-5-20251001', 'sys', 'usr', {
      module: 'extraction',
      action: 'extract',
      promptName: 'candidate-extraction',
      promptVersion: '1.0.0',
    });

    expect(recordLlmUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5-20251001',
        promptName: 'candidate-extraction',
        promptVersion: '1.0.0',
        module: 'extraction',
        inputTokens: 200,
        outputTokens: 50,
      })
    );

    logSpy.mockRestore();
  });

  it('returns null and logs error when API call throws', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockCreate.mockRejectedValue(new Error('rate limited'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await callLlm('claude-haiku-4-5-20251001', 'sys', 'usr', {
      module: 'test',
      promptName: 'p',
    });

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(logged.level).toBe('error');
    expect(logged.action).toBe('llm_call_failed');
    expect(logged.error).toBe('rate limited');

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('warns on prompt-echo anomaly in LLM output', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockCreate.mockResolvedValue(mockApiResponse('You are a helpful assistant who...'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await callLlm('claude-haiku-4-5-20251001', 'sys', 'usr');

    expect(warnSpy).toHaveBeenCalled();
    const warned = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(warned.action).toBe('anomaly_prompt_echo');

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
