// app/api/sessions/[id]/checkpoints/[checkpointId]/route.ts
//
// DELETE /api/sessions/:id/checkpoints/:checkpointId → delete a single checkpoint

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { deleteCheckpointDirectory } from "@/lib/storage/files";

export async function DELETE(
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

  // Delete DB record
  await prisma.checkpoint.delete({ where: { id: checkpointId } });

  // Delete S3 artifacts — best-effort, log failures for manual cleanup
  try {
    await deleteCheckpointDirectory(checkpointId);
  } catch (err) {
    console.error(`[DELETE checkpoint] S3 cleanup failed for checkpoint ${checkpointId}. Orphaned files may remain.`, err);
  }

  return NextResponse.json({ success: true });
}
