// app/api/sessions/[id]/chat/route.ts
//
// POST /api/sessions/:id/chat
//
// The core chat endpoint. It:
//   1. Loads the session + conversation history + uploaded file schemas
//   2. Appends the new user message to the DB
//   3. Streams the LLM response back to the browser via the Vercel AI SDK
//   4. When the LLM calls execute_python, POSTs code to the execution service
//   5. Returns execution results to the LLM for interpretation
//   6. Saves the completed assistant response to the DB once streaming finishes
//
// Uses AI SDK tool calling so the LLM can run Python code autonomously.
// stopWhen + stepCountIs allows multi-turn tool use (run code → see result → run more).

import { NextRequest } from "next/server";
import { streamText, tool, jsonSchema, stepCountIs } from "ai";
import { prisma } from "@/lib/db/prisma";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { getModel } from "@/lib/ai/model";

// ─── POST ──────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  // Body sent by AI SDK v6 useChat:
  //   { id, messages: UIMessage[], trigger, messageId }
  // UIMessage uses parts[] instead of a content string.
  const body = await req.json();
  const clientMessages: Array<{
    role: string;
    content?: string;
    parts?: Array<{ type: string; text?: string }>;
  }> = body.messages ?? [];

  const lastUserMsg = [...clientMessages].reverse().find((m) => m.role === "user");

  // Support both UIMessage (parts[]) and CoreMessage (content string)
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

  // Load the full session with history and file schemas
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

  // Persist the user's message BEFORE streaming
  await prisma.message.create({
    data: { sessionId, role: "user", content: message },
  });

  // Build conversation history for the LLM.
  // For assistant messages with tool metadata, reconstruct the full context
  // (code executed, stdout, stderr, plots) so the LLM remembers what it did.
  interface ToolMeta {
    toolName: string;
    input: { code?: string };
    output: { exit_code?: number; stdout?: string; stderr?: string; plot_filenames?: string[] };
  }

  const conversationHistory = session.messages.map((m) => {
    const meta = m.metadata as { tools?: ToolMeta[] } | null;

    // For assistant messages with tool calls, include execution context
    if (m.role === "assistant" && meta?.tools?.length) {
      const toolSummaries = meta.tools.map((t) => {
        const parts = [`[Code executed]\n${t.input?.code ?? ""}`];
        if (t.output?.stdout) parts.push(`[Output]\n${t.output.stdout.slice(0, 3000)}`);
        if (t.output?.stderr) parts.push(`[Error]\n${t.output.stderr.slice(0, 1000)}`);
        if (t.output?.plot_filenames?.length) {
          parts.push(`[Plots saved: ${t.output.plot_filenames.join(", ")}]`);
        }
        return parts.join("\n");
      }).join("\n\n");

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

  // Stream the LLM response with tool use support
  const result = streamText({
    model: getModel(),
    system: buildSystemPrompt(session.uploadedFiles),
    messages: [
      ...conversationHistory,
      { role: "user", content: message },
    ],
    maxOutputTokens: 4096,

    // Allow up to 5 tool-call rounds per request.
    // This lets the LLM: run code → see result → fix errors → run again.
    // AI SDK v6 replaced maxSteps with stopWhen + stepCountIs.
    stopWhen: stepCountIs(5),

    tools: {
      execute_python: tool({
        description:
          "Execute Python code for data analysis. The environment persists " +
          "variables across calls (like Jupyter). Pre-imported: pandas as pd, " +
          "numpy as np, matplotlib.pyplot as plt. Use DATA_DIR to read files " +
          "and OUTPUT_DIR to save outputs.",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            code: { type: "string", description: "The Python code to execute" },
          },
          required: ["code"],
          additionalProperties: false,
        }),
        execute: async ({ code }) => {
          try {
            const res = await fetch(
              `${process.env.EXECUTION_SERVICE_URL}/execute`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ session_id: sessionId, code }),
              }
            );

            if (!res.ok) {
              return {
                exit_code: 1,
                stdout: "",
                stderr: `Execution service error: ${res.status} ${res.statusText}`,
                plot_filenames: [] as string[],
              };
            }

            const data = await res.json();

            // Return lean result to LLM (plots are saved to disk, referenced by filename)
            return {
              exit_code: data.exit_code,
              stdout: data.stdout?.slice(0, 10_000) ?? "",
              stderr: data.stderr?.slice(0, 5_000) ?? "",
              plot_filenames: data.plot_filenames ?? [],
            };
          } catch (err) {
            return {
              exit_code: 1,
              stdout: "",
              stderr: `Failed to reach execution service: ${err}`,
              plot_filenames: [] as string[],
            };
          }
        },
      }),
    },

    // Save the assistant's response + tool invocations to the DB
    onFinish: async ({ text, steps }) => {
      // Extract tool invocations (code + results) from all steps
      const toolParts = steps.flatMap((step) =>
        step.toolResults.map((tr) => ({
          toolName: tr.toolName,
          input: tr.input,
          output: tr.output,
        }))
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

  // Use toUIMessageStreamResponse() which supports tool call/result parts.
  // The frontend DefaultChatTransport reads this format.
  return result.toUIMessageStreamResponse();
}
