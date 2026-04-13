import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

import {
  listCandidates,
} from "@/features/candidate-management/infrastructure/candidate-repository";
import type { AvailabilityStatus } from "@/features/candidate-management/contracts/candidate";

import {
  authorizeAccess,
  buildStepUpReauthenticateUrl,
  consumeCrossClientConfirmationToken,
  isSessionFreshForStepUp,
  issueCrossClientConfirmationToken,
  toErrorCode,
  verifyCrossClientConfirmationToken,
  withAuth,
  type AuthSession,
} from "@/modules/auth";
import {
  recordClientContextConfirmationEvent,
  recordStepUpAttemptEvent,
} from "@/modules/audit";

type CandidatePostBody = {
  tenantId?: unknown;
  activeClientId?: unknown;
  crossClientConfirmationToken?: unknown;
  candidateIds?: unknown;
  action?: unknown;
  format?: unknown;
};

type SensitiveCandidateAction =
  | "candidate:communication-history-access"
  | "candidate:data-export";

function parseBooleanInput(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function resolveSensitiveReadAction(request: NextRequest): SensitiveCandidateAction | null {
  const view = request.nextUrl.searchParams.get("view")?.trim().toLowerCase() ?? null;
  const includeCommunicationHistory = parseBooleanInput(
    request.nextUrl.searchParams.get("includeCommunicationHistory"),
  );

  if (
    includeCommunicationHistory ||
    view === "communication-history" ||
    view === "communication_history"
  ) {
    return "candidate:communication-history-access";
  }

  return null;
}

function resolveSensitiveWriteAction(payload: CandidatePostBody): SensitiveCandidateAction | null {
  if (typeof payload.action !== "string") {
    return null;
  }

  const normalized = payload.action.trim().toLowerCase();
  if (
    normalized === "export" ||
    normalized === "data-export" ||
    normalized === "data_export"
  ) {
    return "candidate:data-export";
  }

  return null;
}

function asOptionalTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCandidateIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return [...new Set(normalized)].sort();
}

