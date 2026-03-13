// lib/sandbox/client.ts
//
// Singleton wrapper around the AIO Sandbox SDK.
// Provides Jupyter code execution, file upload, and package installation.

import { SandboxClient } from "@agent-infra/sandbox";
import { randomUUID } from "crypto";
import { saveOutputFile, listDataFiles, getDataFile } from "@/lib/storage/files";

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

// ── Session Tracking (HMR-safe) ──────────────────────────────────────────────
// The sandbox assigns its own session UUIDs. We must reuse the sandbox-returned
// session_id to maintain kernel state across calls.
// Stored on globalThis so HMR doesn't wipe active kernel mappings.
const globalForSession = globalThis as unknown as {
  sandboxSessionMap: Map<string, string>;
  sandboxSessionLocks: Map<string, Promise<unknown>>;
};
if (!globalForSession.sandboxSessionMap) {
  globalForSession.sandboxSessionMap = new Map();
}
if (!globalForSession.sandboxSessionLocks) {
  globalForSession.sandboxSessionLocks = new Map();
}
const sandboxSessionMap = globalForSession.sandboxSessionMap;
const sandboxSessionLocks = globalForSession.sandboxSessionLocks;

/**
 * Per-session mutex. Ensures only one executeCode call runs at a time per session,
 * preventing concurrent kernel access that causes SDK errors and cascading resets.
 */
async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  // Wait for any in-flight operation on this session to finish
  const prev = sandboxSessionLocks.get(sessionId) ?? Promise.resolve();
  let resolve: () => void;
  const next = new Promise<void>((r) => { resolve = r; });
  sandboxSessionLocks.set(sessionId, next);

  try {
    await prev;
    return await fn();
  } finally {
    resolve!();
    // Clean up if we're the last waiter
    if (sandboxSessionLocks.get(sessionId) === next) {
      sandboxSessionLocks.delete(sessionId);
    }
  }
}

const BOOTSTRAP_CODE = (dataDir: string) => `
import os
DATA_DIR = "${dataDir}"
os.makedirs(DATA_DIR, exist_ok=True)
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('module://matplotlib_inline.backend_inline')
import matplotlib.pyplot as plt
import plotly.express as px
import plotly.graph_objects as go
import warnings
warnings.filterwarnings('ignore')
print("Environment ready. DATA_DIR =", DATA_DIR)
`.trim();

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Converts a Plotly JSON spec into a self-contained HTML page for iframe rendering.
 */
