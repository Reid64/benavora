#!/usr/bin/env node
// FORGE gate - AR-5.1/5.2: there must be exactly ONE cost ledger.
// Authored 2026-09-17. Verified against the live schema before shipping:
//   ai_usage_log  = 0 rows, referenced only by migration 056, no app writer
//   pil_cost_ledger = 49 rows, written only by src/lib/pil/cost.ts
// This gate fails if the build forks cost tracking instead of consolidating it.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { stripSql } from "./_sql.mjs";

const MIG = "supabase/migrations";
const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };

let files;
try { files = readdirSync(MIG).filter((f) => f.endsWith(".sql")); }
catch { fail(`cannot read ${MIG}`); }

const num = (f) => { const m = /^(\d+)/.exec(f); return m ? Number(m[1]) : -1; };
const newMigs = files.filter((f) => num(f) >= 185);
if (newMigs.length === 0) fail("no migration numbered 185 or higher - AR-5 wrote no schema change");

// Comments and string literals are stripped first: a comment that merely
// MENTIONS a forbidden construct is not a use of it (2026-09-17 regression).
const newSql = stripSql(newMigs.map((f) => readFileSync(join(MIG, f), "utf8")).join("\n")).toLowerCase();

// Column names added to ai_usage_log are extracted as an exact SET. Substring
// matching on a blob failed twice (2026-09-17): /agent_run_id/ matched inside
// pil_agent_run_id, and /billing_path/ matched a CONSTRAINT NAME. Membership
// on parsed names is immune to both.
const alterStmts = [...newSql.matchAll(/alter\s+table\s+(?:public\.)?ai_usage_log\b[^;]*;/g)].map((m) => m[0]);
if (!alterStmts.length) fail("no ALTER TABLE ai_usage_log statement in any migration >=185");

const added = new Map(); // column name -> its type text
for (const stmt of alterStmts) {
  for (const m of stmt.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s+([a-z0-9_]+(?:\s*\([^)]*\))?)/g)) {
    added.set(m[1], m[2]);
  }
}
if (added.size === 0) fail("ALTER TABLE ai_usage_log exists but adds no columns");

// 1. A numeric USD column. estimated_cost_cents is an integer and cannot
//    represent a sub-cent Haiku call ($0.0035 -> 0 cents).
if (!added.has("cost_usd"))
  fail(`ai_usage_log gains no cost_usd column (columns added: ${[...added.keys()].join(", ") || "none"})`);
if (!/^numeric/.test(added.get("cost_usd")))
  fail(`ai_usage_log.cost_usd is '${added.get("cost_usd")}', not numeric - integer cents truncates sub-cent calls`);

// 2. A cost row must be attributable to the run that incurred it. Note
//    pil_agent_run_id is a DIFFERENT column and does not satisfy this.
if (!added.has("agent_run_id"))
  fail(`ai_usage_log gains no agent_run_id column - cost cannot be attributed to a core agent run (columns added: ${[...added.keys()].join(", ")})`);

// 3. Subscription spend must be distinguishable from API spend.
if (!added.has("billing_path"))
  fail(`ai_usage_log gains no billing_path column - CLI/subscription rows would read as real dollar spend (columns added: ${[...added.keys()].join(", ")})`);

// 4. No second/third cost or budget table.
const forked = /create\s+table\s+(if\s+not\s+exists\s+)?(public\.)?(orchestration_cost_budget|orchestration_cost_ledger|cost_ledger_v2|orchestration_usage)/.exec(newSql);
if (forked) fail(`migration creates a forked cost table: ${forked[3]} - consolidate instead`);

// 5. The single writer must have moved.
let cost;
try { cost = readFileSync("src/lib/pil/cost.ts", "utf8"); }
catch { fail("src/lib/pil/cost.ts not found"); }
if (/from\(\s*["']pil_cost_ledger["']\s*\)[\s\S]{0,120}?\.insert/.test(cost))
  fail("src/lib/pil/cost.ts still INSERTs into pil_cost_ledger - two ledgers still being written");
if (!/from\(\s*["']ai_usage_log["']\s*\)/.test(cost))
  fail("src/lib/pil/cost.ts does not write ai_usage_log - consolidation did not happen");

console.log("OK: single cost ledger (ai_usage_log) with numeric USD, run attribution, billing_path; no forked cost table");
