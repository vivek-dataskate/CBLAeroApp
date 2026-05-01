/**
 * StubSmsProvider — Story 3-1 Task 3 / AC 8.
 *
 * Implements the `SmsProvider` capability interface with zero outbound
 * traffic: every call is recorded to a module-level in-memory log and
 * returns a deterministic `providerMessageId`. Story 3-1b will swap this
 * out for `TelnyxSmsProvider` without any caller-side changes.
 *
 * Health reporting: success/failure are reported directly to
 * `ProviderRegistry` — no `wireClient` needed since there is no HTTP
 * transport to wrap (mirrors `AnthropicLLMProvider`).
 */
import { createHash } from 'crypto';
import type {
  SmsProvider,
  SmsSendRequest,
  SmsSendResult,
} from '@/features/outreach-engagement/contracts/sms-provider';
import { getProviderRegistry } from '../startup';

export interface StubSmsLogEntry {
  to: string;
  body: string;
  idempotencyKey: string;
  costMeta?: Record<string, unknown>;
  providerMessageId: string;
  recordedAtIso: string;
}

const inMemoryLog: StubSmsLogEntry[] = [];

/** Test hook — read the captured call log. */
export function __getStubSmsLogForTest(): StubSmsLogEntry[] {
  return [...inMemoryLog];
}

/** Test hook — clear the captured call log between tests. */
export function __clearStubSmsLogForTest(): void {
  inMemoryLog.length = 0;
}

export class StubSmsProvider implements SmsProvider {
  readonly name = 'sms-stub';

  async send(req: SmsSendRequest): Promise<SmsSendResult> {
    const start = Date.now();
    try {
      if (!req.to) throw new Error('StubSmsProvider: to required');
      if (!req.body) throw new Error('StubSmsProvider: body required');
      if (!req.idempotencyKey) throw new Error('StubSmsProvider: idempotencyKey required');

      const providerMessageId = mintStubMessageId(req);
      const durationMs = Date.now() - start;

      inMemoryLog.push({
        to: req.to,
        body: req.body,
        idempotencyKey: req.idempotencyKey,
        costMeta: req.costMeta,
        providerMessageId,
        recordedAtIso: new Date().toISOString(),
      });

      try {
        getProviderRegistry().recordSuccess('sms-stub', durationMs);
      } catch {
        // Registry not wired in this context (e.g. unit test that bypasses
        // startup). Swallow — the stub must never throw for observability.
      }

      return { providerMessageId, status: 'sent', durationMs };
    } catch (err) {
      const durationMs = Date.now() - start;
      try {
        getProviderRegistry().recordFailure('sms-stub', durationMs, 'permanent');
      } catch {
        // See comment above.
      }
      return {
        providerMessageId: '',
        status: 'failed',
        durationMs,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

function mintStubMessageId(req: SmsSendRequest): string {
  const digest = createHash('sha256')
    .update(`${req.to}|${req.body}|${req.idempotencyKey}`)
    .digest('hex');
  return `stub_${digest.slice(0, 12)}`;
}
