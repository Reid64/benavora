// Unit tests for the PIL-02 supervisory agents (BEN-SUP-01..04). Everything
// is mocked -- no real DB calls, matching every other src/__tests__/unit/*
// suite in this repo (see pil-workflow.test.ts for the same convention).
import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG_ID = "11111111-2222-3333-4444-555555555555";

vi.mock("@/lib/pil/db", () => ({
  getPilClient: vi.fn(),
  pilResearchRuns: vi.fn(),
  pilProspects: vi.fn(),
}));
vi.mock("@/lib/pil/workflow", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pil/workflow")>("@/lib/pil/workflow");
  return {
    ...actual,
    createResearchRun: vi.fn(),
    advanceRunState: vi.fn(),
    getActiveRuns: vi.fn(),
  };
});
vi.mock("@/lib/pil/cost", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pil/cost")>("@/lib/pil/cost");
  return { ...actual, getBudgetSummary: vi.fn() };
});
vi.mock("@/lib/pil/audit", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/pil/human-review", () => ({ createReviewItem: vi.fn() }));
vi.mock("@/lib/pil/evidence", () => ({ getEvidence: vi.fn() }));
vi.mock("@/lib/pil/sources", () => ({ listActiveSources: vi.fn() }));

function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    agentCode: "BEN-SUP-01",
    orgId: ORG_ID,
    prospectId: null,
    runId: "run-alloc",
    goal: "test goal",
    plan: {},
    tools: [] as string[],
    budget: 1000,
    depth: 1,
    ...overrides,
  };
}

interface RecordedOp {
  table: string;
  kind: "insert" | "update" | "eq" | "in";
  col?: string;
  val?: unknown;
  payload?: unknown;
}

function makeSup04Client(responses: Record<string, unknown>, recorded: RecordedOp[]) {
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      select: vi.fn(() => c),
      update: vi.fn((payload: unknown) => {
        recorded.push({ table, kind: "update", payload });
        return c;
      }),
      eq: vi.fn((col: string, val: unknown) => {
        recorded.push({ table, kind: "eq", col, val });
        return c;
      }),
      in: vi.fn((col: string, val: unknown) => {
        recorded.push({ table, kind: "in", col, val });
        return c;
      }),
      then: (resolve: (v: unknown) => void) =>
        Promise.resolve(responses[table] ?? { data: null, error: null }).then(resolve),
    };
    return c;
  };
  return { from: vi.fn((table: string) => chain(table)) };
}

describe("BEN-SUP-01 Chief Prospect Intelligence Orchestrator", () => {
  beforeEach(() => vi.resetAllMocks());

  it("creates research runs for a prospect with no prior runs", async () => {
    const { pilResearchRuns, pilProspects } = await import("@/lib/pil/db");
    const { createResearchRun, advanceRunState } = await import("@/lib/pil/workflow");
    const { logAction } = await import("@/lib/pil/audit");
    const { createReviewItem } = await import("@/lib/pil/human-review");

    vi.mocked(pilResearchRuns).mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as never);
    vi.mocked(pilProspects).mockReturnValue({
      eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })),
    } as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);

    vi.mocked(createResearchRun).mockImplementation(
      async (params: { orgId: string; prospectId?: string | null; runType?: string; goal: string; triggeredBy: string }) =>
        ({
          id: `run-${params.runType}`,
          organization_id: params.orgId,
          goal_id: null,
          prospect_id: params.prospectId ?? null,
          initiating_agent_id: params.triggeredBy,
          natural_language_query: params.goal,
          structured_plan: { run_type: params.runType, depth_target: null },
          status: "planning",
          token_budget: null,
          tokens_consumed: 0,
          financial_budget: null,
          financial_spent: 0,
          started_at: null,
          completed_at: null,
          created_at: "2026-01-01T00:00:00Z",
        }) as never,
    );
    vi.mocked(advanceRunState).mockResolvedValue({} as never);

    const { ChiefProspectIntelligenceOrchestrator } = await import("@/lib/pil/agents/sup/BEN-SUP-01");
    const orchestrator = new ChiefProspectIntelligenceOrchestrator();
    const context = baseContext({ prospectId: "prospect-1", goal: "Build a complete profile for this prospect" });

    const result = await orchestrator.execute(context as never, {} as never);

    expect(vi.mocked(createResearchRun)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(advanceRunState)).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("running");
    expect(result.delegations.map((d) => d.childAgentCode)).toEqual(["BEN-SUP-02", "BEN-DIS-01"]);
    expect((result.conclusions.plan as { gapFamilies: string[] }).gapFamilies.length).toBe(3);
  });
});

