import type { AuthSession, SessionRole } from "../auth/session";
import { recordAdminActionEvent } from "../audit";
import {
  getSupabaseAdminClient,
  shouldUseInMemoryPersistenceForTests,
} from "../persistence";

export type ManagedUser = {
  actorId: string;
  tenantId: string;
  email: string;
  role: SessionRole;
  teamIds: string[];
  invitedAtIso: string;
  lastSeenAtIso: string;
  updatedAtIso: string;
};

export type GovernanceInvitation = {
  invitationId: string;
  tenantId: string;
  email: string;
  role: SessionRole;
  teamIds: string[];
  invitedByActorId: string;
  status: "pending";
  createdAtIso: string;
  expiresAtIso: string;
};

export type GovernanceCommandAction =
  | "invite_user"
  | "assign_role"
  | "update_team_membership";

export class AdminGovernanceError extends Error {
  code: string;
  status: 400 | 404 | 409;

  constructor(code: string, status: 400 | 404 | 409, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type InviteUserInput = {
  actorId: string;
  tenantId: string;
  email: string;
  role: SessionRole;
  teamIds: string[];
  traceId?: string | null;
};

type AssignRoleInput = {
  actorId: string;
  tenantId: string;
  targetActorId: string;
  newRole: SessionRole;
  traceId?: string | null;
};

type UpdateTeamMembershipInput = {
  actorId: string;
  tenantId: string;
  targetActorId: string;
  teamIds: string[];
  traceId?: string | null;
};

const INVITATION_TTL_DAYS = 7;

const managedUsers = new Map<string, ManagedUser>();
const invitations = new Map<string, GovernanceInvitation>();

type ManagedUserRow = {
  actor_id: string;
  tenant_id: string;
  email: string;
  role: SessionRole;
  team_ids: string[] | null;
  invited_at: string;
  last_seen_at: string;
  updated_at: string;
};

type InvitationRow = {
  invitation_id: string;
  tenant_id: string;
  email: string;
  role: SessionRole;
  team_ids: string[] | null;
  invited_by_actor_id: string;
  status: "pending";
  created_at: string;
  expires_at: string;
};

const ALLOWED_ROLE_TRANSITIONS: Record<SessionRole, ReadonlySet<SessionRole>> = {
  recruiter: new Set(["recruiter", "delivery-head", "admin"]),
  "delivery-head": new Set(["delivery-head", "recruiter", "admin"]),
  admin: new Set(["admin", "recruiter", "delivery-head", "compliance-officer"]),
  "compliance-officer": new Set(["compliance-officer", "admin"]),
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function assertNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AdminGovernanceError("validation_error", 400, `${field} is required.`);
  }

  return trimmed;
}

function normalizeTeamIds(teamIds: string[]): string[] {
  const unique = new Set<string>();

  for (const teamId of teamIds) {
    const trimmed = teamId.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.length > 64) {
      throw new AdminGovernanceError(
        "validation_error",
        400,
        "Team identifiers must be 64 characters or fewer.",
      );
    }

    unique.add(trimmed);
  }

  return [...unique].sort((left, right) => left.localeCompare(right));
}

function isInMemoryMode(): boolean {
  return shouldUseInMemoryPersistenceForTests();
}

function toManagedUser(row: ManagedUserRow): ManagedUser {
  return {
    actorId: row.actor_id,
    tenantId: row.tenant_id,
    email: row.email,
    role: row.role,
    teamIds: row.team_ids ?? [],
    invitedAtIso: row.invited_at,
    lastSeenAtIso: row.last_seen_at,
    updatedAtIso: row.updated_at,
  };
}

function toInvitation(row: InvitationRow): GovernanceInvitation {
  return {
    invitationId: row.invitation_id,
    tenantId: row.tenant_id,
    email: row.email,
    role: row.role,
    teamIds: row.team_ids ?? [],
    invitedByActorId: row.invited_by_actor_id,
    status: row.status,
    createdAtIso: row.created_at,
    expiresAtIso: row.expires_at,
  };
}

function cloneUser(user: ManagedUser): ManagedUser {
  return {
    ...user,
    teamIds: [...user.teamIds],
  };
}

function cloneInvitation(invitation: GovernanceInvitation): GovernanceInvitation {
  return {
    ...invitation,
    teamIds: [...invitation.teamIds],
  };
}

function nowIso(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString();
}

function expiresAtIso(nowMs = Date.now()): string {
  const ttlMs = INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000;
  return new Date(nowMs + ttlMs).toISOString();
}

function findUserByEmailAndTenant(email: string, tenantId: string): ManagedUser | null {
  for (const user of managedUsers.values()) {
    if (user.tenantId === tenantId && user.email === email) {
      return user;
    }
  }

  return null;
}

