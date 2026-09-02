// Unit tests for the PIL-03 core prospect intelligence agents (BEN-INT-0N).
// Everything is mocked -- no real DB calls or network calls, matching every
// other src/__tests__/unit/pil-*.test.ts suite in this repo. int/shared.ts is
// imported for real (not mocked) since it is the module under test's own
// direct dependency, and mocking it would hide regressions in the shared
// helpers this suite covers.
import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG_ID = "11111111-2222-3333-4444-555555555555";

vi.mock("@/lib/pil/db", () => ({ getPilClient: vi.fn() }));
vi.mock("@/lib/pil/evidence", () => ({ recordEvidence: vi.fn(), getEvidence: vi.fn() }));
vi.mock("@/lib/pil/graph", () => ({
  upsertNode: vi.fn(),
  upsertEdge: vi.fn(),
  getNodesByProspect: vi.fn(),
  getEdges: vi.fn(),
  traverseGraph: vi.fn(),
}));
vi.mock("@/lib/pil/tools", () => ({ getTool: vi.fn() }));
vi.mock("@/lib/pil/human-review", () => ({ createReviewItem: vi.fn() }));
vi.mock("@/lib/pil/audit", () => ({ logAction: vi.fn() }));

function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    agentCode: "BEN-INT-01",
    orgId: ORG_ID,
    prospectId: "prospect-1",
    runId: "run-1",
    goal: "Deepen the dossier for prospect-1",
    plan: {},
    tools: ["web_search", "web_crawl", "news_search"],
    budget: 1000,
    depth: 1,
    ...overrides,
  };
}

function fakeRunner() {
  return { useTool: vi.fn().mockResolvedValue(undefined) } as unknown as import("@/lib/pil/agent-runner").AgentRunner;
}

const PROSPECT = {
  id: "prospect-1",
  organization_id: ORG_ID,
  entity_type: "individual",
  display_name: "Jane Prospect",
  canonical_name: "jane prospect",
  status: "active",
  merged_into_prospect_id: null,
  source_of_record: "discovery",
  created_by_agent_id: "BEN-DIS-01",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

/** pil_prospects select-by-id client mock used by getProspectById (int/shared.ts). */
function makeProspectClient(prospect: Record<string, unknown> | null) {
  const from = vi.fn((table: string) => {
    if (table !== "pil_prospects") throw new Error(`unexpected table ${table} -- this test only mocks pil_prospects`);
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: prospect, error: null }) })),
        })),
      })),
    };
  });
  return { from };
}

describe("BEN-INT-01 Individual Intelligence Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("still records biographical evidence from web_search + web_crawl + news_search unchanged", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode } = await import("@/lib/pil/graph");
    const { recordEvidence, getEvidence } = await import("@/lib/pil/evidence");
    const { getEdges } = await import("@/lib/pil/graph");

    const { from } = makeProspectClient(PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search") {
        return {
          name: "web_search",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { query: "x", results: [{ title: "Jane Prospect - About", url: "https://profile.test/jane" }] },
            cost_usd: 0.01,
          }),
        };
      }
      if (toolName === "web_crawl") {
        return {
          name: "web_crawl",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { text: "Jane Prospect is a longtime resident of Austin, TX and works in finance.", title: "Jane Prospect - About" },
            cost_usd: 0.001,
          }),
        };
      }
      if (toolName === "news_search") {
        return {
          name: "news_search",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: {
              query: "x",
              results: [{ title: "Jane Prospect honored locally", url: "https://news.test/a", publishedAt: "2026-01-01", source: "news.test" }],
            },
            cost_usd: 0.005,
          }),
        };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(upsertNode).mockImplementation(async (node) => ({
      id: "node-jane",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...node,
    }));
    const recorded: Array<{ claim_type: string; claim: string }> = [];
    vi.mocked(recordEvidence).mockImplementation(async (item) => {
      recorded.push(item as { claim_type: string; claim: string });
      return { id: `ev-${recorded.length}`, ...item } as never;
    });
    vi.mocked(getEvidence).mockResolvedValue([]);
    vi.mocked(getEdges).mockResolvedValue([]);

    const { IndividualIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-01");
    const agent = new IndividualIntelligenceAgent();
    const result = await agent.execute(baseContext() as never, fakeRunner());

    expect(result.status).toBe("completed");
    // Verified-name + location + professional-summary from the crawl, plus one news mention.
    expect(recorded.length).toBeGreaterThanOrEqual(3);
    expect(recorded.every((r) => r.claim_type === "biographical")).toBe(true);
    expect(recorded.some((r) => /^Verified name/.test(r.claim))).toBe(true);
    expect(recorded.some((r) => /^News mention:/.test(r.claim))).toBe(true);
  });

  it("delegates to BEN-KNW-02 for identity ambiguity when zero evidence exists this run and persisted, and caps fan-out at MAX_DELEGATIONS_PER_RUN", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, getEdges } = await import("@/lib/pil/graph");
    const { getEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeProspectClient(PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    // No search results at all -- no evidence gets created this run.
    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search" || toolName === "news_search") {
        return { name: toolName, description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results: [] }, cost_usd: 0.01 }) };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(upsertNode).mockImplementation(async (node) => ({
      id: "node-jane",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...node,
    }));
    // Zero persisted evidence and zero graph edges -- every dimension is a gap.
    vi.mocked(getEvidence).mockResolvedValue([]);
    vi.mocked(getEdges).mockResolvedValue([]);

    const { IndividualIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-01");
    const { MAX_DELEGATIONS_PER_RUN } = await import("@/lib/pil/agents/int/shared");
    const agent = new IndividualIntelligenceAgent();
    const result = await agent.execute(baseContext() as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(result.delegations.find((d) => d.childAgentCode === "BEN-KNW-02")).toBeDefined();
    expect(result.delegations.length).toBeLessThanOrEqual(MAX_DELEGATIONS_PER_RUN);

    const report = (result.conclusions as { report: { dimensionCoverage: Record<string, boolean>; delegationsIssued: string[] } }).report;
    expect(Object.values(report.dimensionCoverage).every((v) => v === false)).toBe(true);
    expect(report.delegationsIssued).toEqual(result.delegations.map((d) => d.childAgentCode));
  });
});

