"use client";
// components/notebook/notebook-cell.tsx
//
// A single notebook cell with:
//   - CodeMirror 5 editor (Python syntax, editable)
//   - Run button for manual re-execution
//   - Output area below (stdout, tables, plots, errors)
//   - Cell number display (In [n])
//   - Copy code, clear output, delete cell, "Ask AI" actions
//   - Color-coded left border for status
//   - Elapsed time counter while running

import { useState, useCallback, useEffect, useRef, memo } from "react";
import dynamic from "next/dynamic";
import CellOutput, { type CellOutputData } from "./cell-output";

// Lazy-load CodeMirror to avoid SSR issues
const CodeMirrorEditor = dynamic(
  () => import("./codemirror-editor"),
  { ssr: false, loading: () => <div className="h-20 bg-gray-900 animate-pulse rounded" /> }
);

// ── Types ────────────────────────────────────────────────────────────────────

interface NotebookCellProps {
  cellId: string;
  cellNumber: number;
  initialCode: string;
  initialOutput: CellOutputData | null;
  isStreaming: boolean;
  sessionId: string;
  isUserCell?: boolean;
  autoCollapsed?: boolean; // auto-collapse error cells when AI retries
  onDelete?: () => void;
  onAskAI?: (cellNumber: number) => void;
  onDebugError?: (code: string, error: string) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

function NotebookCell({
  cellId,
  cellNumber,
  initialCode,
  initialOutput,
  isStreaming,
  sessionId,
  isUserCell,
  autoCollapsed = false,
  onDelete,
  onAskAI,
  onDebugError,
}: NotebookCellProps) {
  const [code, setCode] = useState(initialCode);
  const [isEdited, setIsEdited] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [rerunOutput, setRerunOutput] = useState<CellOutputData | null>(null);
  const [collapsed, setCollapsed] = useState(autoCollapsed);
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevAutoCollapsed = useRef(autoCollapsed);

  // Auto-collapse when parent signals (error cell with a retry after it)
  // Only trigger on false→true transition to avoid render loops
  useEffect(() => {
    if (autoCollapsed && !prevAutoCollapsed.current) {
      setCollapsed(true);
    }
    prevAutoCollapsed.current = autoCollapsed;
  }, [autoCollapsed]);

  // Update code when streaming input changes — only if content actually changed
  const prevInitialCode = useRef(initialCode);
  useEffect(() => {
    if (!isEdited && initialCode !== prevInitialCode.current) {
      prevInitialCode.current = initialCode;
      setCode(initialCode);
    }
  }, [initialCode, isEdited]);

  // Elapsed time counter
  useEffect(() => {
    if (isRunning) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((t) => t + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning]);

  const handleCodeChange = useCallback((value: string) => {
    setCode(value);
    setIsEdited(value !== initialCode);
  }, [initialCode]);

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const result = await res.json();
      setRerunOutput(result);
    } catch {
      setRerunOutput({ status: "error", stderr: "Failed to connect to sandbox" });
    } finally {
      setIsRunning(false);
    }
  }, [code, sessionId]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      handleRun();
    }
  }, [handleRun]);

  const handleCopyCode = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const handleClearOutput = useCallback(() => {
    setRerunOutput(null);
  }, []);

  const handleAskAI = useCallback(() => {
    if (!onAskAI) return;
    onAskAI(cellNumber);
  }, [onAskAI, cellNumber]);

  // Determine which output to show: re-run output takes priority
  const output = rerunOutput ?? initialOutput;
  const isSuccess = output?.status === "ok" || (output?.exit_code !== undefined && output.exit_code === 0);
  const hasError = output?.status === "error" || (output?.exit_code !== undefined && output.exit_code !== 0);

  const handleDebugError = useCallback(() => {
    if (!onDebugError) return;
    const errorText = output?.error ?? output?.stderr ?? "Unknown error";
    onDebugError(code, errorText);
  }, [onDebugError, code, output]);

  // Subtle left border — only highlight problems
  const borderColor = isRunning || isStreaming
    ? "border-l-yellow-400"
    : output && hasError
      ? "border-l-red-400"
      : "border-l-transparent";

  return (
    <div className={`group border border-gray-200 rounded-lg overflow-hidden hover:border-gray-300 transition-colors border-l-[3px] ${borderColor}`}>
      {/* Cell header */}
      <div className="flex items-center gap-1.5 bg-gray-50 px-3 py-1.5 border-b border-gray-200">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-gray-400 hover:text-gray-600 transition-colors text-xs w-4"
          title={collapsed ? "Expand cell" : "Collapse cell"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span className="text-xs font-mono text-gray-400 shrink-0">
          In [{cellNumber}]
        </span>
        {collapsed && (
          <span className="text-xs font-mono text-gray-300 truncate flex-1 min-w-0">
            {code.split("\n")[0]}
          </span>
        )}
        {!collapsed && <div className="flex-1" />}

        {/* Status + modified badge */}
        {isEdited && !isRunning && (
          <span className="text-xs text-amber-500">modified</span>
        )}

        {/* Action buttons — visible on hover */}
        {!collapsed && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Copy code */}
            <button
              onClick={handleCopyCode}
              className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                copied
                  ? "text-green-600 bg-green-50"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              }`}
              title="Copy code"
            >
              {copied ? "Copied" : "Copy"}
            </button>

            {/* Clear output */}
            {(rerunOutput || initialOutput) && (
              <button
                onClick={handleClearOutput}
                className="rounded px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title="Clear output"
              >
                Clear
              </button>
            )}

            {/* Ask AI */}
            {onAskAI && output && (
              <button
                onClick={handleAskAI}
                className="rounded px-1.5 py-0.5 text-[10px] text-blue-500 hover:text-blue-700 hover:bg-blue-50 transition-colors"
                title="Ask AI about this output"
              >
                Ask AI
              </button>
            )}

            {/* Delete cell */}
            {onDelete && (
              <button
                onClick={onDelete}
                className="rounded px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="Delete cell"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Run button + status indicator — grouped together */}
        {!collapsed && (
          <div className="flex items-center gap-1.5">
            {isStreaming && (
              <span className="text-xs text-yellow-500 animate-pulse">Writing…</span>
            )}
            {isRunning && (
              <span className="text-xs text-yellow-500 animate-pulse">
                Running… {elapsed > 0 && <span className="font-mono">{elapsed}s</span>}
              </span>
            )}
            {!isStreaming && !isRunning && output && isSuccess && (
              <span className="text-xs text-green-500">
                ✓{output.elapsed_ms != null && (
                  <span className="ml-1 font-mono text-gray-400">{output.elapsed_ms >= 1000 ? `${(output.elapsed_ms / 1000).toFixed(1)}s` : `${output.elapsed_ms}ms`}</span>
                )}
              </span>
            )}
            {!isStreaming && !isRunning && output && hasError && (
              <span className="text-xs text-red-500">
                ✗{output.elapsed_ms != null && (
                  <span className="ml-1 font-mono text-gray-400">{output.elapsed_ms >= 1000 ? `${(output.elapsed_ms / 1000).toFixed(1)}s` : `${output.elapsed_ms}ms`}</span>
                )}
              </span>
            )}
            <button
              onClick={handleRun}
              disabled={isStreaming || isRunning || !code.trim()}
              className="rounded px-2 py-0.5 text-xs font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 transition-colors"
              title="Run cell (Shift+Enter)"
            >
              ▶ Run
            </button>
          </div>
        )}
      </div>

      {!collapsed && (
        <>
          {/* Code editor — capped height with scroll */}
          <div
            className="max-h-80 overflow-y-auto"
            onKeyDown={(e) => handleKeyDown(e.nativeEvent)}
          >
            <CodeMirrorEditor
              value={code}
              onChange={handleCodeChange}
              readOnly={isStreaming}
            />
          </div>

          {/* Output area — capped height with scroll */}
          {(isRunning || output) && (
            <div className="border-t border-gray-200 bg-gray-50 p-3 max-h-96 overflow-y-auto">
              {isRunning ? (
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="animate-pulse">●</span>
                  <span>Executing…</span>
                </div>
              ) : output ? (
                <>
                  <CellOutput output={output} sessionId={sessionId} />
                  {hasError && onDebugError && (
                    <button
                      onClick={handleDebugError}
                      className="mt-2 flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Debug with AI
                    </button>
                  )}
                </>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Stable JSON comparison for output objects to avoid re-renders from new references
function outputEqual(a: CellOutputData | null, b: CellOutputData | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  // Compare by status + exit_code as a fast path — covers most cases
  if (a.status !== b.status) return false;
  if (a.exit_code !== b.exit_code) return false;
  // For complete outputs, reference stability is enough after the fast check
  // Only do full comparison for outputs that differ on fast path
  return JSON.stringify(a) === JSON.stringify(b);
}

export default memo(NotebookCell, (prev, next) => {
  return (
    prev.cellId === next.cellId &&
    prev.cellNumber === next.cellNumber &&
    prev.initialCode === next.initialCode &&
    prev.isStreaming === next.isStreaming &&
    prev.sessionId === next.sessionId &&
    prev.isUserCell === next.isUserCell &&
    prev.autoCollapsed === next.autoCollapsed &&
    outputEqual(prev.initialOutput, next.initialOutput)
  );
});
