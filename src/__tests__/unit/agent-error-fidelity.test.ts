// AR-7.3: core agents (src/lib/agents/**) wrote fixed, human-readable error
// strings to agent_runs.error_message while discarding the real caught
// error - live production data showed success_probability failing 100/144
// runs with the identical, diagnosis-free string "Failed to save
// probability score." on every single failure. This suite exercises
// BaseAgent's run()/withTimeout() plumbing (base-agent.ts) directly, with a
// fake Supabase client capturing every agent_runs write, to prove:
//   1. A Postgres error's code/constraint/message survive into
//      agent_runs.error_message instead of being replaced by a fixed string.
//   2. Anything secret-shaped in that error is redacted before it's
//      persisted (reusing AR-6.2's redactSecrets(), not a second copy).
//   3. A timeout records its configured limit and the last phase the agent
//      reported reaching, not a bare "timed out" string.
import { describe, it, expect } from "vitest";
import {
  AgentError,
  BaseAgent,
  causeOf,
  withCause,
  type AgentExecution,
} from "@/lib/agents/base-agent";

// --- fake Supabase client ----------------------------------------------------
// Generic enough to satisfy BaseAgent.logStart/update AND
// trackUsage()'s usage_metrics read/write, without a real database: every
// chain method returns the same thenable builder, and awaiting it (directly,
// or via .single()/.maybeSingle()) resolves to that table's configured
// response.

interface FakeResponse {
  data: unknown;
  error: unknown;
}

