#!/usr/bin/env node
// FORGE gate - AR-6.1: extend the alerts table, never fork it.
// Live facts verified 2026-09-17: public.alerts holds 1,806 rows and is firing
// today; alert_type enum = (deadline_due, new_opportunity, application_action,
// draft_review, system); unique index uq_alerts_org_dedup already provides
// dedup. A second alert inbox is a defect, not a feature.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { stripSql } from "./_sql.mjs";

const MIG = "supabase/migrations";
const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
const NEW_TYPES = ["task_failed","cost_overage","schema_mismatch","state_drift","rate_limit","timeout","rollback","manual_review_required"];

let files;
try { files = readdirSync(MIG).filter((f) => f.endsWith(".sql")); }
catch { fail(`cannot read ${MIG}`); }

const num = (f) => { const m = /^(\d+)/.exec(f); return m ? Number(m[1]) : -1; };
const newMigs = files.filter((f) => num(f) >= 185);
if (newMigs.length === 0) fail("no migration numbered 185 or higher - AR-6 wrote no schema change");
// Comments and string literals are stripped first: a comment that merely
// MENTIONS a forbidden construct is not a use of it (2026-09-17 regression).
const newSql = stripSql(newMigs.map((f) => readFileSync(join(MIG, f), "utf8")).join("\n")).toLowerCase();

// 1. No forked alert table.
if (/create\s+table\s+(if\s+not\s+exists\s+)?(public\.)?orchestration_alerts/.test(newSql))
  fail("migration creates orchestration_alerts - extend public.alerts instead (1,806 live rows, dedup + ack + snooze already present)");

// 2. Every one of the eight orchestration types must be added to the enum.
if (!/alter\s+type\s+(public\.)?alert_type\s+add\s+value/.test(newSql))
  fail("no ALTER TYPE alert_type ADD VALUE found - the eight orchestration alert types were never added");
const missingSql = NEW_TYPES.filter((t) => !new RegExp(`add\\s+value[^;]*'${t}'`).test(newSql));
if (missingSql.length) fail(`alert_type enum is missing: ${missingSql.join(", ")}`);

// 3. The hand-maintained type file must match the DB enum.
let dbTypes;
try { dbTypes = readFileSync("src/types/database.ts", "utf8"); }
catch { fail("src/types/database.ts not found"); }
const missingTs = NEW_TYPES.filter((t) => !dbTypes.includes(`"${t}"`));
if (missingTs.length) fail(`src/types/database.ts alert_type union is missing: ${missingTs.join(", ")}`);

// 4. ALERT_TYPE_LABEL is Record<AlertType, string>; every new value needs a label
//    or tsc fails. Assert it explicitly so the gate names the cause.
let svc;
try { svc = readFileSync("src/lib/alerts/alerts-service.ts", "utf8"); }
catch { fail("src/lib/alerts/alerts-service.ts not found"); }
// \b prefix: without it, renaming `rollback:` to `XXrollback:` still matched
const missingLabel = NEW_TYPES.filter((t) => !new RegExp(`\\b${t}\\s*:`).test(svc));
if (missingLabel.length) fail(`ALERT_TYPE_LABEL is missing entries for: ${missingLabel.join(", ")}`);

// 5. Orchestration dedup keys must be deterministic. The existing codebase
//    appends crypto.randomUUID() to dedup_key in several agents, which defeats
//    uq_alerts_org_dedup entirely. New orchestration alerts must not copy that.
for (const line of svc.split("\n")) {
  if (/orchestration/i.test(line) && /dedup/i.test(line) && /randomUUID/.test(line))
    fail("an orchestration dedup_key uses crypto.randomUUID() - that makes every key unique and disables dedup");
}

console.log(`OK: alerts extended in place with ${NEW_TYPES.length} orchestration types; no forked alert table; labels and TS union in sync`);
