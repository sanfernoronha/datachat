"use client";
// app/sessions/[id]/session-workspace.tsx
//
// Client-side orchestrator for the three-panel session workspace.
// Manages local state for files, checkpoints, and the checkpoint creation modal.
//
// Props come from the server component (page.tsx) as pre-fetched data,
// so the page renders with full content immediately — no loading skeleton.

import { useState } from "react";
import type { UIMessage } from "ai";
import ChatInterface from "@/components/chat/chat-interface";
import FileDropzone from "@/components/upload/file-dropzone";
import CheckpointPanel from "@/components/session/checkpoint-panel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileRecord {
  id: string;
  filename: string;
  fileSize: number;   // Converted from BigInt in page.tsx
  fileType: string;
  schema: unknown;
  uploadedAt: string;
}

interface CheckpointRecord {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

interface SessionWorkspaceProps {
  sessionId: string;
  initialFiles: FileRecord[];
  initialMessages: UIMessage[];
  initialCheckpoints: CheckpointRecord[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SessionWorkspace({
  sessionId,
  initialFiles,
  initialMessages,
  initialCheckpoints,
}: SessionWorkspaceProps) {
  // Local state mirrors the DB — updated optimistically after uploads/checkpoints
  const [files, setFiles] = useState<FileRecord[]>(initialFiles);
  const [checkpoints, setCheckpoints] = useState<CheckpointRecord[]>(initialCheckpoints);

  // Called by FileDropzone after a successful upload
  function handleUploadSuccess(result: {
    filename: string;
    rowCount: number;
    columnCount: number;
    schema: unknown;
  }) {
    // Optimistically add the file card — schema is the same shape the server returns
    const newFile: FileRecord = {
      id: crypto.randomUUID(), // Placeholder — actual ID lives in DB
      filename: result.filename,
      fileSize: 0,
      fileType: "",
      schema: result.schema,
      uploadedAt: new Date().toISOString(),
    };
    setFiles((prev) => [...prev, newFile]);
  }

  // Called by CheckpointPanel after saving a checkpoint
  function handleCheckpointCreated(checkpoint: CheckpointRecord) {
    setCheckpoints((prev) => [...prev, checkpoint]);
  }

  // Called by FileCard to delete an uploaded file
  async function handleDeleteFile(fileId: string) {
    const res = await fetch(`/api/sessions/${sessionId}/files/${fileId}`, { method: "DELETE" });
    if (res.ok) {
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    }
  }

  return (
    <>
      {/* ── Left Sidebar: Files ──────────────────────────────────────────── */}
      <aside className="w-64 shrink-0 overflow-y-auto border-r bg-white px-4 py-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Datasets
        </h2>

        {/* Upload dropzone */}
        <FileDropzone
          sessionId={sessionId}
          onUploadSuccess={handleUploadSuccess}
        />

        {/* File cards */}
        <ul className="mt-4 space-y-2">
          {files.map((file) => (
            <FileCard key={file.id} file={file} onDelete={handleDeleteFile} />
          ))}
        </ul>
      </aside>

      {/* ── Center: Chat ─────────────────────────────────────────────────── */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <ChatInterface
          sessionId={sessionId}
          initialMessages={initialMessages}
        />
      </main>

      {/* ── Right Sidebar: Checkpoints ────────────────────────────────────── */}
      <aside className="w-64 shrink-0 overflow-y-auto border-l bg-white px-4 py-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Checkpoints
        </h2>
        <CheckpointPanel
          sessionId={sessionId}
          checkpoints={checkpoints}
          onCheckpointCreated={handleCheckpointCreated}
        />
      </aside>
    </>
  );
}

// ─── FileCard ─────────────────────────────────────────────────────────────────
// A small card that summarises an uploaded dataset.

function FileCard({ file, onDelete }: { file: FileRecord; onDelete: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const schema = file.schema as { columns?: Record<string, unknown>; rowCount?: number } | null;
  const columnCount = schema?.columns ? Object.keys(schema.columns).length : 0;
  const rowCount = schema?.rowCount ?? 0;

  return (
    <li className="rounded-lg border bg-gray-50 px-3 py-2.5 text-sm group relative">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-800 truncate" title={file.filename}>
            {file.filename}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            {rowCount.toLocaleString()} rows · {columnCount} columns
          </p>
        </div>
        {!confirming && (
          <button
            onClick={() => setConfirming(true)}
            className="ml-1 rounded p-0.5 text-gray-300 opacity-0 group-hover:opacity-100 hover:text-red-500 transition"
            title="Remove file"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-1.5 flex items-center gap-2 text-xs">
          <span className="text-gray-500">Remove?</span>
          <button
            onClick={() => { onDelete(file.id); setConfirming(false); }}
            className="rounded bg-red-500 px-2 py-0.5 text-white hover:bg-red-600"
          >
            Yes
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded bg-gray-200 px-2 py-0.5 text-gray-700 hover:bg-gray-300"
          >
            No
          </button>
        </div>
      )}
    </li>
  );
}
