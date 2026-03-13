"use client";
// components/notebook/cell-output.tsx
//
// Renders execution output for a notebook cell: stdout, stderr, errors,
// DataFrame tables, and plots (images + Plotly iframes).
// Shared by NotebookCell for both initial (chat-driven) and re-run outputs.

import { useState, useCallback, memo } from "react";
import DOMPurify from "dompurify";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CellOutputData {
  status?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
  tables?: string[];
  plot_filenames?: string[];
  elapsed_ms?: number;
  // Legacy
  exit_code?: number;
  // install_package
  success?: boolean;
  output?: string;
}

interface CellOutputProps {
  output: CellOutputData;
  sessionId: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_STDOUT = 10_000;
const MAX_STDERR = 5_000;

const TABLE_STYLES =
  "overflow-x-auto rounded border border-gray-100 bg-white " +
  "[&_table]:w-full [&_table]:text-xs [&_table]:font-mono " +
  "[&_th]:bg-gray-50 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-gray-700 [&_th]:border-b [&_th]:border-gray-200 " +
  "[&_td]:px-3 [&_td]:py-1 [&_td]:text-gray-600 [&_td]:border-b [&_td]:border-gray-50 [&_tr:hover]:bg-blue-50/40";

// ── Component ────────────────────────────────────────────────────────────────

function CellOutputInner({ output, sessionId }: CellOutputProps) {
  return (
    <div className="space-y-3">
      {/* stdout */}
      {output.stdout && <StdoutDisplay stdout={output.stdout} />}

      {/* stderr */}
      {output.stderr && (
        <div>
          <pre className="text-xs font-mono text-red-600 whitespace-pre-wrap bg-red-50 rounded p-2 border border-red-100 max-h-40 overflow-y-auto">
            {output.stderr}
          </pre>
          {output.stderr.length >= MAX_STDERR && (
            <p className="text-xs text-red-400 mt-1 italic">Error output truncated</p>
          )}
        </div>
      )}

      {/* Structured error */}
      {output.error && typeof output.error === "string" && (
        <pre className="text-xs font-mono text-red-600 whitespace-pre-wrap bg-red-50 rounded p-2 border border-red-100 max-h-40 overflow-y-auto">
          {output.error}
        </pre>
      )}

      {/* Inline HTML tables (DataFrames) — sanitized to table-related tags only */}
      {output.tables && output.tables.length > 0 && (
        <div className="space-y-3">
          {output.tables.map((html, idx) => (
            <div
              key={idx}
              className={TABLE_STYLES}
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(html, {
                  ALLOWED_TAGS: [
                    "table", "thead", "tbody", "tfoot", "tr", "th", "td",
                    "caption", "colgroup", "col", "div", "span", "p", "br",
                    "strong", "em", "b", "i",
                  ],
                  ALLOWED_ATTR: ["class", "style", "colspan", "rowspan", "scope"],
                }),
              }}
            />
          ))}
        </div>
      )}

      {/* Output files: images + Plotly HTML */}
      {output.plot_filenames && output.plot_filenames.length > 0 && (
        <div className="space-y-3">
          {output.plot_filenames.map((filename, idx) => {
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
  );
}

const CellOutput = memo(CellOutputInner, (prev, next) => {
  // Same session + same output reference = skip re-render
  if (prev.sessionId === next.sessionId && prev.output === next.output) return true;
  if (prev.sessionId !== next.sessionId) return false;
  // Deep compare output content
  return JSON.stringify(prev.output) === JSON.stringify(next.output);
});

export default CellOutput;

// ── StdoutDisplay ──────────────────────────────────────────────────────────

function StdoutDisplay({ stdout }: { stdout: string }) {
  const text = stdout.trim();
  if (!text) return null;

  return (
    <div className="relative group">
      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyButton text={text} />
      </div>
      <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap bg-white rounded p-2 border border-gray-100 max-h-64 overflow-y-auto">
        {text}
      </pre>
      {stdout.length >= MAX_STDOUT && (
        <p className="text-xs text-gray-400 italic mt-1">Output truncated</p>
      )}
    </div>
  );
}

// ── CopyButton ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
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
          ? "text-green-600 bg-green-50"
          : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
      }`}
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
