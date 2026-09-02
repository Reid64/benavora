// Unit tests for BEN-STR-01 (Prospect Engagement Strategy Agent). Everything
// is mocked -- no real DB calls, matching pil-qlf-knw-agents.test.ts's
// convention (mocking setup and makeClient()/baseContext() helpers copied
// verbatim from that file, with baseContext()'s default agentCode updated to
// "BEN-STR-01").
import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG_ID = "11111111-2222-3333-4444-555555555555";

vi.mock("@/lib/pil/db", () => ({ getPilClient: vi.fn() }));
vi.mock("@/lib/pil/evidence", () => ({
  getEvidence: vi.fn(),
  detectContradiction: vi.fn(),
  recordContradiction: vi.fn(),
  getProvenanceHash: vi.fn(() => "fixed-hash"),
}));
vi.mock("@/lib/pil/graph", () => ({ getNodesByProspect: vi.fn(), getEdges: vi.fn() }));
vi.mock("@/lib/pil/monitoring", () => ({ getEvents: vi.fn() }));
vi.mock("@/lib/pil/human-review", () => ({ createReviewItem: vi.fn() }));
vi.mock("@/lib/pil/audit", () => ({ logAction: vi.fn() }));

function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    agentCode: "BEN-STR-01",
    orgId: ORG_ID,
    prospectId: null,
    runId: "run-1",
    goal: "test goal",
    plan: {},
    tools: [] as string[],
    budget: 1000,
    depth: 1,
    ...overrides,
  };
}

type MockResponse = { data: unknown; error: unknown };
type RecordedCall = { table: string; method: "insert" | "update"; payload: unknown };

/** Chainable Supabase-client mock, table-keyed. Records every insert/update payload into `calls` for assertions. Responses can be a single {data,error} (repeats) or an array consumed in call order (last entry repeats). */
function makeClient(responses: Record<string, MockResponse | MockResponse[]>, calls: RecordedCall[] = []) {
  const callCounts: Record<string, number> = {};
  const resolveFor = (table: string): MockResponse => {
    const entry = responses[table];
    if (Array.isArray(entry)) {
      const idx = callCounts[table] ?? 0;
      callCounts[table] = idx + 1;
      return entry[Math.min(idx, entry.length - 1)] ?? { data: null, error: null };
    }
    return entry ?? { data: null, error: null };
  };
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
      in: vi.fn(() => c),
      or: vi.fn(() => c),
      is: vi.fn(() => c),
      order: vi.fn(() => c),
      limit: vi.fn(() => c),
      maybeSingle: vi.fn(() => Promise.resolve(resolveFor(table))),
      single: vi.fn(() => Promise.resolve(resolveFor(table))),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(resolveFor(table)).then(resolve, reject),
    };
    return c;
  };
  return { client: { from: vi.fn((table: string) => chain(table)) }, calls };
}

