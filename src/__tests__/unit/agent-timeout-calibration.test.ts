// AR-11.4: the 2026-09-16 audit found six agent types dying silently on
// BaseAgent's flat 60s AGENT_TIMEOUT_MS for months, recorded nowhere. AR-7.3
// made a timeout record its configured limit and last phase reached but
// deliberately left every timeout value unchanged — that needed the data
// this test's production code now produces. This suite proves two things
// live production data alone can't: that the three timeout classes resolve
// to the documented stall windows, and that a progressing agent is treated
// differently from a stalled one (Step 3).
import { describe, it, expect } from "vitest";
import {
  AgentError,
  BaseAgent,
  defaultStallMs,
  AGENT_TIMEOUT_MS,
  AGENT_TIMEOUT_CLAUDE_CALL_MS,
  AGENT_TIMEOUT_MULTI_STEP_MS,
  type AgentExecution,
} from "@/lib/agents/base-agent";

// --- fake Supabase client ----------------------------------------------------
// Same minimal shape as agent-error-fidelity.test.ts's fake client — every
// chain method returns the same thenable builder; awaiting it resolves to a
// fixed { data, error } response. No real database involved.

interface FakeResponse {
  data: unknown;
  error: unknown;
}

function makeBuilder(response: FakeResponse): Record<string, unknown> {
  const chainMethods = [
    "select", "eq", "neq", "order", "limit", "in", "not", "or", "gte", "lte",
    "ilike", "filter", "match", "insert", "update", "upsert", "delete",
  ];
  const builder: Record<string, unknown> = {};
  for (const method of chainMethods) builder[method] = () => builder;
  builder.single = () => Promise.resolve(response);
  builder.maybeSingle = () => Promise.resolve(response);
  builder.then = (
    resolve: (value: FakeResponse) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(response).then(resolve, reject);
  return builder;
}

class FakeSupabaseClient {
  readonly updates: Array<{ table: string; patch: Record<string, unknown> }> = [];

  from(table: string): Record<string, unknown> {
    const builder = makeBuilder({ data: { id: `${table}-fake-id` }, error: null });
    const passthroughUpdate = builder.update as (patch: unknown) => unknown;
    builder.update = (patch: Record<string, unknown>) => {
      this.updates.push({ table, patch });
      return passthroughUpdate(patch);
    };
    return builder;
  }

  lastFailedAgentRunPatch(): Record<string, unknown> | undefined {
    return this.updates
      .filter((u) => u.table === "agent_runs" && u.patch.status === "failed")
      .at(-1)?.patch;
  }
}

// --- test agent ---------------------------------------------------------------

interface TestAgentInput {
  mode: "progressing" | "stalled" | "uninstrumented-hang" | "succeed";
  /** ms between each setPhase() call, for "progressing". */
  phaseIntervalMs?: number;
  /** total ms of progress before resolving, for "progressing". */
  totalWorkMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TestAgent extends BaseAgent<TestAgentInput, null> {
  readonly agentType = "review" as const;

  protected async execute(input: TestAgentInput): Promise<AgentExecution<null>> {
    if (input.mode === "succeed") {
      this.setPhase("done");
      return { data: null, outputSummary: "ok" };
    }

    if (input.mode === "progressing") {
      const interval = input.phaseIntervalMs ?? 20;
      const total = input.totalWorkMs ?? 150;
      let elapsed = 0;
      let step = 0;
      while (elapsed < total) {
        await sleep(interval);
        elapsed += interval;
        this.setPhase(`step-${++step}`);
      }
      return { data: null, outputSummary: "completed after progressing" };
    }

    if (input.mode === "stalled") {
      // Reports exactly one phase, then goes silent forever — the stall
      // detector must catch this well before the (much larger) ceiling.
      this.setPhase("calling claude for review");
      await new Promise<never>(() => {});
      throw new Error("unreachable");
    }

    // uninstrumented-hang: never calls setPhase() at all. The stall
    // detector must stay off (no telemetry to judge staleness from) — only
    // the ceiling timer may fire, exactly like pre-AR-11.4 behavior.
    await new Promise<never>(() => {});
    throw new Error("unreachable");
  }
}

function runTestAgent(
  client: FakeSupabaseClient,
  input: TestAgentInput,
  opts: { timeoutMs?: number; stallMs?: number } = {},
): Promise<unknown> {
  const agent = new TestAgent({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: client as any,
    organizationId: "org-1",
    timeoutMs: opts.timeoutMs,
    stallMs: opts.stallMs,
  });
  return agent.run(input);
}

// --- class limits resolve correctly -------------------------------------------

describe("per-agent-class timeout limits", () => {
  it("DETERMINISTIC class: 60s ceiling, no distinct stall window", () => {
    expect(AGENT_TIMEOUT_MS).toBe(60_000);
    expect(defaultStallMs(AGENT_TIMEOUT_MS)).toBe(AGENT_TIMEOUT_MS);
  });

  it("CLAUDE_CALL class: 180s ceiling, 60s stall window", () => {
    expect(AGENT_TIMEOUT_CLAUDE_CALL_MS).toBe(180_000);
    expect(defaultStallMs(AGENT_TIMEOUT_CLAUDE_CALL_MS)).toBe(60_000);
  });

  it("MULTI_STEP class: 270s ceiling (30s under Vercel's 300s platform limit), 90s stall window", () => {
    expect(AGENT_TIMEOUT_MULTI_STEP_MS).toBe(270_000);
    expect(AGENT_TIMEOUT_MULTI_STEP_MS).toBeLessThan(300_000);
    expect(defaultStallMs(AGENT_TIMEOUT_MULTI_STEP_MS)).toBe(90_000);
  });

  it("a ceiling above the CLAUDE_CALL tier but not explicitly named still resolves to the MULTI_STEP stall window", () => {
    expect(defaultStallMs(400_000)).toBe(90_000);
  });

  it("an explicit stallMs override wins over the class default", async () => {
    const client = new FakeSupabaseClient();
    await runTestAgent(client, { mode: "succeed" }, { timeoutMs: 500, stallMs: 10 });
    // No throw means the run completed; the override didn't reject a fast run.
    expect(client.lastFailedAgentRunPatch()).toBeUndefined();
  });
});

// --- progressing vs stalled -----------------------------------------------

describe("Step 3 — a progressing agent is treated differently from a stalled one", () => {
  it("survives past its own stall threshold as long as it keeps advancing phases", async () => {
    const client = new FakeSupabaseClient();
    // stallMs (50ms) is shorter than the total progressing work (150ms across
    // 20ms steps), but each individual step is well under stallMs — so the
    // stall detector must never trip, and the run must complete normally.
    const result = await runTestAgent(
      client,
      { mode: "progressing", phaseIntervalMs: 20, totalWorkMs: 150 },
      { timeoutMs: 5_000, stallMs: 50 },
    );
    expect(result).toBeDefined();
    expect(client.lastFailedAgentRunPatch()).toBeUndefined();
  }, 10_000);

  it("kills a stalled run at the stall threshold, well before the ceiling", async () => {
    const client = new FakeSupabaseClient();
    const startedAt = Date.now();

    await expect(
      runTestAgent(client, { mode: "stalled" }, { timeoutMs: 5_000, stallMs: 60 }),
    ).rejects.toThrow(AgentError);

    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeLessThan(2_000); // nowhere near the 5s ceiling

    const patch = client.lastFailedAgentRunPatch();
    const message = String(patch?.error_message ?? "");
    expect(message).toContain("stalled");
    expect(message).toContain("calling claude for review");
    expect(message).toContain("ceiling=5000ms not yet reached");
  }, 10_000);

  it("an agent that never reports a phase is not killed early — only the ceiling fires", async () => {
    const client = new FakeSupabaseClient();
    const startedAt = Date.now();

    await expect(
      runTestAgent(client, { mode: "uninstrumented-hang" }, { timeoutMs: 100, stallMs: 20 }),
    ).rejects.toThrow(AgentError);

    const elapsed = Date.now() - startedAt;
    // Must run the full ceiling, not the (much shorter) stall window — proof
    // the stall detector stayed off for an agent with no phase telemetry.
    expect(elapsed).toBeGreaterThanOrEqual(95);

    const patch = client.lastFailedAgentRunPatch();
    const message = String(patch?.error_message ?? "");
    expect(message).toContain("timed out");
    expect(message).not.toContain("stalled");
  }, 10_000);
});
