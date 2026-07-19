// ============================================================================
// BENAVORA — nonprofits enrichment status report (detailed)
//
// Read-only status check against the nonprofits table (migration 098/099):
// total records, overall enrichment coverage, per-field population counts,
// and a top-10 states-by-record-count breakdown.
//
//   pnpm check:enrichment
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
] as const;

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

function pct(part: number, whole: number): string {
  if (whole === 0) return "0.0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    realtime: { transport: ws as any },
  });

  console.log("nonprofits — enrichment status report\n");

  const { count: total, error: totalError } = await admin
    .from("nonprofits")
    .select("*", { count: "exact", head: true });
  if (totalError) fatal(`could not query nonprofits: ${totalError.message}`);

  const { count: enriched } = await admin
    .from("nonprofits")
    .select("*", { count: "exact", head: true })
    .not("last_enriched_at", "is", null);

  const { count: withWebsite } = await admin
    .from("nonprofits")
    .select("*", { count: "exact", head: true })
    .not("website", "is", null);

  const { count: withOfficerName } = await admin
    .from("nonprofits")
    .select("*", { count: "exact", head: true })
    .not("officer_name", "is", null);

  const { count: withMission } = await admin
    .from("nonprofits")
    .select("*", { count: "exact", head: true })
    .not("mission", "is", null);

  const { count: withRevenue } = await admin
    .from("nonprofits")
    .select("*", { count: "exact", head: true })
    .not("revenue_amount", "is", null);

  const totalCount = total ?? 0;

  console.table([
    { metric: "Total records", count: totalCount, pct: "100.0%" },
    { metric: "Enriched (last_enriched_at set)", count: enriched ?? 0, pct: pct(enriched ?? 0, totalCount) },
    { metric: "With website", count: withWebsite ?? 0, pct: pct(withWebsite ?? 0, totalCount) },
    { metric: "With officer_name", count: withOfficerName ?? 0, pct: pct(withOfficerName ?? 0, totalCount) },
    { metric: "With mission", count: withMission ?? 0, pct: pct(withMission ?? 0, totalCount) },
    { metric: "With revenue_amount", count: withRevenue ?? 0, pct: pct(withRevenue ?? 0, totalCount) },
  ]);

  console.log("\nBy state (top 10 by record count):\n");

  const stateCounts: { state: string; count: number }[] = [];
  for (const state of STATES) {
    const { count: n } = await admin
      .from("nonprofits")
      .select("*", { count: "exact", head: true })
      .eq("state", state);
    stateCounts.push({ state, count: n ?? 0 });
  }

  stateCounts.sort((a, b) => b.count - a.count);
  const top10 = stateCounts.slice(0, 10).map((row) => ({
    state: row.state,
    count: row.count,
    pct: pct(row.count, totalCount),
  }));

  console.table(top10);
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
