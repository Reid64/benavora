import { describe, it, expect } from "vitest";
import { computeFundingPotentialScan } from "@/lib/scan/scoring-engine";

function createSupabaseMock(data: Record<string, unknown>[] | null, error: unknown = null) {
  const builder: Record<string, unknown> = {};
  const chainMethods = ["select", "eq", "limit"];
  for (const method of chainMethods) {
    builder[method] = () => builder;
  }
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve, reject);

  return { from: () => builder } as any;
}

describe("computeFundingPotentialScan", () => {
  it("degrades gracefully when the opportunities table has no rows at all", async () => {
    const supabase = createSupabaseMock([]);

    const result = await computeFundingPotentialScan(
      {
        primaryMission: "Affordable housing for veterans",
        fundingPriority: "capital_campaign",
        state: "CA",
      },
      supabase,
    );

    expect(result.degraded).toBe(true);
    expect(result.poolSize).toBe(0);
    expect(result.matchedCount).toBe(0);
    expect(result.amountRange).toBeNull();
    expect(result.score).toBeLessThan(50);
    // Category-level guidance still fires because "housing" is recognized,
    // even though there is zero real data to back it.
    expect(result.categoriesConsidered).toContain("Housing Grant");
    expect(result.guidance.join(" ")).not.toMatch(/\$/); // never cites a dollar figure with no real data
    expect(result.guidance.some((g) => g.includes("still being populated"))).toBe(true);
  });

  it("degrades gracefully when the mission has no recognizable category keyword", async () => {
    const supabase = createSupabaseMock([
      { category: "housing_grant", geographic_restrictions: null, amount_min: 5000, amount_max: 20000 },
    ]);

    const result = await computeFundingPotentialScan(
      {
        primaryMission: "We do good things for people",
        fundingPriority: "general_operating",
        state: "TX",
      },
      supabase,
    );

    expect(result.degraded).toBe(true);
    expect(result.categoriesConsidered).toEqual([]);
    expect(result.matchedCount).toBe(0);
    expect(result.amountRange).toBeNull();
    // No fabricated funder name or invented figure - only generic guidance.
    expect(result.guidance[0]).toMatch(/General guidance/i);
  });

  it("degrades gracefully when real matches exist but are too few for confidence", async () => {
    const supabase = createSupabaseMock([
      { category: "housing_grant", geographic_restrictions: "California", amount_min: 10000, amount_max: 50000 },
      { category: "education_grant", geographic_restrictions: null, amount_min: null, amount_max: null },
    ]);

    const result = await computeFundingPotentialScan(
      {
        primaryMission: "Affordable housing for veterans",
        fundingPriority: "capital_campaign",
        state: "CA",
      },
      supabase,
    );

    // Pool size (2) is below MIN_POOL_SIZE_FOR_CONFIDENCE regardless of the
    // single relevant+geo-matched housing row, so this must stay degraded.
    expect(result.degraded).toBe(true);
    expect(result.matchedCount).toBe(1);
    expect(result.amountRange).toBeNull();
    expect(result.categoriesConsidered).toContain("Housing Grant");
  });

  it("returns a confident, non-degraded score with real aggregated data when matches are plentiful", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      category: "housing_grant",
      geographic_restrictions: i % 2 === 0 ? "California" : null,
      amount_min: 10000 + i * 1000,
      amount_max: 50000 + i * 1000,
    }));
    const supabase = createSupabaseMock(rows);

    const result = await computeFundingPotentialScan(
      {
        primaryMission: "Affordable housing for veterans in California",
        fundingPriority: "capital_campaign",
        state: "CA",
      },
      supabase,
    );

    expect(result.degraded).toBe(false);
    expect(result.poolSize).toBe(10);
    expect(result.matchedCount).toBe(10);
    expect(result.amountRange).not.toBeNull();
    expect(result.amountRange!.min).toBe(10000);
    expect(result.amountRange!.max).toBe(59000);
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.guidance.some((g) => g.includes("$10,000") && g.includes("$59,000"))).toBe(true);
    // Never a specific funder name anywhere in the guidance.
    for (const g of result.guidance) {
      expect(g).not.toMatch(/Foundation\b|Fund\b|Trust\b/);
    }
  });

  it("excludes rows whose stated geographic restriction excludes the submitter's state", async () => {
    const supabase = createSupabaseMock([
      { category: "housing_grant", geographic_restrictions: "New York only", amount_min: 1000, amount_max: 2000 },
      { category: "housing_grant", geographic_restrictions: "New York only", amount_min: 1000, amount_max: 2000 },
      { category: "housing_grant", geographic_restrictions: "New York only", amount_min: 1000, amount_max: 2000 },
      { category: "housing_grant", geographic_restrictions: "New York only", amount_min: 1000, amount_max: 2000 },
      { category: "housing_grant", geographic_restrictions: "New York only", amount_min: 1000, amount_max: 2000 },
      { category: "housing_grant", geographic_restrictions: "New York only", amount_min: 1000, amount_max: 2000 },
      { category: "housing_grant", geographic_restrictions: "New York only", amount_min: 1000, amount_max: 2000 },
      { category: "housing_grant", geographic_restrictions: "New York only", amount_min: 1000, amount_max: 2000 },
    ]);

    const result = await computeFundingPotentialScan(
      {
        primaryMission: "Affordable housing for veterans",
        fundingPriority: "capital_campaign",
        state: "CA",
      },
      supabase,
    );

    expect(result.poolSize).toBe(8);
    expect(result.matchedCount).toBe(0);
    expect(result.degraded).toBe(true);
    expect(result.amountRange).toBeNull();
  });

  it("propagates a query failure instead of silently returning a score", async () => {
    const supabase = createSupabaseMock(null, { message: "connection reset" });

    await expect(
      computeFundingPotentialScan(
        { primaryMission: "Housing for veterans", fundingPriority: "capital_campaign", state: "CA" },
        supabase,
      ),
    ).rejects.toThrow(/connection reset/);
  });
});
