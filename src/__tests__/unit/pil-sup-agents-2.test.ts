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
vi.mock("@/lib/pil/workflow", () => ({ createResearchRun: vi.fn() }));
vi.mock("@/lib/pil/sources", () => ({ listActiveSources: vi.fn() }));

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

function baseEvidence(overrides: Record<string, unknown> = {}) {
  return {
    id: "ev-x",
    organization_id: ORG_ID,
    entity_id: "p1",
    entity_table: "pil_prospects",
    claim: "claim text",
    value: null,
    claim_type: "wealth_capacity",
    source_url: "https://example.com/a",
    source_title: "Article",
    source_type: "open_web",
    publisher: null,
    retrieved_at: "2026-01-01T00:00:00Z",
    published_at: null,
    last_verified_at: null,
    evidence_excerpt: null,
    agent_id: "BEN-INT-08",
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

function baseTargetRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "producing-run-1",
    organization_id: ORG_ID,
    agent_id: "BEN-INT-08",
    research_run_id: "run-1",
    delegated_task_id: null,
    goal_id: null,
    status: "completed",
    autonomy_level_used: "A2",
    input: {},
    output: { assertedFacts: [] },
    tokens_consumed: 0,
    cost_usd: 0,
    started_at: null,
    completed_at: null,
    error: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
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

  it("escalates to BLOCK_INDEPENDENCE when every claim shares one underlying source", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");
    const { createReviewItem } = await import("@/lib/pil/human-review");

    const targetRun = baseTargetRun();
    const evA = baseEvidence({ id: "ev-a", source_url: "https://example.com/same-article" });
    const evB = baseEvidence({ id: "ev-b", source_url: "https://example.com/same-article" });

    vi.mocked(getEvidence).mockResolvedValue([evA, evB] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);

    const client = makeClient({
      pil_agent_runs: { data: targetRun, error: null },
      pil_entity_resolution_candidates: { data: [], error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ProspectResearchCriticAgent } = await import("@/lib/pil/agents/sup/BEN-SUP-05");
    const critic = new ProspectResearchCriticAgent();
    const context = baseContext({ prospectId: "p1", plan: { targetAgentRunId: "producing-run-1" } });

    const result = await critic.execute(context as never, {} as never);
    const report = (result.conclusions as { report: { verdict: string; claims: Array<{ evidenceId: string; failedChecks: string[] }> } }).report;

    expect(report.claims.every((c) => c.failedChecks.includes("source_independence_failure"))).toBe(true);
    expect(report.verdict).toBe("BLOCK_INDEPENDENCE");
    expect(result.status).toBe("escalated");
  });

  it("escalates to BLOCK_EVIDENCE_INTEGRITY and quarantines an unresolved assertedFacts evidenceId", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");
    const { createReviewItem } = await import("@/lib/pil/human-review");

    const targetRun = baseTargetRun({ output: { assertedFacts: [{ claimType: "wealth_capacity", evidenceId: "ev-missing" }] } });

    vi.mocked(getEvidence).mockResolvedValue([] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);

    const client = makeClient({
      pil_agent_runs: { data: targetRun, error: null },
      pil_entity_resolution_candidates: { data: [], error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ProspectResearchCriticAgent } = await import("@/lib/pil/agents/sup/BEN-SUP-05");
    const critic = new ProspectResearchCriticAgent();
    const context = baseContext({ prospectId: "p1", plan: { targetAgentRunId: "producing-run-1" } });

    const result = await critic.execute(context as never, {} as never);
    const report = (result.conclusions as { report: { verdict: string } }).report;

    expect(report.verdict).toBe("BLOCK_EVIDENCE_INTEGRITY");
    expect(result.status).toBe("escalated");

    const quarantineCall = vi.mocked(logAction).mock.calls.find((call) => (call[0] as { action: string }).action === "critic.evidence_quarantined");
    expect(quarantineCall).toBeDefined();
    expect((quarantineCall?.[0] as unknown as { after_state: { unresolvedEvidenceIds: string[] } }).after_state.unresolvedEvidenceIds).toEqual(["ev-missing"]);
  });

  it("returns QUARANTINE_SECURITY at urgent priority when the target run belongs to a different org", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");
    const { createReviewItem } = await import("@/lib/pil/human-review");

    const targetRun = baseTargetRun({ organization_id: "99999999-8888-7777-6666-555555555555" });

    vi.mocked(getEvidence).mockResolvedValue([] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);

    const client = makeClient({
      pil_agent_runs: { data: targetRun, error: null },
      pil_entity_resolution_candidates: { data: [], error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ProspectResearchCriticAgent } = await import("@/lib/pil/agents/sup/BEN-SUP-05");
    const critic = new ProspectResearchCriticAgent();
    const context = baseContext({ prospectId: "p1", plan: { targetAgentRunId: "producing-run-1" } });

    const result = await critic.execute(context as never, {} as never);
    const report = (result.conclusions as { report: { verdict: string } }).report;

    expect(report.verdict).toBe("QUARANTINE_SECURITY");
    expect(result.status).toBe("escalated");
    expect(vi.mocked(createReviewItem).mock.calls[0]?.[0]).toMatchObject({ priority: "urgent" });
  });

  it("refuses to review its own prior output", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { logAction } = await import("@/lib/pil/audit");
    const { createReviewItem } = await import("@/lib/pil/human-review");

    const targetRun = baseTargetRun({ agent_id: "BEN-SUP-05" });

    vi.mocked(logAction).mockResolvedValue(undefined as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);

    const client = makeClient({
      pil_agent_runs: { data: targetRun, error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ProspectResearchCriticAgent } = await import("@/lib/pil/agents/sup/BEN-SUP-05");
    const critic = new ProspectResearchCriticAgent();
    const context = baseContext({ prospectId: "p1", plan: { targetAgentRunId: "producing-run-1" } });

    const result = await critic.execute(context as never, {} as never);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("BEN-SUP-05 cannot review its own prior output (self-certification is constitutionally prohibited)");
    expect(getEvidence).not.toHaveBeenCalled();
    expect(vi.mocked(logAction)).not.toHaveBeenCalled();
    expect(vi.mocked(createReviewItem)).not.toHaveBeenCalled();
  });

  it("downgrades a would-be PASS to PASS_WITH_CAVEATS when T-MODEL is permitted but unavailable", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { getEvidence } = await import("@/lib/pil/evidence");
    const { getNodesByProspect } = await import("@/lib/pil/graph");
    const { logAction } = await import("@/lib/pil/audit");
    const { createReviewItem } = await import("@/lib/pil/human-review");

    const targetRun = baseTargetRun();
    const cleanEvidence = baseEvidence({ id: "ev-clean" });

    vi.mocked(getEvidence).mockResolvedValue([cleanEvidence] as never);
    vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
    vi.mocked(logAction).mockResolvedValue(undefined as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);

    const client = makeClient({
      pil_agent_runs: { data: targetRun, error: null },
      pil_entity_resolution_candidates: { data: [], error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ProspectResearchCriticAgent } = await import("@/lib/pil/agents/sup/BEN-SUP-05");
    const critic = new ProspectResearchCriticAgent();
    const context = baseContext({ prospectId: "p1", tools: ["T-MODEL"], plan: { targetAgentRunId: "producing-run-1" } });
    const runner = { useTool: vi.fn().mockRejectedValue(new Error("model call failed")) };

    const result = await critic.execute(context as never, runner as never);
    const report = (result.conclusions as { report: { verdict: string; summary: string } }).report;

    expect(report.verdict).toBe("PASS_WITH_CAVEATS");
    expect(report.summary).toContain("Model-assisted review was unavailable this cycle.");
    expect(result.status).toBe("completed");
  });

  describe("regression: pre-existing verdicts unchanged", () => {
    async function runCritic(overrides: {
      targetRun?: Record<string, unknown>;
      evidence?: Record<string, unknown>[];
      resolutionCandidates?: unknown[];
      prospectId?: string | null;
    }) {
      const { getPilClient } = await import("@/lib/pil/db");
      const { getEvidence } = await import("@/lib/pil/evidence");
      const { getNodesByProspect } = await import("@/lib/pil/graph");
      const { logAction } = await import("@/lib/pil/audit");
      const { createReviewItem } = await import("@/lib/pil/human-review");

      const targetRun = baseTargetRun(overrides.targetRun);

      vi.mocked(getEvidence).mockResolvedValue((overrides.evidence ?? []) as never);
      vi.mocked(getNodesByProspect).mockResolvedValue([] as never);
      vi.mocked(logAction).mockResolvedValue(undefined as never);
      vi.mocked(createReviewItem).mockResolvedValue({} as never);

      const client = makeClient({
        pil_agent_runs: { data: targetRun, error: null },
        pil_entity_resolution_candidates: { data: overrides.resolutionCandidates ?? [], error: null },
      });
      vi.mocked(getPilClient).mockReturnValue(client as never);

      const { ProspectResearchCriticAgent } = await import("@/lib/pil/agents/sup/BEN-SUP-05");
      const critic = new ProspectResearchCriticAgent();
      const context = baseContext({
        prospectId: overrides.prospectId === undefined ? "p1" : overrides.prospectId,
        plan: { targetAgentRunId: "producing-run-1" },
      });
      return critic.execute(context as never, {} as never);
    }

    // BLOCK_INSUFFICIENT_EVIDENCE (via inference_presented_as_fact) is
    // already covered above; BLOCK_POLICY has no code path in
    // decideVerdict() to exercise -- nothing in this repo emits it yet.
    it("still returns PASS for fully clean evidence", async () => {
      const result = await runCritic({ evidence: [baseEvidence({ id: "ev-clean" })] });
      const report = (result.conclusions as { report: { verdict: string } }).report;
      expect(report.verdict).toBe("PASS");
      expect(result.status).toBe("completed");
    });

    it("still returns PASS_WITH_CAVEATS for a single weak-source claim", async () => {
      const result = await runCritic({ evidence: [baseEvidence({ id: "ev-weak", verification_status: "unverified" })] });
      const report = (result.conclusions as { report: { verdict: string } }).report;
      expect(report.verdict).toBe("PASS_WITH_CAVEATS");
      expect(result.status).toBe("completed");
    });

    it("still returns RESEARCH_MORE when there is no evidence at all", async () => {
      const result = await runCritic({ evidence: [] });
      const report = (result.conclusions as { report: { verdict: string } }).report;
      expect(report.verdict).toBe("RESEARCH_MORE");
      expect(result.status).toBe("completed");
    });

    it("still returns BLOCK_ENTITY_AMBIGUITY when a duplicate-identity candidate is unresolved", async () => {
      const result = await runCritic({
        evidence: [baseEvidence({ id: "ev-clean" })],
        resolutionCandidates: [{ id: "cand-1", status: "unresolved" }],
      });
      const report = (result.conclusions as { report: { verdict: string } }).report;
      expect(report.verdict).toBe("BLOCK_ENTITY_AMBIGUITY");
      expect(result.status).toBe("escalated");
    });
  });
});

describe("BEN-SUP-06 Research Recovery Investigator", () => {
  beforeEach(() => vi.resetAllMocks());

  function baseFailedResearchRun(overrides: Record<string, unknown> = {}) {
    return {
      id: "run-failed-1",
      organization_id: ORG_ID,
      goal_id: null,
      prospect_id: "p1",
      initiating_agent_id: "BEN-INT-08",
      natural_language_query: "test goal",
      structured_plan: {},
      status: "failed",
      token_budget: null,
      tokens_consumed: 0,
      financial_budget: null,
      financial_spent: 0,
      started_at: "2026-01-01T00:00:00Z",
      completed_at: null,
      created_at: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  function baseFailingAgentRun(overrides: Record<string, unknown> = {}) {
    return {
      id: "agent-run-1",
      organization_id: ORG_ID,
      agent_id: "BEN-INT-08",
      research_run_id: "run-failed-1",
      delegated_task_id: null,
      goal_id: null,
      status: "failed",
      autonomy_level_used: "A2",
      input: {},
      output: null,
      tokens_consumed: 0,
      cost_usd: 0,
      started_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:05:00Z",
      error: "Request timed out",
      created_at: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  async function setUp(opts: {
    failedRun?: Record<string, unknown> | null;
    failingAgentRun?: Record<string, unknown> | null;
    researchRunsListResponse?: { data: unknown; error: unknown };
    activeSources?: Array<{ source_key: string }>;
  }) {
    const { getPilClient } = await import("@/lib/pil/db");
    const { logAction } = await import("@/lib/pil/audit");
    const { createReviewItem } = await import("@/lib/pil/human-review");
    const { createResearchRun } = await import("@/lib/pil/workflow");
    const { listActiveSources } = await import("@/lib/pil/sources");

    const failedRun = opts.failedRun === undefined ? baseFailedResearchRun() : opts.failedRun;
    const failingAgentRun = opts.failingAgentRun === undefined ? baseFailingAgentRun() : opts.failingAgentRun;

    vi.mocked(logAction).mockResolvedValue(undefined as never);
    vi.mocked(createReviewItem).mockResolvedValue({} as never);
    vi.mocked(createResearchRun).mockResolvedValue({ ...baseFailedResearchRun({ id: "new-recovery-run-1" }) } as never);
    vi.mocked(listActiveSources).mockResolvedValue((opts.activeSources ?? []) as never);

    const client = makeClient({
      pil_research_runs: [
        { data: failedRun, error: null },
        opts.researchRunsListResponse ?? { data: [], error: null },
      ],
      pil_research_run_steps: { data: [], error: null },
      pil_agent_runs: { data: failingAgentRun ? [failingAgentRun] : [], error: null },
    });
    vi.mocked(getPilClient).mockReturnValue(client as never);

    const { ResearchRecoveryInvestigatorAgent } = await import("@/lib/pil/agents/sup/BEN-SUP-06");
    const agent = new ResearchRecoveryInvestigatorAgent();
    const context = baseContext({ agentCode: "BEN-SUP-06", runId: "run-failed-1" });
    const runner = { useTool: vi.fn() };
    return { agent, context, runner, logAction, createReviewItem, createResearchRun, listActiveSources };
  }

  it("escalates instead of spawning a second recovery run when this failure was already recovered once (idempotency guard)", async () => {
    const priorRecoveryRun = baseFailedResearchRun({
      id: "recovery-run-1",
      structured_plan: { recovery_of: "run-failed-1", recovery_action: "retry" },
    });
    const { agent, context, runner, createResearchRun, createReviewItem } = await setUp({
      failingAgentRun: baseFailingAgentRun({ error: "Connection timed out while fetching source" }),
      researchRunsListResponse: { data: [priorRecoveryRun], error: null },
    });

    const result = await agent.execute(context as never, runner as never);
    const conclusions = result.conclusions as { plan: { action: string; failureClass: string; detail: Record<string, unknown> }; idempotencyStatus: string | null };

    expect(conclusions.idempotencyStatus).toBe("CONFIRMED_EXECUTED_MULTIPLE");
    expect(conclusions.plan.action).toBe("escalate");
    expect(conclusions.plan.failureClass).toBe("transient");
    expect(conclusions.plan.detail.priorRecoveryRunId).toBe("recovery-run-1");
    expect(result.status).toBe("escalated");
    expect(createResearchRun).not.toHaveBeenCalled();
    expect(createReviewItem).toHaveBeenCalledTimes(1);
  });

  it("fires the recovery.preservation_snapshot logAction before any mutating call", async () => {
    const { agent, context, runner, logAction, createResearchRun } = await setUp({
      failingAgentRun: baseFailingAgentRun({ error: "Connection timed out while fetching source" }),
      researchRunsListResponse: { data: [], error: null },
    });

    await agent.execute(context as never, runner as never);

    expect(vi.mocked(logAction).mock.calls[0]?.[0]).toMatchObject({ action: "recovery.preservation_snapshot" });
    const preservationOrder = vi.mocked(logAction).mock.invocationCallOrder[0];
    const spawnOrder = vi.mocked(createResearchRun).mock.invocationCallOrder[0];
    expect(preservationOrder).toBeDefined();
    expect(spawnOrder).toBeDefined();
    expect(preservationOrder as number).toBeLessThan(spawnOrder as number);
  });

  it("always escalates at urgent priority for a cross-tenant failing agent run, regardless of the error text", async () => {
    const { agent, context, runner, createReviewItem, createResearchRun } = await setUp({
      failingAgentRun: baseFailingAgentRun({
        organization_id: "99999999-8888-7777-6666-555555555555",
        error: "404 not found -- access denied",
      }),
    });

    const result = await agent.execute(context as never, runner as never);
    const conclusions = result.conclusions as { plan: { action: string; failureClass: string } };

    expect(conclusions.plan.failureClass).toBe("cross_tenant");
    expect(conclusions.plan.action).toBe("escalate");
    expect(result.status).toBe("escalated");
    expect(createResearchRun).not.toHaveBeenCalled();
    expect(vi.mocked(createReviewItem).mock.calls[0]?.[0]).toMatchObject({ priority: "urgent" });
  });

  describe("regression: pre-existing recovery paths unchanged", () => {
    it("still proposes a retry plan with modified params and delegates to the failing agent for a transient failure", async () => {
      const { agent, context, runner, createResearchRun } = await setUp({
        failingAgentRun: baseFailingAgentRun({ error: "ECONNRESET while calling source" }),
      });

      const result = await agent.execute(context as never, runner as never);
      const conclusions = result.conclusions as { plan: { action: string; failureClass: string }; newResearchRunId: string | null };

      expect(conclusions.plan.failureClass).toBe("transient");
      expect(conclusions.plan.action).toBe("retry");
      expect(conclusions.newResearchRunId).toBe("new-recovery-run-1");
      expect(result.status).toBe("completed");
      expect(result.delegations[0]).toMatchObject({ childAgentCode: "BEN-INT-08" });
      expect(createResearchRun).toHaveBeenCalledTimes(1);
    });

    it("still proposes an alternative-path plan using active sources for a permanent failure", async () => {
      const { agent, context, runner } = await setUp({
        failingAgentRun: baseFailingAgentRun({ error: "403 forbidden -- access denied" }),
        activeSources: [{ source_key: "source-a" }, { source_key: "source-b" }],
      });

      const result = await agent.execute(context as never, runner as never);
      const conclusions = result.conclusions as { plan: { action: string; failureClass: string; detail: Record<string, unknown> }; newResearchRunId: string | null };

      expect(conclusions.plan.failureClass).toBe("permanent");
      expect(conclusions.plan.action).toBe("alternative_path");
      expect(conclusions.plan.detail.alternativeSourceKeys).toEqual(["source-a", "source-b"]);
      expect(conclusions.newResearchRunId).toBe("new-recovery-run-1");
      expect(result.status).toBe("completed");
    });

    it("still escalates a permanent failure when no alternative active sources exist", async () => {
      const { agent, context, runner, createReviewItem } = await setUp({
        failingAgentRun: baseFailingAgentRun({ error: "403 forbidden -- access denied" }),
        activeSources: [],
      });

      const result = await agent.execute(context as never, runner as never);
      const conclusions = result.conclusions as { plan: { action: string; failureClass: string } };

      expect(conclusions.plan.failureClass).toBe("permanent");
      expect(conclusions.plan.action).toBe("escalate");
      expect(result.status).toBe("escalated");
      expect(createReviewItem).toHaveBeenCalledTimes(1);
    });

    it("still escalates when the failure signature cannot be classified", async () => {
      const { agent, context, runner, createReviewItem } = await setUp({
        failingAgentRun: baseFailingAgentRun({ error: "something inexplicable happened" }),
      });

      const result = await agent.execute(context as never, runner as never);
      const conclusions = result.conclusions as { plan: { action: string; failureClass: string; detail: Record<string, unknown> } };

      expect(conclusions.plan.failureClass).toBe("unknown");
      expect(conclusions.plan.action).toBe("escalate");
      expect(conclusions.plan.detail.reason).toBe("Could not classify failure signature.");
      expect(result.status).toBe("escalated");
      expect(createReviewItem).toHaveBeenCalledTimes(1);
    });
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
