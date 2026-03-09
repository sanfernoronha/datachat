// lib/storage/files.ts
//
// Utilities for saving uploaded files and managing session/checkpoint directories.
//
// Directory layout on disk:
//   uploads/
//     <sessionId>/
//       data/          ← uploaded datasets (read-only mount in sandbox)
//         clinical.csv
//         gene_expression.csv
//       output/        ← artifacts produced by code execution (plots, tables)
//         plot.html
//   checkpoints/
//     <checkpointId>/
//       conversation.json   ← snapshot of all messages at save time
//       output/             ← copy of output artifacts at save time

import { mkdir, writeFile, readdir, cp, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

// Root directories — relative to project root (process.cwd())
const UPLOADS_ROOT = join(process.cwd(), "uploads");
const CHECKPOINTS_ROOT = join(process.cwd(), "checkpoints");

// ─── Session Directories ─────────────────────────────────────────────────────

/**
 * Returns the absolute path to a session's data directory (where uploads live).
 * Creates the directory if it doesn't exist yet.
 */
export async function getSessionDataDir(sessionId: string): Promise<string> {
  const dir = join(UPLOADS_ROOT, sessionId, "data");
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Returns the absolute path to a session's output directory (where plots/tables live).
 * Creates the directory if it doesn't exist yet.
 */
export async function getSessionOutputDir(sessionId: string): Promise<string> {
  const dir = join(UPLOADS_ROOT, sessionId, "output");
  await mkdir(dir, { recursive: true });
  return dir;
}

// ─── File Saving ─────────────────────────────────────────────────────────────

/**
 * Saves a raw buffer to disk inside the session's data directory.
 * Returns the absolute path to the saved file.
 */
export async function saveUploadedFile(
  sessionId: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const dataDir = await getSessionDataDir(sessionId);
  const filePath = join(dataDir, filename);
  await writeFile(filePath, buffer);
  return filePath;
}

// ─── Checkpoint Snapshots ─────────────────────────────────────────────────────

/**
 * Creates a checkpoint snapshot directory and returns its absolute path.
 * Copies the session's output artifacts into the snapshot.
 *
 * @param checkpointId  UUID generated for the checkpoint record
 * @param sessionId     Parent session
 * @param messages      Full conversation history at snapshot time (serialised to JSON)
 */
export async function createCheckpointSnapshot(
  checkpointId: string,
  sessionId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[]
): Promise<string> {
  const snapshotDir = join(CHECKPOINTS_ROOT, checkpointId);
  const snapshotOutputDir = join(snapshotDir, "output");

  // Create snapshot directories
  await mkdir(snapshotOutputDir, { recursive: true });

  // Persist conversation as JSON
  await writeFile(
    join(snapshotDir, "conversation.json"),
    JSON.stringify(messages, null, 2)
  );

  // Copy current output artifacts into the snapshot
  const sessionOutputDir = join(UPLOADS_ROOT, sessionId, "output");
  if (existsSync(sessionOutputDir)) {
    await cp(sessionOutputDir, snapshotOutputDir, { recursive: true });
  }

  return snapshotDir;
}

/**
 * Lists the artifact filenames in a session's output directory.
 * Returns an empty array if no outputs exist yet.
 */
export async function listOutputArtifacts(sessionId: string): Promise<string[]> {
  const outputDir = join(UPLOADS_ROOT, sessionId, "output");
  if (!existsSync(outputDir)) return [];
  return readdir(outputDir);
}

// ─── Deletion ────────────────────────────────────────────────────────────────

/** Removes an entire session directory (data + output) from disk. */
export async function deleteSessionDirectory(sessionId: string): Promise<void> {
  await rm(join(UPLOADS_ROOT, sessionId), { recursive: true, force: true });
}

/** Removes a single uploaded file from a session's data directory. */
export async function deleteUploadedFile(sessionId: string, filename: string): Promise<void> {
  await rm(join(UPLOADS_ROOT, sessionId, "data", filename), { force: true });
}

/** Removes a checkpoint snapshot directory from disk. */
export async function deleteCheckpointDirectory(checkpointId: string): Promise<void> {
  await rm(join(CHECKPOINTS_ROOT, checkpointId), { recursive: true, force: true });
}
