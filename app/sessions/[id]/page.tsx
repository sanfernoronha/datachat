// app/sessions/[id]/page.tsx
//
// The main session workspace — the primary screen users interact with.
//
// Layout (three-column):
//   Left sidebar  — uploaded files list + dropzone
//   Center panel  — chat interface (messages + input)
//   Right sidebar — checkpoints timeline
//
// Server component: fetches session data server-side, then passes it to
// client components as props (avoids client-side loading flicker).

import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import SessionWorkspace from "./session-workspace";
import SessionNameEditor from "@/components/session/session-name-editor";

interface SessionPageProps {
  params: Promise<{ id: string }>;
}

export default async function SessionPage({ params }: SessionPageProps) {
  const { id } = await params;

  // Load full session data — 404 if not found
  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      uploadedFiles: true,
      checkpoints: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!session) notFound();

  // Convert Prisma's BigInt fileSize to a plain number for JSON serialisation
  // (BigInt cannot be serialised through the server→client boundary)
  const safeFiles = session.uploadedFiles.map((f) => ({
    id: f.id,
    sessionId: f.sessionId,
    filename: f.filename,
    filePath: f.filePath,
    fileSize: Number(f.fileSize),
    fileType: f.fileType,
    schema: f.schema,
    uploadedAt: f.uploadedAt.toISOString(),
  }));

  // Convert DB messages to UIMessage format (AI SDK v6).
  // Reconstruct rich parts from metadata (tool invocations with code/results/plots).
  interface ToolMeta {
    toolName: string;
    input: { code?: string };
    output: { exit_code?: number; stdout?: string; stderr?: string; plot_filenames?: string[] };
  }

  const safeMessages = session.messages.map((m) => {
    const meta = m.metadata as { tools?: ToolMeta[] } | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [];

    // Reconstruct tool invocation parts from saved metadata
    if (m.role === "assistant" && meta?.tools?.length) {
      for (const tool of meta.tools) {
        parts.push({
          type: "tool-execute_python",
          toolCallId: `restored-${m.id}-${parts.length}`,
          state: "output-available",
          input: tool.input,
          output: tool.output,
        });
      }
    }

    // Add the text part
    if (m.content) {
      parts.push({ type: "text" as const, text: m.content });
    }

    return {
      id: String(m.id),
      role: m.role as "user" | "assistant",
      parts,
      createdAt: m.createdAt,
    };
  });

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* ── Header bar ── */}
      <header className="flex items-center gap-4 border-b bg-white px-6 py-3">
        <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">
          ← Sessions
        </Link>
        <SessionNameEditor sessionId={id} initialName={session.name} />
        <span className="ml-auto text-xs text-gray-400">
          {session.messages.length} messages · {session.uploadedFiles.length} file{session.uploadedFiles.length !== 1 ? "s" : ""}
        </span>
      </header>

      {/* ── Three-column workspace ── */}
      {/* The SessionWorkspace is a client component that wires up state and
          event handlers for uploads, chat, and checkpoints */}
      <div className="flex flex-1 overflow-hidden">
        <SessionWorkspace
          sessionId={id}
          initialFiles={safeFiles}
          initialMessages={safeMessages}
          initialCheckpoints={session.checkpoints.map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            createdAt: c.createdAt.toISOString(),
          }))}
        />
      </div>
    </div>
  );
}
