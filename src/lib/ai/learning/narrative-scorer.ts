// Narrative effectiveness scorer — supports the Recursive Learning Agent
// (AGENTS.md Agent 10) and the analytics dashboards (BLUEPRINT §4.10).
//
// Pure, deterministic functions — no AI, no I/O — so they are trivially testable
// and can run on either the client (analytics display) or the server (Agent 10).
//
// Effectiveness is `wins / total_uses` (AGENTS.md Agent 10, Behavioral
// Contracts §10). The proven_narratives table records success_count but has no
// failure column, so the agent supplies the failure tally it derives from the
// outcomes table (denied outcomes in the same funder_category). That keeps the
// formula faithful to the contract while staying within the real schema.

import {
  MIN_USES_FOR_RETIREMENT,
  PROVEN_NARRATIVE_THRESHOLD,
  RETIREMENT_EFFECTIVENESS_THRESHOLD,
} from "@/lib/utils/constants";

/**
 * Effectiveness score in [0, 1]: wins / (wins + failures).
 *
 * With no recorded uses the score is 0 (nothing has been proven yet). The result
 * is clamped to [0, 1] to defend against bad inputs before it is persisted to
 * proven_narratives.effectiveness_score (numeric(5,2)).
 */
export function computeEffectiveness(
  successCount: number,
  failureCount: number,
): number {
  const wins = Math.max(0, successCount);
  const losses = Math.max(0, failureCount);
  const total = wins + losses;
  if (total === 0) return 0;
  const score = wins / total;
  return Math.max(0, Math.min(1, score));
}

/** Total recorded uses backing an effectiveness score. */
export function totalUses(successCount: number, failureCount: number): number {
  return Math.max(0, successCount) + Math.max(0, failureCount);
}

/**
 * Whether a KB entry has earned the is_proven flag: at least
 * {@link PROVEN_NARRATIVE_THRESHOLD} awarded uses (Behavioral Contracts §8/§10).
 */
export function qualifiesAsProven(provenCount: number | null | undefined): boolean {
  return (provenCount ?? 0) >= PROVEN_NARRATIVE_THRESHOLD;
}

/**
 * Whether a narrative should be flagged for retirement review: effectiveness
 * below {@link RETIREMENT_EFFECTIVENESS_THRESHOLD} after at least
 * {@link MIN_USES_FOR_RETIREMENT} total uses (Behavioral Contracts §10).
 *
 * Note: retirement is a review flag only. There is no is_retired column in the
 * schema, so this never deletes or hides data — it surfaces candidates.
 */
export function shouldFlagForRetirement(
  successCount: number,
  failureCount: number,
): boolean {
  if (totalUses(successCount, failureCount) < MIN_USES_FOR_RETIREMENT) {
    return false;
  }
  return (
    computeEffectiveness(successCount, failureCount) <
    RETIREMENT_EFFECTIVENESS_THRESHOLD
  );
}

export type EffectivenessTier = "high" | "moderate" | "low" | "untested";

/** Bucket an effectiveness score for badge coloring in the UI. */
export function effectivenessTier(
  score: number | null | undefined,
  uses = 1,
): EffectivenessTier {
  if (score == null || uses <= 0) return "untested";
  if (score >= 0.66) return "high";
  if (score >= RETIREMENT_EFFECTIVENESS_THRESHOLD) return "moderate";
  return "low";
}
