// lib/sandbox/client.ts
//
// Singleton wrapper around the AIO Sandbox SDK.
// Provides Jupyter code execution, file upload, and package installation.

import { SandboxClient } from "@agent-infra/sandbox";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RichOutput {
  type: "image" | "html" | "text" | "svg" | "json" | "latex" | "markdown";
  content: string; // base64 for images, raw string for html/text/svg/json/latex/markdown
  mimeType: string;
}

export interface SandboxExecutionResult {
  status: "ok" | "error" | "timeout";
  stdout: string;
  stderr: string;
  results: RichOutput[];
  error?: {
    ename: string;
    evalue: string;
    traceback: string[];
  };
}

// ── Singleton Client ───────────────────────────────────────────────────────────

const globalForSandbox = globalThis as unknown as { sandboxClient: SandboxClient };

function getClient(): SandboxClient {
  if (globalForSandbox.sandboxClient) return globalForSandbox.sandboxClient;

  const url = process.env.SANDBOX_URL;
  if (!url) {
    throw new Error("SANDBOX_URL environment variable is not set.");
  }
  const client = new SandboxClient({ environment: url, timeoutInSeconds: 120 });

  if (process.env.NODE_ENV !== "production") {
    globalForSandbox.sandboxClient = client;
  }
  return client;
}

// ── Session Tracking ─────────────────────────────────────────────────────────
// The sandbox assigns its own session UUIDs. We must reuse the sandbox-returned
// session_id to maintain kernel state across calls.
// Maps: DataChat sessionId → sandbox kernel session_id
const sandboxSessionMap = new Map<string, string>();

const BOOTSTRAP_CODE = (dataDir: string) => `
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('module://matplotlib_inline.backend_inline')
import matplotlib.pyplot as plt
import plotly.express as px
import plotly.graph_objects as go
import warnings
warnings.filterwarnings('ignore')
DATA_DIR = "${dataDir}"
print("Environment ready.")
`.trim();

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Converts a Plotly JSON spec into a self-contained HTML page for iframe rendering.
 */
function plotlyJsonToHtml(plotlyJson: Record<string, unknown>): string {
  const spec = JSON.stringify(plotlyJson);
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
<style>body{margin:0;overflow:hidden}#plot{width:100vw;height:100vh}</style>
</head><body>
<div id="plot"></div>
<script>
var spec=${spec};
Plotly.newPlot("plot",spec.data||[],spec.layout||{},{responsive:true});
</script>
</body></html>`;
}

function extractRichOutputs(
  data: Record<string, unknown> | undefined
): RichOutput[] {
  if (!data) return [];
  const outputs: RichOutput[] = [];

  // ── Interactive chart formats (convert to self-contained HTML) ──

  // Plotly JSON → self-contained HTML with CDN script
  if (data["application/vnd.plotly.v1+json"]) {
    const html = plotlyJsonToHtml(data["application/vnd.plotly.v1+json"] as Record<string, unknown>);
    outputs.push({ type: "html", content: html, mimeType: "text/html" });
  }

  // Vega / Vega-Lite (Altair) → self-contained HTML with CDN
  for (const key of Object.keys(data)) {
    if (key.startsWith("application/vnd.vegalite.") || key.startsWith("application/vnd.vega.")) {
      const spec = JSON.stringify(data[key]);
      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/vega@5"></script>
<script src="https://cdn.jsdelivr.net/npm/vega-lite@5"></script>
<script src="https://cdn.jsdelivr.net/npm/vega-embed@6"></script>
<style>body{margin:0}#vis{width:100vw;height:100vh}</style>
</head><body><div id="vis"></div>
<script>vegaEmbed("#vis",${spec},{actions:false}).catch(console.error);</script>
</body></html>`;
      outputs.push({ type: "html", content: html, mimeType: "text/html" });
    }
  }

  // Bokeh — already outputs text/html with embedded scripts, handled below

  // ── Raster images (base64-encoded) ──

  if (data["image/png"]) {
    outputs.push({ type: "image", content: data["image/png"] as string, mimeType: "image/png" });
  }
  if (data["image/jpeg"]) {
    outputs.push({ type: "image", content: data["image/jpeg"] as string, mimeType: "image/jpeg" });
  }
  if (data["image/gif"]) {
    outputs.push({ type: "image", content: data["image/gif"] as string, mimeType: "image/gif" });
  }
  if (data["image/webp"]) {
    outputs.push({ type: "image", content: data["image/webp"] as string, mimeType: "image/webp" });
  }

  // ── Structured / rich text ──

  if (data["text/html"]) {
    outputs.push({ type: "html", content: data["text/html"] as string, mimeType: "text/html" });
  }
  if (data["image/svg+xml"]) {
    outputs.push({ type: "svg", content: data["image/svg+xml"] as string, mimeType: "image/svg+xml" });
  }
  if (data["text/latex"]) {
    outputs.push({ type: "latex", content: data["text/latex"] as string, mimeType: "text/latex" });
  }
  if (data["text/markdown"]) {
    outputs.push({ type: "markdown", content: data["text/markdown"] as string, mimeType: "text/markdown" });
  }
  if (data["application/json"]) {
    outputs.push({ type: "json", content: JSON.stringify(data["application/json"]), mimeType: "application/json" });
  }

  // ── Fallback: text/plain only if nothing richer was found ──
  if (outputs.length === 0 && data["text/plain"]) {
    outputs.push({ type: "text", content: data["text/plain"] as string, mimeType: "text/plain" });
  }

  return outputs;
}

