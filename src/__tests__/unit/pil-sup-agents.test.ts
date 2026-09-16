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
vi.mock("@/lib/pil/audit", () => ({ logAction: vi.fn(), getAuditTrail: vi.fn() }));
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
      order: vi.fn(() => c),
      then: (resolve: (v: unknown) => void) =>
        Promise.resolve(responses[table] ?? { data: null, error: null }).then(resolve),
    };
    return c;
  };
  return { from: vi.fn((table: string) => chain(table)) };
}

// Per-table FIFO response queue -- BEN-SUP-03 issues multiple sequential
// queries against the *same* table (pil_agent_runs) for different purposes
// within one execute() call (this run's own tasks, then a redundant-run
// lookup), so a single static per-table response (as makeSup04Client uses)
// can't distinguish them. Each `.then()` resolution shifts the next queued
// response for that table; once a table's queue is empty it falls back to
// an empty result, matching "no matching rows" for that lookup.
function makeQueueClient(queues: Record<string, unknown[]>, recorded: RecordedOp[]) {
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      select: vi.fn(() => c),
      eq: vi.fn((col: string, val: unknown) => {
        recorded.push({ table, kind: "eq", col, val });
        return c;
      }),
      in: vi.fn((col: string, val: unknown) => {
        recorded.push({ table, kind: "in", col, val });
        return c;
      }),
      order: vi.fn(() => c),
      then: (resolve: (v: unknown) => void) => {
        const queue = queues[table];
        const response = queue && queue.length > 0 ? queue.shift() : { data: [], error: null };
        return Promise.resolve(response).then(resolve);
      },
    };
    return c;
  };
  return { from: vi.fn((table: string) => chain(table)) };
}

function makeAgentRun(overrides: Partial<{
  id: string;
  agent_id: string;
  research_run_id: string;
  status: string;
  error: string | null;
  started_at: string | null;
  created_at: string;
}> = {}) {
  return {
    id: overrides.id ?? "ar-1",
    organization_id: ORG_ID,
    agent_id: overrides.agent_id ?? "BEN-DIS-01",
    research_run_id: overrides.research_run_id ?? "run-current",
    delegated_task_id: null,
    goal_id: null,
    status: overrides.status ?? "completed",
    autonomy_level_used: "A2",
    input: {},
    output: null,
    tokens_consumed: 0,
    cost_usd: 0,
    started_at: overrides.started_at ?? null,
    completed_at: null,
    error: overrides.error ?? null,
    created_at: overrides.created_at ?? "2026-01-01T00:00:00Z",
  };
}

