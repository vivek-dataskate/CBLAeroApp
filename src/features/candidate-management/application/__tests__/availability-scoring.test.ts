import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the repository functions that computeAvailabilityState now calls
const mockGetRecentSelfReport = vi.fn();
const mockCountEngagementSignals = vi.fn();

vi.mock('../../infrastructure/availability-repository', () => ({
  getRecentSelfReport: (...args: unknown[]) => mockGetRecentSelfReport(...args),
  countEngagementSignals: (...args: unknown[]) => mockCountEngagementSignals(...args),
}));

const { isStaleSignal, computeAvailabilityState } = await import('../availability-scoring');

describe('isStaleSignal', () => {
  it('returns true for null signal', () => {
    expect(isStaleSignal(null)).toBe(true);
  });

  it('returns false for signal from 6 days ago', () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStaleSignal(sixDaysAgo)).toBe(false);
  });

  it('returns true for signal from 8 days ago', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStaleSignal(eightDaysAgo)).toBe(true);
  });

  it('returns false for signal from just now', () => {
    expect(isStaleSignal(new Date().toISOString())).toBe(false);
  });

  it('returns true for signal at exact 7-day boundary (>7 days)', () => {
    const exactBoundary = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 - 1000).toISOString();
    expect(isStaleSignal(exactBoundary)).toBe(true);
  });

  it('returns false for signal just under 7 days', () => {
    const justUnder = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 60000).toISOString();
    expect(isStaleSignal(justUnder)).toBe(false);
  });
});

describe('computeAvailabilityState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unavailable when no engagement and no self-report', async () => {
    mockGetRecentSelfReport.mockResolvedValue(null);
    mockCountEngagementSignals.mockResolvedValue(0);

    const result = await computeAvailabilityState('tenant1', 'candidate1');
    expect(result).toBe('unavailable');
  });

  it('returns active when fresh self-report says active', async () => {
    mockGetRecentSelfReport.mockResolvedValue({ newState: 'active' });

    const result = await computeAvailabilityState('tenant1', 'candidate1');
    expect(result).toBe('active');
    expect(mockCountEngagementSignals).not.toHaveBeenCalled();
  });

  it('returns passive when fresh self-report says passive', async () => {
    mockGetRecentSelfReport.mockResolvedValue({ newState: 'passive' });

    const result = await computeAvailabilityState('tenant1', 'candidate1');
    expect(result).toBe('passive');
  });

  it('returns unavailable when fresh self-report says unavailable', async () => {
    mockGetRecentSelfReport.mockResolvedValue({ newState: 'unavailable' });

    const result = await computeAvailabilityState('tenant1', 'candidate1');
    expect(result).toBe('unavailable');
  });

  it('returns passive when 1-2 engagement events and no fresh self-report', async () => {
    mockGetRecentSelfReport.mockResolvedValue(null);
    mockCountEngagementSignals.mockResolvedValue(2);

    const result = await computeAvailabilityState('tenant1', 'candidate1');
    expect(result).toBe('passive');
  });

  it('returns active when exactly 3 engagement events (boundary)', async () => {
    mockGetRecentSelfReport.mockResolvedValue(null);
    mockCountEngagementSignals.mockResolvedValue(3);

    const result = await computeAvailabilityState('tenant1', 'candidate1');
    expect(result).toBe('active');
  });

  it('returns active when 5+ engagement events and no fresh self-report', async () => {
    mockGetRecentSelfReport.mockResolvedValue(null);
    mockCountEngagementSignals.mockResolvedValue(5);

    const result = await computeAvailabilityState('tenant1', 'candidate1');
    expect(result).toBe('active');
  });

  it('returns passive when exactly 1 engagement event (boundary)', async () => {
    mockGetRecentSelfReport.mockResolvedValue(null);
    mockCountEngagementSignals.mockResolvedValue(1);

    const result = await computeAvailabilityState('tenant1', 'candidate1');
    expect(result).toBe('passive');
  });

  it('falls back to engagement count when no fresh self-report exists', async () => {
    // Stale self-report (null returned means no fresh one found)
    mockGetRecentSelfReport.mockResolvedValue(null);
    mockCountEngagementSignals.mockResolvedValue(4);

    const result = await computeAvailabilityState('tenant1', 'candidate1');
    expect(result).toBe('active');
    expect(mockCountEngagementSignals).toHaveBeenCalledOnce();
  });

  it('throws on self-report query error', async () => {
    mockGetRecentSelfReport.mockRejectedValue(new Error('DB connection failed'));

    await expect(computeAvailabilityState('tenant1', 'candidate1')).rejects.toThrow('DB connection failed');
  });

  it('throws on engagement count query error', async () => {
    mockGetRecentSelfReport.mockResolvedValue(null);
    mockCountEngagementSignals.mockRejectedValue(new Error('Timeout'));

    await expect(computeAvailabilityState('tenant1', 'candidate1')).rejects.toThrow('Timeout');
  });

  it('passes correct tenant and candidate IDs to repository', async () => {
    mockGetRecentSelfReport.mockResolvedValue(null);
    mockCountEngagementSignals.mockResolvedValue(0);

    await computeAvailabilityState('my-tenant', 'my-candidate');

    expect(mockGetRecentSelfReport).toHaveBeenCalledWith('my-tenant', 'my-candidate', expect.any(String));
    expect(mockCountEngagementSignals).toHaveBeenCalledWith('my-tenant', 'my-candidate', expect.any(String));
  });
});
