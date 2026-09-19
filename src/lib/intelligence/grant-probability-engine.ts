// Grant Probability Engine (PLATFORM_VISION_ARCHITECTURE.md Pillar 5 / AG-15).
//
// Deterministic (non-Claude) precursor to the full AG-15 agent: computes a
// weighted 0-100 probability score from opportunity + Digital Twin + outcomes
// data alone, and persists it to opportunity_probability_scores (migration
// 093, extended by migration 202). AG-15 can later layer a Claude call on
// top of this for narrative risks/strengths; this function already returns
// those fields with deterministic fallbacks so callers have a complete
// result today.
//
// Factor weights (sum to 100%):
//   1. eligibility_score                30%
//   2. category_win_rate (outcomes)     25%
//   3. deadline_proximity               20%
//   4. twin_completeness                25%
//
// AR-17.5 fix: AR-17.2's read-only audit found that 478/500 sampled
// production rows had all three non-Digital-Twin factors pinned to their
// hardcoded neutral fallback constants *simultaneously* (no eligibility
// score, no outcomes in this funder category, no deadline on file) — 75 of
// the formula's 100 weighted points frozen constants, with only
// twin_completeness ever varying. The result was a number that looked like a
// personalized probability but was, mechanically, a linear rescaling of one
// unrelated field. This function no longer persists a fabricated score in
// that situation: whenever at most one of the four factors has real data
// behind it, the result is an explicit `status: "insufficient_data"` outcome
// with `score: null` and a `reasons` list naming exactly which inputs are
// missing — not a magic sentinel number, and not a boilerplate "risk" list
// dressed up as a computed judgment. Every factor also records `isFallback`
// and `source` so the evidence behind (or missing behind) a score is never
// implicit.

import { differenceInCalendarDays } from "date-fns";

const NEUTRAL_ELIGIBILITY = 0.5;
const NEUTRAL_CATEGORY_WIN_RATE = 0.3;
const NEUTRAL_TWIN_COMPLETENESS = 0.2;

/** At most this many of the 4 weighted factors may be real data before the
 * result is downgraded to "insufficient_data" instead of a number. Traced
 * directly to the AR-17.2 finding: the degenerate rows all had exactly 0 or
 * 1 real factor (twin_completeness only) out of 4. */
const MIN_REAL_FACTORS_FOR_SCORE = 2;

export type GrantProbabilityStatus = "scored" | "insufficient_data";

export interface GrantProbabilityFactor {
  name: string;
  weight: number;
  value: number;
  contribution: number;
  /** True when this factor used a neutral fallback constant because the
   * real input was missing, not because a real input evaluated to a low
   * number. */
  isFallback: boolean;
  /** Exactly which stored input this factor's value (or fallback) came
   * from, so a score's evidence can be audited without re-reading source. */
  source: string;
}

export interface GrantProbabilityEvidence {
  opportunityId: string;
  organizationId: string;
  /** How many of the 4 factors above had real data behind them. */
  realFactorCount: number;
  inputs: {
    eligibilityScore: number | null;
    categoryOutcomesCount: number;
    categoryAwardedCount: number;
    deadline: string | null;
    twinCompletenessScore: number | null;
  };
}

export interface GrantProbabilityResult {
  status: GrantProbabilityStatus;
  /** Null when status is "insufficient_data" — never a fabricated number. */
  score: number | null;
  confidence: "high" | "medium" | "low";
  factors: GrantProbabilityFactor[];
  evidence: GrantProbabilityEvidence;
  recommendation: "apply" | "consider" | "skip" | null;
  key_risks: string[];
  key_strengths: string[];
  estimated_roi: string | null;
  time_to_complete: string | null;
  /** Populated only when status is "insufficient_data" — names exactly
   * which real inputs are missing, grounded in `evidence.inputs`. */
  insufficient_data_reasons: string[];
}

const REASON_TEXT: Record<string, string> = {
  eligibility_score: "Eligibility score has not been computed yet for this opportunity.",
  category_win_rate: "No prior outcomes recorded in this funding category.",
  deadline_proximity: "No deadline on record for this opportunity.",
  twin_completeness: "Organizational Digital Twin has not been built for this org yet.",
};

