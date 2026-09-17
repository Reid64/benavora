#!/usr/bin/env node
// FORGE gate - AR-5.2: budget enforcement must be real, not decorative.
// Live facts verified 2026-09-17: pil_cost_budgets has 0 rows; spent_usd is
// READ in three places (BEN-SUP-03.ts:296, BEN-SUP-04.ts:256, the PIL
// dashboard page) and WRITTEN by nothing. A budget whose spend never accrues
// can never be exceeded, so hard_stop can never fire. compile + test +
// file_exists can all pass while that is still true, so this gate exists.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const MIG = "supabase/migrations";
const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };

let files;
try { files = readdirSync(MIG).filter((f) => f.endsWith(".sql")); }
catch { fail(`cannot read ${MIG}`); }
const num = (f) => { const m = /^(\d+)/.exec(f); return m ? Number(m[1]) : -1; };
const newMigs = files.filter((f) => num(f) >= 185);
if (newMigs.length === 0) fail("no migration numbered 185 or higher - AR-5.2 wrote no schema change");
const newSql = newMigs.map((f) => readFileSync(join(MIG, f), "utf8")).join("\n").toLowerCase();

// 1. One budget table. The v1.0 spec asks for orchestration_cost_budget; that
//    would be a third budget table and a second copy of the enforcement logic.
if (/create\s+table\s+(if\s+not\s+exists\s+)?(public\.)?orchestration_cost_budget/.test(newSql))
  fail("migration creates orchestration_cost_budget - extend cost_budgets with an 'orchestration' scope instead");

// 2. The rename must have happened.
if (!/alter\s+table\s+(public\.)?pil_cost_budgets\s+rename\s+to\s+cost_budgets/.test(newSql))
  fail("pil_cost_budgets was not renamed to cost_budgets (it has 0 rows, so the rename is free)");

// 3. The 'orchestration' scope must be allowed.
if (!/orchestration/.test(newSql))
  fail("no migration >=185 admits an 'orchestration' scope_type - the orchestration layer has no budget scope");

// 4. Spend must accrue from the cost ledger via a trigger, in SQL, not in
//    application code that a failed process can skip.
const hasTrigger = /create\s+(or\s+replace\s+)?trigger[\s\S]{0,300}?on\s+(public\.)?ai_usage_log/.test(newSql);
if (!hasTrigger) fail("no trigger on ai_usage_log - spent_usd still never increases, so hard_stop can never fire");
if (!/spent_usd/.test(newSql)) fail("no migration >=185 writes spent_usd - budget accrual was not implemented");

// 5. The trigger must not try to reach the network (pg_net is not installed).
if (/(net\.http_post|http_post\s*\()/.test(newSql))
  fail("the accrual path makes an HTTP call from SQL - pg_net is not installed on this project");

// 6. No stale references to the old table name.
const srcDirs = ["src/lib/pil/cost.ts", "src/lib/pil/types.ts", "src/lib/pil/agents/sup/BEN-SUP-03.ts", "src/lib/pil/agents/sup/BEN-SUP-04.ts"];
const stale = srcDirs.filter((p) => existsSync(p) && /pil_cost_budgets/.test(readFileSync(p, "utf8")));
if (stale.length) fail(`still references the pre-rename table pil_cost_budgets: ${stale.join(", ")}`);

console.log("OK: one budget table (cost_budgets) with an orchestration scope, spend accrues by SQL trigger on ai_usage_log, no stale references");
