"use client";
// components/notebook/notebook-view.tsx
//
// Projects chat messages into a notebook of code cells + outputs.
// Every execute_python tool invocation becomes a code cell.
// Commentary text stays in the chat panel only.
// Users can add blank cells and delete any cell (AI or user-created).

import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import type { UIMessage } from "ai";
import NotebookCell from "./notebook-cell";
import type { CellOutputData } from "./cell-output";

// ── Types ────────────────────────────────────────────────────────────────────

interface NotebookViewProps {
  messages: UIMessage[];
  sessionId: string;
  status: string;
  onAskAI?: (cellNumber: number) => void;
}

interface CodeCell {
  type: "code";
  cellId: string;
  code: string;
  output: CellOutputData | null;
  isStreaming: boolean;
  isUserCell?: boolean;
}

interface PromptDivider {
  type: "prompt";
  text: string;
}

interface InstallBadge {
  type: "install";
  package: string;
  success: boolean | null;
  isRunning: boolean;
}

type NotebookItem = CodeCell | PromptDivider | InstallBadge;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isToolPart(part: { type: string } & Record<string, unknown>): boolean {
  return (
    part.type === "tool-execute_python" ||
    part.type === "tool-install_package" ||
    part.type === "dynamic-tool" ||
    part.toolName === "execute_python" ||
    part.toolName === "install_package"
  );
}

function extractNotebookItems(messages: UIMessage[]): NotebookItem[] {
  const items: NotebookItem[] = [];
  // Buffer the last user prompt — only emit it if code/install follows
  let pendingPrompt: string | null = null;

  for (const msg of messages) {
    if (msg.role === "user") {
      const text = msg.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("")
        .trim();
      // Don't push yet — wait to see if code follows
      pendingPrompt = text || null;
      continue;
    }

    // Assistant message — check if it has any tool calls
    const hasToolCalls = msg.parts.some(
      (p) => isToolPart(p as { type: string } & Record<string, unknown>)
    );

    // Only show the prompt divider if this assistant response includes code
    if (hasToolCalls && pendingPrompt) {
      items.push({ type: "prompt", text: pendingPrompt });
      pendingPrompt = null;
    }

    for (const part of msg.parts) {
      if (isToolPart(part as { type: string } & Record<string, unknown>)) {
        const toolPart = part as {
          type: string;
          toolName?: string;
          toolCallId?: string;
          state: string;
          input?: { code?: string; package?: string };
          output?: CellOutputData;
        };

        const isInstall =
          toolPart.toolName === "install_package" ||
          toolPart.type === "tool-install_package";

        if (isInstall) {
          items.push({
            type: "install",
            package: toolPart.input?.package ?? "",
            success:
              toolPart.state === "output-available"
                ? toolPart.output?.success ?? null
                : null,
            isRunning:
              toolPart.state === "input-streaming" ||
              toolPart.state === "input-available",
          });
        } else {
          items.push({
            type: "code",
            cellId: toolPart.toolCallId ?? `cell-${items.length}`,
            code: toolPart.input?.code ?? "",
            output:
              toolPart.state === "output-available" ? toolPart.output ?? null : null,
            isStreaming:
              toolPart.state === "input-streaming" ||
              toolPart.state === "input-available",
          });
        }
      }
    }
  }

  return items;
}

// ── Add Cell Button ─────────────────────────────────────────────────────────

