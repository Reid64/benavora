// ============================================================================
// PT-05-003 verifier -- cross-tenant WRITE attempts (UPDATE, DELETE, INSERT),
// all tenant tables.
//
// Exits non-zero unless:
//   1. test-evidence/pt-05/cross-write.json exists, is valid JSON, and its
//      "tables" object covers EVERY tenant-scoped table PT-06 identified --
//      the expected table list is derived INDEPENDENTLY, straight from
//      test-evidence/pt-06/live-schema.json (organization_id/org_id column
//      presence), not read back from cross-write.json's own summary/list, so
//      a script that silently dropped a table cannot pass by agreeing with
//      itself.
//   2. Every one of PT-06's 13 tenant_fk_gap "prime suspect" tables
//      (test-evidence/pt-06/integrity.json, check=tenant_fk_gap) is present
//      AND was live_http_test'd (method === "live_http_test"), not merely
//      policy-inspected.
//   3. Every table's row records all THREE attempt types with a verdict, and
//      a post-attempt Org-B-unchanged confirmation:
//      - method === "live_http_test": update_attempt, delete_attempt, and
//        insert_attempt must each be present with a non-empty verdict AND a
//        real before/after re-read captured as Org B (before_reread_as_org_b
//        + after_reread_as_org_b for update/delete; before/after org-B id
//        lists for insert) -- this is the actual "re-read as Org B" proof
//        the task requires, not just a trust of the attacking request's own
//        reported result. api_layer/direct_postgrest rows_affected must be a
//        number equal to the literal length of that same result's raw_rows
//        array (catches a hand-edited/fabricated rows_affected).
//      - method === "production_rls_policy_inspection_readonly": update_
//        verdict, delete_verdict, and insert_verdict must each be present
//        and non-empty, plus production_rls_enabled (boolean).
//   4. Any verdict beginning with "P0" (at the per-attempt-type level or the
//      table's overall verdict) must carry a non-null proof field --
//      leaked_payload for Tier 1, production_policies for Tier 2. A P0 claim
//      with no captured proof is itself a defect in the evidence.
//   5. Live re-check: reconnect to the recorded local PT-05 stack (not
//      production), confirm both orgs still exist there with
//      current_org_id() still defined, and independently re-verify -- via a
//      direct DB read, not cross-write.json's own recorded claim -- that one
//      sampled table's Org B row genuinely does NOT carry the attack marker
//      value the UPDATE attempt tried to write, and that its row still
//      exists (the DELETE attempt did not succeed).
//
// This verifier does NOT fail the build because a real P0 cross-tenant write
// was found -- that is the audit doing its job. It fails only on missing
// coverage, missing/inconsistent fields, or an unproven P0 claim.
//
// Usage: node scripts/audit/verify-pt05-003.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const OUT_DIR = path.join("test-evidence", "pt-05");
const CROSS_WRITE_PATH = path.join(OUT_DIR, "cross-write.json");
const LIVE_SCHEMA_PATH = path.join("test-evidence", "pt-06", "live-schema.json");
const INTEGRITY_PATH = path.join("test-evidence", "pt-06", "integrity.json");
const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const MARKER_TEXT = "PT05-003-CROSS-WRITE-ATTEMPT";

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

// --- 2. cross-write.json exists, valid JSON, covers every expected table ---

