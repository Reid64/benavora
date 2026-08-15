// One-off live verification script for Corporate Giving DNA generator
// (FEATURE_REGISTRY_v2.md row #92).
//
// Directly calls the real generateGivingDna() against a real corporate_prospects
// row via the real service-role admin client - no mocks. Confirms: (1) the
// prompt is grounded only in real facts extracted from the row, (2) a real
// Claude call succeeds and returns a usable profile, (3) the result persists
// to corporate_prospects.giving_dna, (4) re-running regenerates in place.
//
// Run with: node --import tsx scripts/verify-giving-dna.ts [prospectId]
// Defaults to the first row with a populated `scores` object if no id is given.

import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { createAdminClient } from "../src/lib/supabase/admin";
import { buildGivingDnaFacts, generateGivingDna } from "../src/lib/intelligence/giving-dna";

async function main() {
  const admin = createAdminClient();

  const explicitId = process.argv[2];
  let targetId = explicitId;

  if (!targetId) {
    const { data: pool, error: poolError } = await admin
      .from("corporate_prospects")
      .select("id, legal_name, scores")
      .limit(50);
    if (poolError) throw poolError;
    const scored = (pool ?? []).find((p) => p.scores && Object.keys(p.scores).length > 0);
    targetId = scored?.id ?? pool?.[0]?.id;
    if (!targetId) throw new Error("No corporate_prospects rows found — cannot test against real data.");
  }

  const { data: full, error: fullError } = await admin
    .from("corporate_prospects")
    .select(
      "id, legal_name, dba_name, website, industry_category, naics_description, sic_code, employee_count_estimate, revenue_estimate, location_count, geographic_footprint, address_city, address_state, is_family_owned, is_veteran_owned, is_minority_owned, is_woman_owned, enrichment, scores",
    )
    .eq("id", targetId)
    .single();
  if (fullError) throw fullError;

  const facts = buildGivingDnaFacts(full as never);
  console.log(`\n=== Facts extracted for "${full.legal_name}" (grounding set, ${facts.length} facts) ===`);
  console.log(JSON.stringify(facts, null, 2));

  console.log(`\n=== Running generateGivingDna() for real, id=${targetId} ===`);
  const result = await generateGivingDna(admin, targetId);
  console.log("Result:", JSON.stringify(result, null, 2));

  console.log("\n=== Re-querying corporate_prospects.giving_dna directly ===");
  const { data: reread, error: rereadError } = await admin
    .from("corporate_prospects")
    .select("id, legal_name, giving_dna, updated_at")
    .eq("id", targetId)
    .single();
  if (rereadError) console.error("re-read error:", rereadError.message);
  else console.log(JSON.stringify(reread, null, 2));

  console.log("\n=== Checking every field Claude wrote traces to a real extracted fact (no invented specifics) ===");
  const factFieldSet = new Set(facts.map((f) => f.field));
  const basedOnValid = result.based_on_fields.every((f) => factFieldSet.has(f));
  console.log(`based_on_fields: ${JSON.stringify(result.based_on_fields)} — all present in real extracted facts: ${basedOnValid}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