describe("BEN-INT-02 Employment and Career Intelligence Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("still records employment evidence + employed_by edges from web_search + web_crawl unchanged", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge, getEdges } = await import("@/lib/pil/graph");
    const { recordEvidence, getEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeProspectClient(PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    let webSearchCallCount = 0;
    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search") {
        webSearchCallCount += 1;
        const isFirstCall = webSearchCallCount === 1;
        return {
          name: "web_search",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: {
              query: "x",
              results: isFirstCall
                ? [{ title: "CEO at Acme Corp", url: "https://profile.test/current" }]
                : [{ title: "Former VP at Beta Inc", url: "https://profile.test/former" }],
            },
            cost_usd: 0.01,
          }),
        };
      }
      if (toolName === "web_crawl") {
        return {
          name: "web_crawl",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { text: "Jane Prospect serves in this role, overseeing operations." },
            cost_usd: 0.001,
          }),
        };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(upsertNode).mockImplementation(async (node) => ({
      id: `node-${node.label}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...node,
    }));
    const recorded: Array<{ claim_type: string; confidence: number }> = [];
    vi.mocked(recordEvidence).mockImplementation(async (item) => {
      recorded.push(item as { claim_type: string; confidence: number });
      return { id: `ev-${recorded.length}`, ...item } as never;
    });
    const edgesRecorded: Array<{ relationship_strength: string | null }> = [];
    vi.mocked(upsertEdge).mockImplementation(async (edge) => {
      edgesRecorded.push(edge as { relationship_strength: string | null });
      return { id: `edge-${edgesRecorded.length}`, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...edge } as never;
    });
    vi.mocked(getEvidence).mockResolvedValue([]);
    vi.mocked(getEdges).mockResolvedValue([]);

    const { EmploymentCareerIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-02");
    const agent = new EmploymentCareerIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-02" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(recorded.length).toBe(2);
    expect(recorded.every((r) => r.claim_type === "employment")).toBe(true);
    expect(recorded[0]?.confidence).toBe(0.5);
    expect(recorded[1]?.confidence).toBe(0.35);
    expect(edgesRecorded.map((e) => e.relationship_strength)).toEqual(["strong", "moderate"]);
  });

  it("delegates to BEN-KNW-02 for identity ambiguity when no employment record is found this run, and caps fan-out at MAX_DELEGATIONS_PER_RUN", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, getEdges } = await import("@/lib/pil/graph");
    const { getEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeProspectClient(PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    // No search results at all -- no employment records, no evidence created this run.
    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search") {
        return { name: toolName, description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results: [] }, cost_usd: 0.01 }) };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(upsertNode).mockImplementation(async (node) => ({
      id: "node-jane",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...node,
    }));
    vi.mocked(getEvidence).mockResolvedValue([]);
    vi.mocked(getEdges).mockResolvedValue([]);

    const { EmploymentCareerIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-02");
    const { MAX_DELEGATIONS_PER_RUN } = await import("@/lib/pil/agents/int/shared");
    const agent = new EmploymentCareerIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-02" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(result.delegations.find((d) => d.childAgentCode === "BEN-KNW-02")).toBeDefined();
    expect(result.delegations.length).toBeLessThanOrEqual(MAX_DELEGATIONS_PER_RUN);

    const report = (result.conclusions as { report: { dimensionCoverage: Record<string, boolean>; delegationsIssued: string[]; employmentRecordsFound: number } }).report;
    expect(report.employmentRecordsFound).toBe(0);
    expect(Object.values(report.dimensionCoverage).every((v) => v === false)).toBe(true);
    expect(report.delegationsIssued).toEqual(result.delegations.map((d) => d.childAgentCode));
  });
});

describe("BEN-INT-03 Business Ownership Intelligence Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("still records ownership evidence + owns edges from the general and EDGAR-scoped web_search calls unchanged", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge, getEdges } = await import("@/lib/pil/graph");
    const { recordEvidence, getEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeProspectClient(PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    let webSearchCallCount = 0;
    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search") {
        webSearchCallCount += 1;
        const isFirstCall = webSearchCallCount === 1;
        return {
          name: "web_search",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: {
              query: "x",
              results: isFirstCall
                ? [{ title: "Jane Prospect, Founder of Acme Corp", url: "https://profile.test/founder" }]
                : [{ title: "Jane Prospect Schedule 13D filing", url: "https://sec.test/13d" }],
            },
            cost_usd: 0.01,
          }),
        };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(upsertNode).mockImplementation(async (node) => ({
      id: `node-${node.label}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...node,
    }));
    const recorded: Array<{ claim_type: string; confidence: number; verification_status: string; source_type: string }> = [];
    vi.mocked(recordEvidence).mockImplementation(async (item) => {
      recorded.push(item as never);
      return { id: `ev-${recorded.length}`, ...item } as never;
    });
    const edgesRecorded: Array<{ relationship_strength: string | null; edge_type: string }> = [];
    vi.mocked(upsertEdge).mockImplementation(async (edge) => {
      edgesRecorded.push(edge as never);
      return { id: `edge-${edgesRecorded.length}`, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...edge } as never;
    });
    vi.mocked(getEvidence).mockResolvedValue([]);
    vi.mocked(getEdges).mockResolvedValue([]);

    const { BusinessOwnershipIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-03");
    const agent = new BusinessOwnershipIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-03" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(recorded.length).toBe(2);
    expect(recorded.every((r) => r.claim_type === "business_ownership")).toBe(true);
    expect(recorded.every((r) => r.verification_status === "reasoned_inference")).toBe(true);
    expect(recorded[0]?.confidence).toBe(0.35);
    expect(recorded[1]?.confidence).toBe(0.5);
    expect(edgesRecorded.map((e) => e.relationship_strength)).toEqual(["moderate", "strong"]);
    expect(edgesRecorded.every((e) => e.edge_type === "owns")).toBe(true);
  });

  it("completes the BEN-INT-03/08/09 triangle when an EDGAR mention is found, and caps fan-out at MAX_DELEGATIONS_PER_RUN", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge, getEdges } = await import("@/lib/pil/graph");
    const { recordEvidence, getEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeProspectClient(PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    // Only the EDGAR-scoped search returns a hit -- one EDGAR mention.
    let webSearchCallCount = 0;
    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search") {
        webSearchCallCount += 1;
        const isFirstCall = webSearchCallCount === 1;
        return {
          name: "web_search",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: {
              query: "x",
              results: isFirstCall ? [] : [{ title: "Jane Prospect Form 4 filing", url: "https://sec.test/form4" }],
            },
            cost_usd: 0.01,
          }),
        };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(upsertNode).mockImplementation(async (node) => ({
      id: "node-jane",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...node,
    }));
    vi.mocked(recordEvidence).mockImplementation(async (item) => ({ id: "ev-1", ...item }) as never);
    vi.mocked(upsertEdge).mockImplementation(async (edge) => ({ id: "edge-1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...edge }) as never);
    vi.mocked(getEvidence).mockResolvedValue([]);
    vi.mocked(getEdges).mockResolvedValue([]);

    const { BusinessOwnershipIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-03");
    const { MAX_DELEGATIONS_PER_RUN } = await import("@/lib/pil/agents/int/shared");
    const agent = new BusinessOwnershipIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-03" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(result.delegations.length).toBeLessThanOrEqual(MAX_DELEGATIONS_PER_RUN);
    expect(result.delegations.map((d) => d.childAgentCode)).toEqual(["BEN-INT-09", "BEN-INT-08", "BEN-KNW-03"]);
    expect(result.delegations.find((d) => d.childAgentCode === "BEN-KNW-02")).toBeUndefined();

    const report = (result.conclusions as { report: { dimensionCoverage: Record<string, boolean>; delegationsIssued: string[]; ownershipMentionsFound: number } }).report;
    expect(report.ownershipMentionsFound).toBe(1);
    expect(report.delegationsIssued).toEqual(result.delegations.map((d) => d.childAgentCode));
  });
});

