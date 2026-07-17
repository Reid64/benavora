// ============================================================================
// BENAVORA — batch grant probability scoring (AG-15 / Pillar 5)
//
// Finds every opportunity, across all orgs, whose opportunity_probability_scores
// row is missing or whose computed_at is older than 7 days, and calls
// computeGrantProbability() (src/lib/intelligence/grant-probability-engine.ts)
// for each one with a 100ms delay between calls. Progress is logged every 50
// records. Since computeGrantProbability() upserts computed_at = now() on
// every run, a scored row drops out of the "stale" set for another 7 days —
// no separate on-disk checkpoint is needed to resume a killed run.
//
//   pnpm score:opportunities
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { subDays } from "date-fns";

import { createAdminClient } from "../src/lib/supabase/admin";
import { computeGrantProbability } from "../src/lib/intelligence/grant-probability-engine";

const PAGE_SIZE = 1000;
const DELAY_MS = 100;
const LOG_EVERY = 50;
const STALE_AFTER_DAYS = 7;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

interface OpportunityRow {
  id: string;
  organization_id: string;
}

interface ScoreRow {
  opportunity_id: string;
  computed_at: string | null;
}

async function fetchAllOpportunities(
  admin: ReturnType<typeof createAdminClient>,
): Promise<OpportunityRow[]> {
  const rows: OpportunityRow[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await admin
      .from("opportunities")
      .select("id, organization_id")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      fatal(`could not query opportunities: ${error.message}`);
    }

    const batch = (data ?? []) as OpportunityRow[];
    rows.push(...batch);

    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function fetchAllScores(
  admin: ReturnType<typeof createAdminClient>,
): Promise<Map<string, string | null>> {
  const scores = new Map<string, string | null>();
  let from = 0;

  for (;;) {
    const { data, error } = await admin
      .from("opportunity_probability_scores")
      .select("opportunity_id, computed_at")
      .order("opportunity_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      fatal(`could not query opportunity_probability_scores: ${error.message}`);
    }

    const batch = (data ?? []) as ScoreRow[];
    for (const row of batch) {
      scores.set(row.opportunity_id, row.computed_at);
    }

    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return scores;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const admin = createAdminClient();

  console.log("Batch grant probability scoring — all organizations");
  console.log(
    `Population: opportunities with no score row, or computed_at older than ${STALE_AFTER_DAYS} days\n`,
  );

  const [opportunities, scores] = await Promise.all([
    fetchAllOpportunities(admin),
    fetchAllScores(admin),
  ]);

  const staleThreshold = subDays(new Date(), STALE_AFTER_DAYS);

  const toScore = opportunities.filter((opp) => {
    const computedAt = scores.get(opp.id);
    if (scores.get(opp.id) === undefined) return true; // no row at all
    if (!computedAt) return true;
    return new Date(computedAt) < staleThreshold;
  });

  console.log(`  Total opportunities:   ${opportunities.length}`);
  console.log(`  Due for scoring:       ${toScore.length}\n`);

  let scored = 0;
  let failed = 0;

  for (const opp of toScore) {
    try {
      await computeGrantProbability(opp.id, opp.organization_id, admin);
      scored++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ opportunity ${opp.id}: ${message}`);
    }

    const processed = scored + failed;
    if (processed % LOG_EVERY === 0) {
      console.log(
        `  … processed ${processed}/${toScore.length}, scored ${scored}, failed ${failed}`,
      );
    }

    await sleep(DELAY_MS);
  }

  console.log("\nDone.");
  console.log(`  Opportunities scored:  ${scored}`);
  console.log(`  Failed:                ${failed}`);
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
