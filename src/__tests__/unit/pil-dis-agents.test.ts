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
vi.mock("@/lib/pil/audit", () => ({ logAction: vi.fn() }));

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

/**
 * pil_prospects client mock for BEN-DIS-05: supports both the
 * resolveTargetCompanies lookup (select -> eq -> in) and the
 * findOrCreateProspect existing-check (select -> eq -> eq -> maybeSingle),
 * since both chains share the same first .eq() call.
 */
function makeExecClient(params: {
  companies: Array<{ id: string; display_name: string }>;
  existingByCanonical?: Record<string, unknown>;
}) {
  const { companies, existingByCanonical = {} } = params;
  let counter = 0;
  const insertMock = vi.fn((payload: Record<string, unknown>) => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({
        data: { id: `exec-${++counter}`, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...payload },
        error: null,
      }),
    })),
  }));
  const from = vi.fn((table: string) => {
    if (table !== "pil_prospects") throw new Error(`unexpected table ${table} -- this test only mocks pil_prospects`);
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn((_col: string, ids: string[]) =>
            Promise.resolve({ data: companies.filter((c) => ids.includes(c.id)), error: null }),
          ),
          eq: vi.fn((_col: string, canonical: string) => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: existingByCanonical[canonical] ?? null, error: null }),
          })),
        })),
      })),
      insert: insertMock,
    };
  });
  return { from, insertMock };
}

/** Routes web_search calls by inspecting the query text: exec-leadership queries vs nonprofit-board queries. Unmatched titles get empty board results. */
function mockGetToolForExec(params: {
  execResultsByCompany: Record<string, Array<{ title: string; url: string }>>;
  boardResultsByTitle: Record<string, Array<{ title: string; url: string }>>;
}) {
  const { execResultsByCompany, boardResultsByTitle } = params;
  return (toolName: string) => {
    if (toolName !== "web_search") throw new Error(`unexpected tool ${toolName}`);
    return {
      name: "web_search",
      description: "",
      execute: vi.fn((callParams: { query: string }) => {
        const q = callParams.query;
        const execMatch = Object.keys(execResultsByCompany).find((c) => q.includes(`"${c}"`) && q.includes("CEO OR founder"));
        if (execMatch) {
          return Promise.resolve({ success: true, data: { query: q, results: execResultsByCompany[execMatch] }, cost_usd: 0.01 });
        }
        const boardMatch = Object.keys(boardResultsByTitle).find((t) => q.includes(`"${t}"`) && q.includes("nonprofit board"));
        if (boardMatch) {
          return Promise.resolve({ success: true, data: { query: q, results: boardResultsByTitle[boardMatch] }, cost_usd: 0.005 });
        }
        return Promise.resolve({ success: true, data: { query: q, results: [] }, cost_usd: 0.005 });
      }),
    };
  };
}

