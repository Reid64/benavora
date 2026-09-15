// Regression test for the AG-29 silent-failure bug: when generateEmbeddingsBatch()
// throws for every row in a batch (e.g. missing/invalid OPENAI_API_KEY), the
// resulting agent_runs row must be status='failed' with a real error_message,
// not status='completed' with items_processed stuck at 0. See
// src/lib/agents/knowledge-indexer-agent.ts's run() and
// src/lib/agents/autonomous-base.ts's completeRun().
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/intelligence/embeddings", () => ({
  generateEmbeddingsBatch: vi.fn(),
  chunkText: (text: string) => [text],
}));

import { generateEmbeddingsBatch } from "@/lib/intelligence/embeddings";
import { KnowledgeIndexerAgent } from "@/lib/agents/knowledge-indexer-agent";

type Call = { table: string; method: "insert" | "update"; payload: unknown };

function makeClient(calls: Call[]) {
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      select: vi.fn(() => c),
      insert: vi.fn((payload: unknown) => {
        calls.push({ table, method: "insert", payload });
        return c;
      }),
      update: vi.fn((payload: unknown) => {
        calls.push({ table, method: "update", payload });
        return c;
      }),
      eq: vi.fn(() => c),
      is: vi.fn(() => c),
      not: vi.fn(() => c),
      order: vi.fn(() => c),
      limit: vi.fn(() => c),
      maybeSingle: vi.fn(() => {
        if (table === "organizations") return Promise.resolve({ data: { id: "system-org" }, error: null });
        if (table === "agent_queue") return Promise.resolve({ data: null, error: null });
        return Promise.resolve({ data: null, error: null });
      }),
      single: vi.fn(() =>
        Promise.resolve({ data: { id: "run-1" }, error: null }),
      ),
      then: (resolve: (v: unknown) => void) => {
        if (table === "intelligence_proposal_sections") {
          return Promise.resolve({
            data: [{ id: "sec-1", section_text: "some real text" }],
            error: null,
          }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    };
    return c;
  };
  return { from: vi.fn((table: string) => chain(table)) };
}

describe("KnowledgeIndexerAgent — batch-level embedding failure", () => {
  beforeEach(() => {
    vi.mocked(generateEmbeddingsBatch).mockReset();
  });

  it("marks agent_runs status='failed' with a real error_message when every embedding call throws", async () => {
    vi.mocked(generateEmbeddingsBatch).mockRejectedValue(
      new Error("Missing required env var: OPENAI_API_KEY"),
    );

    const calls: Call[] = [];
    const client = makeClient(calls);
    const agent = new KnowledgeIndexerAgent(client as never);

    const result = await agent.run("autonomous");

    expect(result.success).toBe(false);
    expect(result.itemsFound).toBe(1);
    expect(result.itemsProcessed).toBe(0);

    const completionUpdate = calls.find(
      (c) => c.table === "agent_runs" && c.method === "update",
    );
    expect(completionUpdate).toBeDefined();
    const patch = completionUpdate?.payload as Record<string, unknown>;
    expect(patch.status).toBe("failed");
    expect(typeof patch.error_message).toBe("string");
    expect((patch.error_message as string).length).toBeGreaterThan(0);
    expect((patch.error_message as string)).toContain("OPENAI_API_KEY");
  }, 15000);
});
