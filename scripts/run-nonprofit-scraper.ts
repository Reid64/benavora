// ============================================================================
// BENAVORA — nonprofit contact scraper CLI runner
// (src/lib/scraper/nonprofit-scraper.ts)
//
//   pnpm scrape:nonprofits
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { runNonprofitScraper } from "../src/lib/scraper/nonprofit-scraper";

async function main(): Promise<void> {
  console.log("Nonprofit contact scraper starting\n");

  const stats = await runNonprofitScraper();

  const enrichmentRate = stats.processed > 0 ? stats.updated / stats.processed : 0;

  console.log("\nDone.");
  console.log(`  Processed:        ${stats.processed}`);
  console.log(`  Updated:          ${stats.updated}`);
  console.log(`  Enrichment rate:  ${(enrichmentRate * 100).toFixed(1)}%`);
  console.log(`  Emails found:     ${stats.emailsFound}`);
  console.log(`  Phones found:     ${stats.phonesFound}`);
  console.log(`  Failed:           ${stats.failed}`);
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
