// Unit tests for the in-app Benavora Assist tool registry
// (src/lib/knowledge/tools.ts) and the tool-use loop it feeds
// (src/lib/knowledge/assist.ts's answerApp). Supabase, the draft queue
// engine, and Claude are all mocked - these tests never touch the network
// or a real database.
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/drafts/draft-queue-engine", () => ({
  DraftQueueEngine: vi.fn(),
}));

vi.mock("@/lib/ai/claude", () => ({
  callClaudeConversation: vi.fn(),
  callClaudeWithTools: vi.fn(),
  callClaude: vi.fn(),
  DEFAULT_MODEL: "claude-sonnet-4-6",
}));

vi.mock("@/lib/knowledge/db", () => ({
  searchKnowledge: vi.fn(async () => []),
  rateCount: vi.fn(async () => 0),
  insertQuery: vi.fn(async () => undefined),
  knowledgeDb: vi.fn(),
}));

vi.mock("@/lib/intelligence/embeddings", () => ({
  generateEmbedding: vi.fn(async () => [0.1, 0.2]),
}));

import { createClient } from "@/lib/supabase/server";
import { DraftQueueEngine } from "@/lib/drafts/draft-queue-engine";
import { callClaudeWithTools } from "@/lib/ai/claude";
import { runTool } from "@/lib/knowledge/tools";
import { answerApp } from "@/lib/knowledge/assist";

/** A chainable Supabase query-builder stub. Awaiting it resolves to `result`. */
function makeBuilder(result: { data?: unknown; count?: number; error?: unknown } = { data: [] }) {
  const eqCalls: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn((...args: unknown[]) => {
    eqCalls.push(args);
    return builder;
  });
  builder.in = vi.fn(chain);
  builder.is = vi.fn(chain);
  builder.or = vi.fn(chain);
  builder.gte = vi.fn(chain);
  builder.lte = vi.fn(chain);
  builder.order = vi.fn(chain);
  builder.limit = vi.fn(chain);
  builder.then = (resolve: (v: unknown) => void) => resolve(result);
  (builder as { __eqCalls: unknown[][] }).__eqCalls = eqCalls;
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runTool - orgId is required", () => {
  it.each(["list_opportunities", "upcoming_deadlines", "pipeline_summary", "draft_status"])(
    "rejects %s when called without an orgId",
    async (name) => {
      (createClient as unknown as Mock).mockReturnValue({ from: vi.fn(() => makeBuilder()) });
      (DraftQueueEngine as unknown as Mock).mockImplementation(() => ({
        getQueueForOrg: vi.fn(async () => []),
      }));
      await expect(runTool(name, "", {})).rejects.toThrow();
    },
  );

  it("rejects an unknown tool name even with a valid orgId", async () => {
    await expect(runTool("not_a_real_tool", "org-caller", {})).rejects.toThrow();
  });
});

describe("runTool - caller orgId always wins over model-supplied input", () => {
  it("list_opportunities scopes by the caller's orgId, not input.org_id", async () => {
    let oppBuilder: ReturnType<typeof makeBuilder> | null = null;
    (createClient as unknown as Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "opportunities") {
          oppBuilder = makeBuilder({ data: [] });
          return oppBuilder;
        }
        return makeBuilder({ data: [] });
      }),
    });

    await runTool("list_opportunities", "org-caller", {
      org_id: "org-hacked",
      organization_id: "org-hacked-2",
      status: "open",
    });

    expect(oppBuilder).not.toBeNull();
    const eqCalls = (oppBuilder as unknown as { __eqCalls: unknown[][] }).__eqCalls;
    expect(eqCalls[0]).toEqual(["organization_id", "org-caller"]);
    expect(eqCalls.some((call) => call[1] === "org-hacked" || call[1] === "org-hacked-2")).toBe(false);
  });

  it("draft_status queries the draft engine with the caller's orgId, not input.org_id", async () => {
    const getQueueForOrg = vi.fn(async () => []);
    (DraftQueueEngine as unknown as Mock).mockImplementation(() => ({ getQueueForOrg }));
    (createClient as unknown as Mock).mockReturnValue({ from: vi.fn(() => makeBuilder()) });

    await runTool("draft_status", "org-caller", { org_id: "org-hacked" });

    expect(getQueueForOrg).toHaveBeenCalledWith("org-caller");
  });

  it("pipeline_summary scopes every stage count by the caller's orgId", async () => {
    const eqCalls: unknown[][] = [];
    (createClient as unknown as Mock).mockReturnValue({
      from: vi.fn(() => {
        const b = makeBuilder({ count: 0 });
        const originalEq = b.eq as Mock;
        b.eq = vi.fn((...args: unknown[]) => {
          eqCalls.push(args);
          return originalEq(...args);
        });
        return b;
      }),
    });

    await runTool("pipeline_summary", "org-caller", { org_id: "org-hacked" });

    const orgIdCalls = eqCalls.filter((c) => c[0] === "organization_id");
    expect(orgIdCalls.length).toBeGreaterThan(0);
    expect(orgIdCalls.every((c) => c[1] === "org-caller")).toBe(true);
  });
});

describe("answerApp - tool-use loop", () => {
  it("stops after 4 tool rounds even if the model keeps requesting tools", async () => {
    (createClient as unknown as Mock).mockReturnValue({
      from: vi.fn(() => makeBuilder({ count: 0 })),
    });

    const alwaysToolUse = {
      content: [{ type: "tool_use", id: "t1", name: "pipeline_summary", input: {} }],
      stopReason: "tool_use",
      model: "claude-sonnet-4-6",
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    };
    (callClaudeWithTools as unknown as Mock).mockResolvedValue(alwaysToolUse);

    const result = await answerApp({
      question: "What is my pipeline status?",
      history: [],
      orgId: "org-caller",
      userId: "user-1",
    });

    // 1 initial call + 4 tool rounds = 5 total calls, never a 6th.
    expect(callClaudeWithTools).toHaveBeenCalledTimes(5);
    expect(result.toolsUsed).toEqual(["pipeline_summary"]);
  });

  it("stops immediately when the model does not ask for a tool", async () => {
    (createClient as unknown as Mock).mockReturnValue({
      from: vi.fn(() => makeBuilder({ count: 0 })),
    });

    (callClaudeWithTools as unknown as Mock).mockResolvedValue({
      content: [{ type: "text", text: "Here is your answer." }],
      stopReason: "end_turn",
      model: "claude-sonnet-4-6",
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    });

    const result = await answerApp({
      question: "What is a 990-PF?",
      history: [],
      orgId: "org-caller",
      userId: "user-1",
    });

    expect(callClaudeWithTools).toHaveBeenCalledTimes(1);
    expect(result.toolsUsed).toEqual([]);
    expect(result.answer).toBe("Here is your answer.");
  });
});