describe("BEN-DIS-05 Executive Prospect Discovery Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("delegates to both BEN-INT-01 and BEN-REL-01 for a newly-created executive with boardInvolvementFlagged=true", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const companies = [{ id: "company-1", display_name: "Acme Corp" }];
    const { from } = makeExecClient({ companies });
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    const execResultsByCompany = { "Acme Corp": [{ title: "Jane Exec", url: "https://exec.test/a" }] };
    const boardResultsByTitle = { "Jane Exec": [{ title: "Jane Exec named trustee", url: "https://board.test/a" }] };
    vi.mocked(getTool).mockImplementation(mockGetToolForExec({ execResultsByCompany, boardResultsByTitle }) as never);

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

    const { ExecutiveProspectDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-05");
    const agent = new ExecutiveProspectDiscoveryAgent();
    const context = baseContext({
      agentCode: "BEN-DIS-05",
      goal: "Discover executives in Austin, TX for education",
      plan: { companyProspectIds: ["company-1"] },
    });

    const result = await agent.execute(context as never, fakeRunner());

    const discoveries = result.conclusions.discoveries as Array<{ prospectId: string; created: boolean; boardInvolvementFlagged: boolean }>;
    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]?.created).toBe(true);
    expect(discoveries[0]?.boardInvolvementFlagged).toBe(true);

    const prospectId = discoveries[0]?.prospectId;
    const intDelegation = result.delegations.find((d) => d.childAgentCode === "BEN-INT-01");
    const relDelegation = result.delegations.find((d) => d.childAgentCode === "BEN-REL-01");
    expect(intDelegation).toBeDefined();
    expect(relDelegation).toBeDefined();
    expect(intDelegation?.maxAutonomy).toBe("A2");
    expect(relDelegation?.maxAutonomy).toBe("A2");
    expect((intDelegation?.constraints as { prospectId: string })?.prospectId).toBe(prospectId);
    expect((relDelegation?.constraints as { prospectId: string })?.prospectId).toBe(prospectId);
  });

  it("does not delegate to BEN-INT-01 for an executive findOrCreateProspect resolves as already-known (created=false)", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence } = await import("@/lib/pil/evidence");
    const { normalizeName } = await import("@/lib/pil/agents/dis/shared");

    const companies = [{ id: "company-1", display_name: "Acme Corp" }];
    const existingProspect = {
      id: "exec-existing-1",
      organization_id: ORG_ID,
      entity_type: "executive",
      display_name: "Jane Exec",
      canonical_name: normalizeName("Jane Exec"),
      status: "active",
      merged_into_prospect_id: null,
      source_of_record: "discovery",
      created_by_agent_id: "BEN-DIS-05",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const { from } = makeExecClient({
      companies,
      existingByCanonical: { [normalizeName("Jane Exec")]: existingProspect },
    });
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    const execResultsByCompany = { "Acme Corp": [{ title: "Jane Exec", url: "https://exec.test/a" }] };
    vi.mocked(getTool).mockImplementation(mockGetToolForExec({ execResultsByCompany, boardResultsByTitle: {} }) as never);

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

    const { ExecutiveProspectDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-05");
    const agent = new ExecutiveProspectDiscoveryAgent();
    const context = baseContext({
      agentCode: "BEN-DIS-05",
      goal: "Discover executives in Austin, TX for education",
      plan: { companyProspectIds: ["company-1"] },
    });

    const result = await agent.execute(context as never, fakeRunner());

    const discoveries = result.conclusions.discoveries as Array<{ created: boolean }>;
    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]?.created).toBe(false);
    expect(result.delegations.find((d) => d.childAgentCode === "BEN-INT-01")).toBeUndefined();
  });

  it("caps BEN-INT-01 delegations at 5 even when more than 5 executives are discovered in one run", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const companies = [{ id: "company-1", display_name: "Acme Corp" }];
    const { from } = makeExecClient({ companies });
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    const execResults = Array.from({ length: 6 }, (_, i) => ({ title: `Exec Number ${i}`, url: `https://exec.test/${i}` }));
    const execResultsByCompany = { "Acme Corp": execResults };
    const boardResultsByTitle = Object.fromEntries(
      execResults.map((r) => [r.title, [{ title: `${r.title} named trustee`, url: `https://board.test/${r.title}` }]]),
    );
    vi.mocked(getTool).mockImplementation(mockGetToolForExec({ execResultsByCompany, boardResultsByTitle }) as never);

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

    const { ExecutiveProspectDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-05");
    const agent = new ExecutiveProspectDiscoveryAgent();
    const context = baseContext({
      agentCode: "BEN-DIS-05",
      goal: "Discover executives in Austin, TX for education",
      plan: { companyProspectIds: ["company-1"] },
    });

    const result = await agent.execute(context as never, fakeRunner());

    const discoveries = result.conclusions.discoveries as Array<{ created: boolean }>;
    expect(discoveries.length).toBeGreaterThan(5);
    expect(discoveries.every((d) => d.created)).toBe(true);

    const intDelegations = result.delegations.filter((d) => d.childAgentCode === "BEN-INT-01");
    expect(intDelegations).toHaveLength(5);
  });
});

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

  it("computes lifecycleStatus='ACTIVE_VERIFIED' when irs_990_lookup returns a recent filing_year", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const { client } = makePilProspectsClient();
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const currentYear = new Date().getFullYear();
    const matches = [
      { source: "foundation_directory", id: "fd-1", name: "Hill Country Trust", location: "Austin, TX", confidence: 0.9, ein: "11-1111111", ntee_code: "T30" },
    ];

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "entity_lookup") {
        return { name: "entity_lookup", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", matches }, cost_usd: 0.0001 }) };
      }
      if (toolName === "irs_990_lookup") {
        return {
          name: "irs_990_lookup",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { total_grants_paid: 500000, officers: [], mission: "Support local education initiatives.", filing_year: currentYear },
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

    const discoveries = result.conclusions.discoveries as Array<{ lifecycleStatus: string }>;
    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]?.lifecycleStatus).toBe("ACTIVE_VERIFIED");
  });

  it("computes lifecycleStatus='CONFLICTING' and delegates to BEN-SUP-05 when the 990 mission signals an identity event", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const { client } = makePilProspectsClient();
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const matches = [
      { source: "foundation_directory", id: "fd-1", name: "New Horizons Trust", location: "Austin, TX", confidence: 0.9, ein: "11-1111111", ntee_code: "T30" },
    ];

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "entity_lookup") {
        return { name: "entity_lookup", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", matches }, cost_usd: 0.0001 }) };
      }
      if (toolName === "irs_990_lookup") {
        return {
          name: "irs_990_lookup",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: {
              total_grants_paid: 500000,
              officers: [],
              mission: "New Horizons Trust is successor to the Example Legacy Trust.",
              filing_year: new Date().getFullYear(),
            },
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

    const discoveries = result.conclusions.discoveries as Array<{ lifecycleStatus: string }>;
    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]?.lifecycleStatus).toBe("CONFLICTING");

    expect(result.delegations).toHaveLength(1);
    expect(result.delegations[0]?.childAgentCode).toBe("BEN-SUP-05");
  });

  it("continues processing the remaining matches when irs_990_lookup throws for one of them", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence } = await import("@/lib/pil/evidence");
    const { logAction } = await import("@/lib/pil/audit");

    const { client } = makePilProspectsClient();
    vi.mocked(getPilClient).mockReturnValue(client as never);
    vi.mocked(logAction).mockResolvedValue(undefined);

    const matches = [
      { source: "foundation_directory", id: "fd-1", name: "Broken Lookup Trust", location: "Austin, TX", confidence: 0.9, ein: "11-1111111", ntee_code: "T30" },
      { source: "foundation_directory", id: "fd-2", name: "Capital Area Trust", location: "Austin, TX", confidence: 0.8, ein: "22-2222222", ntee_code: "T31" },
    ];

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "entity_lookup") {
        return { name: "entity_lookup", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", matches }, cost_usd: 0.0001 }) };
      }
      if (toolName === "irs_990_lookup") {
        return {
          name: "irs_990_lookup",
          description: "",
          execute: vi.fn((params: { ein: string }) => {
            if (params.ein === "11-1111111") return Promise.reject(new Error("990 lookup service unavailable"));
            return Promise.resolve({
              success: true,
              data: { total_grants_paid: 250000, officers: [], mission: null, filing_year: new Date().getFullYear() },
              cost_usd: 0.001,
            });
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

    const discoveries = result.conclusions.discoveries as Array<{ displayName: string }>;
    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]?.displayName).toBe("Capital Area Trust");
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "discovery.foundation_match_failed" }));
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

    const discoveries = result.conclusions.discoveries as Array<{ candidateStatus: string }>;
    expect(discoveries).toHaveLength(newsResults.length);
    for (const discovery of discoveries) {
      expect(discovery.candidateStatus).toBe("PROVISIONAL");
    }
  });

  it("marks a news result as NEEDS_RESOLUTION when it matches an existing pil_prospect", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const newsResults = [
      { title: "Jane Donor Gives $2M to Local Shelter", url: "https://news.test/a", publishedAt: "2026-01-01", source: "news.test" },
    ];

    // An existing pil_prospects row matches this display_name -- findExistingProspect
    // (shared.ts) hits maybeSingle() and returns a row, so findOrCreateProspect
    // returns created: false instead of inserting.
    const existingProspect = {
      id: "prospect-existing-1",
      organization_id: ORG_ID,
      entity_type: "individual",
      display_name: "Jane Donor Gives $2M to Local Shelter",
      canonical_name: "jane donor gives 2m to local shelter",
      status: "active",
      merged_into_prospect_id: null,
      source_of_record: "discovery",
      created_by_agent_id: "BEN-DIS-01",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const from = vi.fn((table: string) => {
      if (table !== "pil_prospects") throw new Error(`unexpected table ${table} -- this test only mocks pil_prospects`);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: existingProspect, error: null }) })),
          })),
        })),
        insert: vi.fn(() => {
          throw new Error("insert should not be called when an existing prospect already matches");
        }),
      };
    });
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "news_search") {
        return { name: "news_search", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results: newsResults }, cost_usd: 0.005 }) };
      }
      if (toolName === "web_search") {
        return { name: "web_search", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results: [] }, cost_usd: 0.01 }) };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(recordEvidence).mockImplementation(async (item) => ({ id: "ev-1", ...item }) as never);

    const { IndividualProspectDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-01");
    const agent = new IndividualProspectDiscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-01", goal: "Discover individual prospects in Austin, TX for education" });

    const result = await agent.execute(context as never, fakeRunner());

    const discoveries = result.conclusions.discoveries as Array<{ candidateStatus: string; created: boolean }>;
    expect(discoveries).toHaveLength(1);
    const [discovery] = discoveries;
    expect(discovery?.created).toBe(false);
    expect(discovery?.candidateStatus).toBe("NEEDS_RESOLUTION");
  });

  it("returns the INPUT_INVALID-style early result for an empty goal without calling any tool", async () => {
    const { getTool } = await import("@/lib/pil/tools");

    const { IndividualProspectDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-01");
    const agent = new IndividualProspectDiscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-01", goal: "" });

    const result = await agent.execute(context as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(result.conclusions.skipped).toBe(true);
    expect(result.conclusions.reason).toBe("BEN-DIS-01 requires a non-empty goal");
    expect(getTool).not.toHaveBeenCalled();
  });
});

