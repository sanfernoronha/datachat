// app/api/sessions/route.ts
//
// REST endpoints for session management:
//   GET  /api/sessions  → list all sessions, newest first
//   POST /api/sessions  → create a new session

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

// ─── GET /api/sessions ───────────────────────────────────────────────────────
// Returns all sessions ordered by most recently active.
// Used to populate the session list on the dashboard.
export async function GET() {
  const sessions = await prisma.session.findMany({
    orderBy: { lastActive: "desc" },
    include: {
      // Include counts so the UI can show "3 files, 12 messages"
      _count: { select: { messages: true, uploadedFiles: true } },
    },
  });

  return NextResponse.json(sessions);
}

// ─── POST /api/sessions ──────────────────────────────────────────────────────
// Creates a new session with the given name.
// Body: { name: string }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const name: string = body.name?.trim() || "Untitled Session";

  const session = await prisma.session.create({
    data: { name },
  });

  return NextResponse.json(session, { status: 201 });
}