describe("BEN-SUP-03 Cross-Agent Research Planner", () => {
  beforeEach(() => vi.resetAllMocks());

  it("regression: dispatches stage 1 on a fresh run with no conditions triggered", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getBudgetSummary } = await import("@/lib/pil/cost");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getBudgetSummary).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const recorded: RecordedOp[] = [];
    vi.mocked(getPilClient).mockReturnValue(
      makeQueueClient({ pil_agent_runs: [{ data: [], error: null }] }, recorded) as never,
    );

    const { CrossAgentResearchPlanner } = await import("@/lib/pil/agents/sup/BEN-SUP-03");
    const planner = new CrossAgentResearchPlanner();
    const context = baseContext({ agentCode: "BEN-SUP-03", prospectId: null, runId: "run-current", goal: "plan research" });

    const result = await planner.execute(context as never, {} as never);

    // Phase 5.4 (2026-09-15): stage 1 now runs BEN-DIS-01/02/08 in parallel
    // (BEN-DIS-02 and BEN-DIS-08 were fully built but had no entry point
    // into this pipeline until this stage-1 expansion wired them in).
    expect(result.delegations).toEqual([
      { childAgentCode: "BEN-DIS-01", objective: expect.stringContaining("stage 1"), maxAutonomy: "A2" },
      { childAgentCode: "BEN-DIS-02", objective: expect.stringContaining("stage 1"), maxAutonomy: "A2" },
      { childAgentCode: "BEN-DIS-08", objective: expect.stringContaining("stage 1"), maxAutonomy: "A2" },
    ]);
    const decisions = result.conclusions.decisions as Array<{ action: string; stage: number }>;
    expect(decisions.some((d) => d.action === "dispatch_stage" && d.stage === 1)).toBe(true);
    // p5.2b (2026-09-15): was "running" -- that was the createRun() in-progress
    // placeholder leaking out as a bogus terminal AgentResult (fixed in
    // BEN-SUP-03.ts). This run's own unit of work (dispatch stage 1) is
    // complete; overall multi-stage progress lives elsewhere.
    expect(result.status).toBe("completed");
    expect(vi.mocked(logAction).mock.calls.some((c) => (c[0] as { action: string }).action === "planner.dispatch_stage")).toBe(true);
  });

  it("regression: replans only the failed stage's agents on an ordinary failure", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getBudgetSummary } = await import("@/lib/pil/cost");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getBudgetSummary).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const failedRun = makeAgentRun({ id: "ar-fail", agent_id: "BEN-DIS-01", status: "failed", error: "ETIMEDOUT calling source" });

    const recorded: RecordedOp[] = [];
    vi.mocked(getPilClient).mockReturnValue(
      makeQueueClient({ pil_agent_runs: [{ data: [failedRun], error: null }] }, recorded) as never,
    );

    const { CrossAgentResearchPlanner } = await import("@/lib/pil/agents/sup/BEN-SUP-03");
    const planner = new CrossAgentResearchPlanner();
    const context = baseContext({ agentCode: "BEN-SUP-03", prospectId: null, runId: "run-current", goal: "plan research" });

    const result = await planner.execute(context as never, {} as never);

    expect(result.delegations).toEqual([
      { childAgentCode: "BEN-DIS-01", objective: expect.stringContaining("Retry stage 1"), maxAutonomy: "A2" },
    ]);
    const decisions = result.conclusions.decisions as Array<{ action: string; stage: number; agents: string[] }>;
    expect(decisions.some((d) => d.action === "replan_failed_stage" && d.stage === 1 && d.agents.includes("BEN-DIS-01"))).toBe(true);
    expect(decisions.some((d) => d.action === "capability_absent")).toBe(false);
    expect(result.status).toBe("replanning");
  });

  it("skips redundant work already completed for this prospect and cascades to dispatch the next stage", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getBudgetSummary } = await import("@/lib/pil/cost");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getBudgetSummary).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const priorCompletedRun = (agentId: string) =>
      makeAgentRun({
        id: `ar-prior-${agentId.replace("BEN-", "").replace(/-/g, "").toLowerCase()}`,
        agent_id: agentId,
        research_run_id: "run-old",
        status: "completed",
        created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago, within the 7-day redundancy window
      });

    const recorded: RecordedOp[] = [];
    vi.mocked(getPilClient).mockReturnValue(
      makeQueueClient(
        {
          pil_agent_runs: [
            { data: [], error: null }, // 1. loadAgentRuns(run-current) -- nothing started yet
            // Phase 5.4 (2026-09-15): stage 1 now runs 3 agents in parallel
            // (BEN-DIS-01/02/08) -- findRedundantCompletedRun is called once
            // per stage-1 agent, so all 3 need a prior completed run for the
            // stage to be treated as fully satisfied and cascade to stage 2.
            { data: [priorCompletedRun("BEN-DIS-01")], error: null }, // 2. findRedundantCompletedRun for BEN-DIS-01
            { data: [priorCompletedRun("BEN-DIS-02")], error: null }, // 3. findRedundantCompletedRun for BEN-DIS-02
            { data: [priorCompletedRun("BEN-DIS-08")], error: null }, // 4. findRedundantCompletedRun for BEN-DIS-08
          ],
          pil_research_runs: [
            { data: [{ id: "run-old" }, { id: "run-current" }], error: null }, // research runs for org+prospect
            { data: [{ id: "run-old" }, { id: "run-current" }], error: null },
            { data: [{ id: "run-old" }, { id: "run-current" }], error: null },
          ],
        },
        recorded,
      ) as never,
    );

    const { CrossAgentResearchPlanner } = await import("@/lib/pil/agents/sup/BEN-SUP-03");
    const planner = new CrossAgentResearchPlanner();
    const context = baseContext({ agentCode: "BEN-SUP-03", prospectId: "prospect-1", runId: "run-current", goal: "plan research" });

    const result = await planner.execute(context as never, {} as never);

    // BEN-DIS-01 was skipped as redundant, not dispatched -- stage 2's
    // agents were dispatched instead once stage 1 was treated as
    // satisfied for this cycle.
    expect(result.delegations.map((d) => d.childAgentCode)).toEqual(["BEN-INT-01", "BEN-INT-08"]);

    const decisions = result.conclusions.decisions as Array<{ action: string; stage?: number; agentCode?: string; priorAgentRunId?: string }>;
    const redundant = decisions.find((d) => d.action === "redundant_task_skipped");
    expect(redundant).toMatchObject({ stage: 1, agentCode: "BEN-DIS-01", priorAgentRunId: "ar-prior-dis01" });
    expect(decisions.some((d) => d.action === "dispatch_stage" && d.stage === 2)).toBe(true);

    const stageStatuses = result.conclusions.stageStatuses as Array<{ stage: number; status: string }>;
    expect(stageStatuses.find((s) => s.stage === 1)?.status).toBe("completed");

    expect(vi.mocked(logAction).mock.calls.some((c) => (c[0] as { action: string }).action === "planner.redundant_task_skipped")).toBe(true);
  });

  it("delegates to BEN-SUP-06 when a stage's task has been orphaned/stuck past the staleness threshold", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getBudgetSummary } = await import("@/lib/pil/cost");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getBudgetSummary).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const staleStartedAt = new Date(Date.now() - 45 * 60 * 1000).toISOString(); // 45 min ago > 30 min threshold
    const stuckRun = makeAgentRun({ id: "ar-stuck", agent_id: "BEN-DIS-01", status: "running", started_at: staleStartedAt });

    const recorded: RecordedOp[] = [];
    vi.mocked(getPilClient).mockReturnValue(
      makeQueueClient({ pil_agent_runs: [{ data: [stuckRun], error: null }] }, recorded) as never,
    );

    const { CrossAgentResearchPlanner } = await import("@/lib/pil/agents/sup/BEN-SUP-03");
    const planner = new CrossAgentResearchPlanner();
    const context = baseContext({ agentCode: "BEN-SUP-03", prospectId: null, runId: "run-current", goal: "plan research" });

    const result = await planner.execute(context as never, {} as never);

    expect(result.delegations).toHaveLength(1);
    expect(result.delegations[0]?.childAgentCode).toBe("BEN-SUP-06");
    expect(result.delegations[0]?.objective).toContain("stage 1");
    expect(result.delegations[0]?.objective).toContain("BEN-DIS-01");
    expect(result.delegations[0]?.objective).toContain("run-current");

    const decisions = result.conclusions.decisions as Array<{ action: string; stage?: number }>;
    expect(decisions.some((d) => d.action === "orphan_detected" && d.stage === 1)).toBe(true);
    expect(decisions.some((d) => d.action === "await_dependencies")).toBe(false);
    expect(vi.mocked(logAction).mock.calls.some((c) => (c[0] as { action: string }).action === "planner.orphan_detected")).toBe(true);
  });

  it("routes a capability-absent failure to BEN-SUP-02 instead of retrying it", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getBudgetSummary } = await import("@/lib/pil/cost");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getBudgetSummary).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const notImplementedRun = makeAgentRun({
      id: "ar-notimpl",
      agent_id: "BEN-DIS-01",
      status: "failed",
      error: "Agent BEN-DIS-01 has no implementation yet",
    });

    const recorded: RecordedOp[] = [];
    vi.mocked(getPilClient).mockReturnValue(
      makeQueueClient({ pil_agent_runs: [{ data: [notImplementedRun], error: null }] }, recorded) as never,
    );

    const { CrossAgentResearchPlanner } = await import("@/lib/pil/agents/sup/BEN-SUP-03");
    const planner = new CrossAgentResearchPlanner();
    const context = baseContext({ agentCode: "BEN-SUP-03", prospectId: null, runId: "run-current", goal: "plan research" });

    const result = await planner.execute(context as never, {} as never);

    expect(result.delegations).toEqual([
      { childAgentCode: "BEN-SUP-02", objective: expect.stringContaining("BEN-DIS-01"), maxAutonomy: "A2" },
    ]);
    const decisions = result.conclusions.decisions as Array<{ action: string; agentCode?: string }>;
    expect(decisions.some((d) => d.action === "capability_absent" && d.agentCode === "BEN-DIS-01")).toBe(true);
    expect(decisions.some((d) => d.action === "replan_failed_stage")).toBe(false);
    expect(result.status).toBe("replanning");
    expect(vi.mocked(logAction).mock.calls.some((c) => (c[0] as { action: string }).action === "planner.capability_absent")).toBe(true);
  });

  it("skips dispatch and pushes no delegations when the org budget is at/over its alert threshold", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getBudgetSummary } = await import("@/lib/pil/cost");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getBudgetSummary).mockResolvedValue([
      {
        id: "b1",
        organization_id: ORG_ID,
        scope_type: "org",
        scope_id: ORG_ID,
        budget_period: "daily",
        budget_limit_usd: 100,
        spent_usd: 95,
        alert_threshold_pct: 80,
        hard_stop: false,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const recorded: RecordedOp[] = [];
    vi.mocked(getPilClient).mockReturnValue(
      makeQueueClient({ pil_agent_runs: [{ data: [], error: null }] }, recorded) as never,
    );

    const { CrossAgentResearchPlanner } = await import("@/lib/pil/agents/sup/BEN-SUP-03");
    const planner = new CrossAgentResearchPlanner();
    const context = baseContext({ agentCode: "BEN-SUP-03", prospectId: null, runId: "run-current", goal: "plan research" });

    const result = await planner.execute(context as never, {} as never);

    expect(result.delegations).toEqual([]);
    const decisions = result.conclusions.decisions as Array<{ action: string; stage?: number }>;
    // Phase 5.4 (2026-09-15): stage 1's agents array now includes BEN-DIS-02/08.
    expect(decisions).toEqual([
      { action: "budget_reservation_conflict", stage: 1, agents: ["BEN-DIS-01", "BEN-DIS-02", "BEN-DIS-08"] },
    ]);
    expect(vi.mocked(logAction).mock.calls.some((c) => (c[0] as { action: string }).action === "planner.budget_reservation_conflict")).toBe(true);
  });
});

