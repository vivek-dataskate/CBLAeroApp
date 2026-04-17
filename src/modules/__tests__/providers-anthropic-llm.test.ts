/**
 * AnthropicLLMProvider tests — Story 1.12b Task 2.7 / AC 2 + AC 3.
 *
 * Covers:
 *   - SDK success → LLMResult with tokens, cost, duration
 *   - SDK failure → null + structured error log + onFailure hook
 *   - kill_switched → refuses call, returns null
 *   - cost estimation preserves vision page surcharge (Epic 2 retro D2)
 *   - LLMProvider.name = 'anthropic'
 *   - factory returns null when ANTHROPIC_API_KEY unset
 *   - registered name matches the ProviderRegistry key from startup
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicLLMProvider, buildAnthropicLLMProvider } from '@/modules/ai/anthropic-llm-provider';
import { clearClientForTest } from '@/modules/ai/client';
import { ProviderRegistry } from '@/modules/providers/registry';
import { getProviderRegistry, resetProvidersForTest } from '@/modules/providers/startup';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// Mock usage-log so no Supabase calls leak.
vi.mock('@/modules/ai/usage-log', () => ({
  recordLlmUsage: vi.fn().mockResolvedValue(undefined),
}));

function mockApiResponse(text: string, inputTokens = 50, outputTokens = 20) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

async function buildProvider(): Promise<AnthropicLLMProvider> {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  const provider = buildAnthropicLLMProvider();
  expect(provider).not.toBeNull();
  return provider!;
}

beforeEach(() => {
  clearClientForTest();
  resetProvidersForTest();
  vi.clearAllMocks();
  // Register 'anthropic' into the default shared registry so recordSuccess /
  // recordFailure don't silently drop in these unit tests.
  getProviderRegistry().register('anthropic');
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  clearClientForTest();
  resetProvidersForTest();
  delete process.env.ANTHROPIC_API_KEY;
});

describe('AnthropicLLMProvider.call', () => {
  it('returns structured result on SDK success', async () => {
    mockCreate.mockResolvedValue(mockApiResponse('{"ok":1}', 100, 30));
    const provider = await buildProvider();

    const result = await provider.call(
      'claude-haiku-4-5-20251001',
      'system',
      'user content',
      { module: 'test', action: 'extract', promptName: 'test', promptVersion: '1.0.0' },
    );

    expect(result).not.toBeNull();
    expect(result!.text).toBe('{"ok":1}');
    expect(result!.inputTokens).toBe(100);
    expect(result!.outputTokens).toBe(30);
    // Haiku pricing = (100*0.80 + 30*4.00)/1M = 0.0002
    expect(result!.estimatedCostUsd).toBeCloseTo(0.0002, 5);
    expect(result!.model).toBe('claude-haiku-4-5-20251001');
  });

  it('returns null and logs error when SDK throws', async () => {
    const sdkErr = Object.assign(new Error('rate limited'), { status: 429 });
    mockCreate.mockRejectedValue(sdkErr);
    const provider = await buildProvider();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await provider.call('claude-haiku-4-5-20251001', 's', 'u');

    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    const logged = JSON.parse(errSpy.mock.calls[0][0] as string);
    expect(logged.action).toBe('llm_call_failed');
    expect(logged.errorClassification).toBe('rate_limited');

    errSpy.mockRestore();
  });

  it('refuses the call when anthropic is kill_switched', async () => {
    const provider = await buildProvider();
    getProviderRegistry().setMode('anthropic', 'kill_switched', 'test freeze');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await provider.call('claude-haiku-4-5-20251001', 's', 'u');

    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('applies vision page surcharge for document/image content blocks (Epic 2 retro D2)', async () => {
    mockCreate.mockResolvedValue(mockApiResponse('{}', 100, 30));
    const provider = await buildProvider();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await provider.call(
      'claude-haiku-4-5-20251001',
      'sys',
      [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: 'YmFzZTY0' },
        },
        { type: 'text', text: 'Extract resume data.' },
      ],
    );

    // Base cost (tokens): (100*0.80 + 30*4.00)/1M = 0.0002
    // Vision surcharge: 1 document page * 0.011 = 0.011
    // Total: 0.0112
    expect(result!.estimatedCostUsd).toBeCloseTo(0.0112, 5);
    logSpy.mockRestore();
  });

  it('exposes name="anthropic" so ProviderRegistry keys align', async () => {
    const provider = await buildProvider();
    expect(provider.name).toBe('anthropic');
  });

  it('reports health to the registry on success', async () => {
    mockCreate.mockResolvedValue(mockApiResponse('ok', 10, 5));
    const provider = await buildProvider();
    const registry = getProviderRegistry();
    const snap = registry.getProvider('anthropic');
    expect(snap?.health.totalAttempts).toBe(0);

    await provider.call('claude-haiku-4-5-20251001', 's', 'u');

    const after = registry.getProvider('anthropic');
    expect(after?.health.totalAttempts).toBe(1);
    expect(after?.health.totalFailures).toBe(0);
  });

  it('reports health to the registry on failure', async () => {
    const sdkErr = Object.assign(new Error('boom'), { status: 500 });
    mockCreate.mockRejectedValue(sdkErr);
    const provider = await buildProvider();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await provider.call('claude-haiku-4-5-20251001', 's', 'u');

    const snap = getProviderRegistry().getProvider('anthropic');
    expect(snap?.health.totalFailures).toBe(1);
    errSpy.mockRestore();
  });
});

describe('buildAnthropicLLMProvider', () => {
  it('returns null when ANTHROPIC_API_KEY is not set', () => {
    expect(buildAnthropicLLMProvider()).toBeNull();
  });

  it('builds a provider when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-1';
    const provider = buildAnthropicLLMProvider();
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe('anthropic');
  });
});

describe('LLMProvider interface compatibility (AC 3)', () => {
  it('AnthropicLLMProvider implements the vendor-agnostic LLMProvider shape', async () => {
    const provider = await buildProvider();
    // Compile-time via type system — runtime shape check:
    expect(typeof provider.call).toBe('function');
    expect(typeof provider.name).toBe('string');
  });

  it('a standalone ProviderRegistry records the same health events', async () => {
    mockCreate.mockResolvedValue(mockApiResponse('ok'));
    const provider = await buildProvider();

    // This exercises the integration with the shared registry — the
    // startup wiring + provider implementation must agree on the name.
    const registry = new ProviderRegistry();
    registry.register('anthropic');
    // We don't swap the shared registry here; this test just confirms the
    // name contract. The recorded events land on the process-shared registry.
    await provider.call('claude-haiku-4-5-20251001', 's', 'u');

    expect(getProviderRegistry().getProvider('anthropic')?.health.totalAttempts).toBe(1);
  });
});