describe("BEN-DIS-02 Major Donor Discovery Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  /** entity_lookup/irs_990_lookup are always exercised by BEN-DIS-02's step 3 -- stub entity_lookup with no matches so these tests only need to reason about the news_search/web_search paths. */
  function mockGetToolWithNews(newsResults: Array<{ title: string; url: string; publishedAt: string | null; source: string }>) {
    return (toolName: string) => {
      if (toolName === "news_search") {
        return { name: "news_search", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results: newsResults }, cost_usd: 0.005 }) };
      }
      if (toolName === "web_search") {
        return { name: "web_search", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results: [] }, cost_usd: 0.01 }) };
      }
      if (toolName === "entity_lookup") {
        return { name: "entity_lookup", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", matches: [] }, cost_usd: 0.0001 }) };
      }
      throw new Error(`unexpected tool ${toolName}`);
    };
  }

  it("creates a flagged donor with a populated confidenceInterval for a news_search giving-behavior result", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const { client, insertMock } = makePilProspectsClient();
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const newsResults = [
      { title: "Jane Wealthy Pledges $5M Major Gift", url: "https://news.test/a", publishedAt: "2026-01-01", source: "news.test" },
    ];
    vi.mocked(getTool).mockImplementation(mockGetToolWithNews(newsResults) as never);

    const recorded: Array<{ claim_type: string }> = [];
    vi.mocked(recordEvidence).mockImplementation(async (item) => {
      recorded.push(item as { claim_type: string });
      return { id: `ev-${recorded.length}`, ...item };
    });

    const { MajorDonorDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-02");
    const agent = new MajorDonorDiscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-02", goal: "Discover major donors in Austin, TX for education" });

    const result = await agent.execute(context as never, fakeRunner());

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.claim_type).toBe("documented_major_gift");

    const discoveries = result.conclusions.discoveries as Array<{ confidenceInterval: [number, number] }>;
    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]?.confidenceInterval).toEqual([0.35, 0.65]);
    expect(result.status).toBe("completed");
  });

  it("excludes a news_search result whose title reads as an organization name, tracking it in excludedOrganizationNames instead of flagging it", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const { client, insertMock } = makePilProspectsClient();
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const newsResults = [
      { title: "Example Family Foundation Pledges $5M", url: "https://news.test/a", publishedAt: "2026-01-01", source: "news.test" },
    ];
    vi.mocked(getTool).mockImplementation(mockGetToolWithNews(newsResults) as never);

    const recorded: Array<{ claim_type: string }> = [];
    vi.mocked(recordEvidence).mockImplementation(async (item) => {
      recorded.push(item as { claim_type: string });
      return { id: `ev-${recorded.length}`, ...item };
    });

    const { MajorDonorDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-02");
    const agent = new MajorDonorDiscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-02", goal: "Discover major donors in Austin, TX for education" });

    const result = await agent.execute(context as never, fakeRunner());

    expect(insertMock).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(0);
    expect(result.conclusions.discoveries).toEqual([]);
    expect(result.conclusions.excludedOrganizationNames).toEqual(["Example Family Foundation Pledges $5M"]);
  });

  it("delegates to both BEN-INT-08 (deep capacity research) and BEN-SUP-05 (critic review) when a major donor is flagged", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const { client } = makePilProspectsClient();
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const newsResults = [
      { title: "Jane Wealthy Pledges $5M Major Gift", url: "https://news.test/a", publishedAt: "2026-01-01", source: "news.test" },
    ];
    vi.mocked(getTool).mockImplementation(mockGetToolWithNews(newsResults) as never);
    vi.mocked(recordEvidence).mockImplementation(async (item) => ({ id: "ev-1", ...item }) as never);

    const { MajorDonorDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-02");
    const agent = new MajorDonorDiscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-02", goal: "Discover major donors in Austin, TX for education" });

    const result = await agent.execute(context as never, fakeRunner());

    const discoveries = result.conclusions.discoveries as Array<{ prospectId: string }>;
    expect(discoveries).toHaveLength(1);
    const flaggedProspectId = discoveries[0]?.prospectId;

    expect(result.delegations).toHaveLength(2);
    const childCodes = result.delegations.map((d) => d.childAgentCode);
    expect(childCodes).toEqual(expect.arrayContaining(["BEN-INT-08", "BEN-SUP-05"]));

    const criticDelegation = result.delegations.find((d) => d.childAgentCode === "BEN-SUP-05");
    expect(criticDelegation?.maxAutonomy).toBe("A2");
    expect(criticDelegation?.constraints).toMatchObject({
      flaggedProspectIds: [flaggedProspectId],
      capacityThreshold: 150_000,
    });
  });
});

