import { describe, it, expect } from "vitest";
import {
  analyzeOutcomes,
  rankNarratives,
  type OutcomeInput,
  type NarrativeRankInput,
} from "@/lib/ai/learning/outcome-analyzer";

function makeOutcome(overrides: Partial<OutcomeInput> = {}): OutcomeInput {
  return {
    result: "awarded",
    awarded_amount: 1000,
    requested_amount: 1000,
    funder_category: "private_foundation",
    opportunity_category: "housing",
    denial_reason: null,
    recorded_at: "2026-03-15T12:00:00.000Z",
    ...overrides,
  } as OutcomeInput;
}

function makeNarrative(overrides: Partial<NarrativeRankInput> = {}): NarrativeRankInput {
  return {
    id: "n1",
    narrative_text: "Our program has served 500 families in rural Texas.",
    section_type: "need_statement",
    funder_category: "private_foundation",
    success_count: 3,
    effectiveness_score: null,
    last_used_at: null,
    ...overrides,
  } as NarrativeRankInput;
}

describe("analyzeOutcomes", () => {
  it("returns zeroed values for an empty array", () => {
    const result = analyzeOutcomes([]);

    expect(result.summary).toEqual({
      total: 0,
      awarded: 0,
      denied: 0,
      partial: 0,
      successRate: null,
      fundedRate: null,
      totalRequested: 0,
      totalAwarded: 0,
      dollarEfficiency: null,
      hasEnoughForRate: false,
    });
    expect(result.byFunderCategory).toEqual([]);
    expect(result.byOpportunityCategory).toEqual([]);
    expect(result.overTime).toEqual([]);
    expect(result.denialPatterns).toEqual([]);
  });

  it("returns null rates below MIN_OUTCOMES_FOR_RATE (5) even with real data", () => {
    const outcomes = [
      makeOutcome({ result: "awarded" }),
      makeOutcome({ result: "awarded" }),
      makeOutcome({ result: "denied" }),
      makeOutcome({ result: "denied" }),
    ];

    const result = analyzeOutcomes(outcomes);

    expect(result.summary.total).toBe(4);
    expect(result.summary.successRate).toBeNull();
    expect(result.summary.fundedRate).toBeNull();
    expect(result.summary.hasEnoughForRate).toBe(false);
  });

  it("computes successRate and fundedRate once total reaches MIN_OUTCOMES_FOR_RATE (5)", () => {
    const outcomes = [
      makeOutcome({ result: "awarded" }),
      makeOutcome({ result: "awarded" }),
      makeOutcome({ result: "awarded" }),
      makeOutcome({ result: "denied" }),
      makeOutcome({ result: "partial" }),
    ];

    const result = analyzeOutcomes(outcomes);

    expect(result.summary.total).toBe(5);
    expect(result.summary.hasEnoughForRate).toBe(true);
    expect(result.summary.successRate).toBe(60); // 3/5
    expect(result.summary.fundedRate).toBe(80); // (3+1)/5
  });

  it("computes dollarEfficiency as total awarded / total requested, null with no requests", () => {
    const outcomes = [
      makeOutcome({ requested_amount: 1000, awarded_amount: 750 }),
      makeOutcome({ requested_amount: 1000, awarded_amount: 250 }),
    ];

    const result = analyzeOutcomes(outcomes);

    expect(result.summary.totalRequested).toBe(2000);
    expect(result.summary.totalAwarded).toBe(1000);
    expect(result.summary.dollarEfficiency).toBe(50);

    const noRequests = analyzeOutcomes([
      makeOutcome({ requested_amount: null, awarded_amount: null }),
    ]);
    expect(noRequests.summary.dollarEfficiency).toBeNull();
  });

  it("treats null awarded/requested amounts as 0 rather than throwing", () => {
    const outcomes = [makeOutcome({ requested_amount: null, awarded_amount: null })];

    const result = analyzeOutcomes(outcomes);

    expect(result.summary.totalRequested).toBe(0);
    expect(result.summary.totalAwarded).toBe(0);
  });

  it("groups by funder_category, sorted by total descending, with averageAward over funded outcomes only", () => {
    const outcomes = [
      makeOutcome({ funder_category: "private_foundation", result: "awarded", awarded_amount: 1000 }),
      makeOutcome({ funder_category: "private_foundation", result: "partial", awarded_amount: 500 }),
      makeOutcome({ funder_category: "private_foundation", result: "denied", awarded_amount: 0 }),
      makeOutcome({ funder_category: "government_grant", result: "denied", awarded_amount: 0 }),
    ];

    const result = analyzeOutcomes(outcomes);

    expect(result.byFunderCategory.map((c) => c.category)).toEqual([
      "private_foundation",
      "government_grant",
    ]);
    const pf = result.byFunderCategory[0]!;
    expect(pf.total).toBe(3);
    expect(pf.awarded).toBe(1);
    expect(pf.partial).toBe(1);
    expect(pf.denied).toBe(1);
    expect(pf.averageAward).toBe(750); // (1000 + 500) / 2 funded outcomes

    const gov = result.byFunderCategory[1]!;
    expect(gov.averageAward).toBeNull(); // no funded outcomes
  });

  it("ignores outcomes with a null funder_category when grouping by funder category", () => {
    const outcomes = [makeOutcome({ funder_category: null as never })];

    const result = analyzeOutcomes(outcomes);

    expect(result.byFunderCategory).toEqual([]);
  });

  it("groups by opportunity_category independently of funder_category", () => {
    const outcomes = [
      makeOutcome({ opportunity_category: "housing", result: "awarded" }),
      makeOutcome({ opportunity_category: "housing", result: "denied" }),
      makeOutcome({ opportunity_category: "education", result: "awarded" }),
    ];

    const result = analyzeOutcomes(outcomes);

    const housing = result.byOpportunityCategory.find((c) => c.category === "housing");
    const education = result.byOpportunityCategory.find((c) => c.category === "education");
    expect(housing?.total).toBe(2);
    expect(education?.total).toBe(1);
  });

  it("buckets outcomes into monthly points sorted ascending by month", () => {
    const outcomes = [
      makeOutcome({ recorded_at: "2026-06-01T12:00:00.000Z", result: "awarded" }),
      makeOutcome({ recorded_at: "2026-01-15T12:00:00.000Z", result: "denied" }),
      makeOutcome({ recorded_at: "2026-01-20T12:00:00.000Z", result: "awarded" }),
    ];

    const result = analyzeOutcomes(outcomes);

    expect(result.overTime.map((p) => p.month)).toEqual(["2026-01", "2026-06"]);
    expect(result.overTime[0]!.label).toBe("Jan 2026");
    expect(result.overTime[0]!.total).toBe(2);
    expect(result.overTime[1]!.total).toBe(1);
  });

  it("excludes outcomes with missing or unparseable recorded_at from overTime but still counts them in the summary", () => {
    const outcomes = [
      makeOutcome({ recorded_at: null }),
      makeOutcome({ recorded_at: "not-a-real-date" }),
      makeOutcome({ recorded_at: "2026-03-15T12:00:00.000Z" }),
    ];

    const result = analyzeOutcomes(outcomes);

    expect(result.summary.total).toBe(3);
    expect(result.overTime).toHaveLength(1);
    expect(result.overTime[0]!.month).toBe("2026-03");
  });

  it("groups denial reasons, falling back to 'Unspecified', sorted by count descending", () => {
    const outcomes = [
      makeOutcome({ result: "denied", denial_reason: "Not aligned with funder priorities" }),
      makeOutcome({ result: "denied", denial_reason: "Not aligned with funder priorities" }),
      makeOutcome({ result: "denied", denial_reason: "  " }),
      makeOutcome({ result: "denied", denial_reason: null }),
      makeOutcome({ result: "awarded" }),
    ];

    const result = analyzeOutcomes(outcomes);

    expect(result.denialPatterns).toEqual([
      { reason: "Not aligned with funder priorities", count: 2 },
      { reason: "Unspecified", count: 2 },
    ]);
  });
});

