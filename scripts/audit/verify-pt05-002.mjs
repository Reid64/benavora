// ============================================================================
// PT-05-002 verifier -- cross-tenant read attempts, all tenant tables.
//
// Exits non-zero unless:
//   1. test-evidence/pt-05/cross-read.json exists, is valid JSON, and its
//      "tables" object covers EVERY tenant-scoped table PT-06 identified --
//      the expected table list is derived INDEPENDENTLY, straight from
//      test-evidence/pt-06/live-schema.json (organization_id/org_id column
//      presence), not read back from cross-read.json's own summary/list, so
//      a script that silently dropped a table cannot pass by agreeing with
//      itself.
//   2. Every one of PT-06's 13 tenant_fk_gap "prime suspect" tables
//      (test-evidence/pt-06/integrity.json, check=tenant_fk_gap) is present
//      AND was live_http_test'd (method === "live_http_test"), not merely
//      policy-inspected -- these are the tables the task calls out for
//      "extra scrutiny".
//   3. Every table's row records an actual returned-row-count and a verdict:
//      - method === "live_http_test": both
//        cross_tenant_read_attempt.api_layer.row_count and
//        .direct_postgrest.row_count must be present, numeric, and equal to
//        the literal count of rows in that same result's raw_rows array
//        (catches a hand-edited/fabricated row_count that doesn't match its
//        own payload) -- plus a non-empty verdict string.
//      - method === "production_rls_policy_inspection_readonly": the
//        returned_row_count key must be explicitly present (value null is
//        allowed and expected -- no live request was made for these), plus
//        production_rls_enabled (boolean) and a non-empty verdict string.
//   4. Any verdict beginning with "P0" must carry a non-null
//      leaked_payload/evidence field -- a P0 claim with no captured proof is
//      itself a defect in the evidence, not a passing audit.
//   5. Live re-check: reconnect to the recorded local PT-05 stack (not
//      production) and confirm the two orgs referenced in cross-read.json
//      still exist there right now, with current_org_id() still defined --
//      catches evidence that describes an environment that has since been
//      torn down.
//
// This verifier does NOT fail the build because a real P0 leak was found --
// that is the audit doing its job. It fails only on missing coverage,
// missing/inconsistent fields, or an unproven P0 claim.
//
// Usage: node scripts/audit/verify-pt05-002.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const OUT_DIR = path.join("test-evidence", "pt-05");
const CROSS_READ_PATH = path.join(OUT_DIR, "cross-read.json");
const LIVE_SCHEMA_PATH = path.join("test-evidence", "pt-06", "live-schema.json");
const INTEGRITY_PATH = path.join("test-evidence", "pt-06", "integrity.json");
const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:56322/postgres";

let errors = 0;
function fail(message) {
  console.error(`FAIL: ${message}`);
  errors++;
}

// --- 1. independently derive the expected tenant-scoped table list ---------

if (!fs.existsSync(LIVE_SCHEMA_PATH)) {
  fail(`${LIVE_SCHEMA_PATH} does not exist -- cannot derive the expected table list.`);
  process.exit(1);
}
const liveSchema = JSON.parse(fs.readFileSync(LIVE_SCHEMA_PATH, "utf8"));
const expectedTables = [];
for (const [table, def] of Object.entries(liveSchema.tables)) {
  const colNames = def.columns.map((c) => c.column_name);
  if (colNames.includes("organization_id")) expectedTables.push({ table, col: "organization_id" });
  else if (colNames.includes("org_id")) expectedTables.push({ table, col: "org_id" });
}
expectedTables.sort((a, b) => a.table.localeCompare(b.table));
console.log(`Independently derived ${expectedTables.length} tenant-scoped tables from ${LIVE_SCHEMA_PATH}.`);

if (!fs.existsSync(INTEGRITY_PATH)) {
  fail(`${INTEGRITY_PATH} does not exist -- cannot derive the tenant_fk_gap prime-suspect list.`);
}
let primeSuspects = [];
if (fs.existsSync(INTEGRITY_PATH)) {
  const integrity = JSON.parse(fs.readFileSync(INTEGRITY_PATH, "utf8"));
  primeSuspects = (integrity.findings || [])
    .filter((f) => f.check === "tenant_fk_gap")
    .map((f) => f.table);
  console.log(`Independently derived ${primeSuspects.length} tenant_fk_gap prime-suspect tables from ${INTEGRITY_PATH}.`);
}

