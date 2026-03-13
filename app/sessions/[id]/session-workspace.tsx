"use client";
// app/sessions/[id]/session-workspace.tsx
//
// Client-side orchestrator for the three-panel session workspace.
// Layout: Files (left) | Notebook (center) | Chat + Checkpoints (right)
// Restyled to match Stitch design.

import { useState, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import ChatPanel from "@/components/chat/chat-interface";
import NotebookView from "@/components/notebook/notebook-view";
import FileDropzone from "@/components/upload/file-dropzone";
import CheckpointPanel from "@/components/session/checkpoint-panel";
import DataQualityBanner from "@/components/data/data-quality-banner";
import ExportButton from "@/components/notebook/export-button";

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

  const sendPromptRef = useRef<(text: string) => void>(() => {});

  const { messages, sendMessage, stop, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: `/api/sessions/${sessionId}/chat`,
    }),
    messages: initialMessages,
    experimental_throttle: 100,
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

  function handleCheckpointRestored() {
    window.location.reload();
  }

  function handleCheckpointDeleted(checkpointId: string) {
    setCheckpoints((prev) => prev.filter((c) => c.id !== checkpointId));
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
      <aside className="w-[224px] border-r border-gray-200 bg-white flex flex-col shrink-0 overflow-y-auto">
        <div className="p-4 space-y-6">
          {/* Data Quality Banner */}
          {files.length > 0 && (
            <DataQualityBanner
              files={files}
              onAskClean={(prompt) => sendPromptRef.current(prompt)}
            />
          )}

          {/* Project Assets */}
          <section>
            <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">
              Project Assets
            </h2>
            <div className="space-y-2">
              <FileDropzone
                sessionId={sessionId}
                onUploadSuccess={handleUploadSuccess}
              />
              {files.map((file) => (
                <FileCard key={file.id} file={file} onDelete={handleDeleteFile} />
              ))}
            </div>
          </section>

        </div>
      </aside>

      {/* ── Center: Notebook ─────────────────────────────────────────────── */}
      <main className="flex flex-1 flex-col overflow-hidden bg-[#f8f6f6]">
        <div className="flex items-center justify-between px-6 py-2 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-4">
            <span className="text-xs font-mono text-gray-400">[Py3.11]</span>
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
              <span className="size-2 bg-emerald-500 rounded-full" />
              Kernel Ready
            </div>
          </div>
          <ExportButton sessionId={sessionId} />
        </div>
        <NotebookView
          messages={messages}
          sessionId={sessionId}
          status={status}
          onAskAI={(cellNumber) => {
            setCellAttachment(cellNumber);
            sendPromptRef.current("Explain and suggest improvements");
          }}
          onDebugError={(code, error) => {
            const prompt = `Debug this error and fix the code:\n\nError:\n\`\`\`\n${error.slice(0, 2000)}\n\`\`\`\n\nCode:\n\`\`\`python\n${code.slice(0, 3000)}\n\`\`\``;
            sendMessage({ parts: [{ type: "text", text: prompt }] });
          }}
        />
      </main>

      {/* ── Right Sidebar: Chat + Checkpoints ────────────────────────────── */}
      <aside className="w-[512px] shrink-0 flex flex-col border-l border-gray-200 bg-white">
        {/* Chat header */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-2">
            <div className="size-8 bg-primary rounded-lg flex items-center justify-center text-white">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>bolt</span>
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">DataChat AI</p>
              <p className="text-[10px] text-emerald-500 flex items-center gap-1">
                <span className="size-1.5 bg-emerald-500 rounded-full animate-pulse" />
                Online
                {files.length > 0 && <>&nbsp;&middot; Analyzing {files[files.length - 1].filename}</>}
              </p>
            </div>
          </div>
        </div>

        {/* Chat panel */}
        <div className="flex-1 overflow-hidden flex flex-col">
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
        <div className="border-t border-gray-200 bg-gray-50">
          <button
            onClick={() => setCheckpointsOpen(!checkpointsOpen)}
            className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold text-gray-500"
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>history</span>
              Checkpoints ({checkpoints.length})
            </div>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              {checkpointsOpen ? "expand_less" : "expand_more"}
            </span>
          </button>
          {checkpointsOpen && (
            <div className="px-4 pb-4">
              <CheckpointPanel
                sessionId={sessionId}
                checkpoints={checkpoints}
                onCheckpointCreated={handleCheckpointCreated}
                onCheckpointRestored={handleCheckpointRestored}
                onCheckpointDeleted={handleCheckpointDeleted}
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
  const ext = file.filename.split(".").pop()?.toUpperCase() || "";
  const sizeStr = file.fileSize > 0
    ? file.fileSize > 1048576
      ? `${(file.fileSize / 1048576).toFixed(1)} MB`
      : `${(file.fileSize / 1024).toFixed(0)} KB`
    : "";
  const meta = [sizeStr, ext].filter(Boolean).join(" \u00B7 ");

  return (
    <div className="group relative flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors">
      <div className="flex items-center gap-3 overflow-hidden">
        <span className="material-symbols-outlined text-gray-400" style={{ fontSize: 20 }}>description</span>
        <div className="overflow-hidden">
          <p className="text-xs font-semibold text-gray-900 truncate" title={file.filename}>{file.filename}</p>
          <p className="text-[10px] text-gray-500">
            {meta || (schema?.rowCount ? `${schema.rowCount.toLocaleString()} rows` : "Uploaded")}
          </p>
        </div>
      </div>
      {confirming ? (
        <div className="flex items-center gap-1 text-xs shrink-0">
          <button
            onClick={() => { onDelete(file.id); setConfirming(false); }}
            className="rounded bg-red-500 px-1.5 py-0.5 text-white hover:bg-red-600 text-[10px]"
          >
            Delete
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded bg-gray-200 px-1.5 py-0.5 text-gray-700 hover:bg-gray-300 text-[10px]"
          >
            No
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="material-symbols-outlined text-red-500 p-1 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          style={{ fontSize: 16 }}
        >
          delete
        </button>
      )}
    </div>
  );
}
