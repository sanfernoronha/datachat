import { describe, it, expect, vi } from "vitest";

// Mock dependencies that need network/filesystem access
vi.mock("@agent-infra/sandbox", () => ({
  SandboxClient: vi.fn(),
}));
vi.mock("@/lib/storage/files", () => ({
  saveOutputFile: vi.fn(),
  listDataFiles: vi.fn().mockResolvedValue([]),
  getDataFile: vi.fn(),
}));

import {
  plotlyJsonToHtml,
  extractRichOutputs,
  transformJupyterResponse,
  toLLMSummary,
  stripBase64ForStorage,
  installPackage,
  type SandboxExecutionResult,
  type RichOutput,
} from "./client";

// ── plotlyJsonToHtml ────────────────────────────────────────────────────────

describe("plotlyJsonToHtml", () => {
  it("produces HTML with Plotly CDN and the spec", () => {
    const spec = { data: [{ x: [1, 2], y: [3, 4] }], layout: { title: "Test" } };
    const html = plotlyJsonToHtml(spec);
    expect(html).toContain("plotly-2.35.2.min.js");
    expect(html).toContain("Plotly.newPlot");
    expect(html).toContain('"title":"Test"');
    expect(html).toContain("<!DOCTYPE html>");
  });
});

// ── extractRichOutputs ──────────────────────────────────────────────────────

describe("extractRichOutputs", () => {
  it("returns empty array for undefined data", () => {
    expect(extractRichOutputs(undefined)).toEqual([]);
  });

  it("converts Plotly JSON to HTML output", () => {
    const data = { "application/vnd.plotly.v1+json": { data: [], layout: {} } };
    const results = extractRichOutputs(data);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("html");
    expect(results[0].content).toContain("Plotly.newPlot");
  });

  it("extracts image/png", () => {
    const data = { "image/png": "base64data" };
    const results = extractRichOutputs(data);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ type: "image", content: "base64data", mimeType: "image/png" });
  });

  it("extracts image/jpeg", () => {
    const results = extractRichOutputs({ "image/jpeg": "jpegdata" });
    expect(results[0].mimeType).toBe("image/jpeg");
  });

  it("extracts image/gif and image/webp", () => {
    const data = { "image/gif": "gifdata", "image/webp": "webpdata" };
    const results = extractRichOutputs(data);
    expect(results).toHaveLength(2);
  });

  it("extracts text/html", () => {
    const results = extractRichOutputs({ "text/html": "<table>...</table>" });
    expect(results[0]).toEqual({ type: "html", content: "<table>...</table>", mimeType: "text/html" });
  });

  it("extracts image/svg+xml", () => {
    const results = extractRichOutputs({ "image/svg+xml": "<svg></svg>" });
    expect(results[0].type).toBe("svg");
  });

  it("extracts text/latex and text/markdown", () => {
    const data = { "text/latex": "\\frac{1}{2}", "text/markdown": "**bold**" };
    const results = extractRichOutputs(data);
    expect(results.find((r) => r.type === "latex")).toBeDefined();
    expect(results.find((r) => r.type === "markdown")).toBeDefined();
  });

  it("extracts application/json as stringified JSON", () => {
    const results = extractRichOutputs({ "application/json": { key: "value" } });
    expect(results[0].type).toBe("json");
    expect(results[0].content).toBe('{"key":"value"}');
  });

  it("falls back to text/plain only when no richer output exists", () => {
    const results = extractRichOutputs({ "text/plain": "hello" });
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("text");
  });

  it("ignores text/plain when richer output exists", () => {
    const data = { "image/png": "imgdata", "text/plain": "fallback" };
    const results = extractRichOutputs(data);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("image");
  });

  it("handles Vega-Lite spec", () => {
    const data = { "application/vnd.vegalite.v5+json": { mark: "bar" } };
    const results = extractRichOutputs(data);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("html");
    expect(results[0].content).toContain("vegaEmbed");
  });
});

// ── transformJupyterResponse ────────────────────────────────────────────────

describe("transformJupyterResponse", () => {
  it("returns error for undefined input", () => {
    const result = transformJupyterResponse(undefined);
    expect(result.status).toBe("error");
    expect(result.stderr).toBe("No response from sandbox");
  });

  it("accumulates stdout from stream outputs", () => {
    const result = transformJupyterResponse({
      status: "ok",
      outputs: [
        { output_type: "stream", name: "stdout", text: "line 1\n" },
        { output_type: "stream", name: "stdout", text: "line 2\n" },
      ],
    });
    expect(result.stdout).toBe("line 1\nline 2\n");
    expect(result.status).toBe("ok");
  });

  it("accumulates stderr separately", () => {
    const result = transformJupyterResponse({
      status: "ok",
      outputs: [
        { output_type: "stream", name: "stderr", text: "warn: something\n" },
      ],
    });
    expect(result.stderr).toBe("warn: something\n");
  });

  it("extracts display_data through extractRichOutputs", () => {
    const result = transformJupyterResponse({
      status: "ok",
      outputs: [
        { output_type: "display_data", data: { "image/png": "base64" } },
      ],
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].type).toBe("image");
  });

  it("captures error outputs", () => {
    const result = transformJupyterResponse({
      status: "error",
      outputs: [
        {
          output_type: "error",
          ename: "ValueError",
          evalue: "bad input",
          traceback: ["line 1", "line 2"],
        },
      ],
    });
    expect(result.status).toBe("error");
    expect(result.error).toEqual({
      ename: "ValueError",
      evalue: "bad input",
      traceback: ["line 1", "line 2"],
    });
  });

  it("maps timeout status correctly", () => {
    const result = transformJupyterResponse({
      status: "timeout",
      outputs: [],
    });
    expect(result.status).toBe("timeout");
  });
});

