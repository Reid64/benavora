// AR-9.1: orchestration_logs (migration 190, AR-6.2) had exactly zero rows in
// production despite 184 real agent_runs in the prior 3 hours, because AR-6.2
// only wired worker/autonomous-orchestrator.ts's agent_queue consumer -- a
// path fed solely by on-demand trigger routes that had queued nothing in 24+
// hours. The actual high-volume production traffic runs through three shared
// boundaries that were never instrumented:
//   - src/lib/agents/autonomous-base.ts (AutonomousAgent.completeRun/failRun)
//     -- 26 subclasses, including ag-29-knowledge-indexer's 24/7 poll loop
//     (178 of 184 real runs measured live on 2026-09-18).
//   - src/lib/autoapply/run-logger.ts (withAgentRun) -- the AutoApply worker
//     pipeline (worker/queue-processor.ts).
//   - src/lib/agents/base-agent.ts (BaseAgent.run) -- the on-demand agent
//     fleet (eligibility scoring, research, draft generation, ...).
//
// This proves each boundary now writes exactly one orchestration_logs row
// per real step (completed and failed), and that a write failure there is
// loud (console.error, fixed "[orchestration_logs]" prefix) rather than
// silently swallowed -- an observability write that fails silently is worse
// than none, because it manufactures confidence (see this file's companion
// migration 196 and STATE_OF_THE_BUILD.md's AR-9.1 section for the full
// root-cause account).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/billing/usage-tracker", () => ({ trackUsage: vi.fn() }));

import { AutonomousAgent, type AutonomousAgentResult } from "@/lib/agents/autonomous-base";
import { BaseAgent, type AgentExecution } from "@/lib/agents/base-agent";
import { withAgentRun } from "@/lib/autoapply/run-logger";
import type { AgentType } from "@/types/agents";

type Call = { table: string; method: "insert" | "update"; payload: unknown };

interface MockOpts {
  /** orchestration_logs insert outcome: 'ok' | 'db-error' | 'throw'. */
  orchestrationLogsInsert?: "ok" | "db-error" | "throw";
}

function makeClient(calls: Call[], opts: MockOpts = {}) {
  const mode = opts.orchestrationLogsInsert ?? "ok";

  const from = vi.fn((table: string) => {
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
      eq: vi.fn(() => Promise.resolve({ error: null })),
      single: vi.fn(() => {
        if (table === "orchestration_logs") {
          if (mode === "throw") return Promise.reject(new Error("network exploded"));
          if (mode === "db-error") {
            return Promise.resolve({ data: null, error: { message: "permission denied for table orchestration_logs" } });
          }
          return Promise.resolve({ data: { id: "orch-log-row-1" }, error: null });
        }
        return Promise.resolve({ data: { id: "run-1" }, error: null });
      }),
    };
    return c;
  });

  return { from } as unknown as SupabaseClient;
}

function orchestrationInserts(calls: Call[]): Record<string, unknown>[] {
  return calls
    .filter((c) => c.table === "orchestration_logs" && c.method === "insert")
    .map((c) => c.payload as Record<string, unknown>);
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

// --- AutonomousAgent (src/lib/agents/autonomous-base.ts) -------------------

class TestAutonomousAgent extends AutonomousAgent {
  async run(): Promise<AutonomousAgentResult> {
    throw new Error("not used in this test");
  }
  async exerciseComplete(itemsFound: number, itemsProcessed: number): Promise<void> {
    const runId = await this.startRun("autonomous");
    await this.completeRun(runId, { outputSummary: "done", itemsFound, itemsProcessed });
  }
  async exerciseFail(message: string): Promise<void> {
    const runId = await this.startRun("autonomous");
    await this.failRun(runId, message);
  }
}

describe("AutonomousAgent writes orchestration_logs (AR-9.1)", () => {
  it("completeRun writes a completed orchestration_logs row scoped to the run", async () => {
    const calls: Call[] = [];
    const agent = new TestAutonomousAgent("org-1", "ag-29-knowledge-indexer", makeClient(calls));
    await agent.exerciseComplete(5, 5);

    const rows = orchestrationInserts(calls);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organization_id).toBe("org-1");
    expect(rows[0]!.orchestration_id).toBe("run-1");
    expect(rows[0]!.agent_run_id).toBe("run-1");
    expect(rows[0]!.task_id).toBe("ag-29-knowledge-indexer");
    expect(rows[0]!.agent_type).toBe("ag-29-knowledge-indexer");
    expect(rows[0]!.status).toBe("completed");
    expect(rows[0]!.items_expected).toBe(5);
    expect(rows[0]!.items_processed).toBe(5);
  });

  it("failRun writes a failed orchestration_logs row with the error message", async () => {
    const calls: Call[] = [];
    const agent = new TestAutonomousAgent("org-1", "ag-36-learning-network", makeClient(calls));
    await agent.exerciseFail("Claude API returned 529 after 3 retries.");

    const rows = orchestrationInserts(calls);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.error_message).toContain("Claude API returned 529");
    expect(rows[0]!.schema_validation_passed).toBe(false);
  });

  it("a failed orchestration_logs write is loud (console.error) but never breaks the real run", async () => {
    const calls: Call[] = [];
    const agent = new TestAutonomousAgent("org-1", "ag-29-knowledge-indexer", makeClient(calls, { orchestrationLogsInsert: "db-error" }));
    await expect(agent.exerciseComplete(5, 5)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[orchestration_logs] WRITE FAILED"),
    );
  });

  it("a thrown orchestration_logs write is caught, loud, and never breaks the real run", async () => {
    const calls: Call[] = [];
    const agent = new TestAutonomousAgent("org-1", "ag-29-knowledge-indexer", makeClient(calls, { orchestrationLogsInsert: "throw" }));
    await expect(agent.exerciseComplete(5, 5)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[orchestration_logs] WRITE THREW"),
    );
  });
});

