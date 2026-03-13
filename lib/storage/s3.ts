// lib/storage/s3.ts
//
// S3-compatible object storage client (works with MinIO and AWS S3).
// All file persistence flows through this module.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";

// ── Singleton Client ──────────────────────────────────────────────────────────

const globalForS3 = globalThis as unknown as { s3Client: S3Client };

function getClient(): S3Client {
  if (globalForS3.s3Client) return globalForS3.s3Client;

  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
    region: "us-east-1", // MinIO requires a region but ignores it
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || "minioadmin",
      secretAccessKey: process.env.S3_SECRET_KEY || "minioadmin",
    },
    forcePathStyle: true, // Required for MinIO
  });

  if (process.env.NODE_ENV !== "production") {
    globalForS3.s3Client = client;
  }
  return client;
}

function getBucket(): string {
  return process.env.S3_BUCKET || "datachat";
}

// ── Bucket Setup ──────────────────────────────────────────────────────────────

let bucketEnsured = false;

export async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;

  const client = getClient();
  const bucket = getBucket();

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    // Bucket doesn't exist — create it
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      console.log(`[s3] Created bucket: ${bucket}`);
    } catch (createErr) {
      // Race condition — another process may have created it
      console.warn("[s3] Bucket creation warning:", createErr);
    }
  }

  bucketEnsured = true;
}

// ── Object Operations ─────────────────────────────────────────────────────────

export async function putObject(
  key: string,
  body: Buffer | string,
  contentType?: string
): Promise<void> {
  await ensureBucket();

  const bodyBuf = typeof body === "string" ? Buffer.from(body, "utf-8") : body;

  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: bodyBuf,
      ContentType: contentType,
    })
  );
}

export async function getObject(key: string): Promise<Buffer> {
  await ensureBucket();

  const response = await getClient().send(
    new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
    })
  );

  const stream = response.Body;
  if (!stream) throw new Error(`Empty response for key: ${key}`);

  // Convert readable stream to Buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await getObject(key);
    return true;
  } catch {
    return false;
  }
}

export async function listObjects(prefix: string): Promise<string[]> {
  await ensureBucket();

  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await getClient().send(
      new ListObjectsV2Command({
        Bucket: getBucket(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of response.Contents ?? []) {
      if (obj.Key) {
        // Return just the filename (strip the prefix)
        const filename = obj.Key.slice(prefix.length);
        if (filename) keys.push(filename);
      }
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return keys;
}

export async function deleteObject(key: string): Promise<void> {
  await ensureBucket();

  await getClient().send(
    new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: key,
    })
  );
}

export async function deletePrefix(prefix: string): Promise<void> {
  await ensureBucket();

  const bucket = getBucket();
  let continuationToken: string | undefined;

  do {
    const listResponse = await getClient().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    const objects = listResponse.Contents ?? [];
    if (objects.length === 0) break;

    await getClient().send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: objects.map((o) => ({ Key: o.Key! })),
          Quiet: true,
        },
      })
    );

    continuationToken = listResponse.IsTruncated
      ? listResponse.NextContinuationToken
      : undefined;
  } while (continuationToken);
}

export async function copyPrefix(
  srcPrefix: string,
  destPrefix: string
): Promise<void> {
  await ensureBucket();

  const bucket = getBucket();
  const filenames = await listObjects(srcPrefix);

  for (const filename of filenames) {
    await getClient().send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${srcPrefix}${filename}`,
        Key: `${destPrefix}${filename}`,
      })
    );
  }
}
