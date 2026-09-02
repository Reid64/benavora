// Unit tests for BEN-QLF-01 (Mission Affinity), BEN-QLF-04 (Opportunity
// Qualification), BEN-KNW-01 (Prospect Digital Twin), BEN-KNW-02 (Entity
// Resolution), BEN-KNW-03 (Evidence & Provenance Verification), and
// BEN-KNW-04 (Contradiction and Freshness Investigator).
// Everything is mocked -- no real DB calls, matching pil-sup-agents.test.ts's
// convention. See each agent file's header comment for how these real
// agent_ids reconcile against the task numbering (BEN-QUA-01/BEN-KNW-01/
// BEN-KNW-02) this batch was commissioned under.
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
    agentCode: "BEN-QLF-04",
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

describe("BEN-QLF-04 Opportunity Qualification Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns DISQUALIFIED when giving capacity score is 0", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { getEvents } = await import("@/lib/pil/monitoring");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockResolvedValue([] as never); // no wealth_capacity/capacity_signal evidence at all
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(getEvents).mockResolvedValue([] as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

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
    const opportunity = { id: "opp-1", organization_id: ORG_ID, prospect_id: "p1" };

    const { client } = makeClient({
      pil_prospects: { data: prospect, error: null },
      pil_prospect_opportunities: [
        { data: null, error: null }, // find: none exists yet
        { data: opportunity, error: null }, // insert result
      ],
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { OpportunityQualificationAgent } = await import("@/lib/pil/agents/qlf/BEN-QLF-04");
    const agent = new OpportunityQualificationAgent();
    const context = baseContext({ agentCode: "BEN-QLF-04", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (result.conclusions as { report: { decision: string; classification: string; disqualificationReasons: string[] } }).report;
    expect(report.decision).toBe("DISQUALIFIED");
    expect(report.classification).toBe("disqualified");
    expect(report.disqualificationReasons.some((r) => r.toLowerCase().includes("giving capacity"))).toBe(true);
    expect(result.status).toBe("completed");
    expect(vi.mocked(createReviewItem)).not.toHaveBeenCalled();
  });

  it("prefers a fresh pil_mission_affinity_assessments row over the direct scoreDimension() computation for missionAffinity", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { getEvents } = await import("@/lib/pil/monitoring");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { logAction } = await import("@/lib/pil/audit");

    // No evidence at all -- the direct scoreDimension() fallback would
    // compute missionAffinity=0; the fresh assessment row below must win.
    vi.mocked(getEvidence).mockResolvedValue([] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(getEvents).mockResolvedValue([] as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

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
    const opportunity = { id: "opp-1", organization_id: ORG_ID, prospect_id: "p1" };
    const freshMissionAffinityAssessment = {
      id: "maa-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      opportunity_id: "opp-1",
      cause_alignment_score: 90,
      population_alignment_score: null,
      program_alignment_score: 80,
      geographic_alignment_score: 70,
      recency_score: 100,
      overall_score: 85,
      counterevidence: [],
      unscored_dimensions: [],
      evidence_refs: [],
      confidence: 0.9,
      computed_by_agent_id: "BEN-QLF-01",
      computed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    const { client } = makeClient({
      pil_prospects: { data: prospect, error: null },
      pil_prospect_opportunities: [
        { data: null, error: null },
        { data: opportunity, error: null },
      ],
      pil_mission_affinity_assessments: { data: freshMissionAffinityAssessment, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { OpportunityQualificationAgent } = await import("@/lib/pil/agents/qlf/BEN-QLF-04");
    const agent = new OpportunityQualificationAgent();
    const context = baseContext({ agentCode: "BEN-QLF-04", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (result.conclusions as { report: { dimensionScores: { missionAffinity: number } } }).report;
    expect(report.dimensionScores.missionAffinity).toBe(85);
  });

  it("still uses the original direct-fallback scoring and produces the same DISQUALIFIED classification when no sibling assessment rows exist anywhere", async () => {
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
    const opportunity = { id: "opp-1", organization_id: ORG_ID, prospect_id: "p1" };

    // No mock entries for pil_mission_affinity_assessments/
    // pil_funding_eligibility_assessments/pil_capacity_propensity_assessments
    // -- makeClient() resolves any un-listed table to {data: null, error:
    // null}, i.e. no sibling assessment rows exist anywhere.
    const { client } = makeClient({
      pil_prospects: { data: prospect, error: null },
      pil_prospect_opportunities: [
        { data: null, error: null },
        { data: opportunity, error: null },
      ],
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { OpportunityQualificationAgent } = await import("@/lib/pil/agents/qlf/BEN-QLF-04");
    const agent = new OpportunityQualificationAgent();
    const context = baseContext({ agentCode: "BEN-QLF-04", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (
      result.conclusions as {
        report: { decision: string; classification: string; disqualificationReasons: string[]; dimensionScores: Record<string, number> };
      }
    ).report;
    expect(report.decision).toBe("DISQUALIFIED");
    expect(report.classification).toBe("disqualified");
    expect(report.disqualificationReasons.some((r) => r.toLowerCase().includes("giving capacity"))).toBe(true);
    expect(report.dimensionScores.missionAffinity).toBe(0);
    expect(report.dimensionScores.givingCapacity).toBe(0);
    expect(report.dimensionScores.philanthropicPropensity).toBe(0);
    expect(result.status).toBe("completed");
  });

  it("delegates to BEN-QLF-01 when its mission-affinity assessment is missing", async () => {
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
    const opportunity = { id: "opp-1", organization_id: ORG_ID, prospect_id: "p1" };

    const { client } = makeClient({
      pil_prospects: { data: prospect, error: null },
      pil_prospect_opportunities: [
        { data: null, error: null },
        { data: opportunity, error: null },
      ],
      // pil_mission_affinity_assessments left unmocked -- resolves to null,
      // i.e. BEN-QLF-01 hasn't produced an assessment for this prospect yet.
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { OpportunityQualificationAgent } = await import("@/lib/pil/agents/qlf/BEN-QLF-04");
    const agent = new OpportunityQualificationAgent();
    const context = baseContext({ agentCode: "BEN-QLF-04", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    expect(result.delegations).toContainEqual(expect.objectContaining({ childAgentCode: "BEN-QLF-01" }));
  });
});

describe("BEN-QLF-01 Mission Affinity Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("scores cause/program/geographic dimensions individually and persists both the opportunity score and the detail assessment row", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { logAction } = await import("@/lib/pil/audit");

    const now = new Date().toISOString();
    const causeEvidence = {
      id: "ev-cause",
      organization_id: ORG_ID,
      entity_id: "p1",
      entity_table: "pil_prospects",
      claim: "Gave $50,000 to a housing nonprofit last year",
      value: null,
      claim_type: "cause_aligned_giving_announcement",
      source_url: "https://example.com/gift",
      source_title: "Gift announcement",
      source_type: "news",
      publisher: null,
      retrieved_at: now,
      published_at: now,
      last_verified_at: null,
      evidence_excerpt: "excerpt",
      agent_id: "BEN-DIS-07",
      research_run_id: "run-1",
      confidence: 0.9,
      verification_status: "verified_fact",
      freshness_status: "fresh",
      inference_status: "direct",
      contradiction_status: "none",
      lineage: [],
      created_at: now,
    };
    const geoEvidence = {
      ...causeEvidence,
      id: "ev-geo",
      claim: "Directory match: funds housing causes in this metro area",
      claim_type: "geographic_funder_directory_match",
      confidence: 0.8,
      agent_id: "BEN-DIS-06",
    };

    vi.mocked(getEvidence).mockResolvedValue([causeEvidence, geoEvidence] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

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
    const opportunity = { id: "opp-1", organization_id: ORG_ID, prospect_id: "p1" };

    const { client, calls } = makeClient({
      pil_prospects: { data: prospect, error: null },
      pil_prospect_opportunities: [
        { data: null, error: null }, // find: none exists yet
        { data: opportunity, error: null }, // insert result
      ],
      pil_mission_affinity_assessments: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { MissionAffinityAgent } = await import("@/lib/pil/agents/qlf/BEN-QLF-01");
    const agent = new MissionAffinityAgent();
    const context = baseContext({ agentCode: "BEN-QLF-01", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (
      result.conclusions as {
        report: {
          causeAlignmentScore: number;
          programAlignmentScore: number;
          geographicAlignmentScore: number;
          recencyScore: number;
          overallScore: number;
          counterevidence: string[];
          unscoredDimensions: string[];
        };
      }
    ).report;
    expect(report.causeAlignmentScore).toBe(90);
    expect(report.programAlignmentScore).toBe(0);
    expect(report.geographicAlignmentScore).toBe(80);
    expect(report.recencyScore).toBe(100);
    expect(report.overallScore).toBe(68);
    expect(report.counterevidence).toEqual([]);
    expect(report.unscoredDimensions.length).toBe(1);
    expect(result.status).toBe("completed");

    const opportunityUpdate = calls.find((c) => c.table === "pil_prospect_opportunities" && c.method === "insert");
    expect((opportunityUpdate!.payload as { mission_affinity_score: number }).mission_affinity_score).toBeCloseTo(0.68);

    const assessmentInsert = calls.find((c) => c.table === "pil_mission_affinity_assessments" && c.method === "insert");
    expect(assessmentInsert).toBeDefined();
    expect(assessmentInsert!.payload).toMatchObject({
      prospect_id: "p1",
      opportunity_id: "opp-1",
      cause_alignment_score: 90,
      population_alignment_score: null,
      program_alignment_score: 0,
      geographic_alignment_score: 80,
      recency_score: 100,
      overall_score: 68,
      computed_by_agent_id: "BEN-QLF-01",
    });
  });

  it("returns a skipped/completed result when prospectId is missing", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    vi.mocked(getPilClient).mockReturnValue({ from: vi.fn() } as never);

    const { MissionAffinityAgent } = await import("@/lib/pil/agents/qlf/BEN-QLF-01");
    const agent = new MissionAffinityAgent();
    const context = baseContext({ agentCode: "BEN-QLF-01", prospectId: null });

    const result = await agent.execute(context as never, {} as never);

    expect(result.status).toBe("completed");
    expect((result.conclusions as { skipped: boolean }).skipped).toBe(true);
    expect(result.delegations).toEqual([]);
  });
});

describe("BEN-QLF-03 Philanthropic Capacity and Propensity Agent", () => {
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
  const opportunity = { id: "opp-1", organization_id: ORG_ID, prospect_id: "p1" };

  function baseEvidence(overrides: Record<string, unknown> = {}) {
    return {
      id: "ev-1",
      organization_id: ORG_ID,
      entity_id: "p1",
      entity_table: "pil_prospects",
      claim: "placeholder claim",
      value: null,
      claim_type: "wealth_capacity",
      source_url: null,
      source_title: null,
      source_type: "open_web",
      publisher: null,
      retrieved_at: "2026-08-01T00:00:00Z",
      published_at: null,
      last_verified_at: null,
      evidence_excerpt: null,
      agent_id: "BEN-INT-08",
      research_run_id: "run-1",
      confidence: 0.55,
      verification_status: "reasoned_inference",
      freshness_status: "fresh",
      inference_status: "inferred",
      contradiction_status: "none",
      lineage: [],
      created_at: "2026-08-01T00:00:00Z",
      ...overrides,
    };
  }

  it("computes capacity and propensity independently: strong capacity evidence with zero giving history yields a real capacity estimate but propensityScore 0", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { logAction } = await import("@/lib/pil/audit");

    const wealthCapacityEvidence = baseEvidence({
      id: "ev-wealth",
      claim: "Estimated philanthropic capacity range: $10,000-$50,000 (confidence 0.55)",
      value: {
        wealth: { low: 500_000, high: 5_000_000 },
        liquidity: "unknown",
        philanthropicCapacity: { low: 10_000, high: 50_000 },
        propensity: "unknown",
        uncertainties: ["no documented giving-behavior corroborant"],
        wealthIndicatorSources: [],
      },
      claim_type: "wealth_capacity",
      source_type: "open_web",
    });

    vi.mocked(getEvidence).mockResolvedValue([wealthCapacityEvidence] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const { client, calls } = makeClient({
      pil_prospects: { data: prospect, error: null },
      pil_prospect_opportunities: [
        { data: null, error: null }, // find: none exists yet
        { data: opportunity, error: null }, // insert result
      ],
      pil_mission_affinity_assessments: { data: null, error: null }, // no fresh cause-relevance assessment
      pil_capacity_propensity_assessments: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { PhilanthropicCapacityPropensityAgent } = await import("@/lib/pil/agents/qlf/BEN-QLF-03");
    const agent = new PhilanthropicCapacityPropensityAgent();
    const context = baseContext({ agentCode: "BEN-QLF-03", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (
      result.conclusions as {
        report: {
          capacityEstimateLow: number | null;
          capacityEstimateHigh: number | null;
          propensityScore: number;
          delegatedToInt07: boolean;
          delegatedToInt08: boolean;
        };
      }
    ).report;
    expect(report.capacityEstimateLow).toBe(10_000);
    expect(report.capacityEstimateHigh).toBe(50_000);
    expect(report.propensityScore).toBe(0);
    expect(report.delegatedToInt08).toBe(false); // capacity evidence exists
    expect(report.delegatedToInt07).toBe(true); // zero giving-history evidence
    expect(result.status).toBe("completed");

    const assessmentInsert = calls.find((c) => c.table === "pil_capacity_propensity_assessments" && c.method === "insert");
    expect(assessmentInsert).toBeDefined();
    const payload = assessmentInsert!.payload as { capacity_estimate_low: number; propensity_score: number };
    expect(payload.capacity_estimate_low).toBe(10_000);
    expect(payload.propensity_score).toBe(0);

    const opportunityInsert = calls.find((c) => c.table === "pil_prospect_opportunities" && c.method === "insert");
    expect((opportunityInsert!.payload as { capacity_estimate_low: number; capacity_estimate_high: number }).capacity_estimate_low).toBe(10_000);
  });

  it("computes capacity and propensity independently: strong giving history with zero capacity evidence yields propensityScore > 0 but a null capacity estimate", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { logAction } = await import("@/lib/pil/audit");

    const givingHistoryEvidence = baseEvidence({
      id: "ev-giving",
      claim: "Grants paid via foundation trusteeship at Acme Foundation per 990 filing (2025): 250000",
      value: { foundationLabel: "Acme Foundation", ein: "12-3456789", totalGrantsPaid: 250_000, filingYear: 2025 },
      claim_type: "giving_history",
      source_type: "irs_form_990",
      agent_id: "BEN-INT-07",
      confidence: 0.75,
      verification_status: "corroborated_fact",
    });

    vi.mocked(getEvidence).mockResolvedValue([givingHistoryEvidence] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const { client, calls } = makeClient({
      pil_prospects: { data: prospect, error: null },
      pil_prospect_opportunities: [
        { data: null, error: null },
        { data: opportunity, error: null },
      ],
      pil_mission_affinity_assessments: { data: null, error: null },
      pil_capacity_propensity_assessments: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { PhilanthropicCapacityPropensityAgent } = await import("@/lib/pil/agents/qlf/BEN-QLF-03");
    const agent = new PhilanthropicCapacityPropensityAgent();
    const context = baseContext({ agentCode: "BEN-QLF-03", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (
      result.conclusions as {
        report: {
          capacityEstimateLow: number | null;
          capacityEstimateHigh: number | null;
          propensityScore: number;
          delegatedToInt07: boolean;
          delegatedToInt08: boolean;
        };
      }
    ).report;
    expect(report.capacityEstimateLow).toBeNull();
    expect(report.capacityEstimateHigh).toBeNull();
    expect(report.propensityScore).toBeGreaterThan(0);
    expect(report.delegatedToInt07).toBe(false); // giving-history evidence exists
    expect(report.delegatedToInt08).toBe(true); // zero capacity evidence

    const assessmentInsert = calls.find((c) => c.table === "pil_capacity_propensity_assessments" && c.method === "insert");
    const payload = assessmentInsert!.payload as { capacity_estimate_low: number | null; propensity_score: number };
    expect(payload.capacity_estimate_low).toBeNull();
    expect(payload.propensity_score).toBeGreaterThan(0);
  });

  it("returns a skipped/completed result when prospectId is missing", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    vi.mocked(getPilClient).mockReturnValue({ from: vi.fn() } as never);

    const { PhilanthropicCapacityPropensityAgent } = await import("@/lib/pil/agents/qlf/BEN-QLF-03");
    const agent = new PhilanthropicCapacityPropensityAgent();
    const context = baseContext({ agentCode: "BEN-QLF-03", prospectId: null });

    const result = await agent.execute(context as never, {} as never);

    expect(result.status).toBe("completed");
    expect((result.conclusions as { skipped: boolean }).skipped).toBe(true);
    expect(result.delegations).toEqual([]);
  });
});

describe("BEN-QLF-02 Funding Eligibility Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  const prospect = {
    id: "p1",
    organization_id: ORG_ID,
    entity_type: "private_foundation",
    display_name: "Acme Family Foundation",
    canonical_name: "acme family foundation",
    status: "active",
    merged_into_prospect_id: null,
    source_of_record: "discovery",
    created_by_agent_id: "BEN-DIS-03",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  function baseEvidence(overrides: Record<string, unknown> = {}) {
    return {
      id: "ev-1",
      organization_id: ORG_ID,
      entity_id: "p1",
      entity_table: "pil_prospects",
      claim: "Application procedures documented",
      value: null,
      claim_type: "foundation_application_procedures",
      source_url: "https://example.com/apply",
      source_title: "How to apply",
      source_type: "open_web",
      publisher: null,
      retrieved_at: "2026-01-01T00:00:00Z",
      published_at: "2026-01-01T00:00:00Z",
      last_verified_at: null,
      evidence_excerpt: null,
      agent_id: "BEN-INT-06",
      research_run_id: "run-1",
      confidence: 0.9,
      verification_status: "verified_fact",
      freshness_status: "fresh",
      inference_status: "direct",
      contradiction_status: "none",
      lineage: [],
      created_at: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  it("resolves eligible===true when a tax-status restriction and a future deadline both check out against the tenant org", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { logAction } = await import("@/lib/pil/audit");

    const evidenceItem = baseEvidence({
      claim: "Eligibility limited to 501(c)(3) organizations only.",
      value: { deadline: "2030-01-01" },
    });

    vi.mocked(getEvidence).mockResolvedValue([evidenceItem] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const organization = { tax_status: "501(c)(3) public charity", service_area: null };

    const { client, calls } = makeClient({
      pil_prospects: { data: prospect, error: null },
      organizations: { data: organization, error: null },
      pil_prospect_opportunities: { data: null, error: null },
      pil_mission_affinity_assessments: { data: null, error: null },
      pil_funding_eligibility_assessments: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { FundingEligibilityAgent } = await import("@/lib/pil/agents/qlf/BEN-QLF-02");
    const agent = new FundingEligibilityAgent();
    const context = baseContext({ agentCode: "BEN-QLF-02", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (
      result.conclusions as {
        report: {
          eligible: boolean | null;
          taxStatusPass: boolean | null;
          deadlineWindowPass: boolean | null;
          disqualifyingReasons: string[];
          fundingEligibilityScore: number;
        };
      }
    ).report;
    expect(report.eligible).toBe(true);
    expect(report.taxStatusPass).toBe(true);
    expect(report.deadlineWindowPass).toBe(true);
    expect(report.disqualifyingReasons).toEqual([]);
    expect(report.fundingEligibilityScore).toBe(100);
    expect(result.status).toBe("completed");
    expect(result.delegations).toContainEqual(expect.objectContaining({ childAgentCode: "BEN-QLF-01" }));

    const assessmentInsert = calls.find((c) => c.table === "pil_funding_eligibility_assessments" && c.method === "insert");
    expect(assessmentInsert).toBeDefined();
    expect(assessmentInsert!.payload).toMatchObject({
      prospect_id: "p1",
      eligible: true,
      tax_status_pass: true,
      deadline_window_pass: true,
      disqualifying_reasons: [],
      computed_by_agent_id: "BEN-QLF-02",
    });
  });

  it("resolves eligible===false with a specific disqualifying reason when the only deadline evidence is in the past", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { logAction } = await import("@/lib/pil/audit");

    const evidenceItem = baseEvidence({
      id: "ev-deadline",
      claim: "Grant cycle closed.",
      value: { deadline: "2020-01-01" },
    });

    vi.mocked(getEvidence).mockResolvedValue([evidenceItem] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const organization = { tax_status: null, service_area: null };

    const { client, calls } = makeClient({
      pil_prospects: { data: prospect, error: null },
      organizations: { data: organization, error: null },
      pil_prospect_opportunities: { data: null, error: null },
      pil_mission_affinity_assessments: { data: null, error: null },
      pil_funding_eligibility_assessments: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { FundingEligibilityAgent } = await import("@/lib/pil/agents/qlf/BEN-QLF-02");
    const agent = new FundingEligibilityAgent();
    const context = baseContext({ agentCode: "BEN-QLF-02", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (
      result.conclusions as {
        report: { eligible: boolean | null; deadlineWindowPass: boolean | null; disqualifyingReasons: string[]; fundingEligibilityScore: number };
      }
    ).report;
    expect(report.eligible).toBe(false);
    expect(report.deadlineWindowPass).toBe(false);
    expect(report.disqualifyingReasons).toHaveLength(1);
    expect(report.disqualifyingReasons[0]).toContain("2020-01-01");
    expect(report.disqualifyingReasons[0]).toContain("ev-deadline");
    expect(report.fundingEligibilityScore).toBe(0);

    const assessmentInsert = calls.find((c) => c.table === "pil_funding_eligibility_assessments" && c.method === "insert");
    expect(assessmentInsert).toBeDefined();
    const payload = assessmentInsert!.payload as { eligible: boolean | null; disqualifying_reasons: string[] };
    expect(payload.eligible).toBe(false);
    expect(payload.disqualifying_reasons).toHaveLength(1);
    expect(payload.disqualifying_reasons[0]).toContain("2020-01-01");
  });

  it("returns a skipped/completed result when prospectId is missing", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    vi.mocked(getPilClient).mockReturnValue({ from: vi.fn() } as never);

    const { FundingEligibilityAgent } = await import("@/lib/pil/agents/qlf/BEN-QLF-02");
    const agent = new FundingEligibilityAgent();
    const context = baseContext({ agentCode: "BEN-QLF-02", prospectId: null });

    const result = await agent.execute(context as never, {} as never);

    expect(result.status).toBe("completed");
    expect((result.conclusions as { skipped: boolean }).skipped).toBe(true);
    expect(result.delegations).toEqual([]);
  });
});

describe("BEN-QLF-05 Timing and Readiness Agent", () => {
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
  const opportunity = { id: "opp-1", organization_id: ORG_ID, prospect_id: "p1" };
  const graphNode = {
    id: "node-1",
    organization_id: ORG_ID,
    node_type: "person",
    prospect_id: "p1",
    label: "Jane Donor",
    properties: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  function baseEvidence(overrides: Record<string, unknown> = {}) {
    return {
      id: "ev-1",
      organization_id: ORG_ID,
      entity_id: "p1",
      entity_table: "pil_prospects",
      claim: "placeholder claim",
      value: null,
      claim_type: "liquidity_event",
      source_url: null,
      source_title: null,
      source_type: "open_web",
      publisher: null,
      retrieved_at: "2026-08-01T00:00:00Z",
      published_at: "2026-08-01T00:00:00Z",
      last_verified_at: null,
      evidence_excerpt: null,
      agent_id: "BEN-INT-09",
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

  function freshEligibilityAssessment(overrides: Record<string, unknown> = {}) {
    return {
      id: "fea-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      opportunity_id: null,
      eligible: true,
      applicant_class_pass: null,
      tax_status_pass: null,
      geography_pass: null,
      program_restrictions_pass: null,
      deadline_window_pass: true,
      prerequisites_pass: true,
      disqualifying_reasons: [],
      evidence_refs: [],
      confidence: 0.8,
      computed_by_agent_id: "BEN-QLF-02",
      computed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      ...overrides,
    };
  }

  it("produces approach_now from an open application window plus a strong relationship_strength edge", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { getEvents } = await import("@/lib/pil/monitoring");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockResolvedValue([] as never);
    vi.mocked(getEvents).mockResolvedValue([] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([graphNode] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const strongEdge = {
      id: "edge-1",
      organization_id: ORG_ID,
      source_node_id: "node-1",
      target_node_id: "node-2",
      edge_type: "related_to",
      relationship_strength: "strong",
      confidence: 0.8,
      temporal_validity_start: null,
      temporal_validity_end: null,
      is_current: true,
      superseded_by_edge_id: null,
      properties: {},
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    const { client, calls } = makeClient({
      pil_prospects: { data: prospect, error: null },
      pil_funding_eligibility_assessments: { data: freshEligibilityAssessment(), error: null },
      pil_graph_edges: { data: [strongEdge], error: null },
      pil_prospect_opportunities: [
        { data: null, error: null }, // find: none exists yet
        { data: opportunity, error: null }, // insert result
      ],
      pil_timing_readiness_assessments: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { TimingReadinessAgent } = await import("@/lib/pil/agents/qlf/BEN-QLF-05");
    const agent = new TimingReadinessAgent();
    const context = baseContext({ agentCode: "BEN-QLF-05", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (
      result.conclusions as {
        report: { timingStatus: string; applicationWindowOpen: boolean | null; relationshipMaturityScore: number };
      }
    ).report;
    expect(report.timingStatus).toBe("approach_now");
    expect(report.applicationWindowOpen).toBe(true);
    expect(report.relationshipMaturityScore).toBe(80);
    expect(result.status).toBe("completed");

    const opportunityInsert = calls.find((c) => c.table === "pil_prospect_opportunities" && c.method === "insert");
    expect((opportunityInsert!.payload as { timing_status: string }).timing_status).toBe("approach_now");

    const assessmentInsert = calls.find((c) => c.table === "pil_timing_readiness_assessments" && c.method === "insert");
    expect(assessmentInsert).toBeDefined();
    expect(assessmentInsert!.payload).toMatchObject({ timing_status: "approach_now", application_window_open: true });
  });

  it("produces defer from a past deadline", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { getEvents } = await import("@/lib/pil/monitoring");
    const { logAction } = await import("@/lib/pil/audit");

    const pastDeadlineEvidence = baseEvidence({
      id: "ev-deadline",
      claim: "Grant cycle closed.",
      claim_type: "foundation_application_procedures",
      value: { deadline: "2020-01-01" },
      agent_id: "BEN-INT-06",
    });

    vi.mocked(getEvidence).mockResolvedValue([pastDeadlineEvidence] as never);
    vi.mocked(getEvents).mockResolvedValue([] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const { client, calls } = makeClient({
      pil_prospects: { data: prospect, error: null },
      pil_funding_eligibility_assessments: { data: null, error: null }, // no fresh assessment -- falls back to evidence parse
      pil_graph_edges: { data: [], error: null },
      pil_prospect_opportunities: [
        { data: null, error: null },
        { data: opportunity, error: null },
      ],
      pil_timing_readiness_assessments: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { TimingReadinessAgent } = await import("@/lib/pil/agents/qlf/BEN-QLF-05");
    const agent = new TimingReadinessAgent();
    const context = baseContext({ agentCode: "BEN-QLF-05", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (result.conclusions as { report: { timingStatus: string; applicationWindowOpen: boolean | null } }).report;
    expect(report.applicationWindowOpen).toBe(false);
    expect(report.timingStatus).toBe("defer");
    expect(result.status).toBe("completed");

    const assessmentInsert = calls.find((c) => c.table === "pil_timing_readiness_assessments" && c.method === "insert");
    expect(assessmentInsert!.payload).toMatchObject({ timing_status: "defer", application_window_open: false });
  });

  it("delegates to BEN-KNW-04 when timing-relevant evidence is stale", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { getEvents } = await import("@/lib/pil/monitoring");
    const { logAction } = await import("@/lib/pil/audit");

    const staleLiquidityEvidence = baseEvidence({
      id: "ev-stale-liquidity",
      claim: "Sold company for an undisclosed sum in 2024",
      claim_type: "liquidity_event",
      freshness_status: "stale",
    });

    vi.mocked(getEvidence).mockResolvedValue([staleLiquidityEvidence] as never);
    vi.mocked(getEvents).mockResolvedValue([] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const { client } = makeClient({
      pil_prospects: { data: prospect, error: null },
      pil_funding_eligibility_assessments: { data: null, error: null },
      pil_graph_edges: { data: [], error: null },
      pil_prospect_opportunities: [
        { data: null, error: null },
        { data: opportunity, error: null },
      ],
      pil_timing_readiness_assessments: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { TimingReadinessAgent } = await import("@/lib/pil/agents/qlf/BEN-QLF-05");
    const agent = new TimingReadinessAgent();
    const context = baseContext({ agentCode: "BEN-QLF-05", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    expect(result.delegations).toContainEqual(expect.objectContaining({ childAgentCode: "BEN-KNW-04" }));

    const report = (result.conclusions as { report: { stalenessFlags: string[]; delegatedToKnw04: boolean } }).report;
    expect(report.stalenessFlags).toContain("ev-stale-liquidity");
    expect(report.delegatedToKnw04).toBe(true);
  });
});

describe("BEN-KNW-02 Entity Resolution Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("auto-merges two prospects with identical EIN", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockResolvedValue([] as never); // no giving_history/wealth_capacity -- not an H1 case
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const prospectA = {
      id: "p1",
      organization_id: ORG_ID,
      entity_type: "private_foundation",
      display_name: "Acme Family Foundation",
      canonical_name: "acme family foundation",
      status: "active",
      merged_into_prospect_id: null,
      source_of_record: "discovery",
      created_by_agent_id: "BEN-DIS-03",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const prospectB = {
      ...prospectA,
      id: "p2",
      display_name: "The Acme Foundation",
      canonical_name: "the acme foundation",
      created_at: "2026-01-05T00:00:00Z",
    };

    const aliasA = { id: "a1", organization_id: ORG_ID, prospect_id: "p1", alias_type: "ein", alias_value: "12-3456789", source: "990", confidence: 0.9, created_at: "2026-01-01T00:00:00Z" };
    const aliasB = { id: "a2", organization_id: ORG_ID, prospect_id: "p2", alias_type: "ein", alias_value: "12-3456789", source: "990", confidence: 0.9, created_at: "2026-01-05T00:00:00Z" };

    const { client, calls } = makeClient({
      pil_prospects: [{ data: [prospectA, prospectB], error: null }, { data: null, error: null }],
      pil_entity_aliases: { data: [aliasA, aliasB], error: null },
      pil_graph_nodes: { data: null, error: null },
      pil_identity_resolution_log: { data: null, error: null },
      pil_entity_resolution_candidates: [
        { data: null, error: null }, // find: no existing candidate row
        { data: { id: "cand-1" }, error: null }, // insert result
      ],
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { EntityResolutionAgent } = await import("@/lib/pil/agents/knw/BEN-KNW-02");
    const agent = new EntityResolutionAgent();
    const context = baseContext({ agentCode: "BEN-KNW-02", plan: { prospectIds: ["p1", "p2"] } });

    const result = await agent.execute(context as never, {} as never);

    const { results } = result.conclusions as { results: Array<{ merged: boolean; survivingProspectId: string | null; status: string; matchScore: number }> };
    expect(results).toHaveLength(1);
    const pairResult = results[0]!;
    expect(pairResult.status).toBe("match");
    expect(pairResult.merged).toBe(true);
    expect(pairResult.survivingProspectId).toBe("p1"); // earlier created_at survives
    expect(pairResult.matchScore).toBeGreaterThanOrEqual(0.95);

    const prospectsUpdate = calls.find((c) => c.table === "pil_prospects" && c.method === "update");
    expect(prospectsUpdate?.payload).toMatchObject({ merged_into_prospect_id: "p1", status: "merged" });

    const mergeLog = calls.find((c) => c.table === "pil_identity_resolution_log" && c.method === "insert");
    expect(mergeLog?.payload).toMatchObject({ action: "merge", primary_prospect_id: "p1", secondary_prospect_id: "p2" });

    expect(vi.mocked(createReviewItem)).not.toHaveBeenCalled();

    // New delegation wiring: every executed auto-merge fires both a
    // BEN-KNW-04 contradiction/freshness scan of the merged entity and an
    // unconditional BEN-SUP-05 critic review -- additive to (not a
    // replacement for) the H1 sensitive-attribution createReviewItem() gate
    // asserted as not-called above, since this pair has no giving_history/
    // wealth_capacity evidence.
    expect(result.delegations).toContainEqual(expect.objectContaining({ childAgentCode: "BEN-KNW-04" }));
    expect(result.delegations).toContainEqual(expect.objectContaining({ childAgentCode: "BEN-SUP-05" }));
  });
});

describe("BEN-KNW-01 Prospect Digital Twin Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("keeps the prior biography and delegates to BEN-KNW-04 when new evidence conflicts with the canonical twin", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect, getEdges } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");

    const prospect = {
      id: "p1",
      display_name: "Jane Donor",
      canonical_name: "jane donor",
      entity_type: "individual",
    };

    const newEmploymentEvidence = {
      id: "ev-new",
      organization_id: ORG_ID,
      entity_id: "p1",
      entity_table: "pil_prospects",
      claim: "Now CEO of Beta Inc",
      value: null,
      claim_type: "employment",
      source_url: "https://example.com/beta",
      source_title: "Beta profile",
      source_type: "open_web",
      publisher: null,
      retrieved_at: "2026-08-20T00:00:00Z",
      published_at: "2026-08-20T00:00:00Z",
      last_verified_at: null,
      evidence_excerpt: "Jane is CEO of Beta Inc",
      agent_id: "BEN-INT-02",
      research_run_id: "run-1",
      confidence: 0.8,
      verification_status: "single_source_fact",
      freshness_status: "fresh",
      inference_status: "direct",
      contradiction_status: "none",
      lineage: [],
      created_at: "2026-08-20T00:00:00Z",
    };

    const existingTwin = {
      id: "twin-1",
      prospect_id: "p1",
      organization_id: ORG_ID,
      twin_version: 3,
      identity: {},
      biography: { facts: [{ claim: "Was CFO of Acme Corp", value: null, confidence: 0.9, evidenceId: "ev-old" }] },
      organizations_summary: [],
      companies: [],
      foundations: [],
      giving_history: [],
      wealth_indicators: {},
      relationships_summary: [],
      evidence_summary: {},
      timeline: [],
      affinity: {},
      capacity: {},
      opportunities_summary: [],
      research_gaps: [],
      contradictions_summary: [],
      current_strategy: {},
      monitoring_events_summary: [],
      completeness_score: 0.5,
      last_updated_by_agent_id: "BEN-KNW-01",
      updated_at: "2026-08-01T00:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
    };

    vi.mocked(getEvidence).mockResolvedValue([newEmploymentEvidence] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(getEdges).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const { client, calls } = makeClient({
      pil_prospects: { data: prospect, error: null },
      pil_contradictions: { data: [], error: null },
      pil_prospect_opportunities: { data: [], error: null },
      pil_prospect_digital_twins: [
        { data: existingTwin, error: null }, // load existing twin
        { data: null, error: null }, // update result
      ],
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ProspectDigitalTwinAgent } = await import("@/lib/pil/agents/knw/BEN-KNW-01");
    const agent = new ProspectDigitalTwinAgent();
    const context = baseContext({ agentCode: "BEN-KNW-01", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (result.conclusions as { report: { twinVersion: number; conflictedFields: string[] } }).report;
    expect(report.twinVersion).toBe(4);
    expect(report.conflictedFields).toContain("biography");
    expect(result.delegations).toContainEqual(
      expect.objectContaining({ childAgentCode: "BEN-KNW-04" }),
    );

    const twinUpdate = calls.find((c) => c.table === "pil_prospect_digital_twins" && c.method === "update");
    expect(twinUpdate).toBeDefined();
    expect((twinUpdate!.payload as { biography: unknown }).biography).toEqual(existingTwin.biography);
    expect((twinUpdate!.payload as { twin_version: number }).twin_version).toBe(4);
  });

  it("delegates to BEN-KNW-02 when a fuzzy-duplicate canonical_name exists in the same organization and no twin exists yet", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect, getEdges } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");

    const prospect = {
      id: "p1",
      display_name: "Jane Donor",
      canonical_name: "jane donor",
      entity_type: "individual",
    };

    vi.mocked(getEvidence).mockResolvedValue([] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(getEdges).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const { client } = makeClient({
      pil_prospects: [
        { data: prospect, error: null }, // loadProspect
        { data: [{ id: "p2", canonical_name: "jane donor family trust" }], error: null }, // fuzzy-duplicate scan
      ],
      pil_contradictions: { data: [], error: null },
      pil_prospect_opportunities: { data: [], error: null },
      pil_prospect_digital_twins: [
        { data: null, error: null }, // load existing twin -- none yet (first twin)
        { data: null, error: null }, // insert result
      ],
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ProspectDigitalTwinAgent } = await import("@/lib/pil/agents/knw/BEN-KNW-01");
    const agent = new ProspectDigitalTwinAgent();
    const context = baseContext({ agentCode: "BEN-KNW-01", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    expect(result.delegations).toContainEqual(
      expect.objectContaining({
        childAgentCode: "BEN-KNW-02",
        constraints: expect.objectContaining({ candidateProspectIds: ["p2"] }),
      }),
    );
  });

  it("delegates to BEN-SUP-05 when completeness_score crosses the 0.7 threshold upward between the prior twin and this run", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect, getEdges } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");

    const prospect = {
      id: "p1",
      display_name: "Jane Donor",
      canonical_name: "jane donor",
      entity_type: "individual",
    };

    const now = "2026-08-27T00:00:00Z";
    function evidenceItem(overrides: Record<string, unknown>) {
      return {
        id: "ev-x",
        organization_id: ORG_ID,
        entity_id: "p1",
        entity_table: "pil_prospects",
        claim: "placeholder",
        value: null,
        claim_type: "employment",
        source_url: null,
        source_title: null,
        source_type: "open_web",
        publisher: null,
        retrieved_at: now,
        published_at: now,
        last_verified_at: null,
        evidence_excerpt: null,
        agent_id: "BEN-INT-01",
        research_run_id: "run-1",
        confidence: 0.9,
        verification_status: "verified_fact",
        freshness_status: "fresh",
        inference_status: "direct",
        contradiction_status: "none",
        lineage: [],
        created_at: now,
        ...overrides,
      };
    }

    const evidence = [
      evidenceItem({ id: "ev-bio", claim_type: "employment" }),
      evidenceItem({ id: "ev-giving", claim_type: "giving_history" }),
      evidenceItem({ id: "ev-wealth", claim_type: "wealth_capacity" }),
      evidenceItem({ id: "ev-affinity", claim_type: "mission_affinity" }),
    ];

    const node = {
      id: "node-1",
      organization_id: ORG_ID,
      node_type: "person",
      prospect_id: "p1",
      label: "Jane Donor",
      properties: {},
      created_at: now,
      updated_at: now,
    };

    const edge = {
      id: "edge-1",
      organization_id: ORG_ID,
      source_node_id: "node-1",
      target_node_id: "node-2",
      edge_type: "related_to",
      relationship_strength: "moderate",
      confidence: 0.7,
      temporal_validity_start: null,
      temporal_validity_end: null,
      is_current: true,
      superseded_by_edge_id: null,
      properties: {},
      created_at: now,
      updated_at: now,
    };

    // Prior twin: low completeness (0.3, below the 0.7 threshold) and empty
    // fact-bearing/capacity fields, so no conflict is flagged and the only
    // trigger in play is the completeness crossing itself.
    const existingTwin = {
      id: "twin-1",
      prospect_id: "p1",
      organization_id: ORG_ID,
      twin_version: 2,
      identity: {},
      biography: {},
      organizations_summary: [],
      companies: [],
      foundations: [],
      giving_history: [],
      wealth_indicators: {},
      relationships_summary: [],
      evidence_summary: {},
      timeline: [],
      affinity: {},
      capacity: {},
      opportunities_summary: [],
      research_gaps: [],
      contradictions_summary: [],
      current_strategy: {},
      monitoring_events_summary: [],
      completeness_score: 0.3,
      last_updated_by_agent_id: "BEN-KNW-01",
      updated_at: "2026-08-01T00:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
    };

    vi.mocked(getEvidence).mockResolvedValue(evidence as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([node] as never);
    vi.mocked(getEdges).mockResolvedValue([edge] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const { client } = makeClient({
      pil_prospects: { data: prospect, error: null },
      pil_contradictions: { data: [], error: null },
      pil_prospect_opportunities: { data: [], error: null }, // no opportunities -- keeps capacity empty on both sides
      pil_prospect_digital_twins: [
        { data: existingTwin, error: null }, // load existing twin
        { data: null, error: null }, // update result
      ],
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ProspectDigitalTwinAgent } = await import("@/lib/pil/agents/knw/BEN-KNW-01");
    const agent = new ProspectDigitalTwinAgent();
    const context = baseContext({ agentCode: "BEN-KNW-01", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (result.conclusions as { report: { completenessScore: number } }).report;
    expect(report.completenessScore).toBeGreaterThanOrEqual(0.7);
    expect(result.delegations).toContainEqual(expect.objectContaining({ childAgentCode: "BEN-SUP-05" }));
  });
});

describe("BEN-KNW-03 Evidence & Provenance Verification Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("flags evidence older than its source's TTL as stale", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence, detectContradiction } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");

    // open_web TTL is 14 days (336h); retrieved ~2000 hours ago is well past it.
    const oldRetrievedAt = new Date(Date.now() - 2000 * 60 * 60 * 1000).toISOString();
    const staleEvidence = {
      id: "ev-old",
      organization_id: ORG_ID,
      entity_id: "p1",
      entity_table: "pil_prospects",
      claim: "Works at Acme Corp",
      value: null,
      claim_type: "employment",
      source_url: "https://example.com/bio",
      source_title: "Bio page",
      source_type: "open_web",
      publisher: null,
      retrieved_at: oldRetrievedAt,
      published_at: null,
      last_verified_at: null,
      evidence_excerpt: "Jane works at Acme Corp",
      agent_id: "BEN-INT-02",
      research_run_id: "run-1",
      confidence: 0.8,
      verification_status: "single_source_fact",
      freshness_status: "fresh",
      inference_status: "direct",
      contradiction_status: "none",
      lineage: [],
      created_at: oldRetrievedAt,
    };

    vi.mocked(getEvidence).mockResolvedValue([staleEvidence] as never);
    vi.mocked(detectContradiction).mockResolvedValue(false as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const { client, calls } = makeClient({
      pil_evidence: [{ data: null, error: null }, { data: null, error: null }],
      pil_prospect_opportunities: { data: null, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { EvidenceProvenanceAgent } = await import("@/lib/pil/agents/knw/BEN-KNW-03");
    const agent = new EvidenceProvenanceAgent();
    const context = baseContext({ agentCode: "BEN-KNW-03", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (result.conclusions as { report: { staleFlagged: string[]; evidenceScanned: number } }).report;
    expect(report.evidenceScanned).toBe(1);
    expect(report.staleFlagged).toContain("ev-old");

    const staleUpdate = calls.find(
      (c) => c.table === "pil_evidence" && c.method === "update" && (c.payload as { freshness_status?: string }).freshness_status === "stale",
    );
    expect(staleUpdate).toBeDefined();
  });

  it("computes claimSupportScore/sourceDirectnessScore/sourceIndependenceScore on a representative multi-item fixture", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence, detectContradiction } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");

    const now = new Date().toISOString();
    function evidenceItem(overrides: Record<string, unknown>) {
      return {
        id: "ev-x",
        organization_id: ORG_ID,
        entity_id: "p1",
        entity_table: "pil_prospects",
        claim: "placeholder",
        value: null,
        claim_type: "wealth_capacity",
        source_url: null,
        source_title: null,
        source_type: "open_web",
        publisher: null,
        retrieved_at: now,
        published_at: now,
        last_verified_at: null,
        evidence_excerpt: null,
        agent_id: "BEN-INT-08",
        research_run_id: "run-1",
        confidence: 0.8,
        verification_status: "single_source_fact",
        freshness_status: "fresh",
        inference_status: "direct",
        contradiction_status: "none",
        lineage: [],
        created_at: now,
        ...overrides,
      };
    }

    // Two claim_type groups of 2 items each:
    //  - wealth_capacity: distinct publishers (Foundation Directory, Forbes) -> independence 2/2 = 100%
    //  - employment: same source_url domain (irs.gov) via the publisher-null fallback -> independence 1/2 = 50%
    // claimSupportScore: 2 of 4 items have a non-empty evidence_excerpt -> 50%.
    // sourceDirectnessScore: avg(70 foundation_information, 50 news, 100 irs_form_990, 30 open_web) = 62.5 -> rounds to 63.
    const evidence = [
      evidenceItem({
        id: "ev-1",
        claim_type: "wealth_capacity",
        source_type: "foundation_information",
        publisher: "Foundation Directory",
        evidence_excerpt: "excerpt A",
      }),
      evidenceItem({ id: "ev-2", claim_type: "wealth_capacity", source_type: "news", publisher: "Forbes", evidence_excerpt: null }),
      evidenceItem({
        id: "ev-3",
        claim_type: "employment",
        source_type: "irs_form_990",
        publisher: null,
        source_url: "https://irs.gov/filing",
        evidence_excerpt: "excerpt C",
      }),
      evidenceItem({
        id: "ev-4",
        claim_type: "employment",
        source_type: "open_web",
        publisher: null,
        source_url: "https://irs.gov/filing2",
        evidence_excerpt: null,
      }),
    ];

    vi.mocked(getEvidence).mockResolvedValue(evidence as never);
    vi.mocked(detectContradiction).mockResolvedValue(false as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const { client } = makeClient({
      pil_evidence: { data: null, error: null },
      pil_prospect_opportunities: { data: null, error: null },
      pil_source_registry: { data: [], error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { EvidenceProvenanceAgent } = await import("@/lib/pil/agents/knw/BEN-KNW-03");
    const agent = new EvidenceProvenanceAgent();
    const context = baseContext({ agentCode: "BEN-KNW-03", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (
      result.conclusions as {
        report: { claimSupportScore: number; sourceDirectnessScore: number; sourceIndependenceScore: number };
      }
    ).report;
    expect(report.claimSupportScore).toBe(50);
    expect(report.sourceDirectnessScore).toBe(63);
    expect(report.sourceIndependenceScore).toBe(75);
  });

  it("flags permissibilityFlagged (and delegates to BEN-SUP-05) when pil_source_registry has a prohibited row for the evidence's source_type", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence, detectContradiction } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");

    const now = new Date().toISOString();
    const prohibitedEvidence = {
      id: "ev-prohibited",
      organization_id: ORG_ID,
      entity_id: "p1",
      entity_table: "pil_prospects",
      claim: "Scraped from a site pil_source_registry marks prohibited",
      value: null,
      claim_type: "wealth_capacity",
      source_url: "https://scrapedsite.example.com/x",
      source_title: null,
      source_type: "open_web",
      publisher: null,
      retrieved_at: now,
      published_at: now,
      last_verified_at: null,
      evidence_excerpt: "excerpt",
      agent_id: "BEN-INT-08",
      research_run_id: "run-1",
      confidence: 0.7,
      verification_status: "single_source_fact",
      freshness_status: "fresh",
      inference_status: "direct",
      contradiction_status: "none",
      lineage: [],
      created_at: now,
    };

    vi.mocked(getEvidence).mockResolvedValue([prohibitedEvidence] as never);
    vi.mocked(detectContradiction).mockResolvedValue(false as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const { client } = makeClient({
      pil_evidence: { data: null, error: null },
      pil_prospect_opportunities: { data: null, error: null },
      pil_source_registry: { data: [{ source_type: "open_web", permissibility_status: "prohibited" }], error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { EvidenceProvenanceAgent } = await import("@/lib/pil/agents/knw/BEN-KNW-03");
    const agent = new EvidenceProvenanceAgent();
    const context = baseContext({ agentCode: "BEN-KNW-03", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (result.conclusions as { report: { permissibilityFlagged: string[] } }).report;
    expect(report.permissibilityFlagged).toEqual(["ev-prohibited"]);
    expect(result.delegations).toContainEqual(expect.objectContaining({ childAgentCode: "BEN-SUP-05" }));
  });

  // Regression test for the scoreEvidenceQuality() upgrade: reuses the exact
  // fixture from "flags evidence older than its source's TTL as stale" above
  // and asserts its evidenceQualityScore is numerically unchanged from the
  // pre-upgrade formula. Approach taken: hand-computed expected value
  // hard-coded below (not compute-then-compare against a freshly-computed
  // value), so this test actually fails if the formula's behavior silently
  // changes rather than trivially passing against itself.
  it("keeps the pre-upgrade evidenceQualityScore numerically unchanged for the existing staleness fixture", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence, detectContradiction } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");

    const oldRetrievedAt = new Date(Date.now() - 2000 * 60 * 60 * 1000).toISOString();
    const staleEvidence = {
      id: "ev-old",
      organization_id: ORG_ID,
      entity_id: "p1",
      entity_table: "pil_prospects",
      claim: "Works at Acme Corp",
      value: null,
      claim_type: "employment",
      source_url: "https://example.com/bio",
      source_title: "Bio page",
      source_type: "open_web",
      publisher: null,
      retrieved_at: oldRetrievedAt,
      published_at: null,
      last_verified_at: null,
      evidence_excerpt: "Jane works at Acme Corp",
      agent_id: "BEN-INT-02",
      research_run_id: "run-1",
      confidence: 0.8,
      verification_status: "single_source_fact",
      freshness_status: "fresh",
      inference_status: "direct",
      contradiction_status: "none",
      lineage: [],
      created_at: oldRetrievedAt,
    };

    vi.mocked(getEvidence).mockResolvedValue([staleEvidence] as never);
    vi.mocked(detectContradiction).mockResolvedValue(false as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const { client } = makeClient({
      pil_evidence: [{ data: null, error: null }, { data: null, error: null }],
      pil_prospect_opportunities: { data: null, error: null },
      pil_source_registry: { data: [], error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { EvidenceProvenanceAgent } = await import("@/lib/pil/agents/knw/BEN-KNW-03");
    const agent = new EvidenceProvenanceAgent();
    const context = baseContext({ agentCode: "BEN-KNW-03", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    // confidence 0.8 * VERIFICATION_WEIGHT.single_source_fact 0.7 = 0.56 avg;
    // stalePenalty = 1/1 = 1; contradictionPenalty = 0/1 = 0;
    // permissibilityPenalty = 0/1 = 0 (no pil_source_registry rows mocked for
    // open_web, so nothing is flagged). score = 0.56 * (1 - 0.5*1) *
    // (1 - 0.5*0) * (1 - 0.5*0) = 0.56 * 0.5 = 0.28 -> round(0.28*100) = 28.
    // This is identical to the pre-upgrade formula's output for this fixture
    // since the new permissibilityPenalty term is a no-op at 0.
    const report = (result.conclusions as { report: { evidenceQualityScore: number } }).report;
    expect(report.evidenceQualityScore).toBe(28);
  });
});

describe("BEN-KNW-04 Contradiction and Freshness Investigator", () => {
  beforeEach(() => vi.resetAllMocks());

  const now = new Date().toISOString();

  function evidenceItem(overrides: Record<string, unknown> = {}) {
    return {
      id: "ev-x",
      organization_id: ORG_ID,
      entity_id: "p1",
      entity_table: "pil_prospects",
      claim: "placeholder claim",
      value: null,
      claim_type: "employment",
      source_url: null,
      source_title: null,
      source_type: "open_web",
      publisher: null,
      retrieved_at: now,
      published_at: null,
      last_verified_at: null,
      evidence_excerpt: null,
      agent_id: "BEN-INT-02",
      research_run_id: "run-1",
      confidence: 0.8,
      verification_status: "single_source_fact",
      freshness_status: "fresh",
      inference_status: "direct",
      contradiction_status: "contradicted",
      lineage: [],
      created_at: now,
      ...overrides,
    };
  }

  function contradictionRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "contra-1",
      organization_id: ORG_ID,
      prospect_id: "p1",
      claim_type: "employment",
      evidence_id_a: "ev-a",
      evidence_id_b: "ev-b",
      resolution_status: "open",
      resolved_value: null,
      investigated_by_agent_id: null,
      resolved_at: null,
      created_at: now,
      ...overrides,
    };
  }

  it("resolves an open pil_contradictions row to resolved_a when evidence A has materially higher canonicalWeight than evidence B", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockResolvedValue([] as never); // nothing to flag in the claim-type staleness sweep
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const evidenceA = evidenceItem({ id: "ev-a", verification_status: "verified_fact", confidence: 0.95, freshness_status: "fresh", value: { role: "CEO" } });
    const evidenceB = evidenceItem({ id: "ev-b", verification_status: "unverified", confidence: 0.3, freshness_status: "stale", value: { role: "unknown" } });
    const contradiction = contradictionRow();

    const { client, calls } = makeClient({
      pil_contradictions: [
        { data: [contradiction], error: null }, // loadOpenContradictions
        { data: null, error: null }, // update result
      ],
      pil_evidence: { data: [evidenceA, evidenceB], error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ContradictionFreshnessInvestigatorAgent } = await import("@/lib/pil/agents/knw/BEN-KNW-04");
    const agent = new ContradictionFreshnessInvestigatorAgent();
    const context = baseContext({ agentCode: "BEN-KNW-04", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (result.conclusions as { report: { resolvedA: number } }).report;
    expect(report.resolvedA).toBe(1);
    expect(result.status).toBe("completed");

    const update = calls.find((c) => c.table === "pil_contradictions" && c.method === "update");
    expect(update).toBeDefined();
    expect(update!.payload).toMatchObject({
      resolution_status: "resolved_a",
      resolved_value: { role: "CEO" },
      investigated_by_agent_id: "BEN-KNW-04",
    });
    expect((update!.payload as { resolved_at: string | null }).resolved_at).not.toBeNull();
  });

  it("resolves to 'unresolved' when both sides' canonicalWeights are within the 0.1 margin", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    // weightA = 0.7 * 0.9 * 1 = 0.63; weightB = 0.7 * 0.85 * 1 = 0.595 -- both
    // well above the both-stale threshold (0.35), diff 0.035 < 0.1 margin.
    const evidenceA = evidenceItem({ id: "ev-a", verification_status: "single_source_fact", confidence: 0.9, freshness_status: "fresh" });
    const evidenceB = evidenceItem({ id: "ev-b", verification_status: "single_source_fact", confidence: 0.85, freshness_status: "fresh" });
    const contradiction = contradictionRow();

    const { client, calls } = makeClient({
      pil_contradictions: [
        { data: [contradiction], error: null },
        { data: null, error: null },
      ],
      pil_evidence: { data: [evidenceA, evidenceB], error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ContradictionFreshnessInvestigatorAgent } = await import("@/lib/pil/agents/knw/BEN-KNW-04");
    const agent = new ContradictionFreshnessInvestigatorAgent();
    const context = baseContext({ agentCode: "BEN-KNW-04", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (result.conclusions as { report: { unresolved: number } }).report;
    expect(report.unresolved).toBe(1);

    const update = calls.find((c) => c.table === "pil_contradictions" && c.method === "update");
    expect(update!.payload).toMatchObject({ resolution_status: "unresolved", resolved_value: null });
  });

  it("flags an old employment-claim_type evidence item in claimTypeStaleFlagged using the 180-day window", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { logAction } = await import("@/lib/pil/audit");

    const oldRetrievedAt = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(); // 200 days ago, past the 180-day employment window
    const staleEmploymentEvidence = evidenceItem({ id: "ev-old-employment", claim_type: "employment", retrieved_at: oldRetrievedAt });

    vi.mocked(getEvidence).mockResolvedValue([staleEmploymentEvidence] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const { client } = makeClient({
      pil_contradictions: { data: [], error: null }, // no open contradictions -- isolates the staleness dimension
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ContradictionFreshnessInvestigatorAgent } = await import("@/lib/pil/agents/knw/BEN-KNW-04");
    const agent = new ContradictionFreshnessInvestigatorAgent();
    const context = baseContext({ agentCode: "BEN-KNW-04", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (result.conclusions as { report: { claimTypeStaleFlagged: string[]; contradictionsProcessed: number } }).report;
    expect(report.claimTypeStaleFlagged).toContain("ev-old-employment");
    expect(report.contradictionsProcessed).toBe(0);
    expect(result.status).toBe("completed");
  });

  it("fires both createReviewItem() and a BEN-SUP-05 delegation when a tier-impacting wealth_capacity contradiction resolves to a new canonical value", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getEvidence).mockResolvedValue([] as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const evidenceA = evidenceItem({
      id: "ev-a",
      claim_type: "wealth_capacity",
      verification_status: "verified_fact",
      confidence: 0.9,
      freshness_status: "fresh",
      value: { wealth: { low: 1_000_000, high: 5_000_000 } },
    });
    const evidenceB = evidenceItem({
      id: "ev-b",
      claim_type: "wealth_capacity",
      verification_status: "unverified",
      confidence: 0.2,
      freshness_status: "stale",
      value: { wealth: { low: 10_000, high: 50_000 } },
    });
    const contradiction = contradictionRow({ claim_type: "wealth_capacity" });

    const { client } = makeClient({
      pil_contradictions: [
        { data: [contradiction], error: null },
        { data: null, error: null },
      ],
      pil_evidence: { data: [evidenceA, evidenceB], error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ContradictionFreshnessInvestigatorAgent } = await import("@/lib/pil/agents/knw/BEN-KNW-04");
    const agent = new ContradictionFreshnessInvestigatorAgent();
    const context = baseContext({ agentCode: "BEN-KNW-04", prospectId: "p1" });

    const result = await agent.execute(context as never, {} as never);

    const report = (result.conclusions as { report: { tierImpactingCanonicalChanges: number; resolvedA: number } }).report;
    expect(report.resolvedA).toBe(1);
    expect(report.tierImpactingCanonicalChanges).toBe(1);
    expect(vi.mocked(createReviewItem)).toHaveBeenCalledTimes(1);
    expect(result.delegations).toContainEqual(expect.objectContaining({ childAgentCode: "BEN-SUP-05" }));
  });
});
