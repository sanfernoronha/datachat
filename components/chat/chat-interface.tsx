"use client";
// components/chat/chat-interface.tsx
//
// The main chat panel — renders messages, tool invocations, and user input.
//
// Features:
//   - Markdown rendering (bold, italic, lists, headers, inline code)
//   - Code blocks with copy button
//   - Collapsible code execution blocks with retry collapsing
//   - Interactive Plotly plots (iframe) + static PNG fallback
//   - Auto-scroll on new tokens
//   - Smarter loading states (Thinking / Writing code / Running Python)
//   - Auto-growing textarea with Shift+Enter for newlines
//   - Clickable example prompts in empty state

import { useEffect, useRef, useState, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import Markdown from "react-markdown";

// ─── Constants ──────────────────────────────────────────────────────────────

const EXAMPLE_PROMPTS = [
  "Describe the dataset",
  "Show distributions of numeric columns",
  "Correlation analysis",
  "Survival analysis by cancer stage",
];

// Truncation limits (must match route.ts)
const MAX_STDOUT = 10_000;
const MAX_STDERR = 5_000;

// ─── ChatInterface ──────────────────────────────────────────────────────────

interface ChatInterfaceProps {
  sessionId: string;
  initialMessages: UIMessage[];
}

export default function ChatInterface({ sessionId, initialMessages }: ChatInterfaceProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: `/api/sessions/${sessionId}/chat`,
    }),
    messages: initialMessages,
  });

  const isLoading = status === "submitted" || status === "streaming";

  // Derive a smarter loading label from the latest message's parts
  const loadingLabel = (() => {
    if (!isLoading) return "";
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === "assistant") {
      const toolParts = lastMsg.parts.filter((p) => isToolPart(p));
      const lastTool = toolParts[toolParts.length - 1] as ToolInvocationPart | undefined;
      if (lastTool) {
        if (lastTool.state === "input-streaming") return "Writing code…";
        if (lastTool.state === "input-available") return "Running Python…";
      }
    }
    return "Thinking…";
  })();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 150) + "px";
    }
  }, [input]);

  async function handleSubmit(e?: React.SyntheticEvent<HTMLFormElement>) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    await sendMessage({ parts: [{ type: "text", text }] });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleExampleClick(prompt: string) {
    setInput(prompt);
    textareaRef.current?.focus();
  }

  return (
    <div className="flex h-full flex-col">
      {/* ── Message list ── */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-center">
            <div className="space-y-4">
              <div>
                <p className="text-gray-500 text-sm">
                  Upload a dataset and ask anything.
                </p>
                <p className="mt-1 text-gray-400 text-xs">
                  Or try one of these:
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleExampleClick(prompt)}
                    className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} sessionId={sessionId} />
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <span className="animate-pulse">●</span>
            <span>{loadingLabel}</span>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            Something went wrong: {error.message}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input area ── */}
      <div className="border-t bg-white px-4 py-3">
        <form onSubmit={handleSubmit} className="flex gap-3 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your data… (Shift+Enter for new line)"
            disabled={isLoading}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isToolPart(part: { type: string } & Record<string, unknown>): boolean {
  return (
    part.type === "tool-execute_python" ||
    part.type === "dynamic-tool" ||
    part.toolName === "execute_python"
  );
}

// ─── CopyButton ──────────────────────────────────────────────────────────────

function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={`text-xs px-2 py-1 rounded transition-colors ${
        copied
          ? "text-green-400 bg-green-900/30"
          : "text-gray-400 hover:text-gray-200 hover:bg-gray-700/50"
      } ${className}`}
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// ─── MessageBubble ──────────────────────────────────────────────────────────

