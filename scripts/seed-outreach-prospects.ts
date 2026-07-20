// @ts-nocheck
// ============================================================================
// BENAVORA — outreach prospect seeding: nonprofits (IRS BMF) -> sales campaign
//
// Schema note (deviation from the task spec this script was written against):
// there is no outreach_campaigns / outreach_prospects / email_suppressions
// table anywhere in this repo (checked both supabase/migrations/ and
// src/supabase/migrations/). The real tables, all from
// supabase/migrations/001_initial_schema.sql, are:
//   - sales_campaigns   (a campaign has ONE prospect_lists.id via list_id —
//                         there is no campaign_id column on prospects)
//   - prospects         (unique on (list_id, ein); has org_name/email/etc but
//                         no contact_name/contact_title column)
//   - suppression_list  (email, reason, source, added_at)
// prospects.list_id is what this script actually targets: it resolves
// --campaign-id to its sales_campaigns.list_id and inserts there. Since
// prospects had no column for the officer's name/title, migration 100
// (supabase/migrations/100_prospects_contact_fields.sql) adds
// contact_name/contact_title. That migration must be applied before this
// script's inserts will succeed — see BLUEPRINT_v2.md §8.3 for the Management
// API path (the founder's sbp_ PAT returned 401 as of 2026-07-19; verify it
// works or apply the migration another way before running this for real).
//
// Targeting criteria (Benavora's primary ICP — nonprofit ED/development
// officers at small-to-mid nonprofits, per the task):
//   nonprofits.officer_email IS NOT NULL
//   AND officer_email NOT IN suppression_list.email (case-insensitive)
//   AND asset_amount BETWEEN 100000 AND 50000000
//   AND ntee_code NOT LIKE 'S%' (excludes government-adjacent NTEE major group)
//   AND ntee_code NOT LIKE 'T%' (excludes philanthropy/foundation NTEE major group)
//   AND last_enriched_at IS NOT NULL
// Source rows are paged from nonprofits 10,000 at a time (per the task's
// "LIMIT 10000 per batch"); --limit caps how many NEW prospect rows this run
// will insert (default 1000), independent of that source page size.
//
// Idempotent: ON CONFLICT (list_id, ein) DO NOTHING via upsert with
// ignoreDuplicates. Already-suppressed emails and EINs already on the
// campaign's list are skipped before insert and reported separately.
//
//   pnpm outreach:seed -- --campaign-id <uuid> [--limit 1000] [--dry-run]
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import ws from "ws";

dotenv.config({ path: ".env.local" });

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

function ok(step: string, detail: string) {
  console.log(`  ✓ ${step}: ${detail}`);
}

function fail(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : JSON.stringify(error);
  console.error(`  ✗ ${step}: ${message}`);
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------
const SOURCE_PAGE_SIZE = 10_000;
const INSERT_CHUNK_SIZE = 500;
const MIN_ASSET_AMOUNT = 100_000;
const MAX_ASSET_AMOUNT = 50_000_000;
const DEFAULT_LIMIT = 1000;
const DEFAULT_CONTACT_TITLE = "Executive Director";

interface Args {
  campaignId: string;
  limit: number;
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);

  const campaignIdIdx = argv.indexOf("--campaign-id");
  const campaignId = campaignIdIdx !== -1 ? argv[campaignIdIdx + 1] : undefined;

  const limitIdx = argv.indexOf("--limit");
  const limitRaw = limitIdx !== -1 ? argv[limitIdx + 1] : undefined;
  const limit = limitRaw ? parseInt(limitRaw, 10) : DEFAULT_LIMIT;

  const dryRun = argv.includes("--dry-run");

  if (!campaignId || campaignId.startsWith("--")) {
    console.error(
      "Usage: pnpm outreach:seed -- --campaign-id <uuid> [--limit 1000] [--dry-run]",
    );
    process.exit(1);
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    fatal(`--limit must be a positive number, got: ${limitRaw}`);
  }

  return { campaignId, limit, dryRun };
}

// ----------------------------------------------------------------------------
// Lookups
// ----------------------------------------------------------------------------
async function resolveListId(campaignId: string): Promise<string> {
  const { data, error } = await admin
    .from("sales_campaigns")
    .select("id, name, list_id")
    .eq("id", campaignId)
    .maybeSingle();

  if (error) {
    fail("look up sales_campaigns", error);
    fatal(`could not look up campaign ${campaignId}`);
  }
  if (!data) {
    fatal(`no sales_campaigns row found for id ${campaignId}`);
  }
  if (!data.list_id) {
    fatal(`campaign "${data.name}" (${campaignId}) has no list_id — assign a prospect_lists row first`);
  }
  return data.list_id as string;
}