function resolveExportFormat(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function buildCrossClientIntentHash(input: {
  targetClientId: string;
  action: string;
  candidateIds: string[];
  format: string | null;
}): string {
  const canonical = JSON.stringify({
    targetClientId: input.targetClientId,
    action: input.action,
    candidateIds: [...input.candidateIds],
    format: input.format,
  });

  return createHash("sha256").update(canonical).digest("base64url");
}

function resolveRequestedTenantId(payload: CandidatePostBody): string | null {
  return asOptionalTrimmedString(payload.tenantId);
}

function getAllowedClientIds(session: AuthSession): string[] {
  const allowed = session.clientIds ?? [session.tenantId];
  const unique = new Set<string>(allowed);
  unique.add(session.tenantId);
  return [...unique];
}

function resolveActionScope(payload: CandidatePostBody, session: AuthSession) {
  const requestedTenantId = resolveRequestedTenantId(payload);
  const allowedClientIds = getAllowedClientIds(session);
  const providedActiveClientId = asOptionalTrimmedString(payload.activeClientId);
  const activeClientId = providedActiveClientId ?? session.tenantId;

  if (!allowedClientIds.includes(activeClientId)) {
    return {
      error: NextResponse.json(
        {
          error: {
            code: "active_client_forbidden",
            message: "The active client scope must be one of your authorized client contexts.",
          },
        },
        { status: 403 },
      ),
      activeClientId,
      targetClientId: requestedTenantId ?? activeClientId,
      requestedTenantId,
    };
  }

  return {
    error: null,
    activeClientId,
    targetClientId: requestedTenantId ?? activeClientId,
    requestedTenantId,
  };
}

async function enforceCrossClientConfirmation(
  payload: CandidatePostBody,
  session: AuthSession,
  traceId: string,
  activeClientId: string,
  targetClientId: string,
  action: string,
  intentHash: string,
  path: string,
  method: string,
): Promise<NextResponse | null> {
  if (activeClientId === targetClientId) {
    return null;
  }

  const providedToken = asOptionalTrimmedString(payload.crossClientConfirmationToken);
  const tokenVerification =
    providedToken !== null
      ? await verifyCrossClientConfirmationToken({
          token: providedToken,
          actorId: session.actorId,
          activeClientId,
          targetClientId,
          action,
          intentHash,
          path,
          method,
        })
      : null;

  const confirmed = tokenVerification
    ? await consumeCrossClientConfirmationToken(
        tokenVerification.jti,
        tokenVerification.expiresAtEpochSec,
      )
    : false;

  if (!confirmed) {
    const challenge = await issueCrossClientConfirmationToken({
      actorId: session.actorId,
      activeClientId,
      targetClientId,
      action,
      intentHash,
      path,
      method,
    });

    await recordClientContextConfirmationEvent({
      traceId,
      actorId: session.actorId,
      role: session.role,
      tenantId: session.tenantId,
      activeClientId,
      targetClientId,
      action,
      path,
      method,
      outcome: "required",
    });

    return NextResponse.json(
      {
        error: {
          code: "cross_client_confirmation_required",
          message:
            "Explicit confirmation is required before executing this cross-client action.",
          activeClientId,
          targetClientId,
          confirmationToken: challenge.token,
          confirmationExpiresAt: challenge.expiresAtIso,
        },
      },
      { status: 409 },
    );
  }

  await recordClientContextConfirmationEvent({
    traceId,
    actorId: session.actorId,
    role: session.role,
    tenantId: session.tenantId,
    activeClientId,
    targetClientId,
    action,
    path,
    method,
    outcome: "confirmed",
  });

  return null;
}

async function enforceStepUpForSensitiveOperation(
  request: NextRequest,
  session: AuthSession,
  traceId: string,
  sensitiveAction: SensitiveCandidateAction | null,
): Promise<NextResponse | null> {
  if (!sensitiveAction) {
    return null;
  }

  if (!isSessionFreshForStepUp(session)) {
    await recordStepUpAttemptEvent({
      traceId,
      actorId: session.actorId,
      tenantId: session.tenantId,
      role: session.role,
      path: request.nextUrl.pathname,
      method: request.method,
      action: sensitiveAction,
      outcome: "challenged",
      reason: "fresh_auth_required",
    });

    return NextResponse.json(
      {
        error: {
          code: "step_up_required",
          message: "Fresh authentication is required for this sensitive operation.",
          reauthenticateUrl: buildStepUpReauthenticateUrl(request.nextUrl.pathname),
        },
      },
      { status: 428 },
    );
  }

  await recordStepUpAttemptEvent({
    traceId,
    actorId: session.actorId,
    tenantId: session.tenantId,
    role: session.role,
    path: request.nextUrl.pathname,
    method: request.method,
    action: sensitiveAction,
    outcome: "verified",
    reason: null,
  });

  return null;
}

export const GET = withAuth(async ({ session, request, traceId }) => {
  const requestedTenantId = request.nextUrl.searchParams.get("tenantId");

  const stepUpResponse = await enforceStepUpForSensitiveOperation(
    request,
    session,
    traceId,
    resolveSensitiveReadAction(request),
  );
  if (stepUpResponse) {
    return stepUpResponse;
  }

  const sp = request.nextUrl.searchParams;

  // Parse all filter params
  const availabilityStatusRaw = sp.get("availability_status");
  const location = sp.get("location");
  const certType = sp.get("cert_type");
  const search = sp.get("search");
  const email = sp.get("email");
  const phone = sp.get("phone");
  const jobTitle = sp.get("job_title");
  const skills = sp.get("skills");
  const currentCompany = sp.get("current_company");
  const stateGeo = sp.get("state");
  const city = sp.get("city");
  const workAuthorization = sp.get("work_authorization");
  const employmentType = sp.get("employment_type");
  const source = sp.get("source");
  const shiftPreference = sp.get("shift_preference");
  const yearsOfExperience = sp.get("years_of_experience");
  const veteranStatus = sp.get("veteran_status");
  const hasApLicenseRaw = sp.get("has_ap_license");
  const deducedRole = sp.get("deduced_role");
  const createdAfter = sp.get("created_after");
  const createdBefore = sp.get("created_before");
  const sortBy = sp.get("sort_by");
  const sortDir = sp.get("sort_dir");

  // Validate availability_status enum
  const VALID_AVAILABILITY: ReadonlySet<string> = new Set(["active", "passive", "unavailable"]);
  if (availabilityStatusRaw && !VALID_AVAILABILITY.has(availabilityStatusRaw)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_filter",
          message: `Invalid availability_status value. Must be one of: active, passive, unavailable.`,
        },
      },
      { status: 400 },
    );
  }
  const availabilityStatus = availabilityStatusRaw as AvailabilityStatus | null;

  // Validate sort_by
  const VALID_SORT_FIELDS: ReadonlySet<string> = new Set(["created_at", "years_of_experience", "availability_status", "first_name", "last_name", "location", "job_title"]);
  if (sortBy && !VALID_SORT_FIELDS.has(sortBy)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_sort",
          message: `Invalid sort_by value. Must be one of: ${[...VALID_SORT_FIELDS].join(", ")}.`,
        },
      },
      { status: 400 },
    );
  }

  // Validate sort_dir
  if (sortDir && sortDir !== "asc" && sortDir !== "desc") {
    return NextResponse.json(
      {
        error: {
          code: "invalid_sort",
          message: "Invalid sort_dir value. Must be one of: asc, desc.",
        },
      },
      { status: 400 },
    );
  }

  // Parse boolean filter
  const hasApLicense = hasApLicenseRaw === "true" ? true : hasApLicenseRaw === "false" ? false : undefined;

  // At least one filter required (any filter satisfies)
  const hasFilter = !!(
    availabilityStatus || location || certType || search ||
    email || phone || jobTitle || skills || currentCompany ||
    stateGeo || city || workAuthorization || employmentType ||
    source || shiftPreference || yearsOfExperience || veteranStatus ||
    hasApLicense !== undefined || deducedRole || createdAfter || createdBefore
  );
  if (!hasFilter) {
    return NextResponse.json(
      {
        error: {
          code: "filter_required",
          message:
            "At least one filter is required.",
        },
      },
      { status: 400 },
    );
  }

  const cursor = sp.get("cursor") ?? undefined;
  const limitRaw = sp.get("limit");
  const limit = limitRaw ? Math.max(1, Math.min(500, parseInt(limitRaw, 10) || 25)) : undefined;

  const listParams = {
    tenantId: session.tenantId,
    availabilityStatus: availabilityStatus ?? undefined,
    location: location ?? undefined,
    certType: certType ?? undefined,
    search: search ?? undefined,
    email: email ?? undefined,
    phone: phone ?? undefined,
    jobTitle: jobTitle ?? undefined,
    skills: skills ?? undefined,
    currentCompany: currentCompany ?? undefined,
    state: stateGeo ?? undefined,
    city: city ?? undefined,
    workAuthorization: workAuthorization ?? undefined,
    employmentType: employmentType ?? undefined,
    source: source ?? undefined,
    shiftPreference: shiftPreference ?? undefined,
    yearsOfExperience: yearsOfExperience ?? undefined,
    veteranStatus: veteranStatus ?? undefined,
    hasApLicense,
    deducedRole: deducedRole ?? undefined,
    createdAfter: createdAfter ?? undefined,
    createdBefore: createdBefore ?? undefined,
    sortBy: (sortBy as import("@/features/candidate-management/contracts/candidate").SortByField) ?? undefined,
    sortDir: (sortDir === "asc" || sortDir === "desc") ? sortDir as "asc" | "desc" : undefined,
    cursor,
    limit,
  };

  console.log("[CandidatesAPI] GET request", {
    traceId,
    tenantId: session.tenantId,
    filters: { jobTitle, search, email, skills, city, stateGeo, source, availabilityStatus, workAuthorization },
    limit,
    cursor: cursor ? "yes" : "no",
  });

  const result = await listCandidates(listParams);

  console.log("[CandidatesAPI] Result:", {
    traceId,
    itemCount: result.items.length,
    hasNextCursor: !!result.nextCursor,
    sortedBy: result.sortedBy,
  });

  return NextResponse.json({
    data: result.items,
    meta: {
      tenantId: session.tenantId,
      activeClientId: session.tenantId,
      targetClientId: requestedTenantId ?? session.tenantId,
      readScope: "tenant-isolated",
      nextCursor: result.nextCursor,
      sortedBy: result.sortedBy,
    },
  });
}, { action: "candidate:read" });

