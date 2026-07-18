// ============================================================================
// BENAVORA — combined federal source poller (Grants.gov + SAM.gov + Federal
// Register in one pass)
//
// Calls pollFederalSources() (src/lib/sources/federal-grants-poller.ts) for
// every organization that has completed onboarding, syncing new/updated
// opportunities into `opportunities` and logging a per-source result for
// each org.
//
//   pnpm poll:federal
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

import { pollFederalSources } from "../src/lib/sources/federal-grants-poller";

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

interface OrganizationRow {
  id: string;
  name: string;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    // ws's WebSocket type isn't structurally identical to realtime-js's
    // WebSocketLikeConstructor (event handler signatures differ); runtime
    // behavior is unaffected. Same pattern as scripts/batch-score-opportunities.ts.
    realtime: { transport: ws as any },
  });

  console.log("Federal grants poller — all active organizations\n");

  const { data, error } = await admin
    .from("organizations")
    .select("id, name")
    .eq("onboarding_completed", true)
    .order("name", { ascending: true });

  if (error) {
    fatal(`could not query organizations: ${error.message}`);
  }

  const orgs = (data ?? []) as OrganizationRow[];
  console.log(`  Organizations to process: ${orgs.length}\n`);

  let totalFound = 0;
  let totalMatched = 0;
  let failed = 0;

  for (const org of orgs) {
    try {
      const results = await pollFederalSources(org.id, admin);
      console.log(`  ${org.name}:`);
      for (const result of results) {
        totalFound += result.found;
        totalMatched += result.matched;
        console.log(
          `    ✓ ${result.source}: found ${result.found}, matched ${result.matched}`,
        );
      }
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${org.name}: ${message}`);
    }
  }

  console.log("\nDone.");
  console.log(`  Organizations processed: ${orgs.length}`);
  console.log(`  Opportunities found:     ${totalFound}`);
  console.log(`  Opportunities matched:   ${totalMatched}`);
  console.log(`  Failed:                  ${failed}`);
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
