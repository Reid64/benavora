// ============================================================================
// BENAVORA — IRS 990 foundation-enrichment universal-scraper-v2 template CLI
// (src/lib/scraper-v2/templates/foundation-990-template.ts,
//  UNIVERSAL_SCRAPER_PRD.md §4)
//
//   pnpm scrape:foundations-v2
//
// Env:
//   TEMPLATE_LIMIT — max foundation_directory rows to process this run
//                    (default 25)
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { runFoundation990Template } from "../src/lib/scraper-v2/templates/foundation-990-template";

const LIMIT = Number(process.env["TEMPLATE_LIMIT"] ?? "25");

async function main(): Promise<void> {
  if (!Number.isFinite(LIMIT) || LIMIT <= 0) {
    console.error(`FATAL: TEMPLATE_LIMIT must be a positive number, got: ${process.env["TEMPLATE_LIMIT"]}`);
    process.exit(1);
  }

  console.log(`Foundation 990 template — limit=${LIMIT}\n`);

  const result = await runFoundation990Template(LIMIT);

  console.log("\n=== SUMMARY ===");
  console.log(`job id:            ${result.jobId}${result.mocked ? " (MOCK -- scrape_jobs unreachable, see scrape-output/)" : " (real DB row)"}`);
  console.log(`candidates loaded: ${result.candidateCount}`);
  console.log(`EIN index matched: ${result.einIndexMatched}`);
  console.log(`processed:         ${result.processed}`);
  console.log(`enriched:          ${result.enriched}`);
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
