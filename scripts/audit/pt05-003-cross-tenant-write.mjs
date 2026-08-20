// ============================================================================
// PT-05-003 -- authenticated as Org A's user, attempt to WRITE (UPDATE,
// DELETE, and INSERT tagged with Org B's org_id) against Org B's data, on
// every tenant-scoped table PT-06 identified (120 tables). This is the more
// dangerous direction than PT-05-002's read test: a successful cross-tenant
// write means one tenant can corrupt, erase, or forge data inside another
// tenant's account -- the worst class of finding in this program.
//
// Two-tier methodology, same shape as pt05-002-cross-tenant-read.mjs and
// cited per-row so neither tier is ever confused with the other:
//
//   TIER 1 -- LIVE HTTP MUTATION TEST (20 tables): the same 20 tables
//   PT-05-002 live-seeded (the 7 PT-05-001 tables + the 13 PT-06
//   tenant_fk_gap "prime suspect" tables), against the PT-05 local isolated
//   stack with the real production RLS policy predicate reproduced verbatim
//   (production-rls-policies.json). For each table, authenticated as Org A's
//   real GoTrue-issued JWT (not forged), this script attempts, against Org
//   B's known seeded row:
//     (a) UPDATE one real column to a distinguishing marker value.
//     (b) DELETE the row outright.
//     (c) INSERT a brand-new row with the tenant column explicitly set to
//         Org B's real org id (and, where the table has required foreign
//         keys, Org B's real child ids too -- the worst-case "attacker
//         already knows Org B's internal ids" scenario).
//   Each of the three is attempted TWO ways: via the API layer
//   (@supabase/supabase-js v2.45.4, the same client version this app's own
//   API routes use) and via a raw fetch straight to PostgREST with Org A's
//   JWT as the bearer token, bypassing any client-library behavior.
//   CRITICALLY: after every single attempt, this script re-reads Org B's
//   data AS ORG B (a second real, independently-authenticated session) and
//   compares it to a captured "before" snapshot -- never trusting the
//   attacking request's own reported success/failure. A verdict of PASS
//   requires both "the attempt reported it did nothing" AND "Org B's
//   independently re-read data is provably unchanged."
//   A single shared positive control (Org A successfully UPDATEing its OWN
//   row) is captured once per table, proving the RLS write path is actually
//   live for that table -- not globally broken in a way that would produce
//   a false PASS by blocking everything, cross-tenant or not. A destructive
//   own-row DELETE positive control was deliberately not performed, to
//   avoid destroying reusable seed data.
//
//   TIER 2 -- PRODUCTION RLS POLICY INSPECTION (100 tables): every other
//   tenant-scoped table PT-06 found, not live-seeded in this local
//   environment (same scope decision PT-05-002 made -- see
//   PHASE-05-SUMMARY.md). For these, a verdict per operation (INSERT,
//   UPDATE, DELETE) is derived from the REAL, live production RLS policy
//   state (pg_class.relrowsecurity + pg_policies qual/with_check text,
//   fetched read-only in pt05-002-fetch-production-rls.mjs) -- not guessed,
//   not inferred from application code. No live request is made for these;
//   every row is clearly marked method=
//   "production_rls_policy_inspection_readonly" so it can never be confused
//   with a Tier 1 empirical result.
//
// Evidence: test-evidence/pt-05/cross-write.json
// Usage: node scripts/audit/pt05-003-cross-tenant-write.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import ws from "ws";

const CLIENT_OPTS = { auth: { persistSession: false }, realtime: { transport: ws } };

const OUT_DIR = path.join("test-evidence", "pt-05");
const OUT_FILE = path.join(OUT_DIR, "cross-write.json");
const SEED_IDS_PATH = path.join(OUT_DIR, "cross-tenant-seed-ids.json");
const SEED_SUMMARY_PATH = path.join(OUT_DIR, "seed-summary.json");
const PROD_RLS_PATH = path.join(OUT_DIR, "production-rls-policies.json");
const LIVE_SCHEMA_PATH = path.join("test-evidence", "pt-06", "live-schema.json");

