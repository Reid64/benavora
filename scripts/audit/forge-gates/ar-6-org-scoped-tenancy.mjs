#!/usr/bin/env node
// FORGE gate - AR-6.2/6.3: tenancy is organization_id, and orchestration_logs
// records execution facts only.
// Verified 2026-09-17 against the live schema: 146 columns in public are named
// organization_id; ZERO are named company_id. The v1.0 spec this phase is built
// from scopes every table by company_id. If a build agent follows the spec
// literally, Benavora ends up with two tenancy conventions and RLS is enforced
// inconsistently - a cross-tenant read path. This gate exists to stop that.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { stripSql } from "./_sql.mjs";

const MIG = "supabase/migrations";
const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };

let files;
try { files = readdirSync(MIG).filter((f) => f.endsWith(".sql")); }
catch { fail(`cannot read ${MIG}`); }
const num = (f) => { const m = /^(\d+)/.exec(f); return m ? Number(m[1]) : -1; };
const newMigs = files.filter((f) => num(f) >= 185).sort();
if (newMigs.length === 0) fail("no migration numbered 185 or higher - AR-6 wrote no schema change");

// 1. company_id must appear nowhere in the new migrations.
for (const f of newMigs) {
  const sql = stripSql(readFileSync(join(MIG, f), "utf8"));
  if (/company_id/i.test(sql))
    fail(`${f} references company_id - Benavora's tenancy column is organization_id (146 columns; company_id: 0)`);
}

// Comments and string literals are stripped first: a comment that merely
// MENTIONS a forbidden construct is not a use of it (2026-09-17 regression).
const newSql = stripSql(newMigs.map((f) => readFileSync(join(MIG, f), "utf8")).join("\n")).toLowerCase();

// 2. orchestration_logs must exist and be org-scoped.
const create = /create\s+table\s+(if\s+not\s+exists\s+)?(public\.)?orchestration_logs\s*\(([\s\S]*?)\n\s*\)\s*;/.exec(newSql);
if (!create) fail("no CREATE TABLE orchestration_logs found in migrations >=185");
const body = create[3];
if (!/organization_id\s+uuid/.test(body))
  fail("orchestration_logs has no organization_id uuid column");
if (!/references\s+(public\.)?organizations\s*\(\s*id\s*\)/.test(body))
  fail("orchestration_logs.organization_id has no FK to organizations(id)");

// 3. The two columns that make a claim falsifiable.
for (const col of ["schema_validation_passed", "reconciliation_passed"]) {
  if (!new RegExp(`${col}\\s+boolean`).test(body))
    fail(`orchestration_logs is missing ${col} boolean - without it a run's success claim cannot be checked`);
}

// 4. Execution facts only. Cost lives in ai_usage_log; a cost column here is a
//    fourth cost model.
const costCol = /(^|\s)(cost_usd|total_cost_usd|estimated_cost_cents|cost_cents|unit_cost)\s+(numeric|integer|bigint|decimal)/.exec(body);
if (costCol) fail(`orchestration_logs declares its own cost column '${costCol[2]}' - reference ai_usage_log(id) instead`);
if (!/cost_log_id\s+uuid/.test(body))
  fail("orchestration_logs has no cost_log_id uuid FK to ai_usage_log(id) - cost cannot be joined to the run");

// 5. RLS must be on.
if (!new RegExp("alter\\s+table\\s+(public\\.)?orchestration_logs\\s+enable\\s+row\\s+level\\s+security").test(newSql))
  fail("RLS is not enabled on orchestration_logs");

console.log("OK: orchestration_logs is organization_id-scoped with RLS, carries schema_validation_passed + reconciliation_passed, and holds no cost columns");
