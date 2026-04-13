import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SESSION_COOKIE_NAME, authorizeAccess, validateActiveSession } from "@/modules/auth";

import UploadModeSelector from "./UploadModeSelector";

async function requireUploadSession() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
  const session = await validateActiveSession(sessionToken);

  if (!session) {
    redirect("/api/auth/login?next=%2Fdashboard%2Frecruiter%2Fupload");
  }

  const authz = await authorizeAccess({
    session,
    action: "recruiter:csv-upload",
    path: "/dashboard/recruiter/upload",
    method: "GET",
  });

  if (!authz.allowed) {
    redirect("/dashboard?error=recruiter-upload-forbidden");
  }

  return session;
}

export default async function RecruiterUploadPage() {
  const session = await requireUploadSession();

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-cbl-navy shadow-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <nav className="flex items-center gap-2 text-base font-medium">
              <Link href="/dashboard" className="text-cbl-light hover:text-white">Dashboard</Link>
              <span className="text-cbl-light/40">/</span>
              <span className="text-white">Candidate Upload</span>
            </nav>
            <p className="mt-1 text-sm text-cbl-light/70">
              Signed in as {session.email}. Upload candidate data via CSV or PDF resumes.
            </p>
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
        <UploadModeSelector />
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
