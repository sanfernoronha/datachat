// app/api/sessions/[id]/execute/route.ts
//
// POST /api/sessions/:id/execute
//
// Executes Python code directly in the sandbox (no LLM involvement).
// Used for manual cell re-execution in the notebook view.

import { NextRequest, NextResponse } from "next/server";
import { executeCode, saveOutputFiles, toLLMSummary } from "@/lib/sandbox/client";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const { code } = (await req.json()) as { code: string };

  if (!code?.trim()) {
    return NextResponse.json({ error: "Code cannot be empty" }, { status: 400 });
  }

  const execResult = await executeCode(sessionId, code);
  const { filenames, tables } = await saveOutputFiles(sessionId, execResult.results);

  return NextResponse.json({
    ...toLLMSummary(execResult),
    plot_filenames: filenames,
    tables,
  });
}
