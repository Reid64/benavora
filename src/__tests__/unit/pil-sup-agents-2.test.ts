// Unit tests for BEN-SUP-05, BEN-SUP-07, BEN-SUP-08. Everything is mocked --
// no real DB calls, matching pil-sup-agents.test.ts's convention.
import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG_ID = "11111111-2222-3333-4444-555555555555";

vi.mock("@/lib/pil/db", () => ({
  getPilClient: vi.fn(),
  pilProspects: vi.fn(),
}));
vi.mock("@/lib/pil/evidence", () => ({ getEvidence: vi.fn() }));
vi.mock("@/lib/pil/graph", () => ({ getNodesByProspect: vi.fn(), getEdges: vi.fn() }));
vi.mock("@/lib/pil/audit", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/pil/human-review", () => ({ createReviewItem: vi.fn() }));

function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    agentCode: "BEN-SUP-05",
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

// Generic chainable Supabase-client mock. Table-keyed responses can be a
// single { data, error } object (returned for every call against that
// table) or an array of them (consumed in call order, last entry repeats).
type MockResponse = { data: unknown; error: unknown };
function makeClient(responses: Record<string, MockResponse | MockResponse[]>) {
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
      insert: vi.fn(() => c),
      update: vi.fn(() => c),
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
  return { from: vi.fn((table: string) => chain(table)) };
}

describe("BEN-SUP-05 Prospect Research Critic & Red-Team Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("rejects evidence marked as inference when presented as fact", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");
    const { createReviewItem } = await import("@/lib/pil/human-review");

    const targetRun = {
      id: "producing-run-1",
      organization_id: ORG_ID,
      agent_id: "BEN-INT-08",
      research_run_id: "run-1",
      delegated_task_id: null,
      goal_id: null,
      status: "completed",
      autonomy_level_used: "A2",
      input: {},
      // The producing agent asserted ev-1's claim as fact.
      output: { assertedFacts: [{ claimType: "wealth_capacity", evidenceId: "ev-1" }] },
      tokens_consumed: 0,
      cost_usd: 0,
      started_at: null,
      completed_at: null,
      error: null,
      created_at: "2026-01-01T00:00:00Z",
    };

    const inferredEvidence = {
      id: "ev-1",
      organization_id: ORG_ID,
      entity_id: "p1",
      entity_table: "pil_prospects",
      claim: "Estimated net worth exceeds $50M",
      value: null,
      claim_type: "wealth_capacity",
      source_url: "https://example.com/article",
      source_title: "Article",
      source_type: "open_web",
      publisher: null,
      retrieved_at: "2026-01-01T00:00:00Z",
      published_at: null,
      last_verified_at: null,
      evidence_excerpt: null,
      agent_id: "BEN-INT-08",
      research_run_id: "run-1",
      confidence: 0.6,
      // This evidence is only a reasoned inference -- not a verified fact.
      verification_status: "reasoned_inference",
      freshness_status: "fresh",
      inference_status: "inferred",
      contradiction_status: "none",
      lineage: [],
      created_at: "2026-01-01T00:00:00Z",
    };

    vi.mocked(getEvidence).mockResolvedValue([inferredEvidence] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);

    const recorded: Array<{ table: string; payload: unknown }> = [];
    const client = makeClient({
      pil_agent_runs: { data: targetRun, error: null },
      pil_entity_resolution_candidates: { data: [], error: null },
    });
    const originalFrom = client.from;
    client.from = vi.fn((table: string) => {
      const c = originalFrom(table) as Record<string, unknown>;
      if (table === "pil_policy_decisions") {
        const insert = vi.fn((payload: unknown) => {
          recorded.push({ table, payload });
          return c;
        });
        return { ...c, insert };
      }
      return c;
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ProspectResearchCriticAgent } = await import("@/lib/pil/agents/sup/BEN-SUP-05");
    const critic = new ProspectResearchCriticAgent();
    const context = baseContext({
      agentCode: "BEN-SUP-05",
      prospectId: "p1",
      plan: { targetAgentRunId: "producing-run-1" },
    });

    const result = await critic.execute(context as never, {} as never);

    const report = (result.conclusions as { report: { verdict: string; claims: Array<{ evidenceId: string; failedChecks: string[]; pass: boolean }> } }).report;
    const claim = report.claims.find((c) => c.evidenceId === "ev-1");

    expect(claim?.pass).toBe(false);
    expect(claim?.failedChecks).toContain("inference_presented_as_fact");
    expect(report.verdict).toBe("BLOCK_INSUFFICIENT_EVIDENCE");
    expect(result.status).toBe("escalated");

    expect(vi.mocked(createReviewItem)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createReviewItem).mock.calls[0]?.[0]).toMatchObject({
      review_type: "critic_block",
      subject_id: "producing-run-1",
    });

    const policyDecision = recorded.find((r) => r.table === "pil_policy_decisions");
    expect((policyDecision?.payload as { decision: string } | undefined)?.decision).toBe("deny");
  });
});