async function findUserByEmailAndTenantPersisted(
  email: string,
  tenantId: string,
): Promise<ManagedUser | null> {
  if (isInMemoryMode()) {
    return findUserByEmailAndTenant(email, tenantId);
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("admin_managed_users")
    .select(
      "actor_id, tenant_id, email, role, team_ids, invited_at, last_seen_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("email", email)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to query managed user by email: ${error.message}`);
  }

  return data ? toManagedUser(data as ManagedUserRow) : null;
}

function findPendingInvitation(email: string, tenantId: string): GovernanceInvitation | null {
  for (const invitation of invitations.values()) {
    if (
      invitation.tenantId === tenantId &&
      invitation.email === email &&
      invitation.status === "pending"
    ) {
      return invitation;
    }
  }

  return null;
}

async function findPendingInvitationPersisted(
  email: string,
  tenantId: string,
): Promise<GovernanceInvitation | null> {
  if (isInMemoryMode()) {
    return findPendingInvitation(email, tenantId);
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("admin_invitations")
    .select(
      "invitation_id, tenant_id, email, role, team_ids, invited_by_actor_id, status, created_at, expires_at",
    )
    .eq("tenant_id", tenantId)
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to query pending invitation: ${error.message}`);
  }

  return data ? toInvitation(data as InvitationRow) : null;
}

async function getManagedUserOrThrow(
  targetActorId: string,
  tenantId: string,
): Promise<ManagedUser> {
  if (isInMemoryMode()) {
    const target = managedUsers.get(targetActorId);
    if (!target || target.tenantId !== tenantId) {
      throw new AdminGovernanceError(
        "target_not_found",
        404,
        "Target user does not exist in this tenant.",
      );
    }

    return target;
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("admin_managed_users")
    .select(
      "actor_id, tenant_id, email, role, team_ids, invited_at, last_seen_at, updated_at",
    )
    .eq("actor_id", targetActorId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to query managed user: ${error.message}`);
  }

  if (!data) {
    throw new AdminGovernanceError(
      "target_not_found",
      404,
      "Target user does not exist in this tenant.",
    );
  }

  return toManagedUser(data as ManagedUserRow);
}

export function isRoleTransitionAllowed(fromRole: SessionRole, toRole: SessionRole): boolean {
  return ALLOWED_ROLE_TRANSITIONS[fromRole].has(toRole);
}

export async function registerOrSyncUserFromSession(session: AuthSession): Promise<ManagedUser> {
  if (!isInMemoryMode()) {
    const client = getSupabaseAdminClient();
    const now = nowIso();

    const { data: existingRow, error: existingError } = await client
      .from("admin_managed_users")
      .select(
        "actor_id, tenant_id, email, role, team_ids, invited_at, last_seen_at, updated_at",
      )
      .eq("actor_id", session.actorId)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to query managed user by actor: ${existingError.message}`);
    }

    if (existingRow) {
      const { data: updatedRow, error: updateError } = await client
        .from("admin_managed_users")
        .update({
          tenant_id: session.tenantId,
          email: normalizeEmail(session.email),
          last_seen_at: now,
          updated_at: now,
        })
        .eq("actor_id", session.actorId)
        .select(
          "actor_id, tenant_id, email, role, team_ids, invited_at, last_seen_at, updated_at",
        )
        .single();

      if (updateError) {
        throw new Error(`Failed to update managed user: ${updateError.message}`);
      }

      return toManagedUser(updatedRow as ManagedUserRow);
    }

    const inserted: ManagedUserRow = {
      actor_id: session.actorId,
      tenant_id: session.tenantId,
      email: normalizeEmail(session.email),
      role: session.role,
      team_ids: [],
      invited_at: now,
      last_seen_at: now,
      updated_at: now,
    };

    const { data: insertedRow, error: insertError } = await client
      .from("admin_managed_users")
      .insert(inserted)
      .select("actor_id, tenant_id, email, role, team_ids, invited_at, last_seen_at, updated_at")
      .single();

    if (insertError) {
      throw new Error(`Failed to insert managed user: ${insertError.message}`);
    }

    return toManagedUser(insertedRow as ManagedUserRow);
  }

  const existing = managedUsers.get(session.actorId);
  const now = nowIso();

  if (existing) {
    existing.tenantId = session.tenantId;
    existing.email = normalizeEmail(session.email);
    existing.lastSeenAtIso = now;
    existing.updatedAtIso = now;
    managedUsers.set(existing.actorId, existing);
    return cloneUser(existing);
  }

  const created: ManagedUser = {
    actorId: session.actorId,
    tenantId: session.tenantId,
    email: normalizeEmail(session.email),
    role: session.role,
    teamIds: [],
    invitedAtIso: now,
    lastSeenAtIso: now,
    updatedAtIso: now,
  };

  managedUsers.set(created.actorId, created);
  return cloneUser(created);
}

export async function resolveEffectiveRole(
  actorId: string,
  fallbackRole: SessionRole,
): Promise<SessionRole> {
  if (!isInMemoryMode()) {
    const client = getSupabaseAdminClient();
    const { data, error } = await client
      .from("admin_managed_users")
      .select("role")
      .eq("actor_id", actorId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to resolve effective role: ${error.message}`);
    }

    if (!data) {
      return fallbackRole;
    }

    return data.role as SessionRole;
  }

  const managed = managedUsers.get(actorId);
  if (!managed) {
    return fallbackRole;
  }

  return managed.role;
}