// --- withAgentRun (src/lib/autoapply/run-logger.ts) -------------------------

describe("withAgentRun writes orchestration_logs (AR-9.1)", () => {
  it("writes a completed orchestration_logs row on success", async () => {
    const calls: Call[] = [];
    const client = makeClient(calls);
    const result = await withAgentRun(
      { supabase: client, agentType: "autoapply_queue_processor", organizationId: "org-1" },
      async () => "ok",
    );
    expect(result).toBe("ok");

    const rows = orchestrationInserts(calls);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organization_id).toBe("org-1");
    expect(rows[0]!.agent_type).toBe("autoapply_queue_processor");
    expect(rows[0]!.agent_run_id).toBe("run-1");
    expect(rows[0]!.status).toBe("completed");
  });

  it("writes a failed orchestration_logs row and still rethrows the original error", async () => {
    const calls: Call[] = [];
    const client = makeClient(calls);
    const originalError = new Error("submission failed");
    await expect(
      withAgentRun(
        { supabase: client, agentType: "autoapply_submission_validator", organizationId: "org-1" },
        async () => {
          throw originalError;
        },
      ),
    ).rejects.toBe(originalError);

    const rows = orchestrationInserts(calls);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.error_message).toContain("submission failed");
  });

  it("a failed orchestration_logs write is loud but never masks the real result", async () => {
    const calls: Call[] = [];
    const client = makeClient(calls, { orchestrationLogsInsert: "db-error" });
    const result = await withAgentRun(
      { supabase: client, agentType: "autoapply_queue_processor", organizationId: "org-1" },
      async () => "ok",
    );
    expect(result).toBe("ok");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[orchestration_logs] WRITE FAILED"),
    );
  });
});

// --- BaseAgent (src/lib/agents/base-agent.ts) -------------------------------

class TestBaseAgent extends BaseAgent<void, void> {
  readonly agentType = "grant_summary" as AgentType;
  constructor(client: SupabaseClient, private shouldThrow = false) {
    super({ client, organizationId: "org-1" });
  }
  protected async execute(): Promise<AgentExecution<void>> {
    if (this.shouldThrow) throw new Error("execution blew up");
    return { data: undefined, outputSummary: "done", itemsFound: 1, itemsProcessed: 1 };
  }
}

describe("BaseAgent.run writes orchestration_logs (AR-9.1)", () => {
  it("writes a completed orchestration_logs row on success", async () => {
    const calls: Call[] = [];
    const agent = new TestBaseAgent(makeClient(calls));
    await agent.run(undefined);

    const rows = orchestrationInserts(calls);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organization_id).toBe("org-1");
    expect(rows[0]!.agent_type).toBe("grant_summary");
    expect(rows[0]!.status).toBe("completed");
  });

  it("writes a failed orchestration_logs row when execute() throws", async () => {
    const calls: Call[] = [];
    const agent = new TestBaseAgent(makeClient(calls), true);
    await expect(agent.run(undefined)).rejects.toThrow();

    const rows = orchestrationInserts(calls);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.error_message).toContain("execution blew up");
  });
});