describe("BEN-SUP-04 Research Portfolio Allocator", () => {
  beforeEach(() => vi.resetAllMocks());

  it("pauses the lowest-value run when the org budget is constrained", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getActiveRuns } = await import("@/lib/pil/workflow");
    const { getBudgetSummary } = await import("@/lib/pil/cost");
    const { logAction } = await import("@/lib/pil/audit");
    const { createReviewItem } = await import("@/lib/pil/human-review");

    const runA = {
      id: "run-a",
      organization_id: ORG_ID,
      goal_id: null,
      prospect_id: "p1",
      initiating_agent_id: "BEN-SUP-01",
      natural_language_query: "goal",
      structured_plan: { run_type: "discovery" },
      status: "running",
      token_budget: null,
      tokens_consumed: 0,
      financial_budget: null,
      financial_spent: 0,
      started_at: "2026-01-01T00:00:00Z",
      completed_at: null,
      created_at: "2026-01-01T00:00:00Z",
    };
    const runB = { ...runA, id: "run-b", prospect_id: "p2", structured_plan: { run_type: "prospect_intelligence" } };

    vi.mocked(getActiveRuns).mockResolvedValue([runA, runB] as never);
    vi.mocked(getBudgetSummary).mockResolvedValue([
      {
        id: "b1",
        organization_id: ORG_ID,
        scope_type: "org",
        scope_id: ORG_ID,
        budget_period: "daily",
        budget_limit_usd: 100,
        spent_usd: 90,
        alert_threshold_pct: 80,
        hard_stop: false,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);

    const agentRunsFixture = [
      { id: "ar-1", organization_id: ORG_ID, agent_id: "BEN-DIS-01", research_run_id: "run-a", delegated_task_id: null, goal_id: null, status: "failed", autonomy_level_used: "A2", input: {}, output: null, tokens_consumed: 0, cost_usd: 0, started_at: null, completed_at: null, error: null, created_at: "2026-01-01T00:00:00Z" },
      { id: "ar-2", organization_id: ORG_ID, agent_id: "BEN-DIS-01", research_run_id: "run-a", delegated_task_id: null, goal_id: null, status: "failed", autonomy_level_used: "A2", input: {}, output: null, tokens_consumed: 0, cost_usd: 0, started_at: null, completed_at: null, error: null, created_at: "2026-01-01T00:01:00Z" },
      { id: "ar-3", organization_id: ORG_ID, agent_id: "BEN-INT-01", research_run_id: "run-b", delegated_task_id: null, goal_id: null, status: "completed", autonomy_level_used: "A2", input: {}, output: null, tokens_consumed: 0, cost_usd: 0, started_at: null, completed_at: null, error: null, created_at: "2026-01-01T00:02:00Z" },
      { id: "ar-4", organization_id: ORG_ID, agent_id: "BEN-INT-08", research_run_id: "run-b", delegated_task_id: null, goal_id: null, status: "completed", autonomy_level_used: "A2", input: {}, output: null, tokens_consumed: 0, cost_usd: 0, started_at: null, completed_at: null, error: null, created_at: "2026-01-01T00:03:00Z" },
    ];
    const evidenceFixture = [
      { id: "ev-1", organization_id: ORG_ID, entity_id: "p1", entity_table: "pil_prospects", claim: "x", value: null, claim_type: "t", source_url: null, source_title: null, source_type: "open_web", publisher: null, retrieved_at: "2026-01-01T00:00:00Z", published_at: null, last_verified_at: null, evidence_excerpt: null, agent_id: "BEN-INT-01", research_run_id: null, confidence: 0.1, verification_status: "unverified", freshness_status: "fresh", inference_status: "direct", contradiction_status: "none", lineage: [], created_at: "2026-01-01T00:00:00Z" },
      { id: "ev-2", organization_id: ORG_ID, entity_id: "p2", entity_table: "pil_prospects", claim: "y", value: null, claim_type: "t", source_url: null, source_title: null, source_type: "open_web", publisher: null, retrieved_at: "2026-01-01T00:00:00Z", published_at: null, last_verified_at: null, evidence_excerpt: null, agent_id: "BEN-INT-01", research_run_id: null, confidence: 0.9, verification_status: "verified_fact", freshness_status: "fresh", inference_status: "direct", contradiction_status: "none", lineage: [], created_at: "2026-01-01T00:00:00Z" },
    ];

    const recorded: RecordedOp[] = [];
    vi.mocked(getPilClient).mockReturnValue(
      makeSup04Client(
        {
          pil_agent_runs: { data: agentRunsFixture, error: null },
          pil_evidence: { data: evidenceFixture, error: null },
        },
        recorded,
      ) as never,
    );

    const { ResearchPortfolioAllocator } = await import("@/lib/pil/agents/sup/BEN-SUP-04");
    const allocator = new ResearchPortfolioAllocator();
    const context = baseContext({ agentCode: "BEN-SUP-04", goal: "rebalance portfolio" });

    const result = await allocator.execute(context as never, {} as never);

    const pauseUpdates = recorded.filter((r) => r.table === "pil_research_runs" && r.kind === "update");
    expect(pauseUpdates).toHaveLength(1);
    expect((pauseUpdates[0]?.payload as { structured_plan: { paused: boolean } }).structured_plan.paused).toBe(true);

    const pauseTarget = recorded.find((r) => r.table === "pil_research_runs" && r.kind === "eq" && r.col === "id");
    expect(pauseTarget?.val).toBe("run-a");

    const decisions = result.conclusions.decisions as Array<{ action: string; runId: string }>;
    expect(decisions.some((d) => d.action === "pause" && d.runId === "run-a")).toBe(true);
    expect(decisions.some((d) => d.action === "reallocate" && d.runId === "run-b")).toBe(true);
    expect(result.delegations.some((d) => d.childAgentCode === "BEN-INT-08")).toBe(true);
  });
});

