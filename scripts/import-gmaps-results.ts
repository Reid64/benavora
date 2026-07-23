// ============================================================================
// BENAVORA — Google Maps results importer
//
// Reads CSV output from gosom/google-maps-scraper and matches results
// back to foundation_directory or nonprofits table by name similarity
// + city + state. Writes: website, email, phone, address.
//
// Matching logic:
//   1. Exact name match (case-insensitive) + city + state = high confidence
//   2. Normalized name match (strip Inc/LLC/Foundation etc) = medium confidence
//   3. Write only NULL columns (COALESCE semantics)
//   4. Log all matches for manual review
//
// Run after google-maps-scraper completes:
//   npx tsx scripts/import-gmaps-results.ts --mode=foundations
//   npx tsx scripts/import-gmaps-results.ts --mode=nonprofits
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { parse } from "csv-parse/sync";

// ---- Config -----------------------------------------------------------------
const OUTPUT_DIR = path.join(process.cwd(), "scripts", ".gmaps-queries");
const MATCH_LOG_PATH = path.join(OUTPUT_DIR, "match-log.jsonl");

// Blacklisted domains — never write these as website values
const DIRECTORY_DOMAINS = [
  "guidestar.org", "charitynavigator.org", "give.org", "candid.org",
  "propublica.org", "irs.gov", "facebook.com", "linkedin.com",
  "twitter.com", "instagram.com", "youtube.com", "wikipedia.org",
  "google.com", "yelp.com", "bbb.org", "indeed.com", "glassdoor.com",
  "merriam-webster.com", "roblox.com", "cdc.gov", "microsoft.com",
  "reddit.com", "whatsapp.com", "aa.com", "amazon.com", "apple.com",
];

// ---- Helpers ----------------------------------------------------------------
function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function parseMode(): "foundations" | "nonprofits" {
  const modeArg = process.argv.find((a) => a.startsWith("--mode="));
  const mode = modeArg?.replace("--mode=", "");
  if (mode !== "foundations" && mode !== "nonprofits") {
    console.error("Usage: npx tsx scripts/import-gmaps-results.ts --mode=foundations|nonprofits");
    process.exit(1);
  }
  return mode;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|foundation|charitable|trust|organization|org|association|assoc|the|of|for|and|a|an)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function isBlacklisted(url: string): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  return DIRECTORY_DOMAINS.some((d) => lower.includes(d));
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface GmapsRow {
  title?: string;
  name?: string;
  address?: string;
  full_address?: string;
  city?: string;
  state?: string;
  phone?: string;
  website?: string;
  email?: string;
  emails?: string;
}

interface DbRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
}

