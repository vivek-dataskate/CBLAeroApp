import { NextResponse } from "next/server";
import { withAuth } from "@/modules/auth/with-auth";
import {
  updateTemplate,
  archiveTemplate,
  getTemplate,
} from "@/modules/outreach/sms-template-repository";
import { validateTemplate } from "@/modules/outreach/template-validator";
import { extractVariables } from "@/modules/outreach/template-renderer";

/**
 * PUT /api/outreach/sms/templates/[id] — update template (creates new version).
 * Admin only.
 */
export const PUT = withAuth<{ id: string }>(
  async ({ session, request, params }) => {
    const { id } = params;

    const existing = await getTemplate(id);
    if (!existing) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Template not found" } },
        { status: 404 },
      );
    }

    const body = await request.json();
    const templateBody = body.body ?? existing.body;
    const templateName = body.name ?? existing.name;
    const templateAgenda = body.agenda ?? existing.agenda;

    // Validate updated content
    const validation = validateTemplate({
      body: templateBody,
      agenda: templateAgenda,
      name: templateName,
    });
    if (!validation.valid) {
      return NextResponse.json(
        { error: { code: "validation_error", errors: validation.errors } },
        { status: 400 },
      );
    }

    const variables = extractVariables(templateBody);

    const updated = await updateTemplate(id, {
      name: templateName,
      body: templateBody,
      variables,
      agenda: templateAgenda,
      updatedBy: session.actorId,
    });

    return NextResponse.json({ data: updated });
  },
  { action: "outreach:manage-templates" },
);

/**
 * DELETE /api/outreach/sms/templates/[id] — archive template (soft delete).
 * Admin only.
 */
export const DELETE = withAuth<{ id: string }>(
  async ({ params }) => {
    const { id } = params;

    const existing = await getTemplate(id);
    if (!existing) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Template not found" } },
        { status: 404 },
      );
    }

    await archiveTemplate(id);
    return NextResponse.json({ data: { archived: true } });
  },
  { action: "outreach:manage-templates" },
);
