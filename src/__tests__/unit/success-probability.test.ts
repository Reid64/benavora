import { describe, it, expect, vi } from "vitest";
import { addDays } from "date-fns";
import { computeSuccessProbability } from "@/lib/intelligence/success-probability";

interface MockOpportunity {
  id: string;
  category: string | null;
  deadline: string | null;
  eligibility_score: number | null;
}

function makeThenable(result: unknown, extraMethods: string[] = []) {
  const builder: Record<string, unknown> = {};
  const chainMethods = [
    "select",
    "eq",
    "neq",
    "gt",
    "lt",
    "gte",
    "lte",
    "in",
    "is",
    "not",
    "order",
    "limit",
    ...extraMethods,
  ];
  for (const method of chainMethods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function createSupabaseMock(opts: {
  opportunity: MockOpportunity | null;
  opportunityError?: unknown;
  outcomes?: { result: string }[] | null;
  kbCount?: number;
}) {
  const {
    opportunity,
    opportunityError = null,
    outcomes = null,
    kbCount = 0,
  } = opts;

  const opportunitiesBuilder: Record<string, unknown> = {
    select: vi.fn(() => opportunitiesBuilder),
    eq: vi.fn(() => opportunitiesBuilder),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({ data: opportunity, error: opportunityError }),
  };

  const outcomesBuilder = makeThenable({ data: outcomes });
  const kbBuilder = makeThenable({ count: kbCount });

  return {
    from: vi.fn((table: string) => {
      if (table === "opportunities") return opportunitiesBuilder;
      if (table === "outcomes") return outcomesBuilder;
      if (table === "knowledge_base") return kbBuilder;
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

describe("computeSuccessProbability", () => {
  it("returns a score between 0 and 100 when all factors have real data", async () => {
    const supabase = createSupabaseMock({
      opportunity: {
        id: "opp-1",
        category: "housing",
        deadline: addDays(new Date(), 40).toISOString(),
        eligibility_score: 80,
      },
      outcomes: [{ result: "awarded" }, { result: "denied" }],
      kbCount: 5,
    });

    const result = await computeSuccessProbability("org-1", "opp-1", supabase);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(Number.isInteger(result.score)).toBe(true);
  });

  it("defaults the category_success_rate factor to 0.5 when there is no outcomes history", async () => {
    const supabase = createSupabaseMock({
      opportunity: {
        id: "opp-1",
        category: "housing",
        deadline: addDays(new Date(), 40).toISOString(),
        eligibility_score: 80,
      },
      outcomes: [],
      kbCount: 5,
    });

    const result = await computeSuccessProbability("org-1", "opp-1", supabase);
    const categoryFactor = result.factors.find(
      (f) => f.name === "category_success_rate",
    );

    expect(categoryFactor?.value).toBe(0.5);
  });

  it("returns a deadline_proximity factor value of 0 when the deadline is under 15 days away", async () => {
    const supabase = createSupabaseMock({
      opportunity: {
        id: "opp-1",
        category: "housing",
        deadline: addDays(new Date(), 10).toISOString(),
        eligibility_score: 80,
      },
      outcomes: [{ result: "awarded" }],
      kbCount: 5,
    });

    const result = await computeSuccessProbability("org-1", "opp-1", supabase);
    const deadlineFactor = result.factors.find(
      (f) => f.name === "deadline_proximity",
    );

    expect(deadlineFactor?.value).toBe(0);
  });

  it("reports confidence 'high' when all four factors have real underlying data", async () => {
    const supabase = createSupabaseMock({
      opportunity: {
        id: "opp-1",
        category: "housing",
        deadline: addDays(new Date(), 40).toISOString(),
        eligibility_score: 80,
      },
      outcomes: [{ result: "awarded" }, { result: "denied" }],
      kbCount: 5,
    });

    const result = await computeSuccessProbability("org-1", "opp-1", supabase);

    expect(result.confidence).toBe("high");
  });

  it("throws when the opportunity is not found", async () => {
    const supabase = createSupabaseMock({ opportunity: null });

    await expect(
      computeSuccessProbability("org-1", "missing-opp", supabase),
    ).rejects.toThrow("Opportunity not found.");
  });
});
