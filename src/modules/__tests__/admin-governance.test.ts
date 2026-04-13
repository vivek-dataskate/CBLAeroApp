import { beforeEach, describe, expect, it } from "vitest";

import {
  assignUserRole,
  clearAdminGovernanceStoreForTest,
  inviteUser,
  isRoleTransitionAllowed,
  registerOrSyncUserFromSession,
  updateUserTeamMembership,
} from "../admin";
import { clearAdminActionEventsForTest, listAdminActionEvents } from "../audit";

describe("story 1.4 admin governance module", () => {
  beforeEach(async () => {
    await clearAdminGovernanceStoreForTest();
    await clearAdminActionEventsForTest();
  });

  it("validates role transitions", () => {
    expect(isRoleTransitionAllowed("recruiter", "admin")).toBe(true);
    expect(isRoleTransitionAllowed("compliance-officer", "recruiter")).toBe(false);
  });

  it("creates invitation and records admin action", async () => {
    const invitation = await inviteUser({
      actorId: "admin-1",
      tenantId: "tenant-a",
      email: "new.user@cblsolutions.com",
      role: "recruiter",
      teamIds: ["team-east", "team-east", " team-red "],
      traceId: "trace-invite-1",
    });

    expect(invitation.email).toBe("new.user@cblsolutions.com");
    expect(invitation.teamIds).toEqual(["team-east", "team-red"]);

    const actions = await listAdminActionEvents();
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      traceId: "trace-invite-1",
      actionType: "invite_user",
      tenantId: "tenant-a",
      actorId: "admin-1",
    });
  });

  it("assigns role and updates teams for tenant user", async () => {
    await registerOrSyncUserFromSession({
      sessionId: "session-1",
      actorId: "actor-1",
      email: "recruiter@cblsolutions.com",
      tenantId: "tenant-a",
      role: "recruiter",
      rememberDevice: false,
      issuedAtEpochSec: 1,
      expiresAtEpochSec: 2,
    });

    const reassigned = await assignUserRole({
      actorId: "admin-1",
      tenantId: "tenant-a",
      targetActorId: "actor-1",
      newRole: "delivery-head",
      traceId: "trace-role-1",
    });

    expect(reassigned.role).toBe("delivery-head");

    const withTeams = await updateUserTeamMembership({
      actorId: "admin-1",
      tenantId: "tenant-a",
      targetActorId: "actor-1",
      teamIds: ["team-west", "team-north"],
      traceId: "trace-teams-1",
    });

    expect(withTeams.teamIds).toEqual(["team-north", "team-west"]);

    const actions = await listAdminActionEvents();
    expect(actions).toHaveLength(2);
    expect(actions.map((entry) => entry.actionType)).toEqual([
      "assign_role",
      "update_team_membership",
    ]);
  });
});
