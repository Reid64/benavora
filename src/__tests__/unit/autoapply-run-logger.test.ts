// AR-1.2: proves src/lib/autoapply/run-logger.ts's withAgentRun() gives the
// AutoApply worker pipeline the same running -> completed/failed contract
// BaseAgent.run() gives every other Benavora agent (see base-agent.ts),
// without depending on BaseAgent (out of worker/tsconfig.json's build scope).
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withAgentRun } from "@/lib/autoapply/run-logger";

interface RecordedCall {
  method: "insert" | "update" | "eq" | "single";
  table: string;
  payload?: unknown;
}

interface MockOptions {
  insertError?: { message: string } | null;
  insertThrows?: boolean;
  updateError?: { message: string } | null;
  updateThrows?: boolean;
  insertId?: string | null;
}

function makeSupabase(opts: MockOptions = {}) {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      insert: vi.fn((payload: unknown) => {
        calls.push({ method: "insert", table, payload });
        return builder;
      }),
      select: vi.fn(() => builder),
      single: vi.fn(() => {
        calls.push({ method: "single", table });
        if (opts.insertThrows) return Promise.reject(new Error("insert threw"));
        return Promise.resolve({
          data: opts.insertId === null ? null : { id: opts.insertId ?? "run-1" },
          error: opts.insertError ?? null,
        });
      }),
      update: vi.fn((payload: unknown) => {
        calls.push({ method: "update", table, payload });
        return builder;
      }),
      eq: vi.fn(() => {
        calls.push({ method: "eq", table });
        if (opts.updateThrows) return Promise.reject(new Error("update threw"));
        return Promise.resolve({ error: opts.updateError ?? null });
      }),
    };
    return builder;
  });

  return { client: { from } as unknown as SupabaseClient, calls };
}

describe("withAgentRun", () => {
  it("inserts a running row before work starts", async () => {
    const { client, calls } = makeSupabase();
    const order: string[] = [];

    const result = await withAgentRun(
      { supabase: client, agentType: "autoapply_form_analyzer", organizationId: "org-1" },
      async () => {
        order.push("work");
        return "done";
      },
    );

    expect(result).toBe("done");
    expect(order).toEqual(["work"]);

    const insertCall = calls.find((c) => c.method === "insert");
    expect(insertCall).toBeDefined();
    const payload = insertCall!.payload as Record<string, unknown>;
    expect(payload.organization_id).toBe("org-1");
    expect(payload.agent_type).toBe("autoapply_form_analyzer");
    expect(payload.status).toBe("running");

    // The insert must have been issued strictly before work() ran.
    const insertIndex = calls.findIndex((c) => c.method === "insert");
    expect(insertIndex).toBe(0);
  });

  it("updates the run row to completed on success", async () => {
    const { client, calls } = makeSupabase();

    await withAgentRun(
      { supabase: client, agentType: "autoapply_risk_engine", organizationId: "org-1" },
      async () => ({ score: 10 }),
    );

    const updateCall = calls.find((c) => c.method === "update");
    expect(updateCall).toBeDefined();
    const payload = updateCall!.payload as Record<string, unknown>;
    expect(payload.status).toBe("completed");
    expect(typeof payload.duration_ms).toBe("number");
    expect(typeof payload.output_summary).toBe("string");
    expect(payload.completed_at).toBeDefined();
  });

  it("updates the run row to failed and rethrows the original error on a throw", async () => {
    const { client, calls } = makeSupabase();
    const originalError = new Error("boom");

    await expect(
      withAgentRun(
        { supabase: client, agentType: "autoapply_form_filler", organizationId: "org-1" },
        async () => {
          throw originalError;
        },
      ),
    ).rejects.toBe(originalError);

    const updateCall = calls.find((c) => c.method === "update");
    expect(updateCall).toBeDefined();
    const payload = updateCall!.payload as Record<string, unknown>;
    expect(payload.status).toBe("failed");
    expect(payload.error_message).toBe("boom");
  });

  it("does not break the wrapped work when the insert fails", async () => {
    const { client } = makeSupabase({ insertError: { message: "insert failed" } });

    const result = await withAgentRun(
      { supabase: client, agentType: "autoapply_receipt", organizationId: "org-1" },
      async () => "still works",
    );

    expect(result).toBe("still works");
  });

  it("does not break the wrapped work when the insert throws", async () => {
    const { client } = makeSupabase({ insertThrows: true });

    const result = await withAgentRun(
      { supabase: client, agentType: "autoapply_receipt", organizationId: "org-1" },
      async () => "still works",
    );

    expect(result).toBe("still works");
  });

  it("does not break the wrapped work or mask a real error when the completion update fails", async () => {
    const { client } = makeSupabase({ updateThrows: true });

    const result = await withAgentRun(
      { supabase: client, agentType: "autoapply_captcha_solver", organizationId: "org-1" },
      async () => "still works",
    );
    expect(result).toBe("still works");

    const originalError = new Error("real failure");
    await expect(
      withAgentRun(
        { supabase: client, agentType: "autoapply_captcha_solver", organizationId: "org-1" },
        async () => {
          throw originalError;
        },
      ),
    ).rejects.toBe(originalError);
  });

  it("still runs and returns correctly when no run id was created (insert returned null)", async () => {
    const { client, calls } = makeSupabase({ insertId: null });

    const result = await withAgentRun(
      { supabase: client, agentType: "autoapply_confirmation_parser", organizationId: "org-1" },
      async () => "value",
    );

    expect(result).toBe("value");
    // No update should be attempted against a null run id.
    expect(calls.find((c) => c.method === "update")).toBeUndefined();
  });
});
