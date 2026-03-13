import { describe, it, expect } from "vitest";
import { analyzeDataQuality, generateSuggestedPrompts } from "./data-intelligence";
import {
  SIMPLE_SCHEMA,
  MISSING_DATA_SCHEMA,
  CONSTANT_COLUMN_SCHEMA,
  ID_COLUMN_SCHEMA,
  GENOMICS_SCHEMA,
  DATE_SCHEMA,
  MULTI_MISSING_SCHEMA,
} from "@/__fixtures__/schemas";

// ── analyzeDataQuality ──────────────────────────────────────────────────────

describe("analyzeDataQuality", () => {
  it("returns empty array for empty input", () => {
    expect(analyzeDataQuality([])).toEqual([]);
  });

  it("returns empty array for files with invalid schema", () => {
    expect(analyzeDataQuality([{ filename: "f.csv", schema: null }])).toEqual([]);
    expect(analyzeDataQuality([{ filename: "f.csv", schema: { bad: true } }])).toEqual([]);
  });

  it("returns empty array for clean data", () => {
    const result = analyzeDataQuality([{ filename: "data.csv", schema: SIMPLE_SCHEMA }]);
    // SIMPLE_SCHEMA has an ID column (patient_id with uniqueCount==rowCount is in ID_COLUMN_SCHEMA, not here)
    // id has uniqueCount 100 == rowCount 100 and type string → ID column issue
    const nonIdIssues = result.filter((i) => !i.message.includes("ID column"));
    expect(nonIdIssues).toEqual([]);
  });

  it("detects entirely empty columns (100% missing)", () => {
    const result = analyzeDataQuality([{ filename: "f.csv", schema: MISSING_DATA_SCHEMA }]);
    const emptyCol = result.find((i) => i.message.includes("entirely empty"));
    expect(emptyCol).toBeDefined();
    expect(emptyCol!.severity).toBe("warning");
    expect(emptyCol!.column).toBe("col_a");
  });

  it("detects high missing rate (>20%)", () => {
    const result = analyzeDataQuality([{ filename: "f.csv", schema: MISSING_DATA_SCHEMA }]);
    const highMissing = result.find(
      (i) => i.column === "col_b" && i.message.includes("30%")
    );
    expect(highMissing).toBeDefined();
    expect(highMissing!.severity).toBe("warning");
  });

  it("detects moderate missing rate (5-20%) as info", () => {
    const result = analyzeDataQuality([{ filename: "f.csv", schema: MISSING_DATA_SCHEMA }]);
    const moderate = result.find(
      (i) => i.column === "col_c" && i.message.includes("10%")
    );
    expect(moderate).toBeDefined();
    expect(moderate!.severity).toBe("info");
  });

  it("ignores low missing rate (<5%)", () => {
    const result = analyzeDataQuality([{ filename: "f.csv", schema: MISSING_DATA_SCHEMA }]);
    const lowMissing = result.find((i) => i.column === "col_d");
    expect(lowMissing).toBeUndefined();
  });

  it("detects constant columns", () => {
    const result = analyzeDataQuality([{ filename: "f.csv", schema: CONSTANT_COLUMN_SCHEMA }]);
    const constant = result.find((i) => i.message.includes("constant value"));
    expect(constant).toBeDefined();
    expect(constant!.severity).toBe("info");
    expect(constant!.column).toBe("status");
  });

  it("detects possible ID columns", () => {
    const result = analyzeDataQuality([{ filename: "f.csv", schema: ID_COLUMN_SCHEMA }]);
    const idCol = result.find((i) => i.message.includes("ID column"));
    expect(idCol).toBeDefined();
    expect(idCol!.column).toBe("patient_id");
  });

  it("does not flag ID column when rowCount <= 10", () => {
    const smallSchema = {
      columns: {
        code: { type: "string", missingCount: 0, uniqueCount: 5, sampleValues: ["a", "b"] },
      },
      rowCount: 5,
    };
    const result = analyzeDataQuality([{ filename: "f.csv", schema: smallSchema }]);
    expect(result.find((i) => i.message.includes("ID column"))).toBeUndefined();
  });

  it("adds dataset-level summary when 3+ columns have missing data", () => {
    const result = analyzeDataQuality([{ filename: "f.csv", schema: MULTI_MISSING_SCHEMA }]);
    const summary = result.find((i) => i.message.includes("columns have missing data"));
    expect(summary).toBeDefined();
    expect(summary!.severity).toBe("warning");
    // Should be first issue (unshifted)
    expect(result[0]).toBe(summary);
  });

  it("prefixes messages with filename when multiple files", () => {
    const result = analyzeDataQuality([
      { filename: "a.csv", schema: MISSING_DATA_SCHEMA },
      { filename: "b.csv", schema: CONSTANT_COLUMN_SCHEMA },
    ]);
    const aIssue = result.find((i) => i.message.startsWith("a.csv:"));
    const bIssue = result.find((i) => i.message.startsWith("b.csv:"));
    expect(aIssue).toBeDefined();
    expect(bIssue).toBeDefined();
  });

  it("does not prefix when single file", () => {
    const result = analyzeDataQuality([{ filename: "only.csv", schema: CONSTANT_COLUMN_SCHEMA }]);
    const prefixed = result.find((i) => i.message.startsWith("only.csv:"));
    expect(prefixed).toBeUndefined();
  });
});

