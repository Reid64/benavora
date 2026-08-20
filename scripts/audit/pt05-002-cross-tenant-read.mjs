// ============================================================================
// PT-05-002 -- authenticated as Org A's user, attempt to READ Org B's rows
// on every tenant-scoped table PT-06 identified (120 tables carrying an
// organization_id/org_id column, per test-evidence/pt-06/live-schema.json).
//
// Two-tier methodology, both real, both cited in every row's "method" field
// -- neither is presented as more than it is:
//
//   TIER 1 -- LIVE HTTP TEST (20 tables): the 7 tables PT-05-001 already
//   seeded (funders, opportunities, applications, draft_versions, contacts,
//   donor_discovery_prospects, deadlines) plus all 13 of PT-06's
//   tenant_fk_gap "prime suspect" tables (integrity.json, check=
//   tenant_fk_gap) -- extended into the local stack by
//   pt05-002-schema-extension.sql + pt05-002-provision-and-seed.mjs, with
//   the REAL production RLS policy predicate reproduced verbatim (fetched
//   read-only via pg_policies, see production-rls-policies.json) and one
//   real seeded row per org. For each, authenticated as Org A's real user
//   (a real GoTrue-issued JWT, not a forged token), this script attempts to
//   read Org B's known seeded row id two ways:
//     (a) "API layer" -- the @supabase/supabase-js client (v2.45.4, the
//         same client version this app's own API routes use), the same
//         client code path a real Next.js API route would exercise.
//     (b) "direct PostgREST" -- a raw fetch straight to the PostgREST REST
//         endpoint with Org A's JWT as the Authorization bearer token,
//         bypassing any client-library behavior entirely.
//   A same-org positive-control read (Org A reading its OWN seeded row) is
//   also captured per table, so a table that blocks EVERYTHING (a broken
//   auth.uid()/RLS wiring, not real tenant isolation) cannot be
//   misread as a passing isolation test.
//
//   TIER 2 -- PRODUCTION RLS POLICY INSPECTION (100 tables): every other
//   tenant-scoped table PT-06 found. These were not live-seeded in this
//   local environment (seeding and RLS-replicating all 120 tables was out
//   of scope for this phase -- see PHASE-05-SUMMARY.md for the full
//   reasoning). For these, the verdict is derived from the REAL, live
//   production RLS policy state fetched read-only in
//   pt05-002-fetch-production-rls.mjs (pg_class.relrowsecurity +
//   pg_policies qual text) -- not guessed, not inferred from application
//   code, the actual policy predicate governing every real request against
//   that table today. returned_row_count is explicitly null (no live
//   request was made) and the row is clearly marked method=
//   "production_rls_policy_inspection_readonly" so it is never confused
//   with a Tier 1 empirical result.
//
// Evidence: test-evidence/pt-05/cross-read.json
// Usage: node scripts/audit/pt05-002-cross-tenant-read.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

// Node 20 has no native WebSocket; supabase-js's RealtimeClient constructs one
// eagerly on createClient() even though this script never uses realtime.
const CLIENT_OPTS = { auth: { persistSession: false }, realtime: { transport: ws } };

const OUT_DIR = path.join("test-evidence", "pt-05");
const OUT_FILE = path.join(OUT_DIR, "cross-read.json");
const SEED_IDS_PATH = path.join(OUT_DIR, "cross-tenant-seed-ids.json");
const SEED_SUMMARY_PATH = path.join(OUT_DIR, "seed-summary.json");
const PROD_RLS_PATH = path.join(OUT_DIR, "production-rls-policies.json");
const LIVE_SCHEMA_PATH = path.join("test-evidence", "pt-06", "live-schema.json");

const API_URL = "http://127.0.0.1:56321";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const OWNER_A_EMAIL = "pt05-owner-a@benavora-pt05-test.local";
const OWNER_A_PASSWORD = "Pt05TestPassword!A23";
const OWNER_B_EMAIL = "pt05-owner-b@benavora-pt05-test.local";
const OWNER_B_PASSWORD = "Pt05TestPassword!B23";

const TIER1_TABLES = [
  "funders",
  "opportunities",
  "applications",
  "draft_versions",
  "contacts",
  "donor_discovery_prospects",
  "deadlines",
  "adapter_usage_log",
  "agent_configurations",
  "autoapply_review_queue",
  "board_meetings",
  "board_meeting_packets",
  "discovery_matches",
  "funding_forecasts",
  "impact_simulations",
  "knowledge_queries",
  "opportunity_probability_scores",
  "organizational_digital_twins",
  "pitch_cache",
  "submission_receipts",
];