describe("BEN-SUP-07 Autonomy Governor", () => {
  beforeEach(() => vi.resetAllMocks());

  it("terminates a run that requests elevated autonomy", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { logAction } = await import("@/lib/pil/audit");
    const { createReviewItem } = await import("@/lib/pil/human-review");

    const elevatedRun = {
      id: "run-elevated",
      organization_id: ORG_ID,
      agent_id: "BEN-INT-08",
      research_run_id: "run-1",
      delegated_task_id: null,
      goal_id: null,
      status: "running",
      // BEN-INT-08 is registered at A2 (migration 155) -- this run claims A4.
      autonomy_level_used: "A4",
      input: {},
      output: null,
      tokens_consumed: 0,
      cost_usd: 0,
      started_at: "2026-01-01T00:00:00Z",
      completed_at: null,
      error: null,
      created_at: "2026-01-01T00:00:00Z",
    };
    const agentDef = {
      agent_id: "BEN-INT-08",
      name: "Wealth & Capacity Intelligence Agent",
      family: "prospect_intelligence",
      mission: "m",
      default_autonomy_level: "A2",
      human_boundary: null,
      cadence: "c",
      version: "1.0",
      spec_ref: "s",
      active: true,
      created_at: "2026-01-01T00:00:00Z",
    };

    vi.mocked(logAction).mockResolvedValue(undefined as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);

    const recorded: Array<{ table: string; payload: unknown }> = [];
    const client = makeClient({
      pil_agent_runs: [{ data: [elevatedRun], error: null }, { data: null, error: null }],
      pil_agent_registry: { data: [agentDef], error: null },
      pil_delegated_tasks: { data: [], error: null },
      pil_feature_flags: { data: [], error: null },
      pil_human_review_queue: { data: [], error: null },
    });
    const originalFrom = client.from;
    client.from = vi.fn((table: string) => {
      const c = originalFrom(table) as Record<string, unknown>;
      if (table === "pil_agent_runs") {
        const update = vi.fn((payload: unknown) => {
          recorded.push({ table, payload });
          return c;
        });
        return { ...c, update };
      }
      return c;
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { AutonomyGovernorAgent } = await import("@/lib/pil/agents/sup/BEN-SUP-07");
    const governor = new AutonomyGovernorAgent();
    const context = baseContext({ agentCode: "BEN-SUP-07" });

    const result = await governor.execute(context as never, {} as never);

    const conclusions = result.conclusions as { violations: Array<{ type: string; agentRunId: string | null }>; terminatedRunIds: string[] };
    expect(conclusions.terminatedRunIds).toEqual(["run-elevated"]);
    expect(conclusions.violations.some((v) => v.type === "autonomy_ceiling_exceeded" && v.agentRunId === "run-elevated")).toBe(true);

    const terminateUpdate = recorded.find((r) => r.table === "pil_agent_runs");
    expect((terminateUpdate?.payload as { status: string } | undefined)?.status).toBe("failed");

    expect(vi.mocked(createReviewItem)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logAction)).toHaveBeenCalledWith(expect.objectContaining({ action: "AUTONOMY_VIOLATION" }));
  });
});