describe("BEN-INT-04 Education and Alumni Intelligence Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("still records education evidence + alumnus_of edges from web_search + web_crawl unchanged", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge, getEdges } = await import("@/lib/pil/graph");
    const { recordEvidence, getEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeProspectClient(PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search") {
        return {
          name: "web_search",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { query: "x", results: [{ title: "State University", url: "https://profile.test/edu" }] },
            cost_usd: 0.01,
          }),
        };
      }
      if (toolName === "web_crawl") {
        return {
          name: "web_crawl",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { text: "Jane Prospect earned a B.A. from State University in 2001." },
            cost_usd: 0.001,
          }),
        };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(upsertNode).mockImplementation(async (node) => ({
      id: `node-${node.label}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...node,
    }));
    const recorded: Array<{ claim_type: string; value: unknown }> = [];
    vi.mocked(recordEvidence).mockImplementation(async (item) => {
      recorded.push(item as never);
      return { id: `ev-${recorded.length}`, ...item } as never;
    });
    const edgesRecorded: Array<{ properties: unknown }> = [];
    vi.mocked(upsertEdge).mockImplementation(async (edge) => {
      edgesRecorded.push(edge as never);
      return { id: `edge-${edgesRecorded.length}`, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...edge } as never;
    });
    vi.mocked(getEvidence).mockResolvedValue([]);
    vi.mocked(getEdges).mockResolvedValue([]);

    const { EducationAlumniIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-04");
    const agent = new EducationAlumniIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-04" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(recorded.length).toBe(1);
    expect(recorded[0]?.claim_type).toBe("education");
    expect((recorded[0]?.value as { degree: string | null; graduationYear: string | null }).degree).toMatch(/B\.?A\.?/i);
    expect((recorded[0]?.value as { degree: string | null; graduationYear: string | null }).graduationYear).toBe("2001");
    expect(edgesRecorded.length).toBe(1);
    expect((edgesRecorded[0]?.properties as { relationship: string }).relationship).toBe("alumnus_of");
  });

  it("delegates to BEN-REL-04 for institutional overlap when a mention is found, and to BEN-KNW-03 for evidence verification, capped at MAX_DELEGATIONS_PER_RUN", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge, getEdges } = await import("@/lib/pil/graph");
    const { recordEvidence, getEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeProspectClient(PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search") {
        return {
          name: "web_search",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { query: "x", results: [{ title: "State University", url: "https://profile.test/edu" }] },
            cost_usd: 0.01,
          }),
        };
      }
      if (toolName === "web_crawl") {
        return {
          name: "web_crawl",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { text: "No degree info in this crawl." },
            cost_usd: 0.001,
          }),
        };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(upsertNode).mockImplementation(async (node) => ({
      id: `node-${node.label}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...node,
    }));
    vi.mocked(recordEvidence).mockImplementation(async (item) => ({ id: "ev-1", ...item }) as never);
    vi.mocked(upsertEdge).mockImplementation(async (edge) => ({ id: "edge-1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...edge }) as never);
    // Zero persisted evidence -- every dimension besides the ones this run itself satisfies is a gap.
    vi.mocked(getEvidence).mockResolvedValue([]);
    vi.mocked(getEdges).mockResolvedValue([]);

    const { EducationAlumniIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-04");
    const { MAX_DELEGATIONS_PER_RUN } = await import("@/lib/pil/agents/int/shared");
    const agent = new EducationAlumniIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-04" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(result.delegations.length).toBeLessThanOrEqual(MAX_DELEGATIONS_PER_RUN);
    expect(result.delegations.map((d) => d.childAgentCode)).toEqual(["BEN-REL-04", "BEN-KNW-03"]);
    expect(result.delegations.find((d) => d.childAgentCode === "BEN-KNW-02")).toBeUndefined();

    const report = (result.conclusions as { report: { dimensionCoverage: Record<string, boolean>; delegationsIssued: string[]; educationMentionsFound: number } }).report;
    expect(report.educationMentionsFound).toBe(1);
    expect(report.delegationsIssued).toEqual(result.delegations.map((d) => d.childAgentCode));
  });
});

