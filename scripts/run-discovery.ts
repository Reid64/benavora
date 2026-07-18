// ============================================================================
// BENAVORA — opportunity discovery runner (AGENTS_v2.md AG-17, "2:00 AM —
// Opportunity Discovery")
//
// Calls runOpportunityDiscovery() (src/lib/agents/opportunity-discovery-agent.ts)
// for every organization that has completed onboarding, sweeping Grants.gov,
// SAM.gov, and the Federal Register and staging mission-fit matches in
// discovery_matches. Waits 2 seconds between orgs to stay polite to the
// upstream source APIs.
//
//   pnpm run:discovery
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

import { runOpportunityDiscovery } from "../src/lib/agents/opportunity-discovery-agent";

const DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  console.log("Opportunity discovery runner — all active organizations\n");

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

  for (let i = 0; i < orgs.length; i++) {
    const org = orgs[i];
    try {
      const summary = await runOpportunityDiscovery(org.id, admin);
      totalFound += summary.found;
      totalMatched += summary.matched;
      console.log(
        `  ✓ ${org.name}: found ${summary.found}, matched ${summary.matched}`,
      );
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${org.name}: ${message}`);
    }

    if (i < orgs.length - 1) {
      await sleep(DELAY_MS);
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
