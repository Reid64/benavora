// ============================================================================
// BENAVORA — Backfill intelligence_funded_proposals structured columns
//
// Populates funder_type, ntee_major, success_factors, and keywords on all
// existing rows from data already present (funder_name text match, the
// category text[] column, and metadata jsonb) after migration 106
// (106_intelligence_library_schema_upgrade.sql) has added the new columns.
//
// DO NOT RUN until migration 106 has been applied to production via the
// Supabase SQL Editor -- these columns do not exist on
// intelligence_funded_proposals as of 2026-07-20 (confirmed: no working
// Management API PAT or MCP connector access this session, see that
// migration's header). Running this against the live table before the
// migration lands will fail with "column does not exist" on the first
// .update() call.
//
//   npx tsx scripts/backfill-intelligence-library-columns.ts
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

interface ExistingRow {
  id: string;
  funder_name: string | null;
  category: string[] | null;
  metadata: Record<string, unknown> | null;
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

/** Matches the task-given funder_type classification rules exactly. */
function classifyFunderType(funderName: string | null): string {
  if (!funderName) return "foundation";
  const name = funderName.toUpperCase();
  const federalMarkers = ["HUD", "HHS", "DOJ", "VA", "USDA", "NIH", "NSF", "CDC", "DEPARTMENT", "FEDERAL"];
  if (federalMarkers.some((marker) => name.includes(marker))) return "federal";
  if (name.includes("FOUNDATION")) return "foundation";
  const corporateMarkers = ["BANK", "CORP", "INC", "LLC"];
  if (corporateMarkers.some((marker) => name.includes(marker))) return "corporate";
  return "foundation";
}

/** category (text[]) carries the NTEE major letter as a single-char entry — see seed-intelligence-library.ts. */
function extractNteeMajor(category: string[] | null): string | null {
  if (!category) return null;
  const letter = category.find((c) => c.length === 1 && /^[A-Z]$/.test(c));
  return letter ?? null;
}

function extractMetaStringArray(metadata: Record<string, unknown> | null, field: string): unknown[] {
  if (!metadata) return [];
  const value = metadata[field];
  return Array.isArray(value) ? value : [];
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    realtime: { transport: ws as any },
  });

  console.log("Loading all intelligence_funded_proposals rows...");
  const { data, error } = await supabase
    .from("intelligence_funded_proposals")
    .select("id, funder_name, category, metadata");

  if (error) {
    fatal(
      `Failed to load rows: ${error.message}. If this says the column does not exist, migration 106 ` +
        `has not been applied to production yet -- run supabase/migrations/106_intelligence_library_schema_upgrade.sql ` +
        `via the Supabase SQL Editor first.`,
    );
  }

  const rows = (data ?? []) as ExistingRow[];
  console.log(`  ${rows.length} row(s) found.\n`);

  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    const funderType = classifyFunderType(row.funder_name);
    const nteeMajor = extractNteeMajor(row.category);
    const successFactors = extractMetaStringArray(row.metadata, "success_factors");
    const keywords = extractMetaStringArray(row.metadata, "keywords");

    const { error: updateError } = await supabase
      .from("intelligence_funded_proposals")
      .update({
        funder_type: funderType,
        ntee_major: nteeMajor,
        success_factors: successFactors,
        keywords: keywords,
      })
      .eq("id", row.id);

    if (updateError) {
      console.error(`  Failed to update ${row.id}: ${updateError.message}`);
      failed += 1;
      continue;
    }
    updated += 1;
  }

  console.log(`\nBackfill complete: ${updated} row(s) updated, ${failed} failed.`);
}

main().catch((error) => {
  fatal(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
