"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";

interface SessionItem {
  id: string;
  name: string;
  lastActive: string;
  _count: { messages: number; uploadedFiles: number };
  uploadedFiles: { filename: string }[];
}

const CARD_ICONS = ["database", "monitoring", "account_tree", "bar_chart", "science"];

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export default function SessionList({ sessions: initial }: { sessions: SessionItem[] }) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initial);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"lastActive" | "name" | "files">("lastActive");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const list = q
      ? sessions.filter((s) => s.name.toLowerCase().includes(q))
      : sessions;

    return [...list].sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "files") return b._count.uploadedFiles - a._count.uploadedFiles;
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

  function handleNewSessionClick() {
    const fn = (window as unknown as Record<string, unknown>).__focusNewSessionInput;
    if (typeof fn === "function") (fn as () => void)();
  }

  return (
    <div>
      {/* Section header with search + sort */}
      <div className="flex items-center justify-between border-b border-gray-200 pb-4 mb-6">
        <div className="flex items-center gap-2">
          <h3 className="text-xl font-bold text-gray-900">Recent Sessions</h3>
          <span className="bg-gray-100 text-gray-500 text-xs font-bold px-2 py-0.5 rounded-full border border-gray-200">
            {sessions.length}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Search pill */}
          <div className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 rounded-full border border-gray-200">
            <span className="material-symbols-outlined text-gray-500" style={{ fontSize: 16 }}>search</span>
            <input
              type="text"
              placeholder="Filter..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent border-none focus:ring-0 focus:outline-none text-sm w-24 py-0 text-gray-900 placeholder:text-gray-500"
            />
          </div>
          {/* Sort dropdown */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="bg-white border-gray-200 rounded-lg text-sm font-medium text-gray-900 focus:ring-primary focus:border-primary py-2 pr-10"
          >
            <option value="lastActive">Last active</option>
            <option value="name">Alphabetical</option>
            <option value="files">File count</option>
          </select>
        </div>
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((session, idx) => (
          <div
            key={session.id}
            onClick={() => router.push(`/sessions/${session.id}`)}
            className="group bg-white border border-gray-200 rounded-2xl p-5 hover:border-primary/40 hover:shadow-lg transition-all cursor-pointer relative"
          >
            {/* Top row: icon */}
            <div className="flex justify-between items-start mb-4">
              <div className="bg-primary/10 p-2.5 rounded-xl text-primary">
                <span className="material-symbols-outlined">{CARD_ICONS[idx % CARD_ICONS.length]}</span>
              </div>
            </div>

            {/* Title + description */}
            <h4 className="text-lg font-bold text-gray-900 mb-1 group-hover:text-primary transition-colors">
              {session.name}
            </h4>
            <p className="text-sm text-gray-500 line-clamp-2 mb-4">
              {session._count.messages > 0
                ? `${session._count.messages} messages across ${session._count.uploadedFiles} dataset${session._count.uploadedFiles !== 1 ? "s" : ""}`
                : "New session \u2014 start chatting with your data"}
            </p>

            {/* File tags */}
            {session.uploadedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                {session.uploadedFiles.slice(0, 3).map((f) => (
                  <span key={f.filename} className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 bg-gray-50 text-gray-600 border border-gray-200 rounded uppercase">
                    {f.filename}
                  </span>
                ))}
                {session.uploadedFiles.length > 3 && (
                  <span className="text-[11px] font-bold px-2 py-0.5 text-gray-400">
                    +{session.uploadedFiles.length - 3} more
                  </span>
                )}
              </div>
            )}

            {/* Footer stats */}
            <div className="pt-4 border-t border-gray-100 flex items-center justify-between text-xs font-medium">
              <div className="flex items-center gap-4 text-gray-600">
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>chat_bubble</span>
                  {session._count.messages}
                </span>
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>attach_file</span>
                  {session._count.uploadedFiles}
                </span>
              </div>
              <span className="text-gray-600">{relativeTime(session.lastActive)}</span>
            </div>

            {/* Delete button — hover reveal */}
            <div className="absolute top-4 right-4" onClick={(e) => e.stopPropagation()}>
              {pendingDeleteId === session.id ? (
                <span className="flex items-center gap-1.5 text-xs bg-white rounded-lg border border-gray-200 px-2 py-1 shadow-sm">
                  <button
                    onClick={() => handleDelete(session.id)}
                    disabled={deleting}
                    className="rounded bg-red-500 px-2 py-0.5 text-white hover:bg-red-600 text-xs disabled:opacity-50"
                  >
                    {deleting ? "..." : "Delete"}
                  </button>
                  <button
                    onClick={() => setPendingDeleteId(null)}
                    className="rounded bg-gray-200 px-2 py-0.5 text-gray-700 hover:bg-gray-300 text-xs"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setPendingDeleteId(session.id)}
                  className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200"
                  title="Delete Session"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>delete</span>
                </button>
              )}
            </div>
          </div>
        ))}

        {/* New Session placeholder card — scrolls to top + focuses input */}
        <button
          onClick={handleNewSessionClick}
          className="border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center p-8 text-gray-400 hover:border-primary/50 hover:text-primary/50 transition-all cursor-pointer min-h-[200px]"
        >
          <span className="material-symbols-outlined mb-2" style={{ fontSize: 36 }}>add_circle</span>
          <span className="text-sm font-bold uppercase tracking-widest">New Session</span>
        </button>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">
          {search ? "No sessions match your search." : "No sessions yet. Create one above to get started."}
        </p>
      )}
    </div>
  );
}
