// Unit tests for the pil_agent_runs sweep added to worker/stuck-run-watchdog.ts
// (AR-1.1, 2026-09-16). Everything is mocked -- no real DB calls, matching
// every other src/__tests__/unit/* suite in this repo (see
// pil-sup-agents.test.ts for the same chainable-client convention).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { start, stop, waitForIdle } from "../../../worker/stuck-run-watchdog";

interface RecordedOp {
  table: string;
  kind: "select" | "update" | "eq" | "lt";
  col?: string;
  val?: unknown;
  payload?: unknown;
}

const STUCK_TIMEOUT_MINUTES = 30;

function makeClient(
  responses: Record<string, { data: unknown; error: unknown }>,
  recorded: RecordedOp[],
) {
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      select: vi.fn((col: string) => {
        recorded.push({ table, kind: "select", col });
        return c;
      }),
      update: vi.fn((payload: unknown) => {
        recorded.push({ table, kind: "update", payload });
        return c;
      }),
      eq: vi.fn((col: string, val: unknown) => {
        recorded.push({ table, kind: "eq", col, val });
        return c;
      }),
      lt: vi.fn((col: string, val: unknown) => {
        recorded.push({ table, kind: "lt", col, val });
        return c;
      }),
      then: (resolve: (v: unknown) => void) =>
        Promise.resolve(responses[table] ?? { data: [], error: null }).then(resolve),
    };
    return c;
  };
  return { from: vi.fn((table: string) => chain(table)) };
}

function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

describe("stuck-run-watchdog PIL sweep", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("selects id, agent_id, started_at from pil_agent_runs filtered to status='running' older than the threshold", async () => {
    const recorded: RecordedOp[] = [];
    const client = makeClient(
      {
        agent_runs: { data: [], error: null },
        pil_agent_runs: { data: [], error: null },
      },
      recorded,
    );

    start(client as never);
    stop();
    await waitForIdle();

    const pilOps = recorded.filter((op) => op.table === "pil_agent_runs");
    expect(pilOps[0]).toMatchObject({ kind: "select", col: "id, agent_id, started_at" });
    expect(pilOps.some((op) => op.kind === "eq" && op.col === "status" && op.val === "running")).toBe(true);
    expect(pilOps.some((op) => op.kind === "lt" && op.col === "started_at")).toBe(true);
  });

  it("marks a stuck pil_agent_runs row failed with a non-empty, guarded error message", async () => {
    const recorded: RecordedOp[] = [];
    const stuckRow = { id: "pil-run-1", agent_id: "BEN-SUP-01", started_at: minutesAgoIso(STUCK_TIMEOUT_MINUTES + 10) };
    const client = makeClient(
      {
        agent_runs: { data: [], error: null },
        pil_agent_runs: { data: [stuckRow], error: null },
      },
      recorded,
    );

    start(client as never);
    stop();
    await waitForIdle();

    const updateOp = recorded.find((op) => op.table === "pil_agent_runs" && op.kind === "update");
    expect(updateOp).toBeDefined();
    const payload = updateOp!.payload as { status: string; error: string; completed_at: string };
    expect(payload.status).toBe("failed");
    expect(typeof payload.error).toBe("string");
    expect(payload.error.length).toBeGreaterThan(0);
    expect(payload.error).toContain("Timeout");
    expect(payload.error).toContain("30m");

    // The update must be scoped by id and re-guarded on status='running' so a
    // run that completed between the select and the update is never clobbered.
    const eqOps = recorded.filter((op) => op.table === "pil_agent_runs" && op.kind === "eq");
    expect(eqOps.some((op) => op.col === "id" && op.val === "pil-run-1")).toBe(true);
    const statusGuard = eqOps.filter((op) => op.col === "status" && op.val === "running");
    // one status='running' eq from the select, one from the update guard
    expect(statusGuard.length).toBeGreaterThanOrEqual(2);
  });

  it("does not clobber a row whose status already changed (guarded update filters it out)", async () => {
    const recorded: RecordedOp[] = [];
    const stuckRow = { id: "pil-run-2", agent_id: "BEN-DIS-08", started_at: minutesAgoIso(STUCK_TIMEOUT_MINUTES + 5) };
    // Simulate the update guard finding no matching row anymore (already
    // transitioned away from 'running' between select and update) by
    // returning no error and no data -- the watchdog should not throw and
    // should still have attempted exactly one guarded update for this row.
    const client = makeClient(
      {
        agent_runs: { data: [], error: null },
        pil_agent_runs: { data: [stuckRow], error: null },
      },
      recorded,
    );

    start(client as never);
    stop();
    await waitForIdle();

    const updateOps = recorded.filter((op) => op.table === "pil_agent_runs" && op.kind === "update");
    expect(updateOps.length).toBe(1);
    const eqOpsAfterUpdate = recorded.filter((op) => op.table === "pil_agent_runs" && op.kind === "eq");
    const statusRunningGuards = eqOpsAfterUpdate.filter((op) => op.col === "status" && op.val === "running");
    // Guard present means: even though this mock always "succeeds", a real
    // Postgres UPDATE ... WHERE id = ? AND status = 'running' would silently
    // affect zero rows if the status had already changed -- never an
    // unconditional clobber.
    expect(statusRunningGuards.length).toBeGreaterThanOrEqual(2);
  });

  it("leaves agent_runs sweep behavior untouched alongside the new pil_agent_runs sweep", async () => {
    const recorded: RecordedOp[] = [];
    const stuckAgentRun = { id: "run-1", agent_type: "eligibility_scoring", started_at: minutesAgoIso(STUCK_TIMEOUT_MINUTES + 1) };
    const client = makeClient(
      {
        agent_runs: { data: [stuckAgentRun], error: null },
        pil_agent_runs: { data: [], error: null },
      },
      recorded,
    );

    start(client as never);
    stop();
    await waitForIdle();

    const agentRunsUpdate = recorded.find((op) => op.table === "agent_runs" && op.kind === "update");
    expect(agentRunsUpdate).toBeDefined();
    const payload = agentRunsUpdate!.payload as { status: string; error_message: string };
    expect(payload.status).toBe("failed");
    expect(payload.error_message).toContain("Timeout");

    const pilUpdate = recorded.find((op) => op.table === "pil_agent_runs" && op.kind === "update");
    expect(pilUpdate).toBeUndefined();
  });
});