describe("BEN-DIS-04 Corporate Giving Discovery Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("classifies an employee-matching program title and includes it as evidence value.givingMechanism", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const { client } = makePilProspectsClient();
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const results = [{ title: "Acme Corp employee matching gift program", url: "https://acme.test/giving" }];

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search") {
        return { name: "web_search", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results }, cost_usd: 0.01 }) };
      }
      if (toolName === "web_crawl") {
        return { name: "web_crawl", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { text: "Currently accepting applications." }, cost_usd: 0.001 }) };
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

    const recorded: Array<{ claim_type: string; value: unknown }> = [];
    vi.mocked(recordEvidence).mockImplementation(async (item) => {
      recorded.push(item as { claim_type: string; value: unknown });
      return { id: `ev-${recorded.length}`, ...item };
    });

    const { CorporateGivingDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-04");
    const agent = new CorporateGivingDiscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-04", goal: "Discover corporate giving programs in Austin, TX for education" });

    const result = await agent.execute(context as never, fakeRunner());

    expect(result.status).toBe("completed");
    const eligibilityEvidence = recorded.find((r) => r.claim_type === "corporate_giving_eligibility_rationale");
    expect(eligibilityEvidence).toBeDefined();
    expect((eligibilityEvidence?.value as { givingMechanism: string }).givingMechanism).toBe("employee_matching");
  });

  it("delegates to both BEN-KNW-02 and BEN-INT-03 (alongside BEN-DIS-05) when two results share a normalized-prefix key", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const { client } = makePilProspectsClient();
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const results = [
      { title: "Example Corp Foundation", url: "https://example.test/foundation" },
      { title: "Example Corp Community Fund", url: "https://example.test/community-fund" },
    ];

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search") {
        return { name: "web_search", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results }, cost_usd: 0.01 }) };
      }
      if (toolName === "web_crawl") {
        return { name: "web_crawl", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { text: "Currently accepting applications." }, cost_usd: 0.001 }) };
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

    const { CorporateGivingDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-04");
    const agent = new CorporateGivingDiscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-04", goal: "Discover corporate giving programs in Austin, TX for education" });

    const result = await agent.execute(context as never, fakeRunner());

    expect(result.status).toBe("completed");
    const childCodes = result.delegations.map((d) => d.childAgentCode);
    expect(childCodes).toEqual(expect.arrayContaining(["BEN-DIS-05", "BEN-KNW-02", "BEN-INT-03"]));

    const knwDelegation = result.delegations.find((d) => d.childAgentCode === "BEN-KNW-02");
    const intDelegation = result.delegations.find((d) => d.childAgentCode === "BEN-INT-03");
    expect(knwDelegation?.maxAutonomy).toBe("A2");
    expect(intDelegation?.maxAutonomy).toBe("A2");
    const ambiguousIds = (knwDelegation?.constraints as { ambiguousProspectIds: string[] })?.ambiguousProspectIds;
    expect(ambiguousIds).toHaveLength(2);
    expect((intDelegation?.constraints as { ambiguousProspectIds: string[] })?.ambiguousProspectIds).toEqual(ambiguousIds);
  });

  it("returns status='failed' with a BEN-SUP-06 delegation when upsertNode rejects mid-loop", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode } = await import("@/lib/pil/graph");
    const { recordEvidence } = await import("@/lib/pil/evidence");
    const { logAction } = await import("@/lib/pil/audit");

    const { client } = makePilProspectsClient();
    vi.mocked(getPilClient).mockReturnValue(client as never);
    vi.mocked(logAction).mockResolvedValue(undefined);

    const results = [{ title: "Acme Corp sponsorship program", url: "https://acme.test/sponsorship" }];

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search") {
        return { name: "web_search", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results }, cost_usd: 0.01 }) };
      }
      if (toolName === "web_crawl") {
        return { name: "web_crawl", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { text: "Currently accepting applications." }, cost_usd: 0.001 }) };
      }
      throw new Error(`unexpected tool ${toolName}`);
    });

    vi.mocked(upsertNode).mockRejectedValue(new Error("pil_graph_nodes write failed"));
    vi.mocked(recordEvidence).mockImplementation(async (item) => ({ id: `ev-${Math.random()}`, ...item }));

    const { CorporateGivingDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-04");
    const agent = new CorporateGivingDiscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-04", goal: "Discover corporate giving programs in Austin, TX for education" });

    const result = await agent.execute(context as never, fakeRunner());

    expect(result.status).toBe("failed");
    expect(result.error).toBe("pil_graph_nodes write failed");
    expect(result.delegations).toHaveLength(1);
    expect(result.delegations[0]?.childAgentCode).toBe("BEN-SUP-06");
    expect(result.delegations[0]?.maxAutonomy).toBe("A2");
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "discovery.unknown_external_effect" }));
  });
});

