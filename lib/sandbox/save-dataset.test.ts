import { describe, it, expect } from "vitest";
import { parseFile, inferSchema } from "@/lib/upload/parse";

// ── save_dataset filename validation ────────────────────────────────────────
// These tests verify the validation logic used in the save_dataset tool handler.
// The actual handler lives in app/api/sessions/[id]/chat/route.ts but the
// validation rules are simple enough to test as pure predicates.

function validateSaveDatasetFilename(filename: string): string | null {
  if (filename.includes("..") || filename.includes("/")) {
    return "Invalid filename — must not contain '..' or '/'";
  }
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext || !["csv", "tsv"].includes(ext)) {
    return "Only CSV and TSV files are supported";
  }
  return null; // valid
}

describe("save_dataset filename validation", () => {
  it.each([
    "cleaned_data.csv",
    "output.tsv",
    "my-file.csv",
    "data_v2.csv",
    "UPPERCASE.CSV",
  ])("accepts valid filename: %s", (name) => {
    expect(validateSaveDatasetFilename(name)).toBeNull();
  });

  it("rejects path traversal with ..", () => {
    expect(validateSaveDatasetFilename("../etc/passwd")).not.toBeNull();
  });

  it("rejects paths with /", () => {
    expect(validateSaveDatasetFilename("subdir/file.csv")).not.toBeNull();
  });

  it("rejects non-CSV/TSV extensions", () => {
    expect(validateSaveDatasetFilename("data.xlsx")).not.toBeNull();
    expect(validateSaveDatasetFilename("script.py")).not.toBeNull();
    expect(validateSaveDatasetFilename("data.json")).not.toBeNull();
  });

  it("rejects files without extension", () => {
    expect(validateSaveDatasetFilename("noextension")).not.toBeNull();
  });
});

// ── save_dataset parse + schema round-trip ──────────────────────────────────
// Validates that a CSV written by pandas can be parsed and schema-inferred.

describe("save_dataset parse + schema inference", () => {
  it("parses a pandas-style CSV and infers correct schema", () => {
    const csv = [
      "gene,expression,is_significant",
      "TP53,8.5,true",
      "BRCA1,12.3,false",
      "EGFR,6.7,true",
    ].join("\n");

    const rows = parseFile("cleaned.csv", Buffer.from(csv));
    expect(rows).toHaveLength(3);

    const schema = inferSchema(rows);
    expect(schema.rowCount).toBe(3);
    expect(schema.columns.gene.type).toBe("string");
    expect(schema.columns.expression.type).toBe("number");
    expect(schema.columns.is_significant.type).toBe("boolean");
  });

  it("returns empty for empty CSV", () => {
    const csv = "col1,col2\n";
    const rows = parseFile("empty.csv", Buffer.from(csv));
    expect(rows).toHaveLength(0);
  });

  it("handles CSV with missing values correctly", () => {
    const csv = [
      "id,value",
      "1,10",
      "2,",
      "3,30",
    ].join("\n");

    const rows = parseFile("missing.csv", Buffer.from(csv));
    const schema = inferSchema(rows);
    expect(schema.columns.value.missingCount).toBe(1);
    expect(schema.columns.value.type).toBe("number");
  });

  it("handles TSV files", () => {
    const tsv = "name\tscore\nAlice\t95\nBob\t87\n";
    const rows = parseFile("data.tsv", Buffer.from(tsv));
    expect(rows).toHaveLength(2);

    const schema = inferSchema(rows);
    expect(schema.columns.score.type).toBe("number");
  });

  it("infers string type when majority of values are non-numeric", () => {
    // First value is numeric but rest are strings
    const csv = [
      "label",
      "123",
      "abc",
      "def",
      "ghi",
    ].join("\n");

    const rows = parseFile("mixed.csv", Buffer.from(csv));
    const schema = inferSchema(rows);
    // Only 1/4 values are numeric — majority is string
    expect(schema.columns.label.type).toBe("string");
  });
});
