"use client";
// components/session/checkpoint-panel.tsx
//
// Displays the checkpoint timeline and a form to save a new checkpoint.
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
}

export default function CheckpointPanel({
  sessionId,
  checkpoints,
  onCheckpointCreated,
}: CheckpointPanelProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

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

      // Notify parent to update the list
      onCheckpointCreated(data as CheckpointRecord);
      // Reset the form
      setName("");
      setDescription("");
      setShowForm(false);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
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
              {saving ? "Saving…" : "Save"}
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

      {/* ── Checkpoint timeline ── */}
      {checkpoints.length === 0 ? (
        <p className="text-xs text-gray-400 text-center mt-6">
          No checkpoints yet. Save one to mark a point you can return to.
        </p>
      ) : (
        <ol className="relative border-l border-gray-200 ml-2 space-y-4">
          {checkpoints.map((cp) => (
            <li key={cp.id} className="ml-4">
              {/* Timeline dot */}
              <div className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border border-white bg-blue-500" />
              <p className="text-xs font-medium text-gray-800">{cp.name}</p>
              {cp.description && (
                <p className="mt-0.5 text-xs text-gray-400">{cp.description}</p>
              )}
              <p className="mt-0.5 text-xs text-gray-300">
                {new Date(cp.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
