import type {
  ProviderMode,
  ProviderHealthEvent,
  RegisteredProvider,
  ErrorClassification,
} from './types';
import { HealthTracker } from './health-tracker';
import { BaseProviderClient } from './base-client';

/** Minimum non-auth attempts in the window before auto-kill-switch can fire. */
const KILL_SWITCH_MIN_ATTEMPTS = 50;
/** Error rate threshold for auto-kill-switch (non-auth failures only). */
const KILL_SWITCH_ERROR_RATE = 0.8;
/** Error rate threshold for auto-degrade. */
const DEGRADE_ERROR_RATE = 0.3;
/** Minimum attempts for auto-degrade evaluation. */
const DEGRADE_MIN_ATTEMPTS = 10;
/**
 * Error rate below which a degraded provider auto-recovers to normal.
 * Set well below DEGRADE_ERROR_RATE to avoid flapping around the boundary.
 */
const RECOVER_ERROR_RATE = 0.1;
/** Minimum attempts required before auto-recovery evaluates. */
const RECOVER_MIN_ATTEMPTS = 10;

/**
 * Central registry for all providers. Tracks health, manages kill-switch state,
 * and emits structured transition events.
 *
 * Architecture ref: architecture.md §19, §25
 *
 * **Auto transitions:**
 *   - normal → degraded:       ≥30% error rate with ≥10 non-auth attempts
 *   - degraded → normal:       ≤10% error rate with ≥10 non-auth attempts (Patch 7)
 *   - any → kill_switched:     ≥80% error rate with ≥50 non-auth attempts
 *   - kill_switched → normal:  ONLY via manual setMode() (no auto-failback)
 *
 * **Auth failures** (401/403, OAuth refresh failures) are excluded from kill-switch
 * math because they indicate a credential problem, not a provider outage (Patch 3).
 */
export class ProviderRegistry {
  private readonly providers = new Map<
    string,
    {
      mode: ProviderMode;
      tracker: HealthTracker;
      registeredAtIso: string;
    }
  >();

  public onHealthEvent: (event: ProviderHealthEvent) => void = () => {};

  register(name: string, client?: BaseProviderClient): void {
    const tracker = new HealthTracker();
    this.providers.set(name, {
      mode: 'normal',
      tracker,
      registeredAtIso: new Date().toISOString(),
    });

    if (client) {
      this.wireClient(name, client);
    }
  }

  /**
   * Wire health hooks into a BaseProviderClient.
   * Forwards the ErrorClassification so auth failures don't count toward kill-switch.
   */
  wireClient(name: string, client: BaseProviderClient): void {
    client.onSuccess = (durationMs) => this.recordSuccess(name, durationMs);
    client.onFailure = (durationMs, classification) =>
      this.recordFailure(name, durationMs, classification);
  }

  /**
   * Record a successful call. Re-evaluates health transitions:
   * - a success can still trigger auto-kill-switch if the window already holds
   *   ≥50 non-auth attempts at ≥80% error rate (by design)
   * - a success can trigger auto-recovery degraded → normal
   */
  recordSuccess(name: string, durationMs: number): void {
    const entry = this.providers.get(name);
    if (!entry) return;
    entry.tracker.recordSuccess(durationMs);
    this.evaluateTransitions(name);
  }

  /**
   * Record a failed call. Accepts the ErrorClassification so auth failures
   * can be excluded from kill-switch math.
   */
  recordFailure(
    name: string,
    durationMs: number,
    classification: ErrorClassification = 'transient',
  ): void {
    const entry = this.providers.get(name);
    if (!entry) return;
    entry.tracker.recordFailure(durationMs, classification);
    this.evaluateTransitions(name);
  }

  getMode(name: string): ProviderMode | null {
    return this.providers.get(name)?.mode ?? null;
  }

  getProvider(name: string): RegisteredProvider | null {
    const entry = this.providers.get(name);
    if (!entry) return null;
    return {
      name,
      mode: entry.mode,
      health: entry.tracker.snapshot(),
      registeredAtIso: entry.registeredAtIso,
    };
  }

