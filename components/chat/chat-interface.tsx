"use client";
// components/chat/chat-interface.tsx
//
// Compact chat panel — renders conversation as text bubbles with tool status
// indicators. Code execution details are shown in the notebook (center panel).
//
// Receives useChat() state from parent (session-workspace.tsx).

import { useEffect, useRef, useState, useMemo } from "react";
import type { UIMessage } from "ai";
import Markdown from "react-markdown";
import {
  generateSuggestedPrompts,
  type SuggestedPrompt,
} from "@/lib/data-intelligence";

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_PROMPTS: SuggestedPrompt[] = [
  { text: "Describe the dataset", category: "explore" },
  { text: "Show distributions of numeric columns", category: "visualize" },
  { text: "Correlation analysis", category: "analyze" },
  { text: "Survival analysis by cancer stage", category: "analyze" },
];

const PROMPT_CATEGORY_STYLES: Record<SuggestedPrompt["category"], string> = {
  explore: "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-300",
  visualize: "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 hover:border-purple-300",
  analyze: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300",
  clean: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-300",
};

const PROMPT_CATEGORY_ICONS: Record<SuggestedPrompt["category"], string> = {
  explore: "\u{1F50D}",
  visualize: "\u{1F4CA}",
  analyze: "\u{2699}",
  clean: "\u{1F9F9}",
};

// ─── Props ──────────────────────────────────────────────────────────────────

export interface ChatPanelProps {
  sessionId: string;
  messages: UIMessage[];
  status: string;
  error: Error | undefined;
  sendMessage: (msg: { parts: { type: "text"; text: string }[] }) => Promise<void>;
  stop: () => void;
  files: { filename: string; schema: unknown }[];
  onSendPromptRef?: React.RefObject<((text: string) => void) | null>;
  cellAttachment?: number | null;
  onClearCellAttachment?: () => void;
}

// ─── ChatPanel ──────────────────────────────────────────────────────────────

