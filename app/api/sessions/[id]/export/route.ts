// app/api/sessions/[id]/export/route.ts
//
// GET /api/sessions/:id/export?format=notebook|zip
//
// Exports the session as a downloadable Jupyter Notebook (.ipynb) or
// a ZIP bundle containing the notebook + all output artifacts.

import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";
import { Readable } from "stream";
import { prisma } from "@/lib/db/prisma";
import { buildNotebook, type DbMessage } from "@/lib/export/notebook";
import { listOutputArtifacts, getOutputFile } from "@/lib/storage/files";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const format = req.nextUrl.searchParams.get("format") ?? "notebook";

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!session) {
    return new NextResponse("Session not found", { status: 404 });
  }

  const safeName = (session.name || "session").replace(/[^a-zA-Z0-9_-]/g, "_");

  const notebook = await buildNotebook(
    session.messages as unknown as DbMessage[],
    sessionId
  );

  // ── Notebook format ───────────────────────────────────────────────────────
  if (format === "notebook") {
    const json = JSON.stringify(notebook, null, 2);
    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/x-ipynb+json",
        "Content-Disposition": `attachment; filename="${safeName}.ipynb"`,
      },
    });
  }

  // ── ZIP format ────────────────────────────────────────────────────────────
  if (format === "zip") {
    const archive = archiver("zip", { zlib: { level: 6 } });

    // Add notebook
    const notebookJson = JSON.stringify(notebook, null, 2);
    archive.append(notebookJson, { name: `${safeName}.ipynb` });

    // Add output artifacts from S3
    const outputFiles = await listOutputArtifacts(sessionId);
    for (const file of outputFiles) {
      const buf = await getOutputFile(sessionId, file);
      archive.append(buf, { name: `outputs/${file}` });
    }

    archive.finalize();

    // Convert Node stream → Web ReadableStream
    const nodeStream = Readable.from(archive);
    const webStream = new ReadableStream({
      start(controller) {
        nodeStream.on("data", (chunk) => controller.enqueue(chunk));
        nodeStream.on("end", () => controller.close());
        nodeStream.on("error", (err) => controller.error(err));
      },
    });

    return new NextResponse(webStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}.zip"`,
      },
    });
  }

  return new NextResponse("Invalid format. Use ?format=notebook or ?format=zip", {
    status: 400,
  });
}