describe("BEN-INT-05 Nonprofit Board Intelligence Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("still records board evidence + serves_on_board_of edges via entity_lookup/irs_990_lookup unchanged", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence, getEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeProspectClient(PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search") {
        return {
          name: "web_search",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { query: "x", results: [{ title: "Acme Foundation", url: "https://profile.test/board" }] },
            cost_usd: 0.01,
          }),
        };
      }
      if (toolName === "entity_lookup") {
        return {
          name: "entity_lookup",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { matches: [{ source: "foundation_directory", ein: "12-3456789", confidence: 0.9 }] },
            cost_usd: 0.01,
          }),
        };
      }
      if (toolName === "irs_990_lookup") {
        return {
          name: "irs_990_lookup",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { officers: [{ name: "Jane Prospect" }], filing_year: 2024 },
            cost_usd: 0.02,
          }),
        };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(upsertNode).mockImplementation(async (node) => ({
      id: `node-${node.label}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...node,
    }));
    const recorded: Array<{ claim_type: string; source_type: string; confidence: number; verification_status: string }> = [];
    vi.mocked(recordEvidence).mockImplementation(async (item) => {
      recorded.push(item as never);
      return { id: `ev-${recorded.length}`, ...item } as never;
    });
    const edgesRecorded: Array<{ edge_type: string; relationship_strength: string | null }> = [];
    vi.mocked(upsertEdge).mockImplementation(async (edge) => {
      edgesRecorded.push(edge as never);
      return { id: `edge-${edgesRecorded.length}`, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...edge } as never;
    });
    vi.mocked(getEvidence).mockResolvedValue([]);

    const { NonprofitBoardIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-05");
    const agent = new NonprofitBoardIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-05" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(recorded.length).toBe(1);
    expect(recorded[0]?.claim_type).toBe("nonprofit_board");
    expect(recorded[0]?.source_type).toBe("irs_form_990");
    expect(recorded[0]?.confidence).toBe(0.85);
    expect(recorded[0]?.verification_status).toBe("corroborated_fact");
    expect(edgesRecorded.length).toBe(1);
    expect(edgesRecorded[0]?.edge_type).toBe("serves_on_board_of");
    expect(edgesRecorded[0]?.relationship_strength).toBe("strong");
  });

  it("delegates to BEN-REL-02 for a 990-corroborated board seat and to BEN-INT-07 for the giving-history gap, capped at MAX_DELEGATIONS_PER_RUN", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence, getEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeProspectClient(PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search") {
        return {
          name: "web_search",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { query: "x", results: [{ title: "Acme Foundation", url: "https://profile.test/board" }] },
            cost_usd: 0.01,
          }),
        };
      }
      if (toolName === "entity_lookup") {
        return {
          name: "entity_lookup",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { matches: [{ source: "foundation_directory", ein: "12-3456789", confidence: 0.9 }] },
            cost_usd: 0.01,
          }),
        };
      }
      if (toolName === "irs_990_lookup") {
        return {
          name: "irs_990_lookup",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { officers: [{ name: "Jane Prospect" }], filing_year: 2024 },
            cost_usd: 0.02,
          }),
        };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(upsertNode).mockImplementation(async (node) => ({
      id: `node-${node.label}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...node,
    }));
    vi.mocked(recordEvidence).mockImplementation(async (item) => ({ id: "ev-1", ...item }) as never);
    vi.mocked(upsertEdge).mockImplementation(async (edge) => ({ id: "edge-1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...edge }) as never);
    // Zero persisted evidence -- no giving_history on file, so that gap fires too.
    vi.mocked(getEvidence).mockResolvedValue([]);

    const { NonprofitBoardIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-05");
    const { MAX_DELEGATIONS_PER_RUN } = await import("@/lib/pil/agents/int/shared");
    const agent = new NonprofitBoardIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-05" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(result.delegations.length).toBeLessThanOrEqual(MAX_DELEGATIONS_PER_RUN);
    expect(result.delegations.map((d) => d.childAgentCode)).toEqual(["BEN-REL-02", "BEN-INT-07", "BEN-KNW-03"]);
    expect(result.delegations.find((d) => d.childAgentCode === "BEN-KNW-02")).toBeUndefined();

    const report = (result.conclusions as { report: { dimensionCoverage: Record<string, boolean>; delegationsIssued: string[]; boardMentionsFound: number } }).report;
    expect(report.boardMentionsFound).toBe(1);
    expect(report.dimensionCoverage["Fiduciary/Advisory/Honorary Distinction"]).toBe(false);
    expect(report.delegationsIssued).toEqual(result.delegations.map((d) => d.childAgentCode));
  });
});

const FOUNDATION_PROSPECT = {
  ...PROSPECT,
  entity_type: "private_foundation",
  display_name: "Acme Family Foundation",
  canonical_name: "acme family foundation",
};

