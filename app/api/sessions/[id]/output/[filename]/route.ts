// app/api/sessions/[id]/output/[filename]/route.ts
//
// GET /api/sessions/:id/output/:filename
//
// Serves output artifacts (Plotly HTML, images) from S3.
// The frontend renders Plotly HTML files in iframes via this route.

import { NextRequest } from "next/server";
import { getOutputFile } from "@/lib/storage/files";

// Content-type mapping for common output formats
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".csv": "text/csv",
  ".json": "application/json",
  ".pdf": "application/pdf",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> }
) {
  const { id: sessionId, filename } = await params;

  // Prevent path traversal — filename must not contain slashes or ..
  if (filename.includes("..") || filename.includes("/")) {
    return new Response("Invalid filename", { status: 400 });
  }

  try {
    const buffer = await getOutputFile(sessionId, filename);
    const ext = "." + filename.split(".").pop()?.toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

    return new Response(new Uint8Array(buffer), {
      headers: { "Content-Type": contentType },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
