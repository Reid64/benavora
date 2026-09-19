// ============================================================================
// AR-17.5 — one-time retroactive recompute of every existing
// opportunity_probability_scores row through the fixed
// computeGrantProbability() (src/lib/intelligence/grant-probability-engine.ts).
//
// Why this exists, distinct from scripts/batch-score-opportunities.ts: that
// script only recomputes rows missing a score or older than 7 days. Every
// AR-17.2 DEGENERATE row was recently computed (not stale), so the nightly
// job would not naturally correct them for up to 7 days. This script ignores
// staleness and recomputes every row that exists today, once, so the AR-17.5
// fix's effect on the live distribution can be measured immediately rather
// than waited on. Same upsert path, same rate limit, as the nightly script —
// this does not delete or bypass anything, it only forces each row through
// the corrected formula it was already due to be recomputed with.
//
//   pnpm exec tsx scripts/audit/ar175-recompute-probability-scores.ts
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

import { computeGrantProbability } from "../../src/lib/intelligence/grant-probability-engine";

const PAGE_SIZE = 1000;
const DELAY_MS = 75;
const LOG_EVERY = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

interface ScoreRow {
  opportunity_id: string;
  organization_id: string;
}

async function fetchAllScoredPairs(admin: SupabaseClient): Promise<ScoreRow[]> {
  const rows: ScoreRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("opportunity_probability_scores")
      .select("opportunity_id, organization_id")
      .order("opportunity_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) fatal(`could not query opportunity_probability_scores: ${error.message}`);
    const batch = (data ?? []) as ScoreRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    realtime: { transport: ws as any },
  });

  console.log("AR-17.5 — retroactive recompute of every opportunity_probability_scores row\n");

  const pairs = await fetchAllScoredPairs(admin);
  console.log(`  Rows to recompute: ${pairs.length}\n`);

  let scored = 0;
  let insufficientData = 0;
  let failed = 0;

  for (const pair of pairs) {
    try {
      const result = await computeGrantProbability(pair.opportunity_id, pair.organization_id, admin);
      scored++;
      if (result.status === "insufficient_data") insufficientData++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  x opportunity ${pair.opportunity_id} / org ${pair.organization_id}: ${message}`);
    }

    const processed = scored + failed;
    if (processed % LOG_EVERY === 0) {
      console.log(
        `  ... processed ${processed}/${pairs.length}, scored ${scored} (insufficient_data ${insufficientData}), failed ${failed}`,
      );
    }

    await sleep(DELAY_MS);
  }

  console.log("\nDone.");
  console.log(`  Recomputed:         ${scored}`);
  console.log(`  -> insufficient_data: ${insufficientData}`);
  console.log(`  -> scored (real number): ${scored - insufficientData}`);
  console.log(`  Failed:              ${failed}`);
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
