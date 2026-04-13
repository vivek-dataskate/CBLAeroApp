import {
  recordAuthorizationDenyEvent,
  type AuthorizationDenyReason,
} from "../audit";
import { resolveEffectiveRole } from "../admin";
import type { AuthSession, SessionRole } from "./session";

export type ProtectedAction =
  | "dashboard:view"
  | "dashboard:admin"
  | "candidate:read"
  | "candidate:write"
  | "recruiter:csv-upload"
  | "audit:read-denials"
  | "admin:manage-users"
  | "admin:read-import-batches"
  | "admin:read-ai-usage"
  | "admin:read-prompt-registry"
  | "admin:manage-prompt-registry"
  | "admin:view-sync-runs"
  | "admin:view-sync-errors"
  | "compliance:read-data-residency";

type AuthorizationAllow = {
  allowed: true;
};

type AuthorizationDeny = {
  allowed: false;
  status: 401 | 403;
  reason: AuthorizationDenyReason;
};

export type AuthorizationResult = AuthorizationAllow | AuthorizationDeny;

const ROLE_ACTION_MAP: Record<SessionRole, ReadonlySet<ProtectedAction>> = {
  recruiter: new Set([
    "dashboard:view",
    "candidate:read",
    "candidate:write",
    "recruiter:csv-upload",
  ]),
  "delivery-head": new Set([
    "dashboard:view",
    "candidate:read",
    "candidate:write",
    "recruiter:csv-upload",
    "admin:read-ai-usage",
    "admin:read-prompt-registry",
  ]),
  admin: new Set([
    "dashboard:view",
    "dashboard:admin",
    "candidate:read",
    "candidate:write",
    "recruiter:csv-upload",
    "audit:read-denials",
    "admin:manage-users",
    "admin:read-import-batches",
    "admin:read-ai-usage",
    "admin:read-prompt-registry",
    "admin:manage-prompt-registry",
    "admin:view-sync-runs",
    "admin:view-sync-errors",
    "compliance:read-data-residency",
  ]),
  "compliance-officer": new Set([
    "dashboard:view",
    "candidate:read",
    "audit:read-denials",
    "compliance:read-data-residency",
  ]),
};

function hasRolePermission(role: SessionRole, action: ProtectedAction): boolean {
  return ROLE_ACTION_MAP[role].has(action);
}

type AuthorizationInput = {
  session: AuthSession | null;
  action: ProtectedAction;
  path: string;
  method: string;
  requestedTenantId?: string | null;
  traceId?: string | null;
};

async function deny(
  input: AuthorizationInput,
  reason: AuthorizationDenyReason,
  status: 401 | 403,
): Promise<AuthorizationDeny> {
  const session = input.session;

  await recordAuthorizationDenyEvent({
    traceId: input.traceId ?? crypto.randomUUID(),
    actorId: session?.actorId ?? null,
    role: session?.role ?? null,
    sessionTenantId: session?.tenantId ?? null,
    requestedTenantId: input.requestedTenantId ?? null,
    path: input.path,
    method: input.method,
    reason,
  });

  return {
    allowed: false,
    status,
    reason,
  };
}

export async function authorizeAccess(
  input: AuthorizationInput,
): Promise<AuthorizationResult> {
  const session = input.session;
  if (!session) {
    return await deny(input, "unauthenticated", 401);
  }

  const effectiveRole = await resolveEffectiveRole(session.actorId, session.role);

  if (!hasRolePermission(effectiveRole, input.action)) {
    return await deny(input, "forbidden_role", 403);
  }

  const requestedTenantId = input.requestedTenantId;
  const allowedClientIds = session.clientIds ?? [session.tenantId];
  if (requestedTenantId && !allowedClientIds.includes(requestedTenantId)) {
    return await deny(input, "tenant_mismatch", 403);
  }

  return {
    allowed: true,
  };
}