// ── generateSuggestedPrompts ────────────────────────────────────────────────

describe("generateSuggestedPrompts", () => {
  it("returns empty array for empty input", () => {
    expect(generateSuggestedPrompts([])).toEqual([]);
  });

  it("returns empty for invalid schema", () => {
    expect(generateSuggestedPrompts([{ filename: "f.csv", schema: null }])).toEqual([]);
  });

  it("always includes 'Describe the dataset' as first prompt", () => {
    const result = generateSuggestedPrompts([{ filename: "f.csv", schema: SIMPLE_SCHEMA }]);
    expect(result[0].text).toContain("Describe the dataset");
    expect(result[0].category).toBe("explore");
  });

  it("includes cleaning prompt when missing values exist", () => {
    const result = generateSuggestedPrompts([{ filename: "f.csv", schema: MISSING_DATA_SCHEMA }]);
    const clean = result.find((p) => p.category === "clean");
    expect(clean).toBeDefined();
    expect(clean!.text).toContain("missing data");
  });

  it("suggests distributions when 2+ numeric columns", () => {
    const result = generateSuggestedPrompts([{ filename: "f.csv", schema: GENOMICS_SCHEMA }]);
    const dist = result.find((p) => p.text.includes("distributions"));
    expect(dist).toBeDefined();
    expect(dist!.category).toBe("visualize");
  });

  it("suggests correlation heatmap when 3+ numeric columns", () => {
    const result = generateSuggestedPrompts([{ filename: "f.csv", schema: GENOMICS_SCHEMA }]);
    const corr = result.find((p) => p.text.includes("Correlation heatmap"));
    expect(corr).toBeDefined();
  });

  it("suggests Kaplan-Meier when survival + event columns", () => {
    const result = generateSuggestedPrompts([{ filename: "f.csv", schema: GENOMICS_SCHEMA }]);
    const km = result.find((p) => p.text.includes("Kaplan-Meier"));
    expect(km).toBeDefined();
  });

  it("suggests stratified survival when survival + event + categorical (before cap)", () => {
    // The genomics schema triggers many prompts; stratified survival may be capped at 6.
    // Test the logic directly with a minimal schema that won't hit the cap.
    const survivalSchema = {
      columns: {
        os_months: { type: "number", missingCount: 0, uniqueCount: 50, sampleValues: [12] },
        vital_status: { type: "string", missingCount: 0, uniqueCount: 2, sampleValues: ["alive", "dead"] },
        stage: { type: "string", missingCount: 0, uniqueCount: 4, sampleValues: ["I", "II", "III"] },
      },
      rowCount: 100,
    };
    const result = generateSuggestedPrompts([{ filename: "f.csv", schema: survivalSchema }]);
    const strat = result.find((p) => p.text.includes("stratified"));
    expect(strat).toBeDefined();
  });

  it("suggests clinical relationships when clinical but no survival", () => {
    const clinicalOnly = {
      columns: {
        age: { type: "number", missingCount: 0, uniqueCount: 50, sampleValues: [25] },
        gender: { type: "string", missingCount: 0, uniqueCount: 2, sampleValues: ["M", "F"] },
      },
      rowCount: 100,
    };
    const result = generateSuggestedPrompts([{ filename: "f.csv", schema: clinicalOnly }]);
    const clinical = result.find((p) => p.text.includes("clinical"));
    expect(clinical).toBeDefined();
  });

  it("suggests time trends when date columns exist", () => {
    const result = generateSuggestedPrompts([{ filename: "f.csv", schema: DATE_SCHEMA }]);
    const trends = result.find((p) => p.text.includes("trends over time"));
    expect(trends).toBeDefined();
  });

  it("suggests merge when multiple files", () => {
    const result = generateSuggestedPrompts([
      { filename: "a.csv", schema: SIMPLE_SCHEMA },
      { filename: "b.csv", schema: SIMPLE_SCHEMA },
    ]);
    const merge = result.find((p) => p.text.includes("merged"));
    expect(merge).toBeDefined();
  });

  it("caps output at 6 prompts", () => {
    // GENOMICS_SCHEMA triggers many prompts
    const result = generateSuggestedPrompts([{ filename: "f.csv", schema: GENOMICS_SCHEMA }]);
    expect(result.length).toBeLessThanOrEqual(6);
  });
});
