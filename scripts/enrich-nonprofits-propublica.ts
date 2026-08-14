// ============================================================================
// BENAVORA — donor_discovery_directory ProPublica financial enrichment
//
// Walks donor_discovery_directory rows with civic_kind = 'nonprofit_501c3'
// (the population written by scripts/ingest-irs-bmf-full.ts) whose
// enrichment.propublica_enriched_at is unset, and for each one calls
// enrichOrganizationByEin() (src/lib/donor-discovery/adapters/propublica-adapter.ts)
// to pull total_revenue, total_expenses, total_assets, ntee_code,
// ntee_description, filing_year, form_type, and pdf_url from ProPublica's
// free /organizations/{ein}.json endpoint, and write them into that row's
// enrichment jsonb.
//
// Batches of 100, paged by a `id > cursor` cursor (not offset/limit) — a
// directory row's enrichment.propublica_enriched_at flips from null to a
// timestamp as soon as it's enriched, so it drops out of the WHERE filter on
// the very next page query. Paging by id instead of always re-querying page
// zero means a row that fails enrichment (e.g. no ProPublica record for that
// EIN) still gets passed over on the next page within this run rather than
// being re-selected forever and hanging the batch loop.
//
// Rate limiting (1 req/s, BEHAVIORAL_CONTRACTS.md §19) lives inside the
// adapter, not here — this script just drives it row by row.
//
// Resumable: writes ./enrichment-output/propublica-checkpoint.json after
// every batch (last cursor id + running totals). Re-running picks up from
// the checkpoint's cursor instead of re-scanning rows already enriched.
//
//   pnpm enrich:propublica
// ============================================================================

import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv.config({ path: ".env.local" });

import { createAdminClient } from "@/lib/supabase/admin";
import { enrichOrganizationByEin } from "../src/lib/donor-discovery/adapters/propublica-adapter";
import { backupEnrichmentOutput } from "./backup-enrichment-output";

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

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------
const BATCH_SIZE = 100;
const CIVIC_KIND = "nonprofit_501c3";

const OUTPUT_DIR = path.resolve("./enrichment-output");
const CHECKPOINT_FILE = path.join(OUTPUT_DIR, "propublica-checkpoint.json");

// ----------------------------------------------------------------------------
// Checkpoint
// ----------------------------------------------------------------------------
interface CheckpointTotals {
  scanned: number;
  enriched: number;
  skippedFresh: number;
  skippedNoEin: number;
  failed: number;
}

interface Checkpoint {
  cursor: string | null;
  totals: CheckpointTotals;
  startedAt: string;
}

function loadCheckpoint(): Checkpoint | null {
  if (!fs.existsSync(CHECKPOINT_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8")) as Checkpoint;
  } catch (error) {
    fail("read checkpoint", error);
    return null;
  }
}

function saveCheckpoint(cp: Checkpoint) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

function logProgress(cp: Checkpoint) {
  console.log(
    `  … scanned ${cp.totals.scanned}, enriched ${cp.totals.enriched}, ` +
      `skipped-fresh ${cp.totals.skippedFresh}, skipped-no-ein ${cp.totals.skippedNoEin}, ` +
      `failed ${cp.totals.failed}`,
  );
}

// ----------------------------------------------------------------------------
// Batch fetch — one page of unenriched nonprofit_501c3 rows after `cursor`.
// ----------------------------------------------------------------------------
interface DirectoryBatchRow {
  id: string;
  legal_name: string;
  enrichment: Record<string, unknown> | null;
}

async function fetchNextBatch(
  admin: ReturnType<typeof createAdminClient>,
  cursor: string | null,
): Promise<DirectoryBatchRow[]> {
  let query = admin
    .from("donor_discovery_directory")
    .select("id, legal_name, enrichment")
    .eq("civic_kind", CIVIC_KIND)
    .is("enrichment->>propublica_enriched_at", null)
    .order("id", { ascending: true })
    .limit(BATCH_SIZE);

  if (cursor) {
    query = query.gt("id", cursor);
  }

  const { data, error } = await query;
  if (error) {
    fatal(`could not query donor_discovery_directory: ${error.message}`);
  }

  return (data ?? []) as DirectoryBatchRow[];
}

function extractEin(enrichment: Record<string, unknown> | null): string | null {
  const raw = enrichment?.ein;
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const cleaned = String(raw).replace(/\D/g, "");
  return cleaned || null;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  const backup = await backupEnrichmentOutput();
  if (!backup.ok) console.warn(`[backup] ${backup.reason}`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  console.log("ProPublica financial enrichment — donor_discovery_directory");
  console.log(`Population: civic_kind = '${CIVIC_KIND}', enrichment.propublica_enriched_at IS NULL`);
  console.log(`Batch size: ${BATCH_SIZE}\n`);

  const admin = createAdminClient();

  const resumeFrom = loadCheckpoint();
  const cp: Checkpoint = resumeFrom ?? {
    cursor: null,
    totals: { scanned: 0, enriched: 0, skippedFresh: 0, skippedNoEin: 0, failed: 0 },
    startedAt: new Date().toISOString(),
  };
  if (resumeFrom) {
    console.log(`Resuming from checkpoint: cursor ${cp.cursor ?? "(start)"}, ${cp.totals.enriched} already enriched.\n`);
  }

  for (;;) {
    const batch = await fetchNextBatch(admin, cp.cursor);
    if (batch.length === 0) break;

    for (const row of batch) {
      cp.totals.scanned++;
      cp.cursor = row.id;

      const ein = extractEin(row.enrichment);
      if (!ein) {
        cp.totals.skippedNoEin++;
        continue;
      }

      try {
        const result = await enrichOrganizationByEin(row.id, ein);
        if (result.skipped) {
          if (result.skipReason === "fresh_within_90_days") cp.totals.skippedFresh++;
          else cp.totals.skippedNoEin++;
        } else {
          cp.totals.enriched++;
        }
      } catch (error) {
        cp.totals.failed++;
        fail(`enrich "${row.legal_name}" (EIN ${ein})`, error);
      }
    }

    saveCheckpoint(cp);
    logProgress(cp);
  }

  console.log("\nDone.");
  console.log(`  Rows scanned:          ${cp.totals.scanned}`);
  console.log(`  Enriched:              ${cp.totals.enriched}`);
  console.log(`  Skipped (fresh):       ${cp.totals.skippedFresh}`);
  console.log(`  Skipped (no EIN):      ${cp.totals.skippedNoEin}`);
  console.log(`  Failed:                ${cp.totals.failed}`);
  console.log(`\n  Checkpoint: ${CHECKPOINT_FILE}`);
  ok("enrich:propublica", "complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
