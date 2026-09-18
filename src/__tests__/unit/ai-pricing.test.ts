// AR-9.2: computeCostUsd() must return null -- never 0 -- for a model with
// no row in model_cost_reference, and must correctly price a model that is
// seeded (migration 192). A silent 0 there is indistinguishable from a real
// free call, which is exactly the ambiguity this exists to remove.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

function mockSelect(rows: unknown[] | null, error: unknown = null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(async () => ({ data: rows, error })),
    })),
  };
}

describe("AR-9.2: computeCostUsd", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it("prices a seeded model using input/output token rates", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(
      mockSelect([
        { model: "claude-sonnet-4-6", input_usd_per_mtok: "3.00", output_usd_per_mtok: "15.00" },
      ]) as unknown as ReturnType<typeof createAdminClient>,
    );

    const { computeCostUsd } = await import("@/lib/ai/pricing");
    const cost = await computeCostUsd("claude-sonnet-4-6", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(18.0, 6);
  });

  it("returns null (not 0) for a model absent from model_cost_reference", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(
      mockSelect([
        { model: "claude-sonnet-4-6", input_usd_per_mtok: "3.00", output_usd_per_mtok: "15.00" },
      ]) as unknown as ReturnType<typeof createAdminClient>,
    );

    const { computeCostUsd } = await import("@/lib/ai/pricing");
    const cost = await computeCostUsd("some-future-model-not-seeded", 1000, 1000);
    expect(cost).toBeNull();
  });

  it("falls back to an empty (all-unpriced) map instead of throwing when the query errors", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(
      mockSelect(null, new Error("connection refused")) as unknown as ReturnType<typeof createAdminClient>,
    );

    const { computeCostUsd } = await import("@/lib/ai/pricing");
    await expect(computeCostUsd("claude-sonnet-4-6", 1000, 1000)).resolves.toBeNull();
  });
});
