"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface SessionItem {
  id: string;
  name: string;
  lastActive: string;
  _count: { messages: number; uploadedFiles: number };
  uploadedFiles: { filename: string }[];
}

export default function SessionList({ sessions: initial }: { sessions: SessionItem[] }) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initial);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"lastActive" | "name">("lastActive");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const list = q
      ? sessions.filter((s) => s.name.toLowerCase().includes(q))
      : sessions;

    return [...list].sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime();
    });
  }, [sessions, search, sortBy]);

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        setPendingDeleteId(null);
        router.refresh();
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      {/* Search + Sort bar */}
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search sessions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "lastActive" | "name")}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="lastActive">Last Active</option>
          <option value="name">Name</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400">
          {search ? "No sessions match your search." : "No sessions yet. Create one above to get started."}
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((session) => (
            <li key={session.id} className="relative">
              <Link
                href={`/sessions/${session.id}`}
                className="flex items-center justify-between rounded-lg border bg-white px-5 py-4 shadow-sm transition hover:shadow-md"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900">{session.name}</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {session._count.uploadedFiles} file{session._count.uploadedFiles !== 1 ? "s" : ""} ·{" "}
                    {session._count.messages} message{session._count.messages !== 1 ? "s" : ""} · last active{" "}
                    {new Date(session.lastActive).toLocaleDateString()}
                  </p>
                  {session.uploadedFiles.length > 0 && (
                    <p className="mt-1 text-xs text-gray-500 truncate">
                      {session.uploadedFiles.slice(0, 3).map((f) => f.filename).join(", ")}
                      {session.uploadedFiles.length > 3 && ` +${session.uploadedFiles.length - 3} more`}
                    </p>
                  )}
                </div>

                {/* Delete button area */}
                <div className="ml-4 flex items-center gap-2 shrink-0">
                  {pendingDeleteId === session.id ? (
                    <span
                      className="flex items-center gap-2 text-xs"
                      onClick={(e) => e.preventDefault()}
                    >
                      <span className="text-gray-500">Delete?</span>
                      <button
                        onClick={(e) => { e.preventDefault(); handleDelete(session.id); }}
                        disabled={deleting}
                        className="rounded bg-red-500 px-2 py-0.5 text-white hover:bg-red-600 disabled:opacity-50"
                      >
                        {deleting ? "…" : "Yes"}
                      </button>
                      <button
                        onClick={(e) => { e.preventDefault(); setPendingDeleteId(null); }}
                        className="rounded bg-gray-200 px-2 py-0.5 text-gray-700 hover:bg-gray-300"
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={(e) => { e.preventDefault(); setPendingDeleteId(session.id); }}
                      className="rounded p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500 transition"
                      title="Delete session"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                  {pendingDeleteId !== session.id && <span className="text-gray-300">→</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
