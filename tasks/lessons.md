# Lessons Learned

## AI SDK v6 Breaking Changes (from v5)
- `parameters` → `inputSchema` in `tool()` definitions. The old name is silently ignored.
- `maxSteps` → `stopWhen: stepCountIs(N)`. Import `stepCountIs` from `'ai'`.
- `toDataStreamResponse()` → `toUIMessageStreamResponse()` for tool call support.
- `TextStreamChatTransport` → `DefaultChatTransport` for tool-aware streams.
- `tool()` is an identity function — it doesn't remap fields. Typos are silent failures.

## AI SDK v6 + OpenAI Responses API
- `createOpenAI()(modelName)` defaults to Responses API (not Chat Completions).
- Use `createOpenAI().chat(modelName)` if you need Chat Completions explicitly.
- Both APIs support multi-step tool use — the step loop is SDK-side, not API-side.

## Zod v4 vs v3
- Zod v4 uses `_zod` property internally; AI SDK detects this and uses `zod/v4` subpath.
- `jsonSchema()` from `'ai'` is a reliable alternative that bypasses zod conversion entirely.

## AI SDK v6 onFinish Callback
- `onFinish` receives `{ text, steps, totalUsage, ... }` — `steps[]` has full tool call data.
- Tool results use `input` and `output` properties (not `args` and `result`).
- `output` is typed as `unknown` — use `JSON.parse(JSON.stringify(...))` to satisfy Prisma's JSON field type.

## Python Executor
- `exec()` doesn't capture expression return values — use `ast` to detect last expression and `eval()` it (like Jupyter).
- Always use `numeric_only=True` hints in system prompts for pandas operations on mixed-type DataFrames.
