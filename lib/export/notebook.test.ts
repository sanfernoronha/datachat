import { describe, it, expect, vi } from "vitest";

// Mock S3 storage for getOutputFile
vi.mock("@/lib/storage/files", () => ({
  getOutputFile: vi.fn().mockResolvedValue(Buffer.from("fake-image-data")),
}));

import { textToLines, mimeForExtension, buildNotebook, type DbMessage } from "./notebook";
import {
  EMPTY_MESSAGES,
  USER_ONLY_MESSAGES,
  CODE_EXECUTION_MESSAGES,
  INSTALL_MESSAGES,
  PLOT_MESSAGES,
  ERROR_MESSAGES,
} from "@/__fixtures__/messages";

// ── textToLines ─────────────────────────────────────────────────────────────

describe("textToLines", () => {
  it("handles single line (no trailing newline)", () => {
    expect(textToLines("hello")).toEqual(["hello"]);
  });

  it("splits multi-line with newlines on all but last", () => {
    expect(textToLines("a\nb\nc")).toEqual(["a\n", "b\n", "c"]);
  });

  it("handles empty string", () => {
    expect(textToLines("")).toEqual([""]);
  });

  it("handles text ending with newline", () => {
    expect(textToLines("line1\n")).toEqual(["line1\n", ""]);
  });
});

// ── mimeForExtension ────────────────────────────────────────────────────────

describe("mimeForExtension", () => {
  it("returns image/png for .png", () => {
    expect(mimeForExtension("plot.png")).toBe("image/png");
  });

  it("returns image/jpeg for .jpg and .jpeg", () => {
    expect(mimeForExtension("photo.jpg")).toBe("image/jpeg");
    expect(mimeForExtension("photo.jpeg")).toBe("image/jpeg");
  });

  it("returns image/gif for .gif", () => {
    expect(mimeForExtension("anim.gif")).toBe("image/gif");
  });

  it("returns image/svg+xml for .svg", () => {
    expect(mimeForExtension("chart.svg")).toBe("image/svg+xml");
  });

  it("returns image/webp for .webp", () => {
    expect(mimeForExtension("photo.webp")).toBe("image/webp");
  });

  it("defaults to image/png for unknown extension", () => {
    expect(mimeForExtension("file.bmp")).toBe("image/png");
    expect(mimeForExtension("file.tiff")).toBe("image/png");
  });
});

// ── buildNotebook ───────────────────────────────────────────────────────────

describe("buildNotebook", () => {
  it("produces a valid nbformat v4 structure", async () => {
    const nb = (await buildNotebook(EMPTY_MESSAGES, "sess-1")) as Record<string, unknown>;
    expect(nb.nbformat).toBe(4);
    expect(nb.nbformat_minor).toBe(5);
    expect(nb.metadata).toHaveProperty("kernelspec");
    expect(nb.metadata).toHaveProperty("language_info");
  });

  it("creates 'empty session' cell for no messages", async () => {
    const nb = (await buildNotebook(EMPTY_MESSAGES, "sess-1")) as { cells: Array<{ cell_type: string; source: string[] }> };
    expect(nb.cells).toHaveLength(1);
    expect(nb.cells[0].cell_type).toBe("markdown");
    expect(nb.cells[0].source.join("")).toContain("Empty session");
  });

  it("converts user messages to markdown cells", async () => {
    const nb = (await buildNotebook(USER_ONLY_MESSAGES, "sess-1")) as { cells: Array<{ cell_type: string; source: string[] }> };
    expect(nb.cells).toHaveLength(2);
    expect(nb.cells[0].cell_type).toBe("markdown");
    expect(nb.cells[0].source.join("")).toContain("**User:** Describe the dataset");
  });

  it("converts execute_python tool calls to code cells", async () => {
    const nb = (await buildNotebook(CODE_EXECUTION_MESSAGES, "sess-1")) as {
      cells: Array<{ cell_type: string; source: string[]; outputs?: Array<{ output_type: string }> }>;
    };
    const codeCells = nb.cells.filter((c) => c.cell_type === "code");
    expect(codeCells.length).toBeGreaterThanOrEqual(1);
    expect(codeCells[0].source.join("")).toContain("pd.read_csv");
    // Should have stdout output
    expect(codeCells[0].outputs?.some((o) => o.output_type === "stream")).toBe(true);
  });

  it("converts install_package to pip install code cell", async () => {
    const nb = (await buildNotebook(INSTALL_MESSAGES, "sess-1")) as {
      cells: Array<{ cell_type: string; source: string[] }>;
    };
    const pipCell = nb.cells.find(
      (c) => c.cell_type === "code" && c.source.join("").includes("!pip install seaborn")
    );
    expect(pipCell).toBeDefined();
  });

  it("embeds plots as base64 display_data", async () => {
    const nb = (await buildNotebook(PLOT_MESSAGES, "sess-1")) as {
      cells: Array<{
        cell_type: string;
        outputs?: Array<{ output_type: string; data?: Record<string, unknown> }>;
      }>;
    };
    const codeCell = nb.cells.find((c) => c.cell_type === "code");
    expect(codeCell).toBeDefined();
    const displayOutput = codeCell!.outputs?.find((o) => o.output_type === "display_data");
    expect(displayOutput).toBeDefined();
    expect(displayOutput!.data).toHaveProperty("image/png");
  });

  it("includes error outputs", async () => {
    const nb = (await buildNotebook(ERROR_MESSAGES, "sess-1")) as {
      cells: Array<{
        cell_type: string;
        outputs?: Array<{ output_type: string; evalue?: string }>;
      }>;
    };
    const codeCell = nb.cells.find((c) => c.cell_type === "code");
    const errOutput = codeCell!.outputs?.find((o) => o.output_type === "error");
    expect(errOutput).toBeDefined();
    expect(errOutput!.evalue).toContain("ZeroDivisionError");
  });

  it("includes assistant text as markdown cell", async () => {
    const nb = (await buildNotebook(CODE_EXECUTION_MESSAGES, "sess-1")) as {
      cells: Array<{ cell_type: string; source: string[] }>;
    };
    const assistantMd = nb.cells.find(
      (c) => c.cell_type === "markdown" && c.source.join("").includes("**Assistant:**")
    );
    expect(assistantMd).toBeDefined();
  });
});
