import { describe, it, expect, vi } from "vitest";
import { addDays, subDays } from "date-fns";
import { computeGrantProbability } from "@/lib/intelligence/grant-probability-engine";

interface MockOpportunity {
  id: string;
  category: string | null;
  deadline: string | null;
  eligibility_score: number | null;
}

interface MockTwin {
  twin_completeness_score: number | null;
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

function createSupabaseMock(opts: {
  opportunity: MockOpportunity | null;
  opportunityError?: unknown;
  twin?: MockTwin | null;
  outcomes?: { result: string }[] | null;
  upsertError?: unknown;
}) {
  const {
    opportunity,
    opportunityError = null,
    twin = null,
    outcomes = null,
    upsertError = null,
  } = opts;

  const opportunitiesBuilder: Record<string, unknown> = {
    select: vi.fn(() => opportunitiesBuilder),
    eq: vi.fn(() => opportunitiesBuilder),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({ data: opportunity, error: opportunityError }),
  };

  const twinBuilder: Record<string, unknown> = {
    select: vi.fn(() => twinBuilder),
    eq: vi.fn(() => twinBuilder),
    maybeSingle: vi.fn().mockResolvedValue({ data: twin, error: null }),
  };

  const outcomesBuilder = makeThenable({ data: outcomes });

  const upsert = vi.fn().mockResolvedValue({ error: upsertError });
  const scoresBuilder = { upsert };

  return {
    from: vi.fn((table: string) => {
      if (table === "opportunities") return opportunitiesBuilder;
      if (table === "organizational_digital_twins") return twinBuilder;
      if (table === "outcomes") return outcomesBuilder;
      if (table === "opportunity_probability_scores") return scoresBuilder;
      throw new Error(`Unexpected table: ${table}`);
    }),
    __upsert: upsert,
  };
}

describe("computeGrantProbability", () => {
  it("returns an integer score between 0 and 100", async () => {
    const supabase = createSupabaseMock({
      opportunity: {
        id: "opp-1",
        category: "housing_grant",
        deadline: addDays(new Date(), 40).toISOString(),
        eligibility_score: 80,
      },
      twin: { twin_completeness_score: 60 },
      outcomes: [{ result: "awarded" }, { result: "denied" }],
    });

    const result = await computeGrantProbability("opp-1", "org-1", supabase);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(Number.isInteger(result.score)).toBe(true);
  });

  it("recommends 'apply' and reports high confidence when every factor scores at its maximum with real data", async () => {
    const supabase = createSupabaseMock({
      opportunity: {
        id: "opp-1",
        category: "housing_grant",
        deadline: addDays(new Date(), 40).toISOString(),
        eligibility_score: 100,
      },
      twin: { twin_completeness_score: 100 },
      outcomes: [{ result: "awarded" }, { result: "awarded" }],
    });

    const result = await computeGrantProbability("opp-1", "org-1", supabase);

    expect(result.score).toBe(100);
    expect(result.recommendation).toBe("apply");
    expect(result.confidence).toBe("high");
  });

  it("recommends 'skip' when every factor scores at its minimum despite having real data", async () => {
    const supabase = createSupabaseMock({
      opportunity: {
        id: "opp-1",
        category: "housing_grant",
        deadline: subDays(new Date(), 5).toISOString(),
        eligibility_score: 0,
      },
      twin: { twin_completeness_score: 0 },
      outcomes: [{ result: "denied" }, { result: "denied" }],
    });

    const result = await computeGrantProbability("opp-1", "org-1", supabase);

    expect(result.score).toBe(0);
    expect(result.recommendation).toBe("skip");
  });

  it("recommends 'consider' when factors land in the middle of the range", async () => {
    const supabase = createSupabaseMock({
      opportunity: {
        id: "opp-1",
        category: "housing_grant",
        deadline: addDays(new Date(), 20).toISOString(),
        eligibility_score: 50,
      },
      twin: { twin_completeness_score: 50 },
      outcomes: [{ result: "awarded" }, { result: "denied" }],
    });

    const result = await computeGrantProbability("opp-1", "org-1", supabase);

    expect(result.score).toBe(50);
    expect(result.recommendation).toBe("consider");
  });

  it("reports confidence 'low' when none of the four factors have real underlying data", async () => {
    const supabase = createSupabaseMock({
      opportunity: {
        id: "opp-1",
        category: null,
        deadline: null,
        eligibility_score: null,
      },
      twin: null,
      outcomes: null,
    });

    const result = await computeGrantProbability("opp-1", "org-1", supabase);

    expect(result.confidence).toBe("low");
  });

  it("returns a deadline_proximity factor value of 0 when the deadline has already passed", async () => {
    const supabase = createSupabaseMock({
      opportunity: {
        id: "opp-1",
        category: "housing_grant",
        deadline: subDays(new Date(), 5).toISOString(),
        eligibility_score: 80,
      },
      twin: { twin_completeness_score: 60 },
      outcomes: [{ result: "awarded" }],
    });

    const result = await computeGrantProbability("opp-1", "org-1", supabase);
    const deadlineFactor = result.factors.find(
      (f) => f.name === "deadline_proximity",
    );

    expect(deadlineFactor?.value).toBe(0);
    expect(result.key_risks).toContain("Deadline has already passed.");
    expect(result.key_risks).not.toContain(
      "Deadline is under 15 days away — limited prep time.",
    );
  });

  it("defaults the twin_completeness factor to a neutral value when no Digital Twin exists", async () => {
    const supabase = createSupabaseMock({
      opportunity: {
        id: "opp-1",
        category: "housing_grant",
        deadline: addDays(new Date(), 40).toISOString(),
        eligibility_score: 80,
      },
      twin: null,
      outcomes: [{ result: "awarded" }],
    });

    const result = await computeGrantProbability("opp-1", "org-1", supabase);
    const twinFactor = result.factors.find(
      (f) => f.name === "twin_completeness",
    );

    expect(twinFactor?.value).toBeCloseTo(0.2);
    expect(result.key_risks).toContain(
      "No Organizational Digital Twin exists for this org yet.",
    );
  });

  it("throws when the opportunity is not found", async () => {
    const supabase = createSupabaseMock({ opportunity: null });

    await expect(
      computeGrantProbability("missing-opp", "org-1", supabase),
    ).rejects.toThrow("Opportunity not found.");
  });

  it("persists the computed score to opportunity_probability_scores via upsert", async () => {
    const supabase = createSupabaseMock({
      opportunity: {
        id: "opp-1",
        category: "housing_grant",
        deadline: addDays(new Date(), 40).toISOString(),
        eligibility_score: 80,
      },
      twin: { twin_completeness_score: 60 },
      outcomes: [{ result: "awarded" }],
    });

    const result = await computeGrantProbability("opp-1", "org-1", supabase);

    expect(supabase.__upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunity_id: "opp-1",
        organization_id: "org-1",
        overall_score: result.score,
        confidence: result.confidence,
      }),
      { onConflict: "opportunity_id,organization_id" },
    );
  });

