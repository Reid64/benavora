// Phase 5.3 regression test: pollAndOrchestratePendingRuns() must skip
// research runs with no prospect_id (discovery-type runs, created by POST
// /api/pil/discover) rather than repeatedly fail-and-escalate them every
// poll -- orchestrateResearchRun() can only drive a single-prospect
// pipeline. Without this guard, wiring up /api/cron/pil-research (this
// session's fix for PIL_WIRING_AUDIT.md's "zero callers" finding) would
// have mass-failed every discovery run on its very first poll.
import { describe, it, expect, vi, beforeEach } from "vitest";

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

function makeClient(recorded: RecordedCall[], responses: Record<string, unknown[]>) {
  const callCounts: Record<string, number> = {};
  const nextResponse = (table: string) => {
    const configured = responses[table] ?? [];
    const idx = callCounts[table] ?? 0;
    callCounts[table] = idx + 1;
    return configured[Math.min(idx, configured.length - 1)] ?? { data: null, error: null };
  };
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      select: vi.fn((...a) => { recorded.push({ table, method: "select", args: a }); return c; }),
      insert: vi.fn((...a) => { recorded.push({ table, method: "insert", args: a }); return c; }),
      update: vi.fn((...a) => { recorded.push({ table, method: "update", args: a }); return c; }),
      eq: vi.fn((...a) => { recorded.push({ table, method: "eq", args: a }); return c; }),
      in: vi.fn((...a) => { recorded.push({ table, method: "in", args: a }); return c; }),
      order: vi.fn((...a) => { recorded.push({ table, method: "order", args: a }); return c; }),
      limit: vi.fn((...a) => { recorded.push({ table, method: "limit", args: a }); return c; }),
      single: vi.fn(() => Promise.resolve(nextResponse(table))),
      maybeSingle: vi.fn(() => Promise.resolve(nextResponse(table))),
      then: (resolve: (v: unknown) => void) => Promise.resolve(nextResponse(table)).then(resolve),
    };
    return c;
  };
  return { from: vi.fn((table: string) => chain(table)) };
}

const getPilClientMock = vi.fn();
vi.mock("@/lib/pil/db", () => ({ getPilClient: () => getPilClientMock() }));
vi.mock("@/lib/pil/agent-registry-service", () => ({ getAgentsByFamily: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/pil/agent-runner", () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({ run: vi.fn() })),
}));
vi.mock("@/lib/pil/tools", () => ({ listTools: vi.fn(() => []) }));
vi.mock("@/lib/pil/workflow", () => ({
  advanceRunState: vi.fn(),
  failRun: vi.fn(),
}));
vi.mock("@/lib/pil/audit", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/pil/human-review", () => ({ createReviewItem: vi.fn() }));
vi.mock("@/lib/autoapply/auto-queue-populator", () => ({ populateQueue: vi.fn() }));
vi.mock("@/lib/autoapply/webhook-notifier", () => ({
  WebhookNotifier: vi.fn().mockImplementation(() => ({ notify: vi.fn() })),
}));

import { pollAndOrchestratePendingRuns } from "@/lib/pil/research-orchestrator";

describe("pollAndOrchestratePendingRuns skips prospect-less (discovery) runs", () => {
  beforeEach(() => {
    getPilClientMock.mockReset();
  });

  it("never attempts a run with prospect_id === null, but does attempt one with a real prospect_id", async () => {
    const recorded: RecordedCall[] = [];
    const client = makeClient(recorded, {
      pil_research_runs: [
        // 1st hit: the initial pending-runs list query (resolved via `.then`).
        {
          data: [
            { id: "run-discovery-no-prospect", prospect_id: null },
            { id: "run-with-prospect", prospect_id: "p1" },
          ],
          error: null,
        },
        // 2nd hit: getRunOrThrow's `.single()` for "run-with-prospect" --
        // forced to error so this test doesn't need to simulate the entire
        // multi-family orchestration pipeline just to prove the row was
        // reached at all.
        { data: null, error: new Error("simulated DB error") },
      ],
    });
    getPilClientMock.mockReturnValue(client);

    const results = await pollAndOrchestratePendingRuns({ limit: 5 });

    // The discovery-type run must never appear in the results at all --
    // skipped outright, not attempted-and-failed.
    expect(results.find((r) => r.runId === "run-discovery-no-prospect")).toBeUndefined();

    // The real-prospect run WAS attempted (reached getRunOrThrow, which we
    // forced to throw) and pollAndOrchestratePendingRuns's own catch block
    // recorded it as failed.
    expect(results).toEqual([{ runId: "run-with-prospect", status: "failed" }]);

    // Confirm the skip happened before any second DB round-trip for the
    // discovery run specifically: only one `.eq("id", ...)` call was made
    // for id lookups, and it targeted the prospect-bearing run.
    const idLookups = recorded.filter((c) => c.method === "eq" && c.args[0] === "id");
    expect(idLookups).toHaveLength(1);
    expect(idLookups[0]?.args[1]).toBe("run-with-prospect");
  });
});
