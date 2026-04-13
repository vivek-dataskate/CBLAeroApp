import { NextRequest, NextResponse } from "next/server";

import { withAuth } from "@/modules/auth";
import {
  listSavedSearches,
  createSavedSearch,
} from "@/features/candidate-management/infrastructure/saved-search-repository";

export const GET = withAuth(async ({ session }) => {
  const searches = await listSavedSearches(session.actorId, session.tenantId);

  return NextResponse.json({
    data: searches,
    meta: { tenantId: session.tenantId },
  });
}, { action: "candidate:read" });

export const POST = withAuth(async ({ session, request }) => {
  let body: { name?: string; filters?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "name is required." } },
      { status: 400 },
    );
  }

  if (!body.filters || typeof body.filters !== "object") {
    return NextResponse.json(
      { error: { code: "validation_error", message: "filters object is required." } },
      { status: 400 },
    );
  }

  const search = await createSavedSearch({
    tenantId: session.tenantId,
    actorId: session.actorId,
    actorEmail: session.email,
    name: body.name.trim(),
    filters: body.filters,
  });

  return NextResponse.json({ data: search }, { status: 201 });
}, { action: "candidate:write" });
