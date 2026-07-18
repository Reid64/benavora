// ============================================================================
// BENAVORA — Knowledge Engine patterns seed script (Pillar 18)
//
// Inserts 30 curated knowledge_patterns rows (migration 096) covering real
// grant-writing intelligence: narrative patterns, timing patterns, budget
// patterns, funder-specific patterns (HUD/USDA/NIH/DOJ/NSF), and competitive
// intelligence patterns.
//
// Data + seeding logic live in scripts/lib/seed-knowledge-patterns-data.ts,
// shared with scripts/populate-all-data.ts.
//
//   pnpm seed:patterns
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

import { ALL_PATTERNS, seedKnowledgePatterns } from "./lib/seed-knowledge-patterns-data";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws as unknown as typeof WebSocket },
});

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

async function main() {
  console.log("Knowledge Engine patterns seed — 30 curated grant-writing intelligence patterns\n");

  await seedKnowledgePatterns(admin);

  const byType = new Map<string, number>();
  for (const p of ALL_PATTERNS) {
    byType.set(p.pattern_type, (byType.get(p.pattern_type) ?? 0) + 1);
  }
  console.log("\nBreakdown by pattern_type:");
  for (const [type, count] of byType.entries()) {
    console.log(`  ${type}: ${count}`);
  }
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
