"use client";
// app/sessions/[id]/session-workspace.tsx
//
// Client-side orchestrator for the three-panel session workspace.
// Layout: Files (left) | Notebook (center) | Chat + Checkpoints (right)
//
// useChat() is lifted here so both NotebookView and ChatPanel share the
// same message stream. The notebook is the primary workspace; chat is the
// assistant panel.

import { useState, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import ChatPanel from "@/components/chat/chat-interface";
import NotebookView from "@/components/notebook/notebook-view";
import FileDropzone from "@/components/upload/file-dropzone";
import CheckpointPanel from "@/components/session/checkpoint-panel";
import DataQualityBanner from "@/components/data/data-quality-banner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileRecord {
  id: string;
  filename: string;
  fileSize: number;
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
  const [files, setFiles] = useState<FileRecord[]>(initialFiles);
  const [checkpoints, setCheckpoints] = useState<CheckpointRecord[]>(initialCheckpoints);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const [cellAttachment, setCellAttachment] = useState<number | null>(null);

  // Ref for sending prompts from sidebar actions
  const sendPromptRef = useRef<(text: string) => void>(() => {});

  // Lift useChat() here so notebook + chat share the same message stream
  const { messages, sendMessage, stop, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: `/api/sessions/${sessionId}/chat`,
    }),
    messages: initialMessages,
  });

  function handleUploadSuccess(result: {
    filename: string;
    rowCount: number;
    columnCount: number;
    schema: unknown;
  }) {
    const newFile: FileRecord = {
      id: crypto.randomUUID(),
      filename: result.filename,
      fileSize: 0,
      fileType: "",
      schema: result.schema,
      uploadedAt: new Date().toISOString(),
    };
    setFiles((prev) => [...prev, newFile]);
  }

  function handleCheckpointCreated(checkpoint: CheckpointRecord) {
    setCheckpoints((prev) => [...prev, checkpoint]);
  }

  async function handleDeleteFile(fileId: string) {
    const res = await fetch(`/api/sessions/${sessionId}/files/${fileId}`, { method: "DELETE" });
    if (res.ok) {
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    }
  }

  return (
    <>
      {/* ── Left Sidebar: Files ──────────────────────────────────────────── */}
      <aside className="w-56 shrink-0 overflow-y-auto border-r bg-white px-4 py-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Datasets
        </h2>
        <FileDropzone
          sessionId={sessionId}
          onUploadSuccess={handleUploadSuccess}
        />
        <ul className="mt-4 space-y-2">
          {files.map((file) => (
            <FileCard key={file.id} file={file} onDelete={handleDeleteFile} />
          ))}
        </ul>
        {files.length > 0 && (
          <DataQualityBanner
            files={files}
            onAskClean={(prompt) => sendPromptRef.current(prompt)}
          />
        )}
      </aside>

      {/* ── Center: Notebook ─────────────────────────────────────────────── */}
      <main className="flex flex-1 flex-col overflow-hidden bg-white">
        <NotebookView
          messages={messages}
          sessionId={sessionId}
          status={status}
          onAskAI={(cellNumber) => {
            setCellAttachment(cellNumber);
            sendPromptRef.current("Explain and suggest improvements");
          }}
        />
      </main>

      {/* ── Right Sidebar: Chat + Checkpoints ────────────────────────────── */}
      <aside className="w-[32rem] shrink-0 flex flex-col border-l bg-white">
        {/* Chat panel */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b bg-gray-50">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              AI Assistant
            </h2>
          </div>
          <ChatPanel
            sessionId={sessionId}
            messages={messages}
            status={status}
            error={error}
            sendMessage={sendMessage}
            stop={stop}
            files={files}
            onSendPromptRef={sendPromptRef}
            cellAttachment={cellAttachment}
            onClearCellAttachment={() => setCellAttachment(null)}
          />
        </div>

        {/* Checkpoints — collapsible at bottom */}
        <div className="border-t">
          <button
            onClick={() => setCheckpointsOpen(!checkpointsOpen)}
            className="w-full px-3 py-2 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Checkpoints ({checkpoints.length})
            </h2>
            <span className="text-xs text-gray-400">{checkpointsOpen ? "▾" : "▸"}</span>
          </button>
          {checkpointsOpen && (
            <div className="px-3 py-2 max-h-48 overflow-y-auto">
              <CheckpointPanel
                sessionId={sessionId}
                checkpoints={checkpoints}
                onCheckpointCreated={handleCheckpointCreated}
              />
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

// ─── FileCard ─────────────────────────────────────────────────────────────────

function FileCard({ file, onDelete }: { file: FileRecord; onDelete: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const schema = file.schema as { columns?: Record<string, unknown>; rowCount?: number } | null;
  const columnCount = schema?.columns ? Object.keys(schema.columns).length : 0;
  const rowCount = schema?.rowCount ?? 0;

  return (
    <li className="rounded-lg border bg-gray-50 px-3 py-2.5 text-sm group relative">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-800 truncate text-xs" title={file.filename}>
            {file.filename}
          </p>
          <p className="mt-0.5 text-[10px] text-gray-400">
            {rowCount.toLocaleString()} rows · {columnCount} cols
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