describe("rankNarratives", () => {
  it("returns an empty array for no narratives", () => {
    expect(rankNarratives([])).toEqual([]);
  });

  it("computes effectiveness from success/failure counts when effectiveness_score is null", () => {
    const narrative = makeNarrative({ success_count: 3, effectiveness_score: null });

    const [result] = rankNarratives([narrative]);

    expect(result!.effectivenessScore).toBe(1); // 3 wins / 3 uses, no recorded failures
    expect(result!.tier).toBe("high");
    expect(result!.flaggedForRetirement).toBe(false); // only 3 total uses, below MIN_USES_FOR_RETIREMENT (5)
  });

  it("treats a narrative with zero uses as untested with a null effectiveness score", () => {
    const narrative = makeNarrative({ success_count: 0, funder_category: null, effectiveness_score: null });

    const [result] = rankNarratives([narrative]);

    expect(result!.effectivenessScore).toBeNull();
    expect(result!.tier).toBe("untested");
    expect(result!.flaggedForRetirement).toBe(false);
  });

  it("pulls the failure count for a narrative's funder_category from the provided map", () => {
    const failuresByCategory = new Map([["government_grant", 9]]);
    const narrative = makeNarrative({
      funder_category: "government_grant",
      success_count: 1,
      effectiveness_score: null,
    });

    const [result] = rankNarratives([narrative], failuresByCategory);

    // 1 win / (1 win + 9 losses) = 0.1
    expect(result!.effectivenessScore).toBe(0.1);
    expect(result!.tier).toBe("low");
    expect(result!.flaggedForRetirement).toBe(true); // 10 total uses >= 5, effectiveness < 0.3
  });

  it("treats a null funder_category as zero failures even when the map has other categories", () => {
    const failuresByCategory = new Map([["private_foundation", 50]]);
    const narrative = makeNarrative({
      funder_category: null,
      success_count: 4,
      effectiveness_score: null,
    });

    const [result] = rankNarratives([narrative], failuresByCategory);

    expect(result!.effectivenessScore).toBe(1);
  });

  it("reports the 'moderate' tier between the retirement threshold (0.3) and the high threshold (0.66)", () => {
    const failuresByCategory = new Map([["private_foundation", 2]]);
    const narrative = makeNarrative({
      funder_category: "private_foundation",
      success_count: 3,
      effectiveness_score: null,
    });

    const [result] = rankNarratives([narrative], failuresByCategory);

    expect(result!.effectivenessScore).toBe(0.6);
    expect(result!.tier).toBe("moderate");
  });

  it("uses a stored effectiveness_score instead of recomputing it when present", () => {
    const narrative = makeNarrative({
      success_count: 1,
      effectiveness_score: 0.9,
    });

    const [result] = rankNarratives([narrative]);

    expect(result!.effectivenessScore).toBe(0.9);
    expect(result!.tier).toBe("high");
  });

  it("sorts by effectiveness score descending, then by success count descending", () => {
    const highest = makeNarrative({ id: "highest", success_count: 10, effectiveness_score: null }); // computes to 1.0
    const stored = makeNarrative({ id: "stored", success_count: 2, effectiveness_score: 0.9 });
    const untested = makeNarrative({ id: "untested", success_count: 0, funder_category: null, effectiveness_score: null });

    const result = rankNarratives([untested, stored, highest]);

    expect(result.map((r) => r.id)).toEqual(["highest", "stored", "untested"]);
  });

  it("respects the limit parameter, defaulting to 5", () => {
    const narratives = Array.from({ length: 8 }, (_, i) =>
      makeNarrative({ id: `n${i}`, success_count: i + 1, effectiveness_score: null }),
    );

    expect(rankNarratives(narratives)).toHaveLength(5);
    expect(rankNarratives(narratives, new Map(), 2)).toHaveLength(2);
  });

  it("builds a single-line excerpt, collapsing whitespace and leaving short text untouched", () => {
    const narrative = makeNarrative({ narrative_text: "Line one.   \n\n  Line two." });

    const [result] = rankNarratives([narrative]);

    expect(result!.excerpt).toBe("Line one. Line two.");
  });

  it("truncates a narrative excerpt longer than 160 characters with an ellipsis", () => {
    const longText = "X".repeat(200);
    const narrative = makeNarrative({ narrative_text: longText });

    const [result] = rankNarratives([narrative]);

    expect(result!.excerpt).toHaveLength(162);
    expect(result!.excerpt.endsWith("...")).toBe(true);
    expect(result!.excerpt).toBe(`${"X".repeat(159)}...`);
  });
});
