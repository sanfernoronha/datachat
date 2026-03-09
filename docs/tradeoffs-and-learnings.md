# DataChat — Tradeoffs & Learnings

A running log of architectural decisions, trade-offs considered, and lessons learned.
Useful for deep-dive discussions and technical interviews.

---

## 1. LLM Provider Abstraction

**Decision:** Environment-variable-based provider switching (Anthropic/OpenAI/Google) via a thin resolver (`lib/ai/model.ts`).

**Why not a single provider?** Vendor lock-in is a real risk — API pricing, rate limits, and model capabilities change frequently. A researcher who hits OpenAI rate limits can switch to Gemini in 10 seconds by changing `.env`.

**Tradeoff:** Each provider has slightly different tool-calling behavior, output formatting, and token limits. The AI SDK abstracts most of this, but edge cases (e.g., Gemini's stricter safety filters) can surface at runtime.

**Alternative considered:** LiteLLM proxy — adds another service but gives a unified OpenAI-compatible API for 100+ models. Overkill for a PoC.

---

## 2. Code Execution: Docker vs E2B vs Pyodide

**Decision:** Self-hosted Docker container running FastAPI + Python `exec()`.

**Options evaluated:**

| Approach | Security | Cold Start | Cost | Ops |
|----------|----------|-----------|------|-----|
| **E2B** (Firecracker microVM) | Strong | ~150ms | ~$0.10/hr | Low (SaaS) |
| **Modal** (gVisor containers) | Strong | <1s | ~$0.047/vCPU-hr | Low (SaaS) |
| **Docker + FastAPI** (chosen) | Moderate | 1-3s | Infra only | Medium |
| **Pyodide** (browser WASM) | Very strong | 3-15s | Free | Zero |

**Why Docker?** This is a PoC for a homework assignment — no third-party vendor dependencies. Docker demonstrates the full architecture (network isolation, resource limits, file mounting) while keeping operational complexity manageable.

**Security hardening applied:**
- Non-root user inside the container
- Memory limit (2G) and PID limit (64) via Docker Compose
- No internet access (internal-only Docker network)
- 30-second execution timeout via `signal.alarm`
- Read-only data mount, write-only output mount

**What we're NOT doing (production would):**
- **gVisor** — user-space kernel that intercepts all syscalls. Prevents kernel exploits from escaping the container. One-line Docker runtime change (`--runtime=runsc`), ~5-10% I/O overhead. Would be the first hardening step for production.
- **Firecracker microVMs** — full hardware-level isolation (what AWS Lambda uses). Strongest security, but requires significant infra. E2B wraps this as a service.
- **Per-session containers** — currently all sessions share one container (with in-memory namespace isolation). Production would spin a container per session for true isolation.
- **nsjail / seccomp profiles** — fine-grained syscall filtering. Blocks specific dangerous calls while allowing safe ones.

**Key insight:** Docker alone shares the host kernel — a determined attacker could exploit a kernel vulnerability to escape. For untrusted user code in production, you need gVisor at minimum.

---

## 3. Session State: In-Memory Dict vs Jupyter Kernel

**Decision:** In-memory Python globals dict per session (`session_mgr.py`).

**Why not a full Jupyter kernel?** Jupyter adds ~200MB to the Docker image and significant complexity (ZMQ, kernel lifecycle management, message protocol). An in-memory dict achieves the same UX (variables persist across executions) with ~50 lines of code.

**Tradeoff:** If the Docker container restarts, all session state is lost. Jupyter kernels have the same limitation unless you add persistence, so this is equivalent.

**Alternative considered:** IPython embedded shell — richer than bare `exec()` (magic commands, better error formatting) but still simpler than full Jupyter. Could upgrade to this later.

---

## 4. AI SDK Tool Use vs Regex Code Extraction

**Decision:** Use AI SDK's native tool-calling (`tools: { execute_python: tool({...}) }`) instead of parsing code blocks from LLM text with regex.

**Why?** Tool calling is structurally reliable — the LLM explicitly declares intent to execute code, and the SDK handles the request/response lifecycle. Regex extraction is fragile (markdown formatting varies, partial code blocks during streaming, language tags inconsistent).

**Tradeoff:** Tool calling requires the LLM to support function calling. All three providers (Anthropic, OpenAI, Google) support it, but behavior differs:
- OpenAI: mature, predictable tool calling
- Anthropic: good, occasionally verbose wrapping text
- Google: works but may need prompt tuning for reliable tool use

**Key architectural benefit:** `maxSteps: 5` enables multi-turn tool use — the LLM can run code, see the result, then decide to run more code. This creates a genuine analysis loop, not just a single code-then-explain pattern.

---

## 5. Tailwind v4 Breaking Changes

**Learning:** Tailwind v4 changed utility syntax. `placeholder-gray-400` (v3) doesn't work; `placeholder:text-gray-400` also unreliable. Fix was raw CSS in `globals.css`:

```css
::placeholder {
  color: #9ca3af;
  opacity: 1;
}
```

**Resolution:** Created shared `Input` and `Textarea` components (`components/ui/input.tsx`) with standardized styling. All forms use these — prevents per-component visibility bugs.

---

## 6. Prisma 7 Migration

**Learning:** Prisma 7 is a major breaking change from v5/v6:
- `prisma-client-js` generator → `prisma-client` (requires explicit `output` path)
- `url` removed from `datasource db` in schema — now in `prisma.config.ts`
- Binary engine removed — must use `@prisma/adapter-pg` + `pg`
- Import path: `@/lib/generated/prisma/client` (not `@prisma/client`)

**Tradeoff:** Prisma 7's driver-adapter approach is more flexible (works with serverless, edge, etc.) but requires more setup than v5's "just works" approach.

---

## 7. AI SDK v6 Migration

**Learning:** AI SDK v6 has major breaking changes:
- `useChat` moved to `@ai-sdk/react` (not `ai/react`)
- Returns `sendMessage` + `status` (not `handleSubmit` + `isLoading`)
- `Message` → `UIMessage` with `parts[]` instead of `content` string
- Server sends via `toTextStreamResponse()` (not `toDataStreamResponse()`)
- Transport is explicit: `TextStreamChatTransport` or `DefaultChatTransport`

**Key insight:** The `parts[]` model is better — it cleanly separates text, tool invocations, and tool results within a single message. This is what enables inline code execution blocks in the chat UI.

---

## 8. File Storage: Local Disk vs Object Storage

**Decision:** Files stored on local disk at `uploads/<sessionId>/data/`.

**Why?** For a PoC, local storage is simplest and avoids cloud dependencies. The directory structure mirrors what the execution container sees via Docker volume mounts.

**Production would use:** S3/GCS with pre-signed URLs. The execution container would pull files at startup or use FUSE mounts.

---

## 9. Data Sent to LLM: Schema Only vs Sample Rows

**Current:** Only column names and types are sent to the LLM (via system prompt). The LLM does NOT see actual data values.

**Tradeoff:** Sending a sample (first 50 rows) would let the LLM give better analysis without executing code, but:
- Increases token usage per request
- May leak sensitive patient data into LLM provider logs
- Cancer genomics data can have HIPAA/PHI implications

**Decision for now:** Schema only. The LLM uses the `execute_python` tool to actually read and compute on data — the data stays within the Docker container and never leaves the local network.

---

*This document is updated as new decisions are made.*
