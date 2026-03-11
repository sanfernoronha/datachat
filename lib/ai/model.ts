// lib/ai/model.ts
//
// Provider-agnostic model resolver.
//
// Reads two environment variables:
//   MODEL_PROVIDER  — "anthropic" | "openai" | "google"  (default: "anthropic")
//   MODEL_NAME      — model identifier for that provider  (optional, has sensible defaults)
//
// To switch providers, update your .env and restart the dev server:
//   MODEL_PROVIDER=openai
//   MODEL_NAME=gpt-4o
//   OPENAI_API_KEY=sk-...
//
// No code changes required when swapping providers.

import { createAnthropic }          from "@ai-sdk/anthropic";
import { createOpenAI }             from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

// Sensible defaults for each provider
const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  openai:    "gpt-4o",
  google:    "gemini-2.0-flash",
};

export function getModel() {
  const provider = process.env.MODEL_PROVIDER ?? "anthropic";
  const name     = process.env.MODEL_NAME ?? DEFAULT_MODELS[provider];

  if (!name) {
    throw new Error(`Unknown MODEL_PROVIDER: "${provider}". Use "anthropic", "openai", or "google".`);
  }

  switch (provider) {
    case "openai":
      // Use .chat() to force Chat Completions API — the default Responses API
      // can be unreliable with multi-step tool calling.
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY }).chat(name);

    case "google":
      return createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY })(name);

    case "anthropic":
    default:
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(name);
  }
}