export async function listManagedUsersByTenant(tenantId: string): Promise<ManagedUser[]> {
  if (!isInMemoryMode()) {
    const client = getSupabaseAdminClient();
    const { data, error } = await client
      .from("admin_managed_users")
      .select("actor_id, tenant_id, email, role, team_ids, invited_at, last_seen_at, updated_at")
      .eq("tenant_id", tenantId)
      .order("email", { ascending: true });

    if (error) {
      throw new Error(`Failed to list managed users: ${error.message}`);
    }

    return (data ?? []).map((row) => toManagedUser(row as ManagedUserRow));
  }

  const users = [...managedUsers.values()]
    .filter((user) => user.tenantId === tenantId)
    .sort((left, right) => left.email.localeCompare(right.email));

  return users.map(cloneUser);
}

export async function listInvitationsByTenant(
  tenantId: string,
): Promise<GovernanceInvitation[]> {
  if (!isInMemoryMode()) {
    const client = getSupabaseAdminClient();
    const { data, error } = await client
      .from("admin_invitations")
      .select(
        "invitation_id, tenant_id, email, role, team_ids, invited_by_actor_id, status, created_at, expires_at",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to list invitations: ${error.message}`);
    }

    return (data ?? []).map((row) => toInvitation(row as InvitationRow));
  }

  const tenantInvitations = [...invitations.values()]
    .filter((invitation) => invitation.tenantId === tenantId)
    .sort((left, right) => right.createdAtIso.localeCompare(left.createdAtIso));

  return tenantInvitations.map(cloneInvitation);
}

export async function inviteUser(input: InviteUserInput): Promise<GovernanceInvitation> {
  const actorId = assertNonEmpty(input.actorId, "actorId");
  const tenantId = assertNonEmpty(input.tenantId, "tenantId");
  const email = normalizeEmail(assertNonEmpty(input.email, "email"));
  const teamIds = normalizeTeamIds(input.teamIds);

  if (await findUserByEmailAndTenantPersisted(email, tenantId)) {
    throw new AdminGovernanceError(
      "already_exists",
      409,
      "A managed user with that email already exists in this tenant.",
    );
  }

  if (await findPendingInvitationPersisted(email, tenantId)) {
    throw new AdminGovernanceError(
      "invitation_exists",
      409,
      "A pending invitation for this email already exists.",
    );
  }

  const invitation: GovernanceInvitation = {
    invitationId: `inv-${crypto.randomUUID()}`,
    tenantId,
    email,
    role: input.role,
    teamIds,
    invitedByActorId: actorId,
    status: "pending",
    createdAtIso: nowIso(),
    expiresAtIso: expiresAtIso(),
  };

  if (!isInMemoryMode()) {
    const client = getSupabaseAdminClient();
    const { data, error } = await client
      .from("admin_invitations")
      .insert({
        invitation_id: invitation.invitationId,
        tenant_id: invitation.tenantId,
        email: invitation.email,
        role: invitation.role,
        team_ids: invitation.teamIds,
        invited_by_actor_id: invitation.invitedByActorId,
        status: invitation.status,
        created_at: invitation.createdAtIso,
        expires_at: invitation.expiresAtIso,
      })
      .select(
        "invitation_id, tenant_id, email, role, team_ids, invited_by_actor_id, status, created_at, expires_at",
      )
      .single();

    if (error) {
      throw new Error(`Failed to create invitation: ${error.message}`);
    }

    const persisted = toInvitation(data as InvitationRow);
    await recordAdminActionEvent({
      traceId: input.traceId ?? crypto.randomUUID(),
      actorId,
      tenantId,
      targetActorId: null,
      actionType: "invite_user",
      details: {
        email,
        role: persisted.role,
        teamCount: persisted.teamIds.length,
      },
    });

    return persisted;
  }

  invitations.set(invitation.invitationId, invitation);

  await recordAdminActionEvent({
    traceId: input.traceId ?? crypto.randomUUID(),
    actorId,
    tenantId,
    targetActorId: null,
    actionType: "invite_user",
    details: {
      email,
      role: invitation.role,
      teamCount: invitation.teamIds.length,
    },
  });

  return cloneInvitation(invitation);
}

export async function assignUserRole(input: AssignRoleInput): Promise<ManagedUser> {
  const actorId = assertNonEmpty(input.actorId, "actorId");
  const tenantId = assertNonEmpty(input.tenantId, "tenantId");
  const targetActorId = assertNonEmpty(input.targetActorId, "targetActorId");

  const target = await getManagedUserOrThrow(targetActorId, tenantId);
  if (!isRoleTransitionAllowed(target.role, input.newRole)) {
    throw new AdminGovernanceError(
      "invalid_role_transition",
      400,
      `Role transition from ${target.role} to ${input.newRole} is not permitted.`,
    );
  }

  const previousRole = target.role;
  target.role = input.newRole;
  target.updatedAtIso = nowIso();
  if (!isInMemoryMode()) {
    const client = getSupabaseAdminClient();
    const { data, error } = await client
      .from("admin_managed_users")
      .update({
        role: target.role,
        updated_at: target.updatedAtIso,
      })
      .eq("actor_id", target.actorId)
      .eq("tenant_id", tenantId)
      .select("actor_id, tenant_id, email, role, team_ids, invited_at, last_seen_at, updated_at")
      .single();

    if (error) {
      throw new Error(`Failed to assign role: ${error.message}`);
    }

    await recordAdminActionEvent({
      traceId: input.traceId ?? crypto.randomUUID(),
      actorId,
      tenantId,
      targetActorId,
      actionType: "assign_role",
      details: {
        previousRole,
        newRole: target.role,
      },
    });

    return toManagedUser(data as ManagedUserRow);
  }

  managedUsers.set(target.actorId, target);

  await recordAdminActionEvent({
    traceId: input.traceId ?? crypto.randomUUID(),
    actorId,
    tenantId,
    targetActorId,
    actionType: "assign_role",
    details: {
      previousRole,
      newRole: target.role,
    },
  });

  return cloneUser(target);
}

export async function updateUserTeamMembership(
  input: UpdateTeamMembershipInput,
): Promise<ManagedUser> {
  const actorId = assertNonEmpty(input.actorId, "actorId");
  const tenantId = assertNonEmpty(input.tenantId, "tenantId");
  const targetActorId = assertNonEmpty(input.targetActorId, "targetActorId");

  const normalizedTeamIds = normalizeTeamIds(input.teamIds);
  const target = await getManagedUserOrThrow(targetActorId, tenantId);

  target.teamIds = normalizedTeamIds;
  target.updatedAtIso = nowIso();
  if (!isInMemoryMode()) {
    const client = getSupabaseAdminClient();
    const { data, error } = await client
      .from("admin_managed_users")
      .update({
        team_ids: normalizedTeamIds,
        updated_at: target.updatedAtIso,
      })
      .eq("actor_id", target.actorId)
      .eq("tenant_id", tenantId)
      .select("actor_id, tenant_id, email, role, team_ids, invited_at, last_seen_at, updated_at")
      .single();

    if (error) {
      throw new Error(`Failed to update team membership: ${error.message}`);
    }

    await recordAdminActionEvent({
      traceId: input.traceId ?? crypto.randomUUID(),
      actorId,
      tenantId,
      targetActorId,
      actionType: "update_team_membership",
      details: {
        teamCount: normalizedTeamIds.length,
      },
    });

    return toManagedUser(data as ManagedUserRow);
  }

  managedUsers.set(target.actorId, target);

  await recordAdminActionEvent({
    traceId: input.traceId ?? crypto.randomUUID(),
    actorId,
    tenantId,
    targetActorId,
    actionType: "update_team_membership",
    details: {
      teamCount: normalizedTeamIds.length,
    },
  });

  return cloneUser(target);
}

export async function clearAdminGovernanceStoreForTest(): Promise<void> {
  if (isInMemoryMode()) {
    managedUsers.clear();
    invitations.clear();
    return;
  }

  const client = getSupabaseAdminClient();
  const { error: usersError } = await client
    .from("admin_managed_users")
    .delete()
    .neq("actor_id", "");
  if (usersError) {
    throw new Error(`Failed to clear managed users: ${usersError.message}`);
  }

  const { error: invitationError } = await client
    .from("admin_invitations")
    .delete()
    .neq("invitation_id", "");
  if (invitationError) {
    throw new Error(`Failed to clear invitations: ${invitationError.message}`);
  }
}
