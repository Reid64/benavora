// ============================================================================
// BENAVORA — Digital Twin batch builder (AG-16 / Pillar 6)
//
// Rebuilds the Organizational Digital Twin (src/lib/intelligence/digital-twin-builder.ts)
// for every organization that has completed onboarding. Calls the same
// buildDigitalTwin() the AG-16 agent uses, so results and the
// organizational_digital_twins upsert are produced exactly as an on-demand
// rebuild would produce them. 1s delay between orgs; logs org name and
// twin_completeness_score per org.
//
//   pnpm build:twins
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

import { buildDigitalTwin } from "../src/lib/intelligence/digital-twin-builder";

const DELAY_MS = 1000;

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

  console.log("Digital Twin batch builder — all onboarded organizations\n");

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

  let succeeded = 0;
  let failed = 0;

  for (const org of orgs) {
    try {
      const twin = await buildDigitalTwin(org.id, admin);
      succeeded++;
      console.log(
        `  ✓ ${org.name}: completeness ${twin.twin_completeness_score}`,
      );
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${org.name}: ${message}`);
    }

    await sleep(DELAY_MS);
  }

  console.log("\nDone.");
  console.log(`  Organizations processed: ${orgs.length}`);
  console.log(`  Succeeded:               ${succeeded}`);
  console.log(`  Failed:                  ${failed}`);
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