const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const API_URL = "http://127.0.0.1:56321";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const OWNER_A_EMAIL = "pt05-owner-a@benavora-pt05-test.local";
const OWNER_A_PASSWORD = "Pt05TestPassword!A23";
const OWNER_B_EMAIL = "pt05-owner-b@benavora-pt05-test.local";
const OWNER_B_PASSWORD = "Pt05TestPassword!B23";

const MARKER_TEXT = "PT05-003-CROSS-WRITE-ATTEMPT";
const MARKER_NUMBER = 999999;
const INSERT_MARKER_PREFIX = "PT05-003-CROSS-INSERT";

function assertNotProduction(connectionString) {
  if (connectionString.includes(PRODUCTION_REF)) {
    throw new Error(`REFUSING: connection string contains production ref "${PRODUCTION_REF}".`);
  }
  const url = new URL(connectionString.replace(/^postgresql:/, "postgres:"));
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error(`REFUSING: host "${url.hostname}" does not look local.`);
  }
  return url;
}

// --- Tier 1 per-table specs -------------------------------------------------
// updateColumn/updateValue: a real, type-safe column to mutate (never an
// enum column, to keep any failure attributable to RLS, not a type/enum
// constraint). insertPayload(ids): builds the row Org A will attempt to
// insert with the tenant column tagged to Org B (and, where applicable,
// Org B's real child-object ids -- the worst-case "attacker already knows
// Org B's internal ids" scenario).
function buildTier1Specs(seedIds, extraIds) {
  const t = (table) => seedIds.tables[table];
  return [
    {
      table: "funders",
      tenantCol: "organization_id",
      updateColumn: "description",
      updateValue: MARKER_TEXT,
      insertPayload: (orgB) => ({
        organization_id: orgB,
        name: `${INSERT_MARKER_PREFIX}-funders`,
        category: "private_foundation",
        description: "cross-tenant insert attempt",
      }),
    },
    {
      table: "opportunities",
      tenantCol: "organization_id",
      updateColumn: "description",
      updateValue: MARKER_TEXT,
      insertPayload: (orgB) => ({
        organization_id: orgB,
        funder_id: t("funders").B,
        name: `${INSERT_MARKER_PREFIX}-opportunities`,
        category: "private_foundation",
        description: "cross-tenant insert attempt",
        amount_min: 1,
        amount_max: 2,
        status: "open",
      }),
    },
    {
      table: "applications",
      tenantCol: "organization_id",
      updateColumn: "notes",
      updateValue: MARKER_TEXT,
      insertPayload: (orgB) => ({
        organization_id: orgB,
        opportunity_id: t("opportunities").B,
        notes: `${INSERT_MARKER_PREFIX}-applications`,
      }),
    },
    {
      table: "draft_versions",
      tenantCol: "organization_id",
      updateColumn: "content",
      updateValue: MARKER_TEXT,
      insertPayload: (orgB) => ({
        organization_id: orgB,
        opportunity_id: t("opportunities").B,
        application_id: t("applications").B,
        template_type: "grant_narrative",
        content: `${INSERT_MARKER_PREFIX}-draft_versions`,
        version_number: 999,
      }),
    },
    {
      table: "contacts",
      tenantCol: "organization_id",
      updateColumn: "title",
      updateValue: MARKER_TEXT,
      insertPayload: (orgB) => ({
        organization_id: orgB,
        funder_id: t("funders").B,
        name: `${INSERT_MARKER_PREFIX}-contacts`,
      }),
    },
    {
      table: "donor_discovery_prospects",
      tenantCol: "organization_id",
      updateColumn: "score",
      updateValue: MARKER_NUMBER,
      insertPayload: (orgB) => ({
        organization_id: orgB,
        directory_id: extraIds.anyDirectoryId,
        request_id: extraIds.requestIdB,
        score: 1,
      }),
    },
    {
      table: "deadlines",
      tenantCol: "organization_id",
      updateColumn: "description",
      updateValue: MARKER_TEXT,
      insertPayload: (orgB) => ({
        organization_id: orgB,
        application_id: t("applications").B,
        opportunity_id: t("opportunities").B,
        deadline_type: "application_deadline",
        due_date: extraIds.futureDate,
        title: `${INSERT_MARKER_PREFIX}-deadlines`,
      }),
    },
    {
      table: "adapter_usage_log",
      tenantCol: "organization_id",
      updateColumn: "api_cost_cents",
      updateValue: MARKER_NUMBER,
      insertPayload: (orgB) => ({
        organization_id: orgB,
        adapter_name: `${INSERT_MARKER_PREFIX}-adapter`,
        api_cost_cents: 1,
        records_returned: 1,
        cache_hit: false,
      }),
    },
    {
      table: "agent_configurations",
      tenantCol: "organization_id",
      updateColumn: "run_count",
      updateValue: MARKER_NUMBER,
      insertPayload: (orgB) => ({
        organization_id: orgB,
        agent_id: `${INSERT_MARKER_PREFIX}-agent`,
        enabled: true,
      }),
    },
    {
      table: "autoapply_review_queue",
      tenantCol: "organization_id",
      updateColumn: "reason",
      updateValue: MARKER_TEXT,
      insertPayload: (orgB) => ({
        organization_id: orgB,
        funder_id: t("funders").B,
        reason: `${INSERT_MARKER_PREFIX}-autoapply_review_queue`,
      }),
    },
    {
      table: "board_meetings",
      tenantCol: "org_id",
      updateColumn: "agenda",
      updateValue: MARKER_TEXT,
      insertPayload: (orgB) => ({
        org_id: orgB,
        meeting_date: extraIds.futureDate,
        agenda: `${INSERT_MARKER_PREFIX}-board_meetings`,
      }),
    },
    {
      table: "board_meeting_packets",
      tenantCol: "org_id",
      updateColumn: "packet_content",
      updateValue: { pt05_003_marker: true },
      insertPayload: (orgB) => ({
        org_id: orgB,
        meeting_id: t("board_meetings").B,
        packet_content: { marker: `${INSERT_MARKER_PREFIX}-board_meeting_packets` },
      }),
    },
    {
      table: "discovery_matches",
      tenantCol: "org_id",
      updateColumn: "external_title",
      updateValue: MARKER_TEXT,
      insertPayload: (orgB) => ({
        org_id: orgB,
        opportunity_id: t("opportunities").B,
        external_title: `${INSERT_MARKER_PREFIX}-discovery_matches`,
        external_source: "pt05-003-test",
      }),
    },
    {
      table: "funding_forecasts",
      tenantCol: "org_id",
      updateColumn: "projected_min",
      updateValue: MARKER_NUMBER,
      insertPayload: (orgB) => ({
        org_id: orgB,
        forecast_date: extraIds.today,
        forecast_period: "90_day",
        methodology: `${INSERT_MARKER_PREFIX}-funding_forecasts`,
      }),
    },
    {
      table: "impact_simulations",
      tenantCol: "org_id",
      updateColumn: "confidence",
      updateValue: MARKER_TEXT,
      insertPayload: (orgB) => ({
        org_id: orgB,
        scenario_type: "lose_funder",
        scenario_params: { funderId: `${INSERT_MARKER_PREFIX}-impact_simulations` },
      }),
    },
    {
      table: "knowledge_queries",
      tenantCol: "org_id",
      updateColumn: "query_text",
      updateValue: MARKER_TEXT,
      insertPayload: (orgB) => ({
        org_id: orgB,
        query_text: `${INSERT_MARKER_PREFIX}-knowledge_queries`,
      }),
    },
    {
      table: "opportunity_probability_scores",
      tenantCol: "organization_id",
      updateColumn: "overall_score",
      updateValue: MARKER_NUMBER,
      insertPayload: (orgB) => ({
        organization_id: orgB,
        opportunity_id: t("opportunities").B,
        overall_score: 1,
        recommendation: `${INSERT_MARKER_PREFIX}-opportunity_probability_scores`,
      }),
    },
    {
      table: "organizational_digital_twins",
      tenantCol: "organization_id",
      updateColumn: "mission",
      updateValue: MARKER_TEXT,
      insertPayload: (orgB) => ({
        organization_id: orgB,
        mission: `${INSERT_MARKER_PREFIX}-organizational_digital_twins`,
      }),
    },
    {
      table: "pitch_cache",
      tenantCol: "organization_id",
      updateColumn: "personalized_pitch",
      updateValue: MARKER_TEXT,
      insertPayload: (orgB) => ({
        organization_id: orgB,
        funder_id: t("funders").B,
        personalized_pitch: `${INSERT_MARKER_PREFIX}-pitch_cache`,
        pitch_hash: `${INSERT_MARKER_PREFIX}-hash`,
      }),
    },
    {
      table: "submission_receipts",
      tenantCol: "organization_id",
      updateColumn: "receipt_pdf_path",
      updateValue: MARKER_TEXT,
      insertPayload: (orgB) => ({
        organization_id: orgB,
        receipt_data: { marker: `${INSERT_MARKER_PREFIX}-submission_receipts` },
      }),
    },
  ];
}

