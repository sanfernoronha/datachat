// app/api/sessions/[id]/chat/route.ts
//
// POST /api/sessions/:id/chat
//
// The core chat endpoint. It:
//   1. Loads the session + conversation history + uploaded file schemas
//   2. Appends the new user message to the DB
//   3. Streams the LLM response back to the browser via the Vercel AI SDK
//   4. When the LLM calls execute_python, runs code in the AIO Sandbox Jupyter kernel
//   5. Returns execution results (rich MIME outputs) to the frontend
//   6. Saves the completed assistant response to the DB once streaming finishes

import { NextRequest } from "next/server";
import { streamText, tool, jsonSchema, stepCountIs } from "ai";
import { prisma } from "@/lib/db/prisma";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { getModel } from "@/lib/ai/model";
import {
  executeCode,
  installPackage,
  downloadFile,
  toLLMSummary,
  saveOutputFiles,
} from "@/lib/sandbox/client";
import { saveUploadedFile } from "@/lib/storage/files";
import { parseFile, inferSchema } from "@/lib/upload/parse";

// ─── POST ──────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  const body = await req.json();
  const clientMessages: Array<{
    role: string;
    content?: string;
    parts?: Array<{ type: string; text?: string }>;
  }> = body.messages ?? [];

  const lastUserMsg = [...clientMessages].reverse().find((m) => m.role === "user");

  let message: string | undefined;
  if (lastUserMsg) {
    if (Array.isArray(lastUserMsg.parts)) {
      message = lastUserMsg.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("")
        .trim();
    } else if (typeof lastUserMsg.content === "string") {
      message = lastUserMsg.content.trim();
    }
  }

  if (!message) {
    return new Response("Message cannot be empty", { status: 400 });
  }

  if (message.length > 50_000) {
    return new Response("Message too long (max 50,000 characters)", { status: 400 });
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      messages: { orderBy: { createdAt: "asc" }, take: 30 },
      uploadedFiles: true,
    },
  });

  if (!session) {
    return new Response("Session not found", { status: 404 });
  }

  await prisma.message.create({
    data: { sessionId, role: "user", content: message },
  });

  // Build conversation history for the LLM.
  // Supports both legacy (plot_filenames) and new (results) metadata formats.
  interface ToolMeta {
    toolName: string;
    input: { code?: string; package?: string };
    output: {
      // Legacy format
      exit_code?: number;
      stdout?: string;
      stderr?: string;
      plot_filenames?: string[];
      // New sandbox format (LLM summary)
      status?: string;
      has_plots?: boolean;
      has_tables?: boolean;
      result_count?: number;
      error?: string;
      // install_package format
      success?: boolean;
      output?: string;
    };
  }

  const conversationHistory = session.messages.map((m) => {
    const meta = m.metadata as { tools?: ToolMeta[] } | null;

    if (m.role === "assistant" && meta?.tools?.length) {
      const toolSummaries = meta.tools
        .map((t) => {
          if (t.toolName === "install_package") {
            return `[Installed package: ${t.input?.package}] ${t.output?.success ? "Success" : "Failed"}`;
          }

          const parts = [`[Used execute_python tool]`];

          // New format
          if (t.output?.status !== undefined) {
            if (t.output?.stdout) parts.push(`[Output]\n${t.output.stdout.slice(0, 3000)}`);
            if (t.output?.stderr) parts.push(`[Error]\n${t.output.stderr.slice(0, 1000)}`);
            if (t.output?.has_plots) parts.push(`[Charts generated]`);
            if (t.output?.has_tables) parts.push(`[Tables rendered]`);
            if (t.output?.error) parts.push(`[Error: ${t.output.error}]`);
          }
          // Legacy format
          else {
            if (t.output?.stdout) parts.push(`[Output]\n${t.output.stdout.slice(0, 3000)}`);
            if (t.output?.stderr) parts.push(`[Error]\n${t.output.stderr.slice(0, 1000)}`);
            if (t.output?.plot_filenames?.length) {
              parts.push(`[Plots saved: ${t.output.plot_filenames.join(", ")}]`);
            }
          }

          return parts.join("\n");
        })
        .join("\n\n");

      return {
        role: "assistant" as const,
        content: `${toolSummaries}\n\n${m.content}`,
      };
    }

    return {
      role: m.role as "user" | "assistant",
      content: m.content,
    };
  });

  const result = streamText({
    model: getModel(),
    system: buildSystemPrompt(session.uploadedFiles),
    messages: [...conversationHistory, { role: "user", content: message }],
    maxOutputTokens: 4096,
    stopWhen: stepCountIs(10),

    tools: {
      execute_python: tool({
        description:
          "Execute Python code in a Jupyter kernel. You MUST use this tool for any data analysis, " +
          "computation, or visualization request. Variables persist across calls. " +
          "Pre-imported: pandas as pd, numpy as np, matplotlib.pyplot as plt, plotly.express as px, plotly.graph_objects as go. " +
          "DATA_DIR is a pre-defined Python variable pointing to the uploaded files directory. " +
          "Do NOT redefine it — just use it: pd.read_csv(f\"{DATA_DIR}/file.csv\"). " +
          "IMPORTANT: Always wrap final results in print() — bare expressions produce NO visible output. " +
          "Use print(df.head()), print(result), print(score), etc. " +
          "If execution fails, fix the code and call again.",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            code: { type: "string", description: "The Python code to execute" },
          },
          required: ["code"],
          additionalProperties: false,
        }),
        execute: async ({ code }) => {
          const startTime = Date.now();

          // executeCode handles kernel bootstrap + one retry on dead kernel internally.
          // No additional retry layer needed here.
          const execResult = await executeCode(sessionId, code);

          const elapsed_ms = Date.now() - startTime;

          console.log("[sandbox] status:", execResult.status, `(${elapsed_ms}ms)`);
          if (execResult.stdout) console.log("[sandbox] stdout:", execResult.stdout.slice(0, 200));
          if (execResult.stderr) console.log("[sandbox] stderr:", execResult.stderr.slice(0, 200));
          if (execResult.error) console.log("[sandbox] error:", execResult.error.ename, execResult.error.evalue);

          // Save images/Plotly to disk, extract inline tables
          const { filenames, tables } = await saveOutputFiles(
            sessionId,
            execResult.results
          );

          const toolResult = {
            ...toLLMSummary(execResult),
            plot_filenames: filenames,
            tables,
            elapsed_ms,
          };

          return toolResult;
        },
      }),

      install_package: tool({
        description:
          "Install a Python package via pip. Use this when you need a package " +
          "that is not pre-installed (e.g. seaborn, scikit-learn, lifelines, scipy). " +
          "IMPORTANT: Call this tool ALONE — do NOT call execute_python in the same step. " +
          "Wait for installation to complete, then use the package in a subsequent execute_python call.",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            package: {
              type: "string",
              description: "Package name to install (e.g. 'scikit-learn')",
            },
          },
          required: ["package"],
          additionalProperties: false,
        }),
        execute: async ({ package: pkg }) => {
          return installPackage(sessionId, pkg);
        },
      }),

      save_dataset: tool({
        description:
          "Register a CSV or TSV file you saved in DATA_DIR as a tracked dataset. " +
          "First save the file using execute_python (e.g. df.to_csv(f\"{DATA_DIR}/cleaned.csv\", index=False)), " +
          "then call this tool with the filename. The file will appear in the session's file panel, " +
          "its schema will be available in your context, and it will survive kernel restarts. " +
          "If a file with the same name already exists, it will be updated.",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            filename: {
              type: "string",
              description: "Filename in DATA_DIR to register (e.g. 'cleaned_data.csv')",
            },
          },
          required: ["filename"],
          additionalProperties: false,
        }),
        execute: async ({ filename }) => {
          // Validate filename
          if (filename.includes("..") || filename.includes("/")) {
            return { success: false, error: "Invalid filename — must not contain '..' or '/'" };
          }
          const ext = filename.split(".").pop()?.toLowerCase();
          if (!ext || !["csv", "tsv"].includes(ext)) {
            return { success: false, error: "Only CSV and TSV files are supported" };
          }

          try {
            // Download the file from the sandbox
            const buffer = await downloadFile(sessionId, filename);

            // Parse and infer schema
            const rows = parseFile(filename, buffer);
            if (rows.length === 0) {
              return { success: false, error: "File appears to be empty or unparseable" };
            }
            const schema = inferSchema(rows);

            // Save to S3
            const filePath = await saveUploadedFile(sessionId, filename, buffer);

            // Upsert DB record (unique on sessionId + filename)
            await prisma.uploadedFile.upsert({
              where: { sessionId_filename: { sessionId, filename } },
              create: {
                sessionId,
                filename,
                filePath,
                fileSize: BigInt(buffer.length),
                fileType: ext === "tsv" ? "text/tab-separated-values" : "text/csv",
                schema: schema as object,
              },
              update: {
                filePath,
                fileSize: BigInt(buffer.length),
                fileType: ext === "tsv" ? "text/tab-separated-values" : "text/csv",
                schema: schema as object,
              },
            });

            return {
              success: true,
              filename,
              rowCount: schema.rowCount,
              columnCount: Object.keys(schema.columns).length,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            console.error("[save_dataset] Failed:", msg);
            return { success: false, error: msg };
          }
        },
      }),
    },

    onFinish: async ({ text, steps }) => {
      const toolParts = steps.flatMap((step) =>
        step.toolResults.map((tr) => {
          const output = tr.output as Record<string, unknown>;

          // tables[] can be large HTML — strip from DB, keep plot_filenames
          const storageOutput = { ...output };
          delete storageOutput.tables;

          return {
            toolName: tr.toolName,
            input: tr.input,
            output: storageOutput,
          };
        })
      );

      await prisma.message.create({
        data: {
          sessionId,
          role: "assistant",
          content: text,
          metadata: toolParts.length > 0 ? JSON.parse(JSON.stringify({ tools: toolParts })) : undefined,
        },
      });
    },
  });

  return result.toUIMessageStreamResponse();
}
