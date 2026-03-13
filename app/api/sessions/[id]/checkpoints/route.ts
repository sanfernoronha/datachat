// app/api/sessions/[id]/checkpoints/route.ts
//
// GET  /api/sessions/:id/checkpoints  → list checkpoints for a session
// POST /api/sessions/:id/checkpoints  → create a new checkpoint (snapshot)
//
// A checkpoint captures the full conversation history and output artifacts
// at the moment it is created. Users can restore to a checkpoint to backtrack.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createCheckpointSnapshot } from "@/lib/storage/files";

// ─── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  const checkpoints = await prisma.checkpoint.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" }, // chronological — oldest first for timeline
    select: { id: true, name: true, description: true, createdAt: true },
  });

  return NextResponse.json(checkpoints);
}

// ─── POST ──────────────────────────────────────────────────────────────────────
// Body: { name: string, description?: string }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const { name, description } = await req.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: "Checkpoint name is required" }, { status: 400 });
  }

  if (name.trim().length > 200) {
    return NextResponse.json({ error: "Checkpoint name too long (max 200 characters)" }, { status: 400 });
  }

  if (description && description.length > 1000) {
    return NextResponse.json({ error: "Description too long (max 1,000 characters)" }, { status: 400 });
  }

  // Verify session exists
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Fetch the full conversation history to include in the snapshot
  const messages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });

  // Generate a UUID for the checkpoint before we create the DB record,
  // so we can use it as the snapshot directory name
  const checkpointId = crypto.randomUUID();

  // Create the on-disk snapshot (output artifacts only — messages go in DB)
  const snapshotPath = await createCheckpointSnapshot(checkpointId, sessionId);

  // Create the DB record with full message snapshot
  const checkpoint = await prisma.checkpoint.create({
    data: {
      id: checkpointId,
      sessionId,
      name: name.trim(),
      description: description?.trim() || null,
      messagesSnapshot: JSON.parse(JSON.stringify(messages)),
      snapshotPath,
    },
  });

  return NextResponse.json(checkpoint, { status: 201 });
}
