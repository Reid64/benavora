#!/usr/bin/env node
// FORGE gate - AR-5.1/5.2: there must be exactly ONE cost ledger.
// Authored 2026-09-17. Verified against the live schema before shipping:
//   ai_usage_log  = 0 rows, referenced only by migration 056, no app writer
//   pil_cost_ledger = 49 rows, written only by src/lib/pil/cost.ts
// This gate fails if the build forks cost tracking instead of consolidating it.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIG = "supabase/migrations";
const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };

let files;
try { files = readdirSync(MIG).filter((f) => f.endsWith(".sql")); }
catch { fail(`cannot read ${MIG}`); }

const num = (f) => { const m = /^(\d+)/.exec(f); return m ? Number(m[1]) : -1; };
const newMigs = files.filter((f) => num(f) >= 185);
if (newMigs.length === 0) fail("no migration numbered 185 or higher - AR-5 wrote no schema change");

const newSql = newMigs.map((f) => readFileSync(join(MIG, f), "utf8")).join("\n").toLowerCase();

// 1. ai_usage_log must gain a numeric USD column. estimated_cost_cents is an
//    integer and cannot represent a sub-cent Haiku call.
if (!/alter\s+table\s+(public\.)?ai_usage_log[\s\S]{0,400}?cost_usd/.test(newSql))
  fail("no migration >=185 adds cost_usd to ai_usage_log");
if (!/cost_usd\s+numeric/.test(newSql))
  fail("cost_usd exists but is not numeric - integer cents truncates sub-cent calls");

// 2. A cost row must be attributable to the run that incurred it.
if (!/agent_run_id/.test(newSql))
  fail("no migration >=185 adds agent_run_id to ai_usage_log - cost cannot be attributed to a run");

// 3. Subscription spend must be distinguishable from API spend.
if (!/billing_path/.test(newSql))
  fail("no billing_path discriminator - CLI/subscription rows would read as real dollar spend");

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