/** pil_prospects find-then-create client plus pil_prospect_classifications insert -- BEN-DIS-06 is the first DIS agent under test that writes classification rows (dimension='geography' for any boundary-unconfirmed candidate). */
function makeGeoClient(params: { existingByCanonical?: Record<string, unknown> } = {}) {
  const { existingByCanonical = {} } = params;
  let counter = 0;
  const insertProspect = vi.fn((payload: Record<string, unknown>) => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({
        data: { id: `geo-prospect-${++counter}`, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...payload },
        error: null,
      }),
    })),
  }));
  const insertClassification = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    if (table === "pil_prospects") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn((_col: string, canonical: string) => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: existingByCanonical[canonical] ?? null, error: null }),
            })),
          })),
        })),
        insert: insertProspect,
      };
    }
    if (table === "pil_prospect_classifications") {
      return { insert: insertClassification };
    }
    throw new Error(`unexpected table ${table} -- this test only mocks pil_prospects/pil_prospect_classifications`);
  });
  return { from, insertProspect, insertClassification };
}

/** Routes entity_lookup to foundationMatches and web_search to communityResults/localResults by inspecting the query text. */
function mockGetToolForGeo(params: {
  communityResults?: Array<{ title: string; url: string }>;
  localResults?: Array<{ title: string; url: string }>;
  foundationMatches?: Array<{ source: string; name: string; location: string | null; confidence: number; ein: string | null }>;
}) {
  const { communityResults = [], localResults = [], foundationMatches = [] } = params;
  return (toolName: string) => {
    if (toolName === "entity_lookup") {
      return {
        name: "entity_lookup",
        description: "",
        execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", matches: foundationMatches }, cost_usd: 0.0001 }),
      };
    }
    if (toolName === "web_search") {
      return {
        name: "web_search",
        description: "",
        execute: vi.fn((callParams: { query: string }) => {
          if (callParams.query.includes("community foundation")) {
            return Promise.resolve({ success: true, data: { query: callParams.query, results: communityResults }, cost_usd: 0.01 });
          }
          return Promise.resolve({ success: true, data: { query: callParams.query, results: localResults }, cost_usd: 0.01 });
        }),
      };
    }
    throw new Error(`unexpected tool ${toolName}`);
  };
}