export const POST = withAuth(async ({ session, request, traceId }) => {
  let payload: CandidatePostBody;
  try {
    payload = (await request.json()) as CandidatePostBody;
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "invalid_body",
          message: "Request body must be valid JSON.",
        },
      },
      { status: 400 },
    );
  }

  const {
    error: actionScopeError,
    activeClientId,
    targetClientId,
    requestedTenantId,
  } = resolveActionScope(payload, session);
  if (actionScopeError) {
    return actionScopeError;
  }

  if (requestedTenantId) {
    const tenantAuthz = await authorizeAccess({
      session,
      action: "candidate:write",
      requestedTenantId,
      path: request.nextUrl.pathname,
      method: request.method,
      traceId,
    });

    if (!tenantAuthz.allowed) {
      return NextResponse.json(
        {
          error: {
            code: toErrorCode(tenantAuthz.reason),
            message: "Access denied for candidate write operation.",
          },
        },
        { status: tenantAuthz.status },
      );
    }
  }

  const sensitiveAction = resolveSensitiveWriteAction(payload);
  const candidateIds = normalizeCandidateIds(payload.candidateIds);
  const exportFormat = resolveExportFormat(payload.format);
  const actionScope = sensitiveAction ?? "candidate:update";
  const confirmationIntentHash = buildCrossClientIntentHash({
    targetClientId,
    action: actionScope,
    candidateIds,
    format: sensitiveAction === "candidate:data-export" ? exportFormat ?? "csv" : null,
  });

  const stepUpResponse = await enforceStepUpForSensitiveOperation(
    request,
    session,
    traceId,
    sensitiveAction,
  );
  if (stepUpResponse) {
    return stepUpResponse;
  }

  const confirmationResponse = await enforceCrossClientConfirmation(
    payload,
    session,
    traceId,
    activeClientId,
    targetClientId,
    actionScope,
    confirmationIntentHash,
    request.nextUrl.pathname,
    request.method,
  );
  if (confirmationResponse) {
    return confirmationResponse;
  }

  if (sensitiveAction === "candidate:data-export") {
    const format = exportFormat ?? "csv";

    return NextResponse.json({
      data: {
        exportId: `exp-${crypto.randomUUID()}`,
        status: "queued",
        format,
        candidateCount: candidateIds.length,
        tenantId: targetClientId,
      },
      meta: {
        activeClientId,
        targetClientId,
        writeScope: "tenant-isolated",
      },
    });
  }

  return NextResponse.json({
    data: {
      updated: candidateIds.length,
      tenantId: targetClientId,
    },
    meta: {
      activeClientId,
      targetClientId,
      writeScope: "tenant-isolated",
    },
  });
}, { action: "candidate:write" });