export function plotlyJsonToHtml(plotlyJson: Record<string, unknown>): string {
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

export function extractRichOutputs(
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

export function transformJupyterResponse(
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

/**
 * Re-uploads all files from S3 to the sandbox.
 * Called after kernel bootstrap to ensure files are available even if the
 * sandbox restarted or the initial upload failed.
 */
async function syncFilesToSandbox(sessionId: string): Promise<void> {
  try {
    const filenames = await listDataFiles(sessionId);
    for (const filename of filenames) {
      const buffer = await getDataFile(sessionId, filename);
      const remotePath = `/home/gem/data/${sessionId}/${filename}`;
      await getClient().file.uploadFile({
        file: new Blob([new Uint8Array(buffer)]),
        path: remotePath,
      });
      console.log("[syncFiles] Uploaded to sandbox:", remotePath);
    }
  } catch (err) {
    console.warn("[syncFiles] Failed to sync files to sandbox:", err);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function executeCode(
  sessionId: string,
  code: string
): Promise<SandboxExecutionResult> {
  // Serialize all executions for this session to prevent concurrent kernel access
  return withSessionLock(sessionId, () => executeCodeInner(sessionId, code));
}

async function executeCodeInner(
  sessionId: string,
  code: string
): Promise<SandboxExecutionResult> {
  const dataDir = `/home/gem/data/${sessionId}`;

  // Ensure we have a live kernel (bootstrap if needed)
  const kernelResult = await ensureKernel(sessionId, dataDir);
  if (!kernelResult.ok) return kernelResult.error;

  let sandboxSessionId = kernelResult.sandboxSessionId;

  // Execute the actual code
  let response = await getClient().jupyter.executeCode({
    code,
    kernel_name: "python3",
    session_id: sandboxSessionId,
    timeout: 180,
  });

  // ── Handle failures ──
  // IMPORTANT: Distinguish between timeouts and real kernel death.
  // Timeouts mean the kernel is still alive (variables preserved) — DON'T reset.
  // SDK errors / dead kernel errors mean the kernel is gone — reset and retry.

  if (!response.ok) {
    const errStr = JSON.stringify(response.error ?? "");

    // Timeout: kernel is alive but code ran too long. Return timeout without resetting.
    if (errStr.toLowerCase().includes("timeout")) {
      console.log("[executeCode] Timeout (kernel still alive), session:", sessionId);
      return {
        status: "timeout",
        stdout: "",
        stderr: "Code execution timed out (180s limit). The kernel is still alive — your variables are preserved. Try breaking the task into smaller steps.",
        results: [],
      };
    }

    // Real SDK error: kernel is dead, reset and retry once
    console.log("[executeCode] SDK error, resetting kernel for session:", sessionId);
    sandboxSessionMap.delete(sessionId);

    const retryKernel = await ensureKernel(sessionId, dataDir);
    if (!retryKernel.ok) return retryKernel.error;
    sandboxSessionId = retryKernel.sandboxSessionId;

    response = await getClient().jupyter.executeCode({
      code,
      kernel_name: "python3",
      session_id: sandboxSessionId,
      timeout: 180,
    });

    if (!response.ok) {
      console.error("[executeCode] Failed after kernel reset:", JSON.stringify(response.error));
      return {
        status: "error",
        stdout: "",
        stderr: "Sandbox execution failed after kernel reset. Please try again.",
        results: [],
      };
    }

    console.log("[executeCode] Retry after kernel reset succeeded");
  }

  const rawData = response.body.data;

  // Dead kernel error (ExecutionError with stale UUID) — reset and retry once
  if (isDeadKernelError(rawData)) {
    console.log("[executeCode] Dead kernel detected, resetting for session:", sessionId);
    sandboxSessionMap.delete(sessionId);

    const retryKernel = await ensureKernel(sessionId, dataDir);
    if (!retryKernel.ok) return retryKernel.error;
    sandboxSessionId = retryKernel.sandboxSessionId;

    const retryRes = await getClient().jupyter.executeCode({
      code,
      kernel_name: "python3",
      session_id: sandboxSessionId,
      timeout: 180,
    });

    if (retryRes.ok) {
      console.log("[executeCode] Retry after dead kernel reset succeeded");
      return transformJupyterResponse(retryRes.body.data);
    }

    return {
      status: "error",
      stdout: "",
      stderr: "Sandbox execution failed after kernel reset. Please try again.",
      results: [],
    };
  }

  console.log("[executeCode] status:", rawData?.status, "outputs:", rawData?.outputs?.length);
  return transformJupyterResponse(rawData);
}

/**
 * Bootstrap a kernel if one doesn't exist for this session.
 * Returns the sandbox session ID on success.
 */
async function ensureKernel(
  sessionId: string,
  dataDir: string
): Promise<
  | { ok: true; sandboxSessionId: string }
  | { ok: false; error: SandboxExecutionResult }
> {
  const existing = sandboxSessionMap.get(sessionId);
  if (existing) {
    // Probe: verify the kernel is still alive and has DATA_DIR.
    // The sandbox may have killed the idle kernel while we still hold the session ID.
    const probe = await getClient().jupyter.executeCode({
      code: "print(DATA_DIR)",
      kernel_name: "python3",
      session_id: existing,
      timeout: 10,
    });

    if (probe.ok && probe.body.data?.status === "ok") {
      return { ok: true, sandboxSessionId: existing };
    }

    // Kernel is dead or state was lost — drop the stale ID and re-bootstrap
    console.log("[ensureKernel] Stale kernel detected (probe failed), re-bootstrapping session:", sessionId);
    sandboxSessionMap.delete(sessionId);
  }

  const bootstrapRes = await getClient().jupyter.executeCode({
    code: BOOTSTRAP_CODE(dataDir),
    kernel_name: "python3",
    timeout: 30,
  });

  if (!bootstrapRes.ok || !bootstrapRes.body.data?.session_id) {
    console.error("[bootstrap] Failed:", JSON.stringify(bootstrapRes.ok ? bootstrapRes.body : bootstrapRes.error));
    return {
      ok: false,
      error: {
        status: "error",
        stdout: "",
        stderr: "Failed to bootstrap sandbox session. Please try again.",
        results: [],
      },
    };
  }

  const sandboxSessionId = bootstrapRes.body.data.session_id;
  sandboxSessionMap.set(sessionId, sandboxSessionId);

  const bData = bootstrapRes.body.data;
  if (bData.status !== "ok") {
    console.warn("[bootstrap] Python-level error:", JSON.stringify(bData.outputs?.slice(0, 2)));
  } else {
    console.log("[bootstrap] Kernel ready for session:", sessionId);
  }

  // Re-upload session files (handles sandbox restarts + failed initial uploads)
  await syncFilesToSandbox(sessionId);

  return { ok: true, sandboxSessionId };
}

/**
 * Detect a dead kernel: the sandbox returns an ExecutionError whose evalue is
 * a bare UUID (the stale session ID).
 */
function isDeadKernelError(
  data: { status?: string; outputs?: Array<{ output_type?: string; ename?: string; evalue?: string }> } | undefined
): boolean {
  if (!data || data.status !== "error" || data.outputs?.length !== 1) return false;
  const err = data.outputs[0];
  return (
    err.output_type === "error" &&
    err.ename === "ExecutionError" &&
    /^[0-9a-f-]{36}$/i.test(err.evalue ?? "")
  );
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

export async function downloadFile(
  sessionId: string,
  filename: string
): Promise<Buffer> {
  const remotePath = `/home/gem/data/${sessionId}/${filename}`;

  const response = await getClient().file.downloadFile({ path: remotePath });

  if (!response.ok) {
    throw new Error(`File not found in sandbox: ${filename}`);
  }

  const arrayBuffer = await response.body.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function installPackage(
  sessionId: string,
  packageName: string
): Promise<{ success: boolean; output: string }> {
  // Validate package name with an allowlist regex instead of stripping chars
  const PKG_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?(\[[\w,]+\])?(([><=!~]=?[0-9a-zA-Z.*]+,?)*)?$/;
  const safePkg = packageName.trim();
  if (!PKG_PATTERN.test(safePkg)) {
    return { success: false, output: `Invalid package name: "${packageName}"` };
  }

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
 * Saves rich outputs (images, Plotly HTML) to S3 for serving via the output API.
 * Returns filenames for images/Plotly and inline HTML strings for DataFrame tables.
 */
export async function saveOutputFiles(
  sessionId: string,
  results: RichOutput[]
): Promise<{ filenames: string[]; tables: string[] }> {
  const filenames: string[] = [];
  const tables: string[] = [];

  for (const result of results) {
    switch (result.type) {
      case "image": {
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
        await saveOutputFile(sessionId, filename, buffer, result.mimeType);
        filenames.push(filename);
        break;
      }
      case "svg": {
        const filename = `${randomUUID()}.svg`;
        await saveOutputFile(sessionId, filename, result.content, "image/svg+xml");
        filenames.push(filename);
        break;
      }
      case "html": {
        if (
          result.content.includes("<script") ||
          result.content.includes("plotly") ||
          result.content.includes("Bokeh") ||
          result.content.includes("vega")
        ) {
          const filename = `${randomUUID()}.html`;
          await saveOutputFile(sessionId, filename, result.content, "text/html");
          filenames.push(filename);
        } else {
          tables.push(result.content);
        }
        break;
      }
      case "latex":
      case "markdown":
        tables.push(result.content);
        break;
    }
  }

  return { filenames, tables };
}
