// ============================================================================
// BENAVORA — foundation_directory ProPublica full-corpus enrichment
//
// Long-running CLI companion to scripts/enrich-propublica-batch.ts. Same
// population and enrichment.jsonb merge shape (enrichment.propublica +
// enrichment.propublica_enriched_at via enrichFoundationFromProPublica() in
// src/lib/sources/propublica-990-client.ts), but additionally backfills the
// physical foundation_directory.asset_amount column from the filing's
// totassetsend when the column is currently null. There is no website field
// in ProPublica's org-detail response (confirmed against
// enrichFoundationFromProPublica's return shape), so website_url is left
// untouched — nothing to backfill it from.
//
// Runs in checkpoints of 500 rows, sleeping 400ms between calls. Since
// propublica_enriched_at flips from null to a timestamp as soon as a row is
// written, an enriched row drops out of the WHERE filter on the very next
// query — the database is the checkpoint, so a killed run resumes cleanly.
//
// enrichFoundationFromProPublica() swallows fetch/parse errors into `null`,
// the same value it returns for a genuine "no ProPublica record for this
// EIN" — the two aren't distinguishable from here. Rather than guess at
// error classification, a null result gets one 5s-delayed retry before being
// counted as no-record, which is a harmless no-op for real 404s and a cheap
// safety net for transient network failures.
//
//   pnpm enrich:propublica-foundations
//
// NOTE: registered as `enrich:propublica-foundations`, not `enrich:propublica`
// — that key is already taken by scripts/enrich-nonprofits-propublica.ts,
// which enriches the separate `nonprofits` table. Reusing it would have
// silently broken that existing command.
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

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

const BATCH_SIZE = 500;
const DELAY_MS = 400;
const RETRY_DELAY_MS = 5_000;
const LOG_EVERY = 50;
const TOTAL_POPULATION = 133_812;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FoundationRow {
  id: string;
  ein: string;
  enrichment: Record<string, unknown> | null;
  asset_amount: number | null;
}

async function fetchNextBatch(
  admin: SupabaseClient,
): Promise<FoundationRow[]> {
  const { data, error } = await admin
    .from("foundation_directory")
    .select("id, ein, enrichment, asset_amount")
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

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    // ws's WebSocket type isn't structurally identical to realtime-js's
    // WebSocketLikeConstructor (event handler signatures differ); runtime
    // behavior is unaffected. Same pattern as scripts/batch-score-opportunities.ts.
    realtime: { transport: ws as any },
  });

  console.log("ProPublica full-corpus enrichment — foundation_directory");
  console.log("Population: enrichment->>'propublica_enriched_at' IS NULL AND ein IS NOT NULL");
  console.log(`Batch size: ${BATCH_SIZE}, delay: ${DELAY_MS}ms\n`);

  const startedAt = Date.now();
  let processed = 0;
  let enriched = 0;
  let noRecord = 0;
  let failed = 0;

  for (;;) {
    const batch = await fetchNextBatch(admin);
    if (batch.length === 0) break;

    for (const row of batch) {
      processed++;

      try {
        let result = await enrichFoundationFromProPublica(row.ein);
        if (!result) {
          await sleep(RETRY_DELAY_MS);
          result = await enrichFoundationFromProPublica(row.ein);
        }

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

          const update: Record<string, unknown> = { enrichment };
          if (row.asset_amount === null && result.totassetsend !== null) {
            update.asset_amount = result.totassetsend;
          }

          const { error: updateError } = await admin
            .from("foundation_directory")
            .update(update)
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

      if (processed % LOG_EVERY === 0) {
        const elapsedMin = (Date.now() - startedAt) / 60_000;
        const rate = elapsedMin > 0 ? Math.round(processed / elapsedMin) : 0;
        console.log(
          `Processed ${processed}/${TOTAL_POPULATION} - enriched ${enriched} - failed ${failed} - rate ${rate}/min`,
        );
      }

      await sleep(DELAY_MS);
    }
  }

  console.log("\nDone.");
  console.log(`  Rows processed:        ${processed}`);
  console.log(`  Enriched:              ${enriched}`);
  console.log(`  No ProPublica record:  ${noRecord}`);
  console.log(`  Failed:                ${failed}`);
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