describe("BEN-SUP-02 Research Strategy Architect", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns a structured plan with agent assignments and delegates to BEN-SUP-03", async () => {
    const { pilProspects } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { listActiveSources } = await import("@/lib/pil/sources");
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

    vi.mocked(pilProspects).mockReturnValue({
      eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: prospect, error: null }) })),
    } as never);
    vi.mocked(getEvidence).mockResolvedValue([] as never);
    vi.mocked(listActiveSources).mockResolvedValue([
      { id: "s1", source_key: "open_web_search", source_name: "Open Web", source_type: "open_web", provider: null, permissibility_status: "permitted", tos_notes: null, rate_limit_per_minute: null, cost_per_call: null, requires_license: false, active: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: "s2", source_key: "sec_edgar_adapter", source_name: "SEC EDGAR", source_type: "sec_edgar", provider: null, permissibility_status: "permitted", tos_notes: null, rate_limit_per_minute: null, cost_per_call: null, requires_license: false, active: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const { ResearchStrategyArchitect } = await import("@/lib/pil/agents/sup/BEN-SUP-02");
    const architect = new ResearchStrategyArchitect();
    const context = baseContext({ agentCode: "BEN-SUP-02", prospectId: "p1", goal: "Assess this individual for major gift capacity" });

    const result = await architect.execute(context as never, {} as never);

    const plan = result.conclusions.plan as {
      gaps: string[];
      agentAssignments: Array<{ dimension: string; agentCode: string }>;
      sourceKeys: string[];
      score: number;
    };

    expect(plan.gaps).toHaveLength(5);
    expect(plan.agentAssignments.find((a) => a.dimension === "wealth_capacity")?.agentCode).toBe("BEN-INT-08");
    expect(plan.sourceKeys).toEqual(["open_web_search"]);
    expect(typeof plan.score).toBe("number");

    expect(result.delegations).toHaveLength(1);
    expect(result.delegations[0]?.childAgentCode).toBe("BEN-SUP-03");
    expect(result.delegations[0]?.constraints?.plan).toBeDefined();
    expect(result.status).toBe("completed");
  });
});
