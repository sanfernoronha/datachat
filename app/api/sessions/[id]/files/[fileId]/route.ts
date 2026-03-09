// app/api/sessions/[id]/files/[fileId]/route.ts
//
// DELETE /api/sessions/:id/files/:fileId → remove a single uploaded file

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { deleteUploadedFile } from "@/lib/storage/files";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const { id: sessionId, fileId } = await params;

  const file = await prisma.uploadedFile.findUnique({ where: { id: fileId } });

  if (!file || file.sessionId !== sessionId) {
    return new Response("File not found", { status: 404 });
  }

  await prisma.uploadedFile.delete({ where: { id: fileId } });
  await deleteUploadedFile(sessionId, file.filename);

  return NextResponse.json({ success: true });
}