describe("BEN-INT-06 Foundation Intelligence Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("still records foundation_financials/mission/officers evidence + trustee_of edges via entity_lookup/irs_990_lookup, plus application_procedures via web_search/web_crawl, unchanged", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence, getEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeProspectClient(FOUNDATION_PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "entity_lookup") {
        return {
          name: "entity_lookup",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { matches: [{ source: "foundation_directory", ein: "12-3456789" }] },
            cost_usd: 0.01,
          }),
        };
      }
      if (toolName === "irs_990_lookup") {
        return {
          name: "irs_990_lookup",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: {
              total_assets: 5_000_000,
              total_grants_paid: 250_000,
              mission: "Support local education initiatives.",
              officers: [{ name: "Jane Trustee", title: "President", compensation: null }],
              filing_year: 2024,
              address: { city: "Austin", state: "TX" },
            },
            cost_usd: 0.02,
          }),
        };
      }
      if (toolName === "web_search") {
        return {
          name: "web_search",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { query: "x", results: [{ title: "How to Apply", url: "https://acmefoundation.test/apply" }] },
            cost_usd: 0.01,
          }),
        };
      }
      if (toolName === "web_crawl") {
        return {
          name: "web_crawl",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { text: "Applications are accepted quarterly via our online portal." },
            cost_usd: 0.001,
          }),
        };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(upsertNode).mockImplementation(async (node) => ({
      id: `node-${node.label}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...node,
    }));
    const recorded: Array<{ claim_type: string; confidence: number; source_type: string }> = [];
    vi.mocked(recordEvidence).mockImplementation(async (item) => {
      recorded.push(item as never);
      return { id: `ev-${recorded.length}`, ...item } as never;
    });
    const edgesRecorded: Array<{ edge_type: string; relationship_strength: string | null }> = [];
    vi.mocked(upsertEdge).mockImplementation(async (edge) => {
      edgesRecorded.push(edge as never);
      return { id: `edge-${edgesRecorded.length}`, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...edge } as never;
    });
    vi.mocked(getEvidence).mockResolvedValue([]);

    const { FoundationIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-06");
    const agent = new FoundationIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-06" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(recorded.length).toBe(4);
    expect(recorded.map((r) => r.claim_type)).toEqual([
      "foundation_financials",
      "foundation_mission_priorities",
      "foundation_officers",
      "foundation_application_procedures",
    ]);
    expect(recorded.every((r) => r.claim_type === "foundation_application_procedures" || r.source_type === "irs_form_990")).toBe(true);
    expect(edgesRecorded.length).toBe(1);
    expect(edgesRecorded[0]?.edge_type).toBe("trustee_of");
    expect(edgesRecorded[0]?.relationship_strength).toBe("strong");
  });

  it("delegates to BEN-INT-07/BEN-REL-02/BEN-QLF-02 when ein resolves + officers + application evidence are found, capped at MAX_DELEGATIONS_PER_RUN ahead of BEN-KNW-03", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence, getEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeProspectClient(FOUNDATION_PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "entity_lookup") {
        return {
          name: "entity_lookup",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { matches: [{ source: "foundation_directory", ein: "12-3456789" }] },
            cost_usd: 0.01,
          }),
        };
      }
      if (toolName === "irs_990_lookup") {
        return {
          name: "irs_990_lookup",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: {
              total_assets: 5_000_000,
              total_grants_paid: 250_000,
              mission: null,
              officers: [{ name: "Jane Trustee", title: "President", compensation: null }],
              filing_year: 2024,
              address: { city: "Austin", state: "TX" },
            },
            cost_usd: 0.02,
          }),
        };
      }
      if (toolName === "web_search") {
        return {
          name: "web_search",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { query: "x", results: [{ title: "How to Apply", url: "https://acmefoundation.test/apply" }] },
            cost_usd: 0.01,
          }),
        };
      }
      if (toolName === "web_crawl") {
        return {
          name: "web_crawl",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { text: "Applications are accepted quarterly via our online portal." },
            cost_usd: 0.001,
          }),
        };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(upsertNode).mockImplementation(async (node) => ({
      id: `node-${node.label}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...node,
    }));
    vi.mocked(recordEvidence).mockImplementation(async (item) => ({ id: "ev-1", ...item }) as never);
    vi.mocked(upsertEdge).mockImplementation(async (edge) => ({ id: "edge-1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...edge }) as never);
    // Zero persisted evidence -- every dimension besides what this run itself satisfies is a gap.
    vi.mocked(getEvidence).mockResolvedValue([]);

    const { FoundationIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-06");
    const { MAX_DELEGATIONS_PER_RUN } = await import("@/lib/pil/agents/int/shared");
    const agent = new FoundationIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-06" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(result.delegations.length).toBeLessThanOrEqual(MAX_DELEGATIONS_PER_RUN);
    expect(result.delegations.map((d) => d.childAgentCode)).toEqual(["BEN-INT-07", "BEN-REL-02", "BEN-QLF-02"]);
    expect(result.delegations.find((d) => d.childAgentCode === "BEN-KNW-02")).toBeUndefined();
    expect(result.delegations.find((d) => d.childAgentCode === "BEN-KNW-03")).toBeUndefined();

    const report = (result.conclusions as { report: { ein: string | null; dimensionCoverage: Record<string, boolean>; delegationsIssued: string[] } }).report;
    expect(report.ein).toBe("12-3456789");
    expect(report.dimensionCoverage["Foundation Type"]).toBe(true);
    expect(report.dimensionCoverage["Foundation Legal Identity"]).toBe(false);
    expect(report.delegationsIssued).toEqual(result.delegations.map((d) => d.childAgentCode));
  });

  it("delegates only to BEN-KNW-02 when no EIN resolves", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode } = await import("@/lib/pil/graph");
    const { getEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeProspectClient(FOUNDATION_PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "entity_lookup") {
        return { name: toolName, description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { matches: [] }, cost_usd: 0.01 }) };
      }
      if (toolName === "web_search") {
        return { name: toolName, description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results: [] }, cost_usd: 0.01 }) };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(upsertNode).mockImplementation(async (node) => ({
      id: "node-acme",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...node,
    }));
    vi.mocked(getEvidence).mockResolvedValue([]);

    const { FoundationIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-06");
    const { MAX_DELEGATIONS_PER_RUN } = await import("@/lib/pil/agents/int/shared");
    const agent = new FoundationIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-06" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(result.delegations.length).toBeLessThanOrEqual(MAX_DELEGATIONS_PER_RUN);
    expect(result.delegations.map((d) => d.childAgentCode)).toEqual(["BEN-KNW-02"]);
  });

  it("skips entirely (no evidence, no delegations) for a non-foundation entity_type", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { from } = makeProspectClient(PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    const { FoundationIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-06");
    const agent = new FoundationIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-06" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(result.evidence).toEqual([]);
    expect(result.delegations).toEqual([]);
    expect((result.conclusions as { skipped?: boolean }).skipped).toBe(true);
  });
});

