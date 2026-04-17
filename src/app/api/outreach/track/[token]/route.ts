import { NextRequest, NextResponse } from "next/server";
import { recordClick } from "@/modules/outreach/tracking";
import { logOutreachEvent } from "@/modules/outreach/audit";

/**
 * GET /api/outreach/track/[token] — click-tracking redirect.
 * Public endpoint (no auth) — candidate clicks this link in the SMS.
 * Logs the click event, then redirects to a destination page.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;

  if (!token || token.length < 8) {
    return NextResponse.json(
      { error: "Invalid tracking token" },
      { status: 400 },
    );
  }

  try {
    const result = await recordClick(token);

    if (!result.found) {
      // Token not found — redirect to homepage gracefully instead of erroring
      const baseUrl = process.env.CBL_APP_URL ?? "http://localhost:3000";
      return NextResponse.redirect(baseUrl);
    }

    // Log click to audit trail
    if (result.candidateId) {
      await logOutreachEvent({
        tenantId: "", // We don't have tenant context on public endpoint — acceptable for click tracking
        channel: "sms",
        sendId: result.sendId ?? undefined,
        candidateId: result.candidateId,
        deliveryStatus: "clicked",
        complianceCheckPassed: true,
      });
    }

    // Redirect to destination — default to homepage for now.
    // Future: could redirect to candidate portal or job details page.
    const baseUrl = process.env.CBL_APP_URL ?? "http://localhost:3000";
    const destination = `${baseUrl}/welcome`;
    return NextResponse.redirect(destination, 302);
  } catch (err) {
    console.error(`[click-track] Error processing token ${token}:`, err);
    const baseUrl = process.env.CBL_APP_URL ?? "http://localhost:3000";
    return NextResponse.redirect(baseUrl);
  }
}
