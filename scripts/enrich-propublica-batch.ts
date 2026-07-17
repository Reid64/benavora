// ============================================================================
// BENAVORA — foundation_directory ProPublica batch enrichment
//
// Reads foundation_directory rows where enrichment->>'propublica_enriched_at'
// IS NULL AND ein IS NOT NULL, calls enrichFoundationFromProPublica() (in
// src/lib/sources/propublica-990-client.ts) for each EIN with a 350ms delay
// between calls, and upserts the result into that row's enrichment jsonb —
// nested under enrichment.propublica (sibling to whatever other enrichment
// sources have already written there, e.g. the 990/web scripts' own keys),
// stamping enrichment.propublica_enriched_at.
//
// Processed in batches of 200. Since propublica_enriched_at flips from null
// to a timestamp as soon as a row is written, an already-enriched row drops
// out of the WHERE filter on the very next query — no separate on-disk
// checkpoint is needed to resume a killed run, the database IS the
// checkpoint. A row ProPublica has no record for is left unstamped and will
// be retried on the next invocation.
//
//   pnpm enrich:propublica-batch
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";
import { enrichFoundationFromProPublica } from "../src/lib/sources/propublica-990-client";

function ok(step: string, detail: string) {
  console.log(`  ✓ ${step}: ${detail}`);
}

function fail(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`  ✗ ${step}: ${message}`);
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

const BATCH_SIZE = 200;
const DELAY_MS = 350;
const LOG_EVERY = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FoundationRow {
  id: string;
  ein: string;
  enrichment: Record<string, unknown> | null;
}

async function fetchNextBatch(
  admin: ReturnType<typeof createAdminClient>,
): Promise<FoundationRow[]> {
  const { data, error } = await admin
    .from("foundation_directory")
    .select("id, ein, enrichment")
    .is("enrichment->>propublica_enriched_at", null)
    .not("ein", "is", null)
    .order("id", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    fatal(`could not query foundation_directory: ${error.message}`);
  }

  return (data ?? []) as FoundationRow[];
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const admin = createAdminClient();

  console.log("ProPublica batch enrichment — foundation_directory");
  console.log("Population: enrichment->>'propublica_enriched_at' IS NULL AND ein IS NOT NULL");
  console.log(`Batch size: ${BATCH_SIZE}\n`);

  let scanned = 0;
  let enriched = 0;
  let noRecord = 0;
  let failed = 0;

  for (;;) {
    const batch = await fetchNextBatch(admin);
    if (batch.length === 0) break;

    for (const row of batch) {
      scanned++;

      try {
        const result = await enrichFoundationFromProPublica(row.ein);

        if (!result) {
          noRecord++;
        } else {
          const existingEnrichment = row.enrichment ?? {};
          const nowIso = new Date().toISOString();
          const enrichment = {
            ...existingEnrichment,
            propublica: result,
            propublica_enriched_at: nowIso,
          };

          const { error: updateError } = await admin
            .from("foundation_directory")
            .update({ enrichment })
            .eq("id", row.id);

          if (updateError) {
            failed++;
            fail(`update EIN ${row.ein}`, updateError);
          } else {
            enriched++;
            ok(row.ein, `revenue=${result.totrevenue ?? "n/a"} assets=${result.totassetsend ?? "n/a"}`);
          }
        }
      } catch (err) {
        failed++;
        fail(`enrich EIN ${row.ein}`, err);
      }

      if (scanned % LOG_EVERY === 0) {
        console.log(
          `  … scanned ${scanned}, enriched ${enriched}, no-record ${noRecord}, failed ${failed}`,
        );
      }

      await sleep(DELAY_MS);
    }
  }

  console.log("\nDone.");
  console.log(`  Rows scanned:          ${scanned}`);
  console.log(`  Enriched:              ${enriched}`);
  console.log(`  No ProPublica record:  ${noRecord}`);
  console.log(`  Failed:                ${failed}`);
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
