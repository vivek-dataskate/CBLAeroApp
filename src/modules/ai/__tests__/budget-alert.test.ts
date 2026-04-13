import { beforeEach, describe, expect, it, vi } from 'vitest';
import { seedUsageLogForTest, clearUsageLogForTest } from '../usage-repository';
import { checkBudgetThreshold } from '../budget-alert';

describe('checkBudgetThreshold', () => {
  beforeEach(() => {
    clearUsageLogForTest();
  });

  it('returns exceeded=false when no usage exists', async () => {
    const result = await checkBudgetThreshold();
    expect(result.exceeded).toBe(false);
    expect(result.dailyCostUsd).toBe(0);
    expect(result.threshold).toBe(10);
  });

  it('returns exceeded=false when cost is below threshold', async () => {
    const today = new Date().toISOString().slice(0, 10);
    seedUsageLogForTest({
      model: 'claude-haiku-4-5-20251001',
      prompt_name: 'test',
      prompt_version: '1.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 1000,
      output_tokens: 500,
      duration_ms: 1000,
      estimated_cost_usd: 1.5,
      created_at: `${today}T10:00:00.000Z`,
    });

    const result = await checkBudgetThreshold();
    expect(result.exceeded).toBe(false);
    expect(result.dailyCostUsd).toBe(1.5);
  });

  it('returns exceeded=true and logs warning when cost exceeds threshold', async () => {
    const today = new Date().toISOString().slice(0, 10);
    seedUsageLogForTest({
      model: 'claude-sonnet-4-6',
      prompt_name: 'test',
      prompt_version: '1.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 100000,
      output_tokens: 50000,
      duration_ms: 5000,
      estimated_cost_usd: 12.5,
      created_at: `${today}T10:00:00.000Z`,
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await checkBudgetThreshold();
    expect(result.exceeded).toBe(true);
    expect(result.dailyCostUsd).toBe(12.5);
    expect(result.threshold).toBe(10);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logArg = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logArg.level).toBe('warn');
    expect(logArg.module).toBe('ai');
    expect(logArg.action).toBe('budget_alert');
    expect(logArg.dailyCostUsd).toBe(12.5);

    warnSpy.mockRestore();
  });

  it('uses custom threshold when provided', async () => {
    const today = new Date().toISOString().slice(0, 10);
    seedUsageLogForTest({
      model: 'claude-haiku-4-5-20251001',
      prompt_name: 'test',
      prompt_version: '1.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 5000,
      output_tokens: 2000,
      duration_ms: 1000,
      estimated_cost_usd: 3.0,
      created_at: `${today}T10:00:00.000Z`,
    });

    const result = await checkBudgetThreshold(2.0);
    expect(result.exceeded).toBe(true);
    expect(result.threshold).toBe(2);
  });

  it('ignores usage from previous days', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    seedUsageLogForTest({
      model: 'claude-sonnet-4-6',
      prompt_name: 'test',
      prompt_version: '1.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 100000,
      output_tokens: 50000,
      duration_ms: 5000,
      estimated_cost_usd: 50.0,
      created_at: `${yesterdayStr}T10:00:00.000Z`,
    });

    const result = await checkBudgetThreshold();
    expect(result.exceeded).toBe(false);
    expect(result.dailyCostUsd).toBe(0);
  });
});
