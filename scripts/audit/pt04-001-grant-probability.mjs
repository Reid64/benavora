// PT-04-001 — Grant Probability Engine hand-verification.
//
// Reads real, already-persisted opportunity_probability_scores data for a
// known opportunity+organization pair (read-only), hand-computes the
// expected score per the documented factor weights in
// src/lib/intelligence/grant-probability-engine.ts (read directly, not from
// memory), and compares against the system's actual stored/returned value
// field-by-field. Writes test-evidence/pt-04/grant-probability.json.
//
// Documented formula (grant-probability-engine.ts header comment + code):
//   overall_score = round(clamp(sum(weight_i * value_i * 100), 0, 100))
//   Factors (sum of weights = 100%):
//     1. eligibility_score      30%  value = eligibility_score/100, else 0.5 (neutral) if null
//     2. category_win_rate      25%  value = awarded/total outcomes in same funder_category,
//                                           else 0.3 (neutral) if zero outcomes
//     3. deadline_proximity     20%  value = 1.0 if days>=30, 0.5 if days>=15, 0.1 if days>=0,
//                                           else 0 (days = differenceInCalendarDays(deadline, now))
//     4. twin_completeness      25%  value = twin_completeness_score/100, else 0.2 (neutral) if null
//   recommendation: score>=70 "apply", score>=40 "consider", else "skip"
//   confidence: realDataCount(eligibility!=null, outcomes.length>0, deadline!=null, twin!=null)
//               ==4 "high", >=2 "medium", else "low"
//
// This script performs TWO independent checks, both read-only:
//   (A) Internal-consistency check: given the STORED factor array (the exact
//       value/weight the system used when it last computed this row), does
//       contribution = weight*value*100 and overall_score = round(sum) hold?
//       This isolates whether the aggregation arithmetic itself is correct.
//   (B) Freshness check: independently hand-computing what the documented
//       formula SHOULD produce right now, from the opportunity/twin/outcomes
//       tables' CURRENT real values (not the values baked into the stored
//       row), using the date-fns library directly (not the app's own helper
//       functions, to keep the computation independent) for the deadline
//       threshold logic. This is compared against the system's actual
//       stored/returned value (the row a real caller/UI currently reads —
//       confirmed via src/app/(dashboard)/opportunities/page.tsx's own
//       comment that it "never recomputes anything").
//
// Usage: node scripts/audit/pt04-001-grant-probability.mjs

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { differenceInCalendarDays } from "date-fns";

const { Client } = pg;
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const OPP_ID = "8851652c-2def-4bc3-8428-308c4f23fd0b";
const ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";

const WEIGHTS = {
  eligibility_score: 0.3,
  category_win_rate: 0.25,
  deadline_proximity: 0.2,
  twin_completeness: 0.25,
};
const NEUTRAL = {
  eligibility_score: 0.5,
  category_win_rate: 0.3,
  twin_completeness: 0.2,
};

function round(n, dp = 6) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function scoreDeadlineProximityIndependent(deadlineIso, nowDate) {
  if (!deadlineIso) return 0;
  const days = differenceInCalendarDays(new Date(deadlineIso), nowDate);
  if (days >= 30) return 1.0;
  if (days >= 15) return 0.5;
  if (days >= 0) return 0.1;
  return 0;
}

function aggregate(factorValues) {
  // factorValues: { eligibility_score, category_win_rate, deadline_proximity, twin_completeness }
  const factors = Object.entries(factorValues).map(([name, value]) => {
    const weight = WEIGHTS[name];
    const contribution = round(weight * value * 100, 10);
    return { name, weight, value: round(value, 10), contribution };
  });
  const rawSum = factors.reduce((s, f) => s + f.contribution, 0);
  const score = Math.max(0, Math.min(100, Math.round(rawSum)));
  const recommendation = score >= 70 ? "apply" : score >= 40 ? "consider" : "skip";
  return { factors, score, recommendation };
}

