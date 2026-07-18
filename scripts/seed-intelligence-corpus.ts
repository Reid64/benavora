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

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

import { seedIntelligenceCorpus } from "./lib/seed-intelligence-corpus-data";

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    // ws's WebSocket type isn't structurally identical to realtime-js's
    // WebSocketLikeConstructor (event handler signatures differ); runtime
    // behavior is unaffected. Same pattern as scripts/batch-score-opportunities.ts.
    realtime: { transport: ws as any },
  });

  await seedIntelligenceCorpus(supabase);
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