async function fetchSuppressedEmailsLower(): Promise<Set<string>> {
  const emails = new Set<string>();
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("suppression_list")
      .select("email")
      .range(from, from + PAGE - 1);
    if (error) {
      fail("fetch suppression_list", error);
      fatal("could not load suppression_list — refusing to insert and risk contacting a suppressed address.");
    }
    if (!data || data.length === 0) break;
    for (const row of data as { email: string }[]) {
      emails.add(row.email.trim().toLowerCase());
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return emails;
}

async function fetchExistingEinsLower(listId: string): Promise<Set<string>> {
  const eins = new Set<string>();
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("prospects")
      .select("ein")
      .eq("list_id", listId)
      .not("ein", "is", null)
      .range(from, from + PAGE - 1);
    if (error) {
      fail("fetch existing prospects", error);
      fatal("could not check existing prospects for this list — refusing to risk duplicate contact attempts.");
    }
    if (!data || data.length === 0) break;
    for (const row of data as { ein: string | null }[]) {
      if (row.ein) eins.add(row.ein.trim().toLowerCase());
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return eins;
}

// ----------------------------------------------------------------------------
// Source query — nonprofits matching the targeting criteria
// ----------------------------------------------------------------------------
interface NonprofitRow {
  ein: string;
  name: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  ntee_code: string | null;
  subsection_code: string | null;
  foundation_type: string | null;
  revenue_amount: number | null;
  asset_amount: number | null;
  employee_count: number | null;
  website: string | null;
  officer_name: string | null;
  officer_title: string | null;
  officer_email: string;
}

interface ProspectRow {
  list_id: string;
  ein: string;
  org_name: string;
  org_type: string | null;
  email: string;
  website: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  annual_revenue: number | null;
  employee_count: number | null;
  ntee_code: string | null;
  subsection_code: string | null;
  contact_name: string | null;
  contact_title: string | null;
}

async function* fetchQualifyingNonprofits(): AsyncGenerator<NonprofitRow[]> {
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("nonprofits")
      .select(
        "ein, name, city, state, zip, ntee_code, subsection_code, foundation_type, revenue_amount, asset_amount, employee_count, website, officer_name, officer_title, officer_email",
      )
      .not("officer_email", "is", null)
      .gte("asset_amount", MIN_ASSET_AMOUNT)
      .lte("asset_amount", MAX_ASSET_AMOUNT)
      .not("ntee_code", "like", "S%")
      .not("ntee_code", "like", "T%")
      .not("last_enriched_at", "is", null)
      .order("asset_amount", { ascending: false })
      .range(from, from + SOURCE_PAGE_SIZE - 1);

    if (error) {
      fail("fetch nonprofits", error);
      fatal("could not query nonprofits");
    }

    const batch = (data ?? []) as NonprofitRow[];
    if (batch.length === 0) return;
    yield batch;
    if (batch.length < SOURCE_PAGE_SIZE) return;
    from += SOURCE_PAGE_SIZE;
  }
}

function toProspectRow(n: NonprofitRow, listId: string): ProspectRow {
  return {
    list_id: listId,
    ein: n.ein,
    org_name: n.name,
    org_type: n.foundation_type ?? null,
    email: n.officer_email,
    website: n.website ?? null,
    city: n.city ?? null,
    state: n.state ?? null,
    zip: n.zip ?? null,
    annual_revenue: n.revenue_amount ?? null,
    employee_count: n.employee_count ?? null,
    ntee_code: n.ntee_code ?? null,
    subsection_code: n.subsection_code ?? null,
    contact_name: n.officer_name ?? null,
    contact_title: n.officer_title ?? DEFAULT_CONTACT_TITLE,
  };
}

// ----------------------------------------------------------------------------
// Insert
// ----------------------------------------------------------------------------
async function insertProspects(rows: ProspectRow[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
    const { data, error } = await admin
      .from("prospects")
      .upsert(chunk, { onConflict: "list_id,ein", ignoreDuplicates: true })
      .select("id");

    if (error) {
      fail(`insert chunk ${i / INSERT_CHUNK_SIZE + 1}`, error);
      throw new Error(`insert failed: ${error.message}`);
    }
    inserted += data?.length ?? 0;
  }
  return inserted;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  const { campaignId, limit, dryRun } = parseArgs();

  console.log("Outreach prospect seeding — nonprofits -> sales campaign");
  console.log(`Campaign: ${campaignId}`);
  console.log(`Limit:    ${limit}${dryRun ? " (dry run — no inserts)" : ""}\n`);

  const listId = await resolveListId(campaignId);
  ok("resolve campaign", `list_id = ${listId}`);

  const suppressedEmails = await fetchSuppressedEmailsLower();
  ok("load suppression_list", `${suppressedEmails.size} suppressed email(s)`);

  const existingEins = await fetchExistingEinsLower(listId);
  ok("load existing prospects", `${existingEins.size} EIN(s) already on this list`);

  const qualifying: ProspectRow[] = [];
  let scanned = 0;
  let skippedSuppressed = 0;
  let skippedDuplicate = 0;

  scan: for await (const batch of fetchQualifyingNonprofits()) {
    for (const n of batch) {
      scanned++;
      const emailLower = n.officer_email.trim().toLowerCase();
      const einLower = n.ein.trim().toLowerCase();

      if (suppressedEmails.has(emailLower)) {
        skippedSuppressed++;
        continue;
      }
      if (existingEins.has(einLower)) {
        skippedDuplicate++;
        continue;
      }

      existingEins.add(einLower);
      qualifying.push(toProspectRow(n, listId));
      if (qualifying.length >= limit) break scan;
    }
  }

  ok(
    "scan nonprofits",
    `${scanned} scanned, ${qualifying.length} qualify, ${skippedSuppressed} suppressed, ${skippedDuplicate} already on list`,
  );

  if (dryRun) {
    console.log("\nDry run — would insert:");
    for (const row of qualifying.slice(0, 20)) {
      console.log(`  ${row.org_name} (${row.ein}) — ${row.contact_name ?? "unknown"}, ${row.contact_title} <${row.email}>`);
    }
    if (qualifying.length > 20) {
      console.log(`  … and ${qualifying.length - 20} more`);
    }
    console.log(`\nTotal would-insert: ${qualifying.length}`);
    return;
  }

  if (qualifying.length === 0) {
    console.log("\nNo new qualifying prospects to insert.");
    return;
  }

  const inserted = await insertProspects(qualifying);
  ok("insert prospects", `${inserted} row(s) inserted`);

  console.log("\nDone.");
  console.log(`  Scanned:            ${scanned}`);
  console.log(`  Skipped (suppressed): ${skippedSuppressed}`);
  console.log(`  Skipped (duplicate):  ${skippedDuplicate}`);
  console.log(`  Inserted:            ${inserted}`);
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
