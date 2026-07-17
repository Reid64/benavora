// Grant Probability Engine (PLATFORM_VISION_ARCHITECTURE.md Pillar 5 / AG-15).
//
// Deterministic (non-Claude) precursor to the full AG-15 agent: computes a
// weighted 0-100 probability score from opportunity + Digital Twin + outcomes
// data alone, and persists it to opportunity_probability_scores (migration
// 093). AG-15 can later layer a Claude call on top of this for narrative
// risks/strengths; this function already returns those fields with
// deterministic fallbacks so callers have a complete result today.
//
// Factor weights (sum to 100%):
//   1. eligibility_score                30%
//   2. category_win_rate (outcomes)     25%
//   3. deadline_proximity               20%
//   4. twin_completeness                25%

import { differenceInCalendarDays } from "date-fns";

const NEUTRAL_ELIGIBILITY = 0.5;
const NEUTRAL_CATEGORY_WIN_RATE = 0.3;
const NEUTRAL_TWIN_COMPLETENESS = 0.2;

export interface GrantProbabilityFactor {
  name: string;
  weight: number;
  value: number;
  contribution: number;
}

export interface GrantProbabilityResult {
  score: number;
  confidence: "high" | "medium" | "low";
  factors: GrantProbabilityFactor[];
  recommendation: "apply" | "consider" | "skip";
  key_risks: string[];
  key_strengths: string[];
  estimated_roi: string;
  time_to_complete: string;
}

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
  const categoryWinRate = scoreCategoryWinRate(outcomes);
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

  const realDataCount = [
    opportunity.eligibility_score != null,
    (outcomes?.length ?? 0) > 0,
    opportunity.deadline != null,
    twin?.twin_completeness_score != null,
  ].filter(Boolean).length;

  const confidence: GrantProbabilityResult["confidence"] =
    realDataCount === 4 ? "high" : realDataCount >= 2 ? "medium" : "low";

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(factors.reduce((sum, f) => sum + f.contribution, 0)),
    ),
  );

  const recommendation: GrantProbabilityResult["recommendation"] =
    score >= 70 ? "apply" : score >= 40 ? "consider" : "skip";

  const key_risks = buildKeyRisks(opportunity, outcomes, twin);
  const key_strengths = buildKeyStrengths(opportunity, outcomes, twin);
  const estimated_roi = buildEstimatedRoi(score);
  const time_to_complete = buildTimeToComplete(twin);

  const result: GrantProbabilityResult = {
    score,
    confidence,
    factors,
    recommendation,
    key_risks,
    key_strengths,
    estimated_roi,
    time_to_complete,
  };

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
): GrantProbabilityFactor {
  const clamped = Math.max(0, Math.min(1, value));
  return {
    name,
    weight,
    value: clamped,
    contribution: weight * clamped * 100,
  };
}

function scoreEligibility(raw: number | null): GrantProbabilityFactor {
  const value = raw == null ? NEUTRAL_ELIGIBILITY : raw / 100;
  return factor("eligibility_score", 0.3, value);
}

function scoreCategoryWinRate(
  outcomes: { result: string }[] | null,
): GrantProbabilityFactor {
  if (!outcomes || outcomes.length === 0) {
    return factor("category_win_rate", 0.25, NEUTRAL_CATEGORY_WIN_RATE);
  }
  const awarded = outcomes.filter((o) => o.result === "awarded").length;
  return factor("category_win_rate", 0.25, awarded / outcomes.length);
}

function scoreDeadlineProximity(
  deadline: string | null,
): GrantProbabilityFactor {
  if (!deadline) {
    return factor("deadline_proximity", 0.2, 0);
  }
  const days = differenceInCalendarDays(new Date(deadline), new Date());
  const value = days >= 30 ? 1.0 : days >= 15 ? 0.5 : days >= 0 ? 0.1 : 0;
  return factor("deadline_proximity", 0.2, value);
}

function scoreTwinCompleteness(
  twin: { twin_completeness_score: number | null } | null,
): GrantProbabilityFactor {
  const value =
    twin?.twin_completeness_score == null
      ? NEUTRAL_TWIN_COMPLETENESS
      : twin.twin_completeness_score / 100;
  return factor("twin_completeness", 0.25, value);
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
    if (days < 15) {
      risks.push("Deadline is under 15 days away — limited prep time.");
    } else if (days < 0) {
      risks.push("Deadline has already passed.");
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

function buildEstimatedRoi(score: number): string {
  if (score >= 70) return "High: strong return likely relative to effort";
  if (score >= 40) return "Moderate: worthwhile with focused preparation";
  return "Low: effort likely outweighs expected return";
}

function buildTimeToComplete(
  twin: { twin_completeness_score: number | null } | null,
): string {
  const completeness = twin?.twin_completeness_score ?? 0;
  if (completeness >= 70) return "Est. 4-8 hours";
  if (completeness >= 30) return "Est. 8-12 hours";
  return "Est. 12-16 hours";
}
