// AR-5.1: ai_usage_log is the single per-call cost ledger; pil_cost_ledger is
// superseded and read-only. Everything is mocked -- no real DB calls,
// matching every other src/__tests__/unit/* suite in this repo.
import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG_ID = "11111111-2222-3333-4444-555555555555";

interface RecordedInsert {
  table: string;
  payload: Record<string, unknown>;
}

function makeClient(recorded: RecordedInsert[]) {
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      insert: vi.fn((payload: Record<string, unknown>) => {
        recorded.push({ table, payload });
        return Promise.resolve({ data: null, error: null });
      }),
    };
    return c;
  };
  return { from: vi.fn((table: string) => chain(table)) };
}

vi.mock("@/lib/pil/db", () => ({ getPilClient: vi.fn() }));

describe("AR-5.1 single cost ledger consolidation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("recordCost() targets ai_usage_log and never pil_cost_ledger", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { recordCost } = await import("@/lib/pil/cost");
    const recorded: RecordedInsert[] = [];
    vi.mocked(getPilClient).mockReturnValue(makeClient(recorded) as unknown as ReturnType<typeof getPilClient>);

    await recordCost({
      organization_id: ORG_ID,
      model: "claude-haiku-4-5-20251001",
      endpoint: "model_tokens",
      input_tokens: 1000,
      output_tokens: 500,
      total_tokens: 1500,
      cost_usd: 0.0035,
      duration_ms: null,
      agent_type: "AG-15",
      agent_run_id: null,
      pil_agent_run_id: null,
      provider: "anthropic",
      billing_path: "api",
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.table).toBe("ai_usage_log");
    expect(recorded.some((r) => r.table === "pil_cost_ledger")).toBe(false);
  });

  it("a $0.0035 Haiku call round-trips without becoming 0 (DEFECT 1 guard)", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { recordCost } = await import("@/lib/pil/cost");
    const recorded: RecordedInsert[] = [];
    vi.mocked(getPilClient).mockReturnValue(makeClient(recorded) as unknown as ReturnType<typeof getPilClient>);

    // 1,000 input / 500 output tokens on claude-haiku-4-5-20251001 = $0.0035.
    // Rounded to integer cents (the old estimated_cost_cents column) this is
    // 0 -- the exact defect cost_usd numeric(14,6) exists to fix.
    const costUsd = 0.0035;
    await recordCost({
      organization_id: ORG_ID,
      model: "claude-haiku-4-5-20251001",
      endpoint: "model_tokens",
      input_tokens: 1000,
      output_tokens: 500,
      total_tokens: 1500,
      cost_usd: costUsd,
      duration_ms: null,
      agent_type: "AG-15",
      agent_run_id: null,
      pil_agent_run_id: null,
      provider: "anthropic",
      billing_path: "api",
    });

    expect(recorded).toHaveLength(1);
    const payload = recorded[0]!.payload;
    expect(payload.cost_usd).toBe(0.0035);
    expect(payload.cost_usd).not.toBe(0);
    // The defect this guards against: rounding to whole cents truncates any
    // Haiku-scale call to nothing.
    expect(Math.round((payload.cost_usd as number) * 100)).toBe(0);
  });

  it("a subscription-path row is distinguishable from an api-path row", async () => {
    const { getPilClient } = await import("@/lib/pil/db");
    const { recordCost } = await import("@/lib/pil/cost");
    const recorded: RecordedInsert[] = [];
    vi.mocked(getPilClient).mockReturnValue(makeClient(recorded) as unknown as ReturnType<typeof getPilClient>);

    await recordCost({
      organization_id: ORG_ID,
      model: "claude-sonnet-4-6",
      endpoint: "model_tokens",
      input_tokens: 2000,
      output_tokens: 1000,
      total_tokens: 3000,
      cost_usd: 0.42,
      duration_ms: null,
      agent_type: "AG-06",
      agent_run_id: null,
      pil_agent_run_id: null,
      provider: "anthropic",
      billing_path: "api",
    });
    await recordCost({
      organization_id: ORG_ID,
      model: "claude-sonnet-4-6",
      endpoint: "forge_build",
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cost_usd: 0,
      duration_ms: null,
      agent_type: null,
      agent_run_id: null,
      pil_agent_run_id: null,
      provider: "anthropic",
      billing_path: "subscription",
    });

    expect(recorded).toHaveLength(2);
    const apiRow = recorded[0]!.payload;
    const subscriptionRow = recorded[1]!.payload;
    expect(apiRow.billing_path).toBe("api");
    expect(subscriptionRow.billing_path).toBe("subscription");
    expect(apiRow.billing_path).not.toBe(subscriptionRow.billing_path);
  });
});