export async function computeGrantProbability(
  opportunityId: string,
  orgId: string,
  supabase: any,
): Promise<GrantProbabilityResult> {
  const { data: opportunity, error: opportunityError } = await supabase
    .from("opportunities")
    .select("id, category, deadline, eligibility_score")
    .eq("id", opportunityId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (opportunityError || !opportunity) {
    throw new Error("Opportunity not found.");
  }

  const category = opportunity.category as string | null;

  const [twinRes, outcomesRes] = await Promise.all([
    supabase
      .from("organizational_digital_twins")
      .select("twin_completeness_score")
      .eq("organization_id", orgId)
      .maybeSingle(),
    category
      ? supabase
          .from("outcomes")
          .select("result")
          .eq("organization_id", orgId)
          .eq("funder_category", category)
      : Promise.resolve({ data: null as { result: string }[] | null }),
  ]);

  const twin = (twinRes.data ?? null) as {
    twin_completeness_score: number | null;
  } | null;
  const outcomes = (outcomesRes.data ?? null) as
    | { result: string }[]
    | null;

  const eligibility = scoreEligibility(
    opportunity.eligibility_score as number | null,
  );
  const categoryWinRate = scoreCategoryWinRate(outcomes, category);
  const deadlineProximity = scoreDeadlineProximity(
    opportunity.deadline as string | null,
  );
  const twinCompleteness = scoreTwinCompleteness(twin);

  const factors: GrantProbabilityFactor[] = [
    eligibility,
    categoryWinRate,
    deadlineProximity,
    twinCompleteness,
  ];

  const realFactorCount = factors.filter((f) => !f.isFallback).length;
  const awardedCount = (outcomes ?? []).filter((o) => o.result === "awarded").length;

  const evidence: GrantProbabilityEvidence = {
    opportunityId,
    organizationId: orgId,
    realFactorCount,
    inputs: {
      eligibilityScore: (opportunity.eligibility_score as number | null) ?? null,
      categoryOutcomesCount: outcomes?.length ?? 0,
      categoryAwardedCount: awardedCount,
      deadline: (opportunity.deadline as string | null) ?? null,
      twinCompletenessScore: twin?.twin_completeness_score ?? null,
    },
  };

  const status: GrantProbabilityStatus =
    realFactorCount < MIN_REAL_FACTORS_FOR_SCORE ? "insufficient_data" : "scored";

  let result: GrantProbabilityResult;

  if (status === "insufficient_data") {
    const insufficientReasons = factors
      .filter((f) => f.isFallback)
      .map((f) => REASON_TEXT[f.name] ?? `No real data for ${f.name}.`);

    result = {
      status,
      score: null,
      confidence: "low",
      factors,
      evidence,
      recommendation: null,
      key_risks: [],
      key_strengths: [],
      estimated_roi: null,
      time_to_complete: null,
      insufficient_data_reasons: insufficientReasons,
    };
  } else {
    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round(factors.reduce((sum, f) => sum + f.contribution, 0)),
      ),
    );

    const confidence: GrantProbabilityResult["confidence"] =
      realFactorCount === 4 ? "high" : "medium";

    const recommendation: GrantProbabilityResult["recommendation"] =
      score >= 70 ? "apply" : score >= 40 ? "consider" : "skip";

    result = {
      status,
      score,
      confidence,
      factors,
      evidence,
      recommendation,
      key_risks: buildKeyRisks(opportunity, outcomes, twin),
      key_strengths: buildKeyStrengths(opportunity, outcomes, twin),
      estimated_roi: buildEstimatedRoi(score),
      time_to_complete: buildTimeToComplete(twin),
      insufficient_data_reasons: [],
    };
  }

  const { error: upsertError } = await supabase
    .from("opportunity_probability_scores")
    .upsert(
      {
        opportunity_id: opportunityId,
        organization_id: orgId,
        overall_score: result.score,
        confidence: result.confidence,
        factors: result.factors,
        recommendation: result.recommendation,
        key_risks: result.key_risks,
        key_strengths: result.key_strengths,
        estimated_roi: result.estimated_roi,
        time_to_complete: result.time_to_complete,
        status: result.status,
        insufficient_data_reasons: result.insufficient_data_reasons,
        evidence: result.evidence,
        computed_at: new Date().toISOString(),
      },
      { onConflict: "opportunity_id,organization_id" },
    );

  if (upsertError) {
    throw new Error(
      `Failed to persist grant probability score: ${upsertError.message}`,
    );
  }

  return result;
}

function factor(
  name: string,
  weight: number,
  value: number,
  isFallback: boolean,
  source: string,
): GrantProbabilityFactor {
  const clamped = Math.max(0, Math.min(1, value));
  return {
    name,
    weight,
    value: clamped,
    contribution: weight * clamped * 100,
    isFallback,
    source,
  };
}

function scoreEligibility(raw: number | null): GrantProbabilityFactor {
  const isFallback = raw == null;
  const value = isFallback ? NEUTRAL_ELIGIBILITY : (raw as number) / 100;
  return factor("eligibility_score", 0.3, value, isFallback, "opportunities.eligibility_score");
}