function AddCellButton({ onClick, label }: { onClick: () => void; label?: string }) {
  return (
    <div className="flex items-center gap-2 py-1 opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity">
      <div className="h-px flex-1 bg-gray-200" />
      <button
        onClick={onClick}
        className="flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-3 py-1 text-[11px] text-gray-400 hover:text-gray-600 hover:border-gray-400 hover:bg-gray-50 transition-colors"
        title="Add code cell"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        {label ?? "Code"}
      </button>
      <div className="h-px flex-1 bg-gray-200" />
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function NotebookView({
  messages,
  sessionId,
  status,
  onAskAI,
}: NotebookViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageItems = useMemo(() => extractNotebookItems(messages), [messages]);

  // User-created cells: stored as { id, afterIndex } where afterIndex is
  // the position in messageItems after which the cell was inserted.
  // -1 means at the very end (append).
  const [userCells, setUserCells] = useState<
    { id: string; afterIndex: number }[]
  >([]);

  // Hidden AI cells (deleted by user — we hide, not actually delete from messages)
  const [hiddenCellIds, setHiddenCellIds] = useState<Set<string>>(new Set());

  // Auto-scroll on new items
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageItems.length, userCells.length]);

  const addCellAfter = useCallback((afterIndex: number) => {
    const id = `user-cell-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setUserCells((prev) => [...prev, { id, afterIndex }]);
  }, []);

  const deleteUserCell = useCallback((cellId: string) => {
    setUserCells((prev) => prev.filter((c) => c.id !== cellId));
  }, []);

  const hideAICell = useCallback((cellId: string) => {
    setHiddenCellIds((prev) => new Set(prev).add(cellId));
  }, []);

  // Merge message-derived items with user-created cells
  // Build a flat list: for each position, insert message items then any user cells at that position
  const mergedItems: Array<
    | (NotebookItem & { _index: number })
    | { type: "user-code"; id: string }
  > = [];

  for (let i = 0; i < messageItems.length; i++) {
    const item = messageItems[i];
    // Skip hidden AI cells
    if (item.type === "code" && hiddenCellIds.has(item.cellId)) continue;
    mergedItems.push({ ...item, _index: i });
    // Insert user cells that go after this index
    for (const uc of userCells) {
      if (uc.afterIndex === i) {
        mergedItems.push({ type: "user-code", id: uc.id });
      }
    }
  }
  // User cells at the end (afterIndex === -1 or >= messageItems.length)
  for (const uc of userCells) {
    if (uc.afterIndex === -1 || uc.afterIndex >= messageItems.length) {
      mergedItems.push({ type: "user-code", id: uc.id });
    }
  }

  // Find the last code cell index so we can auto-collapse earlier error cells
  let lastCodeIndex = -1;
  for (let i = mergedItems.length - 1; i >= 0; i--) {
    const mi = mergedItems[i];
    if (mi.type === "code" || mi.type === "user-code") {
      lastCodeIndex = i;
      break;
    }
  }

  // Number code cells
  let cellNumber = 0;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-6 space-y-3">
        {messageItems.length === 0 && userCells.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-4">
            <p className="text-gray-400 text-sm">
              Ask a question in the chat to start your analysis.
            </p>
            <AddCellButton
              onClick={() => addCellAfter(-1)}
              label="Add code cell"
            />
          </div>
        )}

        {mergedItems.map((item, i) => {
          if (item.type === "user-code") {
            cellNumber++;
            return (
              <div key={item.id}>
                <NotebookCell
                  cellId={item.id}
                  cellNumber={cellNumber}
                  initialCode=""
                  initialOutput={null}
                  isStreaming={false}
                  sessionId={sessionId}
                  isUserCell
                  onDelete={() => deleteUserCell(item.id)}
                  onAskAI={onAskAI}
                />
                <AddCellButton onClick={() => addCellAfter(i)} />
              </div>
            );
          }

          switch (item.type) {
            case "prompt":
              return (
                <div key={`prompt-${i}`} className="flex items-center gap-3 py-2">
                  <div className="h-px flex-1 bg-gray-200" />
                  <span className="text-xs text-gray-400 shrink-0 max-w-md truncate">
                    {item.text}
                  </span>
                  <div className="h-px flex-1 bg-gray-200" />
                </div>
              );

            case "install":
              return (
                <div
                  key={`install-${i}`}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs"
                >
                  <span className="font-mono text-gray-500">
                    pip install {item.package}
                  </span>
                  {item.isRunning && (
                    <span className="text-yellow-500 animate-pulse">
                      Installing…
                    </span>
                  )}
                  {item.success === true && (
                    <span className="text-green-500">✓</span>
                  )}
                  {item.success === false && (
                    <span className="text-red-500">✗</span>
                  )}
                </div>
              );

            case "code": {
              cellNumber++;
              const codeItem = item as CodeCell & { _index: number };
              // Auto-collapse error cells when they're not the last code cell
              // (i.e., the AI retried with a new cell after this one)
              const hasError = codeItem.output?.status === "error" ||
                (codeItem.output?.exit_code !== undefined && codeItem.output.exit_code !== 0);
              const shouldAutoCollapse = hasError && i < lastCodeIndex;
              return (
                <div key={codeItem.cellId}>
                  <NotebookCell
                    cellId={codeItem.cellId}
                    cellNumber={cellNumber}
                    initialCode={codeItem.code}
                    initialOutput={codeItem.output}
                    isStreaming={codeItem.isStreaming}
                    sessionId={sessionId}
                    autoCollapsed={shouldAutoCollapse}
                    onDelete={() => hideAICell(codeItem.cellId)}
                    onAskAI={onAskAI}
                  />
                  <AddCellButton onClick={() => addCellAfter(codeItem._index)} />
                </div>
              );
            }
          }
        })}

        {/* Add cell at the very bottom */}
        {(messageItems.length > 0 || userCells.length > 0) && (
          <AddCellButton onClick={() => addCellAfter(-1)} label="Add code cell" />
        )}


        <div ref={bottomRef} />
      </div>
    </div>
  );
}
