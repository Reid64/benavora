#!/usr/bin/env node
// FORGE gate - LIVE CAPTURE. Proves a table is RECEIVING ROWS from real
// production traffic, not merely that its schema and writer code exist.
//
// Why this exists: on 2026-09-18, Phase 5 and Phase 6 were both marked
// complete and both deployed. In the preceding 3 hours production logged 184
// agent runs (178 completed) and wrote ZERO rows to orchestration_logs and
// ZERO to ai_usage_log. Every gate passed, because every gate checked that the
// migration, the table and the writer existed. Nothing checked that a row ever
// arrived. That is the same "success it has not earned" defect this program
// exists to remove, sitting inside the observability layer itself.
//
// Usage:
//   node live-capture.mjs --table orchestration_logs --window 3h --min 1
//   node live-capture.mjs --table ai_usage_log --window 6h --min 1 --context agent_runs
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
// If credentials are absent it reports INDETERMINATE and exits 1 - an
// unverifiable claim is not a pass.
import { readFileSync } from "node:fs";

const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > -1 ? process.argv[i + 1] : d; };

const table   = arg("table");
const windowS = arg("window", "3h");
let minRows = Number(arg("min", "1"));
const context = arg("context", "agent_runs"); // table proving traffic existed at all
if (!table) fail("--table is required");

let env = "";
try { env = readFileSync(".env.local", "utf8"); } catch { fail("cannot read .env.local - credentials unavailable, capture is UNVERIFIABLE (not a pass)"); }
const pick = (k) => (new RegExp(`^${k}=(.+)$`, "m").exec(env)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
const url = pick("NEXT_PUBLIC_SUPABASE_URL") || pick("SUPABASE_URL");
const key = pick("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local - capture is UNVERIFIABLE (not a pass)");

const m = /^(\d+)([hmd])$/.exec(windowS);
if (!m) fail(`--window must look like 3h, 90m or 2d (got "${windowS}")`);
const ms = Number(m[1]) * ({ m: 60e3, h: 3600e3, d: 86400e3 })[m[2]];
const since = new Date(Date.now() - ms).toISOString();

// Injectable so --self-test can exercise every decision branch without a
// network round trip. The VM this gate is authored on has no Supabase egress;
// shipping an unexecuted gate is the mistake this whole program keeps finding.
let COUNTER = null;
async function countSince(t) {
  if (COUNTER) return COUNTER(t);
  const r = await fetch(`${url}/rest/v1/${t}?select=id&created_at=gte.${since}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact", Range: "0-0" },
  });
  if (!r.ok) throw new Error(`${t}: HTTP ${r.status} ${await r.text().catch(() => "")}`.slice(0, 200));
  const cr = r.headers.get("content-range") ?? "";
  const n = Number((cr.split("/")[1] ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

async function decide() {
  const [target, traffic] = await Promise.all([countSince(table), countSince(context)]);

  // No traffic at all means this gate proves nothing either way. Say so rather
  // than passing on an empty window.
  if (traffic === 0)
    fail(`no rows in ${context} in the last ${windowS} - there was no production traffic to capture, so ${table} cannot be verified (INDETERMINATE, not a pass)`);

  if (target < minRows)
    fail(`${table} received ${target} row(s) in the last ${windowS} while ${context} logged ${traffic} - the writer is deployed but nothing is arriving`);

  console.log(`OK: ${table} captured ${target} row(s) in the last ${windowS} against ${traffic} ${context} row(s) of real traffic`);
}

if (process.argv.includes("--self-test")) {
  const cases = [
    ["captures rows against real traffic",      { [table]: 12, [context]: 184 }, 0],
    ["writer deployed but nothing arriving",    { [table]: 0,  [context]: 184 }, 1],
    ["below the --min threshold",               { [table]: 1,  [context]: 184 }, 1, 5],
    ["no traffic at all -> INDETERMINATE",      { [table]: 0,  [context]: 0   }, 1],
    ["transport failure -> UNVERIFIABLE",       "throw",                         1],
  ];
  let pass = 0;
  for (const [name, fixture, wantRc, minOverride] of cases) {
    const savedMin = minRows;
    if (minOverride) minRows = minOverride;
    COUNTER = async (t) => { if (fixture === "throw") throw new Error("simulated transport failure"); return fixture[t] ?? 0; };
    const realExit = process.exit, realErr = console.error, realLog = console.log;
    let rc = 0, msg = "";
    process.exit = (c) => { rc = c; throw { __exit: true }; };
    console.error = (m) => { msg = m; }; console.log = (m) => { msg = m; };
    try { await decide(); } catch (e) { if (!e?.__exit) { rc = 1; msg = String(e); } }
    process.exit = realExit; console.error = realErr; console.log = realLog;
    minRows = savedMin;
    const want = wantRc;
    const ok = rc === want;
    if (ok) pass++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  rc=${rc} want=${want}  ${name}\n        ${msg.slice(0, 110)}`);
  }
  console.log(`\n${pass}/${cases.length} self-test branches correct`);
  process.exit(pass === cases.length ? 0 : 1);
}

try { await decide(); } catch (e) {
  fail(`live capture check could not complete: ${e.message} (UNVERIFIABLE, not a pass)`);
}