describe("BEN-DIS-06 Geographic Funding Discovery Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("delegates to BEN-KNW-02 listing the prospect id for a community-foundation-only (boundaryConfirmed=false) discovery", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeGeoClient();
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    const communityResults = [{ title: "Austin Community Foundation", url: "https://austincf.test" }];
    vi.mocked(getTool).mockImplementation(mockGetToolForGeo({ communityResults }) as never);

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

    const { GeographicFundingDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-06");
    const agent = new GeographicFundingDiscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-06", goal: "Discover funding in Austin, TX for education" });

    const result = await agent.execute(context as never, fakeRunner());

    const discoveries = result.conclusions.discoveries as Array<{ prospectId: string; boundaryConfirmed: boolean }>;
    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]?.boundaryConfirmed).toBe(false);

    const knwDelegation = result.delegations.find((d) => d.childAgentCode === "BEN-KNW-02");
    expect(knwDelegation).toBeDefined();
    expect(knwDelegation?.maxAutonomy).toBe("A2");
    expect((knwDelegation?.constraints as { unconfirmedProspectIds: string[] })?.unconfirmedProspectIds).toEqual([
      discoveries[0]?.prospectId,
    ]);
  });

  it("produces a BEN-SUP-05 delegation alongside the pre-existing BEN-DIS-07 delegation when at least one discovery is made", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeGeoClient();
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    const communityResults = [{ title: "Austin Community Foundation", url: "https://austincf.test" }];
    vi.mocked(getTool).mockImplementation(mockGetToolForGeo({ communityResults }) as never);

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

    const { GeographicFundingDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-06");
    const agent = new GeographicFundingDiscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-06", goal: "Discover funding in Austin, TX for education" });

    const result = await agent.execute(context as never, fakeRunner());

    expect(result.delegations).toHaveLength(3);
    const childCodes = result.delegations.map((d) => d.childAgentCode);
    expect(childCodes).toEqual(expect.arrayContaining(["BEN-DIS-07", "BEN-KNW-02", "BEN-SUP-05"]));

    const supDelegation = result.delegations.find((d) => d.childAgentCode === "BEN-SUP-05");
    expect(supDelegation?.maxAutonomy).toBe("A2");
    const discoveries = result.conclusions.discoveries as Array<{ prospectId: string }>;
    expect((supDelegation?.constraints as { prospectIds: string[] })?.prospectIds).toEqual(
      discoveries.map((d) => d.prospectId),
    );
  });

  it("sets conclusions.lowDataGeographyRisk=true when fewer than 3 discoveries are found for a non-empty resolved geography", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeGeoClient();
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    const communityResults = [{ title: "Austin Community Foundation", url: "https://austincf.test" }];
    vi.mocked(getTool).mockImplementation(mockGetToolForGeo({ communityResults }) as never);

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

    const { GeographicFundingDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-06");
    const agent = new GeographicFundingDiscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-06", goal: "Discover funding in Austin, TX for education" });

    const result = await agent.execute(context as never, fakeRunner());

    expect(result.conclusions.resolvedGeography).toBeTruthy();
    const discoveries = result.conclusions.discoveries as unknown[];
    expect(discoveries.length).toBeLessThan(3);
    expect(result.conclusions.lowDataGeographyRisk).toBe(true);
    expect(result.conclusions.sourceDiversityNote).toBe(`0 boundary-confirmed / ${discoveries.length} unconfirmed of ${discoveries.length} total`);
  });

  it("returns the INPUT_INVALID-style early result for an empty goal without calling any tool", async () => {
    const { getTool } = await import("@/lib/pil/tools");

    const { GeographicFundingDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-06");
    const agent = new GeographicFundingDiscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-06", goal: "" });

    const result = await agent.execute(context as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(result.conclusions.skipped).toBe(true);
    expect(result.conclusions.reason).toBe("BEN-DIS-06 requires a non-empty goal");
    expect(getTool).not.toHaveBeenCalled();
  });
});

/** Routes news_search/web_search by tool name; irs_990_lookup is not exercised by these tests (no context.plan.foundationEins supplied). */
function mockGetToolForCause(params: {
  newsResults?: Array<{ title: string; url: string; publishedAt: string | null; source: string }>;
  webResults?: Array<{ title: string; url: string }>;
}) {
  const { newsResults = [], webResults = [] } = params;
  return (toolName: string) => {
    if (toolName === "news_search") {
      return { name: "news_search", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results: newsResults }, cost_usd: 0.005 }) };
    }
    if (toolName === "web_search") {
      return { name: "web_search", description: "", execute: vi.fn().mockResolvedValue({ success: true, data: { query: "x", results: webResults }, cost_usd: 0.01 }) };
    }
    throw new Error(`unexpected tool ${toolName}`);
  };
}

