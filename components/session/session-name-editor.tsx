"use client";
// components/session/session-name-editor.tsx
//
// Inline editable session name.
// Renders as plain text; click to enter edit mode, then save on Enter or blur.
// Escape cancels without saving.

import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";

interface SessionNameEditorProps {
  sessionId: string;
  initialName: string;
}

export default function SessionNameEditor({
  sessionId,
  initialName,
}: SessionNameEditorProps) {
  const [name, setName]       = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus and select-all when entering edit mode
  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
    }
  }, [editing]);

  function startEditing() {
    setDraft(name);
    setEditing(true);
  }

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      cancel();
      return;
    }

    await fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });

    setName(trimmed);
    setEditing(false);
  }

  function cancel() {
    setEditing(false);
    setDraft(name);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter")  save();
    if (e.key === "Escape") cancel();
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        className="font-semibold"
        style={{ minWidth: "12rem" }}
      />
    );
  }

  return (
    <button
      onClick={startEditing}
      title="Click to rename"
      className="rounded px-1 py-0.5 text-sm font-semibold text-gray-900 hover:bg-gray-100 focus:outline-none"
    >
      {name}
      <span className="ml-1.5 text-gray-400 text-sm">✎</span>
    </button>
  );
}