function transformJupyterResponse(
  jupyterData: {
    status: string;
    outputs: Array<{
      output_type: string;
      name?: string;
      text?: string;
      data?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      execution_count?: number;
      ename?: string;
      evalue?: string;
      traceback?: string[];
    }>;
  } | undefined
): SandboxExecutionResult {
  if (!jupyterData) {
    return { status: "error", stdout: "", stderr: "No response from sandbox", results: [] };
  }

  let stdout = "";
  let stderr = "";
  const results: RichOutput[] = [];
  let error: SandboxExecutionResult["error"] | undefined;

  for (const output of jupyterData.outputs) {
    switch (output.output_type) {
      case "stream":
        if (output.name === "stdout") stdout += output.text ?? "";
        else if (output.name === "stderr") stderr += output.text ?? "";
        break;

      case "execute_result":
      case "display_data":
        results.push(...extractRichOutputs(output.data));
        break;

      case "error":
        error = {
          ename: output.ename ?? "Error",
          evalue: output.evalue ?? "",
          traceback: output.traceback ?? [],
        };
        break;
    }
  }

  const status: SandboxExecutionResult["status"] =
    jupyterData.status === "ok" ? "ok" : error ? "error" : jupyterData.status === "timeout" ? "timeout" : "error";

  return { status, stdout, stderr, results, error };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function executeCode(
  sessionId: string,
  code: string
): Promise<SandboxExecutionResult> {
  const dataDir = `/home/gem/data/${sessionId}`;
  let sandboxSessionId = sandboxSessionMap.get(sessionId);

  // Bootstrap: create a new kernel and pre-import libraries
  if (!sandboxSessionId) {
    const bootstrapRes = await getClient().jupyter.executeCode({
      code: BOOTSTRAP_CODE(dataDir),
      kernel_name: "python3",
      timeout: 30,
    });

    if (bootstrapRes.ok && bootstrapRes.body.data?.session_id) {
      sandboxSessionId = bootstrapRes.body.data.session_id;
      sandboxSessionMap.set(sessionId, sandboxSessionId);
    } else {
      return {
        status: "error",
        stdout: "",
        stderr: `Failed to bootstrap sandbox session: ${JSON.stringify(bootstrapRes.ok ? bootstrapRes.body : bootstrapRes.error)}`,
        results: [],
      };
    }
  }

  // Execute the actual code using the sandbox's kernel session
  let response = await getClient().jupyter.executeCode({
    code,
    kernel_name: "python3",
    session_id: sandboxSessionId,
    timeout: 60,
  });

  // If the kernel died or errored at the SDK level, try once with a fresh kernel
  if (!response.ok) {
    console.log("[executeCode] SDK error, resetting kernel for session:", sessionId);
    sandboxSessionMap.delete(sessionId);

    // Re-bootstrap
    const bootstrapRes = await getClient().jupyter.executeCode({
      code: BOOTSTRAP_CODE(dataDir),
      kernel_name: "python3",
      timeout: 30,
    });

    if (bootstrapRes.ok && bootstrapRes.body.data?.session_id) {
      sandboxSessionId = bootstrapRes.body.data.session_id;
      sandboxSessionMap.set(sessionId, sandboxSessionId);

      // Retry the original code on the fresh kernel
      response = await getClient().jupyter.executeCode({
        code,
        kernel_name: "python3",
        session_id: sandboxSessionId,
        timeout: 60,
      });
    }

    if (!response.ok) {
      return {
        status: "error",
        stdout: "",
        stderr: `Sandbox error (after kernel reset): ${JSON.stringify(response.error)}`,
        results: [],
      };
    }
  }

  const rawData = response.body.data;

  // If the kernel returned an ExecutionError that looks like a dead session ID,
  // reset and retry once
  if (rawData?.status === "error" && rawData.outputs?.length === 1) {
    const errOutput = rawData.outputs[0];
    if (
      errOutput.output_type === "error" &&
      errOutput.ename === "ExecutionError" &&
      errOutput.evalue?.match(/^[0-9a-f-]{36}$/i)
    ) {
      console.log("[executeCode] Detected dead kernel (ExecutionError with session UUID), resetting...");
      sandboxSessionMap.delete(sessionId);

      const bootstrapRes = await getClient().jupyter.executeCode({
        code: BOOTSTRAP_CODE(dataDir),
        kernel_name: "python3",
        timeout: 30,
      });

      if (bootstrapRes.ok && bootstrapRes.body.data?.session_id) {
        sandboxSessionId = bootstrapRes.body.data.session_id;
        sandboxSessionMap.set(sessionId, sandboxSessionId);

        const retryRes = await getClient().jupyter.executeCode({
          code,
          kernel_name: "python3",
          session_id: sandboxSessionId,
          timeout: 60,
        });

        if (retryRes.ok) {
          console.log("[executeCode] Retry after kernel reset succeeded");
          return transformJupyterResponse(retryRes.body.data);
        }
      }
    }
  }

  console.log("[executeCode] status:", rawData?.status, "outputs:", rawData?.outputs?.length);

  return transformJupyterResponse(rawData);
}

export async function uploadFile(
  sessionId: string,
  filename: string,
  buffer: Buffer
): Promise<{ success: boolean; path: string }> {
  const remotePath = `/home/gem/data/${sessionId}/${filename}`;

  const response = await getClient().file.uploadFile({
    file: new Blob([new Uint8Array(buffer)]),
    path: remotePath,
  });

  if (!response.ok) {
    throw new Error(`Failed to upload file to sandbox: ${JSON.stringify(response.error)}`);
  }

  return {
    success: response.body.data?.success ?? false,
    path: remotePath,
  };
}

export async function installPackage(
  sessionId: string,
  packageName: string
): Promise<{ success: boolean; output: string }> {
  // Sanitize package name to prevent injection
  const safePkg = packageName.replace(/[^a-zA-Z0-9._\-\[\]>=<! ]/g, "");

  // Install from within the Jupyter kernel so the package is on the same sys.path.
  // After installing, invalidate the import cache so the kernel can find the new package.
  const installCode = `import subprocess, sys, importlib
r = subprocess.run([sys.executable, "-m", "pip", "install", "${safePkg}"], capture_output=True, text=True, timeout=120)
print(r.stdout[-500:] if len(r.stdout) > 500 else r.stdout)
if r.returncode != 0:
    print("STDERR:", r.stderr[-500:])
else:
    importlib.invalidate_caches()
print("__EXIT_CODE__:", r.returncode)`;

  let result = await executeCode(sessionId, installCode);

  // Retry once if the execution itself failed (sandbox issue, not pip issue)
  if (result.status !== "ok" || result.error) {
    console.log("[installPackage] First attempt failed, retrying:", result.stderr.slice(0, 200));
    result = await executeCode(sessionId, installCode);
  }

  // Check both kernel status and pip exit code
  const pipSuccess = result.stdout.includes("__EXIT_CODE__: 0");
  return {
    success: (result.status === "ok" && !result.error && pipSuccess),
    output: result.stdout + result.stderr,
  };
}

/**
 * Returns a lean summary of execution results for the LLM context.
 * Strips base64 image data to save tokens.
 */
export function toLLMSummary(result: SandboxExecutionResult): Record<string, unknown> {
  return {
    status: result.status,
    stdout: result.stdout.slice(0, 10_000),
    stderr: result.stderr.slice(0, 5_000),
    has_plots: result.results.some((r) => r.type === "image" || r.type === "svg"),
    has_tables: result.results.some((r) => r.type === "html"),
    result_count: result.results.length,
    error: result.error
      ? `${result.error.ename}: ${result.error.evalue}`
      : undefined,
  };
}

/**
 * Strips base64 image data from results for DB storage.
 */
export function stripBase64ForStorage(result: SandboxExecutionResult): SandboxExecutionResult {
  return {
    ...result,
    results: result.results.map((r) =>
      r.type === "image"
        ? { ...r, content: `[${r.mimeType} image, ${Math.round(r.content.length * 0.75 / 1024)}KB]` }
        : r
    ),
  };
}

/**
 * Saves rich outputs (images, Plotly HTML) to disk for serving via the output API.
 * Returns filenames for images/Plotly and inline HTML strings for DataFrame tables.
 */
export async function saveOutputFiles(
  sessionId: string,
  results: RichOutput[]
): Promise<{ filenames: string[]; tables: string[] }> {
  const outputDir = join(process.cwd(), "uploads", sessionId, "output");
  await mkdir(outputDir, { recursive: true });

  const filenames: string[] = [];
  const tables: string[] = [];

  for (const result of results) {
    switch (result.type) {
      case "image": {
        // Map MIME type → file extension
        const extMap: Record<string, string> = {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/gif": "gif",
          "image/webp": "webp",
          "image/svg+xml": "svg",
        };
        const ext = extMap[result.mimeType] ?? "png";
        const filename = `${randomUUID()}.${ext}`;
        const buffer = Buffer.from(result.content, "base64");
        await writeFile(join(outputDir, filename), buffer);
        filenames.push(filename);
        break;
      }
      case "svg": {
        const filename = `${randomUUID()}.svg`;
        await writeFile(join(outputDir, filename), result.content, "utf-8");
        filenames.push(filename);
        break;
      }
      case "html": {
        // Rich HTML with scripts (Plotly, Bokeh, Vega, etc.) → save to disk, serve in iframe
        if (
          result.content.includes("<script") ||
          result.content.includes("plotly") ||
          result.content.includes("Bokeh") ||
          result.content.includes("vega")
        ) {
          const filename = `${randomUUID()}.html`;
          await writeFile(join(outputDir, filename), result.content, "utf-8");
          filenames.push(filename);
        } else {
          // DataFrame tables and simple HTML → inline
          tables.push(result.content);
        }
        break;
      }
      case "latex":
      case "markdown":
        // Render as inline text content (displayed as stdout-style in the output)
        tables.push(result.content);
        break;
    }
  }

  return { filenames, tables };
}