describe("BEN-SUP-08 Executive Intelligence Narrative Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("separates verified facts from inferences in dossier output", async () => {
    const { getPilClient, pilProspects } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");

    const prospect = {
      id: "p1",
      organization_id: ORG_ID,
      entity_type: "individual",
      display_name: "Jane Donor",
      canonical_name: "jane donor",
      status: "active",
      merged_into_prospect_id: null,
      source_of_record: "discovery",
      created_by_agent_id: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    const verifiedFact = {
      id: "ev-fact", organization_id: ORG_ID, entity_id: "p1", entity_table: "pil_prospects",
      claim: "Serves as CEO of Acme Corp", value: null, claim_type: "professional_position",
      source_url: "https://example.com/bio", source_title: null, source_type: "open_web", publisher: null,
      retrieved_at: "2026-01-01T00:00:00Z", published_at: null, last_verified_at: null, evidence_excerpt: null,
      agent_id: "BEN-INT-02", research_run_id: "run-1", confidence: 0.9,
      verification_status: "verified_fact", freshness_status: "fresh", inference_status: "direct",
      contradiction_status: "none", lineage: [], created_at: "2026-01-01T00:00:00Z",
    };
    const inferredFact = {
      id: "ev-infer", organization_id: ORG_ID, entity_id: "p1", entity_table: "pil_prospects",
      claim: "Estimated net worth exceeds $50M", value: null, claim_type: "wealth_capacity",
      source_url: null, source_title: null, source_type: "open_web", publisher: null,
      retrieved_at: "2026-01-01T00:00:00Z", published_at: null, last_verified_at: null, evidence_excerpt: null,
      agent_id: "BEN-INT-08", research_run_id: "run-1", confidence: 0.5,
      verification_status: "reasoned_inference", freshness_status: "fresh", inference_status: "inferred",
      contradiction_status: "none", lineage: [], created_at: "2026-01-01T00:00:00Z",
    };

    vi.mocked(pilProspects).mockReturnValue({
      eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: prospect, error: null }) })),
    } as never);
    vi.mocked(getEvidence).mockResolvedValue([verifiedFact, inferredFact] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const client = makeClient({
      pil_prospect_dossiers: [{ data: null, error: null }, { data: { id: "dossier-1", version: 1 }, error: null }],
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ExecutiveIntelligenceNarrativeAgent } = await import("@/lib/pil/agents/sup/BEN-SUP-08");
    const agent = new ExecutiveIntelligenceNarrativeAgent();
    const context = baseContext({ agentCode: "BEN-SUP-08", prospectId: "p1", runId: "run-1" });

    const result = await agent.execute(context as never, {} as never);

    const dossier = (result.conclusions as { dossier: { verifiedFacts: Array<{ evidenceId: string }>; inferences: Array<{ evidenceId: string; evidenceChain: string[] }> } }).dossier;
    expect(dossier.verifiedFacts.map((f) => f.evidenceId)).toEqual(["ev-fact"]);
    expect(dossier.inferences.map((f) => f.evidenceId)).toEqual(["ev-infer"]);
    expect(dossier.inferences[0]?.evidenceChain).toContain("ev-infer");

    const narrativeText = (result.conclusions as { narrativeText: string }).narrativeText;
    expect(narrativeText).toContain("VERIFIED FACTS");
    expect(narrativeText).toContain("[INFERENCE]");
    expect(narrativeText.indexOf("VERIFIED FACTS")).toBeLessThan(narrativeText.indexOf("INFERENCES"));

    expect(result.status).toBe("completed");
    expect((result.conclusions as { dossierId: string }).dossierId).toBe("dossier-1");
  });
});
