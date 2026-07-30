// ============================================================================
// BENAVORA — nonprofit contact-extraction universal-scraper-v2 template CLI
// (src/lib/scraper-v2/templates/nonprofit-contact-template.ts,
//  UNIVERSAL_SCRAPER_PRD.md §4)
//
//   pnpm scrape:nonprofits-v2
//
// Env:
//   TEMPLATE_LIMIT — max nonprofits rows to process this run (default 25)
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { runNonprofitContactTemplate } from "../src/lib/scraper-v2/templates/nonprofit-contact-template";

const LIMIT = Number(process.env["TEMPLATE_LIMIT"] ?? "25");

async function main(): Promise<void> {
  if (!Number.isFinite(LIMIT) || LIMIT <= 0) {
    console.error(`FATAL: TEMPLATE_LIMIT must be a positive number, got: ${process.env["TEMPLATE_LIMIT"]}`);
    process.exit(1);
  }

  console.log(`Nonprofit contact template — limit=${LIMIT}\n`);

  const result = await runNonprofitContactTemplate(LIMIT);

  console.log("\n=== SUMMARY ===");
  console.log(`job id:            ${result.jobId}${result.mocked ? " (MOCK -- scrape_jobs unreachable, see scrape-output/)" : " (real DB row)"}`);
  console.log(`candidates loaded: ${result.candidateCount}`);
  console.log(`processed:         ${result.processed}`);
  console.log(`urls discovered:   ${result.urlsDiscovered}`);
  console.log(`updated:           ${result.updated}`);
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
