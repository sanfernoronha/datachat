// app/page.tsx
//
// Landing page / session dashboard.
//
// Renders a list of existing sessions and a form to create a new one.
// All data is fetched server-side — no client JS required for the initial load.

// Force dynamic rendering — this page queries the database on every request
// and cannot be statically generated at build time.
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import NewSessionForm from "@/components/session/new-session-form";
import SessionList from "@/components/session/session-list";

// Fetch all sessions from the database (server component — runs on the server)
async function getSessions() {
  return prisma.session.findMany({
    orderBy: { lastActive: "desc" },
    include: {
      _count: { select: { messages: true, uploadedFiles: true } },
      uploadedFiles: { select: { filename: true } },
    },
  });
}

export default async function HomePage() {
  const sessions = await getSessions();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ── */}
      <header className="border-b bg-white px-6 py-4">
        <div className="mx-auto max-w-5xl flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">DataChat</h1>
            <p className="text-sm text-gray-500">
              AI-powered data analysis for biological research
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* ── Create new session ── */}
        <section className="mb-8">
          <h2 className="mb-4 text-lg font-medium text-gray-800">
            New Analysis Session
          </h2>
          <NewSessionForm />
        </section>

        {/* ── Existing sessions ── */}
        <section>
          <h2 className="mb-4 text-lg font-medium text-gray-800">
            Recent Sessions
          </h2>

          <SessionList
            sessions={sessions.map((s) => ({
              ...s,
              lastActive: s.lastActive.toISOString(),
            }))}
          />
        </section>
      </main>
    </div>
  );
}
