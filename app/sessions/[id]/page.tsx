// app/sessions/[id]/page.tsx
//
// Session workspace — server component that fetches data and renders layout.
// Restyled header to match Stitch design.

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

  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      uploadedFiles: true,
      checkpoints: {
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, description: true, createdAt: true },
      },
    },
  });

  if (!session) notFound();

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

  interface ToolMeta {
    toolName: string;
    input: { code?: string; package?: string };
    output: Record<string, unknown>;
  }

  const safeMessages = session.messages.map((m) => {
    const meta = m.metadata as { tools?: ToolMeta[] } | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [];

    if (m.role === "assistant" && meta?.tools?.length) {
      for (const tool of meta.tools) {
        const partType = tool.toolName === "install_package"
          ? "tool-install_package"
          : "tool-execute_python";
        parts.push({
          type: partType,
          toolCallId: `restored-${m.id}-${parts.length}`,
          toolName: tool.toolName,
          state: "output-available",
          input: tool.input,
          output: tool.output,
        });
      }
    }

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
    <div className="flex h-screen flex-col bg-[#f8f6f6]">
      {/* ── Header bar ── */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2 shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-gray-500 hover:text-primary transition-colors">
            <span className="material-symbols-outlined">arrow_back</span>
          </Link>
          <div className="h-4 w-px bg-gray-200" />
          <div className="flex flex-col">
            <SessionNameEditor sessionId={id} initialName={session.name} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">
            {session.messages.length} messages &middot; {session.uploadedFiles.length} file{session.uploadedFiles.length !== 1 ? "s" : ""}
          </span>
        </div>
      </header>

      {/* ── Three-column workspace ── */}
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