describe("BEN-INT-07 Giving History Intelligence Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("still records giving-history evidence from web_search + news_search mentions, plus 990 grants-paid via trustee_of edges, unchanged", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { getNodesByProspect, getEdges } = await import("@/lib/pil/graph");
    const { recordEvidence, getEvidence } = await import("@/lib/pil/evidence");

    const { from: prospectFrom } = makeProspectClient(PROSPECT);
    const graphNodeRow = {
      id: "node-foundation",
      organization_id: ORG_ID,
      node_type: "foundation",
      prospect_id: null,
      label: "Acme Family Foundation",
      properties: { ein: "12-3456789" },
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const from = vi.fn((table: string) => {
      if (table === "pil_prospects") return prospectFrom(table);
      if (table === "pil_graph_nodes") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: graphNodeRow, error: null }) })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search") {
        return {
          name: "web_search",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { query: "x", results: [{ title: "Jane Prospect gave $1 million to Acme Nonprofit", url: "https://news.test/gift" }] },
            cost_usd: 0.01,
          }),
        };
      }
      if (toolName === "news_search") {
        return {
          name: "news_search",
          description: "",
          execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results: [] }, cost_usd: 0.01 }),
        };
      }
      if (toolName === "irs_990_lookup") {
        return {
          name: "irs_990_lookup",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { total_grants_paid: 250_000, filing_year: 2024 },
            cost_usd: 0.02,
          }),
        };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(getNodesByProspect).mockResolvedValue([
      { id: "node-jane", organization_id: ORG_ID, node_type: "person", prospect_id: "prospect-1", label: "Jane Prospect", properties: {}, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ] as never);
    vi.mocked(getEdges).mockResolvedValue([
      { id: "edge-1", organization_id: ORG_ID, source_node_id: "node-jane", target_node_id: "node-foundation", edge_type: "trustee_of", relationship_strength: "strong", properties: {}, is_current: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ] as never);
    const recorded: Array<{ claim_type: string; source_type: string; verification_status: string }> = [];
    vi.mocked(recordEvidence).mockImplementation(async (item) => {
      recorded.push(item as never);
      return { id: `ev-${recorded.length}`, ...item } as never;
    });
    vi.mocked(getEvidence).mockResolvedValue([]);

    const { GivingHistoryIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-07");
    const agent = new GivingHistoryIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-07" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(recorded.length).toBe(2);
    expect(recorded.every((r) => r.claim_type === "giving_history")).toBe(true);
    expect(recorded[0]?.verification_status).toBe("estimate");
    expect(recorded[1]?.source_type).toBe("irs_form_990");
    expect(recorded[1]?.verification_status).toBe("corroborated_fact");
  });

  it("delegates to BEN-INT-06/BEN-QLF-03/BEN-KNW-03 (capped at MAX_DELEGATIONS_PER_RUN, ahead of BEN-KNW-02) when a trustee foundation is found", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { getNodesByProspect, getEdges } = await import("@/lib/pil/graph");
    const { recordEvidence, getEvidence } = await import("@/lib/pil/evidence");

    const { from: prospectFrom } = makeProspectClient(PROSPECT);
    const graphNodeRow = {
      id: "node-foundation",
      organization_id: ORG_ID,
      node_type: "foundation",
      prospect_id: null,
      label: "Acme Family Foundation",
      properties: { ein: "12-3456789" },
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const from = vi.fn((table: string) => {
      if (table === "pil_prospects") return prospectFrom(table);
      if (table === "pil_graph_nodes") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: graphNodeRow, error: null }) })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    // No web/news mentions -- the only signal is the trustee_of edge + 990 lookup.
    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search" || toolName === "news_search") {
        return { name: toolName, description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results: [] }, cost_usd: 0.01 }) };
      }
      if (toolName === "irs_990_lookup") {
        return {
          name: "irs_990_lookup",
          description: "",
          execute: vi.fn().mockResolvedValue({ success: true, data: { total_grants_paid: 250_000, filing_year: 2024 }, cost_usd: 0.02 }),
        };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(getNodesByProspect).mockResolvedValue([
      { id: "node-jane", organization_id: ORG_ID, node_type: "person", prospect_id: "prospect-1", label: "Jane Prospect", properties: {}, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ] as never);
    vi.mocked(getEdges).mockResolvedValue([
      { id: "edge-1", organization_id: ORG_ID, source_node_id: "node-jane", target_node_id: "node-foundation", edge_type: "trustee_of", relationship_strength: "strong", properties: {}, is_current: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ] as never);
    vi.mocked(recordEvidence).mockImplementation(async (item) => ({ id: "ev-1", ...item }) as never);
    // Zero persisted evidence besides what this run itself creates.
    vi.mocked(getEvidence).mockResolvedValue([]);

    const { GivingHistoryIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-07");
    const { MAX_DELEGATIONS_PER_RUN } = await import("@/lib/pil/agents/int/shared");
    const agent = new GivingHistoryIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-07" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(result.delegations.length).toBeLessThanOrEqual(MAX_DELEGATIONS_PER_RUN);
    expect(result.delegations.map((d) => d.childAgentCode)).toEqual(["BEN-INT-06", "BEN-QLF-03", "BEN-KNW-03"]);
    expect(result.delegations.find((d) => d.childAgentCode === "BEN-KNW-02")).toBeUndefined();

    const report = (result.conclusions as { report: { dimensionCoverage: Record<string, boolean>; delegationsIssued: string[]; givingMentionsFound: number } }).report;
    expect(report.givingMentionsFound).toBe(0);
    expect(report.delegationsIssued).toEqual(result.delegations.map((d) => d.childAgentCode));
  });

  it("delegates only to BEN-KNW-02 when there are zero mentions and zero trustee edges", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { getNodesByProspect, getEdges } = await import("@/lib/pil/graph");
    const { getEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeProspectClient(PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search" || toolName === "news_search") {
        return { name: toolName, description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results: [] }, cost_usd: 0.01 }) };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(getNodesByProspect).mockResolvedValue([]);
    vi.mocked(getEdges).mockResolvedValue([]);
    vi.mocked(getEvidence).mockResolvedValue([]);

    const { GivingHistoryIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-07");
    const agent = new GivingHistoryIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-07" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(result.delegations.map((d) => d.childAgentCode)).toEqual(["BEN-KNW-02"]);
    const report = (result.conclusions as { report: { dimensionCoverage: Record<string, boolean> } }).report;
    expect(Object.values(report.dimensionCoverage).every((v) => v === false)).toBe(true);
  });
});

