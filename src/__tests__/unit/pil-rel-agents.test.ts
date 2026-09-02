// Unit tests for the Relationship & Graph Intelligence family (BEN-REL-01..08).
// Everything is mocked -- no real DB/network calls, matching
// pil-qlf-knw-agents.test.ts's convention.
import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG_ID = "11111111-2222-3333-4444-555555555555";

vi.mock("@/lib/pil/db", () => ({ getPilClient: vi.fn() }));
vi.mock("@/lib/pil/graph", () => ({
  traverseGraph: vi.fn(),
  upsertNode: vi.fn(),
  upsertEdge: vi.fn(),
  getNodesByProspect: vi.fn(),
}));
vi.mock("@/lib/pil/agents/rel/shared", () => ({
  getProspectById: vi.fn(),
  getPrimaryProspectNode: vi.fn(),
  getTenantContactProspectIds: vi.fn(() => Promise.resolve([])),
  getNodesForProspectIds: vi.fn(() => Promise.resolve([])),
  reconstructShortestPaths: vi.fn(),
  pathConfidence: vi.fn(),
  frictionEstimateForHops: vi.fn(() => "low"),
  refetchEdge: vi.fn(),
  callTool: vi.fn(),
  extractLeadName: vi.fn(),
  hostnameOf: vi.fn(() => "example.com"),
  recordRelationshipEvidence: vi.fn(),
  tryModelTokens: vi.fn(() => Promise.resolve(0)),
  MODEL_TOKEN_UNIT_COST_USD: 0.00002,
}));

function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    agentCode: "BEN-REL-01",
    orgId: ORG_ID,
    prospectId: "p1",
    runId: "run-1",
    goal: "test goal",
    plan: {},
    tools: [] as string[],
    budget: 1000,
    depth: 1,
    ...overrides,
  };
}

