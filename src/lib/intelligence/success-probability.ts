// Opportunity-scoped success probability calculator.
//
// Lighter-weight than the application-scoped agent at
// src/lib/agents/success-probability.ts (which persists to
// success_probability_scores keyed by application_id). This variant answers
// "how promising is this opportunity" before an application even exists, so
// it reads only from opportunities/outcomes/knowledge_base and returns the
// result directly rather than writing to a table.
//
// Factor weights (sum to 100%):
//   1. Opportunity eligibility_score              30%
//   2. Org's win rate in the same funder_category  25%
//   3. Deadline proximity                          20%
//   4. Knowledge base completeness                 25%
// Each factor's `value` is normalized 0-1; `contribution` is weight * value *
// 100 (points toward the final 0-100 score). Missing data for a factor falls
// back to a neutral 0.5 rather than zeroing the score out.
//
// Note: there is no `knowledge_base_entries` table in this schema — the real
// table is `knowledge_base` (migration 001), so factor 4 queries that.

import { differenceInCalendarDays } from "date-fns";

const NEUTRAL = 0.5;

export interface SuccessProbabilityFactor {
  name: string;
  weight: number;
  value: number;
  contribution: number;
}

export interface SuccessProbabilityResult {
  score: number;
  confidence: "high" | "medium" | "low";
  factors: SuccessProbabilityFactor[];
}

export async function computeSuccessProbability(
  orgId: string,
  opportunityId: string,
  supabase: any,
): Promise<SuccessProbabilityResult> {
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

  const [outcomesRes, kbRes] = await Promise.all([
    category
      ? supabase
          .from("outcomes")
          .select("result")
          .eq("organization_id", orgId)
          .eq("funder_category", category)
      : Promise.resolve({ data: null as { result: string }[] | null }),
    supabase
      .from("knowledge_base")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
  ]);

  const outcomes = (outcomesRes.data ?? null) as { result: string }[] | null;
  const kbCount = ((kbRes as { count: number | null }).count ?? 0) as number;

  const eligibility = scoreEligibility(
    opportunity.eligibility_score as number | null,
  );
  const categorySuccessRate = scoreCategorySuccessRate(outcomes);
  const deadlineProximity = scoreDeadlineProximity(
    opportunity.deadline as string | null,
  );
  const kbCompleteness = scoreKnowledgeBaseCompleteness(kbCount);

  const factors: SuccessProbabilityFactor[] = [
    eligibility,
    categorySuccessRate,
    deadlineProximity,
    kbCompleteness,
  ];

  const realDataCount = [
    opportunity.eligibility_score != null,
    (outcomes?.length ?? 0) > 0,
    opportunity.deadline != null,
    kbCount > 0,
  ].filter(Boolean).length;

  const confidence: SuccessProbabilityResult["confidence"] =
    realDataCount === 4 ? "high" : realDataCount >= 2 ? "medium" : "low";

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(factors.reduce((sum, f) => sum + f.contribution, 0)),
    ),
  );

  return { score, confidence, factors };
}

function factor(
  name: string,
  weight: number,
  value: number,
): SuccessProbabilityFactor {
  const clamped = Math.max(0, Math.min(1, value));
  return {
    name,
    weight,
    value: clamped,
    contribution: weight * clamped * 100,
  };
}

function scoreEligibility(raw: number | null): SuccessProbabilityFactor {
  const value = raw == null ? NEUTRAL : raw / 100;
  return factor("eligibility_score", 0.3, value);
}

function scoreCategorySuccessRate(
  outcomes: { result: string }[] | null,
): SuccessProbabilityFactor {
  if (!outcomes || outcomes.length === 0) {
    return factor("category_success_rate", 0.25, NEUTRAL);
  }
  const awarded = outcomes.filter((o) => o.result === "awarded").length;
  return factor("category_success_rate", 0.25, awarded / outcomes.length);
}

function scoreDeadlineProximity(
  deadline: string | null,
): SuccessProbabilityFactor {
  if (!deadline) {
    return factor("deadline_proximity", 0.2, NEUTRAL);
  }
  const days = differenceInCalendarDays(new Date(deadline), new Date());
  const value = days >= 30 ? 1.0 : days >= 15 ? 0.5 : 0.0;
  return factor("deadline_proximity", 0.2, value);
}

function scoreKnowledgeBaseCompleteness(
  count: number,
): SuccessProbabilityFactor {
  return factor("knowledge_base_completeness", 0.25, count / 10);
}
