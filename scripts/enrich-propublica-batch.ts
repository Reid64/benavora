// ============================================================================
// BENAVORA — foundation_directory ProPublica batch enrichment
//
// Reads up to 1000 foundation_directory rows with asset_amount IS NULL,
// queries ProPublica's free /organizations/{ein}.json endpoint
// (src/lib/sources/propublica-990-client.ts) for each EIN with a 300ms delay
// between calls, and upserts asset_amount / revenue_amount back by ein.
//
//   pnpm enrich:propublica-batch
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";
import { fetchProPublicaFinancials } from "../src/lib/sources/propublica-990-client";

function ok(step: string, detail: string) {
  console.log(`  ✓ ${step}: ${detail}`);
}

function fail(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`  ✗ ${step}: ${message}`);
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

const BATCH_LIMIT = 1000;
const DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FoundationRow {
  id: string;
  ein: string;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("foundation_directory")
    .select("id, ein")
    .is("asset_amount", null)
    .limit(BATCH_LIMIT);

  if (error) {
    fatal(`could not query foundation_directory: ${error.message}`);
  }

  const rows = (data ?? []) as FoundationRow[];
  console.log(`ProPublica batch enrichment — foundation_directory`);
  console.log(`Population: asset_amount IS NULL, limit ${BATCH_LIMIT}`);
  console.log(`Rows to process: ${rows.length}\n`);

  let enriched = 0;
  let noRecord = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const financials = await fetchProPublicaFinancials(row.ein);
      if (!financials) {
        noRecord++;
        continue;
      }

      const { error: updateError } = await admin
        .from("foundation_directory")
        .update({
          asset_amount: financials.totalAssets,
          revenue_amount: financials.totalRevenue,
        })
        .eq("id", row.id);

      if (updateError) {
        failed++;
        fail(`update EIN ${row.ein}`, updateError);
      } else {
        enriched++;
        ok(row.ein, `assets=${financials.totalAssets ?? "n/a"} revenue=${financials.totalRevenue ?? "n/a"}`);
      }
    } catch (err) {
      failed++;
      fail(`enrich EIN ${row.ein}`, err);
    }

    await sleep(DELAY_MS);
  }

  console.log("\nDone.");
  console.log(`  Rows processed: ${rows.length}`);
  console.log(`  Enriched:       ${enriched}`);
  console.log(`  No ProPublica record: ${noRecord}`);
  console.log(`  Failed:         ${failed}`);
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
