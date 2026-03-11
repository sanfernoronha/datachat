// app/api/sessions/[id]/upload/route.ts
//
// POST /api/sessions/:id/upload
//
// Accepts a multipart/form-data upload, saves the file to disk, infers the
// dataset schema (column names, types, missing/unique counts), stores the
// metadata in the database, and returns a preview of the first 5 rows.
//
// Supported formats: CSV, TSV, XLSX
// Size limit: MAX_UPLOAD_SIZE_BYTES (default 100 MB)

import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db/prisma";
import { saveUploadedFile } from "@/lib/storage/files";
import { uploadFile } from "@/lib/sandbox/client";

// Allowed MIME types — anything else is rejected
const ALLOWED_MIME_TYPES = new Set([
  "text/csv",
  "text/tab-separated-values",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

const MAX_BYTES = Number(process.env.MAX_UPLOAD_SIZE_BYTES) || 100 * 1024 * 1024;

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  // Verify session exists before doing any file I/O
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Parse the multipart form
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Reject unsupported types
  if (!ALLOWED_MIME_TYPES.has(file.type) && !isAllowedByExtension(file.name)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}` },
      { status: 415 }
    );
  }

  // Enforce size limit
  if (file.size > MAX_BYTES) {
    const limitMB = Math.round(MAX_BYTES / 1024 / 1024);
    return NextResponse.json(
      { error: `File too large (limit: ${limitMB} MB)` },
      { status: 413 }
    );
  }

  // Read file bytes
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  // Parse into rows so we can infer the schema
  const rows = parseFile(file.name, buffer);

  if (rows.length === 0) {
    return NextResponse.json({ error: "File appears to be empty" }, { status: 422 });
  }

  // Infer column-level statistics from the parsed rows
  const schema = inferSchema(rows);

  // Save the raw file to disk (for local schema inference)
  const filePath = await saveUploadedFile(sessionId, file.name, buffer);

  // Upload to the sandbox so the Jupyter kernel can access it
  try {
    await uploadFile(sessionId, file.name, buffer);
  } catch (err) {
    console.warn("Failed to upload file to sandbox (will retry on first code execution):", err);
  }

  // Persist file metadata to the database
  await prisma.uploadedFile.create({
    data: {
      sessionId,
      filename: file.name,
      filePath,
      fileSize: BigInt(file.size),
      fileType: file.type,
      // Cast to `object` for Prisma's Json field — the type is safe at runtime
      schema: schema as object,
    },
  });

  // Return schema + a 5-row preview so the UI can render a data card
  return NextResponse.json(
    {
      filename: file.name,
      rowCount: rows.length,
      columnCount: Object.keys(schema.columns).length,
      schema,
      preview: rows.slice(0, 5),
    },
    { status: 201 }
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Some browsers send generic MIME types for CSV/TSV; fall back to extension check.
 */
function isAllowedByExtension(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ["csv", "tsv", "xlsx", "xls"].includes(ext ?? "");
}

/**
 * Parses CSV, TSV, or XLSX into an array of row objects.
 * Returns an empty array if the format is unrecognised.
 */
function parseFile(filename: string, buffer: Buffer): Record<string, unknown>[] {
  const ext = filename.split(".").pop()?.toLowerCase();

  if (ext === "csv" || ext === "tsv") {
    const text = buffer.toString("utf-8");
    const delimiter = ext === "tsv" ? "\t" : undefined; // auto-detect for CSV
    const result = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      delimiter,
    });
    return result.data;
  }

  if (ext === "xlsx" || ext === "xls") {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0]; // Use the first sheet
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[sheetName]
    );
  }

  return [];
}

// Shape returned by inferSchema — also what we persist in the DB
interface ColumnStats {
  type: string;         // "number" | "string" | "boolean"
  missingCount: number; // rows where this column is null/undefined/empty
  uniqueCount: number;  // cardinality
  sampleValues: unknown[]; // first 3 non-null values (useful for LLM context)
}

interface DatasetSchema {
  columns: Record<string, ColumnStats>;
  rowCount: number;
}

/**
 * Infers column-level stats from an array of parsed rows.
 *
 * We use the first row's keys as the column list and scan every row for:
 *   - Missing values (null, undefined, empty string)
 *   - Unique value count (cardinality)
 *   - Whether the column is numeric, boolean, or string
 *   - A small sample of non-null values for the LLM prompt
 */
function inferSchema(rows: Record<string, unknown>[]): DatasetSchema {
  if (rows.length === 0) return { columns: {}, rowCount: 0 };

  const columns: Record<string, ColumnStats> = {};
  const columnNames = Object.keys(rows[0]);

  for (const col of columnNames) {
    const values = rows.map((row) => row[col]);
    const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");

    // Determine dominant type by checking the first non-null value
    let type = "string";
    if (nonNull.length > 0) {
      const sample = nonNull[0];
      if (typeof sample === "number" || !isNaN(Number(sample))) {
        type = "number";
      } else if (sample === true || sample === false || sample === "true" || sample === "false") {
        type = "boolean";
      }
    }

    columns[col] = {
      type,
      missingCount: values.length - nonNull.length,
      uniqueCount: new Set(values.map(String)).size,
      sampleValues: nonNull.slice(0, 3), // first 3 non-null values
    };
  }

  return { columns, rowCount: rows.length };
}
