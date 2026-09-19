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
// BACKFILL-SHAPED WORK (AR-14.1). The default mode counts rows whose
// created_at falls inside --window: an INSERT-flow assertion. Some pipelines
// do not insert rows at all - they populate a column on rows that already
// exist. ag-29-knowledge-indexer is exactly this: its output is
// `foundation_directory.embedding` going NULL -> non-null (an UPDATE, which
// never touches created_at) plus a 24h-cadence knowledge_patterns insert. A
// created_at window cannot see that work, so pointing the default mode at it
// returns 0 forever whether the pipeline is healthy or dead. Two flags make
// the honest assertion expressible:
//
//   --filter <postgrest predicate>   extra predicate on the TARGET count only
//                                    (repeatable), e.g. embedding=not.is.null
//   --column none                    drop the time bound on the target, so the
//                                    count is a level (stock), not a flow
//   --baseline N                     with a level, pass requires count > N -
//                                    "prove it by a row count that goes up"
//
//   node live-capture.mjs --table foundation_directory --column none \
//     --filter embedding=not.is.null --baseline 0 --context agent_runs
//
// The --context traffic count ALWAYS stays created_at-windowed and unfiltered:
// it is what proves production was actually running, and weakening it would
// let a level assertion pass against a dead platform.
//
// A level assertion without --baseline is refused rather than passed: without
// a recorded pre-fix number, "133812 rows exist" says nothing about whether
// this session's work produced any of them.
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
// If credentials are absent it reports INDETERMINATE and exits 1 - an
// unverifiable claim is not a pass.
import { readFileSync } from "node:fs";

const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > -1 ? process.argv[i + 1] : d; };
// Repeatable flag: every `--filter x` occurrence, in order.
const argAll = (n) => process.argv.reduce((acc, v, i) => (v === "--" + n && process.argv[i + 1] ? [...acc, process.argv[i + 1]] : acc), []);

const table   = arg("table");
const windowS = arg("window", "3h");
let minRows = Number(arg("min", "1"));
const context = arg("context", "agent_runs"); // table proving traffic existed at all
const column  = arg("column", "created_at");  // recency column on the target; "none" => level mode
const filters = argAll("filter");
const baselineRaw = arg("baseline");
let baseline = baselineRaw === undefined ? null : Number(baselineRaw);
let levelMode = column === "none";
if (!table) fail("--table is required");
if (baselineRaw !== undefined && !Number.isFinite(baseline)) fail(`--baseline must be a number (got "${baselineRaw}")`);
// Guard-rail, not a convenience default: see the header note on why a level
// with no baseline is an unverifiable claim rather than a pass.
if (levelMode && baseline === null) fail("--column none is a level (stock) assertion and needs --baseline <pre-fix count> to mean anything - a bare row count cannot show that it went up");
if (!levelMode && baseline !== null) fail("--baseline applies to level assertions only; pass --column none alongside it, or drop --baseline and use --min");

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
/** Counts rows in `t`. `isTarget` selects the target's query shape (optional
 * --filter predicates, optional --column none) from the context's, which is
 * always the plain created_at window - see the header. */
async function countSince(t, isTarget = false) {
  if (COUNTER) return COUNTER(t);
  const predicates = ["select=id"];
  if (!isTarget || !levelMode) predicates.push(`${isTarget ? column : "created_at"}=gte.${since}`);
  if (isTarget) predicates.push(...filters);
  const r = await fetch(`${url}/rest/v1/${t}?${predicates.join("&")}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact", Range: "0-0" },
  });
  if (!r.ok) throw new Error(`${t}: HTTP ${r.status} ${await r.text().catch(() => "")}`.slice(0, 200));
  const cr = r.headers.get("content-range") ?? "";
  const n = Number((cr.split("/")[1] ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

/** Human-readable description of what the target count covers, so a failure
 * message names the assertion that was actually made. */
function describeTarget() {
  const where = filters.length ? ` matching ${filters.join(" & ")}` : "";
  return levelMode ? `${table} row(s)${where}` : `${table} row(s)${where} with ${column} in the last ${windowS}`;
}

async function decide() {
  const [target, traffic] = await Promise.all([countSince(table, true), countSince(context)]);

  // No traffic at all means this gate proves nothing either way. Say so rather
  // than passing on an empty window.
  if (traffic === 0)
    fail(`no rows in ${context} in the last ${windowS} - there was no production traffic to capture, so ${table} cannot be verified (INDETERMINATE, not a pass)`);

  if (levelMode) {
    if (target <= baseline)
      fail(`${describeTarget()} is ${target}, not above the recorded baseline of ${baseline}, while ${context} logged ${traffic} in the last ${windowS} - the writer is deployed but the count has not moved`);
    console.log(`OK: ${describeTarget()} rose from ${baseline} to ${target} (+${target - baseline}) against ${traffic} ${context} row(s) of real traffic in the last ${windowS}`);
    return;
  }

  if (target < minRows)
    fail(`${table} received ${target} row(s) in the last ${windowS} while ${context} logged ${traffic} - the writer is deployed but nothing is arriving`);

  console.log(`OK: ${describeTarget()} captured ${target} row(s) against ${traffic} ${context} row(s) of real traffic`);
}

if (process.argv.includes("--self-test")) {
  const cases = [
    ["captures rows against real traffic",      { [table]: 12, [context]: 184 }, 0],
    ["writer deployed but nothing arriving",    { [table]: 0,  [context]: 184 }, 1],
    ["below the --min threshold",               { [table]: 1,  [context]: 184 }, 1, { min: 5 }],
    ["no traffic at all -> INDETERMINATE",      { [table]: 0,  [context]: 0   }, 1],
    ["transport failure -> UNVERIFIABLE",       "throw",                         1],
    ["level rose above baseline",               { [table]: 400, [context]: 184 }, 0, { level: true, baseline: 0 }],
    ["level flat at baseline",                  { [table]: 0,  [context]: 184 }, 1, { level: true, baseline: 0 }],
    ["level below baseline",                    { [table]: 9,  [context]: 184 }, 1, { level: true, baseline: 12 }],
    ["level ignores traffic-free window",       { [table]: 400, [context]: 0  }, 1, { level: true, baseline: 0 }],
  ];
  let pass = 0;
  for (const [name, fixture, wantRc, opts] of cases) {
    const saved = { min: minRows, level: levelMode, baseline };
    if (opts?.min) minRows = opts.min;
    if (opts?.level) { levelMode = true; baseline = opts.baseline; }
    COUNTER = async (t) => { if (fixture === "throw") throw new Error("simulated transport failure"); return fixture[t] ?? 0; };
    const realExit = process.exit, realErr = console.error, realLog = console.log;
    let rc = 0, msg = "";
    process.exit = (c) => { rc = c; throw { __exit: true }; };
    console.error = (m) => { msg = m; }; console.log = (m) => { msg = m; };
    try { await decide(); } catch (e) { if (!e?.__exit) { rc = 1; msg = String(e); } }
    process.exit = realExit; console.error = realErr; console.log = realLog;
    minRows = saved.min; levelMode = saved.level; baseline = saved.baseline;
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
