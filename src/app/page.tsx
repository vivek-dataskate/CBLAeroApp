import Link from "next/link";
import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME, validateActiveSession } from "@/modules/auth";

async function readActiveSession() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
  return validateActiveSession(sessionToken);
}

export default async function Home() {
  const session = await readActiveSession();
  const isAuthenticated = Boolean(session);

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#203a43_0%,_#0f2027_45%,_#091014_100%)] px-6 py-10 text-slate-100 md:px-10">
      <main className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl flex-col justify-between rounded-3xl border border-cyan-300/20 bg-slate-950/55 p-8 backdrop-blur md:p-12">
        <header className="flex items-center justify-between">
          <p className="text-sm font-semibold tracking-[0.22em] text-cyan-200">CBL AERO</p>
          <p className="rounded-full border border-cyan-200/35 px-3 py-1 text-xs text-cyan-100">
            Enterprise Portal
          </p>
        </header>

        <section className="grid gap-10 md:grid-cols-2 md:items-end">
          <div className="space-y-6">
            <h1 className="text-4xl font-semibold leading-tight text-white md:text-5xl">
              Secure Recruitment Operations for Internal Teams
            </h1>
            <p className="max-w-xl text-base leading-7 text-slate-300">
              Single sign-on protected workflows for recruiters, delivery heads, compliance,
              and admins. Use Microsoft Entra login to access your dashboard.
            </p>
            {!isAuthenticated ? (
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/api/auth/login?next=%2Fdashboard"
                  className="rounded-xl bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
                >
                  Sign In
                </Link>
                <Link
                  href="/api/auth/login?remember=true&next=%2Fdashboard"
                  className="rounded-xl border border-cyan-200/45 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-100 hover:bg-cyan-500/10"
                >
                  Sign In & Remember Device
                </Link>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/dashboard"
                  className="rounded-xl bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
                >
                  Open Dashboard
                </Link>
                <form action="/api/auth/logout" method="post">
                  <button
                    type="submit"
                    className="rounded-xl border border-cyan-200/45 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-100 hover:bg-cyan-500/10"
                  >
                    Sign Out
                  </button>
                </form>
              </div>
            )}
          </div>

          <aside className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl shadow-cyan-950/50">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">Session Status</p>
            {isAuthenticated && session ? (
              <div className="mt-4 space-y-2 text-sm text-slate-200">
                <p>
                  Signed in as <span className="font-semibold text-white">{session.email}</span>
                </p>
                <p>Role: {session.role}</p>
                <p>Tenant: {session.tenantId}</p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-300">
                You are currently signed out. Please continue with Microsoft SSO.
              </p>
            )}
          </aside>
        </section>
      </main>
    </div>
  );
}
