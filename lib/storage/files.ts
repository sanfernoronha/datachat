// lib/storage/files.ts
//
// High-level file storage operations backed by S3 (MinIO).
//
// Key layout in the bucket:
//   sessions/{sessionId}/data/{filename}        ← uploaded datasets
//   sessions/{sessionId}/output/{filename}      ← plots, images, HTML
//   checkpoints/{checkpointId}/output/{filename} ← checkpoint artifacts

import {
  putObject,
  getObject,
  listObjects,
  deleteObject,
  deletePrefix,
  copyPrefix,
} from "./s3";

// ── Key Builders ──────────────────────────────────────────────────────────────

export function dataKey(sessionId: string, filename: string): string {
  return `sessions/${sessionId}/data/${filename}`;
}

export function outputKey(sessionId: string, filename: string): string {
  return `sessions/${sessionId}/output/${filename}`;
}

function outputPrefix(sessionId: string): string {
  return `sessions/${sessionId}/output/`;
}

function dataPrefix(sessionId: string): string {
  return `sessions/${sessionId}/data/`;
}

function sessionPrefix(sessionId: string): string {
  return `sessions/${sessionId}/`;
}

function checkpointOutputPrefix(checkpointId: string): string {
  return `checkpoints/${checkpointId}/output/`;
}

function checkpointPrefix(checkpointId: string): string {
  return `checkpoints/${checkpointId}/`;
}

// ── File Saving ─────────────────────────────────────────────────────────────

/**
 * Saves an uploaded file to S3.
 * Returns the S3 key (used as filePath in the DB).
 */
export async function saveUploadedFile(
  sessionId: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const key = dataKey(sessionId, filename);
  await putObject(key, buffer);
  return key;
}

// ── Output Files ──────────────────────────────────────────────────────────────

/**
 * Saves an output artifact (plot, image, HTML) to S3.
 */
export async function saveOutputFile(
  sessionId: string,
  filename: string,
  content: Buffer | string,
  contentType?: string
): Promise<void> {
  await putObject(outputKey(sessionId, filename), content, contentType);
}

/**
 * Retrieves an output artifact from S3.
 */
export async function getOutputFile(
  sessionId: string,
  filename: string
): Promise<Buffer> {
  return getObject(outputKey(sessionId, filename));
}

/**
 * Retrieves an uploaded dataset from S3.
 */
export async function getDataFile(
  sessionId: string,
  filename: string
): Promise<Buffer> {
  return getObject(dataKey(sessionId, filename));
}

/**
 * Lists the artifact filenames in a session's output prefix.
 */
export async function listOutputArtifacts(
  sessionId: string
): Promise<string[]> {
  return listObjects(outputPrefix(sessionId));
}

/**
 * Lists the uploaded dataset filenames for a session.
 */
export async function listDataFiles(sessionId: string): Promise<string[]> {
  return listObjects(dataPrefix(sessionId));
}

// ── Checkpoint Snapshots ─────────────────────────────────────────────────────

/**
 * Creates a checkpoint snapshot by copying output artifacts in S3.
 * Returns the S3 prefix (stored as snapshotPath in the DB).
 */
export async function createCheckpointSnapshot(
  checkpointId: string,
  sessionId: string
): Promise<string> {
  const srcPrefix = outputPrefix(sessionId);
  const destPrefix = checkpointOutputPrefix(checkpointId);

  await copyPrefix(srcPrefix, destPrefix);

  return destPrefix;
}

/**
 * Restores a checkpoint's output artifacts back into the session's output prefix.
 * Clears current output first, then copies from checkpoint.
 */
export async function restoreOutputArtifacts(
  checkpointId: string,
  sessionId: string
): Promise<void> {
  await deletePrefix(outputPrefix(sessionId));
  await copyPrefix(
    checkpointOutputPrefix(checkpointId),
    outputPrefix(sessionId)
  );
}

// ── Deletion ──────────────────────────────────────────────────────────────────

/** Removes all objects for a session (data + output). */
export async function deleteSessionDirectory(
  sessionId: string
): Promise<void> {
  await deletePrefix(sessionPrefix(sessionId));
}

/** Removes a single uploaded file from S3. */
export async function deleteUploadedFile(
  sessionId: string,
  filename: string
): Promise<void> {
  await deleteObject(dataKey(sessionId, filename));
}

/** Removes all checkpoint objects from S3. */
export async function deleteCheckpointDirectory(
  checkpointId: string
): Promise<void> {
  await deletePrefix(checkpointPrefix(checkpointId));
}
