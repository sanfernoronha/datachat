// app/api/sessions/[id]/checkpoints/[checkpointId]/restore/route.ts
//
// POST /api/sessions/:id/checkpoints/:checkpointId/restore
//
// Restores a session to a checkpoint's state:
//   1. Replaces all messages with the checkpoint's snapshot
//   2. Restores output artifacts on disk
//   3. Deletes checkpoints created after this one

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { restoreOutputArtifacts, deleteCheckpointDirectory } from "@/lib/storage/files";

interface SnapshotMessage {
  role: string;
  content: string;
  metadata?: unknown;
  createdAt: string;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; checkpointId: string }> }
) {
  const { id: sessionId, checkpointId } = await params;

  // Verify checkpoint exists and belongs to this session
  const checkpoint = await prisma.checkpoint.findUnique({
    where: { id: checkpointId },
  });

  if (!checkpoint || checkpoint.sessionId !== sessionId) {
    return NextResponse.json({ error: "Checkpoint not found" }, { status: 404 });
  }

  const snapshotMessages = checkpoint.messagesSnapshot as unknown as SnapshotMessage[];

  // Find checkpoints created after this one (to be deleted)
  const futureCheckpoints = await prisma.checkpoint.findMany({
    where: {
      sessionId,
      createdAt: { gt: checkpoint.createdAt },
    },
    select: { id: true },
  });

  // Use a transaction to atomically replace messages and clean up future checkpoints
  await prisma.$transaction(async (tx) => {
    // Delete all current messages
    await tx.message.deleteMany({ where: { sessionId } });

    // Re-insert messages from the snapshot
    if (snapshotMessages.length > 0) {
      await tx.message.createMany({
        data: snapshotMessages.map((m) => ({
          sessionId,
          role: m.role,
          content: m.content,
          metadata: m.metadata ?? undefined,
          createdAt: new Date(m.createdAt),
        })),
      });
    }

    // Delete future checkpoints from DB
    if (futureCheckpoints.length > 0) {
      await tx.checkpoint.deleteMany({
        where: { id: { in: futureCheckpoints.map((c) => c.id) } },
      });
    }
  });

  // Restore output artifacts and clean up future checkpoint directories — best-effort
  try {
    await restoreOutputArtifacts(checkpointId, sessionId);
    await Promise.all(
      futureCheckpoints.map((c) => deleteCheckpointDirectory(c.id))
    );
  } catch (err) {
    console.error(`[RESTORE checkpoint] S3 cleanup/restore failed for checkpoint ${checkpointId}. Artifacts may be inconsistent.`, err);
  }

  return NextResponse.json({
    success: true,
    messageCount: snapshotMessages.length,
  });
}