describe("BEN-INT-08 Wealth and Capacity Intelligence Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("still records one wealth_capacity evidence item + escalates to human review when a wealth signal has no giving corroborant, unchanged", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { getNodesByProspect, getEdges } = await import("@/lib/pil/graph");
    const { recordEvidence, getEvidence } = await import("@/lib/pil/evidence");
    const { createReviewItem } = await import("@/lib/pil/human-review");

    const { from } = makeProspectClient(PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search") {
        return {
          name: "web_search",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { query: "x", results: [{ title: "Jane Prospect estate valued at $10 million", url: "https://news.test/estate" }] },
            cost_usd: 0.01,
          }),
        };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    // No 'owns' edges, no persisted giving_history/liquidity_event evidence.
    vi.mocked(getNodesByProspect).mockResolvedValue([
      { id: "node-jane", organization_id: ORG_ID, node_type: "person", prospect_id: "prospect-1", label: "Jane Prospect", properties: {}, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ] as never);
    vi.mocked(getEdges).mockResolvedValue([]);
    vi.mocked(getEvidence).mockResolvedValue([]);

    const recorded: Array<{ claim_type: string; verification_status: string; confidence: number }> = [];
    vi.mocked(recordEvidence).mockImplementation(async (item) => {
      recorded.push(item as never);
      return { id: `ev-${recorded.length}`, ...item } as never;
    });
    vi.mocked(createReviewItem).mockResolvedValue({ id: "review-1" } as never);

    const { WealthCapacityIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-08");
    const agent = new WealthCapacityIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-08" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(recorded.length).toBe(1);
    expect(recorded[0]?.claim_type).toBe("wealth_capacity");
    expect(recorded[0]?.verification_status).toBe("reasoned_inference");
    expect(vi.mocked(createReviewItem)).toHaveBeenCalledTimes(1);
    const report = (result.conclusions as { report: { escalatedForReview: boolean } }).report;
    expect(report.escalatedForReview).toBe(true);
  });

  it("checks BEN-INT-09's real liquidity_event output (no longer the stale 'unknown' stub), and delegates to BEN-INT-03/BEN-INT-09/BEN-QLF-03 capped at MAX_DELEGATIONS_PER_RUN ahead of BEN-KNW-03, never BEN-KNW-02", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { getNodesByProspect, getEdges } = await import("@/lib/pil/graph");
    const { recordEvidence, getEvidence } = await import("@/lib/pil/evidence");
    const { createReviewItem } = await import("@/lib/pil/human-review");

    const { from } = makeProspectClient(PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search") {
        return {
          name: "web_search",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { query: "x", results: [{ title: "Jane Prospect net worth estimated at $8 million", url: "https://news.test/networth" }] },
            cost_usd: 0.01,
          }),
        };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    // No 'owns' edge (ownership gap) but persisted giving_history AND
    // liquidity_event evidence already on file (BEN-INT-09 has run).
    vi.mocked(getNodesByProspect).mockResolvedValue([
      { id: "node-jane", organization_id: ORG_ID, node_type: "person", prospect_id: "prospect-1", label: "Jane Prospect", properties: {}, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ] as never);
    vi.mocked(getEdges).mockResolvedValue([]);
    vi.mocked(getEvidence).mockResolvedValue([
      { id: "ev-giving", claim_type: "giving_history", confidence: 0.6, verification_status: "single_source_fact" } as never,
      { id: "ev-liquidity", claim_type: "liquidity_event", confidence: 0.5, verification_status: "reasoned_inference" } as never,
    ]);
    vi.mocked(recordEvidence).mockImplementation(async (item) => ({ id: "ev-new", ...item }) as never);
    vi.mocked(createReviewItem).mockResolvedValue({ id: "review-1" } as never);

    const { WealthCapacityIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-08");
    const { MAX_DELEGATIONS_PER_RUN } = await import("@/lib/pil/agents/int/shared");
    const agent = new WealthCapacityIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-08" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    // hasGivingCorroborant is true, so this run does NOT escalate to human review.
    expect(vi.mocked(createReviewItem)).not.toHaveBeenCalled();
    expect(result.delegations.length).toBeLessThanOrEqual(MAX_DELEGATIONS_PER_RUN);
    expect(result.delegations.map((d) => d.childAgentCode)).toEqual(["BEN-INT-03", "BEN-QLF-03", "BEN-KNW-03"]);
    expect(result.delegations.find((d) => d.childAgentCode === "BEN-INT-09")).toBeUndefined();
    expect(result.delegations.find((d) => d.childAgentCode === "BEN-KNW-02")).toBeUndefined();

    const report = (
      result.conclusions as {
        report: { liquidity: string; dimensionCoverage: Record<string, boolean>; delegationsIssued: string[] };
      }
    ).report;
    expect(report.liquidity).toBe("event_documented");
    expect(report.dimensionCoverage["Liquidity Indicators"]).toBe(true);
    expect(report.dimensionCoverage["Asset And Ownership Indicators"]).toBe(true);
    expect(report.dimensionCoverage["Liability/Encumbrance Limitations"]).toBe(false);
    expect(report.delegationsIssued).toEqual(result.delegations.map((d) => d.childAgentCode));
  });
});

describe("BEN-INT-09 Wealth Origin and Liquidity Event Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("still records liquidity_event evidence from the news_search + EDGAR-scoped web_search chain unchanged", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { getNodesByProspect, traverseGraph } = await import("@/lib/pil/graph");
    const { recordEvidence, getEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeProspectClient(PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    const personNode = {
      id: "node-jane",
      organization_id: ORG_ID,
      node_type: "person",
      prospect_id: "prospect-1",
      label: "Jane Prospect",
      properties: {},
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const companyNode = {
      id: "node-acme",
      organization_id: ORG_ID,
      node_type: "company",
      prospect_id: null,
      label: "Acme Corp",
      properties: {},
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    vi.mocked(getNodesByProspect).mockResolvedValue([personNode] as never);
    vi.mocked(traverseGraph).mockResolvedValue({
      nodes: [personNode, companyNode],
      edges: [
        {
          id: "edge-1",
          organization_id: ORG_ID,
          source_node_id: "node-jane",
          target_node_id: "node-acme",
          edge_type: "owns",
          relationship_strength: "strong",
          properties: {},
          is_current: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    } as never);

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "news_search") {
        return {
          name: toolName,
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { query: "x", results: [{ title: "Acme Corp acquired by Global Inc", url: "https://news.test/acme-sale", source: "news.test" }] },
            cost_usd: 0.01,
          }),
        };
      }
      if (toolName === "web_search") {
        return { name: toolName, description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results: [] }, cost_usd: 0.01 }) };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    const recorded: Array<{ claim_type: string; confidence: number; verification_status: string; source_type: string; value: unknown }> = [];
    vi.mocked(recordEvidence).mockImplementation(async (item) => {
      recorded.push(item as never);
      return { id: `ev-${recorded.length}`, ...item } as never;
    });
    vi.mocked(getEvidence).mockResolvedValue([]);

    const { WealthOriginLiquidityEventAgent } = await import("@/lib/pil/agents/int/BEN-INT-09");
    const agent = new WealthOriginLiquidityEventAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-09" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(recorded.length).toBe(1);
    expect(recorded[0]?.claim_type).toBe("liquidity_event");
    expect(recorded[0]?.confidence).toBe(0.4);
    expect(recorded[0]?.verification_status).toBe("reasoned_inference");
    expect(recorded[0]?.source_type).toBe("news");
    expect((recorded[0]?.value as { chain: Array<{ step: string; label: string }> }).chain.map((l) => l.step)).toEqual(["ownership_stake", "acquisition"]);
  });

  it("delegates to BEN-KNW-02/BEN-INT-03/BEN-INT-08 (capped at MAX_DELEGATIONS_PER_RUN ahead of BEN-KNW-03) when no person node resolves, no ownership stake is on file, and a liquidity event is found", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { getNodesByProspect, traverseGraph } = await import("@/lib/pil/graph");
    const { recordEvidence, getEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeProspectClient(PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    // No person graph node resolves at all -- identity ambiguous, and
    // ownedCompanies stays empty since traverseGraph is never reached.
    vi.mocked(getNodesByProspect).mockResolvedValue([]);
    vi.mocked(traverseGraph).mockResolvedValue({ nodes: [], edges: [] } as never);

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "news_search") {
        return {
          name: toolName,
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { query: "x", results: [{ title: "Jane Prospect sold her stake", url: "https://news.test/sale", source: "news.test" }] },
            cost_usd: 0.01,
          }),
        };
      }
      if (toolName === "web_search") {
        return { name: toolName, description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results: [] }, cost_usd: 0.01 }) };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(recordEvidence).mockImplementation(async (item) => ({ id: "ev-1", ...item }) as never);
    vi.mocked(getEvidence).mockResolvedValue([]);

    const { WealthOriginLiquidityEventAgent } = await import("@/lib/pil/agents/int/BEN-INT-09");
    const { MAX_DELEGATIONS_PER_RUN } = await import("@/lib/pil/agents/int/shared");
    const agent = new WealthOriginLiquidityEventAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-09" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(result.delegations.length).toBeLessThanOrEqual(MAX_DELEGATIONS_PER_RUN);
    expect(result.delegations.map((d) => d.childAgentCode)).toEqual(["BEN-KNW-02", "BEN-INT-03", "BEN-INT-08"]);
    expect(result.delegations.find((d) => d.childAgentCode === "BEN-KNW-03")).toBeUndefined();

    const report = (
      result.conclusions as { report: { dimensionCoverage: Record<string, boolean>; delegationsIssued: string[]; ownedCompaniesFound: number } }
    ).report;
    expect(report.ownedCompaniesFound).toBe(0);
    expect(report.dimensionCoverage["Founder Ownership Evidence"]).toBe(false);
    expect(report.delegationsIssued).toEqual(result.delegations.map((d) => d.childAgentCode));
  });
});

