// ============================================================================
// BENAVORA — foundation directory scraper CLI runner
// (src/lib/scraper/foundation-scraper.ts, STANDING_DIRECTIVES.md Directive 1)
//
//   pnpm scrape:foundations
//
// Env:
//   SCRAPER_START_OFFSET — row offset into foundation_directory to start at
//                          (default 0)
//   SCRAPER_BATCH_LIMIT  — max foundations to process this run (default 10000)
//
// Deviation, documented per project convention: runFoundationScraper() owns
// and initializes its own pool of StealthEngine instances internally (see
// foundation-scraper.ts's EnginePool) — it does not accept an engine instance
// as an argument. Constructing a second, separate StealthEngine here that
// runFoundationScraper() never touches would be dead code, so this script
// calls runFoundationScraper() directly and lets it manage its own engines.
//
// Because this script always passes an explicit startOffset (defaulting to
// 0), runFoundationScraper() always begins from a fresh checkpoint object
// (see loadCheckpoint() in foundation-scraper.ts) — so the processed/enriched
// counts read back from the checkpoint file after the run are this run's
// totals, not a cumulative figure across prior invocations of this script.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { runFoundationScraper } from "../src/lib/scraper/foundation-scraper";
import { backupEnrichmentOutput } from "./backup-enrichment-output";

const OUTPUT_DIR = path.resolve("./enrichment-output");
const CHECKPOINT_FILE = path.join(OUTPUT_DIR, "scraper-checkpoint.json");
const STATS_FILE = path.join(OUTPUT_DIR, "scraper-stats.json");

const START_OFFSET = Number(process.env["SCRAPER_START_OFFSET"] ?? "0");
const BATCH_LIMIT = Number(process.env["SCRAPER_BATCH_LIMIT"] ?? "10000");

interface StrategyCounts {
  irs990: number;
  google: number;
  contactPage: number;
}

interface Checkpoint {
  offset: number;
  processed: number;
  enriched: number;
  strategyCounts: StrategyCounts;
  startedAt: string;
  updatedAt: string;
}

function readCheckpoint(): Checkpoint | null {
  if (!fs.existsSync(CHECKPOINT_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8")) as Checkpoint;
  } catch {
    return null;
  }
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const backup = await backupEnrichmentOutput();
  if (!backup.ok) console.warn(`[backup] ${backup.reason}`);

  if (!Number.isFinite(START_OFFSET) || START_OFFSET < 0) {
    fatal(`SCRAPER_START_OFFSET must be a non-negative number, got: ${process.env["SCRAPER_START_OFFSET"]}`);
  }
  if (!Number.isFinite(BATCH_LIMIT) || BATCH_LIMIT <= 0) {
    fatal(`SCRAPER_BATCH_LIMIT must be a positive number, got: ${process.env["SCRAPER_BATCH_LIMIT"]}`);
  }

  console.log(`Foundation scraper — startOffset=${START_OFFSET}, batchLimit=${BATCH_LIMIT}\n`);

  const startCounts = readCheckpoint();
  console.log(
    `  Before this run: processed=${startCounts?.processed ?? 0}, enriched=${startCounts?.enriched ?? 0} (from prior checkpoint, if any)\n`,
  );

  await runFoundationScraper(START_OFFSET, BATCH_LIMIT);

  const checkpoint = readCheckpoint();
  const processed = checkpoint?.processed ?? 0;
  const enriched = checkpoint?.enriched ?? 0;
  const strategyCounts = checkpoint?.strategyCounts ?? { irs990: 0, google: 0, contactPage: 0 };
  const enrichmentRate = processed > 0 ? enriched / processed : 0;
  const nextOffset = checkpoint?.offset ?? START_OFFSET;

  console.log("\nDone.");
  console.log(`  Start offset:     ${START_OFFSET}`);
  console.log(`  End offset:       ${nextOffset}`);
  console.log(`  Processed:        ${processed}`);
  console.log(`  Enriched:         ${enriched}`);
  console.log(`  Enrichment rate:  ${(enrichmentRate * 100).toFixed(1)}%`);
  console.log(
    `  Strategies:       irs990=${strategyCounts.irs990}, google=${strategyCounts.google}, contactPage=${strategyCounts.contactPage}`,
  );

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stats = {
    lastRunAt: new Date().toISOString(),
    startOffset: START_OFFSET,
    batchLimit: BATCH_LIMIT,
    nextOffset,
    processed,
    enriched,
    enrichmentRate,
    strategyCounts,
  };
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  console.log(`\nStats written to ${STATS_FILE}`);
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
