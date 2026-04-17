/**
 * SMS provider abstraction — interface + stub implementation.
 * Real provider (Twilio/Telnyx) is a follow-up story.
 */

export type SendResult = {
  messageId: string;
  status: "delivered" | "failed" | "queued";
};

/**
 * Provider interface — designed for swap-in without changing the send pipeline.
 */
export interface SMSProvider {
  send(
    to: string,
    body: string,
    idempotencyKey: string,
  ): Promise<SendResult>;
}

/**
 * Stub provider — logs sends and returns delivered status.
 * Used until a real SMS provider is integrated.
 */
export class StubSMSProvider implements SMSProvider {
  async send(
    to: string,
    body: string,
    idempotencyKey: string,
  ): Promise<SendResult> {
    console.log(
      `[StubSMSProvider] Sending SMS to ${to} (idempotency: ${idempotencyKey}): ${body.slice(0, 80)}...`,
    );

    return {
      messageId: `stub_${idempotencyKey}`,
      status: "delivered",
    };
  }
}

/**
 * Get the configured SMS provider.
 *
 * Currently returns StubSMSProvider. Real provider integration (Telnyx/Twilio)
 * is a follow-up story. When implemented:
 *
 * 1. Add env vars: TELNYX_API_KEY, TELNYX_MESSAGING_PROFILE_ID (or equivalent)
 * 2. Create TelnyxSMSProvider implementing this interface
 * 3. Update this function to return the real provider when env vars are set
 * 4. The send pipeline (jobs.ts, send/route.ts) requires ZERO changes —
 *    they call getSMSProvider() and use the interface.
 *
 * Discovery spike (per Epic 2 retro): capture real Telnyx send response +
 * delivery webhook payloads via sandbox BEFORE implementing the real provider.
 */
export function getSMSProvider(): SMSProvider {
  // Future: check process.env.TELNYX_API_KEY and return TelnyxSMSProvider
  return new StubSMSProvider();
}