function makeBuilder(response: FakeResponse): Record<string, unknown> {
  const chainMethods = [
    "select",
    "eq",
    "neq",
    "order",
    "limit",
    "in",
    "not",
    "or",
    "gte",
    "lte",
    "ilike",
    "filter",
    "match",
    "insert",
    "update",
    "upsert",
    "delete",
  ];
  const builder: Record<string, unknown> = {};
  for (const method of chainMethods) {
    builder[method] = () => builder;
  }
  builder.single = () => Promise.resolve(response);
  builder.maybeSingle = () => Promise.resolve(response);
  builder.then = (
    resolve: (value: FakeResponse) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(response).then(resolve, reject);
  return builder;
}

class FakeSupabaseClient {
  /** Every patch object passed to `.from(table).update(patch)`, in order. */
  readonly updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  private readonly tableResponses: Record<string, FakeResponse>;

  constructor(tableResponses: Record<string, FakeResponse> = {}) {
    this.tableResponses = tableResponses;
  }

  from(table: string): Record<string, unknown> {
    const response = this.tableResponses[table] ?? {
      data: { id: `${table}-fake-id` },
      error: null,
    };
    const builder = makeBuilder(response);
    const passthroughUpdate = builder.update as (patch: unknown) => unknown;
    builder.update = (patch: Record<string, unknown>) => {
      this.updates.push({ table, patch });
      return passthroughUpdate(patch);
    };
    return builder;
  }

  /** The last agent_runs row patched to status='failed', if any. */
  lastFailedAgentRunPatch(): Record<string, unknown> | undefined {
    return this.updates
      .filter((u) => u.table === "agent_runs" && u.patch.status === "failed")
      .at(-1)?.patch;
  }
}

// --- test agent ---------------------------------------------------------------

interface TestAgentInput {
  mode: "throw-postgres-error" | "throw-secret-error" | "hang-past-timeout";
}

class TestAgent extends BaseAgent<TestAgentInput, null> {
  readonly agentType = "review" as const;

  protected async execute(
    input: TestAgentInput,
  ): Promise<AgentExecution<null>> {
    if (input.mode === "throw-postgres-error") {
      this.setPhase("saving probability score");
      const pgError = {
        code: "23505",
        constraint: "success_probability_scores_application_id_key",
        message: "duplicate key value violates unique constraint",
        details: "Key (application_id)=(abc-123) already exists.",
      };
      throw new AgentError(
        withCause("Failed to save probability score.", pgError),
        "write_failed",
      );
    }

    if (input.mode === "throw-secret-error") {
      const pgError = {
        code: "08001",
        message:
          "connection failed: postgres://user:sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@host/db",
      };
      throw new AgentError(withCause("Failed to connect.", pgError), "db_error");
    }

    // hang-past-timeout: report a phase, then never resolve — withTimeout's
    // race must win with a rejection before this promise ever settles.
    this.setPhase("calling claude for review");
    await new Promise<never>(() => {});
    throw new Error("unreachable");
  }
}

function runTestAgent(
  client: FakeSupabaseClient,
  input: TestAgentInput,
  timeoutMs?: number,
): Promise<unknown> {
  const agent = new TestAgent({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: client as any,
    organizationId: "org-1",
    timeoutMs,
  });
  return agent.run(input);
}

// --- causeOf/withCause unit coverage ------------------------------------------

describe("causeOf/withCause", () => {
  it("extracts code, constraint, message, details, hint from a Postgrest-shaped error", () => {
    const cause = causeOf({
      code: "23505",
      constraint: "success_probability_scores_application_id_key",
      message: "duplicate key value violates unique constraint",
      details: "Key already exists.",
      hint: "Use UPDATE instead.",
    });
    expect(cause).toContain("code=23505");
    expect(cause).toContain("constraint=success_probability_scores_application_id_key");
    expect(cause).toContain("duplicate key value violates unique constraint");
    expect(cause).toContain("details=Key already exists.");
    expect(cause).toContain("hint=Use UPDATE instead.");
  });

  it("falls back to a plain Error's message when no Postgrest fields are present", () => {
    expect(causeOf(new Error("boom"))).toBe("boom");
  });

  it("returns empty string for null/undefined (withCause then returns just the human message)", () => {
    expect(causeOf(null)).toBe("");
    expect(withCause("Failed.", null)).toBe("Failed.");
  });

  it("redacts a secret-shaped value inside the cause", () => {
    const cause = causeOf({ message: "auth failed with api_key=sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" });
    expect(cause).not.toContain("sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(cause).toContain("[REDACTED]");
  });
});

// --- assertion 1: Postgres error survives into agent_runs.error_message ------

describe("assertion 1 — a Postgres error's code and constraint reach agent_runs.error_message", () => {
  it("preserves code and constraint instead of a diagnosis-free fixed string", async () => {
    const client = new FakeSupabaseClient();
    await expect(
      runTestAgent(client, { mode: "throw-postgres-error" }),
    ).rejects.toThrow(AgentError);

    const patch = client.lastFailedAgentRunPatch();
    expect(patch).toBeDefined();
    const message = String(patch?.error_message ?? "");

    // The old behavior this regresses against: a bare fixed string with zero
    // diagnostic value, e.g. "Failed to save probability score." alone.
    expect(message).toContain("Failed to save probability score.");
    expect(message).toContain("23505");
    expect(message).toContain("success_probability_scores_application_id_key");
    expect(message).toContain("duplicate key value violates unique constraint");
  });
});

// --- assertion 2: secret-shaped values are redacted before persisting --------

describe("assertion 2 — an API-key-shaped value in an error is persisted redacted", () => {
  it("never writes the raw key to agent_runs.error_message", async () => {
    const client = new FakeSupabaseClient();
    await expect(
      runTestAgent(client, { mode: "throw-secret-error" }),
    ).rejects.toThrow(AgentError);

    const patch = client.lastFailedAgentRunPatch();
    const message = String(patch?.error_message ?? "");

    expect(message).not.toContain("sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(message).toContain("[REDACTED]");
    // The human-readable part and the real connection failure code must
    // still survive — redaction removes the secret, not the diagnosis.
    expect(message).toContain("Failed to connect.");
    expect(message).toContain("08001");
  });
});

// --- assertion 3: a timeout records the limit and the phase reached ----------

describe("assertion 3 — a timeout records its configured limit and last-known phase", () => {
  it("is not a bare 'timed out' string", async () => {
    const client = new FakeSupabaseClient();
    const TIMEOUT_MS = 50;

    await expect(
      runTestAgent(client, { mode: "hang-past-timeout" }, TIMEOUT_MS),
    ).rejects.toThrow(AgentError);

    const patch = client.lastFailedAgentRunPatch();
    const message = String(patch?.error_message ?? "");

    expect(message).toContain("timed out");
    expect(message).toContain(`limit=${TIMEOUT_MS}ms`);
    expect(message).toContain("calling claude for review");
  }, 10_000);
});