describe("BEN-SUP-01 Chief Prospect Intelligence Orchestrator", () => {
  beforeEach(() => vi.resetAllMocks());

  function mockNoCriticBlock(getPilClientMock: ReturnType<typeof vi.fn>, recorded: RecordedOp[]) {
    getPilClientMock.mockReturnValue(
      makeSup04Client({ pil_agent_runs: { data: [], error: null } }, recorded) as never,
    );
  }

  it("creates research runs for a prospect with no prior runs", async () => {
    const { pilResearchRuns, pilProspects, getPilClient } = await import("@/lib/pil/db");
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
    mockNoCriticBlock(vi.mocked(getPilClient), []);

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
    // p5.2b (2026-09-15): was "running" -- fixed in BEN-SUP-01.ts, see the
    // other status-assertion fix above in this file for the full rationale.
    expect(result.status).toBe("completed");
    // BEN-SUP-03 is appended because this cycle dispatched runs (Step 4);
    // BEN-SUP-02/BEN-DIS-01 remain first, in their original order/behavior.
    expect(result.delegations.map((d) => d.childAgentCode)).toEqual(["BEN-SUP-02", "BEN-DIS-01", "BEN-SUP-03"]);
    expect((result.conclusions.plan as { gapFamilies: string[] }).gapFamilies.length).toBe(3);
    expect(result.conclusions.blockedByCriticVerdict).toBe(false);
    expect(result.conclusions.blockedByUnresolvedRecovery).toBe(false);
  });

  it("regression: BEN-SUP-02 and BEN-DIS-01 delegation behavior is unchanged", async () => {
    const { pilResearchRuns, pilProspects, getPilClient } = await import("@/lib/pil/db");
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
    mockNoCriticBlock(vi.mocked(getPilClient), []);

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

    expect(result.delegations[0]?.childAgentCode).toBe("BEN-SUP-02");
    expect(result.delegations[1]?.childAgentCode).toBe("BEN-DIS-01");
    expect(result.delegations.some((d) => d.childAgentCode === "BEN-SUP-02")).toBe(true);
    expect(result.delegations.some((d) => d.childAgentCode === "BEN-DIS-01")).toBe(true);
  });

  it("delegates to BEN-SUP-03 and BEN-SUP-04 when runs are dispatched and a family is already complete", async () => {
    const { pilResearchRuns, pilProspects, getPilClient } = await import("@/lib/pil/db");
    const { createResearchRun, advanceRunState } = await import("@/lib/pil/workflow");
    const { logAction } = await import("@/lib/pil/audit");
    const { createReviewItem } = await import("@/lib/pil/human-review");

    const completedRun = {
      id: "run-existing",
      organization_id: ORG_ID,
      goal_id: null,
      prospect_id: "prospect-1",
      initiating_agent_id: "BEN-SUP-01",
      natural_language_query: "prior goal",
      structured_plan: { run_type: "prospect_intelligence" },
      status: "completed",
      token_budget: null,
      tokens_consumed: 0,
      financial_budget: null,
      financial_spent: 0,
      started_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T01:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
    };

    vi.mocked(pilResearchRuns).mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: [completedRun], error: null }),
    } as never);
    vi.mocked(pilProspects).mockReturnValue({
      eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })),
    } as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    mockNoCriticBlock(vi.mocked(getPilClient), []);

    vi.mocked(createResearchRun).mockImplementation(
      async (params: { orgId: string; prospectId?: string | null; runType?: string; goal: string; triggeredBy: string }) =>
        ({
          id: `run-${params.runType}`,
          organization_id: params.orgId,
          goal_id: null,
          prospect_id: params.prospectId ?? null,
          initiating_agent_id: params.triggeredBy,
          natural_language_query: params.goal,
          structured_plan: { run_type: params.runType },
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
    const context = baseContext({ prospectId: "prospect-1", goal: "Discover and qualify this prospect" });

    const result = await orchestrator.execute(context as never, {} as never);

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-SUP-03")).toBe(true);
    expect(result.delegations.some((d) => d.childAgentCode === "BEN-SUP-04")).toBe(true);
    // p5.2b (2026-09-15): was "running" -- fixed in BEN-SUP-01.ts, see the
    // other status-assertion fix above in this file for the full rationale.
    expect(result.status).toBe("completed");
  });

  it("blocks the objective when a pending BEN-SUP-05 deny verdict exists for this research run", async () => {
    const { pilResearchRuns, pilProspects, getPilClient } = await import("@/lib/pil/db");
    const { createResearchRun, advanceRunState } = await import("@/lib/pil/workflow");
    const { logAction } = await import("@/lib/pil/audit");
    const { createReviewItem } = await import("@/lib/pil/human-review");

    const completedRuns = [
      { runType: "discovery" },
      { runType: "prospect_intelligence" },
      { runType: "qualification" },
    ].map((r, i) => ({
      id: `run-${i}`,
      organization_id: ORG_ID,
      goal_id: null,
      prospect_id: "prospect-1",
      initiating_agent_id: "BEN-SUP-01",
      natural_language_query: "prior goal",
      structured_plan: { run_type: r.runType },
      status: "completed",
      token_budget: null,
      tokens_consumed: 0,
      financial_budget: null,
      financial_spent: 0,
      started_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T01:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
    }));

    vi.mocked(pilResearchRuns).mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: completedRuns, error: null }),
    } as never);
    vi.mocked(pilProspects).mockReturnValue({
      eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })),
    } as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);

    const agentRunFixture = [
      {
        id: "ar-target",
        organization_id: ORG_ID,
        agent_id: "BEN-INT-08",
        research_run_id: "run-0",
        delegated_task_id: null,
        goal_id: null,
        status: "completed",
        autonomy_level_used: "A2",
        input: {},
        output: null,
        tokens_consumed: 0,
        cost_usd: 0,
        started_at: null,
        completed_at: null,
        error: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    const policyDecisionFixture = [
      {
        id: "pd-1",
        organization_id: ORG_ID,
        actor_agent_id: "BEN-SUP-05",
        action_requested: "critic_review:ar-target",
        policy_name: "pil_critic_verdict",
        decision: "deny",
        reason: "Entity ambiguity detected.",
        related_delegated_task_id: null,
        created_at: "2026-01-01T02:00:00Z",
      },
    ];

    const recorded: RecordedOp[] = [];
    vi.mocked(getPilClient).mockReturnValue(
      makeSup04Client(
        { pil_agent_runs: { data: agentRunFixture, error: null }, pil_policy_decisions: { data: policyDecisionFixture, error: null } },
        recorded,
      ) as never,
    );

    vi.mocked(createResearchRun).mockResolvedValue({} as never);
    vi.mocked(advanceRunState).mockResolvedValue({} as never);

    const { ChiefProspectIntelligenceOrchestrator } = await import("@/lib/pil/agents/sup/BEN-SUP-01");
    const orchestrator = new ChiefProspectIntelligenceOrchestrator();
    const context = baseContext({ prospectId: "prospect-1", goal: "Build a complete profile for this prospect" });

    const result = await orchestrator.execute(context as never, {} as never);

    expect(vi.mocked(createResearchRun)).not.toHaveBeenCalled();
    expect(result.status).toBe("blocked");
    expect(result.conclusions.objectiveSatisfied).toBe(false);
    expect(result.conclusions.blockedByCriticVerdict).toBe(true);
    expect(result.delegations).toEqual([]);
  });
});