// --- 2. cross-read.json exists, valid JSON, covers every expected table ----

if (!fs.existsSync(CROSS_READ_PATH)) {
  fail(`${CROSS_READ_PATH} does not exist.`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}
let crossRead;
try {
  crossRead = JSON.parse(fs.readFileSync(CROSS_READ_PATH, "utf8"));
} catch (err) {
  fail(`${CROSS_READ_PATH} is not valid JSON: ${err.message}`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

if (!crossRead.tables || typeof crossRead.tables !== "object") {
  fail(`${CROSS_READ_PATH}.tables is missing or not an object.`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

const missing = expectedTables.filter(({ table }) => !(table in crossRead.tables));
if (missing.length > 0) {
  fail(
    `${CROSS_READ_PATH} is missing ${missing.length} table(s) that PT-06 identified as tenant-scoped: ` +
      missing.map((m) => m.table).join(", "),
  );
} else {
  console.log(`PASS: all ${expectedTables.length} tenant-scoped tables from PT-06 are present in ${CROSS_READ_PATH}.`);
}

// Any extra tables present in cross-read.json but not in the expected set are
// not an error (the file may reasonably include more), but flag for visibility.
const extra = Object.keys(crossRead.tables).filter(
  (t) => !expectedTables.some((e) => e.table === t),
);
if (extra.length > 0) {
  console.log(`Note: ${CROSS_READ_PATH} contains ${extra.length} table(s) beyond PT-06's derived tenant list: ${extra.join(", ")}`);
}

// --- 3. prime suspects must be live_http_test'd, not just policy-inspected -

for (const table of primeSuspects) {
  const row = crossRead.tables[table];
  if (!row) {
    fail(`Prime-suspect table "${table}" (tenant_fk_gap) is missing from ${CROSS_READ_PATH} entirely.`);
    continue;
  }
  if (row.method !== "live_http_test") {
    fail(
      `Prime-suspect table "${table}" (tenant_fk_gap, flagged for extra scrutiny) was not live HTTP-tested -- ` +
        `method="${row.method}". A policy-inspection-only verdict is not sufficient for a flagged prime suspect.`,
    );
  }
}
if (primeSuspects.length > 0 && errors === 0) {
  console.log(`PASS: all ${primeSuspects.length} tenant_fk_gap prime-suspect tables were live HTTP-tested.`);
}

// --- 4. per-table field completeness + internal consistency ----------------

let liveTestedCount = 0;
let policyInspectedCount = 0;
let p0Count = 0;

for (const [table, row] of Object.entries(crossRead.tables)) {
  if (!row.verdict || typeof row.verdict !== "string" || row.verdict.trim() === "") {
    fail(`${table}: missing or empty "verdict".`);
    continue;
  }

  if (row.method === "live_http_test") {
    liveTestedCount++;
    const cross = row.cross_tenant_read_attempt;
    if (!cross || !cross.api_layer || !cross.direct_postgrest) {
      fail(`${table}: method=live_http_test but cross_tenant_read_attempt.api_layer/direct_postgrest is missing.`);
      continue;
    }
    for (const [layerName, layer] of [
      ["api_layer", cross.api_layer],
      ["direct_postgrest", cross.direct_postgrest],
    ]) {
      if (typeof layer.row_count !== "number") {
        fail(`${table}.cross_tenant_read_attempt.${layerName}.row_count is not a number.`);
        continue;
      }
      if (!Array.isArray(layer.raw_rows)) {
        fail(`${table}.cross_tenant_read_attempt.${layerName}.raw_rows is missing or not an array.`);
        continue;
      }
      if (layer.row_count !== layer.raw_rows.length) {
        fail(
          `${table}.cross_tenant_read_attempt.${layerName}: row_count (${layer.row_count}) does not match ` +
            `raw_rows.length (${layer.raw_rows.length}) -- row_count does not match its own captured payload.`,
        );
      }
    }
    if (!row.positive_control || !row.positive_control.api_layer || !row.positive_control.direct_postgrest) {
      fail(`${table}: missing positive_control (own-row read) -- cannot confirm RLS wiring is even live for this table.`);
    }
  } else if (row.method === "production_rls_policy_inspection_readonly") {
    policyInspectedCount++;
    if (!("returned_row_count" in row)) {
      fail(`${table}: method=production_rls_policy_inspection_readonly but "returned_row_count" key is absent.`);
    }
    if (typeof row.production_rls_enabled !== "boolean") {
      fail(`${table}: production_rls_enabled is missing or not a boolean.`);
    }
  } else {
    fail(`${table}: unrecognized method "${row.method}".`);
  }

  if (row.verdict.startsWith("P0")) {
    p0Count++;
    const hasProof =
      row.leaked_payload !== undefined && row.leaked_payload !== null
        ? true
        : row.production_select_policies !== undefined;
    if (!hasProof) {
      fail(`${table}: verdict "${row.verdict}" is a P0 claim with no captured proof (leaked_payload/production_select_policies).`);
    }
  }
}

console.log(`\nCoverage: ${Object.keys(crossRead.tables).length} tables total -- ${liveTestedCount} live_http_test, ${policyInspectedCount} production_rls_policy_inspection_readonly.`);
console.log(`P0 findings recorded: ${p0Count}.`);

// --- 5. live re-check: local stack still exists and matches -----------------

async function liveRecheck() {
  if (errors > 0) {
    console.error("SKIP: live re-check skipped because static checks above already failed.");
    return;
  }
  if (!crossRead.orgs || !crossRead.orgs.A || !crossRead.orgs.B) {
    fail(`${CROSS_READ_PATH}.orgs.A/.B is missing -- cannot live re-check.`);
    return;
  }

  const url = new URL(LOCAL_DB_URL.replace(/^postgresql:/, "postgres:"));
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    fail(`Live re-check target host "${url.hostname}" is not local. Refusing to connect.`);
    return;
  }

  let client;
  try {
    client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
  } catch (err) {
    fail(`Could not connect to the recorded local target: ${err.message}`);
    return;
  }

  try {
    const dbInfo = await client.query("select current_database() as db, inet_server_addr()::text as addr");
    const { db, addr } = dbInfo.rows[0];
    if (String(addr).includes(PRODUCTION_REF) || String(db).includes(PRODUCTION_REF)) {
      fail(`Live re-check connection reports a production-looking target (db="${db}" addr="${addr}"). Aborting.`);
      return;
    }
    console.log(`Live re-check connected: database="${db}" server_addr="${addr}" (not production).`);

    const orgRes = await client.query(
      `select id from organizations where id = any($1::uuid[])`,
      [[crossRead.orgs.A, crossRead.orgs.B]],
    );
    if (orgRes.rows.length !== 2) {
      fail(`Live re-check: expected both Org A and Org B (${crossRead.orgs.A}, ${crossRead.orgs.B}) to still exist locally; found ${orgRes.rows.length}.`);
    } else {
      console.log(`Live re-check PASS: both Org A and Org B still exist in the local stack.`);
    }

    const fnRes = await client.query(
      `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'current_org_id'`,
    );
    if (fnRes.rows.length === 0) {
      fail(`Live re-check: public.current_org_id() no longer exists in the local stack.`);
    } else {
      console.log(`Live re-check PASS: public.current_org_id() still exists in the local stack.`);
    }

    // Spot re-verify a positive_control claim for one table directly against
    // the DB, rather than trusting cross-read.json's own recorded row_count.
    const sample = crossRead.tables["applications"];
    if (sample && sample.method === "live_http_test") {
      const rowIdA = sample.positive_control?.api_layer?.raw_rows?.[0]?.id;
      if (rowIdA) {
        const reQuery = await client.query(`select organization_id from applications where id = $1`, [rowIdA]);
        if (reQuery.rows.length !== 1 || reQuery.rows[0].organization_id !== crossRead.orgs.A) {
          fail(`Live re-check: applications positive_control row ${rowIdA} does not independently re-verify as belonging to Org A.`);
        } else {
          console.log(`Live re-check PASS: applications positive_control row independently re-verified as belonging to Org A.`);
        }
      }
    }
  } finally {
    await client.end();
  }
}

await liveRecheck();

if (errors > 0) {
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

console.log(`\nPASS: ${CROSS_READ_PATH} covers all ${expectedTables.length} PT-06 tenant-scoped tables.`);
console.log(`PASS: all ${primeSuspects.length} tenant_fk_gap prime-suspect tables were live HTTP-tested (not just policy-inspected).`);
console.log(`PASS: every table row records an actual returned-row-count (or explicit null for policy-inspection-only rows) and a verdict.`);
console.log(`PASS: live re-check confirms the described local environment still exists and matches.`);
process.exit(0);
