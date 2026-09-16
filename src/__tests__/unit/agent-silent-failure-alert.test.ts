// Phase 5.3 regression test: CROSS_WIRING_REPORT.md (2026-09-15) found the
// platform has no agent-agnostic alert path for the ag-29 "found > 0,
// processed 0, but status='completed'" silent-failure pattern -- catching it
// depended entirely on each agent's own code remembering to call
// createNotification(). This tests the shared, automatic guard added to both
// base classes: AutonomousAgent.completeRun() (autonomous-base.ts) and
// BaseAgent.run() (base-agent.ts).
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/billing/usage-tracker", () => ({ trackUsage: vi.fn() }));

import { AutonomousAgent, type AutonomousAgentResult } from "@/lib/agents/autonomous-base";
import { BaseAgent, type AgentExecution } from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

type Call = { table: string; payload: unknown };

function makeClient(calls: Call[]) {
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      select: vi.fn(() => c),
      insert: vi.fn((payload: unknown) => {
        calls.push({ table, payload });
        return c;
      }),
      update: vi.fn((payload: unknown) => {
        calls.push({ table, payload });
        return c;
      }),
      eq: vi.fn(() => c),
      single: vi.fn(() => Promise.resolve({ data: { id: "run-1" }, error: null })),
      then: (resolve: (v: unknown) => void) =>
        Promise.resolve({ data: { id: "run-1" }, error: null }).then(resolve),
    };
    return c;
  };
  return { from: vi.fn((table: string) => chain(table)) };
}

class TestAutonomousAgent extends AutonomousAgent {
  async run(): Promise<AutonomousAgentResult> {
    throw new Error("not used in this test");
  }
  async exerciseCompleteRun(params: {
    itemsFound?: number;
    itemsProcessed?: number;
    status?: "completed" | "failed";
  }): Promise<void> {
    const runId = await this.startRun("manual");
    await this.completeRun(runId, {
      outputSummary: "test summary",
      itemsFound: params.itemsFound,
      itemsProcessed: params.itemsProcessed,
      status: params.status,
    });
  }
}

class TestBaseAgent extends BaseAgent<void, void> {
  readonly agentType = "grant_summary" as AgentType;
  private itemsFound: number;
  private itemsProcessed: number;
  constructor(client: unknown, itemsFound: number, itemsProcessed: number) {
    super({ client: client as never, organizationId: "org-1" });
    this.itemsFound = itemsFound;
    this.itemsProcessed = itemsProcessed;
  }
  protected async execute(): Promise<AgentExecution<void>> {
    return {
      data: undefined,
      outputSummary: "test summary",
      itemsFound: this.itemsFound,
      itemsProcessed: this.itemsProcessed,
    };
  }
}

describe("shared silent-failure alert guard", () => {
  it("AutonomousAgent.completeRun writes an alerts row when found > 0 and processed === 0", async () => {
    const calls: Call[] = [];
    const agent = new TestAutonomousAgent("org-1", "test-agent", makeClient(calls) as never);
    await agent.exerciseCompleteRun({ itemsFound: 2, itemsProcessed: 0 });

    const alert = calls.find((c) => c.table === "alerts");
    expect(alert).toBeDefined();
    expect((alert?.payload as Record<string, unknown>).message).toContain("found 2 item(s), processed 0");
  });

  it("AutonomousAgent.completeRun does NOT alert on real success (found > 0, processed > 0)", async () => {
    const calls: Call[] = [];
    const agent = new TestAutonomousAgent("org-1", "test-agent", makeClient(calls) as never);
    await agent.exerciseCompleteRun({ itemsFound: 2, itemsProcessed: 2 });

    expect(calls.find((c) => c.table === "alerts")).toBeUndefined();
  });

  it("AutonomousAgent.completeRun does NOT alert when status is already 'failed'", async () => {
    const calls: Call[] = [];
    const agent = new TestAutonomousAgent("org-1", "test-agent", makeClient(calls) as never);
    await agent.exerciseCompleteRun({ itemsFound: 2, itemsProcessed: 0, status: "failed" });

    expect(calls.find((c) => c.table === "alerts")).toBeUndefined();
  });

  it("BaseAgent.run writes an alerts row when found > 0 and processed === 0", async () => {
    const calls: Call[] = [];
    const agent = new TestBaseAgent(makeClient(calls), 3, 0);
    await agent.run(undefined);

    const alert = calls.find((c) => c.table === "alerts");
    expect(alert).toBeDefined();
    expect((alert?.payload as Record<string, unknown>).message).toContain("found 3 item(s), processed 0");
  });

  it("BaseAgent.run does NOT alert on real success", async () => {
    const calls: Call[] = [];
    const agent = new TestBaseAgent(makeClient(calls), 3, 3);
    await agent.run(undefined);

    expect(calls.find((c) => c.table === "alerts")).toBeUndefined();
  });
});
