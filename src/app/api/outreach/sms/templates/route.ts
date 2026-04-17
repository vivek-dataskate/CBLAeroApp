import { NextResponse } from "next/server";
import { withAuth } from "@/modules/auth/with-auth";
import {
  listTemplates,
  createTemplate,
} from "@/modules/outreach/sms-template-repository";
import { validateTemplate } from "@/modules/outreach/template-validator";
import { extractVariables } from "@/modules/outreach/template-renderer";
import { isValidAgenda, type SmsAgenda } from "@/modules/outreach/agenda";

/**
 * GET /api/outreach/sms/templates — list templates for active tenant.
 * Accessible by recruiter + admin (outreach:read).
 */
export const GET = withAuth(
  async ({ session, request }) => {
    const tenantId =
      request.headers.get("x-active-client-id") ?? session.tenantId;
    const agendaParam = request.nextUrl.searchParams.get("agenda");
    const agenda =
      agendaParam && isValidAgenda(agendaParam)
        ? (agendaParam as SmsAgenda)
        : undefined;

    const templates = await listTemplates(tenantId, agenda);
    return NextResponse.json({ data: templates });
  },
  { action: "outreach:read" },
);

/**
 * POST /api/outreach/sms/templates — create a new template.
 * Admin only (outreach:manage-templates).
 */
export const POST = withAuth(
  async ({ session, request }) => {
    const tenantId =
      request.headers.get("x-active-client-id") ?? session.tenantId;
    const body = await request.json();

    const { agenda, name, templateKey, body: templateBody } = body;

    // Validate
    const validation = validateTemplate({
      body: templateBody,
      agenda,
      name,
    });
    if (!validation.valid) {
      return NextResponse.json(
        { error: { code: "validation_error", errors: validation.errors } },
        { status: 400 },
      );
    }

    const variables = extractVariables(templateBody);

    const template = await createTemplate({
      tenantId,
      agenda,
      name,
      templateKey:
        templateKey ?? `${agenda}_${name.toLowerCase().replace(/\s+/g, "_")}`,
      body: templateBody,
      variables,
      createdBy: session.actorId,
    });

    return NextResponse.json({ data: template }, { status: 201 });
  },
  { action: "outreach:manage-templates" },
);
