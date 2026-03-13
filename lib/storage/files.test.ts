import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the S3 module
vi.mock("./s3", () => ({
  putObject: vi.fn().mockResolvedValue(undefined),
  getObject: vi.fn().mockResolvedValue(Buffer.from("file-content")),
  listObjects: vi.fn().mockResolvedValue(["file1.csv", "file2.csv"]),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  deletePrefix: vi.fn().mockResolvedValue(undefined),
  copyPrefix: vi.fn().mockResolvedValue(undefined),
}));

import {
  dataKey,
  outputKey,
  saveUploadedFile,
  saveOutputFile,
  getOutputFile,
  getDataFile,
  listOutputArtifacts,
  listDataFiles,
  createCheckpointSnapshot,
  restoreOutputArtifacts,
  deleteSessionDirectory,
  deleteUploadedFile,
  deleteCheckpointDirectory,
} from "./files";
import { putObject, getObject, listObjects, deleteObject, deletePrefix, copyPrefix } from "./s3";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Key Builders ────────────────────────────────────────────────────────────

describe("key builders", () => {
  it("dataKey builds correct path", () => {
    expect(dataKey("sess-1", "data.csv")).toBe("sessions/sess-1/data/data.csv");
  });

  it("outputKey builds correct path", () => {
    expect(outputKey("sess-1", "plot.png")).toBe("sessions/sess-1/output/plot.png");
  });
});

// ── File Saving ─────────────────────────────────────────────────────────────

describe("saveUploadedFile", () => {
  it("calls putObject with correct key and buffer", async () => {
    const buf = Buffer.from("csv data");
    const key = await saveUploadedFile("sess-1", "data.csv", buf);
    expect(putObject).toHaveBeenCalledWith("sessions/sess-1/data/data.csv", buf);
    expect(key).toBe("sessions/sess-1/data/data.csv");
  });
});

describe("saveOutputFile", () => {
  it("calls putObject with correct key", async () => {
    await saveOutputFile("sess-1", "plot.png", Buffer.from("img"), "image/png");
    expect(putObject).toHaveBeenCalledWith(
      "sessions/sess-1/output/plot.png",
      Buffer.from("img"),
      "image/png"
    );
  });
});

// ── File Reading ────────────────────────────────────────────────────────────

describe("getOutputFile", () => {
  it("calls getObject with correct key", async () => {
    const result = await getOutputFile("sess-1", "plot.png");
    expect(getObject).toHaveBeenCalledWith("sessions/sess-1/output/plot.png");
    expect(result).toEqual(Buffer.from("file-content"));
  });
});

describe("getDataFile", () => {
  it("calls getObject with correct key", async () => {
    await getDataFile("sess-1", "data.csv");
    expect(getObject).toHaveBeenCalledWith("sessions/sess-1/data/data.csv");
  });
});

// ── Listing ─────────────────────────────────────────────────────────────────

describe("listOutputArtifacts", () => {
  it("calls listObjects with output prefix", async () => {
    await listOutputArtifacts("sess-1");
    expect(listObjects).toHaveBeenCalledWith("sessions/sess-1/output/");
  });
});

describe("listDataFiles", () => {
  it("calls listObjects with data prefix", async () => {
    const files = await listDataFiles("sess-1");
    expect(listObjects).toHaveBeenCalledWith("sessions/sess-1/data/");
    expect(files).toEqual(["file1.csv", "file2.csv"]);
  });
});

// ── Checkpoint Operations ───────────────────────────────────────────────────

describe("createCheckpointSnapshot", () => {
  it("copies from session output to checkpoint prefix", async () => {
    const prefix = await createCheckpointSnapshot("ckpt-1", "sess-1");
    expect(copyPrefix).toHaveBeenCalledWith(
      "sessions/sess-1/output/",
      "checkpoints/ckpt-1/output/"
    );
    expect(prefix).toBe("checkpoints/ckpt-1/output/");
  });
});

describe("restoreOutputArtifacts", () => {
  it("deletes current output then copies from checkpoint", async () => {
    await restoreOutputArtifacts("ckpt-1", "sess-1");
    expect(deletePrefix).toHaveBeenCalledWith("sessions/sess-1/output/");
    expect(copyPrefix).toHaveBeenCalledWith(
      "checkpoints/ckpt-1/output/",
      "sessions/sess-1/output/"
    );
  });
});

// ── Deletion ────────────────────────────────────────────────────────────────

describe("deleteSessionDirectory", () => {
  it("deletes entire session prefix", async () => {
    await deleteSessionDirectory("sess-1");
    expect(deletePrefix).toHaveBeenCalledWith("sessions/sess-1/");
  });
});

describe("deleteUploadedFile", () => {
  it("deletes specific data file", async () => {
    await deleteUploadedFile("sess-1", "old.csv");
    expect(deleteObject).toHaveBeenCalledWith("sessions/sess-1/data/old.csv");
  });
});

describe("deleteCheckpointDirectory", () => {
  it("deletes entire checkpoint prefix", async () => {
    await deleteCheckpointDirectory("ckpt-1");
    expect(deletePrefix).toHaveBeenCalledWith("checkpoints/ckpt-1/");
  });
});