  listProviders(): RegisteredProvider[] {
    return Array.from(this.providers.entries()).map(([name, entry]) => ({
      name,
      mode: entry.mode,
      health: entry.tracker.snapshot(),
      registeredAtIso: entry.registeredAtIso,
    }));
  }

  /**
   * Manual mode transition. Required for failback: kill_switched → normal.
   * Validates the mode string at runtime since types evaporate at API boundaries.
   */
  setMode(name: string, newMode: ProviderMode, reason: string): boolean {
    const entry = this.providers.get(name);
    if (!entry) return false;

    if (!isValidMode(newMode)) {
      throw new Error(`ProviderRegistry.setMode: invalid mode "${String(newMode)}" for provider "${name}"`);
    }
    if (!reason || reason.trim().length === 0) {
      throw new Error(`ProviderRegistry.setMode: reason is required for provider "${name}"`);
    }

    const previousMode = entry.mode;
    if (previousMode === newMode) return true;

    entry.mode = newMode;
    this.emitTransition(name, previousMode, newMode, reason);
    return true;
  }

  isAvailable(name: string): boolean {
    const mode = this.getMode(name);
    return mode !== null && mode !== 'kill_switched';
  }

  clearForTest(): void {
    this.providers.clear();
  }

  /* ---------------------------------------------------------------- */
  /*  Internal                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Evaluate all auto-transitions for this provider.
   * Order: kill-switch check first (worst state), then degrade/recover.
   * Kill-switched providers never auto-transition out (manual only).
   */
  private evaluateTransitions(name: string): void {
    const entry = this.providers.get(name);
    if (!entry || entry.mode === 'kill_switched') return;

    const snap = entry.tracker.snapshot();
    const nonAuthAttempts = entry.tracker.nonAuthAttemptCount();

    // Kill-switch: >=80% error rate AND >=50 non-auth attempts
    if (nonAuthAttempts >= KILL_SWITCH_MIN_ATTEMPTS && snap.errorRate >= KILL_SWITCH_ERROR_RATE) {
      const previousMode = entry.mode;
      entry.mode = 'kill_switched';
      this.emitTransition(
        name,
        previousMode,
        'kill_switched',
        `Auto kill-switch: ${(snap.errorRate * 100).toFixed(1)}% error rate over ${nonAuthAttempts} non-auth attempts`,
      );
      return;
    }

    // Auto-degrade: normal → degraded at >=30% error rate
    if (entry.mode === 'normal' && nonAuthAttempts >= DEGRADE_MIN_ATTEMPTS && snap.errorRate >= DEGRADE_ERROR_RATE) {
      entry.mode = 'degraded';
      this.emitTransition(
        name,
        'normal',
        'degraded',
        `Auto degraded: ${(snap.errorRate * 100).toFixed(1)}% error rate over ${nonAuthAttempts} non-auth attempts`,
      );
      return;
    }

    // Auto-recover: degraded → normal at <=10% error rate (Patch 7)
    if (entry.mode === 'degraded' && nonAuthAttempts >= RECOVER_MIN_ATTEMPTS && snap.errorRate <= RECOVER_ERROR_RATE) {
      entry.mode = 'normal';
      this.emitTransition(
        name,
        'degraded',
        'normal',
        `Auto recovered: ${(snap.errorRate * 100).toFixed(1)}% error rate over ${nonAuthAttempts} non-auth attempts`,
      );
    }
  }

  private emitTransition(
    provider: string,
    previousMode: ProviderMode,
    newMode: ProviderMode,
    reason: string,
  ): void {
    const snap = this.providers.get(provider)?.tracker.snapshot();
    this.onHealthEvent({
      provider,
      previousMode,
      newMode,
      reason,
      errorRate: snap?.errorRate ?? 0,
      attemptCount: snap?.totalAttempts ?? 0,
      occurredAtIso: new Date().toISOString(),
    });
  }
}

const VALID_MODES: ReadonlyArray<ProviderMode> = ['normal', 'degraded', 'kill_switched'];
function isValidMode(value: unknown): value is ProviderMode {
  return typeof value === 'string' && (VALID_MODES as readonly string[]).includes(value);
}
