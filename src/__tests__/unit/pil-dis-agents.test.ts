// Unit tests for the PIL-03 discovery agents (BEN-DIS-01..05). Everything is
// mocked -- no real DB calls or network calls, matching every other
// src/__tests__/unit/* suite in this repo (see pil-sup-agents.test.ts for
// the same convention).
import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG_ID = "11111111-2222-3333-4444-555555555555";

vi.mock("@/lib/pil/db", () => ({ getPilClient: vi.fn() }));
vi.mock("@/lib/pil/evidence", () => ({ recordEvidence: vi.fn() }));
vi.mock("@/lib/pil/graph", () => ({ upsertNode: vi.fn(), upsertEdge: vi.fn() }));
vi.mock("@/lib/pil/tools", () => ({ getTool: vi.fn() }));

function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    agentCode: "BEN-DIS-01",
    orgId: ORG_ID,
    prospectId: null,
    runId: "run-1",
    goal: "Discover prospects in Austin, TX for education",
    plan: {},
    tools: ["web_search", "web_crawl", "news_search", "entity_lookup", "irs_990_lookup"],
    budget: 1000,
    depth: 1,
    ...overrides,
  };
}

function fakeRunner() {
  return { useTool: vi.fn().mockResolvedValue(undefined) } as unknown as import("@/lib/pil/agent-runner").AgentRunner;
}

/** Minimal pil_prospects find-then-create mock: findExistingProspect always misses, every insert succeeds and echoes the payload back with a fresh id. */
function makePilProspectsClient() {
  let counter = 0;
  const insertMock = vi.fn((payload: Record<string, unknown>) => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({
        data: { id: `prospect-${++counter}`, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...payload },
        error: null,
      }),
    })),
  }));
  const from = vi.fn((table: string) => {
    if (table !== "pil_prospects") throw new Error(`unexpected table ${table} -- this test only mocks pil_prospects`);
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })),
        })),
      })),
      insert: insertMock,
    };
  });
  return { client: { from }, insertMock };
}

describe("BEN-DIS-03 Foundation Discovery Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("creates a pil_prospect for each foundation_directory row returned by entity_lookup", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const { client, insertMock } = makePilProspectsClient();
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const matches = [
      { source: "foundation_directory", id: "fd-1", name: "Hill Country Trust", location: "Austin, TX", confidence: 0.9, ein: "11-1111111", ntee_code: "T30" },
      { source: "foundation_directory", id: "fd-2", name: "Capital Area Trust", location: "Austin, TX", confidence: 0.8, ein: "22-2222222", ntee_code: "T31" },
    ];

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "entity_lookup") {
        return { name: "entity_lookup", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", matches }, cost_usd: 0.0001 }) };
      }
      if (toolName === "irs_990_lookup") {
        return { name: "irs_990_lookup", description: "", execute: vi.fn().mockResolvedValue({ success: false, data: null, cost_usd: 0, error: "not found" }) };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(upsertNode).mockImplementation(async (node) => ({
      id: `node-${node.label}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...node,
    }));
    vi.mocked(upsertEdge).mockImplementation(async (edge) => ({
      id: `edge-${edge.source_node_id}-${edge.target_node_id}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...edge,
    }));
    vi.mocked(recordEvidence).mockImplementation(async (item) => ({ id: `ev-${Math.random()}`, ...item }));

    const { FoundationDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-03");
    const agent = new FoundationDiscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-03", goal: "Discover foundations in Austin, TX for education" });

    const result = await agent.execute(context as never, fakeRunner());

    expect(insertMock).toHaveBeenCalledTimes(matches.length);
    const insertedNames = insertMock.mock.calls.map((call) => (call[0] as { display_name: string }).display_name);
    expect(insertedNames).toEqual(matches.map((m) => m.name));

    const discoveries = result.conclusions.discoveries as Array<{ prospectId: string }>;
    expect(discoveries).toHaveLength(matches.length);
    expect(result.status).toBe("completed");
  });
});

describe("BEN-DIS-01 Individual Prospect Discovery Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("creates pil_evidence with claim_type='philanthropic_announcement' for each news result", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const { client } = makePilProspectsClient();
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const newsResults = [
      { title: "Jane Donor Gives $2M to Local Shelter", url: "https://news.test/a", publishedAt: "2026-01-01", source: "news.test" },
      { title: "Local Businessman Pledges Major Gift", url: "https://news.test/b", publishedAt: "2026-01-02", source: "news.test" },
    ];

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "news_search") {
        return { name: "news_search", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results: newsResults }, cost_usd: 0.005 }) };
      }
      if (toolName === "web_search") {
        return { name: "web_search", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results: [] }, cost_usd: 0.01 }) };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    const recorded: Array<{ claim_type: string }> = [];
    vi.mocked(recordEvidence).mockImplementation(async (item) => {
      recorded.push(item as { claim_type: string });
      return { id: `ev-${recorded.length}`, ...item };
    });

    const { IndividualProspectDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-01");
    const agent = new IndividualProspectDiscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-01", goal: "Discover individual prospects in Austin, TX for education" });

    const result = await agent.execute(context as never, fakeRunner());

    expect(recorded).toHaveLength(newsResults.length);
    for (const evidenceItem of recorded) {
      expect(evidenceItem.claim_type).toBe("philanthropic_announcement");
    }
    expect(result.status).toBe("completed");
    expect((result.conclusions.discoveredProspectIds as string[]).length).toBe(newsResults.length);
  });
});
