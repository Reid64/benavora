// ============================================================================
// BENAVORA — batch eligibility scoring (AGENTS.md Agent 02)
//
// Finds every opportunity, across all orgs, with eligibility_score IS NULL and
// organization_id IS NOT NULL, and runs it through the real EligibilityScorer
// agent (src/lib/agents/eligibility-scorer.ts) — the same class the
// /api/agents/eligibility route uses — so the score, recommendation, match
// percentage, and agent_runs log are produced exactly as a user-triggered run
// would produce them. 500ms delay between calls; progress logged every 25.
//
//   pnpm score:eligibility
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { EligibilityScorer } from "@/lib/agents/eligibility-scorer";

const PAGE_SIZE = 1000;
const DELAY_MS = 500;
const LOG_EVERY = 25;

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

async function fetchUnscoredOpportunities(
  admin: SupabaseClient,
): Promise<OpportunityRow[]> {
  const rows: OpportunityRow[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await admin
      .from("opportunities")
      .select("id, organization_id")
      .is("eligibility_score", null)
      .not("organization_id", "is", null)
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

async function main() {
  const admin = createAdminClient();

  console.log("Batch eligibility scoring — all organizations");
  console.log(
    "Population: opportunities with eligibility_score IS NULL and organization_id IS NOT NULL\n",
  );

  const toScore = await fetchUnscoredOpportunities(admin);
  console.log(`  Due for scoring: ${toScore.length}\n`);

  let scored = 0;
  let failed = 0;

  for (const opp of toScore) {
    try {
      const scorer = new EligibilityScorer({
        client: admin,
        organizationId: opp.organization_id,
        triggeredBy: null,
      });
      await scorer.run({ opportunityId: opp.id });
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