function MessageBubble({ message, sessionId }: { message: UIMessage; sessionId: string }) {
  const isUser = message.role === "user";

  if (isUser) {
    const textContent = message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");

    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl px-4 py-3 text-sm bg-blue-600 text-white rounded-br-sm">
          <p className="whitespace-pre-wrap">{textContent}</p>
        </div>
      </div>
    );
  }

  // Render parts in streaming order, but collapse failed tool attempts
  const parts = message.parts;
  const renderedParts: React.ReactNode[] = [];
  let failedAttempts: ToolInvocationPart[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (isToolPart(part as { type: string } & Record<string, unknown>)) {
      const toolPart = part as ToolInvocationPart;
      const isFailed =
        toolPart.state === "output-available" && toolPart.output?.exit_code !== 0;

      // Check if there's another tool part coming after this one
      const hasFollowingTool = parts
        .slice(i + 1)
        .some((p) => isToolPart(p as { type: string } & Record<string, unknown>));

      if (isFailed && hasFollowingTool) {
        // Collect failed attempt — will be shown as collapsed group
        failedAttempts.push(toolPart);
      } else {
        // This is the final (or only) tool call — render it with any prior failures
        if (failedAttempts.length > 0) {
          renderedParts.push(
            <FailedAttemptsExpander
              key={`retries-${i}`}
              attempts={failedAttempts}
              sessionId={sessionId}
            />
          );
          failedAttempts = [];
        }
        renderedParts.push(
          <CodeExecutionBlock key={i} part={toolPart} sessionId={sessionId} />
        );
      }
    } else if (part.type === "text") {
      if (!part.text.trim()) continue;
      // Flush any pending failed attempts before text
      if (failedAttempts.length > 0) {
        renderedParts.push(
          <FailedAttemptsExpander
            key={`retries-text-${i}`}
            attempts={failedAttempts}
            sessionId={sessionId}
          />
        );
        failedAttempts = [];
      }
      renderedParts.push(
        <div key={i} className="rounded-2xl px-4 py-3 text-sm bg-gray-50 text-gray-900 rounded-bl-sm border border-gray-100">
          <AssistantContent content={part.text} />
        </div>
      );
    }
  }

  // Flush any remaining failed attempts
  if (failedAttempts.length > 0) {
    renderedParts.push(
      <FailedAttemptsExpander
        key="retries-end"
        attempts={failedAttempts}
        sessionId={sessionId}
      />
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-3">
        {renderedParts}
      </div>
    </div>
  );
}

// ─── FailedAttemptsExpander ─────────────────────────────────────────────────

