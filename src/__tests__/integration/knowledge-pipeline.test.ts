// AR-14.1: knowledge pipeline regression coverage.
//
// test-evidence/DATA_PIPELINE_AUDIT.md §1 established that
// ag-29-knowledge-indexer was not broken — its three source tables never
// carried the two fields (`programs`, `enrichment.mission`)
// flattenFoundationText() looked for, so every one of its ~64,000 lifetime
// runs found 0 indexable rows and still reported status='completed'.
// REMEDIATION_PLAN.md's RC-1 fix has two parts, both covered here against a
// fully mocked Supabase client (not the live project): this agent's
// loadPendingBatch() scans ALL pending rows platform-wide with no
// organization_id scoping — foundation_directory alone has 133,812 real
// production rows with embedding IS NULL, so running the real agent against
// the live database from a test would pick up and actually embed arbitrary
// production rows. Mirrors the existing regression test's own convention
// (src/__tests__/unit/knowledge-indexer-agent.test.ts) for the same reason.
//
// Checkpoints (per the AR-14.1 task brief):
//  1. Content entering a source table becomes indexable work — a
//     foundation_directory row with only `enrichment.propublica` populated
//     (the real, universally-populated shape; `programs`/`enrichment.mission`
//     are never written by any producer) is now found and embedded.
//  2. An empty pass records something other than a plain 'completed' success
//     — status='skipped' (migration 199), not 'completed'.
//  3. The indexer still processes real work when it exists — a regression
//     guard against the producer/consumer changes above breaking the
//     already-working intelligence_proposal_sections path.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/intelligence/embeddings", () => ({
  generateEmbeddingsBatch: vi.fn(),
  chunkText: (text: string) => [text],
}));

import { generateEmbeddingsBatch } from "@/lib/intelligence/embeddings";
import { KnowledgeIndexerAgent } from "@/lib/agents/knowledge-indexer-agent";

type Row = Record<string, unknown>;
type Call = { table: string; method: "insert" | "update"; payload: unknown };

interface FakeState {
  organizations: Row | null;
  intelligenceSections: Row[];
  outcomesPending: Row[];
  foundationPending: Row[];
  /** Feeds maybeRunPatternAggregation()'s own agent_runs lookback query.
   * Set to a recent run already carrying ranPatternAggregation=true so
   * aggregation is never "due" in these tests — keeps every test focused on
   * the embedding pass itself, not the (separately-tested-elsewhere)
   * aggregation path. */
  recentAgentRuns: Row[];
}

function notDueAggregationState(): Row[] {
  return [{ completed_at: new Date().toISOString(), output_payload: { ranPatternAggregation: true } }];
}