export default function ChatPanel({
  sessionId,
  messages,
  status,
  error,
  sendMessage,
  stop,
  files,
  onSendPromptRef,
  cellAttachment,
  onClearCellAttachment,
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const isLoading = status === "submitted" || status === "streaming";

  const suggestedPrompts = useMemo(() => {
    if (files.length === 0) return DEFAULT_PROMPTS;
    return generateSuggestedPrompts(files);
  }, [files]);

  // Expose prompt injection for sidebar actions
  useEffect(() => {
    if (onSendPromptRef) {
      onSendPromptRef.current = (text: string) => {
        setInput(text);
        textareaRef.current?.focus();
      };
    }
  }, [onSendPromptRef]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  }, [input]);

  async function handleSubmit(e?: React.SyntheticEvent<HTMLFormElement>) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    // Prefix cell reference so the LLM gets context and bubble renders a chip
    const fullText = cellAttachment != null
      ? `@cell:${cellAttachment} ${text}`
      : text;
    setInput("");
    onClearCellAttachment?.();
    await sendMessage({ parts: [{ type: "text", text: fullText }] });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
        {messages.length === 0 && (
          <div className="space-y-3 pt-4">
            <p className="text-gray-500 text-xs text-center">
              {files.length === 0
                ? "Upload a dataset and ask anything."
                : "Your data is ready. Try a suggestion:"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggestedPrompts.map((prompt) => (
                <button
                  key={prompt.text}
                  onClick={() => {
                    setInput(prompt.text);
                    textareaRef.current?.focus();
                  }}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${PROMPT_CATEGORY_STYLES[prompt.category]}`}
                >
                  {PROMPT_CATEGORY_ICONS[prompt.category]} {prompt.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} />
        ))}

        {isLoading && (
          <div className="flex items-center gap-1.5 text-gray-400 text-xs px-1">
            <span className="animate-pulse">●</span>
            <span>Thinking…</span>
          </div>
        )}

        {error && (
          <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">
            {error.message}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t bg-white px-3 py-3">
        <form onSubmit={handleSubmit} className="space-y-2">
          {/* Cell attachment chip */}
          {cellAttachment != null && (
            <div className="flex items-center gap-1">
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[10px] font-medium">
                @Cell {cellAttachment}
                <button
                  type="button"
                  onClick={onClearCellAttachment}
                  className="ml-0.5 rounded-full hover:bg-blue-200 p-0.5 transition-colors"
                  title="Remove reference"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your data…"
            disabled={isLoading}
            rows={3}
            className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
          />
          <div className="flex justify-end">
            {isLoading ? (
              <button
                type="button"
                onClick={() => stop()}
                className="rounded-lg bg-red-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-600 transition-colors"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              >
                Send
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── ChatBubble ─────────────────────────────────────────────────────────────
// Renders a single message as a compact bubble. Tool invocations show as
// one-line status indicators instead of full code blocks.

function ChatBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  if (isUser) {
    const rawText = message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");

    // Parse @cell:N prefix into a chip
    const cellMatch = rawText.match(/^@cell:(\d+)\s*/);
    const cellRef = cellMatch ? parseInt(cellMatch[1], 10) : null;
    const text = cellMatch ? rawText.slice(cellMatch[0].length) : rawText;

    return (
      <div className="flex justify-end">
        <div className="max-w-[90%] rounded-xl px-3 py-2 text-xs bg-blue-600 text-white rounded-br-sm">
          {cellRef != null && (
            <span className="inline-block rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-medium mr-1.5 mb-0.5">
              @Cell {cellRef}
            </span>
          )}
          <p className="whitespace-pre-wrap inline">{text}</p>
        </div>
      </div>
    );
  }

  // Assistant message — render text parts + tool status indicators
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < message.parts.length; i++) {
    const part = message.parts[i];

    if (isToolPart(part as Record<string, unknown>)) {
      const toolPart = part as {
        type: string;
        toolName?: string;
        state: string;
        input?: { code?: string; package?: string };
        output?: { status?: string; success?: boolean };
      };

      const isInstall =
        toolPart.toolName === "install_package" ||
        toolPart.type === "tool-install_package";

      const isRunning =
        toolPart.state === "input-streaming" || toolPart.state === "input-available";
      const isDone = toolPart.state === "output-available";
      const isOk = isDone && (toolPart.output?.status === "ok" || toolPart.output?.success);

      elements.push(
        <div
          key={i}
          className="flex items-center gap-1.5 px-2 py-1 rounded bg-gray-100 text-[10px] text-gray-500"
        >
          {isRunning && <span className="text-yellow-500 animate-pulse">●</span>}
          {isDone && isOk && <span className="text-green-500">✓</span>}
          {isDone && !isOk && <span className="text-red-500">✗</span>}
          <span className="font-mono">
            {isInstall
              ? `pip install ${toolPart.input?.package ?? ""}`
              : "Executed Python"}
          </span>
        </div>
      );
    } else if (part.type === "text") {
      const text = (part as { text: string }).text.trim();
      if (!text) continue;
      elements.push(
        <div
          key={i}
          className="rounded-xl px-3 py-2 text-xs bg-gray-50 text-gray-800 rounded-bl-sm border border-gray-100"
        >
          <CompactMarkdown content={text} />
        </div>
      );
    }
  }

  if (elements.length === 0) return null;

  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] space-y-1">
        {elements}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isToolPart(part: Record<string, unknown>): boolean {
  return (
    part.type === "tool-execute_python" ||
    part.type === "tool-install_package" ||
    part.type === "dynamic-tool" ||
    part.toolName === "execute_python" ||
    part.toolName === "install_package"
  );
}

function CompactMarkdown({ content }: { content: string }) {
  const cleaned = content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<table[\s\S]*?<\/table>/gi, "")
    .replace(/<div[\s\S]*?<\/div>/gi, "")
    .trim();
  if (!cleaned) return null;

  return (
    <Markdown
      components={{
        h1: ({ children }) => <h2 className="text-xs font-semibold text-gray-900 mt-1 mb-0.5">{children}</h2>,
        h2: ({ children }) => <h3 className="text-xs font-semibold text-gray-900 mt-1 mb-0.5">{children}</h3>,
        h3: ({ children }) => <h4 className="text-xs font-semibold text-gray-900 mt-1 mb-0.5">{children}</h4>,
        p: ({ children }) => <p className="text-xs leading-relaxed mb-1">{children}</p>,
        ul: ({ children }) => <ul className="text-xs leading-relaxed list-disc pl-4 mb-1">{children}</ul>,
        ol: ({ children }) => <ol className="text-xs leading-relaxed list-decimal pl-4 mb-1">{children}</ol>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        code: ({ className, children }) => {
          if (className) {
            return (
              <pre className="rounded bg-gray-900 p-2 overflow-x-auto text-[10px] text-green-300 font-mono my-1">
                {String(children).replace(/\n$/, "")}
              </pre>
            );
          }
          return (
            <code className="px-0.5 bg-gray-200 text-gray-800 rounded text-[10px] font-mono">
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