  it("AR-17.5: returns status='insufficient_data' with score=null (never a fabricated number) when at most 1 of 4 factors has real data", async () => {
    const supabase = createSupabaseMock({
      opportunity: {
        id: "opp-1",
        category: null,
        deadline: null,
        eligibility_score: null,
      },
      twin: { twin_completeness_score: 40 },
      outcomes: null,
    });

    const result = await computeGrantProbability("opp-1", "org-1", supabase);

    expect(result.status).toBe("insufficient_data");
    expect(result.score).toBeNull();
    expect(result.recommendation).toBeNull();
    expect(result.estimated_roi).toBeNull();
    expect(result.time_to_complete).toBeNull();
    expect(result.insufficient_data_reasons).toEqual(
      expect.arrayContaining([
        "Eligibility score has not been computed yet for this opportunity.",
        "No prior outcomes recorded in this funding category.",
        "No deadline on record for this opportunity.",
      ]),
    );
    expect(result.evidence.realFactorCount).toBe(1);
    expect(supabase.__upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "insufficient_data", overall_score: null }),
      { onConflict: "opportunity_id,organization_id" },
    );
  });

  it("AR-17.5: reproduces the exact AR-17.2 degenerate pattern (eligibility+category+deadline all fallback, only twin real) as insufficient_data", async () => {
    const supabase = createSupabaseMock({
      opportunity: {
        id: "opp-1",
        category: "housing_grant",
        deadline: null,
        eligibility_score: null,
      },
      twin: { twin_completeness_score: 70 },
      outcomes: [],
    });

    const result = await computeGrantProbability("opp-1", "org-1", supabase);

    expect(result.status).toBe("insufficient_data");
    const twinFactor = result.factors.find((f) => f.name === "twin_completeness");
    expect(twinFactor?.isFallback).toBe(false);
    const eligibilityFactor = result.factors.find((f) => f.name === "eligibility_score");
    expect(eligibilityFactor?.isFallback).toBe(true);
  });

  it("AR-17.5: returns status='scored' with real evidence once 2 or more factors have real data", async () => {
    const supabase = createSupabaseMock({
      opportunity: {
        id: "opp-1",
        category: "housing_grant",
        deadline: null,
        eligibility_score: 80,
      },
      twin: null,
      outcomes: [{ result: "awarded" }],
    });

    const result = await computeGrantProbability("opp-1", "org-1", supabase);

    expect(result.status).toBe("scored");
    expect(typeof result.score).toBe("number");
    expect(result.evidence.realFactorCount).toBe(2);
    expect(result.evidence.inputs.eligibilityScore).toBe(80);
    expect(result.evidence.inputs.categoryOutcomesCount).toBe(1);
  });

  it("AR-17.5: every factor carries isFallback and a source, regardless of status", async () => {
    const supabase = createSupabaseMock({
      opportunity: {
        id: "opp-1",
        category: "housing_grant",
        deadline: addDays(new Date(), 40).toISOString(),
        eligibility_score: 80,
      },
      twin: { twin_completeness_score: 60 },
      outcomes: [{ result: "awarded" }],
    });

    const result = await computeGrantProbability("opp-1", "org-1", supabase);

    for (const f of result.factors) {
      expect(typeof f.isFallback).toBe("boolean");
      expect(typeof f.source).toBe("string");
      expect(f.source.length).toBeGreaterThan(0);
    }
  });

  it("throws when persisting the score fails", async () => {
    const supabase = createSupabaseMock({
      opportunity: {
        id: "opp-1",
        category: "housing_grant",
        deadline: addDays(new Date(), 40).toISOString(),
        eligibility_score: 80,
      },
      twin: { twin_completeness_score: 60 },
      outcomes: [{ result: "awarded" }],
      upsertError: { message: "connection refused" },
    });

    await expect(
      computeGrantProbability("opp-1", "org-1", supabase),
    ).rejects.toThrow("Failed to persist grant probability score: connection refused");
  });
});
