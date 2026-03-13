"use client";
// components/session/checkpoint-panel.tsx
//
// Displays the checkpoint timeline with save, restore, and delete capabilities.
//
// A checkpoint captures the entire conversation at the current moment.
// Users name it something meaningful (e.g. "PCA + k-means, silhouette=0.58")
// so they can return to it later if a different approach doesn't work out.

import { useState } from "react";
import { Input, Textarea } from "@/components/ui/input";

interface CheckpointRecord {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

interface CheckpointPanelProps {
  sessionId: string;
  checkpoints: CheckpointRecord[];
  onCheckpointCreated: (checkpoint: CheckpointRecord) => void;
  onCheckpointRestored: () => void;
  onCheckpointDeleted: (checkpointId: string) => void;
}

export default function CheckpointPanel({
  sessionId,
  checkpoints,
  onCheckpointCreated,
  onCheckpointRestored,
  onCheckpointDeleted,
}: CheckpointPanelProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function saveCheckpoint(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/sessions/${sessionId}/checkpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Could not save checkpoint");
        return;
      }

      onCheckpointCreated(data as CheckpointRecord);
      setName("");
      setDescription("");
      setShowForm(false);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function restoreCheckpoint(checkpointId: string) {
    setRestoring(checkpointId);
    setConfirmRestore(null);

    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/checkpoints/${checkpointId}/restore`,
        { method: "POST" }
      );

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Could not restore checkpoint");
        return;
      }

      onCheckpointRestored();
    } catch {
      setError("Network error");
    } finally {
      setRestoring(null);
    }
  }

  async function deleteCheckpoint(checkpointId: string) {
    setConfirmDelete(null);

    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/checkpoints/${checkpointId}`,
        { method: "DELETE" }
      );

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Could not delete checkpoint");
        return;
      }

      onCheckpointDeleted(checkpointId);
    } catch {
      setError("Network error");
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Save button / inline form ── */}
      {showForm ? (
        <form onSubmit={saveCheckpoint} className="space-y-2">
          <Input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Checkpoint name"
            disabled={saving}
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            disabled={saving}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex-1 rounded bg-blue-600 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="flex-1 rounded border py-1.5 text-xs text-gray-500 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </form>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full rounded-lg border border-dashed border-gray-300 py-2 text-xs text-gray-500 hover:border-gray-400 hover:text-gray-700 transition"
        >
          + Save checkpoint
        </button>
      )}

      {error && !showForm && <p className="text-xs text-red-600">{error}</p>}

      {/* ── Checkpoint timeline ── */}
      {checkpoints.length === 0 ? (
        <p className="text-xs text-gray-400 text-center mt-6">
          No checkpoints yet. Save one to mark a point you can return to.
        </p>
      ) : (
        <ol className="relative border-l border-gray-200 ml-2 space-y-4">
          {checkpoints.map((cp) => (
            <li key={cp.id} className="ml-4 group">
              {/* Timeline dot */}
              <div className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border border-white bg-blue-500" />
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-800">{cp.name}</p>
                  {cp.description && (
                    <p className="mt-0.5 text-xs text-gray-400">{cp.description}</p>
                  )}
                  <p className="mt-0.5 text-xs text-gray-300">
                    {new Date(cp.createdAt).toLocaleString()}
                  </p>
                </div>

                {/* Action buttons — visible on hover */}
                <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setConfirmRestore(cp.id)}
                    disabled={restoring === cp.id}
                    className="rounded p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition"
                    title="Restore to this checkpoint"
                  >
                    {restoring === cp.id ? (
                      <LoadingSpinner />
                    ) : (
                      <RestoreIcon />
                    )}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(cp.id)}
                    className="rounded p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 transition"
                    title="Delete checkpoint"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>

              {/* Restore confirmation */}
              {confirmRestore === cp.id && (
                <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2">
                  <p className="text-xs text-amber-800">
                    Restore to &quot;{cp.name}&quot;? Messages after this point will be removed.
                  </p>
                  <div className="mt-1.5 flex gap-2">
                    <button
                      onClick={() => restoreCheckpoint(cp.id)}
                      className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
                    >
                      Restore
                    </button>
                    <button
                      onClick={() => setConfirmRestore(null)}
                      className="rounded bg-white px-2.5 py-1 text-xs text-gray-600 border hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Delete confirmation */}
              {confirmDelete === cp.id && (
                <div className="mt-2 rounded border border-red-200 bg-red-50 p-2">
                  <p className="text-xs text-red-800">Delete this checkpoint?</p>
                  <div className="mt-1.5 flex gap-2">
                    <button
                      onClick={() => deleteCheckpoint(cp.id)}
                      className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="rounded bg-white px-2.5 py-1 text-xs text-gray-600 border hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function RestoreIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