describe("BEN-DIS-07 Cause-Aligned Prospect Discovery Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("delegates to BEN-SUP-05 for a happy-path cause-aligned news discovery", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeGeoClient();
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    const newsResults = [
      { title: "Jane Donor Announces Major Gift to Education Fund", url: "https://news.test/a", publishedAt: "2026-08-01", source: "news.test" },
    ];
    vi.mocked(getTool).mockImplementation(mockGetToolForCause({ newsResults }) as never);
    vi.mocked(recordEvidence).mockImplementation(async (item) => ({ id: `ev-${Math.random()}`, ...item }) as never);

    const { CauseAlignedProspectDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-07");
    const agent = new CauseAlignedProspectDiscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-07", goal: "Discover cause-aligned prospects for education" });

    const result = await agent.execute(context as never, fakeRunner());

    const discoveries = result.conclusions.discoveries as Array<{ prospectId: string }>;
    expect(discoveries).toHaveLength(1);
    expect(result.status).toBe("completed");

    const supDelegation = result.delegations.find((d) => d.childAgentCode === "BEN-SUP-05");
    expect(supDelegation).toBeDefined();
    expect(supDelegation?.maxAutonomy).toBe("A2");
    expect((supDelegation?.constraints as { prospectIds: string[] })?.prospectIds).toEqual(discoveries.map((d) => d.prospectId));
  });

  it("excludes a sensitive-trait-inference news title without creating a prospect, while a legitimate cause-area title still creates one", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { recordEvidence } = await import("@/lib/pil/evidence");
    const { logAction } = await import("@/lib/pil/audit");

    const { from, insertProspect } = makeGeoClient();
    vi.mocked(getPilClient).mockReturnValue({ from } as never);
    vi.mocked(logAction).mockResolvedValue(undefined);

    const newsResults = [
      { title: "Local Donor Recovering Addict Gives Back", url: "https://news.test/a", publishedAt: "2026-08-01", source: "news.test" },
      { title: "Local Donor Supports Addiction Recovery Program", url: "https://news.test/b", publishedAt: "2026-08-02", source: "news.test" },
    ];
    vi.mocked(getTool).mockImplementation(mockGetToolForCause({ newsResults }) as never);
    vi.mocked(recordEvidence).mockImplementation(async (item) => ({ id: `ev-${Math.random()}`, ...item }) as never);

    const { CauseAlignedProspectDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-07");
    const agent = new CauseAlignedProspectDiscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-07", goal: "Discover cause-aligned prospects for hunger relief" });

    const result = await agent.execute(context as never, fakeRunner());

    expect(result.conclusions.sensitiveInferenceExcluded).toEqual(["Local Donor Recovering Addict Gives Back"]);

    const discoveries = result.conclusions.discoveries as Array<{ displayName: string }>;
    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]?.displayName).toBe("Local Donor Supports Addiction Recovery Program");

    expect(insertProspect).toHaveBeenCalledTimes(1);
    expect((insertProspect.mock.calls[0]?.[0] as { display_name: string }).display_name).toBe(
      "Local Donor Supports Addiction Recovery Program",
    );

    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "discovery.sensitive_inference_excluded",
        after_state: { title: "Local Donor Recovering Addict Gives Back", pattern: "protected_trait_inference" },
      }),
    );
  });

  it("produces a BEN-KNW-03 delegation listing the prospect id of a stale-dated news signal", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const { from } = makeGeoClient();
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    const newsResults = [
      { title: "Old Foundation Supports Education Programs", url: "https://news.test/a", publishedAt: "2015-01-01", source: "news.test" },
    ];
    vi.mocked(getTool).mockImplementation(mockGetToolForCause({ newsResults }) as never);
    vi.mocked(recordEvidence).mockImplementation(async (item) => ({ id: `ev-${Math.random()}`, ...item }) as never);

    const { CauseAlignedProspectDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-07");
    const agent = new CauseAlignedProspectDiscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-07", goal: "Discover cause-aligned prospects for education" });

    const result = await agent.execute(context as never, fakeRunner());

    const discoveries = result.conclusions.discoveries as Array<{ prospectId: string; stale: boolean }>;
    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]?.stale).toBe(true);
    expect(result.conclusions.staleSignalOnly).toEqual([discoveries[0]?.prospectId]);

    const knwDelegation = result.delegations.find((d) => d.childAgentCode === "BEN-KNW-03");
    expect(knwDelegation).toBeDefined();
    expect(knwDelegation?.maxAutonomy).toBe("A2");
    expect((knwDelegation?.constraints as { staleProspectIds: string[] })?.staleProspectIds).toEqual([discoveries[0]?.prospectId]);
  });

  it("returns the INPUT_INVALID-style early result for an empty goal without calling any tool", async () => {
    const { getTool } = await import("@/lib/pil/tools");

    const { CauseAlignedProspectDiscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-07");
    const agent = new CauseAlignedProspectDiscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-07", goal: "" });

    const result = await agent.execute(context as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(result.conclusions.skipped).toBe(true);
    expect(result.conclusions.reason).toBe("BEN-DIS-07 requires a non-empty goal");
    expect(getTool).not.toHaveBeenCalled();
  });
});

/**
 * `funders`/`contacts`-aware Supabase client mock for BEN-DIS-08: extends
 * the from(table) switch (see makePilProspectsClient/makeGeoClient above) to
 * also handle the two live CRM tables this agent reads. `funders`/`contacts`
 * each expose select/insert/update/delete spies so a test can assert the
 * constitutional invariant -- insert/update/delete must never be called
 * against either table -- directly against the mock's recorded calls.
 */
function makeCrmClient(params: {
  funders?: Array<{ id: string; name: string; category: string; annual_giving_budget: number | null }>;
  contacts?: Array<{ id: string; funder_id: string; name: string; title: string | null; relationship: string | null; last_contacted_at: string | null }>;
  existingByCanonical?: Record<string, unknown>;
}) {
  const { funders = [], contacts = [], existingByCanonical = {} } = params;
  let counter = 0;

  const fundersInsertSpy = vi.fn();
  const fundersUpdateSpy = vi.fn();
  const fundersDeleteSpy = vi.fn();
  const contactsInsertSpy = vi.fn();
  const contactsUpdateSpy = vi.fn();
  const contactsDeleteSpy = vi.fn();

  const insertProspect = vi.fn((payload: Record<string, unknown>) => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({
        data: { id: `crm-prospect-${++counter}`, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...payload },
        error: null,
      }),
    })),
  }));

  const from = vi.fn((table: string) => {
    if (table === "funders") {
      return {
        select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: funders, error: null }) })),
        insert: fundersInsertSpy,
        update: fundersUpdateSpy,
        delete: fundersDeleteSpy,
      };
    }
    if (table === "contacts") {
      return {
        select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: contacts, error: null }) })),
        insert: contactsInsertSpy,
        update: contactsUpdateSpy,
        delete: contactsDeleteSpy,
      };
    }
    if (table === "pil_prospects") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn((_col: string, canonical: string) => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: existingByCanonical[canonical] ?? null, error: null }),
            })),
          })),
        })),
        insert: insertProspect,
      };
    }
    throw new Error(`unexpected table ${table} -- this test only mocks funders/contacts/pil_prospects`);
  });

  return { from, insertProspect, fundersInsertSpy, fundersUpdateSpy, fundersDeleteSpy, contactsInsertSpy, contactsUpdateSpy, contactsDeleteSpy };
}