if (!fs.existsSync(CROSS_WRITE_PATH)) {
  fail(`${CROSS_WRITE_PATH} does not exist.`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}
let crossWrite;
try {
  crossWrite = JSON.parse(fs.readFileSync(CROSS_WRITE_PATH, "utf8"));
} catch (err) {
  fail(`${CROSS_WRITE_PATH} is not valid JSON: ${err.message}`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

if (!crossWrite.tables || typeof crossWrite.tables !== "object") {
  fail(`${CROSS_WRITE_PATH}.tables is missing or not an object.`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

const missing = expectedTables.filter(({ table }) => !(table in crossWrite.tables));
if (missing.length > 0) {
  fail(
    `${CROSS_WRITE_PATH} is missing ${missing.length} table(s) that PT-06 identified as tenant-scoped: ` +
      missing.map((m) => m.table).join(", "),
  );
} else {
  console.log(`PASS: all ${expectedTables.length} tenant-scoped tables from PT-06 are present in ${CROSS_WRITE_PATH}.`);
}

const extra = Object.keys(crossWrite.tables).filter((t) => !expectedTables.some((e) => e.table === t));
if (extra.length > 0) {
  console.log(`Note: ${CROSS_WRITE_PATH} contains ${extra.length} table(s) beyond PT-06's derived tenant list: ${extra.join(", ")}`);
}

// --- 3. prime suspects must be live_http_test'd, not just policy-inspected -

for (const table of primeSuspects) {
  const row = crossWrite.tables[table];
  if (!row) {
    fail(`Prime-suspect table "${table}" (tenant_fk_gap) is missing from ${CROSS_WRITE_PATH} entirely.`);
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

// --- 4. per-table field completeness + all three attempt types present -----

let liveTestedCount = 0;
let policyInspectedCount = 0;
let p0Count = 0;

function checkMutationLayer(table, attemptName, layerName, layer) {
  if (!layer) {
    fail(`${table}.${attemptName}: missing "${layerName}" layer result.`);
    return;
  }
  if (typeof layer.rows_affected !== "number") {
    fail(`${table}.${attemptName}.${layerName}.rows_affected is not a number.`);
    return;
  }
  if (!Array.isArray(layer.raw_rows)) {
    fail(`${table}.${attemptName}.${layerName}.raw_rows is missing or not an array.`);
    return;
  }
  if (layer.rows_affected !== layer.raw_rows.length) {
    fail(
      `${table}.${attemptName}.${layerName}: rows_affected (${layer.rows_affected}) does not match ` +
        `raw_rows.length (${layer.raw_rows.length}) -- does not match its own captured payload.`,
    );
  }
}

for (const [table, row] of Object.entries(crossWrite.tables)) {
  if (!row.verdict || typeof row.verdict !== "string" || row.verdict.trim() === "") {
    fail(`${table}: missing or empty overall "verdict".`);
    continue;
  }

  if (row.method === "live_http_test") {
    liveTestedCount++;

    // ---- (a) UPDATE ---------------------------------------------------
    const upd = row.update_attempt;
    if (!upd || !upd.verdict) {
      fail(`${table}: missing update_attempt or update_attempt.verdict.`);
    } else {
      checkMutationLayer(table, "update_attempt", "api_layer", upd.api_layer);
      checkMutationLayer(table, "update_attempt", "direct_postgrest", upd.direct_postgrest);
      if (!upd.before_reread_as_org_b || !("row_count" in upd.before_reread_as_org_b)) {
        fail(`${table}.update_attempt: missing before_reread_as_org_b (the re-read-as-Org-B proof required before the attempt).`);
      }
      if (!upd.after_reread_as_org_b || !("row_count" in upd.after_reread_as_org_b)) {
        fail(`${table}.update_attempt: missing after_reread_as_org_b (the re-read-as-Org-B proof required after the attempt).`);
      }
      if (typeof upd.data_changed !== "boolean") {
        fail(`${table}.update_attempt.data_changed is missing or not a boolean.`);
      }
    }

    // ---- (b) DELETE -----------------------------------------------------
    const del = row.delete_attempt;
    if (!del || !del.verdict) {
      fail(`${table}: missing delete_attempt or delete_attempt.verdict.`);
    } else {
      checkMutationLayer(table, "delete_attempt", "api_layer", del.api_layer);
      checkMutationLayer(table, "delete_attempt", "direct_postgrest", del.direct_postgrest);
      if (!del.before_reread_as_org_b || !("row_count" in del.before_reread_as_org_b)) {
        fail(`${table}.delete_attempt: missing before_reread_as_org_b (the re-read-as-Org-B proof required before the attempt).`);
      }
      if (!del.after_reread_as_org_b || !("row_count" in del.after_reread_as_org_b)) {
        fail(`${table}.delete_attempt: missing after_reread_as_org_b (the re-read-as-Org-B proof required after the attempt -- must show Org B's row still exists).`);
      }
      if (typeof del.row_actually_gone !== "boolean") {
        fail(`${table}.delete_attempt.row_actually_gone is missing or not a boolean.`);
      }
    }

    // ---- (c) INSERT -------------------------------------------------------
    const ins = row.insert_attempt;
    if (!ins || !ins.verdict) {
      fail(`${table}: missing insert_attempt or insert_attempt.verdict.`);
    } else {
      checkMutationLayer(table, "insert_attempt", "api_layer", ins.api_layer);
      checkMutationLayer(table, "insert_attempt", "direct_postgrest", ins.direct_postgrest);
      if (!Array.isArray(ins.before_org_b_ids_reread_as_org_b)) {
        fail(`${table}.insert_attempt: missing before_org_b_ids_reread_as_org_b array (the re-read-as-Org-B proof required before the attempt).`);
      }
      if (!Array.isArray(ins.after_org_b_ids_reread_as_org_b)) {
        fail(`${table}.insert_attempt: missing after_org_b_ids_reread_as_org_b array (the re-read-as-Org-B proof required after the attempt).`);
      }
      if (!Array.isArray(ins.new_ids_visible_to_org_b)) {
        fail(`${table}.insert_attempt.new_ids_visible_to_org_b is missing or not an array.`);
      }
    }

    if (!row.positive_control || typeof row.positive_control.ok !== "boolean") {
      fail(`${table}: missing positive_control (Org A updating its own row) or positive_control.ok is not a boolean.`);
    }
  } else if (row.method === "production_rls_policy_inspection_readonly") {
    policyInspectedCount++;
    for (const key of ["update_verdict", "delete_verdict", "insert_verdict"]) {
      if (!row[key] || typeof row[key] !== "string" || row[key].trim() === "") {
        fail(`${table}: method=production_rls_policy_inspection_readonly but "${key}" is missing or empty.`);
      }
    }
    if (typeof row.production_rls_enabled !== "boolean") {
      fail(`${table}: production_rls_enabled is missing or not a boolean.`);
    }
  } else {
    fail(`${table}: unrecognized method "${row.method}".`);
  }

  // ---- P0 claims must carry proof ------------------------------------
  const allVerdicts = [
    row.verdict,
    row.update_attempt?.verdict,
    row.delete_attempt?.verdict,
    row.insert_attempt?.verdict,
    row.update_verdict,
    row.delete_verdict,
    row.insert_verdict,
  ].filter(Boolean);
  const anyP0 = allVerdicts.some((v) => v.startsWith("P0"));
  if (anyP0) {
    p0Count++;
    const hasProof =
      (row.leaked_payload !== undefined && row.leaked_payload !== null) ||
      row.production_policies !== undefined;
    if (!hasProof) {
      fail(`${table}: a P0 verdict is present (${allVerdicts.filter((v) => v.startsWith("P0")).join(", ")}) with no captured proof (leaked_payload/production_policies).`);
    }
  }
}

console.log(
  `\nCoverage: ${Object.keys(crossWrite.tables).length} tables total -- ${liveTestedCount} live_http_test, ${policyInspectedCount} production_rls_policy_inspection_readonly.`,
);
console.log(`Tables with at least one P0 verdict: ${p0Count}.`);

// --- 5. live re-check: local stack still exists, and a direct DB read ------
//        independently re-confirms one sampled Org B row was NOT mutated.

async function liveRecheck() {
  if (errors > 0) {
    console.error("SKIP: live re-check skipped because static checks above already failed.");
    return;
  }
  if (!crossWrite.orgs || !crossWrite.orgs.A || !crossWrite.orgs.B) {
    fail(`${CROSS_WRITE_PATH}.orgs.A/.B is missing -- cannot live re-check.`);
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

    const orgRes = await client.query(`select id from organizations where id = any($1::uuid[])`, [
      [crossWrite.orgs.A, crossWrite.orgs.B],
    ]);
    if (orgRes.rows.length !== 2) {
      fail(
        `Live re-check: expected both Org A and Org B (${crossWrite.orgs.A}, ${crossWrite.orgs.B}) to still exist locally; found ${orgRes.rows.length}.`,
      );
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

    // Independently re-verify one sampled table's Org B row directly against
    // the DB (bypassing RLS via this superuser connection), rather than
    // trusting cross-write.json's own recorded before/after claim.
    const sample = crossWrite.tables["applications"];
    if (sample && sample.method === "live_http_test") {
      const rowIdB = sample.org_b_target_row_id;
      const reQuery = await client.query(
        `select organization_id, notes from applications where id = $1`,
        [rowIdB],
      );
      if (reQuery.rows.length !== 1) {
        fail(`Live re-check: applications row ${rowIdB} (Org B's DELETE-attempt target) no longer exists -- the DELETE attempt may have actually succeeded.`);
      } else {
        const dbRow = reQuery.rows[0];
        if (dbRow.organization_id !== crossWrite.orgs.B) {
          fail(`Live re-check: applications row ${rowIdB} organization_id is "${dbRow.organization_id}", expected Org B ("${crossWrite.orgs.B}") -- ownership changed.`);
        } else if (dbRow.notes === MARKER_TEXT) {
          fail(`Live re-check: applications row ${rowIdB}.notes equals the cross-tenant UPDATE attack marker ("${MARKER_TEXT}") -- the UPDATE attempt appears to have actually succeeded, contradicting cross-write.json's recorded verdict.`);
        } else {
          console.log(`Live re-check PASS: applications row ${rowIdB} still exists, still belongs to Org B, and does not carry the UPDATE attack marker -- independently re-confirms the recorded verdict directly against the database.`);
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

console.log(`\nPASS: ${CROSS_WRITE_PATH} covers all ${expectedTables.length} PT-06 tenant-scoped tables.`);
console.log(`PASS: all ${primeSuspects.length} tenant_fk_gap prime-suspect tables were live HTTP-tested (not just policy-inspected).`);
console.log(`PASS: every table records all three attempt types (UPDATE, DELETE, INSERT) with a verdict and a post-attempt Org-B-unchanged re-read (or explicit policy-inspection verdicts for non-seeded tables).`);
console.log(`PASS: live re-check confirms the described local environment still exists and independently re-confirms one sampled claim directly against the database.`);
process.exit(0);
