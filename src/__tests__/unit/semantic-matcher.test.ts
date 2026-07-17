import { describe, it, expect, vi } from "vitest";
import { matchFunders } from "@/lib/intelligence/semantic-matcher";

function createSupabaseMock(data: Record<string, unknown>[] | null) {
  const builder: Record<string, unknown> = {};
  const chainMethods = ["select", "not", "limit", "gte", "lte", "eq"];
  for (const method of chainMethods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data }).then(resolve, reject);

  return { from: vi.fn(() => builder) };
}

describe("matchFunders", () => {
  it("returns an empty array when no foundations exist", async () => {
    const supabase = createSupabaseMock([]);

    const result = await matchFunders(
      "We help homeless veterans find stable housing.",
      {},
      supabase,
    );

    expect(result).toEqual([]);
  });

  it("returns an empty array when the query resolves with null data", async () => {
    const supabase = createSupabaseMock(null);

    const result = await matchFunders("Rural housing for veterans.", {}, supabase);

    expect(result).toEqual([]);
  });

  it("returns scores that are always between 0 and 1", async () => {
    const foundations = [
      {
        id: "f1",
        name: "Veterans Housing Foundation",
        ein: "11-1111111",
        asset_amount: 5_000_000,
        state: "TX",
        enrichment: { funding_categories: ["veterans", "housing"] },
      },
      {
        id: "f2",
        name: "Arts and Culture Council",
        ein: "22-2222222",
        asset_amount: 2_000_000,
        state: "CA",
        enrichment: { funding_categories: ["arts", "culture"] },
      },
    ];
    const supabase = createSupabaseMock(foundations);

    const result = await matchFunders(
      "We help homeless veterans find stable housing in Texas.",
      { state: "TX" },
      supabase,
    );

    expect(result.length).toBeGreaterThan(0);
    for (const match of result) {
      expect(match.score).toBeGreaterThanOrEqual(0);
      expect(match.score).toBeLessThanOrEqual(1);
    }
    // The keyword + state match should sort the closer foundation first.
    expect(result[0]?.id).toBe("f1");
  });
});
