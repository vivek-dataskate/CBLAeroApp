/**
 * Admin alert sink tests — Story 1.12b AC 1 bullet 4 resolution.
 *
 * Covers:
 *   - `level: 'critical'` structured log always fires on alert-worthy transitions
 *   - `normal → normal` and similar non-events do NOT fire alerts
 *   - Admin email via Graph only fires when `CBL_PROVIDER_ALERT_EMAIL` is set
 *   - Graph kill-switch short-circuits the email path (can't email over a dead channel)
 *   - Email delivery failures are swallowed — critical log is the last line of defense
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitProviderAdminAlert } from '@/modules/providers/admin-alert';
import { setSharedGraphClient, resetSharedGraphClientForTest } from '@/modules/providers/graph';
import type { GraphProviderClient } from '@/modules/providers/graph';
import type { ProviderHealthEvent } from '@/modules/providers/types';

const event = (overrides: Partial<ProviderHealthEvent> = {}): ProviderHealthEvent => ({
  provider: 'graph',
  previousMode: 'normal',
  newMode: 'kill_switched',
  reason: 'Auto kill-switch: 95% error rate',
  errorRate: 0.95,
  attemptCount: 60,
  occurredAtIso: new Date().toISOString(),
  ...overrides,
});

let errSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetSharedGraphClientForTest();
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  delete process.env.CBL_PROVIDER_ALERT_EMAIL;
  delete process.env.CBL_PROVIDER_ALERT_SENDER;
  delete process.env.CBL_DIGEST_SENDER;
});

afterEach(() => {
  resetSharedGraphClientForTest();
  vi.restoreAllMocks();
});

describe('emitProviderAdminAlert — structured critical log', () => {
  it('emits a critical log on kill_switched transition', async () => {
    await emitProviderAdminAlert(event({ newMode: 'kill_switched' }));

    expect(errSpy).toHaveBeenCalled();
    const payload = JSON.parse(errSpy.mock.calls[0][0] as string);
    expect(payload.level).toBe('critical');
    expect(payload.action).toBe('provider_state_transition');
    expect(payload.provider).toBe('graph');
    expect(payload.newMode).toBe('kill_switched');
  });

  it('emits a critical log on degraded transition', async () => {
    await emitProviderAdminAlert(event({ newMode: 'degraded' }));
    expect(errSpy).toHaveBeenCalled();
    const payload = JSON.parse(errSpy.mock.calls[0][0] as string);
    expect(payload.newMode).toBe('degraded');
  });

  it('does NOT alert on normal recovery transitions', async () => {
    await emitProviderAdminAlert(event({
      previousMode: 'degraded',
      newMode: 'normal',
    }));
    expect(errSpy).not.toHaveBeenCalled();
  });
});

describe('emitProviderAdminAlert — admin email dispatch', () => {
  it('does not send email when CBL_PROVIDER_ALERT_EMAIL is unset', async () => {
    await emitProviderAdminAlert(event());
    // No graph.post calls possible — no graph client + no email config.
    expect(errSpy).toHaveBeenCalledTimes(1); // only the critical log
  });

  it('skips email dispatch when Graph itself is kill_switched', async () => {
    process.env.CBL_PROVIDER_ALERT_EMAIL = 'ops@cbl.aero';
    await emitProviderAdminAlert(event({ provider: 'graph', newMode: 'kill_switched' }));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Graph kill-switched — skipping email path'),
    );
  });

  it('attempts Graph sendMail for non-Graph providers when email is configured', async () => {
    process.env.CBL_PROVIDER_ALERT_EMAIL = 'ops@cbl.aero';
    const postMock = vi.fn().mockResolvedValue({ ok: true, status: 202, data: null, durationMs: 10, attempt: 1, errorClassification: null });
    setSharedGraphClient({ post: postMock } as unknown as GraphProviderClient);

    await emitProviderAdminAlert(event({ provider: 'anthropic' }));

    expect(postMock).toHaveBeenCalledWith(
      expect.stringContaining('/sendMail'),
      expect.objectContaining({
        message: expect.objectContaining({
          toRecipients: [{ emailAddress: { address: 'ops@cbl.aero' } }],
          subject: expect.stringContaining('anthropic'),
        }),
      }),
    );
  });

  it('swallows Graph sendMail failures — critical log is still in place', async () => {
    process.env.CBL_PROVIDER_ALERT_EMAIL = 'ops@cbl.aero';
    const postMock = vi.fn().mockRejectedValue(new Error('Graph 500'));
    setSharedGraphClient({ post: postMock } as unknown as GraphProviderClient);

    // Must not throw.
    await emitProviderAdminAlert(event({ provider: 'anthropic' }));

    expect(warnSpy).toHaveBeenCalledWith(
      '[provider-admin-alert] sendMail threw:',
      'Graph 500',
    );
  });
});
