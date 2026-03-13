// lib/upload/parse.ts
//
// Extracted from app/api/sessions/[id]/upload/route.ts for testability.
// Pure functions for parsing uploaded files and inferring dataset schemas.

import Papa from "papaparse";
import * as XLSX from "xlsx";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ColumnStats {
  type: string; // "number" | "string" | "boolean"
  missingCount: number;
  uniqueCount: number;
  sampleValues: unknown[];
}

export interface DatasetSchema {
  columns: Record<string, ColumnStats>;
  rowCount: number;
}

// ── Extension Check ──────────────────────────────────────────────────────────

/**
 * Some browsers send generic MIME types for CSV/TSV; fall back to extension check.
 */
export function isAllowedByExtension(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ["csv", "tsv", "xlsx", "xls"].includes(ext ?? "");
}

// ── File Parsing ─────────────────────────────────────────────────────────────

/**
 * Parses CSV, TSV, or XLSX into an array of row objects.
 * Returns an empty array if the format is unrecognised.
 */
export function parseFile(
  filename: string,
  buffer: Buffer
): Record<string, unknown>[] {
  const ext = filename.split(".").pop()?.toLowerCase();

  if (ext === "csv" || ext === "tsv") {
    const text = buffer.toString("utf-8");
    const delimiter = ext === "tsv" ? "\t" : undefined;
    const result = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      delimiter,
    });
    return result.data;
  }

  if (ext === "xlsx" || ext === "xls") {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[sheetName]
    );
  }

  return [];
}

// ── Schema Inference ─────────────────────────────────────────────────────────

/**
 * Infers column-level stats from an array of parsed rows.
 */
export function inferSchema(rows: Record<string, unknown>[]): DatasetSchema {
  if (rows.length === 0) return { columns: {}, rowCount: 0 };

  const columns: Record<string, ColumnStats> = {};
  const columnNames = Object.keys(rows[0]);

  for (const col of columnNames) {
    const values = rows.map((row) => row[col]);
    const nonNull = values.filter(
      (v) => v !== null && v !== undefined && v !== ""
    );

    // Majority voting over up to 100 sampled values to avoid first-value bias
    let type = "string";
    if (nonNull.length > 0) {
      const sampled = nonNull.slice(0, 100);
      let numCount = 0;
      let boolCount = 0;
      for (const v of sampled) {
        if (typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v)))) {
          numCount++;
        } else if (v === true || v === false || v === "true" || v === "false") {
          boolCount++;
        }
      }
      const majority = sampled.length / 2;
      if (numCount > majority) {
        type = "number";
      } else if (boolCount > majority) {
        type = "boolean";
      }
    }

    columns[col] = {
      type,
      missingCount: values.length - nonNull.length,
      uniqueCount: new Set(values.map(String)).size,
      sampleValues: nonNull.slice(0, 3),
    };
  }

  return { columns, rowCount: rows.length };
}
