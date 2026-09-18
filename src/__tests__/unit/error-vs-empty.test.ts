// AR-11.2: AR-7.3 fixed 16 sites that discarded a caught error's real cause.
// It explicitly left open a broader, related defect: the `if (error || !data)`
// pattern, which treats a genuine database failure and a legitimate empty
// result as the same outcome — a broken query silently reports "not found"
// (or "nothing to do") and the caller carries on none the wiser. This suite
// exercises one real, fixed call site (refreshPriorityRanking, AG-22) end to
// end with a fake Supabase client to prove a DB error and a genuine empty
// result now produce materially different outcomes (throw vs. resolve) and
// materially different log behavior (console.error vs. silence).
import { describe, it, expect, vi, afterEach } from "vitest";

import {
  AgentError,
  causeOf,
  withCause,
} from "@/lib/agents/base-agent";
import { refreshPriorityRanking } from "@/lib/agents/ag-22-propensity-scoring";

// --- fake Supabase client ----------------------------------------------------
// refreshPriorityRanking does: client.from(...).select(...).not(...).limit(...)
// with no terminal .single()/.maybeSingle() — every chain method returns the
// same thenable builder, and awaiting it resolves to the configured response.

interface FakeResponse {
  data: unknown;
  error: unknown;
}

function makeFakeClient(response: FakeResponse): unknown {
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "select", "not", "limit", "eq", "order"]) {
    builder[method] = () => builder;
  }
  builder.then = (
    resolve: (value: FakeResponse) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(response).then(resolve, reject);
  return builder;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("error vs. empty — refreshPriorityRanking (AG-22)", () => {
  it("a genuine database error throws a distinct AgentError carrying its real cause, and logs via console.error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const pgError = {
      code: "57014",
      message: "canceling statement due to statement timeout",
    };
    const client = makeFakeClient({ data: null, error: pgError });

    await expect(refreshPriorityRanking(client as never)).rejects.toThrow(
      AgentError,
    );

    let caught: unknown;
    try {
      await refreshPriorityRanking(client as never);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AgentError);
    const agentError = caught as AgentError;
    expect(agentError.code).toBe("db_error");
    // The real Postgres cause must survive into the thrown message — this is
    // the exact defect: a broken query must never be indistinguishable from
    // "nothing to update."
    expect(agentError.message).toContain("57014");
    expect(agentError.message).toContain(
      "canceling statement due to statement timeout",
    );

    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("57014");
  });

  it("a genuine empty result resolves normally with zero counts, and never calls console.error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = makeFakeClient({ data: [], error: null });

    const result = await refreshPriorityRanking(client as never);

    expect(result).toEqual({ scanned: 0, updated: 0 });
    // Legitimate emptiness is not a failure — it must not be logged as one.
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

// --- causeOf/withCause direct coverage (the helpers this sweep reuses) -------

describe("causeOf/withCause continue to distinguish a real cause from nothing", () => {
  it("extracts a Postgrest error's diagnostic fields", () => {
    const cause = causeOf({ code: "57014", message: "statement timeout" });
    expect(cause).toContain("code=57014");
    expect(cause).toContain("statement timeout");
  });

  it("produces an empty cause for a genuinely absent error, so withCause is a no-op", () => {
    expect(causeOf(null)).toBe("");
    expect(withCause("Nothing to update.", null)).toBe("Nothing to update.");
  });
});
