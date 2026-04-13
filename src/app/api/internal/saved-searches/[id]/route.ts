import { NextResponse } from "next/server";

import { withAuth } from "@/modules/auth";
import {
  updateSavedSearch,
  deleteSavedSearch,
  SavedSearchNotFoundError,
} from "@/features/candidate-management/infrastructure/saved-search-repository";

export const PATCH = withAuth<{ id: string }>(async ({ session, request, params }) => {
  let body: { name?: string; digestEnabled?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  if (body.name !== undefined && (typeof body.name !== "string" || body.name.trim().length === 0)) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "name must be a non-empty string." } },
      { status: 400 },
    );
  }
  if (body.digestEnabled !== undefined && typeof body.digestEnabled !== "boolean") {
    return NextResponse.json(
      { error: { code: "validation_error", message: "digestEnabled must be a boolean." } },
      { status: 400 },
    );
  }

  try {
    const updated = await updateSavedSearch(params.id, session.actorId, session.tenantId, {
      name: body.name?.trim(),
      digestEnabled: body.digestEnabled,
    });
    return NextResponse.json({ data: updated });
  } catch (err) {
    if (err instanceof SavedSearchNotFoundError) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Saved search not found." } },
        { status: 404 },
      );
    }
    throw err;
  }
}, { action: "candidate:write" });

export const DELETE = withAuth<{ id: string }>(async ({ session, params }) => {
  try {
    await deleteSavedSearch(params.id, session.actorId, session.tenantId);
    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    if (err instanceof SavedSearchNotFoundError) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Saved search not found." } },
        { status: 404 },
      );
    }
    throw err;
  }
}, { action: "candidate:write" });
