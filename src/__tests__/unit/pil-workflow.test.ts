// Unit tests for the PIL-02 workflow engine and agent runner. Everything is
// mocked -- no real DB calls, matching every other src/__tests__/unit/*
// suite in this repo.
import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG_ID = "11111111-2222-3333-4444-555555555555";

interface RecordedInsert {
  table: string;
  payload: unknown;
}

function makeClient(recorded: RecordedInsert[], responses: Record<string, unknown | unknown[]>) {
  const callCounts: Record<string, number> = {};
  const nextResponse = (table: string) => {
    const configured = responses[table];
    if (Array.isArray(configured)) {
      const idx = callCounts[table] ?? 0;
      callCounts[table] = idx + 1;
      return configured[Math.min(idx, configured.length - 1)] ?? { data: null, error: null };
    }
    return configured ?? { data: null, error: null };
  };
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      select: vi.fn(() => c),
      insert: vi.fn((payload: unknown) => {
        recorded.push({ table, payload });
        return c;
      }),
      update: vi.fn((payload: unknown) => {
        recorded.push({ table, payload });
        return c;
      }),
      eq: vi.fn(() => c),
      in: vi.fn(() => c),
      order: vi.fn(() => c),
      single: vi.fn(() => Promise.resolve(nextResponse(table))),
      maybeSingle: vi.fn(() => Promise.resolve(nextResponse(table))),
      then: (resolve: (v: unknown) => void) => Promise.resolve(nextResponse(table)).then(resolve),
    };
    return c;
  };
  return { from: vi.fn((table: string) => chain(table)) };
}

vi.mock("@/lib/pil/db", () => ({ getPilClient: vi.fn() }));
vi.mock("@/lib/pil/agent-registry-service", () => ({ loadAgent: vi.fn() }));
vi.mock("@/lib/pil/policy", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pil/policy")>("@/lib/pil/policy");
  return {
    ...actual,
    checkAgentAuthorization: vi.fn(),
    canDelegate: vi.fn(),
  };
});
vi.mock("@/lib/pil/cost", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pil/cost")>("@/lib/pil/cost");
  return {
    ...actual,
    checkBudget: vi.fn(),
    recordCost: vi.fn(),
  };
});
vi.mock("@/lib/pil/audit", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/pil/human-review", () => ({ createReviewItem: vi.fn() }));

describe("workflow state machine", () => {
  beforeEach(() => vi.resetAllMocks());

  it("rejects invalid transitions (completed -> running)", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const recorded: RecordedInsert[] = [];
    const run = {
      id: "run-1",
      organization_id: ORG_ID,
      status: "completed",
      started_at: null,
      structured_plan: {},
    };
    vi.mocked(getPilClient).mockReturnValue(
      makeClient(recorded, { pil_research_runs: { data: run, error: null } }) as never,
    );

    const { advanceRunState, WorkflowError } = await import("@/lib/pil/workflow");
    await expect(advanceRunState("run-1", "running")).rejects.toThrow(WorkflowError);
  });

  it("allows a valid transition (planning -> running)", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const recorded: RecordedInsert[] = [];
    const run = {
      id: "run-1",
      organization_id: ORG_ID,
      status: "planning",
      started_at: null,
      structured_plan: {},
    };
    vi.mocked(getPilClient).mockReturnValue(
      makeClient(recorded, {
        pil_research_runs: [
          { data: run, error: null },
          { data: { ...run, status: "running" }, error: null },
        ],
      }) as never,
    );

    const { advanceRunState } = await import("@/lib/pil/workflow");
    const updated = await advanceRunState("run-1", "running");
    expect(updated.status).toBe("running");
  });
});

