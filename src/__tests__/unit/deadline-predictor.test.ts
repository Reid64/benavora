import { describe, it, expect, vi, afterEach } from "vitest";
import { differenceInCalendarDays } from "date-fns";
import { predictDeadlines } from "@/lib/intelligence/deadline-predictor";

interface MockOpportunity {
  id: string;
  name: string;
  funder_id: string | null;
  category: string | null;
}

interface MockFunderDeadline {
  funder_id: string | null;
  deadline: string | null;
}

function makeThenable(result: unknown) {
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
  ];
  for (const method of chainMethods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

/**
 * predictDeadlines queries the `opportunities` table twice in sequence: first
 * for undated rows, then (only if any have a funder_id) for that funder's
 * dated history. This mock returns `undated` on the first call to
 * `.from("opportunities")` and `dated` on the second.
 */
function createSupabaseMock(opts: {
  undated: MockOpportunity[];
  dated?: MockFunderDeadline[];
}) {
  const { undated, dated = [] } = opts;
  let opportunitiesCallCount = 0;

  return {
    from: vi.fn((table: string) => {
      if (table !== "opportunities") throw new Error(`Unexpected table: ${table}`);
      opportunitiesCallCount += 1;
      return opportunitiesCallCount === 1
        ? makeThenable({ data: undated })
        : makeThenable({ data: dated });
    }),
  };
}

describe("predictDeadlines", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an empty array and does not query funder history when there are no undated opportunities", async () => {
    const supabase = createSupabaseMock({ undated: [] });

    const result = await predictDeadlines("org-1", supabase);

    expect(result).toEqual([]);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("predicts from funder history by averaging day-of-year across past deadlines", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const supabase = createSupabaseMock({
      undated: [
        { id: "opp-1", name: "Spring Grant", funder_id: "funder-1", category: "private_foundation" },
      ],
      dated: [
        { funder_id: "funder-1", deadline: "2023-03-15T00:00:00.000Z" },
        { funder_id: "funder-1", deadline: "2025-03-15T00:00:00.000Z" },
      ],
    });

    const result = await predictDeadlines("org-1", supabase);

    expect(result).toHaveLength(1);
    expect(result[0].opportunityId).toBe("opp-1");
    expect(result[0].opportunityTitle).toBe("Spring Grant");
    expect(result[0].predictedDeadline).toBe("2026-03-15");
    expect(result[0].confidence).toBeCloseTo(0.7);
    expect(result[0].basis).toContain("2 past deadlines");
  });

  it("caps funder-history confidence at 0.9 regardless of sample size", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const dated: MockFunderDeadline[] = Array.from({ length: 6 }, (_, i) => ({
      funder_id: "funder-1",
      deadline: `${2018 + i}-03-15T00:00:00.000Z`,
    }));

    const supabase = createSupabaseMock({
      undated: [{ id: "opp-1", name: "Recurring Grant", funder_id: "funder-1", category: null }],
      dated,
    });

    const result = await predictDeadlines("org-1", supabase);

    expect(result[0].confidence).toBe(0.9);
  });

  it("defaults government_grant opportunities with no funder history to fiscal year-end (Sept 30) at confidence 0.4", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const supabase = createSupabaseMock({
      undated: [{ id: "opp-1", name: "Federal Grant", funder_id: null, category: "government_grant" }],
    });

    const result = await predictDeadlines("org-1", supabase);

    expect(result[0].predictedDeadline).toBe("2026-09-30");
    expect(result[0].confidence).toBe(0.4);
    expect(result[0].basis).toContain("fiscal year-end");
  });

  it("defaults private_foundation opportunities with no funder history to the nearest quarter end at confidence 0.3", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const supabase = createSupabaseMock({
      undated: [{ id: "opp-1", name: "Foundation Grant", funder_id: null, category: "private_foundation" }],
    });

    const result = await predictDeadlines("org-1", supabase);

    expect(result[0].predictedDeadline).toBe("2026-03-31");
    expect(result[0].confidence).toBe(0.3);
  });

  it("defaults corporate_* categories with no funder history to a 90-day rolling estimate", async () => {
    vi.useFakeTimers();
    const today = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(today);

    const supabase = createSupabaseMock({
      undated: [{ id: "opp-1", name: "Corporate Sponsorship", funder_id: null, category: "corporate_sponsorship" }],
    });

    const result = await predictDeadlines("org-1", supabase);

    expect(differenceInCalendarDays(new Date(`${result[0].predictedDeadline}T00:00:00.000Z`), today)).toBe(90);
    expect(result[0].confidence).toBe(0.2);
  });

  it("falls back to a low-confidence 90-day rolling estimate for unrecognized or missing categories", async () => {
    vi.useFakeTimers();
    const today = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(today);

    const supabase = createSupabaseMock({
      undated: [{ id: "opp-1", name: "Unknown Category Grant", funder_id: null, category: null }],
    });

    const result = await predictDeadlines("org-1", supabase);

    expect(differenceInCalendarDays(new Date(`${result[0].predictedDeadline}T00:00:00.000Z`), today)).toBe(90);
    expect(result[0].confidence).toBe(0.15);
  });

  it("returns results sorted by predicted deadline ascending", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const supabase = createSupabaseMock({
      undated: [
        { id: "opp-gov", name: "Gov Grant", funder_id: null, category: "government_grant" }, // Sept 30
        { id: "opp-priv", name: "Foundation Grant", funder_id: null, category: "private_foundation" }, // Mar 31
      ],
    });

    const result = await predictDeadlines("org-1", supabase);

    expect(result.map((r) => r.opportunityId)).toEqual(["opp-priv", "opp-gov"]);
    expect(result[0].predictedDeadline < result[1].predictedDeadline).toBe(true);
  });

  it("falls back to the category default when the opportunity has a funder_id but that funder has no dated history", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const supabase = createSupabaseMock({
      undated: [{ id: "opp-1", name: "New Funder Grant", funder_id: "funder-unseen", category: "government_grant" }],
      dated: [],
    });

    const result = await predictDeadlines("org-1", supabase);

    expect(result[0].predictedDeadline).toBe("2026-09-30");
    expect(result[0].confidence).toBe(0.4);
  });
});
