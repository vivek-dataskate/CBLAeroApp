import { NextResponse } from "next/server";
import { withAuth } from "@/modules/auth/with-auth";
import { getTemplate } from "@/modules/outreach/sms-template-repository";
import { renderTemplate } from "@/modules/outreach/template-renderer";
import { canSendSMS } from "@/modules/outreach/consent-gate";
import { createBatchSends } from "@/modules/outreach/send-repository";
import { generateTrackingToken, buildTrackingUrl } from "@/modules/outreach/tracking";
import { getSupabaseAdminClient } from "@/modules/persistence";

const MAX_CANDIDATES_PER_SEND = 5000;

/**
 * POST /api/outreach/sms/send — schedule SMS sends.
 *
 * Accepts two modes:
 * (a) { candidateIds: string[], templateId, contextParams, scheduledFor? }
 * (b) { filters: {...}, templateId, contextParams, scheduledFor? }
 *
 * Filter mode resolves candidate IDs server-side.
 */
export const POST = withAuth(
  async ({ session, request }) => {
    const tenantId =
      request.headers.get("x-active-client-id") ?? session.tenantId;
    const body = await request.json();

    const { templateId, contextParams = {}, scheduledFor } = body;

    // Validate template exists
    const template = await getTemplate(templateId);
    if (!template) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Template not found" } },
        { status: 404 },
      );
    }

    // Resolve candidate IDs — either from explicit list or from filters
    let candidateIds: string[];
    if (body.candidateIds && Array.isArray(body.candidateIds)) {
      candidateIds = body.candidateIds;
    } else if (body.filters) {
      candidateIds = await resolveMatchingCandidates(body.filters, tenantId);
    } else {
      return NextResponse.json(
        {
          error: {
            code: "validation_error",
            message: "Either candidateIds or filters must be provided",
          },
        },
        { status: 400 },
      );
    }

    if (candidateIds.length === 0) {
      return NextResponse.json(
        { error: { code: "no_candidates", message: "No candidates matched" } },
        { status: 400 },
      );
    }

    if (candidateIds.length > MAX_CANDIDATES_PER_SEND) {
      return NextResponse.json(
        {
          error: {
            code: "too_many_candidates",
            message: `Max ${MAX_CANDIDATES_PER_SEND} candidates per send. Refine your filters.`,
          },
        },
        { status: 400 },
      );
    }

    // Fetch candidate details for phone + consent check
    const client = getSupabaseAdminClient();
    const { data: candidates } = await client
      .from("candidates")
      .select("id, first_name, last_name, phone, job_title, current_company, city, state")
      .in("id", candidateIds)
      .eq("tenant_id", tenantId);

    const scheduledDate = scheduledFor ? new Date(scheduledFor) : new Date();
    let scheduled = 0;
    let skippedNoPhone = 0;
    let skippedOptOut = 0;
    const sendInputs: Parameters<typeof createBatchSends>[0] = [];

    for (const candidate of candidates ?? []) {
      const phone = candidate.phone as string | null;
      if (!phone) {
        skippedNoPhone++;
        continue;
      }

      // Consent check
      const consent = await canSendSMS(candidate.id as string, tenantId);
      if (!consent.allowed) {
        skippedOptOut++;
        continue;
      }

      // Render template with candidate + context variables
      const variables: Record<string, string> = {
        first_name: (candidate.first_name as string) ?? "",
        last_name: (candidate.last_name as string) ?? "",
        job_title:
          (contextParams.job_title as string) ??
          (candidate.job_title as string) ??
          "",
        company:
          (contextParams.company as string) ??
          (candidate.current_company as string) ??
          "",
        location: [candidate.city, candidate.state]
          .filter(Boolean)
          .join(", "),
        recruiter_name: session.email ?? "",
        ...contextParams,
      };

      // Generate tracking token and URL
      const trackingToken = generateTrackingToken();
      const trackingUrl = buildTrackingUrl(trackingToken);
      variables.tracking_link = trackingUrl;

      const { rendered, contentHash } = renderTemplate(
        template.body,
        variables,
      );

      sendInputs.push({
        tenantId,
        candidateId: candidate.id as string,
        templateId: template.id,
        templateVersion: template.version,
        renderedBody: rendered,
        renderedBodyHash: contentHash,
        contextParams,
        scheduledFor: scheduledDate,
        senderUserId: session.actorId,
        trackingToken,
        trackingUrl,
      });
    }

    // Batch create
    if (sendInputs.length > 0) {
      scheduled = await createBatchSends(sendInputs);
    }

    return NextResponse.json({
      data: {
        scheduled,
        skippedNoPhone,
        skippedOptOut,
        total: (candidates ?? []).length,
      },
    });
  },
  { action: "outreach:write" },
);

/**
 * Resolve matching candidate IDs from filter criteria.
 * Reuses the same filter logic as the candidate list page.
 */
async function resolveMatchingCandidates(
  filters: Record<string, string>,
  tenantId: string,
): Promise<string[]> {
  const client = getSupabaseAdminClient();
  let query = client
    .from("candidates")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("ingestion_state", "active");

  if (filters.availability)
    query = query.eq("availability_status", filters.availability);
  if (filters.state) query = query.ilike("state", `%${filters.state}%`);
  if (filters.city) query = query.ilike("city", `%${filters.city}%`);
  if (filters.skills)
    query = query.contains("skills", [filters.skills]);
  if (filters.job_title)
    query = query.ilike("job_title", `%${filters.job_title}%`);
  if (filters.source) query = query.eq("source", filters.source);
  if (filters.deduced_role)
    query = query.contains("extra_attributes", {
      deduced_roles: [{ role: filters.deduced_role }],
    });

  query = query.limit(MAX_CANDIDATES_PER_SEND);

  const { data, error } = await query;
  if (error)
    throw new Error(`Failed to resolve matching candidates: ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
}
