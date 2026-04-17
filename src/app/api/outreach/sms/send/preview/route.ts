import { NextResponse } from "next/server";
import { withAuth } from "@/modules/auth/with-auth";
import { getTemplate } from "@/modules/outreach/sms-template-repository";
import { renderTemplate } from "@/modules/outreach/template-renderer";
import { canSendSMS } from "@/modules/outreach/consent-gate";
import { getSupabaseAdminClient } from "@/modules/persistence";

const MAX_CANDIDATES_PER_SEND = 5000;

/**
 * POST /api/outreach/sms/send/preview — dry-run endpoint.
 * Returns counts and a sample rendered message without creating sends.
 * Used by the SendSMSModal before user confirms.
 */
export const POST = withAuth(
  async ({ session, request }) => {
    const tenantId =
      request.headers.get("x-active-client-id") ?? session.tenantId;
    const body = await request.json();

    const { templateId, contextParams = {} } = body;

    const template = templateId ? await getTemplate(templateId) : null;

    // Resolve candidates
    let candidateIds: string[];
    if (body.candidateIds && Array.isArray(body.candidateIds)) {
      candidateIds = body.candidateIds;
    } else if (body.filters) {
      candidateIds = await resolveFilteredIds(body.filters, tenantId);
    } else {
      return NextResponse.json(
        { error: { code: "validation_error", message: "candidateIds or filters required" } },
        { status: 400 },
      );
    }

    if (candidateIds.length > MAX_CANDIDATES_PER_SEND) {
      return NextResponse.json({
        data: {
          total: candidateIds.length,
          withPhone: 0,
          withoutPhone: 0,
          optedOut: 0,
          overLimit: true,
          maxAllowed: MAX_CANDIDATES_PER_SEND,
          sampleRendered: null,
        },
      });
    }

    const client = getSupabaseAdminClient();
    const { data: candidates } = await client
      .from("candidates")
      .select("id, first_name, last_name, phone, job_title, current_company, city, state")
      .in("id", candidateIds)
      .eq("tenant_id", tenantId);

    let withPhone = 0;
    let withoutPhone = 0;
    let optedOut = 0;
    let sampleRendered: string | null = null;

    for (const c of candidates ?? []) {
      if (!(c.phone as string)) {
        withoutPhone++;
        continue;
      }

      const consent = await canSendSMS(c.id as string, tenantId);
      if (!consent.allowed) {
        optedOut++;
        continue;
      }

      withPhone++;

      // Render sample for first eligible candidate
      if (!sampleRendered && template) {
        const vars: Record<string, string> = {
          first_name: (c.first_name as string) ?? "",
          last_name: (c.last_name as string) ?? "",
          job_title: (contextParams.job_title as string) ?? (c.job_title as string) ?? "",
          company: (contextParams.company as string) ?? (c.current_company as string) ?? "",
          location: [c.city, c.state].filter(Boolean).join(", "),
          recruiter_name: session.email ?? "",
          tracking_link: "[tracking link]",
          ...contextParams,
        };
        const result = renderTemplate(template.body, vars);
        sampleRendered = result.rendered;
      }
    }

    return NextResponse.json({
      data: {
        total: (candidates ?? []).length,
        withPhone,
        withoutPhone,
        optedOut,
        overLimit: false,
        sampleRendered,
      },
    });
  },
  { action: "outreach:write" },
);

async function resolveFilteredIds(
  filters: Record<string, string>,
  tenantId: string,
): Promise<string[]> {
  const client = getSupabaseAdminClient();
  let query = client
    .from("candidates")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("ingestion_state", "active");

  if (filters.availability) query = query.eq("availability_status", filters.availability);
  if (filters.state) query = query.ilike("state", `%${filters.state}%`);
  if (filters.skills) query = query.contains("skills", [filters.skills]);

  query = query.limit(MAX_CANDIDATES_PER_SEND);

  const { data } = await query;
  return (data ?? []).map((r) => r.id as string);
}
