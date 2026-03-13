import { describe, it, expect } from "vitest";
import { parseFile, inferSchema, isAllowedByExtension } from "./parse";

// ── isAllowedByExtension ────────────────────────────────────────────────────

describe("isAllowedByExtension", () => {
  it.each(["csv", "tsv", "xlsx", "xls"])("allows .%s", (ext) => {
    expect(isAllowedByExtension(`data.${ext}`)).toBe(true);
  });

  it.each(["txt", "json", "pdf", "py", "zip"])("rejects .%s", (ext) => {
    expect(isAllowedByExtension(`file.${ext}`)).toBe(false);
  });

  it("returns false for filename without extension", () => {
    expect(isAllowedByExtension("noextension")).toBe(false);
  });
});

// ── parseFile ───────────────────────────────────────────────────────────────

describe("parseFile", () => {
  it("parses CSV with headers", () => {
    const csv = "name,age,score\nAlice,30,95\nBob,25,87\n";
    const rows = parseFile("data.csv", Buffer.from(csv));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: "Alice", age: "30", score: "95" });
    expect(rows[1]).toEqual({ name: "Bob", age: "25", score: "87" });
  });

  it("parses TSV with tab delimiter", () => {
    const tsv = "col1\tcol2\nval1\tval2\n";
    const rows = parseFile("data.tsv", Buffer.from(tsv));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ col1: "val1", col2: "val2" });
  });

  it("returns empty array for unknown extension", () => {
    expect(parseFile("data.json", Buffer.from("{}"))).toEqual([]);
  });

  it("returns empty array for empty CSV", () => {
    expect(parseFile("empty.csv", Buffer.from(""))).toEqual([]);
  });

  it("skips empty lines in CSV", () => {
    const csv = "a,b\n1,2\n\n3,4\n";
    const rows = parseFile("data.csv", Buffer.from(csv));
    expect(rows).toHaveLength(2);
  });
});

// ── inferSchema ─────────────────────────────────────────────────────────────

describe("inferSchema", () => {
  it("returns empty schema for no rows", () => {
    expect(inferSchema([])).toEqual({ columns: {}, rowCount: 0 });
  });

  it("detects numeric columns", () => {
    const rows = [{ val: "42" }, { val: "3.14" }, { val: "0" }];
    const schema = inferSchema(rows);
    expect(schema.columns.val.type).toBe("number");
    expect(schema.rowCount).toBe(3);
  });

  it("detects boolean columns", () => {
    const rows = [{ active: "true" }, { active: "false" }, { active: "true" }];
    const schema = inferSchema(rows);
    expect(schema.columns.active.type).toBe("boolean");
  });

  it("detects string columns", () => {
    const rows = [{ name: "Alice" }, { name: "Bob" }];
    const schema = inferSchema(rows);
    expect(schema.columns.name.type).toBe("string");
  });

  it("counts missing values (null, undefined, empty string)", () => {
    const rows = [
      { x: "hello" },
      { x: null },
      { x: undefined },
      { x: "" },
      { x: "world" },
    ];
    const schema = inferSchema(rows);
    expect(schema.columns.x.missingCount).toBe(3);
  });

  it("counts unique values", () => {
    const rows = [{ v: "a" }, { v: "b" }, { v: "a" }, { v: "c" }];
    const schema = inferSchema(rows);
    expect(schema.columns.v.uniqueCount).toBe(3);
  });

  it("limits sample values to 3", () => {
    const rows = [{ x: "a" }, { x: "b" }, { x: "c" }, { x: "d" }, { x: "e" }];
    const schema = inferSchema(rows);
    expect(schema.columns.x.sampleValues).toEqual(["a", "b", "c"]);
  });

  it("handles multiple columns", () => {
    const rows = [
      { name: "Alice", age: "30", active: "true" },
      { name: "Bob", age: "25", active: "false" },
    ];
    const schema = inferSchema(rows);
    expect(Object.keys(schema.columns)).toEqual(["name", "age", "active"]);
    expect(schema.columns.name.type).toBe("string");
    expect(schema.columns.age.type).toBe("number");
    expect(schema.columns.active.type).toBe("boolean");
  });
});