function scoreCategoryWinRate(
  outcomes: { result: string }[] | null,
  category: string | null,
): GrantProbabilityFactor {
  const source = category
    ? `outcomes(organization_id, funder_category='${category}')`
    : "outcomes (no funder_category on opportunity)";
  if (!outcomes || outcomes.length === 0) {
    return factor("category_win_rate", 0.25, NEUTRAL_CATEGORY_WIN_RATE, true, source);
  }
  const awarded = outcomes.filter((o) => o.result === "awarded").length;
  return factor("category_win_rate", 0.25, awarded / outcomes.length, false, source);
}

function scoreDeadlineProximity(
  deadline: string | null,
): GrantProbabilityFactor {
  const isFallback = !deadline;
  if (isFallback) {
    return factor("deadline_proximity", 0.2, 0, true, "opportunities.deadline");
  }
  const days = differenceInCalendarDays(new Date(deadline as string), new Date());
  const value = days >= 30 ? 1.0 : days >= 15 ? 0.5 : days >= 0 ? 0.1 : 0;
  return factor("deadline_proximity", 0.2, value, false, "opportunities.deadline");
}

function scoreTwinCompleteness(
  twin: { twin_completeness_score: number | null } | null,
): GrantProbabilityFactor {
  const isFallback = twin?.twin_completeness_score == null;
  const value = isFallback
    ? NEUTRAL_TWIN_COMPLETENESS
    : (twin as { twin_completeness_score: number }).twin_completeness_score / 100;
  return factor(
    "twin_completeness",
    0.25,
    value,
    isFallback,
    "organizational_digital_twins.twin_completeness_score",
  );
}

function buildKeyRisks(
  opportunity: { eligibility_score: number | null; deadline: string | null },
  outcomes: { result: string }[] | null,
  twin: { twin_completeness_score: number | null } | null,
): string[] {
  const risks: string[] = [];

  if (opportunity.eligibility_score == null) {
    risks.push("No eligibility score computed for this opportunity yet.");
  } else if (opportunity.eligibility_score < 50) {
    risks.push("Eligibility score is below 50 — fit is uncertain.");
  }

  if (!outcomes || outcomes.length === 0) {
    risks.push("No prior outcomes recorded in this funding category.");
  } else {
    const denied = outcomes.filter((o) => o.result === "denied").length;
    if (denied / outcomes.length > 0.5) {
      risks.push(
        "More than half of past applications in this category were denied.",
      );
    }
  }

  if (opportunity.deadline) {
    const days = differenceInCalendarDays(
      new Date(opportunity.deadline),
      new Date(),
    );
    if (days < 0) {
      risks.push("Deadline has already passed.");
    } else if (days < 15) {
      risks.push("Deadline is under 15 days away — limited prep time.");
    }
  } else {
    risks.push("No deadline on record for this opportunity.");
  }

  if (twin == null) {
    risks.push("No Organizational Digital Twin exists for this org yet.");
  } else if ((twin.twin_completeness_score ?? 0) < 50) {
    risks.push("Organizational Digital Twin is under 50% complete.");
  }

  return risks;
}

function buildKeyStrengths(
  opportunity: { eligibility_score: number | null; deadline: string | null },
  outcomes: { result: string }[] | null,
  twin: { twin_completeness_score: number | null } | null,
): string[] {
  const strengths: string[] = [];

  if (opportunity.eligibility_score != null && opportunity.eligibility_score >= 70) {
    strengths.push("Strong eligibility fit (score 70+).");
  }

  if (outcomes && outcomes.length > 0) {
    const awarded = outcomes.filter((o) => o.result === "awarded").length;
    const rate = awarded / outcomes.length;
    if (rate >= 0.5) {
      strengths.push(
        `Track record of ${Math.round(rate * 100)}% win rate in this category.`,
      );
    }
  }

  if (opportunity.deadline) {
    const days = differenceInCalendarDays(
      new Date(opportunity.deadline),
      new Date(),
    );
    if (days >= 30) {
      strengths.push("Deadline is 30+ days out — ample time to prepare.");
    }
  }

  if (twin && (twin.twin_completeness_score ?? 0) >= 70) {
    strengths.push("Organizational Digital Twin is well-developed (70%+ complete).");
  }

  return strengths;
}

export function buildEstimatedRoi(score: number): string {
  if (score >= 70) return "High: strong return likely relative to effort";
  if (score >= 40) return "Moderate: worthwhile with focused preparation";
  return "Low: effort likely outweighs expected return";
}

export function buildTimeToComplete(
  twin: { twin_completeness_score: number | null } | null,
): string {
  const completeness = twin?.twin_completeness_score ?? 0;
  if (completeness >= 70) return "Est. 4-8 hours";
  if (completeness >= 30) return "Est. 8-12 hours";
  return "Est. 12-16 hours";
}
