import { describe, it, expect, vi, afterEach } from "vitest";

// Mock AI SDK providers to avoid needing API keys
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => (name: string) => ({ provider: "anthropic", model: name })),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({
    chat: (name: string) => ({ provider: "openai", model: name }),
  })),
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => (name: string) => ({ provider: "google", model: name })),
}));

import { getModel } from "./model";

describe("getModel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to anthropic provider with claude-sonnet-4-6", () => {
    vi.stubEnv("MODEL_PROVIDER", "");
    delete process.env.MODEL_PROVIDER;
    const model = getModel() as unknown as { provider: string; model: string };
    expect(model.provider).toBe("anthropic");
    expect(model.model).toBe("claude-sonnet-4-6");
  });

  it("uses openai provider when MODEL_PROVIDER=openai", () => {
    vi.stubEnv("MODEL_PROVIDER", "openai");
    const model = getModel() as unknown as { provider: string; model: string };
    expect(model.provider).toBe("openai");
    expect(model.model).toBe("gpt-4o");
  });

  it("uses google provider when MODEL_PROVIDER=google", () => {
    vi.stubEnv("MODEL_PROVIDER", "google");
    const model = getModel() as unknown as { provider: string; model: string };
    expect(model.provider).toBe("google");
    expect(model.model).toBe("gemini-2.0-flash");
  });

  it("throws for unknown provider", () => {
    vi.stubEnv("MODEL_PROVIDER", "unknown");
    expect(() => getModel()).toThrow('Unknown MODEL_PROVIDER: "unknown"');
  });

  it("respects MODEL_NAME override", () => {
    vi.stubEnv("MODEL_PROVIDER", "openai");
    vi.stubEnv("MODEL_NAME", "gpt-4-turbo");
    const model = getModel() as unknown as { provider: string; model: string };
    expect(model.model).toBe("gpt-4-turbo");
  });
});
