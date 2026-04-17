/**
 * Admin alert sink for provider health events — Story 1.12b AC 1 bullet 4.
 *
 * Fires on kill-switch / degraded transitions and delivers the event via
 * two orthogonal channels:
 *   1. **Structured critical log** — always on. Picked up by log-drain
 *      alerting (Render → external aggregator) — the minimum-viable alert
 *      path that AC 1 bullet 4 requires.
 *   2. **Admin email via Microsoft Graph** — active when
 *      `CBL_PROVIDER_ALERT_EMAIL` is configured. Uses the already-wired
 *      `GraphProviderClient` to send from the same service account that
 *      powers the daily-digest job. If Graph itself is the degraded
 *      provider, the email path will fail — we log and move on; the
 *      critical log is the ultimate fallback.
 *
 * Richer alerting (Teams, Slack, per-provider routing, escalation chains,
 * multi-admin distribution lists) is deferred to Epic 8 story 8-5
 * (`implement provider health and api metering alerts`) — see
 * `deferred-work.md`.
 */
import type { ProviderHealthEvent } from './types';
import { getSharedGraphClient } from './graph';

/** Only these transitions trigger an admin alert — `normal → degraded`
 *  is a yellow-flag escalation, kill-switch + unhealthy are red-flags. */
const ALERT_WORTHY_MODES = new Set(['degraded', 'kill_switched']);

/**
 * Build a structured log entry and (optionally) dispatch an admin email
 * for a single provider-health-event. Safe to call from the registry's
 * `onHealthEvent` callback — never throws; email failures are logged and
 * swallowed so observability never blocks ingestion.
 */
export async function emitProviderAdminAlert(event: ProviderHealthEvent): Promise<void> {
  if (!ALERT_WORTHY_MODES.has(event.newMode)) return;

  // Channel 1 — critical structured log. Always fires.
  console.error(
    JSON.stringify({
      level: 'critical',
      module: 'provider-admin-alert',
      action: 'provider_state_transition',
      provider: event.provider,
      previousMode: event.previousMode,
      newMode: event.newMode,
      reason: event.reason,
      errorRate: event.errorRate,
      attemptCount: event.attemptCount,
      occurredAtIso: event.occurredAtIso,
    }),
  );

  // Channel 2 — admin email. Opt-in via env var; silently no-ops otherwise.
  const adminEmail = process.env.CBL_PROVIDER_ALERT_EMAIL?.trim();
  if (!adminEmail) return;

  // If Graph itself is the provider that just transitioned, its email
  // path is compromised — skip the email attempt but keep the critical
  // log already emitted above.
  if (event.provider === 'graph' && event.newMode === 'kill_switched') {
    console.warn('[provider-admin-alert] Graph kill-switched — skipping email path, relying on log drain');
    return;
  }

  const graph = getSharedGraphClient();
  if (!graph) {
    console.warn('[provider-admin-alert] Graph client unavailable — admin email skipped');
    return;
  }

  const senderAddress = process.env.CBL_PROVIDER_ALERT_SENDER
    ?? process.env.CBL_DIGEST_SENDER
    ?? 'submissions-inbox@cblsolutions.com';

  const subject = `[CBLAero] Provider ${event.provider} is ${event.newMode}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
      <h2 style="color:${event.newMode === 'kill_switched' ? '#b91c1c' : '#b45309'}">
        Provider State Transition
      </h2>
      <p><strong>Provider:</strong> ${escapeHtml(event.provider)}</p>
      <p><strong>Transition:</strong> ${escapeHtml(event.previousMode)} → <strong>${escapeHtml(event.newMode)}</strong></p>
      <p><strong>Reason:</strong> ${escapeHtml(event.reason)}</p>
      <p><strong>Error rate:</strong> ${(event.errorRate * 100).toFixed(1)}% over ${event.attemptCount} attempts</p>
      <p><strong>Time:</strong> ${escapeHtml(event.occurredAtIso)}</p>
      <hr />
      <p style="color:#6b7280;font-size:12px">
        Source: ProviderRegistry · set <code>CBL_PROVIDER_ALERT_EMAIL</code> to route these notifications.
      </p>
    </div>`;

  try {
    const result = await graph.post(`/users/${senderAddress}/sendMail`, {
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: adminEmail } }],
      },
    });
    if (!result.ok) {
      console.warn(
        `[provider-admin-alert] Graph sendMail failed (${result.status}): ${result.error ?? 'unknown'}`,
      );
    }
  } catch (err) {
    console.warn(
      '[provider-admin-alert] sendMail threw:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