// --- HTTP helpers ------------------------------------------------------------

async function directPostgrestMutate(method, table, column, rowId, jwt, body) {
  const url =
    method === "POST"
      ? `${API_URL}/rest/v1/${table}`
      : `${API_URL}/rest/v1/${table}?${column}=eq.${rowId}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const status = res.status;
  let parsed;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  const rows = Array.isArray(parsed) ? parsed : [];
  return {
    http_status: status,
    rows_affected: rows.length,
    body_error: !Array.isArray(parsed) ? parsed : null,
    raw_rows: rows,
  };
}

async function apiLayerMutate(kind, supabaseClient, table, column, rowId, body) {
  let query;
  if (kind === "update") query = supabaseClient.from(table).update(body).eq(column, rowId).select();
  else if (kind === "delete") query = supabaseClient.from(table).delete().eq(column, rowId).select();
  else if (kind === "insert") query = supabaseClient.from(table).insert(body).select();
  else throw new Error(`Unknown kind ${kind}`);
  const { data, error, status } = await query;
  const rows = Array.isArray(data) ? data : [];
  return {
    http_status: status ?? null,
    rows_affected: rows.length,
    error: error ? { code: error.code ?? null, message: error.message } : null,
    raw_rows: rows,
  };
}

async function readOwnRow(supabaseClient, table, rowId) {
  const { data, error } = await supabaseClient.from(table).select("*").eq("id", rowId);
  return { row_count: Array.isArray(data) ? data.length : 0, row: Array.isArray(data) && data[0] ? data[0] : null, error: error ? error.message : null };
}

async function readTenantIds(supabaseClient, table, tenantCol, orgId) {
  const { data, error } = await supabaseClient.from(table).select("id").eq(tenantCol, orgId);
  return { ids: Array.isArray(data) ? data.map((r) => r.id) : [], error: error ? error.message : null };
}

function deepEqualIgnoringVolatile(a, b) {
  if (!a || !b) return a === b;
  const strip = (obj) => {
    const clone = { ...obj };
    delete clone.updated_at;
    return clone;
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

// --- Tier 2 policy-inspection verdicts --------------------------------------

function tier2VerdictForCmd(tableInfo, cmd) {
  if (!tableInfo || tableInfo.table_exists === false) return "TABLE_NOT_FOUND_IN_PRODUCTION";
  if (!tableInfo.rls_enabled) return `P0_RLS_DISABLED_${cmd}`;
  const relevant = (tableInfo.policies || []).filter((p) => p.cmd === cmd || p.cmd === "ALL");
  if (relevant.length === 0) return `PASS_NO_${cmd}_POLICY_DEFAULT_DENY`;
  const col = (tableInfo.tenant_column || "").toLowerCase();
  const orgScoped = relevant.every((p) => {
    const text = `${p.qual || ""} ${p.with_check || ""}`.toLowerCase();
    return text.includes(col) && (text.includes("current_org_id") || text.includes("auth.uid"));
  });
  return orgScoped ? `PASS_POLICY_INSPECTED_ORG_SCOPED_${cmd}` : `INCONCLUSIVE_SUSPICIOUS_PREDICATE_${cmd}`;
}

function worstVerdict(verdicts) {
  const p0 = verdicts.find((v) => v.startsWith("P0"));
  if (p0) return p0;
  const inconclusive = verdicts.find((v) => v.startsWith("INCONCLUSIVE"));
  if (inconclusive) return inconclusive;
  return "PASS";
}

// --- main --------------------------------------------------------------------

async function main() {
  const seedIds = JSON.parse(fs.readFileSync(SEED_IDS_PATH, "utf8"));
  const seedSummary = JSON.parse(fs.readFileSync(SEED_SUMMARY_PATH, "utf8"));
  const prodRls = JSON.parse(fs.readFileSync(PROD_RLS_PATH, "utf8"));
  const liveSchema = JSON.parse(fs.readFileSync(LIVE_SCHEMA_PATH, "utf8"));

  const allTenantTables = Object.keys(prodRls.tables).sort();
  console.log(`Total tenant-scoped tables to cover (from PT-06): ${allTenantTables.length}`);

  assertNotProduction(LOCAL_DB_URL);
  const pg = new Client({ connectionString: LOCAL_DB_URL });
  await pg.connect();
  const dbInfo = await pg.query("select current_database() as db, inet_server_addr()::text as addr");
  console.log(`Target check: local db="${dbInfo.rows[0].db}" addr="${dbInfo.rows[0].addr}"`);
  if (String(dbInfo.rows[0].addr).includes(PRODUCTION_REF)) {
    throw new Error("Live connection reports a production-looking target. Aborting.");
  }

  const orgA = seedIds.orgs.A;
  const orgB = seedIds.orgs.B;

  // Extra FK ids needed for donor_discovery_prospects' insert attempt, plus
  // shared date literals, fetched read-only (not part of the attack surface).
  const anyDir = await pg.query(`select id from donor_discovery_directory order by created_at asc limit 1`);
  const reqB = await pg.query(`select id from donor_discovery_requests where organization_id = $1 limit 1`, [orgB]);
  const extraIds = {
    anyDirectoryId: anyDir.rows[0]?.id ?? null,
    requestIdB: reqB.rows[0]?.id ?? null,
    futureDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    today: new Date().toISOString().slice(0, 10),
  };
  if (!extraIds.anyDirectoryId || !extraIds.requestIdB) {
    throw new Error("Could not resolve extra FK ids (donor_discovery_directory/requests) needed for insert attempts.");
  }
  await pg.end();

  const TIER1_SPECS = buildTier1Specs(seedIds, extraIds);

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
  const jwtB = loginB.session.access_token;
  console.log(`Org B authenticated: user=${loginB.user.id} (expected ${seedSummary.orgs.B.userId})`);

  const supabaseA = createClient(API_URL, ANON_KEY, {
    ...CLIENT_OPTS,
    global: { headers: { Authorization: `Bearer ${jwtA}` } },
  });
  const supabaseB = createClient(API_URL, ANON_KEY, {
    ...CLIENT_OPTS,
    global: { headers: { Authorization: `Bearer ${jwtB}` } },
  });

  const results = { tables: {} };
  let p0Count = 0;
  let passCount = 0;
  let inconclusiveCount = 0;

  // --- Tier 1: live HTTP mutation test, 20 tables --------------------------
  for (const spec of TIER1_SPECS) {
    const { table, tenantCol, updateColumn, updateValue, insertPayload } = spec;
    const seedRow = seedIds.tables[table];
    if (!seedRow) throw new Error(`No seed row recorded for tier-1 table "${table}" -- cannot test.`);
    const rowIdA = seedRow.A;
    const rowIdB = seedRow.B;

    console.log(`\n[TIER 1] ${table} (tenant_column=${tenantCol})`);

    // Shared positive control: Org A updates its OWN row -- proves the RLS
    // write path is live for this table, so a PASS below cannot be a false
    // positive caused by the table blocking everyone, not just Org A -> B.
    const ownBefore = await readOwnRow(supabaseA, table, rowIdA);
    const ownUpdateApi = await apiLayerMutate("update", supabaseA, table, "id", rowIdA, { [updateColumn]: updateValue });
    const ownUpdatePostgrest = await directPostgrestMutate("PATCH", table, "id", rowIdA, jwtA, { [updateColumn]: updateValue });
    const positiveControlOk = ownUpdateApi.rows_affected === 1 || ownUpdatePostgrest.rows_affected === 1;
    console.log(`  positive control (Org A updates own row): api.rows_affected=${ownUpdateApi.rows_affected} postgrest.rows_affected=${ownUpdatePostgrest.rows_affected} ok=${positiveControlOk}`);

    // ---- (a) UPDATE attempt: Org A -> Org B's known row -------------------
    const updateBefore = await readOwnRow(supabaseB, table, rowIdB);
    const updateApi = await apiLayerMutate("update", supabaseA, table, "id", rowIdB, { [updateColumn]: updateValue });
    const updatePostgrest = await directPostgrestMutate("PATCH", table, "id", rowIdB, jwtA, { [updateColumn]: updateValue });
    const updateAfter = await readOwnRow(supabaseB, table, rowIdB);
    const updateReportedSuccess = updateApi.rows_affected > 0 || updatePostgrest.rows_affected > 0;
    const updateDataChanged = !deepEqualIgnoringVolatile(updateBefore.row, updateAfter.row);
    let updateVerdict;
    if (updateReportedSuccess && updateDataChanged) updateVerdict = "P0_CROSS_TENANT_UPDATE_SUCCEEDED";
    else if (!updateReportedSuccess && !updateDataChanged) updateVerdict = "PASS_BLOCKED_ZERO_ROWS_UNCHANGED";
    else updateVerdict = "INCONCLUSIVE_MISMATCH_BETWEEN_RESPONSE_AND_REREAD";
    console.log(`  UPDATE attempt (Org A -> Org B row ${rowIdB}): reported_success=${updateReportedSuccess} data_changed=${updateDataChanged} verdict=${updateVerdict}`);

    // ---- (b) DELETE attempt: Org A -> Org B's known row -------------------
    const deleteBefore = await readOwnRow(supabaseB, table, rowIdB);
    const deleteApi = await apiLayerMutate("delete", supabaseA, table, "id", rowIdB);
    const deletePostgrest = await directPostgrestMutate("DELETE", table, "id", rowIdB, jwtA);
    const deleteAfter = await readOwnRow(supabaseB, table, rowIdB);
    const deleteReportedSuccess = deleteApi.rows_affected > 0 || deletePostgrest.rows_affected > 0;
    const rowActuallyGone = deleteBefore.row_count === 1 && deleteAfter.row_count === 0;
    let deleteVerdict;
    if (deleteReportedSuccess && rowActuallyGone) deleteVerdict = "P0_CROSS_TENANT_DELETE_SUCCEEDED";
    else if (!deleteReportedSuccess && !rowActuallyGone) deleteVerdict = "PASS_BLOCKED_ZERO_ROWS_STILL_PRESENT";
    else deleteVerdict = "INCONCLUSIVE_MISMATCH_BETWEEN_RESPONSE_AND_REREAD";
    console.log(`  DELETE attempt (Org A -> Org B row ${rowIdB}): reported_success=${deleteReportedSuccess} row_actually_gone=${rowActuallyGone} verdict=${deleteVerdict}`);

    // ---- (c) INSERT attempt: Org A creates a row tagged org_id=Org B ------
    const insertBefore = await readTenantIds(supabaseB, table, tenantCol, orgB);
    const payload = insertPayload(orgB);
    const insertApi = await apiLayerMutate("insert", supabaseA, table, "id", null, payload);
    const insertPostgrest = await directPostgrestMutate("POST", table, "id", null, jwtA, payload);
    const insertAfter = await readTenantIds(supabaseB, table, tenantCol, orgB);
    const newIdsVisibleToB = insertAfter.ids.filter((id) => !insertBefore.ids.includes(id));
    const insertReportedSuccess = insertApi.rows_affected > 0 || insertPostgrest.rows_affected > 0;
    let insertVerdict;
    if (newIdsVisibleToB.length > 0) insertVerdict = "P0_CROSS_TENANT_INSERT_SUCCEEDED_VISIBLE_TO_ORG_B";
    else if (!insertReportedSuccess && newIdsVisibleToB.length === 0) insertVerdict = "PASS_BLOCKED_NO_ROW_CREATED";
    else insertVerdict = "INCONCLUSIVE_MISMATCH_BETWEEN_RESPONSE_AND_REREAD";
    console.log(`  INSERT attempt (Org A creates row tagged org_id=Org B): reported_success=${insertReportedSuccess} new_ids_visible_to_org_b=${newIdsVisibleToB.length} verdict=${insertVerdict}`);

    const overall = worstVerdict([updateVerdict, deleteVerdict, insertVerdict]);
    if (overall.startsWith("P0")) {
      p0Count++;
      console.log(`  *** P0 ON ${table}: ${overall} ***`);
    } else if (overall === "PASS") passCount++;
    else inconclusiveCount++;

    results.tables[table] = {
      method: "live_http_test",
      tenant_column: tenantCol,
      org_a_user: seedSummary.orgs.A.userId,
      org_b_user: seedSummary.orgs.B.userId,
      org_b_target_row_id: rowIdB,
      positive_control: {
        description: "Org A updating its own row (proves the RLS write path is live for this table, not globally broken)",
        api_layer: ownUpdateApi,
        direct_postgrest: ownUpdatePostgrest,
        ok: positiveControlOk,
      },
      update_attempt: {
        description: "Org A attempts UPDATE on Org B's known seeded row",
        before_reread_as_org_b: updateBefore,
        api_layer: updateApi,
        direct_postgrest: updatePostgrest,
        after_reread_as_org_b: updateAfter,
        data_changed: updateDataChanged,
        verdict: updateVerdict,
      },
      delete_attempt: {
        description: "Org A attempts DELETE on Org B's known seeded row",
        before_reread_as_org_b: deleteBefore,
        api_layer: deleteApi,
        direct_postgrest: deletePostgrest,
        after_reread_as_org_b: deleteAfter,
        row_actually_gone: rowActuallyGone,
        verdict: deleteVerdict,
      },
      insert_attempt: {
        description: "Org A attempts INSERT of a new row with tenant column set to Org B's org id",
        payload_sent: payload,
        before_org_b_ids_reread_as_org_b: insertBefore.ids,
        api_layer: insertApi,
        direct_postgrest: insertPostgrest,
        after_org_b_ids_reread_as_org_b: insertAfter.ids,
        new_ids_visible_to_org_b: newIdsVisibleToB,
        verdict: insertVerdict,
      },
      verdict: overall,
      leaked_payload:
        overall.startsWith("P0")
          ? {
              update_after: updateVerdict.startsWith("P0") ? updateAfter.row : null,
              delete_after: deleteVerdict.startsWith("P0") ? "row_confirmed_gone" : null,
              insert_new_rows: insertVerdict.startsWith("P0") ? newIdsVisibleToB : null,
            }
          : null,
    };
  }

  // --- Tier 2: production RLS policy inspection, remaining tables ---------
  for (const table of allTenantTables) {
    if (results.tables[table]) continue;
    const tableInfo = prodRls.tables[table];
    const updateVerdict = tier2VerdictForCmd(tableInfo, "UPDATE");
    const deleteVerdict = tier2VerdictForCmd(tableInfo, "DELETE");
    const insertVerdict = tier2VerdictForCmd(tableInfo, "INSERT");
    const overall = worstVerdict([updateVerdict, deleteVerdict, insertVerdict]);

    if (overall.startsWith("P0")) p0Count++;
    else if (overall === "PASS") passCount++;
    else inconclusiveCount++;

    results.tables[table] = {
      method: "production_rls_policy_inspection_readonly",
      tenant_column: tableInfo?.tenant_column ?? null,
      note:
        "Not live-seeded in the PT-05 local environment this phase (seeding all 120 tenant tables was out of scope -- see PHASE-05-SUMMARY.md). Verdict per operation is derived from the REAL production RLS policy state (pg_class.relrowsecurity + pg_policies qual/with_check), fetched read-only, not from application code or assumption.",
      production_rls_enabled: tableInfo?.rls_enabled ?? null,
      production_policies: tableInfo?.policies ?? [],
      update_verdict: updateVerdict,
      delete_verdict: deleteVerdict,
      insert_verdict: insertVerdict,
      verdict: overall,
    };
    if (overall.startsWith("P0")) {
      console.log(`\n*** P0 (policy inspection) on ${table}: ${overall} ***`);
    }
  }

  const missingFromSchema = allTenantTables.filter((t) => !(t in results.tables));
  if (missingFromSchema.length > 0) {
    throw new Error(`Coverage gap: tables never assigned a result: ${missingFromSchema.join(", ")}`);
  }

  const summary = {
    total_tenant_scoped_tables: allTenantTables.length,
    tier1_live_http_tested: TIER1_SPECS.length,
    tier2_policy_inspected: allTenantTables.length - TIER1_SPECS.length,
    p0_cross_tenant_write_findings: p0Count,
    pass_count: passCount,
    inconclusive_or_other: inconclusiveCount,
  };
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    method_overview: {
      tier1:
        "live_http_test -- real GoTrue-authenticated JWT for Org A's real user, real HTTP UPDATE/DELETE/INSERT requests via both @supabase/supabase-js (API layer) and a raw PostgREST fetch, targeting a real seeded row (or, for INSERT, a fabricated row explicitly tagged with Org B's real org id) on the PT-05 local isolated stack with the real production RLS policy predicate reproduced verbatim. After every single attempt, Org B's data is independently re-read AS ORG B (a second real, separately-authenticated session) and compared to a captured before-snapshot -- the attacking request's own reported success/failure is never trusted on its own.",
      tier2:
        "production_rls_policy_inspection_readonly -- no live HTTP request made (table not seeded in this local environment); a verdict per operation (INSERT/UPDATE/DELETE) is derived from the real, live production RLS policy state fetched read-only in pt05-002-fetch-production-rls.mjs.",
    },
    source_of_tenant_table_list: LIVE_SCHEMA_PATH,
    source_of_production_rls_ground_truth: PROD_RLS_PATH,
    orgs: { A: orgA, B: orgB },
    summary,
    tables: results.tables,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\nWrote ${OUT_FILE}`);

  // --- Cleanup: remove any leftover rows an insert attempt may have -------
  // created (expected: none, since RLS should reject every cross-tenant
  // insert -- this is defensive hygiene for the reusable local stack, not
  // part of the evidence itself).
  const pgCleanup = new Client({ connectionString: LOCAL_DB_URL });
  await pgCleanup.connect();
  let cleanedTotal = 0;
  for (const spec of TIER1_SPECS) {
    try {
      const markerCol =
        spec.table === "board_meeting_packets" || spec.table === "impact_simulations"
          ? null // marker lives inside a jsonb column for these two; skip text LIKE cleanup
          : Object.keys(spec.insertPayload(orgB)).find((k) =>
              typeof spec.insertPayload(orgB)[k] === "string" && spec.insertPayload(orgB)[k].includes(INSERT_MARKER_PREFIX),
            );
      if (!markerCol) continue;
      const res = await pgCleanup.query(
        `delete from ${spec.table} where ${markerCol} like $1 returning id`,
        [`${INSERT_MARKER_PREFIX}%`],
      );
      if (res.rows.length > 0) {
        cleanedTotal += res.rows.length;
        console.log(`Cleanup: removed ${res.rows.length} leftover insert-attempt row(s) from ${spec.table}.`);
      }
    } catch (err) {
      console.log(`Cleanup skipped for ${spec.table}: ${err.message}`);
    }
  }
  await pgCleanup.end();
  console.log(`Cleanup complete: ${cleanedTotal} leftover row(s) removed (expected 0 if every insert attempt was correctly blocked).`);
}

main().catch((err) => {
  console.error(`HALT: ${err.stack || err.message}`);
  process.exit(1);
});