// ── toLLMSummary ────────────────────────────────────────────────────────────

describe("toLLMSummary", () => {
  const baseResult: SandboxExecutionResult = {
    status: "ok",
    stdout: "",
    stderr: "",
    results: [],
  };

  it("truncates stdout at 10000 chars", () => {
    const long = "x".repeat(20000);
    const summary = toLLMSummary({ ...baseResult, stdout: long });
    expect((summary.stdout as string).length).toBe(10000);
  });

  it("truncates stderr at 5000 chars", () => {
    const long = "e".repeat(10000);
    const summary = toLLMSummary({ ...baseResult, stderr: long });
    expect((summary.stderr as string).length).toBe(5000);
  });

  it("sets has_plots when image results exist", () => {
    const result: SandboxExecutionResult = {
      ...baseResult,
      results: [{ type: "image", content: "b64", mimeType: "image/png" }],
    };
    expect(toLLMSummary(result).has_plots).toBe(true);
  });

  it("sets has_plots for svg results", () => {
    const result: SandboxExecutionResult = {
      ...baseResult,
      results: [{ type: "svg", content: "<svg>", mimeType: "image/svg+xml" }],
    };
    expect(toLLMSummary(result).has_plots).toBe(true);
  });

  it("sets has_tables for html results", () => {
    const result: SandboxExecutionResult = {
      ...baseResult,
      results: [{ type: "html", content: "<table>", mimeType: "text/html" }],
    };
    expect(toLLMSummary(result).has_tables).toBe(true);
  });

  it("formats error as ename: evalue", () => {
    const result: SandboxExecutionResult = {
      ...baseResult,
      error: { ename: "TypeError", evalue: "bad", traceback: [] },
    };
    expect(toLLMSummary(result).error).toBe("TypeError: bad");
  });

  it("returns undefined error when no error", () => {
    expect(toLLMSummary(baseResult).error).toBeUndefined();
  });
});

// ── stripBase64ForStorage ───────────────────────────────────────────────────

describe("stripBase64ForStorage", () => {
  it("replaces image content with size description", () => {
    const result: SandboxExecutionResult = {
      status: "ok",
      stdout: "",
      stderr: "",
      results: [
        { type: "image", content: "a".repeat(4000), mimeType: "image/png" },
      ],
    };
    const stripped = stripBase64ForStorage(result);
    expect(stripped.results[0].content).toContain("image/png image");
    expect(stripped.results[0].content).toContain("KB");
    expect(stripped.results[0].content.length).toBeLessThan(100);
  });

  it("preserves non-image results unchanged", () => {
    const htmlResult: RichOutput = {
      type: "html",
      content: "<table>big table</table>",
      mimeType: "text/html",
    };
    const result: SandboxExecutionResult = {
      status: "ok",
      stdout: "",
      stderr: "",
      results: [htmlResult],
    };
    const stripped = stripBase64ForStorage(result);
    expect(stripped.results[0]).toEqual(htmlResult);
  });

  it("does not mutate the original result", () => {
    const original: SandboxExecutionResult = {
      status: "ok",
      stdout: "",
      stderr: "",
      results: [{ type: "image", content: "base64data", mimeType: "image/png" }],
    };
    stripBase64ForStorage(original);
    expect(original.results[0].content).toBe("base64data");
  });
});

// ── installPackage — package name validation ────────────────────────────────
// The allowlist regex used in installPackage. Duplicated here for unit testing
// since valid names would otherwise hit executeCode (which needs a real sandbox).
const PKG_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?(\[[\w,]+\])?(([><=!~]=?[0-9a-zA-Z.*]+,?)*)?$/;

describe("installPackage — package name validation", () => {
  it.each([
    "numpy",
    "scikit-learn",
    "pandas",
    "my_package",
    "package123",
    "a",
    "scipy",
  ])("accepts valid package name: %s", (name) => {
    expect(PKG_PATTERN.test(name.trim())).toBe(true);
  });

  it.each([
    "numpy>=1.21",
    "package>=1.0,<2.0",
    "torch==2.0",
    "lib~=3.0",
  ])("accepts valid package with version specifier: %s", (name) => {
    expect(PKG_PATTERN.test(name.trim())).toBe(true);
  });

  it.each([
    "package[extra]",
    "package[extra1,extra2]",
  ])("accepts valid package with extras: %s", (name) => {
    expect(PKG_PATTERN.test(name.trim())).toBe(true);
  });

  it.each([
    "; rm -rf /",
    "numpy && echo pwned",
    "pkg | cat /etc/passwd",
    "$(whoami)",
    "`id`",
  ])("rejects dangerous package name: %s", (name) => {
    expect(PKG_PATTERN.test(name.trim())).toBe(false);
  });

  // Empty/whitespace caught by trim() + regex (empty string doesn't match)
  it.each(["", "   "])("rejects empty/whitespace: '%s'", async (name) => {
    const result = await installPackage("test-session", name);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid package name");
  });
});
