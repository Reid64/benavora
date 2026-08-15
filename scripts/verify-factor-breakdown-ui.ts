// One-off live verification script for FEATURE_REGISTRY_v2.md row #106
// (Factor Breakdown UI, src/app/(dashboard)/opportunities/page.tsx's
// ProbabilityBreakdown component).
//
// The UI never recomputes — it only reads the persisted
// opportunity_probability_scores row. This script proves that row is
// genuinely correct by independently re-running the real, unmodified
// computeGrantProbability() (src/lib/intelligence/grant-probability-engine.ts)
// against a real Faith Foundation opportunity and diffing its output against
// what's already stored (i.e. what the UI would render for that opportunity).
//
// Run with: node --import tsx scripts/verify-factor-breakdown-ui.ts

import { config } from "dotenv";
config({ path: ".env.local" });
import { createAdminClient } from "../src/lib/supabase/admin";
import { computeGrantProbability } from "../src/lib/intelligence/grant-probability-engine";

async function main() {
  const orgId = process.env.FAITH_FOUNDATION_ORG_ID;
  if (!orgId) {
    throw new Error("FAITH_FOUNDATION_ORG_ID not set in .env.local");
  }

  const admin = createAdminClient();

  const { data: existingScore, error: scoreError } = await admin
    .from("opportunity_probability_scores")
    .select("opportunity_id, overall_score, confidence, factors, recommendation, key_risks, key_strengths, estimated_roi, time_to_complete")
    .eq("organization_id", orgId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (scoreError || !existingScore) {
    throw new Error(`No existing opportunity_probability_scores row found for org ${orgId}: ${scoreError?.message}`);
  }

  const oppId = existingScore.opportunity_id as string;
  console.log(`\n=== Target opportunity: ${oppId} ===`);
  console.log("Row the UI would read (pre-existing, what's on screen right now):");
  console.log(JSON.stringify(existingScore, null, 2));

  console.log(`\n=== Independently re-running computeGrantProbability(${oppId}, ${orgId}) live ===`);
  const fresh = await computeGrantProbability(oppId, orgId, admin);
  console.log(JSON.stringify(fresh, null, 2));

  console.log("\n=== Diff: UI-displayed fields vs fresh engine call ===");
  const fields: (keyof typeof fresh)[] = [
    "score",
    "confidence",
    "recommendation",
    "key_risks",
    "key_strengths",
    "estimated_roi",
    "time_to_complete",
  ];
  let allMatch = true;
  for (const f of fields) {
    const before = f === "score" ? existingScore.overall_score : (existingScore as any)[f === "score" ? "overall_score" : f];
    const after = (fresh as any)[f];
    const match = JSON.stringify(before) === JSON.stringify(after);
    if (!match) allMatch = false;
    console.log(`${f}: ${match ? "MATCH" : "DIFFERS"}`);
    if (!match) {
      console.log(`  before: ${JSON.stringify(before)}`);
      console.log(`  after:  ${JSON.stringify(after)}`);
    }
  }

  console.log("\n=== Factor-by-factor diff ===");
  const beforeFactors = (existingScore.factors ?? []) as { name: string; weight: number; value: number; contribution: number }[];
  for (const af of fresh.factors) {
    const bf = beforeFactors.find((x) => x.name === af.name);
    const match = bf && bf.value === af.value && bf.weight === af.weight && bf.contribution === af.contribution;
    if (!match) allMatch = false;
    console.log(`${af.name}: weight=${af.weight} value=${af.value} contribution=${af.contribution.toFixed(2)} -- ${match ? "MATCHES stored row" : "DIFFERS from stored row"}`);
  }

  console.log(`\n=== RESULT: ${allMatch ? "ALL FIELDS MATCH" : "MISMATCH FOUND"} ===`);
  process.exit(allMatch ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