describe("BEN-SUP-04 Research Portfolio Allocator", () => {
  beforeEach(() => vi.resetAllMocks());

  it("pauses the lowest-value run when the org budget is constrained", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getActiveRuns } = await import("@/lib/pil/workflow");
    const { getBudgetSummary } = await import("@/lib/pil/cost");
    const { logAction, getAuditTrail } = await import("@/lib/pil/audit");
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
    vi.mocked(getAuditTrail).mockResolvedValue([] as never);

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

  const constrainedBudgetFixture = [
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
  ];

  function evidenceRow(overrides: Partial<{ id: string; entity_id: string; confidence: number; verification_status: string }> = {}) {
    return {
      id: overrides.id ?? "ev-1",
      organization_id: ORG_ID,
      entity_id: overrides.entity_id ?? "p1",
      entity_table: "pil_prospects",
      claim: "x",
      value: null,
      claim_type: "t",
      source_url: null,
      source_title: null,
      source_type: "open_web",
      publisher: null,
      retrieved_at: "2026-01-01T00:00:00Z",
      published_at: null,
      last_verified_at: null,
      evidence_excerpt: null,
      agent_id: "BEN-INT-01",
      research_run_id: null,
      confidence: overrides.confidence ?? 0.1,
      verification_status: overrides.verification_status ?? "unverified",
      freshness_status: "fresh",
      inference_status: "direct",
      contradiction_status: "none",
      lineage: [],
      created_at: "2026-01-01T00:00:00Z",
    };
  }

  it("flags a starvation pattern instead of pausing a run that's already been repeatedly paused", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getActiveRuns } = await import("@/lib/pil/workflow");
    const { getBudgetSummary } = await import("@/lib/pil/cost");
    const { logAction, getAuditTrail } = await import("@/lib/pil/audit");
    const { createReviewItem } = await import("@/lib/pil/human-review");

    vi.mocked(getActiveRuns).mockResolvedValue([runA, runB] as never);
    vi.mocked(getBudgetSummary).mockResolvedValue(constrainedBudgetFixture as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);

    const now = Date.now();
    const priorPause = (id: string, hoursAgo: number) => ({
      id,
      organization_id: ORG_ID,
      actor_type: "agent" as const,
      actor_id: "BEN-SUP-04",
      action: "allocator.pause",
      resource_type: "pil_research_runs",
      resource_id: "run-a",
      before_state: null,
      after_state: {},
      policy_decision: null,
      ip_address: null,
      created_at: new Date(now - hoursAgo * 60 * 60 * 1000).toISOString(),
    });
    // 3 prior pauses of run-a within the 24h lookback window, no intervening
    // allocator.reallocate -- exactly the starvation limit.
    vi.mocked(getAuditTrail).mockResolvedValue([priorPause("al-1", 3), priorPause("al-2", 2), priorPause("al-3", 1)] as never);

    const agentRunsFixture = [
      { id: "ar-1", organization_id: ORG_ID, agent_id: "BEN-DIS-01", research_run_id: "run-a", delegated_task_id: null, goal_id: null, status: "failed", autonomy_level_used: "A2", input: {}, output: null, tokens_consumed: 0, cost_usd: 0, started_at: null, completed_at: null, error: null, created_at: "2026-01-01T00:00:00Z" },
      { id: "ar-2", organization_id: ORG_ID, agent_id: "BEN-INT-01", research_run_id: "run-b", delegated_task_id: null, goal_id: null, status: "completed", autonomy_level_used: "A2", input: {}, output: null, tokens_consumed: 0, cost_usd: 0, started_at: null, completed_at: null, error: null, created_at: "2026-01-01T00:02:00Z" },
    ];
    const evidenceFixture = [evidenceRow({ id: "ev-1", entity_id: "p1", confidence: 0.1 }), evidenceRow({ id: "ev-2", entity_id: "p2", confidence: 0.9, verification_status: "verified_fact" })];

    const recorded: RecordedOp[] = [];
    vi.mocked(getPilClient).mockReturnValue(
      makeSup04Client({ pil_agent_runs: { data: agentRunsFixture, error: null }, pil_evidence: { data: evidenceFixture, error: null } }, recorded) as never,
    );

    const { ResearchPortfolioAllocator } = await import("@/lib/pil/agents/sup/BEN-SUP-04");
    const allocator = new ResearchPortfolioAllocator();
    const context = baseContext({ agentCode: "BEN-SUP-04", goal: "rebalance portfolio" });

    const result = await allocator.execute(context as never, {} as never);

    const pauseUpdates = recorded.filter((r) => r.table === "pil_research_runs" && r.kind === "update");
    expect(pauseUpdates).toHaveLength(0);

    expect(vi.mocked(createReviewItem)).toHaveBeenCalledWith(
      expect.objectContaining({ review_type: "critic_block", subject_type: "pil_research_runs", subject_id: "run-a" }),
    );

    const decisions = result.conclusions.decisions as Array<{ action: string; runId: string }>;
    expect(decisions.some((d) => d.action === "starvation_flagged" && d.runId === "run-a")).toBe(true);
    expect(decisions.some((d) => d.action === "pause")).toBe(false);
    expect(vi.mocked(logAction).mock.calls.some((c) => (c[0] as { action: string }).action === "allocator.starvation_flagged")).toBe(true);
  });

  it("delegates to BEN-SUP-05 instead of deepening further once the highest-value run is at the research-depth ceiling", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getActiveRuns } = await import("@/lib/pil/workflow");
    const { getBudgetSummary } = await import("@/lib/pil/cost");
    const { logAction, getAuditTrail } = await import("@/lib/pil/audit");
    const { createReviewItem } = await import("@/lib/pil/human-review");

    vi.mocked(getActiveRuns).mockResolvedValue([runA, runB] as never);
    vi.mocked(getBudgetSummary).mockResolvedValue(constrainedBudgetFixture as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(getAuditTrail).mockResolvedValue([] as never);

    const runATasks = [
      { id: "ar-a1", organization_id: ORG_ID, agent_id: "BEN-DIS-01", research_run_id: "run-a", delegated_task_id: null, goal_id: null, status: "failed", autonomy_level_used: "A2", input: {}, output: null, tokens_consumed: 0, cost_usd: 0, started_at: null, completed_at: null, error: null, created_at: "2026-01-01T00:00:00Z" },
    ];
    // 20 completed tasks on run-b -- at RESEARCH_DEPTH_CEILING, so this
    // agent must stop pushing further deepening delegations on it.
    const runBTasks = Array.from({ length: 20 }, (_, i) => ({
      id: `ar-b${i}`,
      organization_id: ORG_ID,
      agent_id: "BEN-INT-08",
      research_run_id: "run-b",
      delegated_task_id: null,
      goal_id: null,
      status: "completed",
      autonomy_level_used: "A2",
      input: {},
      output: null,
      tokens_consumed: 0,
      cost_usd: 0,
      started_at: null,
      completed_at: null,
      error: null,
      created_at: `2026-01-01T00:${String(i).padStart(2, "0")}:00Z`,
    }));
    const evidenceFixture = [evidenceRow({ id: "ev-1", entity_id: "p1", confidence: 0.1 }), evidenceRow({ id: "ev-2", entity_id: "p2", confidence: 0.9, verification_status: "verified_fact" })];

    const recorded: RecordedOp[] = [];
    vi.mocked(getPilClient).mockReturnValue(
      makeSup04Client(
        { pil_agent_runs: { data: [...runATasks, ...runBTasks], error: null }, pil_evidence: { data: evidenceFixture, error: null } },
        recorded,
      ) as never,
    );

    const { ResearchPortfolioAllocator } = await import("@/lib/pil/agents/sup/BEN-SUP-04");
    const allocator = new ResearchPortfolioAllocator();
    const context = baseContext({ agentCode: "BEN-SUP-04", goal: "rebalance portfolio" });

    const result = await allocator.execute(context as never, {} as never);

    // run-a still pauses normally (no starvation) -- only the highest-value
    // run's deepening delegation is capped by the depth ceiling.
    const pauseUpdates = recorded.filter((r) => r.table === "pil_research_runs" && r.kind === "update");
    expect(pauseUpdates).toHaveLength(1);

    expect(result.delegations).toEqual([
      { childAgentCode: "BEN-SUP-05", objective: expect.stringContaining("research-depth ceiling"), maxAutonomy: "A2" },
    ]);
    expect(result.delegations.some((d) => d.childAgentCode === "BEN-INT-08")).toBe(false);

    const decisions = result.conclusions.decisions as Array<{ action: string; runId: string }>;
    expect(decisions.some((d) => d.action === "depth_ceiling_reached" && d.runId === "run-b")).toBe(true);
    expect(decisions.some((d) => d.action === "reallocate")).toBe(false);
    expect(vi.mocked(logAction).mock.calls.some((c) => (c[0] as { action: string }).action === "allocator.depth_ceiling_reached")).toBe(true);
  });

  it("delegates to BEN-SUP-06 and skips allocation this cycle when evidence loading fails", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getActiveRuns } = await import("@/lib/pil/workflow");
    const { getBudgetSummary } = await import("@/lib/pil/cost");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(getActiveRuns).mockResolvedValue([runA] as never);
    vi.mocked(getBudgetSummary).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const recorded: RecordedOp[] = [];
    vi.mocked(getPilClient).mockReturnValue(
      makeSup04Client(
        { pil_agent_runs: { data: [], error: null }, pil_evidence: { data: null, error: new Error("connection reset") } },
        recorded,
      ) as never,
    );

    const { ResearchPortfolioAllocator } = await import("@/lib/pil/agents/sup/BEN-SUP-04");
    const allocator = new ResearchPortfolioAllocator();
    const context = baseContext({ agentCode: "BEN-SUP-04", goal: "rebalance portfolio" });

    const result = await allocator.execute(context as never, {} as never);

    expect(result.status).toBe("completed");
    expect(result.conclusions.allocationSkippedThisCycle).toBe(true);
    expect(result.delegations).toEqual([
      { childAgentCode: "BEN-SUP-06", objective: expect.stringContaining("p1"), maxAutonomy: "A2" },
    ]);
    expect(vi.mocked(logAction)).not.toHaveBeenCalled();
  });

  it("regression: single-pause/single-reallocate happy path and low-yield flagging are unchanged by the new guards", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getActiveRuns } = await import("@/lib/pil/workflow");
    const { getBudgetSummary } = await import("@/lib/pil/cost");
    const { logAction } = await import("@/lib/pil/audit");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { getAuditTrail } = await import("@/lib/pil/audit");

    // A third run at the low-yield step threshold (5 completed steps, zero
    // evidence) -- depthNormalized alone is already 1 once depthAchieved>=5,
    // which contributes exactly LOW_YIELD_VALUE_THRESHOLD (0.2) on its own,
    // so value can never fall below that threshold once the step threshold
    // is met. This pins down that neither the scoring formula nor the
    // LOW_YIELD_* thresholds moved.
    const runC = { ...runA, id: "run-c", prospect_id: "p3" };

    vi.mocked(getActiveRuns).mockResolvedValue([runA, runB, runC] as never);
    vi.mocked(getBudgetSummary).mockResolvedValue(constrainedBudgetFixture as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(getAuditTrail).mockResolvedValue([] as never);

    const runCTasks = Array.from({ length: 5 }, (_, i) => ({
      id: `ar-c${i}`,
      organization_id: ORG_ID,
      agent_id: "BEN-INT-01",
      research_run_id: "run-c",
      delegated_task_id: null,
      goal_id: null,
      status: "completed",
      autonomy_level_used: "A2",
      input: {},
      output: null,
      tokens_consumed: 0,
      cost_usd: 0,
      started_at: null,
      completed_at: null,
      error: null,
      created_at: `2026-01-01T01:0${i}:00Z`,
    }));

    const agentRunsFixture = [
      { id: "ar-1", organization_id: ORG_ID, agent_id: "BEN-DIS-01", research_run_id: "run-a", delegated_task_id: null, goal_id: null, status: "failed", autonomy_level_used: "A2", input: {}, output: null, tokens_consumed: 0, cost_usd: 0, started_at: null, completed_at: null, error: null, created_at: "2026-01-01T00:00:00Z" },
      { id: "ar-3", organization_id: ORG_ID, agent_id: "BEN-INT-01", research_run_id: "run-b", delegated_task_id: null, goal_id: null, status: "completed", autonomy_level_used: "A2", input: {}, output: null, tokens_consumed: 0, cost_usd: 0, started_at: null, completed_at: null, error: null, created_at: "2026-01-01T00:02:00Z" },
      { id: "ar-4", organization_id: ORG_ID, agent_id: "BEN-INT-08", research_run_id: "run-b", delegated_task_id: null, goal_id: null, status: "completed", autonomy_level_used: "A2", input: {}, output: null, tokens_consumed: 0, cost_usd: 0, started_at: null, completed_at: null, error: null, created_at: "2026-01-01T00:03:00Z" },
      ...runCTasks,
    ];
    const evidenceFixture = [
      evidenceRow({ id: "ev-1", entity_id: "p1", confidence: 0.1 }),
      evidenceRow({ id: "ev-2", entity_id: "p2", confidence: 0.9, verification_status: "verified_fact" }),
    ];

    const recorded: RecordedOp[] = [];
    vi.mocked(getPilClient).mockReturnValue(
      makeSup04Client({ pil_agent_runs: { data: agentRunsFixture, error: null }, pil_evidence: { data: evidenceFixture, error: null } }, recorded) as never,
    );

    const { ResearchPortfolioAllocator } = await import("@/lib/pil/agents/sup/BEN-SUP-04");
    const allocator = new ResearchPortfolioAllocator();
    const context = baseContext({ agentCode: "BEN-SUP-04", goal: "rebalance portfolio" });

    const result = await allocator.execute(context as never, {} as never);

    const pauseUpdates = recorded.filter((r) => r.table === "pil_research_runs" && r.kind === "update");
    expect(pauseUpdates).toHaveLength(1);
    expect((pauseUpdates[0]?.payload as { structured_plan: { paused: boolean } }).structured_plan.paused).toBe(true);

    const decisions = result.conclusions.decisions as Array<{ action: string; runId: string }>;
    expect(decisions.some((d) => d.action === "pause" && d.runId === "run-a")).toBe(true);
    expect(decisions.some((d) => d.action === "reallocate" && d.runId === "run-b")).toBe(true);
    expect(decisions.some((d) => d.action === "starvation_flagged")).toBe(false);
    expect(decisions.some((d) => d.action === "depth_ceiling_reached")).toBe(false);
    expect(result.delegations.some((d) => d.childAgentCode === "BEN-INT-08")).toBe(true);

    // run-c sits at the low-yield step threshold (depthAchieved === 5) but
    // its value (0.6) is >= LOW_YIELD_VALUE_THRESHOLD, so it correctly does
    // not flag -- confirming the filter's thresholds/formula are unchanged.
    const scored = result.conclusions.scored as Array<{ runId: string; value: number; depthAchieved: number }>;
    const runCScore = scored.find((s) => s.runId === "run-c");
    expect(runCScore).toMatchObject({ depthAchieved: 5, value: 0.6 });
    expect(decisions.some((d) => d.action === "flag_low_yield")).toBe(false);
    expect(vi.mocked(createReviewItem)).not.toHaveBeenCalledWith(expect.objectContaining({ summary: expect.stringContaining("Low research yield") }));
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

  it("regression: feasible path stays VALIDATED and still delegates to BEN-SUP-03 exactly once", async () => {
    const { pilProspects } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { listActiveSources } = await import("@/lib/pil/sources");
    const { logAction } = await import("@/lib/pil/audit");
    const { createReviewItem } = await import("@/lib/pil/human-review");

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
    ] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);

    const { ResearchStrategyArchitect } = await import("@/lib/pil/agents/sup/BEN-SUP-02");
    const architect = new ResearchStrategyArchitect();
    const context = baseContext({ agentCode: "BEN-SUP-02", prospectId: "p1", goal: "Assess this individual for major gift capacity" });

    const result = await architect.execute(context as never, {} as never);

    const plan = result.conclusions.plan as { status: string };
    expect(plan.status).toBe("VALIDATED");
    expect(result.delegations).toHaveLength(1);
    expect(result.delegations[0]?.childAgentCode).toBe("BEN-SUP-03");
    expect(vi.mocked(createReviewItem)).not.toHaveBeenCalled();
  });

  it("sets REVIEW_REQUIRED and escalates instead of delegating when gap dimensions have no coverable source", async () => {
    const { pilProspects } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { listActiveSources } = await import("@/lib/pil/sources");
    const { logAction } = await import("@/lib/pil/audit");
    const { createReviewItem } = await import("@/lib/pil/human-review");

    const prospect = {
      id: "p2",
      organization_id: ORG_ID,
      entity_type: "corporation",
      display_name: "Acme Corp",
      canonical_name: "acme corp",
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
    // "corporation" is only allowed sec_edgar/corporate_information/open_web
    // sources; the only active source in the catalog is irs_form_990, so
    // none of its gap dimensions have a coverable source.
    vi.mocked(listActiveSources).mockResolvedValue([
      { id: "s1", source_key: "irs_990_adapter", source_name: "IRS 990", source_type: "irs_form_990", provider: null, permissibility_status: "permitted", tos_notes: null, rate_limit_per_minute: null, cost_per_call: null, requires_license: false, active: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);

    const { ResearchStrategyArchitect } = await import("@/lib/pil/agents/sup/BEN-SUP-02");
    const architect = new ResearchStrategyArchitect();
    const context = baseContext({ agentCode: "BEN-SUP-02", prospectId: "p2", goal: "Assess this corporation for a corporate giving partnership" });

    const result = await architect.execute(context as never, {} as never);

    const plan = result.conclusions.plan as { status: string; gaps: string[] };
    expect(plan.status).toBe("REVIEW_REQUIRED");
    expect((result.conclusions.infeasibleDimensions as string[]).length).toBeGreaterThan(0);
    expect(vi.mocked(createReviewItem)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createReviewItem).mock.calls[0]?.[0]).toMatchObject({ review_type: "policy_exception" });
    expect(result.delegations).toHaveLength(0);
    expect(result.status).toBe("completed");
  });

  it("returns early with no plan or delegation when the goal is empty", async () => {
    const { pilProspects } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { listActiveSources } = await import("@/lib/pil/sources");

    const { ResearchStrategyArchitect } = await import("@/lib/pil/agents/sup/BEN-SUP-02");
    const architect = new ResearchStrategyArchitect();
    const context = baseContext({ agentCode: "BEN-SUP-02", prospectId: "p1", goal: "   " });

    const result = await architect.execute(context as never, {} as never);

    expect(result.conclusions.skipped).toBe(true);
    expect(result.conclusions.plan).toBeUndefined();
    expect(result.delegations).toEqual([]);
    expect(result.status).toBe("completed");
    expect(vi.mocked(pilProspects)).not.toHaveBeenCalled();
    expect(vi.mocked(getEvidence)).not.toHaveBeenCalled();
    expect(vi.mocked(listActiveSources)).not.toHaveBeenCalled();
  });
});
