import { describe, it, expect, vi } from "vitest";
import {
  AutonomousAgent,
  AUTONOMOUS_HARD_LIMITS,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";

/**
 * AutonomousAgent is abstract — this concrete subclass exists only to
 * exercise its protected helpers (logDecision/startRun/completeRun) from
 * tests. `run()` is never exercised here; agent-specific behavior belongs
 * in each agent's own test file (see draft-generation.test.ts).
 */
class TestAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: unknown) {
    super(orgId, "test-agent", supabase as never);
  }

  async run(): Promise<AutonomousAgentResult> {
    throw new Error("not exercised in these tests");
  }

  callLogDecision(params: Parameters<AutonomousAgent["logDecision"]>[0]) {
    return this.logDecision(params);
  }

  callStartRun(...args: Parameters<AutonomousAgent["startRun"]>) {
    return this.startRun(...args);
  }

  callCompleteRun(...args: Parameters<AutonomousAgent["completeRun"]>) {
    return this.completeRun(...args);
  }
}

/** Records every insert/update payload per table so assertions can inspect
 * exactly what was sent to Supabase, while resolving every terminal call
 * (.single()/.maybeSingle()/direct await) to a caller-supplied result. */
function createSupabaseMock() {
  const inserts: Record<string, Record<string, unknown>[]> = {};
  const updates: Record<
    string,
    { data: Record<string, unknown>; filters: Array<[string, unknown]> }[]
  > = {};

  function makeBuilder(table: string) {
    const filters: Array<[string, unknown]> = [];
    const builder: Record<string, unknown> = {};

    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return builder;
    });
    builder.insert = vi.fn((data: Record<string, unknown>) => {
      inserts[table] = inserts[table] ?? [];
      inserts[table].push(data);
      return builder;
    });
    builder.update = vi.fn((data: Record<string, unknown>) => {
      updates[table] = updates[table] ?? [];
      // `filters` is the same array `.eq()` pushes into later in the chain
      // (`.update(x).eq("id", y)`) — keep the reference, not a snapshot,
      // so it reflects the full chain once the call completes.
      updates[table].push({ data, filters });
      return builder;
    });
    builder.single = vi.fn(async () => ({
      data: { id: `${table}-generated-id` },
      error: null,
    }));
    builder.maybeSingle = vi.fn(async () => ({
      data: { id: `${table}-generated-id` },
      error: null,
    }));
    // Supports `await this.supabase.from(table).update(x).eq(...)` — no
    // .single() call in that path, so the builder itself must be thenable.
    builder.then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: null, error: null }).then(resolve, reject);

    return builder;
  }

  const client = {
    from: vi.fn((table: string) => makeBuilder(table)),
  };

  return { client, inserts, updates };
}

describe("AUTONOMOUS_HARD_LIMITS", () => {
  it("has every hard limit set to its locked value", () => {
    expect(AUTONOMOUS_HARD_LIMITS.NEVER_SUBMIT_EXTERNALLY).toBe(true);
    expect(AUTONOMOUS_HARD_LIMITS.NEVER_SEND_EMAIL_WITHOUT_APPROVAL).toBe(true);
    expect(AUTONOMOUS_HARD_LIMITS.NEVER_DELETE_USER_DATA).toBe(true);
    expect(AUTONOMOUS_HARD_LIMITS.NEVER_MODIFY_GOVERNANCE_FILES).toBe(true);
    expect(AUTONOMOUS_HARD_LIMITS.MAX_DRAFTS_PER_NIGHT_DEFAULT).toBe(10);
    expect(AUTONOMOUS_HARD_LIMITS.MIN_CONFIDENCE_TO_ACT).toBe(60);
  });
});

describe("AutonomousAgent#logDecision", () => {
  it("forces required_human_review=true when confidence is below MIN_CONFIDENCE_TO_ACT, even if the caller said false", async () => {
    const { client, inserts } = createSupabaseMock();
    const agent = new TestAgent("org-1", client);

    await agent.callLogDecision({
      decisionType: "draft_generated",
      reasoning: "low confidence draft",
      confidenceScore: 59,
      actionTaken: "created_draft_pending_review",
      requiredHumanReview: false,
    });

    const decision = inserts["agent_decisions"]?.[0];
    expect(decision).toBeDefined();
    expect(decision?.required_human_review).toBe(true);
    expect(decision?.confidence_score).toBe(59);
  });

  it("respects the caller's requiredHumanReview when confidence meets MIN_CONFIDENCE_TO_ACT", async () => {
    const { client, inserts } = createSupabaseMock();
    const agent = new TestAgent("org-1", client);

    await agent.callLogDecision({
      decisionType: "draft_generated",
      reasoning: "high confidence draft",
      confidenceScore: 90,
      actionTaken: "created_draft_pending_review",
      requiredHumanReview: false,
    });

    const decision = inserts["agent_decisions"]?.[0];
    expect(decision?.required_human_review).toBe(false);
  });

  it("defaults required_human_review to false at exactly the confidence threshold when the caller omits it", async () => {
    const { client, inserts } = createSupabaseMock();
    const agent = new TestAgent("org-1", client);

    await agent.callLogDecision({
      decisionType: "draft_generated",
      reasoning: "boundary confidence",
      confidenceScore: 60,
      actionTaken: "created_draft_pending_review",
    });

    const decision = inserts["agent_decisions"]?.[0];
    expect(decision?.required_human_review).toBe(false);
  });
});

describe("AutonomousAgent#startRun", () => {
  it("creates an agent_runs record with status running", async () => {
    const { client, inserts } = createSupabaseMock();
    const agent = new TestAgent("org-1", client);

    const runId = await agent.callStartRun("manual", { foo: "bar" });

    expect(runId).toBe("agent_runs-generated-id");
    const run = inserts["agent_runs"]?.[0];
    expect(run).toBeDefined();
    expect(run?.status).toBe("running");
    expect(run?.organization_id).toBe("org-1");
    expect(run?.agent_type).toBe("test-agent");
    expect(run?.trigger_source).toBe("manual");
    expect(run?.input_params).toEqual({ foo: "bar" });
  });
});

describe("AutonomousAgent#completeRun", () => {
  it("updates the agent_runs row to status completed", async () => {
    const { client, updates } = createSupabaseMock();
    const agent = new TestAgent("org-1", client);

    await agent.callCompleteRun("run-123", {
      outputSummary: "done",
      itemsFound: 2,
      itemsProcessed: 2,
    });

    const update = updates["agent_runs"]?.[0];
    expect(update).toBeDefined();
    expect(update?.data.status).toBe("completed");
    expect(update?.data.output_summary).toBe("done");
    expect(update?.data.items_found).toBe(2);
    expect(update?.data.items_processed).toBe(2);
    expect(update?.filters).toContainEqual(["id", "run-123"]);
  });
});
