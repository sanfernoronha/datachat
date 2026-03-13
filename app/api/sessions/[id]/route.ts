// app/api/sessions/[id]/route.ts
//
// REST endpoints for a single session:
//   PATCH  /api/sessions/:id  → update session name
//   DELETE /api/sessions/:id  → delete session + all data (DB + disk)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { deleteSessionDirectory, deleteCheckpointDirectory } from "@/lib/storage/files";

// ─── PATCH /api/sessions/:id ──────────────────────────────────────────────────
// Updates mutable session fields. Currently supports: name.
// Body: { name: string }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const name: string = body.name?.trim();

  if (!name) {
    return new Response("Name cannot be empty", { status: 400 });
  }

  if (name.length > 200) {
    return new Response("Name too long (max 200 characters)", { status: 400 });
  }

  const session = await prisma.session.update({
    where: { id },
    data: { name },
  });

  return NextResponse.json(session);
}

// ─── DELETE /api/sessions/:id ────────────────────────────────────────────────
// Deletes a session and all associated data (messages, files, checkpoints).
// Prisma cascade handles DB cleanup; we handle disk cleanup separately.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Grab checkpoint IDs before cascade delete removes them
  const checkpoints = await prisma.checkpoint.findMany({
    where: { sessionId: id },
    select: { id: true },
  });

  // Cascade delete: Session → Messages, UploadedFiles, Checkpoints
  await prisma.session.delete({ where: { id } });

  // Clean up S3: best-effort — DB is already deleted, log failures for manual cleanup
  try {
    await deleteSessionDirectory(id);
    await Promise.all(checkpoints.map((cp) => deleteCheckpointDirectory(cp.id)));
  } catch (err) {
    console.error(`[DELETE session] S3 cleanup failed for session ${id}. Orphaned files may remain.`, err);
  }

  return NextResponse.json({ success: true });
}