describe("BEN-STR-01 Prospect Engagement Strategy Agent", () => {
  beforeEach(() => vi.resetAllMocks());

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

  it("recommends a cultivate strategy and delegates to BEN-STR-03 when classification is tier_2_cultivate with no strong relationship edge", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { logAction } = await import("@/lib/pil/audit");

    const missionEvidence = {
      id: "ev-mission",
      organization_id: ORG_ID,
      entity_id: "p1",
      entity_table: "pil_prospects",
      claim: "Board statement names housing stability as a top cause priority",
      value: null,
      claim_type: "cause_statement_or_board_signal",
      source_url: "https://example.com/board",
      source_title: "Board priorities",
      source_type: "open_web",
      publisher: null,
      retrieved_at: "2026-08-01T00:00:00Z",
      published_at: "2026-08-01T00:00:00Z",
      last_verified_at: null,
      evidence_excerpt: "excerpt",
      agent_id: "BEN-DIS-07",
      research_run_id: "run-1",
      confidence: 0.8,
      verification_status: "verified_fact",
      freshness_status: "fresh",
      inference_status: "direct",
      contradiction_status: "none",
      lineage: [],
      created_at: "2026-08-01T00:00:00Z",
    };

    vi.mocked(getEvidence).mockResolvedValue([missionEvidence] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never); // no graph nodes -> relationshipPathScore 0, no strong edge
    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const opportunity = {
      id: "opp-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      classification: "tier_2_cultivate",
      mission_affinity_score: 0.7,
      capacity_estimate_low: null,
      capacity_estimate_high: null,
      recommended_ask_low: null,
      recommended_ask_high: null,
      timing_status: null,
      engagement_strategy: null,
      confidence: 0.7,
      qualified_by_agent_id: "BEN-QLF-04",
      qualified_at: "2026-08-01T00:00:00Z",
      status: "open",
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    };
    const updatedOpportunity = { ...opportunity, engagement_strategy: "cultivate:warm_introduction+email+phone" };

    const { client, calls } = makeClient({
      pil_prospect_opportunities: [
        { data: opportunity, error: null }, // findOpportunity
        { data: updatedOpportunity, error: null }, // updateEngagementStrategy
      ],
      pil_prospects: { data: prospect, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ProspectEngagementStrategyAgent } = await import("@/lib/pil/agents/str/BEN-STR-01");
    const agent = new ProspectEngagementStrategyAgent();
    const context = baseContext({ agentCode: "BEN-STR-01", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    expect(result.status).toBe("completed");
    expect(result.delegations).toContainEqual(expect.objectContaining({ childAgentCode: "BEN-STR-03" }));

    const report = (
      result.conclusions as { report: { objective: string; engagementStrategy: string; messageThemes: string[]; relationshipPathScore: number } }
    ).report;
    expect(report.objective).toBe("cultivate");
    expect(report.engagementStrategy.startsWith("cultivate:")).toBe(true);
    expect(report.messageThemes).toContain("mission_alignment");
    expect(report.relationshipPathScore).toBe(0);

    const updateCall = calls.find((c) => c.table === "pil_prospect_opportunities" && c.method === "update");
    expect(updateCall).toBeDefined();
    expect((updateCall!.payload as { engagement_strategy: string }).engagement_strategy.startsWith("cultivate:")).toBe(true);

    // objective is "cultivate" (not "solicit"), and evidence confidence (0.8) is
    // above the low-confidence threshold, so no risk should be flagged here.
    expect(vi.mocked(createReviewItem)).not.toHaveBeenCalled();
  });

  it("early-returns a skipped/completed result with no update or insert when no pil_prospect_opportunities row exists yet", async () => {
    const { getPilClient } = await import("@/lib/pil/db");

    const { client, calls } = makeClient({
      pil_prospect_opportunities: { data: null, error: null }, // find: none exists yet
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ProspectEngagementStrategyAgent } = await import("@/lib/pil/agents/str/BEN-STR-01");
    const agent = new ProspectEngagementStrategyAgent();
    const context = baseContext({ agentCode: "BEN-STR-01", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    expect(result.status).toBe("completed");
    expect((result.conclusions as { skipped: boolean }).skipped).toBe(true);
    expect(result.delegations).toEqual([]);

    const opportunityWrite = calls.find(
      (c) => c.table === "pil_prospect_opportunities" && (c.method === "update" || c.method === "insert"),
    );
    expect(opportunityWrite).toBeUndefined();
  });
});

describe("BEN-STR-02 Best First Ask Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  function capacityEvidence(confidence: number) {
    return {
      id: "ev-capacity",
      organization_id: ORG_ID,
      entity_id: "p1",
      entity_table: "pil_prospects",
      claim: "Wealth capacity signal",
      value: null,
      claim_type: "wealth_capacity",
      source_url: "https://example.com/wealth",
      source_title: "Wealth screen",
      source_type: "open_web",
      publisher: null,
      retrieved_at: "2026-08-01T00:00:00Z",
      published_at: "2026-08-01T00:00:00Z",
      last_verified_at: null,
      evidence_excerpt: "excerpt",
      agent_id: "BEN-INT-08",
      research_run_id: "run-1",
      confidence,
      verification_status: "verified_fact",
      freshness_status: "fresh",
      inference_status: "direct",
      contradiction_status: "none",
      lineage: [],
      created_at: "2026-08-01T00:00:00Z",
    };
  }

  function propensityEvidence(confidence: number) {
    return {
      ...capacityEvidence(confidence),
      id: "ev-propensity",
      claim: "Documented giving history",
      claim_type: "giving_history",
      agent_id: "BEN-INT-07",
    };
  }

  it("recommends an annual_gift_ask at mid-tier capacity/propensity and updates the 40-69 ask band", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { logAction } = await import("@/lib/pil/audit");

    // confidence 0.55 * VERIFICATION_WEIGHT.verified_fact (1) -> scoreDimension
    // = round((0.55*0.6 + 0.55*0.4)*100) = 55, inside the 40-69 band for both
    // capacityScore and propensityScore -> annual_gift_ask (capacityScore>=40,
    // not both >=70).
    vi.mocked(getEvidence).mockResolvedValue([capacityEvidence(0.55), propensityEvidence(0.55)] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const opportunity = {
      id: "opp-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      classification: "tier_2_cultivate",
      mission_affinity_score: 0.5,
      capacity_estimate_low: null,
      capacity_estimate_high: null,
      recommended_ask_low: null,
      recommended_ask_high: null,
      timing_status: null,
      engagement_strategy: "cultivate:warm_introduction+email+phone",
      confidence: 0.6,
      qualified_by_agent_id: "BEN-QLF-04",
      qualified_at: "2026-08-01T00:00:00Z",
      status: "open",
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    };
    const updatedOpportunity = { ...opportunity, recommended_ask_low: 2500, recommended_ask_high: 10000 };

    const { client, calls } = makeClient({
      pil_prospect_opportunities: [
        { data: opportunity, error: null }, // findOpportunity
        { data: updatedOpportunity, error: null }, // updateAskRange
      ],
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { BestFirstAskAgent } = await import("@/lib/pil/agents/str/BEN-STR-02");
    const agent = new BestFirstAskAgent();
    const context = baseContext({ agentCode: "BEN-STR-02", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    expect(result.status).toBe("completed");

    const report = (result.conclusions as { report: { askType: string; recommendedAskLow: number | null; recommendedAskHigh: number | null } })
      .report;
    expect(report.askType).toBe("annual_gift_ask");
    expect(report.recommendedAskLow).toBe(2500);
    expect(report.recommendedAskHigh).toBe(10000);

    expect(createReviewItem).toHaveBeenCalledTimes(1);
    expect(createReviewItem).toHaveBeenCalledWith(expect.objectContaining({ priority: "normal" }));

    const updateCall = calls.find((c) => c.table === "pil_prospect_opportunities" && c.method === "update");
    expect(updateCall).toBeDefined();
    expect(updateCall!.payload).toMatchObject({ recommended_ask_low: 2500, recommended_ask_high: 10000 });
  });

  it("still creates a review item at the lowest tier (discovery_meeting_request), proving H1 is unconditional, and leaves the ask band null", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockResolvedValue([] as never); // no evidence -> capacityScore/propensityScore both 0
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const opportunity = {
      id: "opp-2",
      organization_id: ORG_ID,
      prospect_id: "p2",
      classification: "research_more",
      mission_affinity_score: null,
      capacity_estimate_low: null,
      capacity_estimate_high: null,
      recommended_ask_low: null,
      recommended_ask_high: null,
      timing_status: null,
      engagement_strategy: null,
      confidence: null,
      qualified_by_agent_id: "BEN-QLF-04",
      qualified_at: "2026-08-01T00:00:00Z",
      status: "open",
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    };
    const updatedOpportunity = { ...opportunity, recommended_ask_low: null, recommended_ask_high: null };

    const { client } = makeClient({
      pil_prospect_opportunities: [
        { data: opportunity, error: null }, // findOpportunity
        { data: updatedOpportunity, error: null }, // updateAskRange
      ],
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { BestFirstAskAgent } = await import("@/lib/pil/agents/str/BEN-STR-02");
    const agent = new BestFirstAskAgent();
    const context = baseContext({ agentCode: "BEN-STR-02", prospectId: "p2" });

    const result = await agent.execute(context as never, {} as never);

    expect(result.status).toBe("completed");

    const report = (result.conclusions as { report: { askType: string; recommendedAskLow: number | null; recommendedAskHigh: number | null } })
      .report;
    expect(report.askType).toBe("discovery_meeting_request");
    expect(report.recommendedAskLow).toBeNull();
    expect(report.recommendedAskHigh).toBeNull();

    // Unconditional H1 behavior -- unlike BEN-QLF-04's threshold-gated
    // createReviewItem, this fires even at the lowest tier / zero score.
    expect(createReviewItem).toHaveBeenCalledTimes(1);
    expect(createReviewItem).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: "BEN-STR-02 recommendation only -- H1, final solicitation decision always remains human.",
      }),
    );
  });
});

describe("BEN-STR-03 Cultivation Strategy Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  const opportunity = {
    id: "opp-1",
    organization_id: ORG_ID,
    prospect_id: "p1",
    classification: "tier_2_cultivate",
    mission_affinity_score: 0.5,
    capacity_estimate_low: null,
    capacity_estimate_high: null,
    recommended_ask_low: null,
    recommended_ask_high: null,
    timing_status: null,
    engagement_strategy: "cultivate:warm_introduction+email+phone",
    confidence: 0.6,
    qualified_by_agent_id: "BEN-QLF-04",
    qualified_at: "2026-08-01T00:00:00Z",
    status: "open",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  };

  it("creates a 4-stage cultivation plan and delegates to BEN-STR-04 with maxAutonomy A2", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockResolvedValue([] as never); // no evidence -> every checked dimension is below threshold
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never); // no graph nodes -> no warm edge -> shared_content_outreach
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const insertedPlan = {
      id: "plan-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      opportunity_id: "opp-1",
      stages: ["identify_shared_ground", "warm_introduction_or_first_touch", "deepen_engagement", "readiness_reassessment"],
      milestones: [],
      content_evidence_needs: [],
      reassessment_gates: [],
      next_reassessment_at: "2027-02-24T00:00:00Z",
      created_by_agent_id: "BEN-STR-03",
      status: "active",
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    };

    const { client, calls } = makeClient({
      pil_prospect_opportunities: { data: opportunity, error: null }, // findOpportunity
      pil_cultivation_plans: [
        { data: null, error: null }, // findActivePlan: none exists yet
        { data: insertedPlan, error: null }, // upsertPlan insert
      ],
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { CultivationStrategyAgent } = await import("@/lib/pil/agents/str/BEN-STR-03");
    const agent = new CultivationStrategyAgent();
    const context = baseContext({ agentCode: "BEN-STR-03", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    expect(result.status).toBe("completed");
    expect(result.delegations).toContainEqual(
      expect.objectContaining({ childAgentCode: "BEN-STR-04", maxAutonomy: "A2" }),
    );

    const report = (
      result.conclusions as { report: { stages: string[]; planId: string } }
    ).report;
    expect(report.stages).toHaveLength(4);
    expect(report.planId).toBe("plan-1");

    const insertCall = calls.find((c) => c.table === "pil_cultivation_plans" && c.method === "insert");
    expect(insertCall).toBeDefined();
    expect((insertCall!.payload as { milestones: unknown[] }).milestones).toHaveLength(4);
  });

  it("early-returns a skipped/completed result with no pil_cultivation_plans write when no pil_prospect_opportunities row exists yet", async () => {
    const { getPilClient } = await import("@/lib/pil/db");

    const { client, calls } = makeClient({
      pil_prospect_opportunities: { data: null, error: null }, // find: none exists yet
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { CultivationStrategyAgent } = await import("@/lib/pil/agents/str/BEN-STR-03");
    const agent = new CultivationStrategyAgent();
    const context = baseContext({ agentCode: "BEN-STR-03", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    expect(result.status).toBe("completed");
    expect((result.conclusions as { skipped: boolean }).skipped).toBe(true);
    expect(result.delegations).toEqual([]);

    const planWrite = calls.find(
      (c) => c.table === "pil_cultivation_plans" && (c.method === "update" || c.method === "insert"),
    );
    expect(planWrite).toBeUndefined();
  });
});

describe("BEN-STR-04 Next-Best-Action Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("recommends solicit_now in single-prospect mode, creates an urgent review, and delegates to BEN-SUP-05 at maxAutonomy A2", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { getEvents } = await import("@/lib/pil/monitoring");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockResolvedValue([] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never); // no graph nodes -> relationshipPathScore 0 -> risk flagged
    vi.mocked(getEvents).mockResolvedValue([] as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const opportunity = {
      id: "opp-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      classification: "tier_1_priority",
      mission_affinity_score: 0.8,
      capacity_estimate_low: null,
      capacity_estimate_high: null,
      recommended_ask_low: 25000,
      recommended_ask_high: 100000,
      timing_status: "approach_now",
      engagement_strategy: "solicit:formal_application+program_officer_contact",
      confidence: 0.85,
      qualified_by_agent_id: "BEN-QLF-04",
      qualified_at: "2026-08-01T00:00:00Z",
      status: "open",
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    };

    const { client } = makeClient({
      pil_prospect_opportunities: { data: opportunity, error: null }, // findOpenOpportunity
      pil_cultivation_plans: { data: null, error: null }, // findActiveCultivationPlan: none
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { NextBestActionAgent } = await import("@/lib/pil/agents/str/BEN-STR-04");
    const agent = new NextBestActionAgent();
    const context = baseContext({ agentCode: "BEN-STR-04", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    expect(result.status).toBe("completed");

    const recommendation = (result.conclusions as { recommendation: { action: string; opportunityId: string } }).recommendation;
    expect(recommendation.action).toBe("solicit_now");
    expect(recommendation.opportunityId).toBe("opp-1");

    expect(createReviewItem).toHaveBeenCalledWith(expect.objectContaining({ priority: "urgent", review_type: "high_impact_action" }));
    expect(result.delegations).toContainEqual(
      expect.objectContaining({ childAgentCode: "BEN-SUP-05", maxAutonomy: "A2" }),
    );
  });

  it("produces one recommendation per open opportunity in org-wide mode and creates at least one review item", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { getEvents } = await import("@/lib/pil/monitoring");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockResolvedValue([] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(getEvents).mockResolvedValue([] as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const opportunityA = {
      id: "opp-a",
      organization_id: ORG_ID,
      prospect_id: "p1",
      classification: "research_more",
      mission_affinity_score: null,
      capacity_estimate_low: null,
      capacity_estimate_high: null,
      recommended_ask_low: null,
      recommended_ask_high: null,
      timing_status: null,
      engagement_strategy: null,
      confidence: null,
      qualified_by_agent_id: "BEN-QLF-04",
      qualified_at: "2026-08-01T00:00:00Z",
      status: "open",
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    };
    const opportunityB = {
      ...opportunityA,
      id: "opp-b",
      prospect_id: "p2",
      classification: "tier_1_priority",
      recommended_ask_low: 10000,
      recommended_ask_high: 25000,
      engagement_strategy: "solicit:formal_application+program_officer_contact",
    };

    const { client } = makeClient({
      pil_prospect_opportunities: { data: [opportunityA, opportunityB], error: null }, // findOpenOpportunitiesOrgWide
      pil_cultivation_plans: { data: null, error: null }, // findActiveCultivationPlan (x2): none
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { NextBestActionAgent } = await import("@/lib/pil/agents/str/BEN-STR-04");
    const agent = new NextBestActionAgent();
    const context = baseContext({ agentCode: "BEN-STR-04", prospectId: null });

    const result = await agent.execute(context as never, {} as never);

    expect(result.status).toBe("completed");

    const conclusions = result.conclusions as { recommendations: unknown[]; batchCapped: boolean };
    expect(conclusions.recommendations).toHaveLength(2);
    expect(conclusions.batchCapped).toBe(false);
    expect(createReviewItem).toHaveBeenCalled();
  });

  it("returns an empty recommendations array with a completed status and no throw when zero opportunities are open org-wide", async () => {
    const { getPilClient } = await import("@/lib/pil/db");

    const { client } = makeClient({
      pil_prospect_opportunities: { data: [], error: null }, // findOpenOpportunitiesOrgWide: none open
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { NextBestActionAgent } = await import("@/lib/pil/agents/str/BEN-STR-04");
    const agent = new NextBestActionAgent();
    const context = baseContext({ agentCode: "BEN-STR-04", prospectId: null });

    const result = await agent.execute(context as never, {} as never);

    expect(result.status).toBe("completed");
    const conclusions = result.conclusions as { recommendations: unknown[]; batchCapped: boolean };
    expect(conclusions.recommendations).toEqual([]);
    expect(conclusions.batchCapped).toBe(false);
  });
});