describe("BEN-DIS-08 Hidden Prospect and CRM Rediscovery Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("delegates to BEN-SUP-05 for a reclassification-flagged funder (external signal found, no giving amount on file)", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const funders = [{ id: "funder-1", name: "Acme Foundation", category: "private_foundation", annual_giving_budget: null }];
    const { from } = makeCrmClient({ funders });
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    vi.mocked(getTool).mockImplementation((toolName: string) => {
      if (toolName === "web_search") {
        return {
          name: "web_search",
          description: "",
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { query: "x", results: [{ title: "Acme Foundation trustee named to family office board", url: "https://news.test/acme" }] },
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
    vi.mocked(upsertEdge).mockImplementation(async (edge) => ({
      id: `edge-${edge.source_node_id}-${edge.target_node_id}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...edge,
    }));
    vi.mocked(recordEvidence).mockImplementation(async (item) => ({ id: `ev-${Math.random()}`, ...item }));

    const { HiddenProspectAndCrmRediscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-08");
    const agent = new HiddenProspectAndCrmRediscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-08", goal: "Rediscover hidden prospects in existing CRM data" });

    const result = await agent.execute(context as never, fakeRunner());

    expect(result.status).toBe("completed");
    const reclassificationFlags = result.conclusions.reclassificationFlags as Array<{ prospectId: string; crmTable: string }>;
    expect(reclassificationFlags).toHaveLength(1);
    expect(reclassificationFlags[0]?.crmTable).toBe("funders");

    const supDelegation = result.delegations.find((d) => d.childAgentCode === "BEN-SUP-05");
    expect(supDelegation).toBeDefined();
    expect(supDelegation?.maxAutonomy).toBe("A2");
    expect(supDelegation?.objective).toContain(reclassificationFlags[0]?.prospectId);
    expect((supDelegation?.constraints as { reclassificationFlags: unknown[] })?.reclassificationFlags).toEqual(reclassificationFlags);
  });

  it("never calls insert/update/delete against funders or contacts -- only .select is ever invoked (constitutional invariant)", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");
    const { recordEvidence } = await import("@/lib/pil/evidence");

    const funders = [{ id: "funder-1", name: "Acme Foundation", category: "private_foundation", annual_giving_budget: 50000 }];
    const contacts = [
      { id: "contact-1", funder_id: "funder-1", name: "Jane Program Officer", title: "Program Officer", relationship: "warm", last_contacted_at: "2026-01-01T00:00:00Z" },
    ];
    const { from, fundersInsertSpy, fundersUpdateSpy, fundersDeleteSpy, contactsInsertSpy, contactsUpdateSpy, contactsDeleteSpy } = makeCrmClient({
      funders,
      contacts,
    });
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

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

    const { HiddenProspectAndCrmRediscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-08");
    const agent = new HiddenProspectAndCrmRediscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-08", goal: "Rediscover hidden prospects in existing CRM data" });

    const result = await agent.execute(context as never, fakeRunner());

    expect(result.status).toBe("completed");

    // Both tables were read (from() was called with each name)...
    expect(from).toHaveBeenCalledWith("funders");
    expect(from).toHaveBeenCalledWith("contacts");
    // ...but never mutated -- the spec's "no CRM mutation command exists at
    // all" invariant, inspected directly against the mock's recorded calls.
    expect(fundersInsertSpy).not.toHaveBeenCalled();
    expect(fundersUpdateSpy).not.toHaveBeenCalled();
    expect(fundersDeleteSpy).not.toHaveBeenCalled();
    expect(contactsInsertSpy).not.toHaveBeenCalled();
    expect(contactsUpdateSpy).not.toHaveBeenCalled();
    expect(contactsDeleteSpy).not.toHaveBeenCalled();
  });

  it("returns the early skipped:true result when both funders and contacts come back empty", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getTool } = await import("@/lib/pil/tools");

    const { from } = makeCrmClient({});
    vi.mocked(getPilClient).mockReturnValue({ from } as never);

    const { HiddenProspectAndCrmRediscoveryAgent } = await import("@/lib/pil/agents/dis/BEN-DIS-08");
    const agent = new HiddenProspectAndCrmRediscoveryAgent();
    const context = baseContext({ agentCode: "BEN-DIS-08", orgId: ORG_ID, goal: "Rediscover hidden prospects in existing CRM data" });

    const result = await agent.execute(context as never, fakeRunner());

    expect(result.status).toBe("completed");
    expect(result.conclusions.skipped).toBe(true);
    expect(result.conclusions.reason).toBe(`BEN-DIS-08 found no funders/contacts rows to scan for org ${ORG_ID}`);
    expect(result.delegations).toEqual([]);
    expect(getTool).not.toHaveBeenCalled();
  });
});
