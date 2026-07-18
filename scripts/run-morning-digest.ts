// ============================================================================
// BENAVORA — morning digest runner (AGENTS_v2.md AG-17 nightly pipeline's
// final step, "7:00 AM — Morning digest notification sent to users")
//
// Calls sendMorningDigest() (src/lib/agents/morning-digest.ts) for every
// organization that has completed onboarding, rolling up the last 24 hours
// of discovery matches plus current reputation alerts, relationship
// recommendations, and near-term deadlines into a single alert per org.
//
//   pnpm run:morning-digest
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

import { sendMorningDigest } from "../src/lib/agents/morning-digest";

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

  console.log("Morning digest runner — all active organizations\n");

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

  let sent = 0;
  let failed = 0;

  for (const org of orgs) {
    try {
      await sendMorningDigest(org.id, admin);
      sent++;
      console.log(`  ✓ ${org.name}`);
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${org.name}: ${message}`);
    }
  }

  console.log("\nDone.");
  console.log(`  Organizations processed: ${orgs.length}`);
  console.log(`  Digests sent:            ${sent}`);
  console.log(`  Failed:                  ${failed}`);
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
