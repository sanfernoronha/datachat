// app/page.tsx
//
// Landing page / session dashboard.

export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import NewSessionForm from "@/components/session/new-session-form";
import SessionList from "@/components/session/session-list";

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
    <div className="min-h-screen bg-[#f8f6f6] flex flex-col">
      {/* ── Header ── */}
      <header className="flex items-center justify-between border-b border-gray-200 px-6 py-4 bg-white">
        <div className="flex items-center gap-3">
          <div className="bg-primary text-white p-2 rounded-lg flex items-center justify-center">
            <span className="material-symbols-outlined">analytics</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-gray-900">DataChat</h1>
        </div>
      </header>

      <main className="flex-1 px-6 md:px-10 py-6 max-w-[1100px] mx-auto w-full space-y-12">
        {/* ── Hero: New Session ── */}
        <section className="max-w-3xl mx-auto text-center space-y-8 py-10">
          <div className="space-y-3">
            <h2 className="text-4xl font-extrabold tracking-tight text-gray-900">
              Start a New Analysis
            </h2>
            <p className="text-gray-500 text-lg">
              Upload your datasets or connect a database to begin chatting with your data.
            </p>
          </div>
          <NewSessionForm />
        </section>

        {/* ── Recent Sessions ── */}
        <section className="space-y-6">
          <SessionList
            sessions={sessions.map((s) => ({
              ...s,
              lastActive: s.lastActive.toISOString(),
            }))}
          />
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="mt-auto border-t border-gray-200 py-6 px-6 text-center text-sm text-gray-400">
        <p>&copy; 2026 DataChat AI. All rights reserved.</p>
      </footer>
    </div>
  );
}