function makeClient(state: FakeState, calls: Call[]) {
  const chain = (table: string) => {
    let op: "select" | "insert" | "update" = "select";
    const c: Record<string, unknown> = {
      select: vi.fn(() => {
        op = "select";
        return c;
      }),
      insert: vi.fn((payload: unknown) => {
        op = "insert";
        calls.push({ table, method: "insert", payload });
        return c;
      }),
      update: vi.fn((payload: unknown) => {
        op = "update";
        calls.push({ table, method: "update", payload });
        return c;
      }),
      eq: vi.fn(() => c),
      is: vi.fn(() => c),
      not: vi.fn(() => c),
      order: vi.fn(() => c),
      limit: vi.fn(() => c),
      maybeSingle: vi.fn(() => {
        if (table === "organizations") return Promise.resolve({ data: state.organizations, error: null });
        return Promise.resolve({ data: null, error: null });
      }),
      single: vi.fn(() => Promise.resolve({ data: { id: "run-1" }, error: null })),
      then: (resolve: (v: unknown) => void) => {
        if (op === "update" || op === "insert") {
          return Promise.resolve({ data: null, error: null }).then(resolve);
        }
        if (table === "intelligence_proposal_sections") {
          return Promise.resolve({ data: state.intelligenceSections, error: null }).then(resolve);
        }
        if (table === "outcomes") {
          return Promise.resolve({ data: state.outcomesPending, error: null }).then(resolve);
        }
        if (table === "foundation_directory") {
          return Promise.resolve({ data: state.foundationPending, error: null }).then(resolve);
        }
        if (table === "agent_runs") {
          return Promise.resolve({ data: state.recentAgentRuns, error: null }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    };
    return c;
  };
  return { from: vi.fn((table: string) => chain(table)) };
}

function completionPatch(calls: Call[]): Record<string, unknown> {
  const update = calls.find((c) => c.table === "agent_runs" && c.method === "update");
  expect(update, "expected a completeRun()/failRun() update on agent_runs").toBeDefined();
  return update!.payload as Record<string, unknown>;
}

describe("Knowledge pipeline (AR-14.1)", () => {
  beforeEach(() => {
    vi.mocked(generateEmbeddingsBatch).mockReset();
    vi.mocked(generateEmbeddingsBatch).mockImplementation(async (texts: string[]) =>
      texts.map(() => [0.1, 0.2, 0.3]),
    );
  });

  it("1. a propublica-only foundation_directory row (the real, populated shape) becomes indexable work", async () => {
    const calls: Call[] = [];
    const state: FakeState = {
      organizations: { id: "system-org" },
      intelligenceSections: [],
      outcomesPending: [],
      foundationPending: [
        {
          id: "fd-1",
          programs: null, // never populated by any real producer (DATA_PIPELINE_AUDIT.md §1)
          enrichment: {
            propublica: {
              name: "Test Foundation",
              city: "Austin",
              state: "TX",
              ntee_code: "T20",
              subsection_code: 3,
              totrevenue: 50000,
              totassetsend: 200000,
              totfuncexpns: 40000,
            },
          },
        },
      ],
      recentAgentRuns: notDueAggregationState(),
    };
    const client = makeClient(state, calls);
    const agent = new KnowledgeIndexerAgent(client as never);

    const result = await agent.run("autonomous");

    expect(result.itemsFound).toBe(1);
    expect(result.itemsProcessed).toBe(1);
    expect(result.success).toBe(true);

    // The synthesized text is real content derived from the actually-populated
    // enrichment.propublica block, not a placeholder.
    expect(generateEmbeddingsBatch).toHaveBeenCalledTimes(1);
    const [texts] = vi.mocked(generateEmbeddingsBatch).mock.calls[0]!;
    expect(texts[0]).toContain("Test Foundation");
    expect(texts[0]).toContain("Austin, TX");

    const embedUpdate = calls.find((c) => c.table === "foundation_directory" && c.method === "update");
    expect(embedUpdate).toBeDefined();
    expect((embedUpdate!.payload as Row).embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("2. an empty pass (itemsFound=0) is recorded as status='skipped', not a plain 'completed' success", async () => {
    const calls: Call[] = [];
    const state: FakeState = {
      organizations: { id: "system-org" },
      intelligenceSections: [],
      outcomesPending: [],
      foundationPending: [],
      recentAgentRuns: notDueAggregationState(),
    };
    const client = makeClient(state, calls);
    const agent = new KnowledgeIndexerAgent(client as never);

    const result = await agent.run("autonomous");

    expect(result.itemsFound).toBe(0);
    expect(result.itemsProcessed).toBe(0);
    expect(generateEmbeddingsBatch).not.toHaveBeenCalled();

    const patch = completionPatch(calls);
    expect(patch.status).toBe("skipped");
    expect(patch.status).not.toBe("completed");
  });

  it("3. the indexer still processes real work from intelligence_proposal_sections when it exists", async () => {
    const calls: Call[] = [];
    const state: FakeState = {
      organizations: { id: "system-org" },
      intelligenceSections: [{ id: "sec-1", section_text: "Real proposal narrative content." }],
      outcomesPending: [],
      foundationPending: [],
      recentAgentRuns: notDueAggregationState(),
    };
    const client = makeClient(state, calls);
    const agent = new KnowledgeIndexerAgent(client as never);

    const result = await agent.run("autonomous");

    expect(result.itemsFound).toBe(1);
    expect(result.itemsProcessed).toBe(1);

    const embedUpdate = calls.find(
      (c) => c.table === "intelligence_proposal_sections" && c.method === "update",
    );
    expect(embedUpdate).toBeDefined();
    expect((embedUpdate!.payload as Row).embedding).toEqual([0.1, 0.2, 0.3]);

    const patch = completionPatch(calls);
    expect(patch.status).toBe("completed");
  });
});
