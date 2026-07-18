// ============================================================================
// BENAVORA — Intelligence Library corpus seed
//
// Seeds intelligence_funded_proposals with 20 hand-written high-quality
// examples (5 each: NIH community health, HUD housing, DOJ justice, USDA
// rural development) to give the Funding Knowledge Engine and Draft
// Generator real narrative material while the live ingestion scripts
// (ingest-nih-reporter.ts, etc.) continue building out the corpus.
//
// Data + seeding logic live in scripts/lib/seed-intelligence-corpus-data.ts,
// shared with scripts/populate-all-data.ts.
//
//   pnpm seed:intelligence
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";
import { seedIntelligenceCorpus } from "./lib/seed-intelligence-corpus-data";

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

async function main() {
  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch (error) {
    fatal(error instanceof Error ? error.message : String(error));
  }

  await seedIntelligenceCorpus(supabase);
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
