"use client";

import { FormEvent, useMemo, useState } from "react";

import type { GovernanceInvitation, ManagedUser } from "@/modules/admin";
import type { AdminActionEvent, StepUpAttemptEvent } from "@/modules/audit";
import type { SessionRole } from "@/modules/auth";

type GovernancePayload = {
  users: ManagedUser[];
  invitations: GovernanceInvitation[];
  adminActions: AdminActionEvent[];
  stepUpAttempts: StepUpAttemptEvent[];
};

type Props = {
  tenantId: string;
  initialPayload: GovernancePayload;
};

const ALL_ROLES: SessionRole[] = [
  "recruiter",
  "delivery-head",
  "admin",
  "compliance-officer",
];

type ParsedError = {
  code: string | null;
  message: string;
  reauthenticateUrl: string | null;
};

async function parseError(response: Response): Promise<ParsedError> {
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; reauthenticateUrl?: string };
    };
    return {
      code: body.error?.code ?? null,
      message: body.error?.message ?? "Request failed.",
      reauthenticateUrl: typeof body.error?.reauthenticateUrl === "string" ? body.error.reauthenticateUrl : null,
    };
  } catch {
    return { code: null, message: "Request failed.", reauthenticateUrl: null };
  }
}

export default function AdminGovernanceConsole({ tenantId, initialPayload }: Props) {
  const [payload, setPayload] = useState(initialPayload);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [stepUpUrl, setStepUpUrl] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<SessionRole>("recruiter");
  const [inviteTeams, setInviteTeams] = useState("");

  const [roleTargetActorId, setRoleTargetActorId] = useState("");
  const [roleValue, setRoleValue] = useState<SessionRole>("recruiter");

  const [teamTargetActorId, setTeamTargetActorId] = useState("");
  const [teamValues, setTeamValues] = useState("");

  const knownActorIds = useMemo(
    () => payload.users.map((u) => u.actorId).sort((a, b) => a.localeCompare(b)),
    [payload.users],
  );

  async function refreshGovernance() {
    const response = await fetch(`/api/internal/admin/governance?tenantId=${encodeURIComponent(tenantId)}`, { method: "GET", cache: "no-store" });
    if (!response.ok) { const p = await parseError(response); throw new Error(p.message); }
    const body = (await response.json()) as { data?: GovernancePayload };
    if (!body.data) throw new Error("Governance payload missing.");
    setPayload(body.data);
  }

  async function submitAction(body: Record<string, unknown>, successMsg: string) {
    setBusy(true); setError(""); setMessage(""); setStepUpUrl(null);
    try {
      const response = await fetch("/api/internal/admin/governance", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      if (!response.ok) {
        const p = await parseError(response);
        if (p.code === "step_up_required" && p.reauthenticateUrl) setStepUpUrl(p.reauthenticateUrl);
        throw new Error(p.message);
      }
      const json = (await response.json()) as { data?: { governance?: GovernancePayload } };
      if (json.data?.governance) setPayload(json.data.governance);
      else await refreshGovernance();
      setMessage(successMsg);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown failure."); }
    finally { setBusy(false); }
  }

  async function handleRefresh() {
    setBusy(true); setError(""); setMessage(""); setStepUpUrl(null);
    try { await refreshGovernance(); setMessage("Refreshed."); }
    catch (e) { setError(e instanceof Error ? e.message : "Refresh failed."); }
    finally { setBusy(false); }
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    await submitAction({ action: "invite_user", email: inviteEmail, role: inviteRole, teamIds: inviteTeams }, "Invitation created.");
    setInviteEmail(""); setInviteTeams("");
  }

  async function handleAssignRole(e: FormEvent) {
    e.preventDefault();
    await submitAction({ action: "assign_role", targetActorId: roleTargetActorId, role: roleValue }, "Role updated.");
  }

  async function handleTeams(e: FormEvent) {
    e.preventDefault();
    await submitAction({ action: "update_team_membership", targetActorId: teamTargetActorId, teamIds: teamValues }, "Teams updated.");
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">User Management</h2>
        <button type="button" onClick={handleRefresh} disabled={busy}
          className="rounded-lg border border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50">
          Refresh
        </button>
      </div>

      {message && <p className="rounded-xl border border-green-200 bg-green-50 px-3 py-1.5 text-sm text-green-700">{message}</p>}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700">
          <p>{error}</p>
          {stepUpUrl && <p className="mt-1 text-xs">Re-authenticate: <a href={stepUpUrl} className="underline text-red-600">Continue to SSO</a></p>}
        </div>
      )}

      {/* Actions row — compact 3-column */}
      <div className="grid gap-3 md:grid-cols-3">
        <form onSubmit={handleInvite} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <h3 className="text-xs font-semibold text-gray-700">Invite User</h3>
          <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required type="email" placeholder="email@cblsolutions.com"
            className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 placeholder:text-gray-400" />
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as SessionRole)}
            className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800">
            {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input value={inviteTeams} onChange={(e) => setInviteTeams(e.target.value)} placeholder="team-east, team-red"
            className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 placeholder:text-gray-400" />
          <button disabled={busy} type="submit"
            className="mt-2 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            Send Invite
          </button>
        </form>

        <form onSubmit={handleAssignRole} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <h3 className="text-xs font-semibold text-gray-700">Assign Role</h3>
          <input list="known-actor-ids" value={roleTargetActorId} onChange={(e) => setRoleTargetActorId(e.target.value)} required placeholder="actor-id"
            className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 placeholder:text-gray-400" />
          <select value={roleValue} onChange={(e) => setRoleValue(e.target.value as SessionRole)}
            className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800">
            {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button disabled={busy} type="submit"
            className="mt-2 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            Apply
          </button>
        </form>

        <form onSubmit={handleTeams} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <h3 className="text-xs font-semibold text-gray-700">Update Teams</h3>
          <input list="known-actor-ids" value={teamTargetActorId} onChange={(e) => setTeamTargetActorId(e.target.value)} required placeholder="actor-id"
            className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 placeholder:text-gray-400" />
          <input value={teamValues} onChange={(e) => setTeamValues(e.target.value)} placeholder="team-east, team-red"
            className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 placeholder:text-gray-400" />
          <button disabled={busy} type="submit"
            className="mt-2 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            Save
          </button>
        </form>
      </div>

      <datalist id="known-actor-ids">
        {knownActorIds.map((id) => <option key={id} value={id} />)}
      </datalist>

      {/* Users + Invitations side by side */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Users ({payload.users.length})
          </h3>
          <table className="w-full text-left text-sm text-gray-700">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase text-gray-400">
                <th className="pb-1 pr-2">Email</th>
                <th className="pb-1 pr-2">Role</th>
                <th className="pb-1 pr-2">Teams</th>
              </tr>
            </thead>
            <tbody>
              {payload.users.length === 0 ? (
                <tr><td colSpan={3} className="py-2 text-gray-400">No users yet.</td></tr>
              ) : payload.users.map((u) => (
                <tr key={u.actorId} className="border-b border-gray-100">
                  <td className="py-1.5 pr-2">{u.email}</td>
                  <td className="py-1.5 pr-2 font-medium">{u.role}</td>
                  <td className="py-1.5 pr-2 text-gray-400">{u.teamIds.join(", ") || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Pending Invitations ({payload.invitations.length})
          </h3>
          <table className="w-full text-left text-sm text-gray-700">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase text-gray-400">
                <th className="pb-1 pr-2">Email</th>
                <th className="pb-1 pr-2">Role</th>
                <th className="pb-1">Expires</th>
              </tr>
            </thead>
            <tbody>
              {payload.invitations.length === 0 ? (
                <tr><td colSpan={3} className="py-2 text-gray-400">No pending invitations.</td></tr>
              ) : payload.invitations.map((inv) => (
                <tr key={inv.invitationId} className="border-b border-gray-100">
                  <td className="py-1.5 pr-2">{inv.email}</td>
                  <td className="py-1.5 pr-2 font-medium">{inv.role}</td>
                  <td className="py-1.5 text-xs text-gray-400">{inv.expiresAtIso?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