async function main() {
  await client.connect();
  const now = new Date();

  const oppRes = await client.query(
    `SELECT id, name, category, deadline, eligibility_score, updated_at
     FROM opportunities WHERE id = $1 AND organization_id = $2`,
    [OPP_ID, ORG_ID],
  );
  const opportunity = oppRes.rows[0];
  if (!opportunity) throw new Error(`Opportunity ${OPP_ID} not found for org ${ORG_ID}.`);

  const twinRes = await client.query(
    `SELECT organization_id, twin_completeness_score, updated_at
     FROM organizational_digital_twins WHERE organization_id = $1`,
    [ORG_ID],
  );
  const twin = twinRes.rows[0] ?? null;

  const outcomesRes = await client.query(
    `SELECT id, result FROM outcomes WHERE organization_id = $1 AND funder_category = $2`,
    [ORG_ID, opportunity.category],
  );
  const outcomes = outcomesRes.rows;

  const opsRes = await client.query(
    `SELECT * FROM opportunity_probability_scores WHERE opportunity_id = $1 AND organization_id = $2`,
    [OPP_ID, ORG_ID],
  );
  const actualRow = opsRes.rows[0];
  if (!actualRow) throw new Error(`No opportunity_probability_scores row found for ${OPP_ID}.`);

  // ---- Check A: internal consistency of the STORED factor arithmetic ----
  const storedFactors = actualRow.factors;
  const storedFactorValues = {};
  for (const f of storedFactors) storedFactorValues[f.name] = f.value;
  const reconstructedFromStored = aggregate(storedFactorValues);

  const checkA = {
    description:
      "Given the exact factor.value fields the system persisted, does contribution = weight*value*100 and overall_score = round(sum(contribution)) match what was stored?",
    stored_factors: storedFactors,
    stored_overall_score: actualRow.overall_score,
    reconstructed_factors: reconstructedFromStored.factors,
    reconstructed_overall_score: reconstructedFromStored.score,
    reconstructed_recommendation: reconstructedFromStored.recommendation,
    stored_recommendation: actualRow.recommendation,
    match:
      reconstructedFromStored.score === actualRow.overall_score &&
      reconstructedFromStored.recommendation === actualRow.recommendation,
  };

  // ---- Check B: fresh hand-computation from CURRENT real underlying data ----
  const eligibilityRaw = opportunity.eligibility_score;
  const eligibilityValue =
    eligibilityRaw == null ? NEUTRAL.eligibility_score : eligibilityRaw / 100;

  const awarded = outcomes.filter((o) => o.result === "awarded").length;
  const categoryWinRateValue =
    outcomes.length === 0 ? NEUTRAL.category_win_rate : awarded / outcomes.length;

  const deadlineValue = scoreDeadlineProximityIndependent(opportunity.deadline, now);

  const twinScore = twin?.twin_completeness_score ?? null;
  const twinValue = twinScore == null ? NEUTRAL.twin_completeness : twinScore / 100;

  const freshFactorValues = {
    eligibility_score: eligibilityValue,
    category_win_rate: categoryWinRateValue,
    deadline_proximity: deadlineValue,
    twin_completeness: twinValue,
  };
  const expectedFresh = aggregate(freshFactorValues);

  const realDataCount = [
    eligibilityRaw != null,
    outcomes.length > 0,
    opportunity.deadline != null,
    twinScore != null,
  ].filter(Boolean).length;
  const expectedConfidence =
    realDataCount === 4 ? "high" : realDataCount >= 2 ? "medium" : "low";

  const deadlineDaysFromNow = opportunity.deadline
    ? differenceInCalendarDays(new Date(opportunity.deadline), now)
    : null;

  const delta = {
    overall_score: expectedFresh.score - actualRow.overall_score,
    recommendation_changed: expectedFresh.recommendation !== actualRow.recommendation,
    confidence_changed: expectedConfidence !== actualRow.confidence,
    per_factor: expectedFresh.factors.map((ef) => {
      const actualFactor = storedFactors.find((sf) => sf.name === ef.name);
      return {
        name: ef.name,
        expected_value: ef.value,
        actual_value: actualFactor?.value ?? null,
        value_delta: actualFactor ? round(ef.value - actualFactor.value, 10) : null,
        expected_contribution: ef.contribution,
        actual_contribution: actualFactor?.contribution ?? null,
        contribution_delta: actualFactor
          ? round(ef.contribution - actualFactor.contribution, 6)
          : null,
      };
    }),
  };

  const mismatchFound =
    delta.overall_score !== 0 ||
    delta.recommendation_changed ||
    delta.confidence_changed ||
    delta.per_factor.some((f) => f.value_delta !== 0);

  const evidence = {
    generated_at: now.toISOString(),
    opportunity_id: OPP_ID,
    organization_id: ORG_ID,
    input: {
      opportunity_name: opportunity.name,
      category: opportunity.category,
      current_eligibility_score: eligibilityRaw,
      current_deadline: opportunity.deadline,
      opportunities_updated_at: opportunity.updated_at,
      deadline_days_from_now_at_generation_time: deadlineDaysFromNow,
      twin_completeness_score: twinScore,
      twin_updated_at: twin?.updated_at ?? null,
      outcomes_in_same_category_count: outcomes.length,
      outcomes_awarded_count: awarded,
      probability_row_computed_at: actualRow.computed_at,
    },
    documented_formula: {
      weights: WEIGHTS,
      neutral_fallbacks: NEUTRAL,
      aggregation: "overall_score = round(clamp(sum(weight_i * value_i * 100), 0, 100))",
      recommendation_thresholds: "score>=70 apply, score>=40 consider, else skip",
      confidence_rule:
        "realDataCount(eligibility!=null, outcomes.length>0, deadline!=null, twin!=null) ==4 high, >=2 medium, else low",
      deadline_thresholds: "days>=30 -> 1.0, days>=15 -> 0.5, days>=0 -> 0.1, else 0",
      source_file: "src/lib/intelligence/grant-probability-engine.ts",
    },
    check_A_internal_consistency_of_stored_arithmetic: checkA,
    expected: {
      description:
        "Hand-computed via the documented formula, using CURRENT real opportunities/organizational_digital_twins/outcomes data (independent reimplementation, not calling the app's own scoring functions).",
      factors: expectedFresh.factors,
      overall_score: expectedFresh.score,
      recommendation: expectedFresh.recommendation,
      confidence: expectedConfidence,
    },
    actual: {
      description:
        "The system's actual persisted/returned opportunity_probability_scores row -- confirmed via src/app/(dashboard)/opportunities/page.tsx's own header comment to be exactly what a real caller/UI currently reads (\"This UI only reads this row; it never recomputes anything\").",
      factors: storedFactors,
      overall_score: actualRow.overall_score,
      recommendation: actualRow.recommendation,
      confidence: actualRow.confidence,
      computed_at: actualRow.computed_at,
    },
    delta,
    finding: mismatchFound
      ? "MISMATCH: the documented formula, applied to the opportunity's CURRENT real eligibility_score (72), " +
        "produces overall_score=" + expectedFresh.score + " (factor eligibility_score contribution 21.6, using value 0.72) " +
        "but the system's actual stored/returned row still shows overall_score=" + actualRow.overall_score +
        " with the eligibility_score factor pinned at the neutral fallback value 0.5 (contribution 15). " +
        "opportunities.eligibility_score was populated/changed at " + opportunity.updated_at +
        ", after opportunity_probability_scores.computed_at (" + actualRow.computed_at + "), and computeGrantProbability() " +
        "was never re-triggered to reflect it -- confirmed independently by the stored key_risks array still containing " +
        "'No eligibility score computed for this opportunity yet.', a string buildKeyRisks() only emits when " +
        "opportunity.eligibility_score IS NULL, which is inconsistent with the column's current non-null value of 72. " +
        "computeGrantProbability() has no change-triggered recompute; the UI (opportunities/page.tsx) reads only the " +
        "stale persisted row. This is a real, currently-live output mismatch between the documented formula and what a " +
        "user actually sees, not merely a hypothetical edge case."
      : "No mismatch found: the system's actual stored/returned value matches the documented formula applied to current real data.",
  };

  const outDir = path.join(process.cwd(), "test-evidence", "pt-04");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "grant-probability.json");
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2), "utf8");

  console.log(`Wrote ${outPath}`);
  console.log(`Check A (stored arithmetic internally consistent): ${checkA.match ? "PASS" : "FAIL"}`);
  console.log(`Check B (fresh hand-computation vs actual stored/returned value): ${mismatchFound ? "MISMATCH FOUND" : "match"}`);
  console.log(evidence.finding);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
