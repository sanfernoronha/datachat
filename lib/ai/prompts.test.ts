import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./prompts";
import { makeUploadedFile, SIMPLE_SCHEMA, GENOMICS_SCHEMA } from "@/__fixtures__/schemas";

describe("buildSystemPrompt", () => {
  it("includes 'No datasets uploaded' when no files", () => {
    const result = buildSystemPrompt([]);
    expect(result).toContain("No datasets uploaded yet.");
  });

  it("includes filename and column listing for a single file", () => {
    const file = makeUploadedFile({ schema: SIMPLE_SCHEMA });
    const result = buildSystemPrompt([file]);
    expect(result).toContain("File: data.csv");
    expect(result).toContain("id (string)");
    expect(result).toContain("name (string)");
    expect(result).toContain("value (number)");
    expect(result).toContain("Rows: 100");
  });

  it("includes multiple file sections", () => {
    const files = [
      makeUploadedFile({ filename: "clinical.csv", schema: SIMPLE_SCHEMA }),
      makeUploadedFile({ filename: "genomic.csv", schema: GENOMICS_SCHEMA }),
    ];
    const result = buildSystemPrompt(files);
    expect(result).toContain("File: clinical.csv");
    expect(result).toContain("File: genomic.csv");
    expect(result).toContain("os_months (number)");
  });

  it("includes key instruction sections", () => {
    const result = buildSystemPrompt([]);
    expect(result).toContain("DATA_DIR");
    expect(result).toContain("execute_python");
    expect(result).toContain("data science");
    expect(result).toContain("install_package");
  });

  it("includes the DATA_DIR path reference", () => {
    const file = makeUploadedFile();
    const result = buildSystemPrompt([file]);
    expect(result).toContain("DATA_DIR/data.csv");
  });
});
