"use client";
// components/data/data-quality-banner.tsx
//
// Surfaces data quality issues detected from the uploaded dataset schema.
// Shows an amber banner with expandable details and a "Ask AI to clean" action.

import { useState, useMemo } from "react";
import {
  analyzeDataQuality,
  type DataQualityIssue,
} from "@/lib/data-intelligence";

interface DataQualityBannerProps {
  files: { filename: string; schema: unknown }[];
  onAskClean: (prompt: string) => void;
}

export default function DataQualityBanner({ files, onAskClean }: DataQualityBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const issues = useMemo(() => analyzeDataQuality(files), [files]);

  if (issues.length === 0 || dismissed) return null;

  const warnings = issues.filter((i) => i.severity === "warning");
  const infos = issues.filter((i) => i.severity === "info");

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 overflow-hidden text-xs">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-amber-100/50 transition-colors"
      >
        <span className="text-amber-500 text-sm">&#9888;</span>
        <span className="flex-1 text-left text-amber-800 font-medium">
          {warnings.length > 0
            ? `${warnings.length} data quality issue${warnings.length > 1 ? "s" : ""} found`
            : `${infos.length} data note${infos.length > 1 ? "s" : ""}`}
        </span>
        <span className="text-amber-400 text-[10px]">{expanded ? "▾" : "▸"}</span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-amber-200 px-3 py-2 space-y-1.5">
          {issues.map((issue, i) => (
            <IssueRow key={i} issue={issue} />
          ))}

          <div className="flex items-center gap-2 pt-1.5 border-t border-amber-200/60">
            <button
              onClick={() =>
                onAskClean(
                  "Analyze the data quality issues in my dataset (missing values, duplicates, outliers, type issues) and suggest a cleaning plan. Show what you find but don't modify the data yet."
                )
              }
              className="rounded bg-amber-600 px-2.5 py-1 text-white text-[11px] font-medium hover:bg-amber-700 transition-colors"
            >
              Ask AI to review
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="rounded px-2 py-1 text-amber-600 text-[11px] hover:bg-amber-100 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function IssueRow({ issue }: { issue: DataQualityIssue }) {
  return (
    <div className="flex items-start gap-1.5">
      <span
        className={`mt-0.5 ${
          issue.severity === "warning" ? "text-amber-500" : "text-amber-400"
        }`}
      >
        {issue.severity === "warning" ? "●" : "○"}
      </span>
      <div className="min-w-0">
        <p className="text-amber-900">{issue.message}</p>
        <p className="text-amber-600/80 text-[10px] leading-tight">{issue.detail}</p>
      </div>
    </div>
  );
}
