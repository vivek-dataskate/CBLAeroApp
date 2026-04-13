import { NextResponse } from "next/server";

import {
  buildStepUpReauthenticateUrl,
  isSessionFreshForStepUp,
  withAuth,
  type SessionRole,
} from "@/modules/auth";
import {
  AdminGovernanceError,
  assignUserRole,
  inviteUser,
  listInvitationsByTenant,
  listManagedUsersByTenant,
  registerOrSyncUserFromSession,
  updateUserTeamMembership,
} from "@/modules/admin";
import {
  listAdminActionEvents,
  listStepUpAttemptEvents,
  recordStepUpAttemptEvent,
} from "@/modules/audit";

type GovernanceAction = "invite_user" | "assign_role" | "update_team_membership";

const SENSITIVE_STEP_UP_ACTIONS = new Set<GovernanceAction>([
  "assign_role",
  "update_team_membership",
]);

type GovernancePostBody = {
  action?: unknown;
  email?: unknown;
  role?: unknown;
  teamIds?: unknown;
  targetActorId?: unknown;
};

function parseAction(value: unknown): GovernanceAction | null {
  if (
    value === "invite_user" ||
    value === "assign_role" ||
    value === "update_team_membership"
  ) {
    return value;
  }

  return null;
}

function parseSessionRole(value: unknown): SessionRole | null {
  if (
    value === "recruiter" ||
    value === "delivery-head" ||
    value === "admin" ||
    value === "compliance-officer"
  ) {
    return value;
  }

  return null;
}

function parseTargetActorId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AdminGovernanceError(
      "validation_error",
      400,
      "targetActorId must be a non-empty string.",
    );
  }

  return value.trim();
}

function parseTeamIds(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  throw new AdminGovernanceError(
    "validation_error",
    400,
    "teamIds must be an array of strings or a comma-separated string.",
  );
}

function parseEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new AdminGovernanceError("validation_error", 400, "email must be a string.");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new AdminGovernanceError("validation_error", 400, "email is required.");
  }

  return trimmed;
}

function buildGovernancePayload(tenantId: string) {
  const usersPromise = listManagedUsersByTenant(tenantId);
  const invitationsPromise = listInvitationsByTenant(tenantId);
  const adminActionsPromise = listAdminActionEvents(tenantId);
  const stepUpAttemptsPromise = listStepUpAttemptEvents(tenantId);

  return Promise.all([
    usersPromise,
    invitationsPromise,
    adminActionsPromise,
    stepUpAttemptsPromise,
  ]).then(([users, invitations, adminActions, stepUpAttempts]) => ({
    users,
    invitations,
    adminActions: adminActions.slice(0, 50).reverse(),
    stepUpAttempts: stepUpAttempts.slice(0, 50).reverse(),
  }));
}

export const GET = withAuth(async ({ session, request }) => {
  const requestedTenantId = request.nextUrl.searchParams.get("tenantId");

  await registerOrSyncUserFromSession(session);
  const tenantId = requestedTenantId ?? session.tenantId;

  return NextResponse.json({
    data: await buildGovernancePayload(tenantId),
    meta: {
      tenantId,
    },
  });
}, { action: "admin:manage-users" });

export const POST = withAuth(async ({ session, request, traceId }) => {
  let payload: GovernancePostBody;
  try {
    payload = (await request.json()) as GovernancePostBody;
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

  const action = parseAction(payload.action);
  if (!action) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_action",
          message: "Action must be invite_user, assign_role, or update_team_membership.",
        },
      },
      { status: 400 },
    );
  }

  await registerOrSyncUserFromSession(session);

  if (SENSITIVE_STEP_UP_ACTIONS.has(action)) {
    if (!isSessionFreshForStepUp(session)) {
      await recordStepUpAttemptEvent({
        traceId,
        actorId: session.actorId,
        tenantId: session.tenantId,
        role: session.role,
        path: request.nextUrl.pathname,
        method: request.method,
        action,
        outcome: "challenged",
        reason: "fresh_auth_required",
      });

      return NextResponse.json(
        {
          error: {
            code: "step_up_required",
            message: "Fresh authentication is required for this sensitive operation.",
            reauthenticateUrl: buildStepUpReauthenticateUrl("/dashboard/admin?stepUp=1"),
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
      action,
      outcome: "verified",
      reason: null,
    });
  }

  try {
    if (action === "invite_user") {
      const role = parseSessionRole(payload.role);
      if (!role) {
        throw new AdminGovernanceError(
          "validation_error",
          400,
          "role must be a valid role identifier.",
        );
      }

      const invitation = await inviteUser({
        actorId: session.actorId,
        tenantId: session.tenantId,
        email: parseEmail(payload.email),
        role,
        teamIds: parseTeamIds(payload.teamIds),
        traceId,
      });

      return NextResponse.json({
        data: {
          action,
          invitation,
          governance: await buildGovernancePayload(session.tenantId),
        },
      });
    }

    if (action === "assign_role") {
      const role = parseSessionRole(payload.role);
      if (!role) {
        throw new AdminGovernanceError(
          "validation_error",
          400,
          "role must be a valid role identifier.",
        );
      }

      const user = await assignUserRole({
        actorId: session.actorId,
        tenantId: session.tenantId,
        targetActorId: parseTargetActorId(payload.targetActorId),
        newRole: role,
        traceId,
      });

      return NextResponse.json({
        data: {
          action,
          user,
          governance: await buildGovernancePayload(session.tenantId),
        },
      });
    }

    const user = await updateUserTeamMembership({
      actorId: session.actorId,
      tenantId: session.tenantId,
      targetActorId: parseTargetActorId(payload.targetActorId),
      teamIds: parseTeamIds(payload.teamIds),
      traceId,
    });

    return NextResponse.json({
      data: {
        action,
        user,
        governance: await buildGovernancePayload(session.tenantId),
      },
    });
  } catch (error) {
    if (error instanceof AdminGovernanceError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        error: {
          code: "governance_failed",
          message: "Unable to process governance action.",
        },
      },
      { status: 500 },
    );
  }
}, { action: "admin:manage-users" });
