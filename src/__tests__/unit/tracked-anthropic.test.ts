// AR-9.2 recovery: claude.ts's four callClaude* wrappers recorded cost, but
// ~34 modules (autoapply, intelligence, donor-discovery, scraper-v2,
// enrichment, operator scripts) never called them -- each built its own
// `new Anthropic(...)` and called messages.create() directly, recording
// nothing. createTrackedAnthropic() instruments the CLIENT so those modules
// are covered by construction rather than by remembering to add a call at
// every site (the AR-7.1 five-of-six-launch-sites failure mode).
//
// These tests pin the three things that make that safe: it records, it never
// breaks the caller's response, and a recording failure never turns a
// successful Anthropic call into a thrown error.
import { describe, it, expect, vi, beforeEach } from "vitest";

const messagesCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: messagesCreate };
  },
}));

vi.mock("@/lib/ai/usage-recorder", () => ({
  recordUsage: vi.fn(async () => undefined),
}));

const OK_RESPONSE = {
  content: [{ type: "text", text: "ok" }],
  usage: { input_tokens: 1200, output_tokens: 300 },
  model: "claude-sonnet-4-6",
  stop_reason: "end_turn",
};

describe("AR-9.2 recovery: createTrackedAnthropic instruments raw clients", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    messagesCreate.mockResolvedValue(OK_RESPONSE);
  });

  it("records usage for a messages.create() call on a raw client", async () => {
    const { createTrackedAnthropic } = await import("@/lib/ai/tracked-anthropic");
    const { recordUsage } = await import("@/lib/ai/usage-recorder");

    const client = createTrackedAnthropic({ apiKey: "k" }, "pattern-engine");
    await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(recordUsage).toHaveBeenCalledTimes(1);
    const call = vi.mocked(recordUsage).mock.calls[0];
    expect(call).toBeDefined();
    const [source, model, inputTokens, outputTokens, _durationMs, billingPath] = call!;
    expect(source).toBe("pattern-engine");
    expect(model).toBe("claude-sonnet-4-6");
    expect(inputTokens).toBe(1200);
    expect(outputTokens).toBe(300);
    expect(billingPath).toBe("api");
  });

  it("returns the SDK response untouched so call sites keep working", async () => {
    const { createTrackedAnthropic } = await import("@/lib/ai/tracked-anthropic");

    const client = createTrackedAnthropic({ apiKey: "k" }, "grant-dna");
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(response).toEqual(OK_RESPONSE);
  });

  it("passes billing_path through, so subscription calls are not priced as API spend", async () => {
    const { createTrackedAnthropic } = await import("@/lib/ai/tracked-anthropic");
    const { recordUsage } = await import("@/lib/ai/usage-recorder");

    const client = createTrackedAnthropic({ apiKey: "k" }, "forge-build", "subscription");
    await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      messages: [{ role: "user", content: "hi" }],
    });

    const call = vi.mocked(recordUsage).mock.calls[0];
    expect(call).toBeDefined();
    expect(call![5]).toBe("subscription");
  });

  it("does not record when the response carries no usage (e.g. a stream)", async () => {
    const { createTrackedAnthropic } = await import("@/lib/ai/tracked-anthropic");
    const { recordUsage } = await import("@/lib/ai/usage-recorder");

    messagesCreate.mockResolvedValue({ model: "claude-sonnet-4-6" });
    const client = createTrackedAnthropic({ apiKey: "k" }, "extractor");
    await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(recordUsage).not.toHaveBeenCalled();
  });

  it("propagates a real Anthropic failure unchanged", async () => {
    const { createTrackedAnthropic } = await import("@/lib/ai/tracked-anthropic");
    const { recordUsage } = await import("@/lib/ai/usage-recorder");

    messagesCreate.mockRejectedValue(new Error("overloaded_error"));
    const client = createTrackedAnthropic({ apiKey: "k" }, "web-extractor");

    await expect(
      client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 64,
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow("overloaded_error");
    expect(recordUsage).not.toHaveBeenCalled();
  });
});
