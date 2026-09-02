// Unit tests for BEN-OPS-01 (Agent Fleet Performance and Learning Agent).
// Everything is mocked -- no real DB calls, matching pil-qlf-knw-agents.test.ts's
// and pil-sup-agents.test.ts's convention.
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
    agentCode: "BEN-OPS-01",
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
      gte: vi.fn(() => c),
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

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: `run-${Math.random().toString(36).slice(2)}`,
    organization_id: ORG_ID,
    agent_id: "BEN-DIS-01",
    research_run_id: null,
    delegated_task_id: null,
    goal_id: null,
    status: "completed",
    autonomy_level_used: "A2",
    input: {},
    output: null,
    tokens_consumed: 100,
    cost_usd: 0.002,
    started_at: "2026-08-20T00:00:00Z",
    completed_at: "2026-08-20T00:05:00Z",
    error: null,
    created_at: "2026-08-20T00:00:00Z",
    ...overrides,
  };
}

describe("BEN-OPS-01 Agent Fleet Performance and Learning Agent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("nightly mode: flags a HIGH severity failure-rate proposal, creates a high-priority review, and delegates to BEN-SUP-05 at A1", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    // 8 runs for BEN-DIS-01: 3 failed => failureRate 0.375 > 0.2, runCount 8 >= 5
    const runs = [
      makeRun({ id: "run-1", agent_id: "BEN-DIS-01", status: "failed" }),
      makeRun({ id: "run-2", agent_id: "BEN-DIS-01", status: "failed" }),
      makeRun({ id: "run-3", agent_id: "BEN-DIS-01", status: "failed" }),
      makeRun({ id: "run-4", agent_id: "BEN-DIS-01", status: "completed" }),
      makeRun({ id: "run-5", agent_id: "BEN-DIS-01", status: "completed" }),
      makeRun({ id: "run-6", agent_id: "BEN-DIS-01", status: "completed" }),
      makeRun({ id: "run-7", agent_id: "BEN-DIS-01", status: "completed" }),
      makeRun({ id: "run-8", agent_id: "BEN-DIS-01", status: "completed" }),
    ];

    const { client, calls } = makeClient({
      pil_agent_runs: { data: runs, error: null },
      pil_agent_run_events: { data: [], error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { AgentFleetPerformanceAndLearningAgent } = await import("@/lib/pil/agents/ops/BEN-OPS-01");
    const agent = new AgentFleetPerformanceAndLearningAgent();
    const context = baseContext({ plan: { mode: "nightly" } });

    const result = await agent.execute(context as never, {} as never);

    const conclusions = result.conclusions as { mode: string; windowDays: number; proposals: Array<{ agentCode: string; severity: string }> };
    expect(conclusions.mode).toBe("nightly");
    expect(conclusions.windowDays).toBe(7);
    expect(conclusions.proposals).toContainEqual(expect.objectContaining({ agentCode: "BEN-DIS-01", severity: "high" }));

    expect(createReviewItem).toHaveBeenCalledWith(
      expect.objectContaining({ review_type: "policy_exception", priority: "high" }),
    );

    expect(result.delegations).toContainEqual(
      expect.objectContaining({ childAgentCode: "BEN-SUP-05", maxAutonomy: "A1" }),
    );
    expect(result.delegations.some((d) => d.maxAutonomy === "A2")).toBe(false);

    expect(result.status).toBe("completed");

    const registryWrite = calls.find((c) => c.table === "pil_agent_registry");
    const flagsWrite = calls.find((c) => c.table === "pil_feature_flags");
    const runsWrite = calls.find((c) => c.table === "pil_agent_runs" && (c.method === "insert" || c.method === "update"));
    expect(registryWrite).toBeUndefined();
    expect(flagsWrite).toBeUndefined();
    expect(runsWrite).toBeUndefined();
  });

  it("weekly mode: flags a MEDIUM severity cost-outlier proposal, creates a normal-priority review, and issues no delegation", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    // Two cheap baseline agent_ids (avgCostUsd 0.001 each) plus one expensive
    // outlier (avgCostUsd 0.01) -- with 3 eligible agent_ids the median sits
    // at 0.001 (the two cheap agents), so 0.01 clears 3x the median (0.003)
    // decisively. With only 2 agent_ids the median would be the average of
    // the two (0.0055), which 0.01 would NOT clear 3x of -- a second cheap
    // baseline agent is required to make this a real outlier test.
    const cheapRuns1 = Array.from({ length: 5 }, (_, i) =>
      makeRun({ id: `cheap1-${i}`, agent_id: "BEN-DIS-01", status: "completed", cost_usd: 0.001 }),
    );
    const cheapRuns2 = Array.from({ length: 5 }, (_, i) =>
      makeRun({ id: `cheap2-${i}`, agent_id: "BEN-DIS-02", status: "completed", cost_usd: 0.001 }),
    );
    // BEN-INT-08: 5 expensive runs (avgCostUsd 0.01) -- well over 3x the median.
    const expensiveRuns = Array.from({ length: 5 }, (_, i) =>
      makeRun({ id: `expensive-${i}`, agent_id: "BEN-INT-08", status: "completed", cost_usd: 0.01 }),
    );

    const { client, calls } = makeClient({
      pil_agent_runs: { data: [...cheapRuns1, ...cheapRuns2, ...expensiveRuns], error: null },
      pil_agent_run_events: { data: [], error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { AgentFleetPerformanceAndLearningAgent } = await import("@/lib/pil/agents/ops/BEN-OPS-01");
    const agent = new AgentFleetPerformanceAndLearningAgent();
    const context = baseContext({ plan: { mode: "weekly" } });

    const result = await agent.execute(context as never, {} as never);

    const conclusions = result.conclusions as { mode: string; windowDays: number; proposals: Array<{ agentCode: string; severity: string }> };
    expect(conclusions.mode).toBe("weekly");
    expect(conclusions.windowDays).toBe(30);
    expect(conclusions.proposals).toContainEqual(expect.objectContaining({ agentCode: "BEN-INT-08", severity: "medium" }));
    expect(conclusions.proposals.some((p) => p.agentCode === "BEN-DIS-01")).toBe(false);
    expect(conclusions.proposals.some((p) => p.agentCode === "BEN-DIS-02")).toBe(false);

    expect(createReviewItem).toHaveBeenCalledWith(
      expect.objectContaining({ review_type: "policy_exception", priority: "normal" }),
    );

    expect(result.delegations.some((d) => d.childAgentCode === "BEN-SUP-05")).toBe(false);
    expect(result.status).toBe("completed");

    const registryWrite = calls.find((c) => c.table === "pil_agent_registry");
    const flagsWrite = calls.find((c) => c.table === "pil_feature_flags");
    const runsWrite = calls.find((c) => c.table === "pil_agent_runs" && (c.method === "insert" || c.method === "update"));
    expect(registryWrite).toBeUndefined();
    expect(flagsWrite).toBeUndefined();
    expect(runsWrite).toBeUndefined();
  });

  it("returns an empty proposals array and status completed (not failed) when zero runs exist in the window", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { logAction } = await import("@/lib/pil/audit");

    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);

    const { client, calls } = makeClient({
      pil_agent_runs: { data: [], error: null },
      pil_agent_run_events: { data: [], error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { AgentFleetPerformanceAndLearningAgent } = await import("@/lib/pil/agents/ops/BEN-OPS-01");
    const agent = new AgentFleetPerformanceAndLearningAgent();
    const context = baseContext({ plan: { mode: "nightly" } });

    const result = await agent.execute(context as never, {} as never);

    const conclusions = result.conclusions as { proposals: unknown[]; agentsEvaluated: number };
    expect(conclusions.proposals).toEqual([]);
    expect(conclusions.agentsEvaluated).toBe(0);
    expect(result.status).toBe("completed");
    expect(createReviewItem).not.toHaveBeenCalled();
    expect(result.delegations).toEqual([]);

    const registryWrite = calls.find((c) => c.table === "pil_agent_registry");
    const flagsWrite = calls.find((c) => c.table === "pil_feature_flags");
    const runsWrite = calls.find((c) => c.table === "pil_agent_runs" && (c.method === "insert" || c.method === "update"));
    expect(registryWrite).toBeUndefined();
    expect(flagsWrite).toBeUndefined();
    expect(runsWrite).toBeUndefined();
  });
});