const prospect = {
  id: "p1",
  organization_id: ORG_ID,
  entity_type: "individual",
  display_name: "Jane Donor",
  canonical_name: "jane donor",
  status: "active",
  merged_into_prospect_id: null,
  source_of_record: "discovery",
  created_by_agent_id: "BEN-DIS-01",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const primaryNode = {
  id: "primary-1",
  organization_id: ORG_ID,
  node_type: "person",
  prospect_id: "p1",
  label: "Jane Donor",
  properties: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function neighborNode(id: string, label: string, node_type: string) {
  return {
    id,
    organization_id: ORG_ID,
    node_type,
    prospect_id: null,
    label,
    properties: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function searchHit(title: string, url = "https://example.com/a") {
  return { success: true, cost_usd: 0, data: { results: [{ title, url }] } };
}

type MockResponse = { data: unknown; error: unknown };

/** Chainable Supabase-client mock, table-keyed -- same convention as pil-qlf-knw-agents.test.ts's makeClient(). Used only by BEN-REL-03, the sole agent in this file that calls getPilClient() directly rather than going through fully-mocked shared.ts/graph.ts helpers. */
function makeClient(responses: Record<string, MockResponse>) {
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      select: vi.fn(() => c),
      eq: vi.fn(() => c),
      in: vi.fn(() => c),
      maybeSingle: vi.fn(() => Promise.resolve(responses[table] ?? { data: null, error: null })),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(responses[table] ?? { data: null, error: null }).then(resolve, reject),
    };
    return c;
  };
  return { from: vi.fn((table: string) => chain(table)) };
}

describe("BEN-REL-01 Relationship Discovery Agent -- new delegations", () => {
  beforeEach(() => vi.resetAllMocks());

  it("delegates to BEN-KNW-02, BEN-KNW-03, and BEN-REL-04 when the same candidate repeats across board-like neighbors", async () => {
    const { getProspectById, getPrimaryProspectNode, callTool, extractLeadName, recordRelationshipEvidence, tryModelTokens } =
      await import("@/lib/pil/agents/rel/shared");
    const { traverseGraph, upsertNode, upsertEdge } = await import("@/lib/pil/graph");

    const neighbor1 = neighborNode("n1", "Acme Foundation", "foundation");
    const neighbor2 = neighborNode("n2", "Beta Nonprofit", "nonprofit");

    vi.mocked(getProspectById).mockResolvedValue(prospect as never);
    vi.mocked(getPrimaryProspectNode).mockResolvedValue(primaryNode as never);
    vi.mocked(traverseGraph).mockResolvedValue({ nodes: [primaryNode, neighbor1, neighbor2], edges: [] } as never);
    vi.mocked(callTool).mockResolvedValue(searchHit("John Smith Board Member") as never);
    vi.mocked(extractLeadName).mockReturnValue("John Smith");
    vi.mocked(upsertNode)
      .mockResolvedValueOnce({ ...neighborNode("cand-1", "John Smith", "person") } as never)
      .mockResolvedValueOnce({ ...neighborNode("cand-2", "John Smith", "person") } as never);
    vi.mocked(upsertEdge)
      .mockResolvedValueOnce({ id: "edge-1", confidence: 0.3 } as never)
      .mockResolvedValueOnce({ id: "edge-2", confidence: 0.3 } as never);
    vi.mocked(recordRelationshipEvidence).mockResolvedValue({ id: "ev-1" } as never);
    vi.mocked(tryModelTokens).mockResolvedValue(0);

    const { RelationshipDiscoveryAgent } = await import("@/lib/pil/agents/rel/BEN-REL-01");
    const agent = new RelationshipDiscoveryAgent();
    const result = await agent.execute(baseContext() as never, {} as never);

    expect(result.status).toBe("completed");

    const knw02 = result.delegations.find((d) => d.childAgentCode === "BEN-KNW-02");
    expect(knw02).toBeDefined();
    expect((knw02!.constraints as { candidateNodeIds: string[] }).candidateNodeIds).toEqual(["cand-1", "cand-2"]);
    expect((knw02!.constraints as { candidateName: string }).candidateName).toBe("john smith");

    const knw03 = result.delegations.find((d) => d.childAgentCode === "BEN-KNW-03");
    expect(knw03).toBeDefined();
    expect((knw03!.constraints as { edgeIds: string[] }).edgeIds).toEqual(["edge-1", "edge-2"]);

    const rel04 = result.delegations.find((d) => d.childAgentCode === "BEN-REL-04");
    expect(rel04).toBeDefined();
    expect((rel04!.constraints as { organizationNodeIds: string[] }).organizationNodeIds.sort()).toEqual(["n1", "n2"]);

    // Existing REL-02 delegation (boardLikeHits > 0) must be preserved.
    expect(result.delegations.some((d) => d.childAgentCode === "BEN-REL-02")).toBe(true);

    const decision = (result.conclusions as { decision: Record<string, unknown> }).decision;
    expect(decision.sourceAndDirection).toBe("outbound_from_prospect_one_hop");
    expect(decision.directness).toBe("indirect_single_source_web_search");
    expect(decision.strengthEvidence).toEqual({ confidence: 0.3, label: "speculative" });
    expect((decision.alternativeExplanations as Array<{ candidateName: string }>).some((e) => e.candidateName === "john smith")).toBe(true);
  });

  it("does not delegate to BEN-KNW-02 when each neighbor surfaces a distinct candidate name", async () => {
    const { getProspectById, getPrimaryProspectNode, callTool, extractLeadName, recordRelationshipEvidence, tryModelTokens } =
      await import("@/lib/pil/agents/rel/shared");
    const { traverseGraph, upsertNode, upsertEdge } = await import("@/lib/pil/graph");

    const neighbor1 = neighborNode("n1", "Acme Foundation", "foundation");
    const neighbor2 = neighborNode("n2", "Beta Nonprofit", "nonprofit");

    vi.mocked(getProspectById).mockResolvedValue(prospect as never);
    vi.mocked(getPrimaryProspectNode).mockResolvedValue(primaryNode as never);
    vi.mocked(traverseGraph).mockResolvedValue({ nodes: [primaryNode, neighbor1, neighbor2], edges: [] } as never);
    vi.mocked(callTool)
      .mockResolvedValueOnce(searchHit("John Smith Board Member") as never)
      .mockResolvedValueOnce(searchHit("Mary Jones Trustee") as never);
    vi.mocked(extractLeadName).mockReturnValueOnce("John Smith").mockReturnValueOnce("Mary Jones");
    vi.mocked(upsertNode)
      .mockResolvedValueOnce({ ...neighborNode("cand-1", "John Smith", "person") } as never)
      .mockResolvedValueOnce({ ...neighborNode("cand-2", "Mary Jones", "person") } as never);
    vi.mocked(upsertEdge)
      .mockResolvedValueOnce({ id: "edge-1", confidence: 0.3 } as never)
      .mockResolvedValueOnce({ id: "edge-2", confidence: 0.3 } as never);
    vi.mocked(recordRelationshipEvidence).mockResolvedValue({ id: "ev-1" } as never);
    vi.mocked(tryModelTokens).mockResolvedValue(0);

    const { RelationshipDiscoveryAgent } = await import("@/lib/pil/agents/rel/BEN-REL-01");
    const agent = new RelationshipDiscoveryAgent();
    const result = await agent.execute(baseContext() as never, {} as never);

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-KNW-02")).toBe(false);
    const decision = (result.conclusions as { decision: Record<string, unknown> }).decision;
    expect(decision.alternativeExplanations).toEqual([]);
  });

  it("does not delegate to BEN-KNW-03 when no search hit yields a candidate (no new edges)", async () => {
    const { getProspectById, getPrimaryProspectNode, callTool, tryModelTokens } = await import("@/lib/pil/agents/rel/shared");
    const { traverseGraph } = await import("@/lib/pil/graph");

    const neighbor1 = neighborNode("n1", "Acme Foundation", "foundation");

    vi.mocked(getProspectById).mockResolvedValue(prospect as never);
    vi.mocked(getPrimaryProspectNode).mockResolvedValue(primaryNode as never);
    vi.mocked(traverseGraph).mockResolvedValue({ nodes: [primaryNode, neighbor1], edges: [] } as never);
    vi.mocked(callTool).mockResolvedValue({ success: false, cost_usd: 0, data: null } as never);
    vi.mocked(tryModelTokens).mockResolvedValue(0);

    const { RelationshipDiscoveryAgent } = await import("@/lib/pil/agents/rel/BEN-REL-01");
    const agent = new RelationshipDiscoveryAgent();
    const result = await agent.execute(baseContext() as never, {} as never);

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-KNW-03")).toBe(false);
    expect(result.delegations.some((d) => d.childAgentCode === "BEN-REL-04")).toBe(false);
    const decision = (result.conclusions as { decision: Record<string, unknown> }).decision;
    expect(decision.directness).toBe("none_found");
    expect(decision.strengthEvidence).toBeNull();
  });

  it("does not delegate to BEN-REL-04 when the only neighbor is neither board-like nor corporate-like", async () => {
    const { getProspectById, getPrimaryProspectNode, callTool, extractLeadName, recordRelationshipEvidence, tryModelTokens } =
      await import("@/lib/pil/agents/rel/shared");
    const { traverseGraph, upsertNode, upsertEdge } = await import("@/lib/pil/graph");

    const neighbor1 = neighborNode("n1", "Reentry Cause Network", "cause");

    vi.mocked(getProspectById).mockResolvedValue(prospect as never);
    vi.mocked(getPrimaryProspectNode).mockResolvedValue(primaryNode as never);
    vi.mocked(traverseGraph).mockResolvedValue({ nodes: [primaryNode, neighbor1], edges: [] } as never);
    vi.mocked(callTool).mockResolvedValue(searchHit("John Smith Advocate") as never);
    vi.mocked(extractLeadName).mockReturnValue("John Smith");
    vi.mocked(upsertNode).mockResolvedValue({ ...neighborNode("cand-1", "John Smith", "person") } as never);
    vi.mocked(upsertEdge).mockResolvedValue({ id: "edge-1", confidence: 0.3 } as never);
    vi.mocked(recordRelationshipEvidence).mockResolvedValue({ id: "ev-1" } as never);
    vi.mocked(tryModelTokens).mockResolvedValue(0);

    const { RelationshipDiscoveryAgent } = await import("@/lib/pil/agents/rel/BEN-REL-01");
    const agent = new RelationshipDiscoveryAgent();
    const result = await agent.execute(baseContext() as never, {} as never);

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-REL-04")).toBe(false);
    // A new edge was still created, so BEN-KNW-03 must still fire.
    expect(result.delegations.some((d) => d.childAgentCode === "BEN-KNW-03")).toBe(true);
  });

  it("returns the completedEmpty early-return with no delegations when context.prospectId is null", async () => {
    const { RelationshipDiscoveryAgent } = await import("@/lib/pil/agents/rel/BEN-REL-01");
    const agent = new RelationshipDiscoveryAgent();
    const result = await agent.execute(baseContext({ prospectId: null }) as never, {} as never);

    expect(result.status).toBe("completed");
    expect(result.delegations).toEqual([]);
    expect((result.conclusions as { skipped: boolean }).skipped).toBe(true);
  });
});

describe("BEN-REL-02 Board Relationship Mapping Agent -- new delegations", () => {
  beforeEach(() => vi.resetAllMocks());

  const tenantContactNode = neighborNode("tc-node-1", "Acme Foundation", "foundation");

  function boardEdge(id: string, edge_type: string, source: string, target: string, confidence = 0.6) {
    return { id, edge_type, source_node_id: source, target_node_id: target, confidence, is_current: true };
  }

  async function mockCommonSetup() {
    const shared = await import("@/lib/pil/agents/rel/shared");
    const { traverseGraph } = await import("@/lib/pil/graph");
    vi.mocked(shared.getProspectById).mockResolvedValue(prospect as never);
    vi.mocked(shared.getPrimaryProspectNode).mockResolvedValue(primaryNode as never);
    vi.mocked(shared.getTenantContactProspectIds).mockResolvedValue(["tc1"] as never);
    vi.mocked(shared.getNodesForProspectIds).mockResolvedValue([tenantContactNode] as never);
    vi.mocked(shared.recordRelationshipEvidence).mockResolvedValue({ id: "ev-1" } as never);
    vi.mocked(shared.tryModelTokens).mockResolvedValue(0);
    vi.mocked(traverseGraph).mockResolvedValue({ nodes: [primaryNode, tenantContactNode], edges: [] } as never);
    return shared;
  }

  it("delegates to BEN-INT-05 and BEN-KNW-03 when the top-ranked path includes a board/trustee edge", async () => {
    const shared = await mockCommonSetup();
    const edge1 = boardEdge("edge-1", "serves_on_board_of", "primary-1", "tc-node-1", 0.7);
    vi.mocked(shared.reconstructShortestPaths).mockReturnValue(new Map([["tc-node-1", [edge1]]]) as never);
    vi.mocked(shared.pathConfidence).mockReturnValue(0.7);
    vi.mocked(shared.frictionEstimateForHops).mockReturnValue("low");

    const { BoardRelationshipMappingAgent } = await import("@/lib/pil/agents/rel/BEN-REL-02");
    const agent = new BoardRelationshipMappingAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-02" }) as never, {} as never);

    expect(result.status).toBe("completed");

    const int05 = result.delegations.find((d) => d.childAgentCode === "BEN-INT-05");
    expect(int05).toBeDefined();
    expect((int05!.constraints as { edgeIds: string[] }).edgeIds).toEqual(["edge-1"]);
    expect((int05!.constraints as { targetNodeId: string }).targetNodeId).toBe("tc-node-1");

    const knw03 = result.delegations.find((d) => d.childAgentCode === "BEN-KNW-03");
    expect(knw03).toBeDefined();
    expect((knw03!.constraints as { edgeIds: string[] }).edgeIds).toEqual(["edge-1"]);

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-REL-05")).toBe(false);
    // Existing REL-06 delegation must be preserved.
    expect(result.delegations.some((d) => d.childAgentCode === "BEN-REL-06")).toBe(true);

    const decision = (result.conclusions as { decision: Record<string, unknown> }).decision;
    expect(decision.sharedOrganization).toBe("Acme Foundation");
    expect(decision.boardType).toBe("serves_on_board_of");
    expect(decision.overlapInterval).toBe("not_yet_temporally_bounded_pending_BEN-INT-05");
    expect(decision.roleCompatibility).toBe("unassessed_pending_BEN-INT-05_role_detail");
    expect(decision.pathLength).toBe(1);
    expect(decision.relationshipLimitations).toEqual(["co-service at a shared organization does not by itself imply personal closeness"]);
  });

  it("does not delegate to BEN-INT-05 when the top-ranked path has no board/trustee edge, but BEN-KNW-03 still fires", async () => {
    const shared = await mockCommonSetup();
    const edge1 = boardEdge("edge-1", "related_to", "primary-1", "tc-node-1", 0.5);
    vi.mocked(shared.reconstructShortestPaths).mockReturnValue(new Map([["tc-node-1", [edge1]]]) as never);
    vi.mocked(shared.pathConfidence).mockReturnValue(0.5);
    vi.mocked(shared.frictionEstimateForHops).mockReturnValue("low");

    const { BoardRelationshipMappingAgent } = await import("@/lib/pil/agents/rel/BEN-REL-02");
    const agent = new BoardRelationshipMappingAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-02" }) as never, {} as never);

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-INT-05")).toBe(false);
    expect(result.delegations.some((d) => d.childAgentCode === "BEN-KNW-03")).toBe(true);

    const decision = (result.conclusions as { decision: Record<string, unknown> }).decision;
    expect(decision.boardType).toBe("related_to");
    expect(decision.overlapInterval).toBe("no_path_found");
  });

  it("delegates to BEN-REL-05 and skips BEN-INT-05/BEN-KNW-03 when no board/trustee path is found even after widening", async () => {
    const shared = await mockCommonSetup();
    vi.mocked(shared.reconstructShortestPaths).mockReturnValue(new Map() as never);

    const { BoardRelationshipMappingAgent } = await import("@/lib/pil/agents/rel/BEN-REL-02");
    const agent = new BoardRelationshipMappingAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-02" }) as never, {} as never);

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-INT-05")).toBe(false);
    expect(result.delegations.some((d) => d.childAgentCode === "BEN-KNW-03")).toBe(false);
    const rel05 = result.delegations.find((d) => d.childAgentCode === "BEN-REL-05");
    expect(rel05).toBeDefined();
    expect((rel05!.constraints as { prospectId: string }).prospectId).toBe("p1");

    const decision = (result.conclusions as { decision: Record<string, unknown> }).decision;
    expect(decision.sharedOrganization).toBeNull();
    expect(decision.boardType).toBeNull();
    expect(decision.overlapInterval).toBe("no_path_found");
    expect(decision.pathLength).toBeNull();
  });

  it("returns the completedEmpty early-return with no delegations when context.prospectId is null", async () => {
    const { BoardRelationshipMappingAgent } = await import("@/lib/pil/agents/rel/BEN-REL-02");
    const agent = new BoardRelationshipMappingAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-02", prospectId: null }) as never, {} as never);

    expect(result.status).toBe("completed");
    expect(result.delegations).toEqual([]);
    expect((result.conclusions as { skipped: boolean }).skipped).toBe(true);
  });
});

describe("BEN-REL-03 Corporate Relationship Mapping Agent -- new delegations", () => {
  beforeEach(() => vi.resetAllMocks());

  const funder = { id: "f1", name: "Acme Corp", category: "corporate_donation" };
  const tenantNode = neighborNode("tenant-1", "Benavora (tenant organization)", "company");
  const corporateNode = neighborNode("corp-1", "Acme Corp", "company");
  const corporateEdge = { id: "corp-edge-1", confidence: 0.9 };

  /** Wires up the getPilClient/graph.ts/shared.ts mocks common to every BEN-REL-03 test in this block. `contacts` defaults to none so tests that only care about the funder-level (BEN-KNW-02) delegation don't have to think about the contact loop. */
  async function mockCommonSetup(opts: {
    contacts?: Array<{ id: string; funder_id: string; name: string; title: string | null }>;
    existingCompanyNodes?: Array<{ id: string; label: string }>;
    existingPersonnelEdge?: { data: unknown; error: unknown };
    personNode?: ReturnType<typeof neighborNode>;
    personnelEdge?: { id: string; confidence: number };
  } = {}) {
    const shared = await import("@/lib/pil/agents/rel/shared");
    const { getPilClient } = await import("@/lib/pil/db");
    const { upsertNode, upsertEdge } = await import("@/lib/pil/graph");

    const client = makeClient({
      funders: { data: [funder], error: null },
      contacts: { data: opts.contacts ?? [], error: null },
      pil_graph_nodes: { data: opts.existingCompanyNodes ?? [], error: null },
      pil_graph_edges: opts.existingPersonnelEdge ?? { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const nodeMock = vi.mocked(upsertNode).mockResolvedValueOnce(tenantNode as never).mockResolvedValueOnce(corporateNode as never);
    if (opts.personNode) nodeMock.mockResolvedValueOnce(opts.personNode as never);

    const edgeMock = vi.mocked(upsertEdge).mockResolvedValueOnce(corporateEdge as never);
    if (opts.personnelEdge) edgeMock.mockResolvedValueOnce(opts.personnelEdge as never);

    vi.mocked(shared.callTool).mockResolvedValue({ success: false, cost_usd: 0, data: null } as never);
    vi.mocked(shared.recordRelationshipEvidence).mockResolvedValue({ id: "ev-1" } as never);
    vi.mocked(shared.tryModelTokens).mockResolvedValue(0);
    return { client };
  }

  it("delegates to BEN-KNW-02 when an existing company node's normalized label collides with a scanned funder's raw label", async () => {
    await mockCommonSetup({ existingCompanyNodes: [{ id: "dup-1", label: "Acme Corporation" }] });

    const { CorporateRelationshipMappingAgent } = await import("@/lib/pil/agents/rel/BEN-REL-03");
    const agent = new CorporateRelationshipMappingAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-03" }) as never, {} as never);

    expect(result.status).toBe("completed");
    const knw02 = result.delegations.find((d) => d.childAgentCode === "BEN-KNW-02");
    expect(knw02).toBeDefined();
    expect(knw02!.constraints).toEqual({
      funderId: "f1",
      candidateNodeLabel: "Acme Corp",
      possibleDuplicateNodeId: "dup-1",
      possibleDuplicateLabel: "Acme Corporation",
    });
    // A corporate edge was created this run, so the batch provenance
    // delegation must also fire.
    const knw03 = result.delegations.find((d) => d.childAgentCode === "BEN-KNW-03");
    expect(knw03).toBeDefined();
    expect((knw03!.constraints as { edgeIds: string[] }).edgeIds).toEqual(["corp-edge-1"]);
  });

  it("does not delegate to BEN-KNW-02 when no existing company node's normalized label collides", async () => {
    await mockCommonSetup({ existingCompanyNodes: [{ id: "other-1", label: "Beta Industries" }] });

    const { CorporateRelationshipMappingAgent } = await import("@/lib/pil/agents/rel/BEN-REL-03");
    const agent = new CorporateRelationshipMappingAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-03" }) as never, {} as never);

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-KNW-02")).toBe(false);
    // BEN-KNW-03 still fires -- it only depends on edges having been
    // created, not on the near-duplicate check.
    expect(result.delegations.some((d) => d.childAgentCode === "BEN-KNW-03")).toBe(true);
  });

  it("delegates to BEN-INT-03 and BEN-REL-05, and flags decisionAuthorityUncertainty, when a philanthropy-title contact's title also carries an ownership signal", async () => {
    const contact = { id: "c1", funder_id: "f1", name: "Jane Smith", title: "President of Corporate Giving" };
    const personNode = neighborNode("person-1", "Jane Smith", "person");
    const personnelEdge = { id: "personnel-edge-1", confidence: 0.85 };
    await mockCommonSetup({ contacts: [contact], personNode, personnelEdge });

    const { CorporateRelationshipMappingAgent } = await import("@/lib/pil/agents/rel/BEN-REL-03");
    const agent = new CorporateRelationshipMappingAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-03", prospectId: "p1" }) as never, {} as never);

    const int03 = result.delegations.find((d) => d.childAgentCode === "BEN-INT-03");
    expect(int03).toBeDefined();
    expect(int03!.constraints).toEqual({ funderId: "f1", personNodeId: "person-1", title: "President of Corporate Giving" });

    const rel05 = result.delegations.find((d) => d.childAgentCode === "BEN-REL-05");
    expect(rel05).toBeDefined();
    expect(rel05!.constraints).toEqual({ prospectId: "p1", targetNodeId: "person-1" });

    const decision = (result.conclusions as { decision: Record<string, unknown> }).decision;
    expect(decision.decisionAuthorityUncertainty).toBe("flagged_for_BEN-INT-03_review");
    expect(decision.roleOwnershipLinkage).toEqual([{ personNodeId: "person-1", title: "President of Corporate Giving" }]);
  });

  it("does not delegate to BEN-INT-03 for a philanthropy-only title with no ownership signal", async () => {
    const contact = { id: "c1", funder_id: "f1", name: "Jane Smith", title: "Community Relations Manager" };
    const personNode = neighborNode("person-1", "Jane Smith", "person");
    const personnelEdge = { id: "personnel-edge-1", confidence: 0.85 };
    await mockCommonSetup({ contacts: [contact], personNode, personnelEdge });

    const { CorporateRelationshipMappingAgent } = await import("@/lib/pil/agents/rel/BEN-REL-03");
    const agent = new CorporateRelationshipMappingAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-03", prospectId: "p1" }) as never, {} as never);

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-INT-03")).toBe(false);
    const decision = (result.conclusions as { decision: Record<string, unknown> }).decision;
    expect(decision.decisionAuthorityUncertainty).toBe("unassessed");
    expect(decision.roleOwnershipLinkage).toEqual([]);
  });

  it("delegates to BEN-INT-02 when a prior has_contact edge's recorded title differs from the current CRM title", async () => {
    const contact = { id: "c1", funder_id: "f1", name: "Jane Smith", title: "Community Relations Director" };
    const personNode = neighborNode("person-1", "Jane Smith", "person");
    const personnelEdge = { id: "personnel-edge-1", confidence: 0.85 };
    await mockCommonSetup({
      contacts: [contact],
      personNode,
      personnelEdge,
      existingPersonnelEdge: { data: { id: "old-edge-1", is_current: true, properties: { title: "Community Relations Manager" } }, error: null },
    });

    const { CorporateRelationshipMappingAgent } = await import("@/lib/pil/agents/rel/BEN-REL-03");
    const agent = new CorporateRelationshipMappingAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-03", prospectId: null }) as never, {} as never);

    const int02 = result.delegations.find((d) => d.childAgentCode === "BEN-INT-02");
    expect(int02).toBeDefined();
    expect(int02!.constraints).toEqual({
      personNodeId: "person-1",
      previousTitle: "Community Relations Manager",
      currentTitle: "Community Relations Director",
    });
  });

  it("does not delegate to BEN-INT-02 when no prior has_contact edge exists", async () => {
    const contact = { id: "c1", funder_id: "f1", name: "Jane Smith", title: "Community Relations Director" };
    const personNode = neighborNode("person-1", "Jane Smith", "person");
    const personnelEdge = { id: "personnel-edge-1", confidence: 0.85 };
    await mockCommonSetup({ contacts: [contact], personNode, personnelEdge, existingPersonnelEdge: { data: null, error: null } });

    const { CorporateRelationshipMappingAgent } = await import("@/lib/pil/agents/rel/BEN-REL-03");
    const agent = new CorporateRelationshipMappingAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-03", prospectId: null }) as never, {} as never);

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-INT-02")).toBe(false);
  });

  it("does not delegate to BEN-REL-05 when context.prospectId is null (org-wide sweep mode)", async () => {
    const contact = { id: "c1", funder_id: "f1", name: "Jane Smith", title: "Community Relations Director" };
    const personNode = neighborNode("person-1", "Jane Smith", "person");
    const personnelEdge = { id: "personnel-edge-1", confidence: 0.85 };
    await mockCommonSetup({ contacts: [contact], personNode, personnelEdge });

    const { CorporateRelationshipMappingAgent } = await import("@/lib/pil/agents/rel/BEN-REL-03");
    const agent = new CorporateRelationshipMappingAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-03", prospectId: null }) as never, {} as never);

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-REL-05")).toBe(false);
  });

  it("creates no delegations (including BEN-KNW-03) when there are no corporate-category funders on file", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const client = makeClient({ funders: { data: [], error: null } });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { CorporateRelationshipMappingAgent } = await import("@/lib/pil/agents/rel/BEN-REL-03");
    const agent = new CorporateRelationshipMappingAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-03" }) as never, {} as never);

    expect(result.status).toBe("completed");
    expect(result.delegations).toEqual([]);
    expect((result.conclusions as { skipped: boolean }).skipped).toBe(true);
  });
});

describe("BEN-REL-04 Organizational Overlap Agent -- new delegations", () => {
  beforeEach(() => vi.resetAllMocks());

  function orgNode(id: string, label: string, nodeType: string, properties: Record<string, unknown> = {}) {
    return {
      id,
      organization_id: ORG_ID,
      node_type: nodeType,
      prospect_id: null,
      label,
      properties,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
  }

  function affiliationEdge(id: string, sourceNodeId: string, targetNodeId: string, edgeType: string, confidence = 0.8) {
    return {
      id,
      organization_id: ORG_ID,
      source_node_id: sourceNodeId,
      target_node_id: targetNodeId,
      edge_type: edgeType,
      relationship_strength: null,
      confidence,
      temporal_validity_start: null,
      temporal_validity_end: null,
      is_current: true,
      superseded_by_edge_id: null,
      properties: {},
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
  }

  function memberNode(id: string, prospectId: string | null) {
    return {
      id,
      organization_id: ORG_ID,
      node_type: "person",
      prospect_id: prospectId,
      label: id,
      properties: {},
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
  }

  /**
   * BEN-REL-04 issues two distinct pil_graph_nodes reads (org-type nodes
   * first, then a batch lookup of every overlap-pair's member source nodes)
   * -- unlike this file's table-keyed makeClient(), this mock tracks call
   * order on that one table so each read gets its own fixture.
   */
  function makeRel04Client(orgNodes: unknown[], affiliationEdges: unknown[], memberNodes: unknown[]) {
    let graphNodeCalls = 0;
    return {
      from: vi.fn((table: string) => {
        if (table === "pil_graph_nodes") {
          graphNodeCalls++;
          const data = graphNodeCalls === 1 ? orgNodes : memberNodes;
          const chain: Record<string, unknown> = {
            select: vi.fn(() => chain),
            eq: vi.fn(() => chain),
            in: vi.fn(() => chain),
            then: (resolve: (v: unknown) => void) => Promise.resolve({ data, error: null }).then(resolve),
          };
          return chain;
        }
        if (table === "pil_graph_edges") {
          const chain: Record<string, unknown> = {
            select: vi.fn(() => chain),
            eq: vi.fn(() => chain),
            in: vi.fn(() => chain),
            then: (resolve: (v: unknown) => void) => Promise.resolve({ data: affiliationEdges, error: null }).then(resolve),
          };
          return chain;
        }
        throw new Error(`BEN-REL-04 test client: unexpected table ${table}`);
      }),
    };
  }

  async function commonMocks() {
    const shared = await import("@/lib/pil/agents/rel/shared");
    vi.mocked(shared.recordRelationshipEvidence).mockResolvedValue({ id: "ev-1" } as never);
    vi.mocked(shared.tryModelTokens).mockResolvedValue(0);
    return shared;
  }

  it("delegates to BEN-INT-04 when an overlap's shared organization is flagged institutionType=education", async () => {
    const shared = await commonMocks();
    vi.mocked(shared.getTenantContactProspectIds).mockResolvedValue([]);
    vi.mocked(shared.getNodesForProspectIds).mockResolvedValue([]);
    const { getPilClient } = await import("@/lib/pil/db");
    const { upsertEdge } = await import("@/lib/pil/graph");

    const org = orgNode("org-edu-1", "Example University", "nonprofit", { institutionType: "education" });
    const edgeA = affiliationEdge("edge-a", "person-a", "org-edu-1", "employed_by");
    const edgeB = affiliationEdge("edge-b", "person-b", "org-edu-1", "employed_by");
    vi.mocked(getPilClient).mockReturnValue(makeRel04Client([org], [edgeA, edgeB], []) as never);
    vi.mocked(upsertEdge).mockResolvedValue({ id: "overlap-edge-1", confidence: 0.8 } as never);

    const { OrganizationalOverlapAgent } = await import("@/lib/pil/agents/rel/BEN-REL-04");
    const agent = new OrganizationalOverlapAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-04", prospectId: null }) as never, {} as never);

    expect(result.status).toBe("completed");
    const int04 = result.delegations.find((d) => d.childAgentCode === "BEN-INT-04");
    expect(int04).toBeDefined();
    expect((int04!.constraints as { organizationNodeId: string }).organizationNodeId).toBe("org-edu-1");
    expect((int04!.constraints as { memberNodeIds: string[] }).memberNodeIds).toEqual(["person-a", "person-b"]);

    const knw03 = result.delegations.find((d) => d.childAgentCode === "BEN-KNW-03");
    expect(knw03).toBeDefined();
    expect((knw03!.constraints as { edgeIds: string[] }).edgeIds).toEqual(["overlap-edge-1"]);

    const decision = (result.conclusions as { decision: Record<string, unknown> }).decision;
    expect(decision.overlapInstitution).toEqual([{ nodeId: "org-edu-1", label: "Example University", nodeType: "nonprofit" }]);
    expect(decision.simultaneity).toBe("unbounded_no_temporal_validity_on_affiliation_edges");
    expect(decision.recurrence).toBe("single_snapshot_not_tracked_over_time");
    expect(decision.interactionEvidence).toBe("co-membership_only_no_direct_interaction_evidence");
    expect(decision.overlapConfidence).toEqual([{ edgeId: "overlap-edge-1", confidence: 0.8 }]);
  });

  it("does not delegate to BEN-INT-04 when the shared organization has no institutionType=education flag", async () => {
    const shared = await commonMocks();
    vi.mocked(shared.getTenantContactProspectIds).mockResolvedValue([]);
    vi.mocked(shared.getNodesForProspectIds).mockResolvedValue([]);
    const { getPilClient } = await import("@/lib/pil/db");
    const { upsertEdge } = await import("@/lib/pil/graph");

    const org = orgNode("org-co-1", "Acme Corp", "company");
    const edgeA = affiliationEdge("edge-a", "person-a", "org-co-1", "employed_by");
    const edgeB = affiliationEdge("edge-b", "person-b", "org-co-1", "employed_by");
    vi.mocked(getPilClient).mockReturnValue(makeRel04Client([org], [edgeA, edgeB], []) as never);
    vi.mocked(upsertEdge).mockResolvedValue({ id: "overlap-edge-1", confidence: 0.8 } as never);

    const { OrganizationalOverlapAgent } = await import("@/lib/pil/agents/rel/BEN-REL-04");
    const agent = new OrganizationalOverlapAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-04", prospectId: null }) as never, {} as never);

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-INT-04")).toBe(false);
  });

  it("delegates to BEN-INT-05 (alongside the existing BEN-REL-06 delegation) for an ambiguous-sized board overlap", async () => {
    const shared = await commonMocks();
    vi.mocked(shared.getTenantContactProspectIds).mockResolvedValue([]);
    vi.mocked(shared.getNodesForProspectIds).mockResolvedValue([]);
    const { getPilClient } = await import("@/lib/pil/db");
    const { upsertEdge } = await import("@/lib/pil/graph");

    const org = orgNode("org-board-1", "Mid Size Foundation", "board");
    const memberEdges = Array.from({ length: 16 }, (_, i) => affiliationEdge(`edge-${i}`, `person-${i}`, "org-board-1", "serves_on_board_of", 0.6));
    vi.mocked(getPilClient).mockReturnValue(makeRel04Client([org], memberEdges, []) as never);
    vi.mocked(upsertEdge).mockResolvedValue({ id: "overlap-edge-x", confidence: 0.6 } as never);

    const { OrganizationalOverlapAgent } = await import("@/lib/pil/agents/rel/BEN-REL-04");
    const agent = new OrganizationalOverlapAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-04", prospectId: null }) as never, {} as never);

    const int05 = result.delegations.find((d) => d.childAgentCode === "BEN-INT-05");
    expect(int05).toBeDefined();
    expect((int05!.constraints as { organizationNodeId: string }).organizationNodeId).toBe("org-board-1");

    // Existing BEN-REL-06 ambiguous-band delegation must be preserved.
    const rel06 = result.delegations.find((d) => d.childAgentCode === "BEN-REL-06");
    expect(rel06).toBeDefined();
  });

  it("does not delegate to BEN-INT-05 when the shared-org group is small (not ambiguous)", async () => {
    const shared = await commonMocks();
    vi.mocked(shared.getTenantContactProspectIds).mockResolvedValue([]);
    vi.mocked(shared.getNodesForProspectIds).mockResolvedValue([]);
    const { getPilClient } = await import("@/lib/pil/db");
    const { upsertEdge } = await import("@/lib/pil/graph");

    const org = orgNode("org-board-2", "Small Board", "board");
    const edgeA = affiliationEdge("edge-a", "person-a", "org-board-2", "serves_on_board_of", 0.6);
    const edgeB = affiliationEdge("edge-b", "person-b", "org-board-2", "serves_on_board_of", 0.6);
    vi.mocked(getPilClient).mockReturnValue(makeRel04Client([org], [edgeA, edgeB], []) as never);
    vi.mocked(upsertEdge).mockResolvedValue({ id: "overlap-edge-y", confidence: 0.6 } as never);

    const { OrganizationalOverlapAgent } = await import("@/lib/pil/agents/rel/BEN-REL-04");
    const agent = new OrganizationalOverlapAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-04", prospectId: null }) as never, {} as never);

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-INT-05")).toBe(false);
    expect(result.delegations.some((d) => d.childAgentCode === "BEN-REL-06")).toBe(false);
  });

  it("does not delegate to BEN-KNW-03 when no overlap edges are created (every shared org has fewer than 2 members)", async () => {
    const shared = await commonMocks();
    vi.mocked(shared.getTenantContactProspectIds).mockResolvedValue([]);
    vi.mocked(shared.getNodesForProspectIds).mockResolvedValue([]);
    const { getPilClient } = await import("@/lib/pil/db");

    const org = orgNode("org-solo-1", "Solo Org", "company");
    const edgeA = affiliationEdge("edge-a", "person-a", "org-solo-1", "employed_by");
    vi.mocked(getPilClient).mockReturnValue(makeRel04Client([org], [edgeA], []) as never);

    const { OrganizationalOverlapAgent } = await import("@/lib/pil/agents/rel/BEN-REL-04");
    const agent = new OrganizationalOverlapAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-04", prospectId: null }) as never, {} as never);

    expect(result.delegations).toEqual([]);
    const decision = (result.conclusions as { decision: Record<string, unknown> }).decision;
    expect(decision.overlapInstitution).toEqual([]);
    expect(decision.overlapConfidence).toEqual([]);
  });

  it("delegates to BEN-REL-05 with the resolved prospectId when one overlap endpoint is a tenant contact node and the other endpoint is a prospect-owned node", async () => {
    const shared = await commonMocks();
    const tenantNode = memberNode("tenant-contact-node-1", "tc-prospect-1");
    vi.mocked(shared.getTenantContactProspectIds).mockResolvedValue(["tc-prospect-1"]);
    vi.mocked(shared.getNodesForProspectIds).mockResolvedValue([tenantNode] as never);
    const { getPilClient } = await import("@/lib/pil/db");
    const { upsertEdge } = await import("@/lib/pil/graph");

    const org = orgNode("org-co-2", "Shared Employer", "company");
    const edgeA = affiliationEdge("edge-a", "tenant-contact-node-1", "org-co-2", "employed_by");
    const edgeB = affiliationEdge("edge-b", "other-person-node-1", "org-co-2", "employed_by");
    const otherMemberNode = memberNode("other-person-node-1", "p-other");
    vi.mocked(getPilClient).mockReturnValue(makeRel04Client([org], [edgeA, edgeB], [tenantNode, otherMemberNode]) as never);
    vi.mocked(upsertEdge).mockResolvedValue({ id: "overlap-edge-z", confidence: 0.8 } as never);

    const { OrganizationalOverlapAgent } = await import("@/lib/pil/agents/rel/BEN-REL-04");
    const agent = new OrganizationalOverlapAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-04", prospectId: null }) as never, {} as never);

    const rel05 = result.delegations.find((d) => d.childAgentCode === "BEN-REL-05");
    expect(rel05).toBeDefined();
    expect(rel05!.constraints).toEqual({ prospectId: "p-other", sharedOrganizationNodeId: "org-co-2" });
  });

  it("does not delegate to BEN-REL-05 when the other overlap endpoint has no owning prospect_id", async () => {
    const shared = await commonMocks();
    const tenantNode = memberNode("tenant-contact-node-1", "tc-prospect-1");
    vi.mocked(shared.getTenantContactProspectIds).mockResolvedValue(["tc-prospect-1"]);
    vi.mocked(shared.getNodesForProspectIds).mockResolvedValue([tenantNode] as never);
    const { getPilClient } = await import("@/lib/pil/db");
    const { upsertEdge } = await import("@/lib/pil/graph");

    const org = orgNode("org-co-3", "Shared Employer 2", "company");
    const edgeA = affiliationEdge("edge-a", "tenant-contact-node-1", "org-co-3", "employed_by");
    const edgeB = affiliationEdge("edge-b", "unowned-person-node-1", "org-co-3", "employed_by");
    const unownedMemberNode = memberNode("unowned-person-node-1", null);
    vi.mocked(getPilClient).mockReturnValue(makeRel04Client([org], [edgeA, edgeB], [tenantNode, unownedMemberNode]) as never);
    vi.mocked(upsertEdge).mockResolvedValue({ id: "overlap-edge-w", confidence: 0.8 } as never);

    const { OrganizationalOverlapAgent } = await import("@/lib/pil/agents/rel/BEN-REL-04");
    const agent = new OrganizationalOverlapAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-04", prospectId: null }) as never, {} as never);

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-REL-05")).toBe(false);
  });
});

describe("BEN-REL-05 Warm Introduction Pathfinding Agent -- new delegations", () => {
  beforeEach(() => vi.resetAllMocks());

  const tenantContactNode = neighborNode("tc-node-1", "Acme Foundation", "foundation");

  function pathEdge(id: string, confidence = 0.6, relationship_strength = "moderate", is_current = true) {
    return {
      id,
      source_node_id: "primary-1",
      target_node_id: "tc-node-1",
      confidence,
      relationship_strength,
      is_current,
    };
  }

  async function mockCommonSetup() {
    const shared = await import("@/lib/pil/agents/rel/shared");
    const { traverseGraph } = await import("@/lib/pil/graph");
    vi.mocked(shared.getProspectById).mockResolvedValue(prospect as never);
    vi.mocked(shared.getPrimaryProspectNode).mockResolvedValue(primaryNode as never);
    vi.mocked(shared.getTenantContactProspectIds).mockResolvedValue(["tc1"] as never);
    vi.mocked(shared.getNodesForProspectIds).mockResolvedValue([tenantContactNode] as never);
    vi.mocked(shared.recordRelationshipEvidence).mockResolvedValue({ id: "ev-1" } as never);
    vi.mocked(shared.tryModelTokens).mockResolvedValue(0);
    vi.mocked(shared.pathConfidence).mockReturnValue(0.6);
    vi.mocked(shared.frictionEstimateForHops).mockReturnValue("low");
    vi.mocked(traverseGraph).mockResolvedValue({ nodes: [primaryNode, tenantContactNode], edges: [] } as never);
    return shared;
  }

  it("fans out to BEN-REL-01/02/03/04 with distinct objectives when no fresh path is found", async () => {
    const shared = await mockCommonSetup();
    vi.mocked(shared.reconstructShortestPaths).mockReturnValue(new Map() as never);

    const { WarmIntroductionPathfindingAgent } = await import("@/lib/pil/agents/rel/BEN-REL-05");
    const agent = new WarmIntroductionPathfindingAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-05" }) as never, {} as never);

    expect(result.status).toBe("completed");
    const targets = ["BEN-REL-01", "BEN-REL-02", "BEN-REL-03", "BEN-REL-04"];
    for (const code of targets) {
      const delegation = result.delegations.find((d) => d.childAgentCode === code);
      expect(delegation).toBeDefined();
      expect((delegation!.constraints as { prospectId: string }).prospectId).toBe("p1");
    }
    const objectives = new Set(result.delegations.filter((d) => targets.includes(d.childAgentCode)).map((d) => d.objective));
    expect(objectives.size).toBe(4);

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-KNW-03")).toBe(false);

    const decision = (result.conclusions as { decision: Record<string, unknown> }).decision;
    expect(decision.pathLength).toBeNull();
    expect(decision.edgeStrength).toBeNull();
    expect(decision.introductionFeasibility).toBe("no_path_found");
    expect(decision.targetIdentity).toBe("Jane Donor");
    expect(decision.sourceNodeAuthorization).toBe("tenant_crm_import_contact");
  });

  it("does not fan out to BEN-REL-01/02/03/04 when a fresh path is found", async () => {
    const shared = await mockCommonSetup();
    const edge1 = pathEdge("edge-1");
    vi.mocked(shared.reconstructShortestPaths).mockReturnValue(new Map([["tc-node-1", [edge1]]]) as never);
    vi.mocked(shared.refetchEdge).mockResolvedValue(edge1 as never);

    const { WarmIntroductionPathfindingAgent } = await import("@/lib/pil/agents/rel/BEN-REL-05");
    const agent = new WarmIntroductionPathfindingAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-05" }) as never, {} as never);

    for (const code of ["BEN-REL-01", "BEN-REL-02", "BEN-REL-03", "BEN-REL-04"]) {
      expect(result.delegations.some((d) => d.childAgentCode === code)).toBe(false);
    }
    expect(result.delegations.some((d) => d.childAgentCode === "BEN-KNW-03")).toBe(false);

    const decision = (result.conclusions as { decision: Record<string, unknown> }).decision;
    expect(decision.pathLength).toBe(1);
    expect((decision.edgeValidity as { reverifiedCurrentCount: number }).reverifiedCurrentCount).toBe(1);
    expect((decision.edgeValidity as { staleDroppedCount: number }).staleDroppedCount).toBe(0);
  });

  it("delegates to BEN-KNW-03 with the stale count and node ids when a candidate path goes stale on refetch, alongside another still-fresh path", async () => {
    const shared = await mockCommonSetup();
    const staleNode = neighborNode("tc-node-2", "Beta Foundation", "foundation");
    vi.mocked(shared.getNodesForProspectIds).mockResolvedValue([tenantContactNode, staleNode] as never);
    const freshEdge = pathEdge("edge-1");
    const staleEdge = { ...pathEdge("edge-2"), target_node_id: "tc-node-2" };
    vi.mocked(shared.reconstructShortestPaths).mockReturnValue(
      new Map([
        ["tc-node-1", [freshEdge]],
        ["tc-node-2", [staleEdge]],
      ]) as never,
    );
    vi.mocked(shared.refetchEdge).mockImplementation(async (id: string) => {
      if (id === "edge-2") return { ...staleEdge, is_current: false } as never;
      return freshEdge as never;
    });

    const { WarmIntroductionPathfindingAgent } = await import("@/lib/pil/agents/rel/BEN-REL-05");
    const agent = new WarmIntroductionPathfindingAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-05" }) as never, {} as never);

    for (const code of ["BEN-REL-01", "BEN-REL-02", "BEN-REL-03", "BEN-REL-04"]) {
      expect(result.delegations.some((d) => d.childAgentCode === code)).toBe(false);
    }
    const knw03 = result.delegations.find((d) => d.childAgentCode === "BEN-KNW-03");
    expect(knw03).toBeDefined();
    expect((knw03!.constraints as { staleTargetNodeIds: string[] }).staleTargetNodeIds).toEqual(["tc-node-2"]);
    expect((knw03!.constraints as { prospectId: string }).prospectId).toBe("p1");

    const decision = (result.conclusions as { decision: Record<string, unknown> }).decision;
    expect((decision.edgeValidity as { staleDroppedCount: number }).staleDroppedCount).toBe(1);
  });

  it("returns the completedEmpty early-return with no delegations when context.prospectId is null", async () => {
    const { WarmIntroductionPathfindingAgent } = await import("@/lib/pil/agents/rel/BEN-REL-05");
    const agent = new WarmIntroductionPathfindingAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-05", prospectId: null }) as never, {} as never);

    expect(result.status).toBe("completed");
    expect(result.delegations).toEqual([]);
    expect((result.conclusions as { skipped: boolean }).skipped).toBe(true);
  });
});

describe("BEN-REL-06 Relationship Strength Agent -- new delegations", () => {
  beforeEach(() => vi.resetAllMocks());

  function strengthEdge(
    id: string,
    overrides: Partial<{
      edge_type: string;
      relationship_strength: string | null;
      confidence: number | null;
      is_current: boolean;
      temporal_validity_end: string | null;
      properties: Record<string, unknown>;
      updated_at: string;
    }> = {},
  ) {
    return {
      id,
      organization_id: ORG_ID,
      source_node_id: "primary-1",
      target_node_id: `target-${id}`,
      edge_type: "related_to",
      relationship_strength: null,
      confidence: 0.3,
      temporal_validity_start: null,
      temporal_validity_end: null,
      is_current: true,
      superseded_by_edge_id: null,
      properties: {},
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  function evidenceFor(edgeId: string, verification_status: string, confidence = 0.3) {
    return {
      id: `ev-${edgeId}-${verification_status}`,
      organization_id: ORG_ID,
      entity_id: edgeId,
      entity_table: "pil_graph_edges",
      claim: "test claim",
      value: null,
      claim_type: "test",
      source_url: null,
      source_title: null,
      source_type: "open_web",
      publisher: null,
      retrieved_at: "2026-01-01T00:00:00Z",
      published_at: null,
      last_verified_at: "2026-01-01T00:00:00Z",
      evidence_excerpt: null,
      confidence,
      verification_status,
      freshness_status: "fresh",
      inference_status: "direct",
      contradiction_status: "none",
      lineage: [],
      created_at: "2026-01-01T00:00:00Z",
    };
  }

  /**
   * BEN-REL-06 issues several distinct getPilClient() calls against
   * pil_graph_edges -- three reads in a fixed order (as-source, as-target,
   * org-connections) plus one write (per-edge `.update()`) inside the
   * scoring loop. Each `.from("pil_graph_edges")` call gets its own chain
   * instance, so an update chain is distinguished from a read chain by
   * whether `.update()` was invoked on it before `.then()` resolves --
   * only read chains advance the read-call counter.
   */
  function makeRel06Client(opts: { edges: unknown[]; endpointNodes?: unknown[]; evidence?: unknown[]; orgConnectionEdges?: unknown[] }) {
    let graphEdgeReadCalls = 0;
    return {
      from: vi.fn((table: string) => {
        if (table === "pil_graph_edges") {
          let isUpdate = false;
          const chain: Record<string, unknown> = {
            select: vi.fn(() => chain),
            eq: vi.fn(() => chain),
            in: vi.fn(() => chain),
            update: vi.fn(() => {
              isUpdate = true;
              return chain;
            }),
            then: (resolve: (v: unknown) => void) => {
              if (isUpdate) return Promise.resolve({ data: null, error: null }).then(resolve);
              graphEdgeReadCalls++;
              // Call order: 1) as source, 2) as target, 3) org-connections lookup.
              if (graphEdgeReadCalls === 1) return Promise.resolve({ data: opts.edges, error: null }).then(resolve);
              if (graphEdgeReadCalls === 2) return Promise.resolve({ data: [], error: null }).then(resolve);
              return Promise.resolve({ data: opts.orgConnectionEdges ?? [], error: null }).then(resolve);
            },
          };
          return chain;
        }
        if (table === "pil_graph_nodes") {
          const chain: Record<string, unknown> = {
            select: vi.fn(() => chain),
            eq: vi.fn(() => chain),
            in: vi.fn(() => chain),
            then: (resolve: (v: unknown) => void) => Promise.resolve({ data: opts.endpointNodes ?? [], error: null }).then(resolve),
          };
          return chain;
        }
        if (table === "pil_evidence") {
          const chain: Record<string, unknown> = {
            select: vi.fn(() => chain),
            eq: vi.fn(() => chain),
            in: vi.fn(() => chain),
            then: (resolve: (v: unknown) => void) => Promise.resolve({ data: opts.evidence ?? [], error: null }).then(resolve),
          };
          return chain;
        }
        throw new Error(`BEN-REL-06 test client: unexpected table ${table}`);
      }),
    };
  }

  async function mockGraphNodesByProspect() {
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    vi.mocked(getNodesByProspect).mockResolvedValue([primaryNode] as never);
  }

  it("delegates to BEN-KNW-03 when an edge has contradicted evidence", async () => {
    await mockGraphNodesByProspect();
    const { getPilClient } = await import("@/lib/pil/db");
    const shared = await import("@/lib/pil/agents/rel/shared");
    vi.mocked(shared.tryModelTokens).mockResolvedValue(0);

    const edge = strengthEdge("edge-1");
    const evidence = [evidenceFor("edge-1", "contradicted", 0.4)];
    vi.mocked(getPilClient).mockReturnValue(makeRel06Client({ edges: [edge], evidence }) as never);

    const { RelationshipStrengthAgent } = await import("@/lib/pil/agents/rel/BEN-REL-06");
    const agent = new RelationshipStrengthAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-06" }) as never, {} as never);

    expect(result.status).toBe("completed");
    const knw03 = result.delegations.find((d) => d.childAgentCode === "BEN-KNW-03");
    expect(knw03).toBeDefined();
    expect((knw03!.constraints as { edgeIds: string[] }).edgeIds).toEqual(["edge-1"]);

    const decisionDimensions = (result.conclusions as { decisionDimensions: Record<string, unknown> }).decisionDimensions;
    expect(decisionDimensions["edge-1"]).toMatchObject({
      duration: "unmodeled_no_start_end_interval_tracked_on_this_edge_type",
      mutuality: "unmodeled_edges_are_directional_not_bidirectionally_confirmed",
    });
  });

  it("does not delegate to BEN-KNW-03 when an edge's evidence is uniform and non-contradicted", async () => {
    await mockGraphNodesByProspect();
    const { getPilClient } = await import("@/lib/pil/db");
    const shared = await import("@/lib/pil/agents/rel/shared");
    vi.mocked(shared.tryModelTokens).mockResolvedValue(0);

    const edge = strengthEdge("edge-1");
    const evidence = [evidenceFor("edge-1", "verified_fact", 0.9)];
    vi.mocked(getPilClient).mockReturnValue(makeRel06Client({ edges: [edge], evidence }) as never);

    const { RelationshipStrengthAgent } = await import("@/lib/pil/agents/rel/BEN-REL-06");
    const agent = new RelationshipStrengthAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-06" }) as never, {} as never);

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-KNW-03")).toBe(false);
  });

  it("delegates to BEN-REL-01 when an edge scores speculative on thin, indirect evidence", async () => {
    await mockGraphNodesByProspect();
    const { getPilClient } = await import("@/lib/pil/db");
    const shared = await import("@/lib/pil/agents/rel/shared");
    vi.mocked(shared.tryModelTokens).mockResolvedValue(0);

    // No evidence at all -> bestEvidence null -> indirect, evidenceStrength
    // falls back to edge.confidence (0.2, below the 0.35 threshold), low
    // score -> speculative label.
    const edge = strengthEdge("edge-1", { confidence: 0.2, is_current: false });
    vi.mocked(getPilClient).mockReturnValue(makeRel06Client({ edges: [edge], evidence: [] }) as never);

    const { RelationshipStrengthAgent } = await import("@/lib/pil/agents/rel/BEN-REL-06");
    const agent = new RelationshipStrengthAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-06" }) as never, {} as never);

    const rel01 = result.delegations.find((d) => d.childAgentCode === "BEN-REL-01");
    expect(rel01).toBeDefined();
    expect((rel01!.constraints as { prospectId: string; weakEdgeIds: string[] }).prospectId).toBe("p1");
    expect((rel01!.constraints as { weakEdgeIds: string[] }).weakEdgeIds).toEqual(["edge-1"]);
  });

  it("does not delegate to BEN-REL-01 when the edge scores well above speculative", async () => {
    await mockGraphNodesByProspect();
    const { getPilClient } = await import("@/lib/pil/db");
    const shared = await import("@/lib/pil/agents/rel/shared");
    vi.mocked(shared.tryModelTokens).mockResolvedValue(0);

    const edge = strengthEdge("edge-1", { edge_type: "serves_on_board_of" });
    const evidence = [evidenceFor("edge-1", "verified_fact", 0.95)];
    vi.mocked(getPilClient).mockReturnValue(makeRel06Client({ edges: [edge], evidence }) as never);

    const { RelationshipStrengthAgent } = await import("@/lib/pil/agents/rel/BEN-REL-06");
    const agent = new RelationshipStrengthAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-06" }) as never, {} as never);

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-REL-01")).toBe(false);
  });

  it("delegates to BEN-QLF-04 when an edge's relationship_strength tier jumps 2+ ranks", async () => {
    await mockGraphNodesByProspect();
    const { getPilClient } = await import("@/lib/pil/db");
    const shared = await import("@/lib/pil/agents/rel/shared");
    vi.mocked(shared.tryModelTokens).mockResolvedValue(0);

    // Previously "speculative" (rank 0), strong evidence now pushes it to
    // "strong" or higher (rank 3+) -- a jump of >= 2.
    const edge = strengthEdge("edge-1", { edge_type: "serves_on_board_of", relationship_strength: "speculative" });
    const evidence = [evidenceFor("edge-1", "verified_fact", 0.95)];
    vi.mocked(getPilClient).mockReturnValue(makeRel06Client({ edges: [edge], evidence }) as never);

    const { RelationshipStrengthAgent } = await import("@/lib/pil/agents/rel/BEN-REL-06");
    const agent = new RelationshipStrengthAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-06" }) as never, {} as never);

    const qlf04 = result.delegations.find((d) => d.childAgentCode === "BEN-QLF-04");
    expect(qlf04).toBeDefined();
    expect((qlf04!.constraints as { prospectId: string; materiallyChangedEdgeIds: string[] }).prospectId).toBe("p1");
    expect((qlf04!.constraints as { materiallyChangedEdgeIds: string[] }).materiallyChangedEdgeIds).toEqual(["edge-1"]);
  });

  it("does not delegate to BEN-QLF-04 when the tier shift is only 1 rank", async () => {
    await mockGraphNodesByProspect();
    const { getPilClient } = await import("@/lib/pil/db");
    const shared = await import("@/lib/pil/agents/rel/shared");
    vi.mocked(shared.tryModelTokens).mockResolvedValue(0);

    // Previously "weak" (rank 1); no evidence (evidenceStrength falls back
    // to edge.confidence 0.5), current, nominal edge_type -> score 3.5
    // ("moderate", rank 2) -- a 1-rank shift, below the material-change
    // threshold.
    const edge = strengthEdge("edge-1", { relationship_strength: "weak", confidence: 0.5 });
    vi.mocked(getPilClient).mockReturnValue(makeRel06Client({ edges: [edge], evidence: [] }) as never);

    const { RelationshipStrengthAgent } = await import("@/lib/pil/agents/rel/BEN-REL-06");
    const agent = new RelationshipStrengthAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-06" }) as never, {} as never);

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-QLF-04")).toBe(false);
  });

  it("returns the completedEmpty early-return with no delegations when context.prospectId is null", async () => {
    const { RelationshipStrengthAgent } = await import("@/lib/pil/agents/rel/BEN-REL-06");
    const agent = new RelationshipStrengthAgent();
    const result = await agent.execute(baseContext({ agentCode: "BEN-REL-06", prospectId: null }) as never, {} as never);

    expect(result.status).toBe("completed");
    expect(result.delegations).toEqual([]);
    expect((result.conclusions as { skipped: boolean }).skipped).toBe(true);
  });
});