async function directPostgrestRead(table, column, rowId, jwt) {
  const url = `${API_URL}/rest/v1/${table}?${column}=eq.${rowId}&select=*`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${jwt}`,
    },
  });
  const status = res.status;
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const rowCount = Array.isArray(body) ? body.length : 0;
  return { http_status: status, row_count: rowCount, body_error: Array.isArray(body) ? null : body, raw_rows: Array.isArray(body) ? body : [] };
}

async function apiLayerRead(supabaseClientA, table, column, rowId) {
  const { data, error, status } = await supabaseClientA.from(table).select("*").eq(column, rowId);
  return {
    http_status: status ?? null,
    row_count: Array.isArray(data) ? data.length : 0,
    error: error ? { code: error.code ?? null, message: error.message } : null,
    raw_rows: data ?? [],
  };
}

function verdictForTier1(ownRead, crossReadA, crossReadB) {
  const ownOk = ownRead.api.row_count === 1 || ownRead.postgrest.row_count === 1;
  const leak =
    crossReadA.api.row_count > 0 ||
    crossReadA.postgrest.row_count > 0;
  if (leak) return "P0_CROSS_TENANT_READ_LEAK";
  if (!ownOk) return "INCONCLUSIVE_POSITIVE_CONTROL_FAILED";
  return "PASS_BLOCKED_ZERO_ROWS";
}

function tier2Verdict(tableInfo) {
  if (!tableInfo || tableInfo.table_exists === false) return "TABLE_NOT_FOUND_IN_PRODUCTION";
  if (!tableInfo.rls_enabled) return "P0_RLS_DISABLED";
  const selectPolicies = tableInfo.policies.filter((p) => p.cmd === "SELECT" || p.cmd === "ALL");
  if (selectPolicies.length === 0) return "RLS_ENABLED_NO_SELECT_POLICY_DENY_ALL";
  const col = tableInfo.tenant_column;
  const orgScoped = selectPolicies.every((p) => {
    const qual = (p.qual || "").toLowerCase();
    return qual.includes(col.toLowerCase()) && (qual.includes("current_org_id") || qual.includes("auth.uid"));
  });
  if (orgScoped) return "POLICY_INSPECTED_ORG_SCOPED_SELECT";
  return "POLICY_INSPECTED_SUSPICIOUS_PREDICATE";
}

async function main() {
  const seedIds = JSON.parse(fs.readFileSync(SEED_IDS_PATH, "utf8"));
  const seedSummary = JSON.parse(fs.readFileSync(SEED_SUMMARY_PATH, "utf8"));
  const prodRls = JSON.parse(fs.readFileSync(PROD_RLS_PATH, "utf8"));
  const liveSchema = JSON.parse(fs.readFileSync(LIVE_SCHEMA_PATH, "utf8"));

  const allTenantTables = Object.keys(prodRls.tables).sort();
  console.log(`Total tenant-scoped tables to cover (from PT-06): ${allTenantTables.length}`);

  // --- Real GoTrue password login for both real org owner users -----------
  const anonClientA = createClient(API_URL, ANON_KEY, CLIENT_OPTS);
  const { data: loginA, error: loginErrA } = await anonClientA.auth.signInWithPassword({
    email: OWNER_A_EMAIL,
    password: OWNER_A_PASSWORD,
  });
  if (loginErrA) throw new Error(`Org A login failed: ${loginErrA.message}`);
  const jwtA = loginA.session.access_token;
  console.log(`Org A authenticated: user=${loginA.user.id} (expected ${seedSummary.orgs.A.userId})`);

  const anonClientB = createClient(API_URL, ANON_KEY, CLIENT_OPTS);
  const { data: loginB, error: loginErrB } = await anonClientB.auth.signInWithPassword({
    email: OWNER_B_EMAIL,
    password: OWNER_B_PASSWORD,
  });
  if (loginErrB) throw new Error(`Org B login failed: ${loginErrB.message}`);
  console.log(`Org B authenticated: user=${loginB.user.id} (expected ${seedSummary.orgs.B.userId})`);

  // Real authenticated supabase-js client for Org A (this is the "API layer" path).
  const supabaseA = createClient(API_URL, ANON_KEY, {
    ...CLIENT_OPTS,
    global: { headers: { Authorization: `Bearer ${jwtA}` } },
  });

  const results = { tables: {} };
  let p0Count = 0;
  let passCount = 0;
  let inconclusiveCount = 0;

  // --- Tier 1: live HTTP test, 20 tables ------------------------------------
  for (const table of TIER1_TABLES) {
    const seedRow = seedIds.tables[table];
    if (!seedRow) {
      throw new Error(`No seed row recorded for tier-1 table "${table}" -- cannot test.`);
    }
    const col = seedRow.tenant_column;
    const rowIdA = seedRow.A;
    const rowIdB = seedRow.B;

    console.log(`\n[TIER 1] ${table} (tenant_column=${col})`);

    // Positive control: Org A reads its OWN row.
    const ownApi = await apiLayerRead(supabaseA, table, "id", rowIdA);
    const ownPostgrest = await directPostgrestRead(table, "id", rowIdA, jwtA);
    console.log(`  own-row control: api.row_count=${ownApi.row_count} postgrest.row_count=${ownPostgrest.row_count}`);

    // The actual test: Org A attempts to read Org B's known row.
    const crossApi = await apiLayerRead(supabaseA, table, "id", rowIdB);
    const crossPostgrest = await directPostgrestRead(table, "id", rowIdB, jwtA);
    console.log(
      `  cross-tenant read attempt (Org A -> Org B row ${rowIdB}): api.row_count=${crossApi.row_count} api.status=${crossApi.http_status} postgrest.row_count=${crossPostgrest.row_count} postgrest.status=${crossPostgrest.http_status}`,
    );

    const verdict = verdictForTier1(
      { api: ownApi, postgrest: ownPostgrest },
      { api: crossApi, postgrest: crossPostgrest },
      null,
    );
    if (verdict === "P0_CROSS_TENANT_READ_LEAK") {
      p0Count++;
      console.log(`  *** P0 LEAK DETECTED on ${table} ***`);
    } else if (verdict === "PASS_BLOCKED_ZERO_ROWS") {
      passCount++;
    } else {
      inconclusiveCount++;
    }

    results.tables[table] = {
      method: "live_http_test",
      tenant_column: col,
      org_a_user: seedSummary.orgs.A.userId,
      org_b_user: seedSummary.orgs.B.userId,
      org_b_target_row_id: rowIdB,
      positive_control: {
        description: "Org A reading its own seeded row (proves auth.uid()/RLS wiring is actually live, not globally broken)",
        api_layer: ownApi,
        direct_postgrest: ownPostgrest,
      },
      cross_tenant_read_attempt: {
        description: "Org A attempting to read Org B's known seeded row",
        api_layer: crossApi,
        direct_postgrest: crossPostgrest,
      },
      verdict,
      leaked_payload: verdict === "P0_CROSS_TENANT_READ_LEAK"
        ? { api_layer_rows: crossApi.raw_rows, direct_postgrest_rows: crossPostgrest.raw_rows }
        : null,
    };
  }

  // --- Tier 2: production RLS policy inspection, remaining tables ---------
  for (const table of allTenantTables) {
    if (results.tables[table]) continue; // already covered by Tier 1
    const tableInfo = prodRls.tables[table];
    const verdict = tier2Verdict(tableInfo);
    if (verdict.startsWith("P0")) p0Count++;
    else if (verdict.startsWith("POLICY_INSPECTED_ORG_SCOPED")) passCount++;
    else inconclusiveCount++;

    results.tables[table] = {
      method: "production_rls_policy_inspection_readonly",
      tenant_column: tableInfo.tenant_column,
      returned_row_count: null,
      note:
        "Not live-seeded in the PT-05 local environment this phase (seeding all 120 tenant tables was out of scope -- see PHASE-05-SUMMARY.md). Verdict is derived from the REAL production RLS policy state (pg_class.relrowsecurity + pg_policies), fetched read-only, not from application code or assumption.",
      production_rls_enabled: tableInfo.rls_enabled,
      production_select_policies: tableInfo.policies.filter((p) => p.cmd === "SELECT" || p.cmd === "ALL"),
      verdict,
    };
    if (verdict.startsWith("P0")) {
      console.log(`\n*** P0 (policy inspection) on ${table}: ${verdict} ***`);
    }
  }

  const missingFromSchema = allTenantTables.filter((t) => !(t in results.tables));
  if (missingFromSchema.length > 0) {
    throw new Error(`Coverage gap: tables never assigned a result: ${missingFromSchema.join(", ")}`);
  }

  const summary = {
    total_tenant_scoped_tables: allTenantTables.length,
    tier1_live_http_tested: TIER1_TABLES.length,
    tier2_policy_inspected: allTenantTables.length - TIER1_TABLES.length,
    p0_cross_tenant_leak_findings: p0Count,
    pass_count: passCount,
    inconclusive_or_other: inconclusiveCount,
  };
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    method_overview: {
      tier1: "live_http_test -- real GoTrue-authenticated JWT for Org A's real user, real HTTP requests via both @supabase/supabase-js (API layer) and a raw PostgREST fetch, against a real seeded row belonging to Org B, on the PT-05 local isolated stack with the real production RLS policy predicate reproduced verbatim.",
      tier2: "production_rls_policy_inspection_readonly -- no live HTTP request made (table not seeded in this local environment); verdict derived from the real, live production RLS policy state fetched read-only in pt05-002-fetch-production-rls.mjs.",
    },
    source_of_tenant_table_list: LIVE_SCHEMA_PATH,
    source_of_production_rls_ground_truth: PROD_RLS_PATH,
    orgs: { A: seedSummary.orgs.A.orgId, B: seedSummary.orgs.B.orgId },
    summary,
    tables: results.tables,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\nWrote ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(`HALT: ${err.stack || err.message}`);
  process.exit(1);
});
