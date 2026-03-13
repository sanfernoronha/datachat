"use client";
// components/session/new-session-form.tsx
//
// Hero-style form to create a new analysis session.

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export default function NewSessionForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "Untitled Session" }),
      });

      if (!res.ok) throw new Error("Failed to create session");

      const session = await res.json();
      router.push(`/sessions/${session.id}`);
    } catch {
      setError("Could not create session. Is the database running?");
      setLoading(false);
    }
  }

  /** Exposed so the "New Session" card can focus this input */
  function focusInput() {
    inputRef.current?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Attach to window so SessionList can call it
  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).__focusNewSessionInput = focusInput;
  }

  return (
    <div className="relative group">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col md:flex-row gap-3 p-2 bg-white rounded-2xl border border-gray-200 shadow-xl shadow-gray-200/50 transition-all focus-within:ring-2 focus-within:ring-primary/20"
      >
        <div className="flex-1 flex items-center px-4 gap-3">
          <span className="material-symbols-outlined text-gray-400">upload_file</span>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name your session (e.g. TCGA Breast Cancer Analysis)"
            className="w-full bg-transparent border-none focus:ring-0 focus:outline-none py-4 text-gray-900 placeholder:text-gray-400"
            disabled={loading}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="bg-primary hover:bg-primary/90 text-white font-bold px-8 py-4 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
        >
          <span>{loading ? "Creating..." : "Start Session"}</span>
          {!loading && (
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_forward</span>
          )}
        </button>
      </form>

      {error && (
        <p className="mt-2 text-sm text-red-600 text-center">{error}</p>
      )}
    </div>
  );
}
