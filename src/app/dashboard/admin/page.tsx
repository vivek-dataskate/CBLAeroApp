import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE_NAME, authorizeAccess, validateActiveSession } from "@/modules/auth";
import {
  listInvitationsByTenant,
  listManagedUsersByTenant,
  registerOrSyncUserFromSession,
} from "@/modules/admin";
import { listAdminActionEvents, listStepUpAttemptEvents } from "@/modules/audit";

import AdminGovernanceConsole from "./AdminGovernanceConsole";
import AiCostDashboard from "./AiCostDashboard";
import SyncRunSummaryCard from "./SyncRunSummaryCard";

type AdminDashboardSearchParams = {
  activeClientId?: string | string[];
};

function getAllowedClientIds(session: Awaited<ReturnType<typeof requireAdminSession>>): string[] {
  const unique = new Set(session.clientIds ?? [session.tenantId]);
  unique.add(session.tenantId);
  return [...unique];
}

function pickActiveClientId(
  session: Awaited<ReturnType<typeof requireAdminSession>>,
  searchParams: AdminDashboardSearchParams,
): string {
  const allowed = new Set(getAllowedClientIds(session));
  const requestedRaw = Array.isArray(searchParams.activeClientId)
    ? searchParams.activeClientId[0]
    : searchParams.activeClientId;
  const requested = typeof requestedRaw === "string" ? requestedRaw.trim() : "";
  if (requested.length > 0 && allowed.has(requested)) return requested;
  return session.tenantId;
}

async function requireAdminSession() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
  const session = await validateActiveSession(sessionToken);

  if (!session) {
    await authorizeAccess({ session: null, action: "dashboard:admin", path: "/dashboard/admin", method: "GET" });
    redirect("/api/auth/login?next=%2Fdashboard%2Fadmin");
  }

  const authz = await authorizeAccess({ session, action: "dashboard:admin", path: "/dashboard/admin", method: "GET" });
  if (!authz.allowed) redirect("/dashboard?error=admin-forbidden");
  return session;
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<AdminDashboardSearchParams>;
}) {
  const session = await requireAdminSession();
  const resolvedSearchParams = (await searchParams) ?? {};
  const activeClientId = pickActiveClientId(session, resolvedSearchParams);
  const allowedClientIds = getAllowedClientIds(session);

  await registerOrSyncUserFromSession(session);

  const users = await listManagedUsersByTenant(activeClientId);
  const invitations = await listInvitationsByTenant(activeClientId);
  const adminActions = (await listAdminActionEvents())
    .filter((event) => event.tenantId === activeClientId)
    .slice(-50)
    .reverse();
  const stepUpAttempts = (await listStepUpAttemptEvents())
    .filter((event) => event.tenantId === activeClientId)
    .slice(-50)
    .reverse();
  const traceId = crypto.randomUUID();
  const auditCount = adminActions.length + stepUpAttempts.length;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-cbl-navy shadow-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <nav className="flex items-center gap-2 text-base font-medium">
              <Link href={`/dashboard?activeClientId=${encodeURIComponent(activeClientId)}`} className="text-cbl-light hover:text-white">Dashboard</Link>
              <span className="text-cbl-light/40">/</span>
              <span className="text-white">Admin Console</span>
            </nav>
            <p className="mt-1 text-sm text-cbl-light/70">{session.email} &middot; {session.role}</p>
          </div>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="rounded-lg border border-white/30 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10">
              Sign Out
            </button>
          </form>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        {/* Client switcher + Quick links row */}
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 px-5 py-3">
          {allowedClientIds.length > 1 && (
            <div className="flex items-center gap-2">
              {allowedClientIds.map((cid) => (
                <Link
                  key={cid}
                  href={`/dashboard/admin?activeClientId=${encodeURIComponent(cid)}`}
                  className={`rounded-full border px-3 py-1 text-sm transition ${cid === activeClientId ? "border-cbl-blue/40 bg-cbl-blue/10 font-medium text-cbl-blue" : "border-gray-300 text-gray-500 hover:border-cbl-blue/40"}`}
                >{cid}</Link>
              ))}
              <span className="text-gray-300">|</span>
            </div>
          )}
          <Link href="/dashboard/recruiter/candidates" className="text-sm font-medium text-cbl-navy hover:text-cbl-blue">Candidates</Link>
          <span className="text-gray-300">|</span>
          <Link href="/dashboard/admin/dedup" className="text-sm font-medium text-cbl-navy hover:text-cbl-blue">Dedup Review</Link>
          <span className="text-gray-300">|</span>
          <AuditLink count={auditCount} adminActions={adminActions} stepUpAttempts={stepUpAttempts} />
          <span className="flex-1" />
        </div>

        {/* Two-column: Errors + AI costs */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <SyncRunSummaryCard />
          </Card>
          <Card>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">AI Costs</h3>
            <AiCostDashboard />
          </Card>
        </div>

        {/* User governance */}
        <div className="mt-4">
          <Card>
            <AdminGovernanceConsole
              tenantId={activeClientId}
              initialPayload={{ users, invitations, adminActions, stepUpAttempts }}
            />
          </Card>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-cbl-dark">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <p className="text-sm text-cbl-light/60">CBL Aero &middot; Enterprise Portal</p>
        </div>
      </footer>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-xl border border-gray-200 bg-white p-5">{children}</section>;
}

function AuditLink({ count, adminActions, stepUpAttempts }: { count: number; adminActions: unknown[]; stepUpAttempts: unknown[] }) {
  return (
    <details className="relative inline-block">
      <summary className="cursor-pointer text-sm font-medium text-cbl-navy hover:text-cbl-blue">
        Audit Trail ({count})
      </summary>
      <div className="absolute left-0 top-8 z-50 w-80 max-h-60 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-lg">
        <p className="text-xs font-semibold text-gray-500 mb-1">Recent Admin Actions ({adminActions.length})</p>
        {adminActions.length === 0 ? (
          <p className="text-xs text-gray-400">None</p>
        ) : (
          <ul className="space-y-0.5 text-xs text-gray-600">
            {(adminActions as Array<{ action: string; actorId: string; occurredAt: string }>).slice(0, 10).map((a, i) => (
              <li key={i}><span className="text-gray-400">{a.occurredAt?.slice(5, 16).replace("T", " ")}</span> {a.action} <span className="text-gray-400">by {a.actorId?.slice(0, 12)}</span></li>
            ))}
          </ul>
        )}
        <p className="text-xs font-semibold text-gray-500 mt-2 mb-1">Step-Up Attempts ({stepUpAttempts.length})</p>
        {stepUpAttempts.length === 0 ? (
          <p className="text-xs text-gray-400">None</p>
        ) : (
          <ul className="space-y-0.5 text-xs text-gray-600">
            {(stepUpAttempts as Array<{ method: string; actorId: string; occurredAt: string; success: boolean }>).slice(0, 10).map((a, i) => (
              <li key={i}>
                <span className="text-gray-400">{a.occurredAt?.slice(5, 16).replace("T", " ")}</span>{" "}
                {a.method} {a.success ? <span className="text-green-500">ok</span> : <span className="text-red-500">fail</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
