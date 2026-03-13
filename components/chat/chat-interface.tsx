"use client";
// components/chat/chat-interface.tsx
//
// Compact chat panel — renders conversation as text bubbles with tool status
// indicators. Restyled to match Stitch design (orange user bubbles, styled AI bubbles).

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
  explore: "border-primary/20 bg-primary/10 text-primary hover:bg-primary/20",
  visualize: "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100",
  analyze: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
  clean: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
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

  // Suppress unused var warning — sessionId used for potential future features
  void sessionId;

  return (
    <div className="flex h-full flex-col">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white">
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
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${PROMPT_CATEGORY_STYLES[prompt.category]}`}
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
            <span>Thinking...</span>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 border border-red-200">
            {error.message}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area with prompt pills */}
      <div className="p-4 border-t border-gray-100 space-y-4">
        {/* Prompt pills */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[
            { label: "Clean data", prompt: "Check the dataset for missing values, duplicates, and inconsistent formatting. Fix any issues, show what you changed, and save the cleaned version." },
            { label: "Explain code", prompt: "Walk me through the most recent code cell step by step. Explain what each section does, why it was written that way, and flag anything that could be improved." },
            { label: "Optimize run", prompt: "Profile the most recent analysis for performance bottlenecks. Suggest and apply optimizations — vectorize loops, reduce memory usage, or use more efficient algorithms." },
          ].map(({ label, prompt }) => (
            <button
              key={label}
              onClick={() => { setInput(prompt); textareaRef.current?.focus(); }}
              className="shrink-0 px-3 py-1 rounded-full text-[10px] font-bold transition-colors bg-gray-100 text-gray-600 hover:bg-gray-200"
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="relative">
          {/* Cell attachment chip */}
          {cellAttachment != null && (
            <div className="flex items-center gap-1 mb-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium">
                @Cell {cellAttachment}
                <button
                  type="button"
                  onClick={onClearCellAttachment}
                  className="ml-0.5 rounded-full hover:bg-primary/20 p-0.5 transition-colors"
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
            placeholder="Ask DataChat anything about your session..."
            disabled={isLoading}
            rows={3}
            className="w-full bg-slate-100 border border-slate-200 rounded-xl text-xs p-3 pr-12 focus:ring-1 focus:ring-primary resize-none min-h-[80px] text-gray-900 placeholder:text-gray-500"
          />
          <div className="absolute bottom-3 right-3">
            {isLoading ? (
              <button
                type="button"
                onClick={() => stop()}
                className="p-2 bg-red-500 text-white rounded-lg shadow-lg hover:bg-red-600 transition"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="p-2 bg-primary text-white rounded-lg shadow-lg disabled:opacity-40 hover:bg-primary/90 transition"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>send</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── ChatBubble ─────────────────────────────────────────────────────────────

function ChatBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  if (isUser) {
    const rawText = message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");

    const cellMatch = rawText.match(/^@cell:(\d+)\s*/);
    const cellRef = cellMatch ? parseInt(cellMatch[1], 10) : null;
    const text = cellMatch ? rawText.slice(cellMatch[0].length) : rawText;

    return (
      <div className="flex flex-col gap-1 items-end ml-auto max-w-[85%]">
        <div className="bg-primary text-white p-3 rounded-2xl rounded-tr-none text-xs leading-relaxed shadow-sm">
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

  // Assistant message
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

      const isSaveDataset =
        toolPart.toolName === "save_dataset" ||
        toolPart.type === "tool-save_dataset";

      const isRunning =
        toolPart.state === "input-streaming" || toolPart.state === "input-available";
      const isDone = toolPart.state === "output-available";
      const isOk = isDone && (toolPart.output?.status === "ok" || toolPart.output?.success);

      let label = "Executed Python";
      if (isInstall) label = `pip install ${toolPart.input?.package ?? ""}`;
      else if (isSaveDataset) label = `save_dataset ${(toolPart.input as Record<string, string>)?.filename ?? ""}`;

      elements.push(
        <div
          key={i}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-200/70 text-[10px] text-gray-600"
        >
          {isRunning && <span className="text-yellow-500 animate-pulse">●</span>}
          {isDone && isOk && <span className="text-emerald-500">✓</span>}
          {isDone && !isOk && <span className="text-red-500">✗</span>}
          <span className="font-mono">{label}</span>
        </div>
      );
    } else if (part.type === "text") {
      const text = (part as { text: string }).text.trim();
      if (!text) continue;

      elements.push(
        <div
          key={i}
          className="bg-slate-100 p-3 rounded-2xl rounded-tl-none text-xs leading-relaxed text-gray-800"
        >
          <CompactMarkdown content={text} />
        </div>
      );
    }
  }

  if (elements.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 max-w-[85%]">
      {elements}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isToolPart(part: Record<string, unknown>): boolean {
  return (
    (typeof part.type === "string" && part.type.startsWith("tool-")) ||
    part.type === "dynamic-tool" ||
    part.toolName === "execute_python" ||
    part.toolName === "install_package" ||
    part.toolName === "save_dataset"
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
              <pre className="rounded-lg bg-gray-900 p-2 overflow-x-auto text-[11px] text-emerald-400 font-mono my-1">
                {String(children).replace(/\n$/, "")}
              </pre>
            );
          }
          return (
            <code className="px-1 py-0.5 bg-gray-200 text-gray-800 rounded text-[10px] font-mono">
              {children}
            </code>
          );
        },
        pre: ({ children }) => <>{children}</>,
        a: ({ href, children }) => (
          <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {cleaned}
    </Markdown>
  );
}