function FailedAttemptsExpander({
  attempts,
  sessionId,
}: {
  attempts: ToolInvocationPart[];
  sessionId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const count = attempts.length;

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-1.5 bg-gray-100 flex items-center gap-2 text-xs text-gray-500 hover:bg-gray-150"
      >
        <span className="text-gray-400">{expanded ? "▾" : "▸"}</span>
        <span className="text-red-400">✗</span>
        <span>
          {count} failed attempt{count > 1 ? "s" : ""} — auto-retried
        </span>
      </button>
      {expanded && (
        <div className="space-y-2 p-2 bg-gray-50">
          {attempts.map((attempt, i) => (
            <CodeExecutionBlock key={i} part={attempt} sessionId={sessionId} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ToolInvocationPart type ────────────────────────────────────────────────

interface ToolInvocationPart {
  type: string;
  state: string;
  input?: { code?: string };
  output?: {
    exit_code?: number;
    stdout?: string;
    stderr?: string;
    plot_filenames?: string[];
  };
}

// ─── CodeExecutionBlock ─────────────────────────────────────────────────────

function CodeExecutionBlock({ part, sessionId }: { part: ToolInvocationPart; sessionId: string }) {
  const code = part.input?.code ?? "";
  const isRunning = part.state === "input-streaming" || part.state === "input-available";
  const hasResult = part.state === "output-available";
  const hasError = part.state === "output-error";
  const result = hasResult ? part.output : null;

  // Collapse code by default once execution completes
  const [codeExpanded, setCodeExpanded] = useState(!hasResult);

  // Auto-collapse when result arrives
  useEffect(() => {
    if (hasResult) setCodeExpanded(false);
  }, [hasResult]);

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden shadow-sm">
      {/* Code header — always visible, click to toggle */}
      <button
        onClick={() => setCodeExpanded(!codeExpanded)}
        className="w-full bg-gray-900 px-3 py-2 flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 font-mono">Python</span>
          <span className="text-xs text-gray-600">{codeExpanded ? "▾" : "▸"}</span>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="text-xs text-yellow-400 animate-pulse">Running…</span>
          )}
          {hasResult && result?.exit_code === 0 && (
            <span className="text-xs text-green-400">✓ Done</span>
          )}
          {(hasError || (hasResult && result?.exit_code !== 0)) && (
            <span className="text-xs text-red-400">✗ Error</span>
          )}
        </div>
      </button>

      {/* Code body — collapsible */}
      {codeExpanded && (
        <div className="bg-gray-900 px-3 pb-3 relative group">
          <div className="absolute top-1 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <CopyButton text={code} />
          </div>
          <pre className="text-xs text-green-300 font-mono whitespace-pre overflow-x-auto leading-relaxed">
            {code}
          </pre>
        </div>
      )}

      {/* Output section */}
      {hasResult && result && (
        <div className="bg-gray-50 p-3 space-y-3 border-t border-gray-200">
          {result.stdout && (
            <StdoutDisplay stdout={result.stdout} />
          )}
          {result.stderr && (
            <div>
              <pre className="text-xs font-mono text-red-600 whitespace-pre-wrap bg-red-50 rounded p-2 border border-red-100 max-h-40 overflow-y-auto">
                {result.stderr}
              </pre>
              {result.stderr.length >= MAX_STDERR && (
                <p className="text-xs text-red-400 mt-1 italic">Error output truncated</p>
              )}
            </div>
          )}
          {result.plot_filenames && result.plot_filenames.length > 0 && (
            <div className="space-y-3">
              {result.plot_filenames.map((filename, idx) => {
                const isHtml = filename.endsWith(".html");
                const src = `/api/sessions/${sessionId}/output/${filename}`;
                return (
                  <div key={idx} className="relative group">
                    {isHtml ? (
                      <iframe
                        src={src}
                        title={`Plot ${idx + 1}`}
                        sandbox="allow-scripts"
                        className="w-full rounded-lg border border-gray-200"
                        style={{ height: 500 }}
                      />
                    ) : (
                      <img
                        src={src}
                        alt={`Plot ${idx + 1}`}
                        className="rounded-lg max-w-full border border-gray-200"
                      />
                    )}
                    <a
                      href={src}
                      download={filename}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-1 rounded bg-black/60 text-white hover:bg-black/80"
                    >
                      Download
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── StdoutDisplay ──────────────────────────────────────────────────────────
// Splits stdout into plain text and HTML DataFrame tables (<!--DF-->...<!--/DF-->).

function StdoutDisplay({ stdout }: { stdout: string }) {
  // Split on DataFrame HTML markers
  const segments = stdout.split(/(<!--DF-->[\s\S]*?<!--\/DF-->)/g);

  return (
    <div className="space-y-2">
      {segments.map((seg, i) => {
        if (seg.startsWith("<!--DF-->")) {
          const html = seg.slice("<!--DF-->".length, -"<!--/DF-->".length);
          return (
            <div
              key={i}
              className="overflow-x-auto rounded border border-gray-100 bg-white [&_table]:w-full [&_table]:text-xs [&_table]:font-mono [&_th]:bg-gray-50 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-gray-700 [&_th]:border-b [&_th]:border-gray-200 [&_td]:px-3 [&_td]:py-1 [&_td]:text-gray-600 [&_td]:border-b [&_td]:border-gray-50 [&_tr:hover]:bg-blue-50/40"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }
        const text = seg.trim();
        if (!text) return null;
        return (
          <div key={i} className="relative group">
            <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <CopyButton text={text} />
            </div>
            <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap bg-white rounded p-2 border border-gray-100 max-h-64 overflow-y-auto">
              {text}
            </pre>
          </div>
        );
      })}
      {stdout.length >= MAX_STDOUT && (
        <p className="text-xs text-gray-400 italic">Output truncated</p>
      )}
    </div>
  );
}

// ─── AssistantContent ────────────────────────────────────────────────────────
// Renders assistant markdown using react-markdown for proper parsing.

function AssistantContent({ content }: { content: string }) {
  // Strip markdown image syntax — plots are rendered inline from tool results
  const cleaned = content.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim();
  if (!cleaned) return null;

  return (
    <Markdown
      components={{
        h1: ({ children }) => <h2 className="text-lg font-semibold text-gray-900 mt-3 mb-1">{children}</h2>,
        h2: ({ children }) => <h3 className="text-base font-semibold text-gray-900 mt-3 mb-1">{children}</h3>,
        h3: ({ children }) => <h4 className="text-sm font-semibold text-gray-900 mt-2 mb-1">{children}</h4>,
        p: ({ children }) => <p className="text-sm leading-relaxed mb-2">{children}</p>,
        ul: ({ children }) => <ul className="text-sm leading-relaxed space-y-1 list-disc pl-5 mb-2">{children}</ul>,
        ol: ({ children }) => <ol className="text-sm leading-relaxed space-y-1 list-decimal pl-5 mb-2">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em>{children}</em>,
        code: ({ className, children }) => {
          // Fenced code blocks get a className like "language-python"
          if (className) {
            const lang = className.replace("language-", "");
            const code = String(children).replace(/\n$/, "");
            return (
              <div className="rounded-lg bg-gray-900 overflow-hidden relative group my-2">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700/50">
                  <span className="text-xs text-gray-400 font-mono">{lang}</span>
                  <CopyButton text={code} />
                </div>
                <pre className="p-3 overflow-x-auto text-xs text-green-300 font-mono whitespace-pre leading-relaxed">
                  {code}
                </pre>
              </div>
            );
          }
          // Inline code
          return (
            <code className="px-1 py-0.5 bg-gray-200 text-gray-800 rounded text-xs font-mono">
              {children}
            </code>
          );
        },
        pre: ({ children }) => <>{children}</>,
        a: ({ href, children }) => (
          <a href={href} className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {cleaned}
    </Markdown>
  );
}