describe("BEN-INT-10 Contact Intelligence Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("still records linkedin/organization_contact_page/email evidence + has_contact edges from web_search + web_crawl unchanged", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence, getEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeProspectClient(PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    let webSearchCallCount = 0;
    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search") {
        webSearchCallCount += 1;
        const isLinkedinSearch = webSearchCallCount === 1;
        return {
          name: "web_search",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: {
              query: "x",
              results: isLinkedinSearch
                ? [{ title: "Jane Prospect - LinkedIn", url: "https://linkedin.com/in/janeprospect" }]
                : [{ title: "Contact Us", url: "https://acme.test/contact" }],
            },
            cost_usd: 0.01,
          }),
        };
      }
      if (toolName === "web_crawl") {
        return {
          name: "web_crawl",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { text: "Reach us at contact@acme.test for inquiries." },
            cost_usd: 0.001,
          }),
        };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(upsertNode).mockImplementation(async (node) => ({
      id: `node-${node.label}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...node,
    }));
    const recorded: Array<{ claim_type: string; confidence: number; value: unknown }> = [];
    vi.mocked(recordEvidence).mockImplementation(async (item) => {
      recorded.push(item as never);
      return { id: `ev-${recorded.length}`, ...item } as never;
    });
    const edgesRecorded: Array<{ edge_type: string; relationship_strength: string | null }> = [];
    vi.mocked(upsertEdge).mockImplementation(async (edge) => {
      edgesRecorded.push(edge as never);
      return { id: `edge-${edgesRecorded.length}`, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...edge } as never;
    });
    vi.mocked(getEvidence).mockResolvedValue([]);

    const { ContactIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-10");
    const agent = new ContactIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-10" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(recorded.length).toBe(3);
    expect(recorded.every((r) => r.claim_type === "contact")).toBe(true);
    expect(recorded.map((r) => (r.value as { channelType: string }).channelType)).toEqual([
      "linkedin",
      "organization_contact_page",
      "email",
    ]);
    expect(recorded[0]?.confidence).toBe(0.5);
    expect(recorded[1]?.confidence).toBe(0.35);
    expect(edgesRecorded.length).toBe(3);
    expect(edgesRecorded.every((e) => e.edge_type === "has_contact")).toBe(true);
  });

  it("delegates to BEN-REL-01 (never BEN-QLF-05/BEN-KNW-02/a BEN-INT-0N peer) when no permissible contact channel is found, capped at MAX_DELEGATIONS_PER_RUN", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode } = await import("@/lib/pil/graph");
    const { getEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeProspectClient(PROSPECT);
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    // No linkedin hit and no contact-page hit at all -- zero channels.
    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search") {
        return { name: toolName, description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results: [] }, cost_usd: 0.01 }) };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(upsertNode).mockImplementation(async (node) => ({
      id: "node-jane",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...node,
    }));
    // Zero persisted contact evidence -- every dimension is a gap.
    vi.mocked(getEvidence).mockResolvedValue([]);

    const { ContactIntelligenceAgent } = await import("@/lib/pil/agents/int/BEN-INT-10");
    const { MAX_DELEGATIONS_PER_RUN } = await import("@/lib/pil/agents/int/shared");
    const agent = new ContactIntelligenceAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-INT-10" }) as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(result.delegations.length).toBeLessThanOrEqual(MAX_DELEGATIONS_PER_RUN);
    expect(result.delegations.map((d) => d.childAgentCode)).toEqual(["BEN-REL-01"]);
    expect(result.delegations.find((d) => d.childAgentCode === "BEN-QLF-05")).toBeUndefined();
    expect(result.delegations.find((d) => d.childAgentCode === "BEN-KNW-02")).toBeUndefined();
    expect(result.delegations.find((d) => /^BEN-INT-/.test(d.childAgentCode))).toBeUndefined();

    const report = (
      result.conclusions as { report: { dimensionCoverage: Record<string, boolean>; delegationsIssued: string[]; channelsFound: number; noPermissibleChannelFound: boolean } }
    ).report;
    expect(report.channelsFound).toBe(0);
    expect(report.noPermissibleChannelFound).toBe(true);
    expect(Object.values(report.dimensionCoverage).every((v) => v === false)).toBe(true);
    expect(report.delegationsIssued).toEqual(result.delegations.map((d) => d.childAgentCode));
  });
});