async function main() {
  const mode = parseMode();
  const table = mode === "foundations" ? "foundation_directory" : "nonprofits";

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { headers: {} }, realtime: { transport: ws as unknown as typeof WebSocket } }
  );

  // Find all result CSV files for this mode
  const csvFiles = fs.readdirSync(OUTPUT_DIR)
    .filter((f) => f.startsWith(`results-${mode}`) && f.endsWith(".csv"))
    .map((f) => path.join(OUTPUT_DIR, f));

  if (csvFiles.length === 0) {
    log(`No result CSV files found in ${OUTPUT_DIR} for mode=${mode}`);
    log(`Expected files like: results-${mode}-window1.csv`);
    process.exit(1);
  }

  log(`Found ${csvFiles.length} result file(s): ${csvFiles.map((f) => path.basename(f)).join(", ")}`);

  // Parse all CSV files
  let allRows: GmapsRow[] = [];
  for (const csvFile of csvFiles) {
    const content = fs.readFileSync(csvFile, "utf-8");
    const rows = parse(content, { columns: true, skip_empty_lines: true }) as GmapsRow[];
    allRows = allRows.concat(rows);
    log(`Loaded ${rows.length} rows from ${path.basename(csvFile)}`);
  }

  log(`Total Google Maps results: ${allRows.length}`);

  // Filter out blacklisted domains immediately
  const validRows = allRows.filter((r) => {
    const website = r.website || "";
    return website && !isBlacklisted(website);
  });

  log(`Valid rows after blacklist filter: ${validRows.length} (removed ${allRows.length - validRows.length})`);

  // Group by city+state for efficient DB lookup
  const cityStateGroups = new Map<string, GmapsRow[]>();
  for (const row of validRows) {
    const name = (row.title || row.name || "").trim();
    if (!name) continue;

    // Parse city+state from address if not separate columns
    let city = (row.city || "").trim();
    let state = (row.state || "").trim().toUpperCase();

    if (!city && row.address) {
      // Try to parse "123 Main St, Austin, TX 78701"
      const parts = row.address.split(",");
      if (parts.length >= 3) {
        city = parts[parts.length - 2].trim();
        state = parts[parts.length - 1].trim().split(" ")[0];
      }
    }

    if (!city || !state) continue;

    const key = `${city.toLowerCase()}|${state.toUpperCase()}`;
    if (!cityStateGroups.has(key)) cityStateGroups.set(key, []);
    cityStateGroups.get(key)!.push(row);
  }

  log(`Grouped into ${cityStateGroups.size} city+state buckets`);

  // Process each city+state group
  let totalMatched = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  const matchLog: object[] = [];

  for (const [cityStateKey, gmapsRows] of cityStateGroups) {
    const [city, state] = cityStateKey.split("|");

    // Fetch DB rows for this city+state that need enrichment
    const { data: dbRows, error } = await db
      .from(table)
      .select("id, name, city, state, website, email, phone")
      .ilike("city", city)
      .eq("state", state)
      .or("website.is.null,email.is.null,phone.is.null") as { data: DbRow[] | null; error: unknown };

    if (error || !dbRows || dbRows.length === 0) continue;

    // For each DB row, try to find a matching Google Maps result
    for (const dbRow of dbRows) {
      const dbNameNorm = normalizeName(dbRow.name);

      // Find best match in gmaps results for this city+state
      let bestMatch: GmapsRow | null = null;
      let matchType = "";

      for (const gmapsRow of gmapsRows) {
        const gmapsName = (gmapsRow.title || gmapsRow.name || "").trim();
        if (!gmapsName) continue;

        // Exact match (case-insensitive)
        if (gmapsName.toLowerCase() === dbRow.name.toLowerCase()) {
          bestMatch = gmapsRow;
          matchType = "exact";
          break;
        }

        // Normalized match
        const gmapsNameNorm = normalizeName(gmapsName);
        if (gmapsNameNorm && dbNameNorm && gmapsNameNorm === dbNameNorm) {
          bestMatch = gmapsRow;
          matchType = "normalized";
        }

        // Substring match (one contains the other, min 8 chars)
        if (!bestMatch && dbNameNorm.length >= 8 && gmapsNameNorm.length >= 8) {
          if (dbNameNorm.includes(gmapsNameNorm) || gmapsNameNorm.includes(dbNameNorm)) {
            bestMatch = gmapsRow;
            matchType = "substring";
          }
        }
      }

      if (!bestMatch) continue;

      totalMatched++;

      // Build update — COALESCE semantics, only write NULL columns
      const update: Record<string, string | null> = {};

      const website = bestMatch.website || "";
      if (!dbRow.website && website && !isBlacklisted(website)) {
        update.website = website.startsWith("http") ? website : `https://${website}`;
      }

      const email = bestMatch.email || bestMatch.emails || "";
      const firstEmail = email.split(/[,;]/)[0].trim();
      if (!dbRow.email && firstEmail && firstEmail.includes("@")) {
        update.email = firstEmail;
      }

      const phone = bestMatch.phone || "";
      if (!dbRow.phone && phone) {
        update.phone = phone;
      }

      if (Object.keys(update).length === 0) {
        totalSkipped++;
        continue;
      }

      const { error: updateError } = await db
        .from(table)
        .update(update)
        .eq("id", dbRow.id);

      if (updateError) {
        log(`ERROR updating ${dbRow.name}: ${JSON.stringify(updateError)}`);
        continue;
      }

      totalUpdated++;

      // Log the match for audit
      matchLog.push({
        db_id: dbRow.id,
        db_name: dbRow.name,
        gmaps_name: bestMatch.title || bestMatch.name,
        match_type: matchType,
        city,
        state,
        wrote: update,
      });

      if (totalUpdated % 100 === 0) {
        log(`Progress: ${totalMatched} matched | ${totalUpdated} updated | ${totalSkipped} skipped`);
      }
    }
  }

  // Write match log
  fs.writeFileSync(
    MATCH_LOG_PATH,
    matchLog.map((r) => JSON.stringify(r)).join("\n"),
    "utf-8"
  );

  log(`
============================================================
IMPORT COMPLETE
============================================================
Total Google Maps results processed: ${allRows.length}
Valid after blacklist filter:        ${validRows.length}
Matched to DB records:               ${totalMatched}
Updated (new data written):          ${totalUpdated}
Skipped (already enriched):          ${totalSkipped}
Match audit log:                     ${MATCH_LOG_PATH}
============================================================
  `);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
