// AR-9.2: ai_usage_log had 0 rows against 184 real agent_runs in 3 hours
// because recordCost() (src/lib/pil/cost.ts) was only ever reachable from
// the PIL agent framework -- the shared Anthropic wrapper the platform's
// real (core-agent) traffic actually calls through, src/lib/ai/claude.ts,
// never recorded cost at all. These tests exercise that wrapper directly
// (not a full mock of "@/lib/ai/claude" the way other suites do) so a
// regression that silently drops the recordCost() call is caught here.
// Everything below the wrapper is mocked -- no real network or DB calls.
import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG_ID = "11111111-2222-3333-4444-555555555555";

const messagesCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: messagesCreate };
  },
}));

vi.mock("@/lib/ai/claude-concurrency", () => ({
  withClaudeLimit: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({ insert: vi.fn(async () => ({ error: null })) })),
  })),
}));

vi.mock("@/lib/ai/usage-context", () => ({
  getUsageContext: vi.fn(),
}));

vi.mock("@/lib/ai/pricing", () => ({
  computeCostUsd: vi.fn(),
}));

vi.mock("@/lib/pil/cost", () => ({
  recordCost: vi.fn(async () => undefined),
}));

function mockAnthropicResponse() {
  messagesCreate.mockResolvedValue({
    content: [{ type: "text", text: "hello" }],
    usage: { input_tokens: 1000, output_tokens: 500 },
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
  });
}

describe("AR-9.2: claude.ts wrapper records cost on every call", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicResponse();
    // resetAllMocks() clears withClaudeLimit's pass-through impl (set once
    // when its mock factory first ran) on every test after the first --
    // re-arm it every time so the real messages.create() mock underneath
    // actually gets invoked instead of resolving to undefined.
    const { withClaudeLimit } = await import("@/lib/ai/claude-concurrency");
    vi.mocked(withClaudeLimit).mockImplementation(<T>(fn: () => Promise<T>) => fn());
  });

  it("callClaude() records a priced call against the active usage context", async () => {
    const { getUsageContext } = await import("@/lib/ai/usage-context");
    const { computeCostUsd } = await import("@/lib/ai/pricing");
    const { recordCost } = await import("@/lib/pil/cost");
    vi.mocked(getUsageContext).mockReturnValue({
      organizationId: ORG_ID,
      agentType: "ag-29-knowledge-indexer",
      agentRunId: "run-1",
    });
    vi.mocked(computeCostUsd).mockResolvedValue(0.0105);

    const { callClaude } = await import("@/lib/ai/claude");
    await callClaude({ prompt: "hi" });

    expect(recordCost).toHaveBeenCalledTimes(1);
    const entry = vi.mocked(recordCost).mock.calls[0]![0];
    expect(entry.organization_id).toBe(ORG_ID);
    expect(entry.agent_type).toBe("ag-29-knowledge-indexer");
    expect(entry.agent_run_id).toBe("run-1");
    expect(entry.pil_agent_run_id).toBeNull();
    expect(entry.model).toBe("claude-sonnet-4-6");
    expect(entry.input_tokens).toBe(1000);
    expect(entry.output_tokens).toBe(500);
    expect(entry.total_tokens).toBe(1500);
    expect(entry.cost_usd).toBe(0.0105);
    expect(entry.provider).toBe("anthropic");
    expect(entry.billing_path).toBe("api");
    expect(entry.endpoint).toBe("callClaude");
  });

  it("records cost_usd: null (not 0) for a model missing from model_cost_reference", async () => {
    const { getUsageContext } = await import("@/lib/ai/usage-context");
    const { computeCostUsd } = await import("@/lib/ai/pricing");
    const { recordCost } = await import("@/lib/pil/cost");
    vi.mocked(getUsageContext).mockReturnValue({
      organizationId: ORG_ID,
      agentType: "some-agent",
    });
    vi.mocked(computeCostUsd).mockResolvedValue(null);

    const { callClaude } = await import("@/lib/ai/claude");
    await callClaude({ prompt: "hi" });

    const entry = vi.mocked(recordCost).mock.calls[0]![0];
    expect(entry.cost_usd).toBeNull();
    expect(entry.cost_usd).not.toBe(0);
  });

  it("does not call recordCost() when no usage context is set, and never throws", async () => {
    const { getUsageContext } = await import("@/lib/ai/usage-context");
    const { recordCost } = await import("@/lib/pil/cost");
    vi.mocked(getUsageContext).mockReturnValue(undefined);

    const { callClaude } = await import("@/lib/ai/claude");
    const response = await callClaude({ prompt: "hi" });

    expect(recordCost).not.toHaveBeenCalled();
    expect(response.text).toBe("hello");
  });

  it("a failed ai_usage_log write never fails the caller's already-successful AI call", async () => {
    const { getUsageContext } = await import("@/lib/ai/usage-context");
    const { computeCostUsd } = await import("@/lib/ai/pricing");
    const { recordCost } = await import("@/lib/pil/cost");
    vi.mocked(getUsageContext).mockReturnValue({ organizationId: ORG_ID, agentType: "x" });
    vi.mocked(computeCostUsd).mockResolvedValue(0.01);
    vi.mocked(recordCost).mockRejectedValue(new Error("insert failed"));

    const { callClaude } = await import("@/lib/ai/claude");
    const response = await callClaude({ prompt: "hi" });

    expect(response.text).toBe("hello");
  });

  it("callClaudeWithTools() and callClaudeWithWebSearch() also record cost", async () => {
    const { getUsageContext } = await import("@/lib/ai/usage-context");
    const { computeCostUsd } = await import("@/lib/ai/pricing");
    const { recordCost } = await import("@/lib/pil/cost");
    vi.mocked(getUsageContext).mockReturnValue({ organizationId: ORG_ID, agentType: "x" });
    vi.mocked(computeCostUsd).mockResolvedValue(0.02);

    const { callClaudeWithTools, callClaudeWithWebSearch } = await import("@/lib/ai/claude");
    await callClaudeWithTools({ messages: [{ role: "user", content: "hi" }], tools: [] });
    await callClaudeWithWebSearch({ prompt: "hi" });

    const endpoints = vi.mocked(recordCost).mock.calls.map((call) => call[0]!.endpoint);
    expect(endpoints).toEqual(["callClaudeWithTools", "callClaudeWithWebSearch"]);
  });
});
