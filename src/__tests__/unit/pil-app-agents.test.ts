// Unit tests for BEN-APP-01 (Application Profile Orchestrator). Everything is
// mocked -- no real DB calls, matching pil-qlf-knw-agents.test.ts's convention
// exactly (same chainable Supabase-client mock shape).
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
    agentCode: "BEN-APP-01",
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
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(resolveFor(table)).then(resolve, reject),
    };
    return c;
  };
  return { client: { from: vi.fn((table: string) => chain(table)) }, calls };
}

function baseProspect(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function baseRequestProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-1",
    organization_id: ORG_ID,
    name: "General Monetary Gifts",
    request_type: "monetary",
    priority: 100,
    active: true,
    needs_description: "General operating support",
    specific_requirements: {},
    target_funder_categories: null,
    target_funder_types: null,
    pitch_template: null,
    form_field_overrides: {},
    success_criteria: null,
    min_value: null,
    max_value: null,
    value_unit: "usd",
    geographic_requirements: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function baseEvidenceItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "ev-1",
    organization_id: ORG_ID,
    entity_id: "p1",
    entity_table: "pil_prospects",
    claim: "placeholder claim",
    value: null,
    claim_type: "giving_history",
    source_url: null,
    source_title: null,
    source_type: "open_web",
    publisher: null,
    retrieved_at: "2026-08-01T00:00:00Z",
    published_at: null,
    last_verified_at: null,
    evidence_excerpt: null,
    agent_id: "BEN-INT-07",
    research_run_id: "run-1",
    confidence: 0.7,
    verification_status: "single_source_fact",
    freshness_status: "fresh",
    inference_status: "direct",
    contradiction_status: "none",
    lineage: [],
    created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("BEN-APP-01 Application Profile Orchestrator", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns a skipped/completed result when prospectId is missing", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    vi.mocked(getPilClient).mockReturnValue({ from: vi.fn() } as never);

    const { ApplicationProfileOrchestratorAgent } = await import("@/lib/pil/agents/app/BEN-APP-01");
    const agent = new ApplicationProfileOrchestratorAgent();
    const context = baseContext({ prospectId: null });

    const result = await agent.execute(context as never, {} as never);

    expect(result.status).toBe("completed");
    expect((result.conclusions as { skipped: boolean }).skipped).toBe(true);
    expect(result.delegations).toEqual([]);
  });

  it("returns skipped/completed when the prospect does not exist", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { client } = makeClient({ pil_prospects: { data: null, error: null } });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ApplicationProfileOrchestratorAgent } = await import("@/lib/pil/agents/app/BEN-APP-01");
    const agent = new ApplicationProfileOrchestratorAgent();
    const context = baseContext({ prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    expect(result.status).toBe("completed");
    expect((result.conclusions as { skipped: boolean; reason: string }).reason).toContain("not found");
  });

  it("returns skipped/completed with no recommendations when the org has no active request_profiles", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { client } = makeClient({
      pil_prospects: { data: baseProspect(), error: null },
      request_profiles: { data: [], error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ApplicationProfileOrchestratorAgent } = await import("@/lib/pil/agents/app/BEN-APP-01");
    const agent = new ApplicationProfileOrchestratorAgent();
    const context = baseContext({ prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const conclusions = result.conclusions as { skipped: boolean; recommendations: unknown[] };
    expect(conclusions.skipped).toBe(true);
    expect(conclusions.recommendations).toEqual([]);
  });

  it("produces a low success_probability -> 'monitor' recommendation when every dimension falls back to the 0.5 default, and delegates to all four siblings", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockResolvedValue([] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const { client, calls } = makeClient({
      pil_prospects: { data: baseProspect(), error: null },
      request_profiles: { data: [baseRequestProfile()], error: null },
      pil_prospect_opportunities: { data: null, error: null },
      pil_mission_affinity_assessments: { data: null, error: null },
      pil_funding_eligibility_assessments: { data: null, error: null },
      pil_capacity_propensity_assessments: { data: null, error: null },
      pil_timing_readiness_assessments: { data: null, error: null },
      pil_application_profiles: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ApplicationProfileOrchestratorAgent } = await import("@/lib/pil/agents/app/BEN-APP-01");
    const agent = new ApplicationProfileOrchestratorAgent();
    const context = baseContext({ prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (
      result.conclusions as {
        report: {
          recommendations: Array<{ successProbability: number; recommendationStatus: string; confidence: number }>;
          fallbackDimensions: string[];
        };
      }
    ).report;

    expect(report.fallbackDimensions.sort()).toEqual(["affinity", "capacity", "relationship", "timing"]);
    expect(report.recommendations).toHaveLength(1);
    // baseScore is exactly 0.5 (all four dimensions at the 0.5 fallback), then
    // discounted by the 0.85 "capacity fit unknown" multiplier (no
    // pil_prospect_opportunities row at all here) -> 0.5*0.85 rounded to 0.43.
    expect(report.recommendations[0]!.successProbability).toBe(0.43);
    expect(report.recommendations[0]!.recommendationStatus).toBe("monitor");
    expect(report.recommendations[0]!.confidence).toBe(0.5);

    for (const sibling of ["BEN-QLF-01", "BEN-QLF-03", "BEN-REL-06", "BEN-QLF-05"]) {
      expect(result.delegations).toContainEqual(expect.objectContaining({ childAgentCode: sibling }));
    }
    expect(result.delegations).not.toContainEqual(expect.objectContaining({ childAgentCode: "BEN-SUP-05" }));

    const insertCall = calls.find((c) => c.table === "pil_application_profiles" && c.method === "insert");
    expect(insertCall).toBeDefined();
    const rows = insertCall!.payload as Array<{ recommendation_status: string; success_probability: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recommendation_status).toBe("monitor");
  });

  it("produces a high success_probability -> 'submit' recommendation, delegates to BEN-SUP-05, and creates a human review item above the probability threshold", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockResolvedValue([baseEvidenceItem()] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const opportunity = {
      id: "opp-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      classification: "tier_1_priority",
      mission_affinity_score: 0.9,
      capacity_estimate_low: 10000,
      capacity_estimate_high: 50000,
      recommended_ask_low: null,
      recommended_ask_high: null,
      timing_status: "approach_now",
      engagement_strategy: null,
      confidence: 0.9,
      qualified_by_agent_id: "BEN-QLF-04",
      qualified_at: "2026-08-01T00:00:00Z",
      status: "open",
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    };

    const missionAffinityAssessment = {
      id: "maa-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      opportunity_id: "opp-1",
      cause_alignment_score: 90,
      population_alignment_score: null,
      program_alignment_score: 90,
      geographic_alignment_score: 90,
      recency_score: 100,
      overall_score: 92,
      counterevidence: [],
      unscored_dimensions: [],
      evidence_refs: [],
      confidence: 0.9,
      computed_by_agent_id: "BEN-QLF-01",
      computed_at: "2026-08-01T00:00:00Z",
      created_at: "2026-08-01T00:00:00Z",
    };

    const capacityPropensityAssessment = {
      id: "cpa-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      opportunity_id: "opp-1",
      capacity_estimate_low: 10000,
      capacity_estimate_high: 50000,
      capacity_confidence: 0.9,
      capacity_basis: [],
      propensity_score: 90,
      propensity_confidence: 0.9,
      giving_pattern_summary: {},
      vehicle_use: [],
      cause_relevance_score: 90,
      uncertainty_notes: null,
      evidence_refs: [],
      computed_by_agent_id: "BEN-QLF-03",
      computed_at: "2026-08-01T00:00:00Z",
      created_at: "2026-08-01T00:00:00Z",
    };

    const timingReadinessAssessment = {
      id: "tra-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      opportunity_id: "opp-1",
      timing_status: "approach_now",
      application_window_open: true,
      trigger_recency_days: 5,
      relationship_maturity_score: 90,
      tenant_readiness_score: 90,
      document_readiness_score: 90,
      monitor_conditions: [],
      staleness_flags: [],
      unscored_dimensions: [],
      confidence: 0.9,
      computed_by_agent_id: "BEN-QLF-05",
      computed_at: "2026-08-01T00:00:00Z",
      created_at: "2026-08-01T00:00:00Z",
    };

    const { client, calls } = makeClient({
      pil_prospects: { data: baseProspect(), error: null },
      request_profiles: { data: [baseRequestProfile()], error: null },
      pil_prospect_opportunities: { data: opportunity, error: null },
      pil_mission_affinity_assessments: { data: missionAffinityAssessment, error: null },
      pil_funding_eligibility_assessments: { data: null, error: null },
      pil_capacity_propensity_assessments: { data: capacityPropensityAssessment, error: null },
      pil_timing_readiness_assessments: { data: timingReadinessAssessment, error: null },
      pil_application_profiles: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ApplicationProfileOrchestratorAgent } = await import("@/lib/pil/agents/app/BEN-APP-01");
    const agent = new ApplicationProfileOrchestratorAgent();
    const context = baseContext({ prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (
      result.conclusions as {
        report: { recommendations: Array<{ successProbability: number; recommendationStatus: string }>; fallbackDimensions: string[]; reviewsCreated: number };
      }
    ).report;

    expect(report.fallbackDimensions).toEqual([]);
    expect(report.recommendations).toHaveLength(1);
    // capacity 0.9*0.3 + affinity 0.92*0.3 + relationship 0.9*0.2 + timing
    // 1.0*0.2 = 0.926, capacityFitMultiplier=1 (profile has no min/max
    // bounds) -> rounds to 0.93.
    expect(report.recommendations[0]!.successProbability).toBe(0.93);
    expect(report.recommendations[0]!.recommendationStatus).toBe("submit");
    expect(report.reviewsCreated).toBe(1);

    expect(result.delegations).toContainEqual(expect.objectContaining({ childAgentCode: "BEN-SUP-05" }));
    expect(vi.mocked(createReviewItem)).toHaveBeenCalledTimes(1);

    const insertCall = calls.find((c) => c.table === "pil_application_profiles" && c.method === "insert");
    const rows = insertCall!.payload as Array<{ recommendation_status: string; request_type: string; success_probability: number }>;
    expect(rows[0]!.recommendation_status).toBe("submit");
    expect(rows[0]!.request_type).toBe("monetary");
  });

  it("recommends 'research_more' when relationship is weak and no warm-introduction path exists, and delegates to BEN-REL-05", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockResolvedValue([] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([{ id: "node-1" }] as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const opportunity = {
      id: "opp-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      classification: "tier_2_cultivate",
      mission_affinity_score: 0.8,
      capacity_estimate_low: 10000,
      capacity_estimate_high: 50000,
      recommended_ask_low: null,
      recommended_ask_high: null,
      timing_status: "monitor",
      engagement_strategy: null,
      confidence: 0.7,
      qualified_by_agent_id: "BEN-QLF-04",
      qualified_at: "2026-08-01T00:00:00Z",
      status: "open",
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    };

    const timingReadinessAssessment = {
      id: "tra-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      opportunity_id: "opp-1",
      timing_status: "monitor",
      application_window_open: null,
      trigger_recency_days: null,
      relationship_maturity_score: 10,
      tenant_readiness_score: 50,
      document_readiness_score: 50,
      monitor_conditions: [],
      staleness_flags: [],
      unscored_dimensions: [],
      confidence: 0.6,
      computed_by_agent_id: "BEN-QLF-05",
      computed_at: "2026-08-01T00:00:00Z",
      created_at: "2026-08-01T00:00:00Z",
    };

    // No 'introduces_to' edges anywhere (pil_graph_edges resolves to empty for
    // both the source-side and target-side hasWarmIntroPath() queries) -- no
    // warm-introduction path exists.
    const { client } = makeClient({
      pil_prospects: { data: baseProspect(), error: null },
      request_profiles: { data: [baseRequestProfile()], error: null },
      pil_prospect_opportunities: { data: opportunity, error: null },
      pil_mission_affinity_assessments: { data: null, error: null },
      pil_funding_eligibility_assessments: { data: null, error: null },
      pil_capacity_propensity_assessments: { data: null, error: null },
      pil_timing_readiness_assessments: { data: timingReadinessAssessment, error: null },
      pil_graph_edges: { data: [], error: null },
      pil_application_profiles: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ApplicationProfileOrchestratorAgent } = await import("@/lib/pil/agents/app/BEN-APP-01");
    const agent = new ApplicationProfileOrchestratorAgent();
    const context = baseContext({ prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (result.conclusions as { report: { recommendations: Array<{ recommendationStatus: string }> } }).report;
    expect(report.recommendations[0]!.recommendationStatus).toBe("research_more");
    expect(result.delegations).toContainEqual(expect.objectContaining({ childAgentCode: "BEN-REL-05" }));
    expect(result.delegations).not.toContainEqual(expect.objectContaining({ childAgentCode: "BEN-SUP-05" }));
  });

  it("flags 'manual_review' when capacity is high but a prior-denial claim is on record", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");

    const denialEvidence = baseEvidenceItem({
      id: "ev-denial",
      claim: "Foundation board denied the organization's prior grant request in 2025.",
      claim_type: "foundation_grants_paid",
    });

    vi.mocked(getEvidence).mockResolvedValue([denialEvidence] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const capacityPropensityAssessment = {
      id: "cpa-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      opportunity_id: null,
      capacity_estimate_low: 20000,
      capacity_estimate_high: 80000,
      capacity_confidence: 0.85,
      capacity_basis: [],
      propensity_score: 60,
      propensity_confidence: 0.7,
      giving_pattern_summary: {},
      vehicle_use: [],
      cause_relevance_score: 70,
      uncertainty_notes: null,
      evidence_refs: [],
      computed_by_agent_id: "BEN-QLF-03",
      computed_at: "2026-08-01T00:00:00Z",
      created_at: "2026-08-01T00:00:00Z",
    };

    const timingReadinessAssessment = {
      id: "tra-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      opportunity_id: null,
      timing_status: "approach_now",
      application_window_open: true,
      trigger_recency_days: 5,
      relationship_maturity_score: 80,
      tenant_readiness_score: 80,
      document_readiness_score: 80,
      monitor_conditions: [],
      staleness_flags: [],
      unscored_dimensions: [],
      confidence: 0.8,
      computed_by_agent_id: "BEN-QLF-05",
      computed_at: "2026-08-01T00:00:00Z",
      created_at: "2026-08-01T00:00:00Z",
    };

    const missionAffinityAssessment = {
      id: "maa-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      opportunity_id: null,
      cause_alignment_score: 80,
      population_alignment_score: null,
      program_alignment_score: 80,
      geographic_alignment_score: 80,
      recency_score: 80,
      overall_score: 80,
      counterevidence: [],
      unscored_dimensions: [],
      evidence_refs: [],
      confidence: 0.8,
      computed_by_agent_id: "BEN-QLF-01",
      computed_at: "2026-08-01T00:00:00Z",
      created_at: "2026-08-01T00:00:00Z",
    };

    const { client, calls } = makeClient({
      pil_prospects: { data: baseProspect(), error: null },
      request_profiles: { data: [baseRequestProfile()], error: null },
      pil_prospect_opportunities: { data: null, error: null },
      pil_mission_affinity_assessments: { data: missionAffinityAssessment, error: null },
      pil_funding_eligibility_assessments: { data: null, error: null },
      pil_capacity_propensity_assessments: { data: capacityPropensityAssessment, error: null },
      pil_timing_readiness_assessments: { data: timingReadinessAssessment, error: null },
      pil_application_profiles: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ApplicationProfileOrchestratorAgent } = await import("@/lib/pil/agents/app/BEN-APP-01");
    const agent = new ApplicationProfileOrchestratorAgent();
    const context = baseContext({ prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (
      result.conclusions as { report: { recommendations: Array<{ recommendationStatus: string; riskFactors: Array<{ factor: string }> }> } }
    ).report;
    expect(report.recommendations[0]!.recommendationStatus).toBe("manual_review");
    expect(report.recommendations[0]!.riskFactors.some((r) => r.factor === "prior_denial_on_record")).toBe(true);

    const insertCall = calls.find((c) => c.table === "pil_application_profiles" && c.method === "insert");
    const rows = insertCall!.payload as Array<{ recommendation_status: string }>;
    expect(rows[0]!.recommendation_status).toBe("manual_review");
  });

  it("filters out request_profiles whose entity-type/category targeting doesn't match this prospect, matches the rest, and ranks multiple matched profiles by success_probability", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockResolvedValue([] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const opportunity = {
      id: "opp-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      classification: "tier_2_cultivate",
      mission_affinity_score: 0.7,
      capacity_estimate_low: 5000,
      capacity_estimate_high: 15000,
      recommended_ask_low: null,
      recommended_ask_high: null,
      timing_status: "monitor",
      engagement_strategy: null,
      confidence: 0.6,
      qualified_by_agent_id: "BEN-QLF-04",
      qualified_at: "2026-08-01T00:00:00Z",
      status: "open",
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    };

    // Foundation-only profile should be filtered out for an individual
    // prospect; the two individual-targeting profiles should both match and
    // be ranked by their own capacity-fit multiplier (in-range full overlap
    // outranks a profile whose min_value the prospect's capacity can't reach).
    const foundationOnlyProfile = baseRequestProfile({
      id: "profile-foundation",
      name: "Foundation Grants",
      target_funder_categories: ["foundation"],
    });
    const inRangeProfile = baseRequestProfile({
      id: "profile-in-range",
      name: "Small Individual Gifts",
      target_funder_categories: ["individual"],
      min_value: 1000,
      max_value: 20000,
    });
    const outOfRangeProfile = baseRequestProfile({
      id: "profile-out-of-range",
      name: "Major Individual Gifts",
      target_funder_categories: ["individual"],
      min_value: 100000,
      max_value: 500000,
    });

    const { client, calls } = makeClient({
      pil_prospects: { data: baseProspect(), error: null },
      request_profiles: { data: [foundationOnlyProfile, inRangeProfile, outOfRangeProfile], error: null },
      pil_prospect_opportunities: { data: opportunity, error: null },
      pil_mission_affinity_assessments: { data: null, error: null },
      pil_funding_eligibility_assessments: { data: null, error: null },
      pil_capacity_propensity_assessments: { data: null, error: null },
      pil_timing_readiness_assessments: { data: null, error: null },
      pil_application_profiles: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ApplicationProfileOrchestratorAgent } = await import("@/lib/pil/agents/app/BEN-APP-01");
    const agent = new ApplicationProfileOrchestratorAgent();
    const context = baseContext({ prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (
      result.conclusions as { report: { recommendations: Array<{ requestProfileId: string; successProbability: number; sequence?: number }> } }
    ).report;

    expect(report.recommendations).toHaveLength(2);
    expect(report.recommendations.map((r) => r.requestProfileId)).not.toContain("profile-foundation");
    expect(report.recommendations[0]!.requestProfileId).toBe("profile-in-range");
    expect(report.recommendations[0]!.successProbability).toBeGreaterThan(report.recommendations[1]!.successProbability);

    const insertCall = calls.find((c) => c.table === "pil_application_profiles" && c.method === "insert");
    const rows = insertCall!.payload as Array<{ request_profile_id: string }>;
    expect(rows).toHaveLength(2);
  });
});

describe("BEN-APP-02 Recommendation Priority Scorer", () => {
  beforeEach(() => vi.resetAllMocks());

  function baseApplicationProfile(overrides: Record<string, unknown> = {}) {
    return {
      id: "profile-row-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      opportunity_id: null,
      request_type: "monetary",
      request_profile_id: "profile-1",
      success_probability: 0.5,
      recommendation_status: "submit",
      strategic_reasoning: "placeholder",
      field_mappings: {},
      pitch_parameters: { emphasis: [], avoid: [], tone: "formal, evidence-led approach" },
      risk_factors: [],
      relationship_strategy: { sequence: 1, timing: "immediate", first_contact: "staff_direct_outreach", escalation_path: [] },
      evidence_refs: [],
      confidence: 0.8,
      computed_by_agent_id: "BEN-APP-01",
      computed_at: "2026-08-20T00:00:00Z",
      created_at: "2026-08-20T00:00:00Z",
      ...overrides,
    };
  }

  function baseCapacityAssessment(overrides: Record<string, unknown> = {}) {
    return {
      id: "cpa-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      opportunity_id: null,
      capacity_estimate_low: null,
      capacity_estimate_high: null,
      capacity_confidence: 0.5,
      capacity_basis: [],
      propensity_score: 50,
      propensity_confidence: 0.5,
      giving_pattern_summary: {},
      vehicle_use: [],
      cause_relevance_score: 0,
      uncertainty_notes: null,
      evidence_refs: [],
      computed_by_agent_id: "BEN-QLF-03",
      computed_at: "2026-08-20T00:00:00Z",
      created_at: "2026-08-20T00:00:00Z",
      ...overrides,
    };
  }

  function baseTimingAssessment(overrides: Record<string, unknown> = {}) {
    return {
      id: "tra-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      opportunity_id: null,
      timing_status: "monitor",
      application_window_open: null,
      trigger_recency_days: null,
      relationship_maturity_score: 50,
      tenant_readiness_score: 50,
      document_readiness_score: 50,
      monitor_conditions: [],
      staleness_flags: [],
      unscored_dimensions: [],
      confidence: 0.6,
      computed_by_agent_id: "BEN-QLF-05",
      computed_at: "2026-08-20T00:00:00Z",
      created_at: "2026-08-20T00:00:00Z",
      ...overrides,
    };
  }

  it("returns a skipped/completed result when the org has no pil_application_profiles rows", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { client } = makeClient({ pil_application_profiles: { data: [], error: null } });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { RecommendationPriorityScorerAgent } = await import("@/lib/pil/agents/app/BEN-APP-02");
    const agent = new RecommendationPriorityScorerAgent();
    const result = await agent.execute(baseContext({ prospectId: null }) as never, {} as never);

    expect(result.status).toBe("completed");
    expect((result.conclusions as { skipped: boolean; ranked: unknown[] }).skipped).toBe(true);
    expect((result.conclusions as { ranked: unknown[] }).ranked).toEqual([]);
    expect(result.delegations).toEqual([]);
  });

  it("ranks two prospects, computes the weighted priority formula, assigns percentiles, and finds the value breakpoint", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockImplementation(async (prospectId: string) =>
      prospectId === "p-low" ? ([baseEvidenceItem({ id: "ev-low", entity_id: "p-low" })] as never) : ([] as never),
    );
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const highProfile = baseApplicationProfile({
      id: "profile-high",
      prospect_id: "p-high",
      request_profile_id: "rp-simple",
      success_probability: 0.9,
      recommendation_status: "submit",
    });
    const lowProfile = baseApplicationProfile({
      id: "profile-low",
      prospect_id: "p-low",
      request_profile_id: "rp-complex",
      success_probability: 0.4,
      recommendation_status: "submit",
    });

    const highProspect = baseProspect({ id: "p-high", display_name: "High Prospect" });
    const lowProspect = baseProspect({ id: "p-low", display_name: "Low Prospect" });

    const highCapacity = baseCapacityAssessment({ id: "cpa-high", prospect_id: "p-high", capacity_estimate_low: 40000, capacity_estimate_high: 60000 });
    const lowCapacity = baseCapacityAssessment({ id: "cpa-low", prospect_id: "p-low", capacity_estimate_low: 8000, capacity_estimate_high: 12000 });

    const highTiming = baseTimingAssessment({ id: "tra-high", prospect_id: "p-high", relationship_maturity_score: 90 });
    const lowTiming = baseTimingAssessment({ id: "tra-low", prospect_id: "p-low", relationship_maturity_score: 20 });

    const simpleRequestProfile = baseRequestProfile({ id: "rp-simple", name: "Simple Profile", pitch_template: "template text" });
    const complexRequestProfile = baseRequestProfile({
      id: "rp-complex",
      name: "Complex Profile",
      pitch_template: null,
      specific_requirements: { a: 1, b: 2 },
    });

    const { client, calls } = makeClient({
      pil_application_profiles: { data: [highProfile, lowProfile], error: null },
      pil_prospects: { data: [highProspect, lowProspect], error: null },
      pil_prospect_opportunities: { data: [], error: null },
      pil_capacity_propensity_assessments: { data: [highCapacity, lowCapacity], error: null },
      pil_timing_readiness_assessments: { data: [highTiming, lowTiming], error: null },
      request_profiles: { data: [simpleRequestProfile, complexRequestProfile], error: null },
      pil_priority_scores: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { RecommendationPriorityScorerAgent } = await import("@/lib/pil/agents/app/BEN-APP-02");
    const agent = new RecommendationPriorityScorerAgent();
    const result = await agent.execute(baseContext({ prospectId: null }) as never, {} as never);

    const report = (
      result.conclusions as {
        report: {
          totalRanked: number;
          ranked: Array<{ prospectId: string; priorityScore: number; priorityPercentile: string; priorityRecommendation: string }>;
          naturalBreakpoint: string;
        };
      }
    ).report;

    expect(report.totalRanked).toBe(2);
    // high: 0.9*35 + (50000/50000)*25 + (90/100)*20 + (90/100)*15 + 1.0*5 = 93
    expect(report.ranked[0]!.prospectId).toBe("p-high");
    expect(report.ranked[0]!.priorityScore).toBe(93);
    expect(report.ranked[0]!.priorityPercentile).toBe("top_10");
    expect(report.ranked[0]!.priorityRecommendation).toBe("submit_now");
    // low: 0.4*35 + (10000/50000)*25 + (60/100)*20 + (30/100)*15 + 1.0*5 = 40.5
    expect(report.ranked[1]!.prospectId).toBe("p-low");
    expect(report.ranked[1]!.priorityScore).toBe(40.5);
    expect(report.ranked[1]!.priorityPercentile).toBe("bottom_50");
    expect(report.ranked[1]!.priorityRecommendation).toBe("monitor");

    expect(report.naturalBreakpoint).toContain("Top 1 of 2");

    const insertCall = calls.find((c) => c.table === "pil_priority_scores" && c.method === "insert");
    const rows = insertCall!.payload as Array<{ prospect_id: string; priority_score: number }>;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.prospect_id === "p-high")!.priority_score).toBe(93);

    expect(vi.mocked(createReviewItem)).toHaveBeenCalledTimes(1);
  });

  it("downgrades to 'monitor' when denial evidence is on record even though the underlying status is 'submit' and the score clears the submit_now threshold", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");

    const denialEvidence = baseEvidenceItem({ id: "ev-denial", claim: "Foundation board denied the organization's prior grant request." });
    vi.mocked(getEvidence).mockResolvedValue([denialEvidence] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const profile = baseApplicationProfile({ prospect_id: "p1", request_profile_id: null, success_probability: 0.95, recommendation_status: "submit" });
    const prospect = baseProspect({ id: "p1" });
    const capacity = baseCapacityAssessment({ prospect_id: "p1", capacity_estimate_low: 50000, capacity_estimate_high: 50000 });
    const timing = baseTimingAssessment({ prospect_id: "p1", relationship_maturity_score: 95 });

    const { client } = makeClient({
      pil_application_profiles: { data: [profile], error: null },
      pil_prospects: { data: [prospect], error: null },
      pil_prospect_opportunities: { data: [], error: null },
      pil_capacity_propensity_assessments: { data: [capacity], error: null },
      pil_timing_readiness_assessments: { data: [timing], error: null },
      request_profiles: { data: [], error: null },
      pil_priority_scores: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { RecommendationPriorityScorerAgent } = await import("@/lib/pil/agents/app/BEN-APP-02");
    const agent = new RecommendationPriorityScorerAgent();
    const result = await agent.execute(baseContext({ prospectId: null }) as never, {} as never);

    const report = (
      result.conclusions as { report: { ranked: Array<{ priorityRecommendation: string; scoreBreakdown: { readiness_score: number } }> } }
    ).report;
    expect(report.ranked[0]!.scoreBreakdown.readiness_score).toBe(10);
    expect(report.ranked[0]!.priorityRecommendation).toBe("monitor");
  });

  it("carries a 'research_more' underlying status straight through regardless of score, and delegates a capped refresh to BEN-APP-01 for low-confidence profiles", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockResolvedValue([] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const profile = baseApplicationProfile({
      prospect_id: "p1",
      request_profile_id: null,
      success_probability: 0.9,
      recommendation_status: "research_more",
      confidence: 0.2,
    });
    const prospect = baseProspect({ id: "p1" });

    const { client } = makeClient({
      pil_application_profiles: { data: [profile], error: null },
      pil_prospects: { data: [prospect], error: null },
      pil_prospect_opportunities: { data: [], error: null },
      pil_capacity_propensity_assessments: { data: [], error: null },
      pil_timing_readiness_assessments: { data: [], error: null },
      request_profiles: { data: [], error: null },
      pil_priority_scores: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { RecommendationPriorityScorerAgent } = await import("@/lib/pil/agents/app/BEN-APP-02");
    const agent = new RecommendationPriorityScorerAgent();
    const result = await agent.execute(baseContext({ prospectId: null }) as never, {} as never);

    const report = (result.conclusions as { report: { ranked: Array<{ priorityRecommendation: string }> } }).report;
    expect(report.ranked[0]!.priorityRecommendation).toBe("research_more");

    expect(result.delegations).toContainEqual(
      expect.objectContaining({ childAgentCode: "BEN-APP-01", constraints: expect.objectContaining({ prospectIds: ["p1"] }) }),
    );
  });

  it("applies the board-member's-foundation strategic bonus (x1.25) when a foundation-type prospect has a warm-introduction path", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockResolvedValue([] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([{ id: "node-1" }] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const profile = baseApplicationProfile({ prospect_id: "p1", request_profile_id: null, success_probability: 0.5, recommendation_status: "monitor" });
    const prospect = baseProspect({ id: "p1", entity_type: "family_foundation" });
    const timing = baseTimingAssessment({ prospect_id: "p1", relationship_maturity_score: 50 });

    // A real 'introduces_to' edge touching this prospect's own graph node --
    // BEN-REL-05's own warm-introduction-path output signal, reused verbatim
    // via BEN-APP-01's exported hasWarmIntroPath().
    const introEdge = {
      id: "edge-1",
      organization_id: ORG_ID,
      source_node_id: "node-1",
      target_node_id: "node-2",
      edge_type: "introduces_to",
      relationship_strength: "strong",
      confidence: 0.8,
      temporal_validity_start: null,
      temporal_validity_end: null,
      is_current: true,
      superseded_by_edge_id: null,
      properties: {},
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    };

    const { client } = makeClient({
      pil_application_profiles: { data: [profile], error: null },
      pil_prospects: { data: [prospect], error: null },
      pil_prospect_opportunities: { data: [], error: null },
      pil_capacity_propensity_assessments: { data: [], error: null },
      pil_timing_readiness_assessments: { data: [timing], error: null },
      request_profiles: { data: [], error: null },
      pil_graph_edges: { data: [introEdge], error: null },
      pil_priority_scores: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { RecommendationPriorityScorerAgent } = await import("@/lib/pil/agents/app/BEN-APP-02");
    const agent = new RecommendationPriorityScorerAgent();
    const result = await agent.execute(baseContext({ prospectId: null }) as never, {} as never);

    const report = (result.conclusions as { report: { ranked: Array<{ scoreBreakdown: { strategic_bonus_multiplier: number } }> } }).report;
    expect(report.ranked[0]!.scoreBreakdown.strategic_bonus_multiplier).toBe(1.25);
  });
});
