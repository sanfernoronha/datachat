"use client";
// components/session/new-session-form.tsx
//
// A simple form to create a new analysis session.
// On submit, POSTs to /api/sessions and redirects to the new session page.
//
// Client component — uses React state for the input and router for navigation.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

export default function NewSessionForm() {
  const router = useRouter();
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
      // Navigate to the new session's chat page
      router.push(`/sessions/${session.id}`);
    } catch {
      setError("Could not create session. Is the database running?");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-3">
      <Input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Session name (e.g. TCGA Breast Cancer Analysis)"
        className="flex-1 shadow-sm"
        disabled={loading}
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Creating…" : "New Session"}
      </button>

      {/* Inline error — avoids a full page flash for a simple form failure */}
      {error && (
        <p className="self-center text-sm text-red-600">{error}</p>
      )}
    </form>
  );
}
