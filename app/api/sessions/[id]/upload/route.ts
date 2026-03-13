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
import { prisma } from "@/lib/db/prisma";
import { saveUploadedFile } from "@/lib/storage/files";
import { uploadFile } from "@/lib/sandbox/client";
import { parseFile, inferSchema, isAllowedByExtension } from "@/lib/upload/parse";

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

  // Save to S3 — returns the S3 key (stored as filePath in the DB)
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

