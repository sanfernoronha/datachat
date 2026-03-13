// lib/export/notebook.ts
//
// Converts a session's messages into a Jupyter Notebook (nbformat v4).
// Code cells come from execute_python tool calls; markdown cells from
// user prompts and AI commentary.

import { getOutputFile } from "@/lib/storage/files";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ToolMeta {
  toolName: string;
  input: { code?: string; package?: string };
  output: {
    status?: string;
    stdout?: string;
    stderr?: string;
    error?: string;
    plot_filenames?: string[];
    // Legacy
    exit_code?: number;
  };
}

export interface DbMessage {
  role: string;
  content: string;
  // Prisma Json field — cast internally
  metadata: unknown;
}

interface NotebookCell {
  cell_type: "code" | "markdown";
  metadata: Record<string, unknown>;
  source: string[];
  outputs?: NotebookOutput[];
  execution_count?: number | null;
}

interface NotebookOutput {
  output_type: string;
  [key: string]: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function textToLines(text: string): string[] {
  const lines = text.split("\n");
  return lines.map((line, i) => (i < lines.length - 1 ? line + "\n" : line));
}

function markdownCell(text: string): NotebookCell {
  return {
    cell_type: "markdown",
    metadata: {},
    source: textToLines(text),
  };
}

function codeCell(
  code: string,
  outputs: NotebookOutput[],
  executionCount: number | null
): NotebookCell {
  return {
    cell_type: "code",
    metadata: {},
    source: textToLines(code),
    outputs,
    execution_count: executionCount,
  };
}

export function mimeForExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "svg": return "image/svg+xml";
    case "webp": return "image/webp";
    default: return "image/png";
  }
}

// ─── Build Notebook ───────────────────────────────────────────────────────────

export async function buildNotebook(
  messages: DbMessage[],
  sessionId: string
): Promise<object> {
  const cells: NotebookCell[] = [];
  let executionCount = 1;

  for (const msg of messages) {
    if (msg.role === "user") {
      if (msg.content.trim()) {
        cells.push(markdownCell(`**User:** ${msg.content.trim()}`));
      }
      continue;
    }

    // Assistant message
    const meta = msg.metadata as { tools?: ToolMeta[] } | null;
    const tools = meta?.tools ?? [];

    for (const t of tools) {
      if (t.toolName === "install_package") {
        cells.push(codeCell(
          `!pip install ${t.input.package ?? ""}`,
          [{
            output_type: "stream",
            name: "stdout",
            text: [t.output?.stdout ?? (t.output?.status === "error" ? "Failed" : "Installed successfully") + "\n"],
          }],
          executionCount++
        ));
        continue;
      }

      if (t.toolName !== "execute_python" || !t.input.code) continue;

      const outputs: NotebookOutput[] = [];

      if (t.output?.stdout) {
        outputs.push({
          output_type: "stream",
          name: "stdout",
          text: textToLines(t.output.stdout),
        });
      }

      if (t.output?.stderr) {
        outputs.push({
          output_type: "stream",
          name: "stderr",
          text: textToLines(t.output.stderr),
        });
      }

      if (t.output?.error) {
        outputs.push({
          output_type: "error",
          ename: "Error",
          evalue: t.output.error,
          traceback: [t.output.error],
        });
      }

      // Plot images — read from S3 and embed as base64
      if (t.output?.plot_filenames?.length) {
        for (const filename of t.output.plot_filenames) {
          try {
            const buf = await getOutputFile(sessionId, filename);
            const isHtml = filename.endsWith(".html");

            if (isHtml) {
              const html = buf.toString("utf-8");
              outputs.push({
                output_type: "display_data",
                data: { "text/html": textToLines(html) },
                metadata: {},
              });
            } else {
              const b64 = buf.toString("base64");
              const mime = mimeForExtension(filename);
              outputs.push({
                output_type: "display_data",
                data: { [mime]: b64 },
                metadata: {},
              });
            }
          } catch {
            // File missing from S3 — skip silently
          }
        }
      }

      cells.push(codeCell(t.input.code, outputs, executionCount++));
    }

    if (msg.content.trim()) {
      cells.push(markdownCell(`**Assistant:** ${msg.content.trim()}`));
    }
  }

  if (cells.length === 0) {
    cells.push(markdownCell("*Empty session — no analysis performed yet.*"));
  }

  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      },
      language_info: {
        name: "python",
        version: "3.11.0",
      },
    },
    cells,
  };
}
