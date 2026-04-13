import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE_NAME, authorizeAccess, validateActiveSession } from "@/modules/auth";
import { registerOrSyncUserFromSession, resolveEffectiveRole } from "@/modules/admin";

type DashboardSearchParams = {
  activeClientId?: string | string[];
};

function getAllowedClientIds(session: Awaited<ReturnType<typeof requireSession>>): string[] {
  const unique = new Set(session.clientIds ?? [session.tenantId]);
  unique.add(session.tenantId);
  return [...unique];
}

function pickActiveClientId(
  session: Awaited<ReturnType<typeof requireSession>>,
  searchParams: DashboardSearchParams,
): string {
  const allowed = new Set(getAllowedClientIds(session));
  const requestedRaw = Array.isArray(searchParams.activeClientId)
    ? searchParams.activeClientId[0]
    : searchParams.activeClientId;
  const requested = typeof requestedRaw === "string" ? requestedRaw.trim() : "";

  if (requested.length > 0 && allowed.has(requested)) {
    return requested;
  }

  return session.tenantId;
}

async function requireSession() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
  const session = await validateActiveSession(sessionToken);

  if (!session) {
    await authorizeAccess({
      session: null,
      action: "dashboard:view",
      path: "/dashboard",
      method: "GET",
    });
    redirect("/api/auth/login?next=%2Fdashboard");
  }

  const authz = await authorizeAccess({
    session,
    action: "dashboard:view",
    path: "/dashboard",
    method: "GET",
  });

  if (!authz.allowed) {
    redirect("/?error=forbidden");
  }

  return session;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<DashboardSearchParams>;
}) {
  const session = await requireSession();
  const resolvedSearchParams = (await searchParams) ?? {};
  const activeClientId = pickActiveClientId(session, resolvedSearchParams);
  const allowedClientIds = getAllowedClientIds(session);

  await registerOrSyncUserFromSession(session);
  const effectiveRole = await resolveEffectiveRole(session.actorId, session.role);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-cbl-navy shadow-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-cbl-light/70">CBL Aero</p>
            <h1 className="mt-1 text-xl font-bold text-white">Operations Dashboard</h1>
          </div>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="rounded-lg border border-white/30 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
            >
              Sign Out
            </button>
          </form>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        {/* Info cards */}
        <section className="grid gap-4 sm:grid-cols-3">
          <article className="rounded-xl border border-gray-200 bg-gray-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Email</p>
            <p className="mt-2 text-sm font-medium text-gray-900">{session.email}</p>
          </article>
          <article className="rounded-xl border border-gray-200 bg-gray-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Role</p>
            <p className="mt-2 text-sm font-medium text-gray-900">{effectiveRole}</p>
          </article>
          <article className="rounded-xl border border-gray-200 bg-gray-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Active Client</p>
            <p className="mt-2 text-sm font-medium text-gray-900">{activeClientId}</p>
          </article>
        </section>

        {/* Client switcher */}
        {allowedClientIds.length > 1 ? (
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Switch Active Client</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {allowedClientIds.map((clientId) => (
                <Link
                  key={clientId}
                  href={`/dashboard?activeClientId=${encodeURIComponent(clientId)}`}
                  className={`rounded-full border px-3 py-1 text-sm transition ${
                    clientId === activeClientId
                      ? "border-cbl-blue bg-cbl-blue/10 font-medium text-cbl-blue"
                      : "border-gray-300 text-gray-600 hover:border-cbl-blue hover:text-cbl-blue"
                  }`}
                >
                  {clientId}
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {/* Status banner */}
        <div className="mt-6 rounded-xl border border-cbl-blue/30 bg-cbl-blue/10 p-5 text-sm text-cbl-navy">
          Enterprise access is active. Continue to module workflows and API operations from
          this protected workspace.
        </div>

        {/* Navigation links */}
        <nav className="mt-6 rounded-xl border border-gray-200 p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Quick Links</p>
          <div className="flex flex-wrap gap-4">
            <Link href="/" className="text-base font-medium text-cbl-blue hover:text-cbl-blue/80">
              Return to Home
            </Link>
            {effectiveRole === "recruiter" ||
            effectiveRole === "delivery-head" ||
            effectiveRole === "admin" ? (
              <>
                <Link
                  href="/dashboard/recruiter/candidates"
                  className="text-base font-medium text-cbl-blue hover:text-cbl-blue/80"
                >
                  Candidates
                </Link>
                <Link
                  href={`/dashboard/recruiter/upload?activeClientId=${encodeURIComponent(activeClientId)}`}
                  className="text-base font-medium text-cbl-blue hover:text-cbl-blue/80"
                >
                  Candidate Upload
                </Link>
              </>
            ) : null}
            {effectiveRole === "admin" ? (
              <Link
                href={`/dashboard/admin?activeClientId=${encodeURIComponent(activeClientId)}`}
                className="text-base font-medium text-cbl-blue hover:text-cbl-blue/80"
              >
                Admin Console
              </Link>
            ) : null}
          </div>
        </nav>
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