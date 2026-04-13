import { beforeEach, describe, expect, it } from 'vitest';
import {
  getAggregatedUsage,
  seedUsageLogForTest,
  clearUsageLogForTest,
} from '../usage-repository';

describe('getAggregatedUsage', () => {
  beforeEach(() => {
    clearUsageLogForTest();
  });

  it('returns empty result when no records exist', async () => {
    const result = await getAggregatedUsage({ days: 7 });
    expect(result.daily).toEqual([]);
    expect(result.totals).toEqual({
      callCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    });
  });

  it('aggregates records by day, model, and prompt name', async () => {
    const today = new Date().toISOString().slice(0, 10);

    seedUsageLogForTest({
      model: 'claude-haiku-4-5-20251001',
      prompt_name: 'candidate-extraction',
      prompt_version: '1.0.0',
      module: 'extraction',
      action: 'extract',
      input_tokens: 500,
      output_tokens: 200,
      duration_ms: 1000,
      estimated_cost_usd: 0.001,
      created_at: `${today}T10:00:00.000Z`,
    });
    seedUsageLogForTest({
      model: 'claude-haiku-4-5-20251001',
      prompt_name: 'candidate-extraction',
      prompt_version: '1.0.0',
      module: 'extraction',
      action: 'extract',
      input_tokens: 600,
      output_tokens: 300,
      duration_ms: 1200,
      estimated_cost_usd: 0.0015,
      created_at: `${today}T11:00:00.000Z`,
    });

    const result = await getAggregatedUsage({ days: 1 });

    expect(result.daily).toHaveLength(1);
    expect(result.daily[0].callCount).toBe(2);
    expect(result.daily[0].inputTokens).toBe(1100);
    expect(result.daily[0].outputTokens).toBe(500);
    expect(result.daily[0].model).toBe('claude-haiku-4-5-20251001');
    expect(result.daily[0].promptName).toBe('candidate-extraction');
    expect(result.totals.callCount).toBe(2);
  });

  it('separates groups by model', async () => {
    const today = new Date().toISOString().slice(0, 10);

    seedUsageLogForTest({
      model: 'claude-haiku-4-5-20251001',
      prompt_name: 'extraction',
      prompt_version: '1.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 100,
      output_tokens: 50,
      duration_ms: 500,
      estimated_cost_usd: 0.001,
      created_at: `${today}T10:00:00.000Z`,
    });
    seedUsageLogForTest({
      model: 'claude-sonnet-4-6',
      prompt_name: 'extraction',
      prompt_version: '1.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 100,
      output_tokens: 50,
      duration_ms: 500,
      estimated_cost_usd: 0.002,
      created_at: `${today}T11:00:00.000Z`,
    });

    const result = await getAggregatedUsage({ days: 1 });
    expect(result.daily).toHaveLength(2);
    expect(result.totals.callCount).toBe(2);
  });

  it('filters by model parameter', async () => {
    const today = new Date().toISOString().slice(0, 10);

    seedUsageLogForTest({
      model: 'claude-haiku-4-5-20251001',
      prompt_name: 'test',
      prompt_version: '1.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 100,
      output_tokens: 50,
      duration_ms: 500,
      estimated_cost_usd: 0.001,
      created_at: `${today}T10:00:00.000Z`,
    });
    seedUsageLogForTest({
      model: 'claude-sonnet-4-6',
      prompt_name: 'test',
      prompt_version: '1.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 200,
      output_tokens: 100,
      duration_ms: 1000,
      estimated_cost_usd: 0.002,
      created_at: `${today}T11:00:00.000Z`,
    });

    const result = await getAggregatedUsage({ days: 1, model: 'claude-haiku-4-5-20251001' });
    expect(result.daily).toHaveLength(1);
    expect(result.daily[0].model).toBe('claude-haiku-4-5-20251001');
    expect(result.totals.callCount).toBe(1);
  });

  it('filters by promptName parameter', async () => {
    const today = new Date().toISOString().slice(0, 10);

    seedUsageLogForTest({
      model: 'claude-haiku-4-5-20251001',
      prompt_name: 'candidate-extraction',
      prompt_version: '1.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 100,
      output_tokens: 50,
      duration_ms: 500,
      estimated_cost_usd: 0.001,
      created_at: `${today}T10:00:00.000Z`,
    });
    seedUsageLogForTest({
      model: 'claude-haiku-4-5-20251001',
      prompt_name: 'classification',
      prompt_version: '1.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 200,
      output_tokens: 100,
      duration_ms: 1000,
      estimated_cost_usd: 0.002,
      created_at: `${today}T11:00:00.000Z`,
    });

    const result = await getAggregatedUsage({ days: 1, promptName: 'candidate-extraction' });
    expect(result.daily).toHaveLength(1);
    expect(result.daily[0].promptName).toBe('candidate-extraction');
  });

  it('excludes records outside the days window', async () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);

    seedUsageLogForTest({
      model: 'claude-haiku-4-5-20251001',
      prompt_name: 'test',
      prompt_version: '1.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 100,
      output_tokens: 50,
      duration_ms: 500,
      estimated_cost_usd: 0.001,
      created_at: oldDate.toISOString(),
    });

    const result = await getAggregatedUsage({ days: 7 });
    expect(result.daily).toHaveLength(0);
    expect(result.totals.callCount).toBe(0);
  });

  it('defaults to 7 days when not specified', async () => {
    const today = new Date().toISOString().slice(0, 10);

    seedUsageLogForTest({
      model: 'claude-haiku-4-5-20251001',
      prompt_name: 'test',
      prompt_version: '1.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 100,
      output_tokens: 50,
      duration_ms: 500,
      estimated_cost_usd: 0.001,
      created_at: `${today}T10:00:00.000Z`,
    });

    const result = await getAggregatedUsage({});
    expect(result.daily).toHaveLength(1);
    expect(result.totals.callCount).toBe(1);
  });

  it('separates groups by prompt_version for side-by-side comparison', async () => {
    const today = new Date().toISOString().slice(0, 10);

    seedUsageLogForTest({
      model: 'claude-haiku-4-5-20251001',
      prompt_name: 'candidate-extraction',
      prompt_version: '1.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 500,
      output_tokens: 200,
      duration_ms: 1000,
      estimated_cost_usd: 0.001,
      created_at: `${today}T10:00:00.000Z`,
    });
    seedUsageLogForTest({
      model: 'claude-haiku-4-5-20251001',
      prompt_name: 'candidate-extraction',
      prompt_version: '2.0.0',
      module: 'test',
      action: 'test',
      input_tokens: 600,
      output_tokens: 300,
      duration_ms: 1200,
      estimated_cost_usd: 0.0015,
      created_at: `${today}T11:00:00.000Z`,
    });

    const result = await getAggregatedUsage({ days: 1 });

    // Two groups: same model+prompt_name but different versions
    expect(result.daily).toHaveLength(2);
    const v1 = result.daily.find((r) => r.promptVersion === '1.0.0');
    const v2 = result.daily.find((r) => r.promptVersion === '2.0.0');
    expect(v1).toBeDefined();
    expect(v2).toBeDefined();
    expect(v1!.callCount).toBe(1);
    expect(v2!.callCount).toBe(1);
    expect(v1!.inputTokens).toBe(500);
    expect(v2!.inputTokens).toBe(600);
    expect(result.totals.callCount).toBe(2);
  });
});