describe("AgentRunner", () => {
  beforeEach(() => vi.resetAllMocks());

  const agentDef = {
    agent_id: "BEN-TEST-01",
    name: "Test Agent",
    family: "prospect_intelligence",
    mission: "test",
    default_autonomy_level: "A4",
    human_boundary: null,
    cadence: "on_demand",
    version: "1.0",
    spec_ref: "test",
    active: true,
    created_at: "2026-01-01T00:00:00Z",
  };

  const baseContext = {
    agentCode: "BEN-TEST-01",
    orgId: ORG_ID,
    prospectId: null,
    runId: "run-1",
    goal: "test goal",
    plan: {},
    tools: [],
    budget: 1000,
    depth: 1,
  };

  it("creates a pil_agent_runs row on a successful execution", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { loadAgent } = await import("@/lib/pil/agent-registry-service");
    const { checkAgentAuthorization } = await import("@/lib/pil/policy");
    const { checkBudget } = await import("@/lib/pil/cost");

    const recorded: RecordedInsert[] = [];
    vi.mocked(getPilClient).mockReturnValue(
      makeClient(recorded, {
        pil_agent_runs: { data: { id: "agent-run-1", status: "running" }, error: null },
      }) as never,
    );
    vi.mocked(loadAgent).mockResolvedValue(agentDef as never);
    vi.mocked(checkAgentAuthorization).mockResolvedValue({
      id: "pd-1",
      organization_id: ORG_ID,
      actor_agent_id: "BEN-TEST-01",
      action_requested: "x",
      policy_name: "x",
      decision: "allow",
      reason: "ok",
      related_delegated_task_id: null,
      created_at: "2026-01-01T00:00:00Z",
    } as never);
    vi.mocked(checkBudget).mockResolvedValue({ allowed: true, remaining_usd: 100, hard_stop: false });

    const { AgentRunner } = await import("@/lib/pil/agent-runner");
    AgentRunner.registerImplementation("BEN-TEST-01", {
      execute: async () => ({
        status: "completed",
        evidence: [],
        conclusions: {},
        delegations: [],
        tokensUsed: 10,
        costUsd: 0.01,
        error: null,
      }),
    });

    const runner = new AgentRunner();
    const result = await runner.run(baseContext);

    expect(result.status).toBe("completed");
    expect(recorded.some((r) => r.table === "pil_agent_runs")).toBe(true);
  });

  it("throws BudgetExceededError when the budget check hard-stops", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { loadAgent } = await import("@/lib/pil/agent-registry-service");
    const { checkAgentAuthorization } = await import("@/lib/pil/policy");
    const { checkBudget, BudgetExceededError } = await import("@/lib/pil/cost");

    vi.mocked(getPilClient).mockReturnValue(makeClient([], {}) as never);
    vi.mocked(loadAgent).mockResolvedValue(agentDef as never);
    vi.mocked(checkAgentAuthorization).mockResolvedValue({
      decision: "allow",
      reason: "ok",
    } as never);
    vi.mocked(checkBudget).mockRejectedValue(new BudgetExceededError("budget exceeded"));

    const { AgentRunner } = await import("@/lib/pil/agent-runner");
    const runner = new AgentRunner();
    await expect(runner.run(baseContext)).rejects.toThrow(BudgetExceededError);
  });

  it("blocks the agent run when policy denies authorization", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { loadAgent } = await import("@/lib/pil/agent-registry-service");
    const { checkAgentAuthorization } = await import("@/lib/pil/policy");
    const { checkBudget } = await import("@/lib/pil/cost");

    vi.mocked(getPilClient).mockReturnValue(makeClient([], {}) as never);
    vi.mocked(loadAgent).mockResolvedValue(agentDef as never);
    vi.mocked(checkAgentAuthorization).mockResolvedValue({
      decision: "deny",
      reason: "agent ceilinged below required autonomy",
    } as never);

    const { AgentRunner } = await import("@/lib/pil/agent-runner");
    const { PolicyViolationError } = await import("@/lib/pil/policy");
    const runner = new AgentRunner();

    await expect(runner.run(baseContext)).rejects.toThrow(PolicyViolationError);
    expect(checkBudget).not.toHaveBeenCalled();
  });

  it("fails the run when a requested delegation exceeds the parent's authority", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { loadAgent } = await import("@/lib/pil/agent-registry-service");
    const { checkAgentAuthorization, canDelegate } = await import("@/lib/pil/policy");
    const { checkBudget } = await import("@/lib/pil/cost");

    const recorded: RecordedInsert[] = [];
    vi.mocked(getPilClient).mockReturnValue(
      makeClient(recorded, {
        pil_agent_runs: { data: { id: "agent-run-2", status: "running" }, error: null },
      }) as never,
    );
    vi.mocked(loadAgent).mockResolvedValue(agentDef as never);
    vi.mocked(checkAgentAuthorization).mockResolvedValue({ decision: "allow", reason: "ok" } as never);
    vi.mocked(checkBudget).mockResolvedValue({ allowed: true, remaining_usd: 100, hard_stop: false });
    vi.mocked(canDelegate).mockResolvedValue(false);

    const { AgentRunner } = await import("@/lib/pil/agent-runner");
    AgentRunner.registerImplementation("BEN-TEST-02", {
      execute: async () => ({
        status: "completed",
        evidence: [],
        conclusions: {},
        delegations: [
          { childAgentCode: "BEN-CHILD-01", objective: "over-reach", maxAutonomy: "A4" as const },
        ],
        tokensUsed: 5,
        costUsd: 0.001,
        error: null,
      }),
    });

    const runner = new AgentRunner();
    const result = await runner.run({ ...baseContext, agentCode: "BEN-TEST-02" });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/exceeds parent authority/);
    expect(canDelegate).toHaveBeenCalledWith("BEN-TEST-02", "BEN-CHILD-01", "A4");
  });
});
