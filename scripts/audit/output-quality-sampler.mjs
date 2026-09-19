#!/usr/bin/env node
// AR-17.1 output-quality sampler.
//
// READ-ONLY. This file must never call Claude, never execute an agent, and
// never issue anything but a GET against PostgREST. The single fetch
// wrapper below (pgGet) is the only place an HTTP request leaves this
// process; it never sends a method other than GET and never sends a body.
// If you are tempted to add a write here, stop -- this tool renders no
// verdicts and makes no fixes, it only reads production and reports.
//
// Usage:
//   node scripts/audit/output-quality-sampler.mjs <agentType|BEN-code|family> [--sample-size N] [--json]
//   node scripts/audit/output-quality-sampler.mjs --self-test
//
// <agentType|BEN-code|family>: an exact agentType/agent_id from
// test-evidence/AGENT_CENSUS.md, or one of the family names: core,
// autonomous, pil, autoapply, all.
//
// WHERE OUTPUT LIVES IS NOT ASSUMED. Every agent entry in
// output-quality-locations.mjs was derived by reading the agent's actual
// write call in source (file:line cited per entry), not by guessing a
// table name. Entries this sampler could not locate with confidence are
// marked locatable:false with a reason and are reported as UNLOCATABLE,
// never silently skipped and never given a guessed table.

import { readFileSync } from "node:fs";
import { OUTPUT_LOCATIONS } from "./output-quality-locations.mjs";

// ---------------------------------------------------------------------------
// Read-only PostgREST client. GET only. No body, ever.
// ---------------------------------------------------------------------------

function loadEnv() {
  let env = "";
  try {
    env = readFileSync(".env.local", "utf8");
  } catch {
    console.error("cannot read .env.local");
    process.exit(1);
  }
  const pick = (k) =>
    (new RegExp(`^${k}=(.+)$`, "m").exec(env)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  const url = pick("NEXT_PUBLIC_SUPABASE_URL") || pick("SUPABASE_URL");
  const key = pick("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.error("Supabase credentials missing from .env.local");
    process.exit(1);
  }
  return { url, key };
}

let ENV = null;
function env() {
  if (!ENV) ENV = loadEnv();
  return ENV;
}

/** GET-only fetch against PostgREST. Never pass a method or body. */
async function pgGet(query, { headers = {} } = {}) {
  const { url, key } = env();
  const r = await fetch(`${url}/rest/v1/${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...headers },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`SELECT failed: ${query.split("?")[0]}: HTTP ${r.status} ${body.slice(0, 300)}`);
  }
  return r;
}

async function pgCount(query) {
  const r = await pgGet(query, { headers: { Prefer: "count=exact", Range: "0-0" } });
  const n = Number((r.headers.get("content-range") ?? "").split("/")[1]);
  return Number.isFinite(n) ? n : 0;
}

async function pgSelect(query) {
  const r = await pgGet(query);
  return r.json();
}

// ---------------------------------------------------------------------------
// Value extraction. primaryColumn / evidence paths are dot-notation:
// the first segment is the real DB column, remaining segments walk into a
// jsonb value already returned by PostgREST as a parsed object.
// ---------------------------------------------------------------------------

export function topLevelColumn(path) {
  return String(path).split(".")[0];
}

export function extractPath(row, path) {
  const parts = String(path).split(".");
  let v = row;
  for (const p of parts) {
    if (v === null || v === undefined) return undefined;
    v = v[p];
  }
  return v;
}

export function isEmptyValue(v) {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Measures. Every function here is pure -- no DB, no fs, no Claude -- so
// --self-test can exercise them directly against fixtures.
// ---------------------------------------------------------------------------

/** Distinct-value count and full value distribution. The single most
 * important measure in this file: a scoring agent whose output clusters on
 * one value is not scoring, it is defaulting. */
export function computeVariance(values) {
  const counts = new Map();
  for (const v of values) {
    const key = JSON.stringify(v === undefined ? null : v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const distribution = [...counts.entries()]
    .map(([key, count]) => ({ value: JSON.parse(key), count }))
    .sort((a, b) => b.count - a.count);
  return {
    n: values.length,
    distinctCount: counts.size,
    distribution: distribution.slice(0, 20),
    distributionTruncated: distribution.length > 20 ? distribution.length - 20 : 0,
  };
}

/** Fraction of rows with null / "" / [] / {} in the field meant to carry the answer. */
export function computeNullity(values) {
  if (values.length === 0) return { n: 0, emptyCount: 0, nullity: null };
  const emptyCount = values.filter(isEmptyValue).length;
  return { n: values.length, emptyCount, nullity: emptyCount / values.length };
}

function longestCommonPrefix(strings) {
  if (strings.length === 0) return "";
  let prefix = strings[0];
  for (const s of strings.slice(1)) {
    let i = 0;
    const max = Math.min(prefix.length, s.length);
    while (i < max && prefix[i] === s[i]) i++;
    prefix = prefix.slice(0, i);
    if (prefix === "") break;
  }
  return prefix;
}

/** Longest shared prefix across text samples, and the proportion of samples
 * sharing a common opening window. Every summary opening with the same
 * sentence is a template, not an analysis. */
export function computeBoilerplate(texts) {
  const nonNull = texts.filter((t) => typeof t === "string" && t.length > 0);
  if (nonNull.length < 2) {
    return { applicable: false, reason: `fewer than 2 non-empty text samples (n=${nonNull.length})` };
  }
  const lcp = longestCommonPrefix(nonNull);
  const windowLen = Math.min(40, ...nonNull.map((t) => t.length));
  const prefixCounts = new Map();
  for (const t of nonNull) {
    const p = t.slice(0, windowLen);
    prefixCounts.set(p, (prefixCounts.get(p) ?? 0) + 1);
  }
  let dominantPrefix = "";
  let dominantCount = 0;
  for (const [p, c] of prefixCounts) {
    if (c > dominantCount) {
      dominantPrefix = p;
      dominantCount = c;
    }
  }
  return {
    applicable: true,
    n: nonNull.length,
    longestCommonPrefix: lcp,
    longestCommonPrefixLength: lcp.length,
    dominantPrefixWindow: windowLen,
    dominantPrefix,
    dominantPrefixShareCount: dominantCount,
    dominantPrefixProportion: dominantCount / nonNull.length,
  };
}

/** Whether an evidence/sources/rationale/citations field is present and
 * non-empty alongside each score or claim. */
export function computeGrounding(rows, evidenceColumns) {
  if (!evidenceColumns || evidenceColumns.length === 0) {
    return { configured: false, groundedFraction: null, evidenceColumns: [] };
  }
  if (rows.length === 0) {
    return { configured: true, groundedFraction: null, evidenceColumns, n: 0 };
  }
  const groundedCount = rows.filter((row) =>
    evidenceColumns.some((path) => !isEmptyValue(extractPath(row, path))),
  ).length;
  return {
    configured: true,
    n: rows.length,
    groundedCount,
    groundedFraction: groundedCount / rows.length,
    evidenceColumns,
  };
}

/** Newest output timestamp versus newest input-data timestamp, when an
 * input source is known for this agent. */
export function computeStaleness(newestOutputTs, newestInputTs) {
  if (!newestOutputTs) return { newestOutputTs: null, newestInputTs: newestInputTs ?? null, gapDays: null, note: "no output rows" };
  if (!newestInputTs) {
    return {
      newestOutputTs,
      newestInputTs: null,
      gapDays: null,
      note: "no input-data timestamp configured for this agent",
    };
  }
  const gapMs = Date.parse(newestInputTs) - Date.parse(newestOutputTs);
  return { newestOutputTs, newestInputTs, gapDays: gapMs / 86400000 };
}

// ---------------------------------------------------------------------------
// Self-test. Every measure above must be proven to fire against an
// injected fixture -- a measure you have not seen fire is a measure you do
// not have.
// ---------------------------------------------------------------------------

function assertEqual(name, actual, expected, results) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass, actual, expected });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}`);
  if (!pass) {
    console.log(`         expected: ${JSON.stringify(expected)}`);
    console.log(`         actual:   ${JSON.stringify(actual)}`);
  }
}

function assertTrue(name, condition, results, detail) {
  results.push({ name, pass: !!condition });
  console.log(`  [${condition ? "PASS" : "FAIL"}] ${name}${detail ? " -- " + detail : ""}`);
}

export function runSelfTest() {
  const results = [];
  console.log("AR-17.1 output-quality-sampler self-test\n");

  console.log("extractPath / isEmptyValue:");
  assertEqual("extractPath flat column", extractPath({ score: 42 }, "score"), 42, results);
  assertEqual(
    "extractPath nested jsonb path",
    extractPath({ output: { completenessScore: 0.5 } }, "output.completenessScore"),
    0.5,
    results,
  );
  assertEqual("extractPath missing path returns undefined", extractPath({ output: {} }, "output.missing"), undefined, results);
  assertTrue("isEmptyValue(null) true", isEmptyValue(null) === true, results);
  assertTrue("isEmptyValue('') true", isEmptyValue("") === true, results);
  assertTrue("isEmptyValue([]) true", isEmptyValue([]) === true, results);
  assertTrue("isEmptyValue({}) true", isEmptyValue({}) === true, results);
  assertTrue("isEmptyValue(0) false (zero is a real value)", isEmptyValue(0) === false, results);
  assertTrue("isEmptyValue('x') false", isEmptyValue("x") === false, results);

  console.log("\nVARIANCE -- constant-valued column reports 1 distinct value:");
  {
    const v = computeVariance([50, 50, 50, 50, 50, 50, 50, 50]);
    assertEqual("constant column distinctCount", v.distinctCount, 1, results);
    assertEqual("constant column distribution top entry count", v.distribution[0].count, 8, results);
  }

  console.log("\nVARIANCE -- varied column reports many distinct values:");
  {
    const v = computeVariance([12, 45, 3, 88, 61, 27, 99, 5, 71, 34]);
    assertEqual("varied column distinctCount", v.distinctCount, 10, results);
  }

  console.log("\nNULLITY -- all-null field reports nullity 1.0:");
  {
    const n = computeNullity([null, null, null, null, null]);
    assertEqual("all-null nullity", n.nullity, 1.0, results);
  }

  console.log("\nNULLITY -- mixed field reports the real fraction (not 0 or 1):");
  {
    const n = computeNullity([null, "", {}, [], "real value", 7, "another real value", null]);
    assertEqual("mixed nullity fraction", n.nullity, 5 / 8, results);
  }

  console.log("\nNULLITY -- fully populated field reports 0.0:");
  {
    const n = computeNullity([1, 2, 3, 4, 5]);
    assertEqual("populated nullity", n.nullity, 0, results);
  }

  console.log("\nBOILERPLATE -- identical opening text reports high boilerplate proportion:");
  {
    const texts = [
      "This organization demonstrates strong alignment with the funder's stated priorities in housing.",
      "This organization demonstrates strong alignment with the funder's stated priorities in education.",
      "This organization demonstrates strong alignment with the funder's stated priorities in health.",
      "This organization demonstrates strong alignment with the funder's stated priorities in workforce.",
    ];
    const b = computeBoilerplate(texts);
    assertTrue("boilerplate applicable", b.applicable === true, results);
    assertEqual("boilerplate dominant prefix proportion", b.dominantPrefixProportion, 1, results);
    assertTrue("boilerplate LCP is non-trivial", b.longestCommonPrefixLength > 20, results, `lcp="${b.longestCommonPrefix}"`);
  }

  console.log("\nBOILERPLATE -- genuinely distinct openings report low boilerplate proportion:");
  {
    const texts = [
      "Grants.gov posted a new NOFA for rural broadband infrastructure yesterday.",
      "The Ford Foundation's 990-PF shows a 14% increase in housing-category giving.",
      "Three board members resigned from Example Corp Foundation in Q3.",
      "SAM.gov registration for this org expires in 45 days.",
    ];
    const b = computeBoilerplate(texts);
    assertTrue("distinct openings low dominant-prefix proportion", b.dominantPrefixProportion <= 0.5, results, `proportion=${b.dominantPrefixProportion}`);
  }

  console.log("\nBOILERPLATE -- fewer than 2 samples reports not-applicable, never fabricates a result:");
  {
    const b = computeBoilerplate(["only one sample"]);
    assertTrue("single sample not applicable", b.applicable === false, results);
  }

  console.log("\nGROUNDING -- missing evidence column reports ungrounded/not-configured:");
  {
    const g = computeGrounding([{ score: 80 }, { score: 40 }], []);
    assertTrue("no evidence columns configured", g.configured === false, results);
    assertEqual("groundedFraction null when unconfigured", g.groundedFraction, null, results);
  }

  console.log("\nGROUNDING -- configured evidence column reports the real grounded fraction:");
  {
    const rows = [
      { score: 80, rationale: "based on 990-PF filings from 2024-2026" },
      { score: 40, rationale: "" },
      { score: 60, rationale: null },
      { score: 90, rationale: "confirmed via SEC EDGAR enforcement search" },
    ];
    const g = computeGrounding(rows, ["rationale"]);
    assertTrue("grounding configured", g.configured === true, results);
    assertEqual("groundedFraction reflects real 2/4", g.groundedFraction, 0.5, results);
  }

  console.log("\nSTALENESS -- unconfigured input source reports null gap with a clear note:");
  {
    const s = computeStaleness("2026-09-18T00:00:00Z", null);
    assertEqual("gapDays null when unconfigured", s.gapDays, null, results);
    assertTrue("note explains why", s.note.includes("configured for this agent"), results);
  }

  console.log("\nSTALENESS -- configured input source reports a real gap in days:");
  {
    const s = computeStaleness("2026-09-10T00:00:00Z", "2026-09-19T00:00:00Z");
    assertEqual("gapDays computed", s.gapDays, 9, results);
  }

  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;
  console.log(`\nSELF-TEST RESULT: ${passCount}/${results.length} passed${failCount ? `, ${failCount} FAILED` : ""}`);
  return { passCount, total: results.length, failCount };
}

// ---------------------------------------------------------------------------
// Per-agent assessment against real production data.
// ---------------------------------------------------------------------------

function buildSelectClause(entry) {
  const cols = new Set([topLevelColumn(entry.dateColumn), topLevelColumn(entry.primaryColumn)]);
  for (const ev of entry.evidenceColumns ?? []) cols.add(topLevelColumn(ev));
  return [...cols].join(",");
}

async function fetchNewestInputTimestamp(entry) {
  if (!entry.inputTable || !entry.inputDateColumn) return null;
  const filter = entry.inputFilter ? `&${entry.inputFilter}` : "";
  const rows = await pgSelect(
    `${entry.inputTable}?select=${entry.inputDateColumn}${filter}&order=${entry.inputDateColumn}.desc&limit=1`,
  );
  return rows[0]?.[entry.inputDateColumn] ?? null;
}

export async function assessAgent(entry, { sampleSize = 500 } = {}) {
  const header = { agentType: entry.agentType, modulePath: entry.modulePath, family: entry.family };

  if (!entry.locatable) {
    return { ...header, status: "UNLOCATABLE", reason: entry.reason };
  }

  const filterQS = entry.agentFilter ? `&${entry.agentFilter}` : "";
  const table = entry.table;

  let total;
  try {
    total = await pgCount(`${table}?select=id${filterQS}`);
  } catch (err) {
    return { ...header, status: "QUERY_ERROR", reason: err.message, citation: entry.citation };
  }

  if (total === 0) {
    return {
      ...header,
      status: "INSUFFICIENT_SAMPLE",
      n: 0,
      note: "zero output rows found at the located destination",
      citation: entry.citation,
    };
  }

  const selectCols = buildSelectClause(entry);
  const [oldestRow] = await pgSelect(
    `${table}?select=${entry.dateColumn}${filterQS}&order=${entry.dateColumn}.asc.nullslast&limit=1`,
  );
  const [newestRow] = await pgSelect(
    `${table}?select=${entry.dateColumn}${filterQS}&order=${entry.dateColumn}.desc.nullslast&limit=1`,
  );
  const dateRange = { oldest: oldestRow?.[entry.dateColumn] ?? null, newest: newestRow?.[entry.dateColumn] ?? null };

  const recent = await pgSelect(`${table}?select=*${filterQS}&order=${entry.dateColumn}.desc.nullslast&limit=10`);

  if (total < 5) {
    return {
      ...header,
      status: "INSUFFICIENT_SAMPLE",
      n: total,
      dateRange,
      recentOutputsVerbatim: recent,
      note: `fewer than 5 output rows exist (n=${total}) -- this scarcity is itself the finding, sample was not padded or widened`,
      citation: entry.citation,
    };
  }

  const sample = await pgSelect(
    `${table}?select=${selectCols}${filterQS}&order=${entry.dateColumn}.desc.nullslast&limit=${sampleSize}`,
  );
  const values = sample.map((row) => extractPath(row, entry.primaryColumn));

  const variance = computeVariance(values);
  const nullity = computeNullity(values);
  const boilerplate = entry.valueType === "text" ? computeBoilerplate(values) : { applicable: false, reason: `valueType is "${entry.valueType}", not text` };
  const grounding = computeGrounding(sample, entry.evidenceColumns);

  const newestInputTs = await fetchNewestInputTimestamp(entry).catch(() => null);
  const staleness = computeStaleness(dateRange.newest, newestInputTs);

  return {
    ...header,
    status: "ASSESSED",
    n_total: total,
    n_sampled: sample.length,
    sampleCap: sampleSize,
    sampleNote:
      sample.length < total
        ? `variance/nullity/boilerplate/grounding computed over the ${sample.length} most recent of ${total} total rows (sample cap ${sampleSize}); not a full-population statistic`
        : "sample covers all rows",
    dateRange,
    recentOutputsVerbatim: recent,
    variance,
    nullity,
    boilerplate,
    grounding,
    staleness,
    primaryColumn: entry.primaryColumn,
    valueType: entry.valueType,
    citation: entry.citation,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function resolveEntries(target) {
  const families = new Set(["core", "autonomous", "pil", "autoapply", "all"]);
  const norm = target.toLowerCase();
  if (norm === "all") return OUTPUT_LOCATIONS;
  if (families.has(norm)) return OUTPUT_LOCATIONS.filter((e) => e.family === norm);
  const exact = OUTPUT_LOCATIONS.filter((e) => e.agentType.toLowerCase() === norm);
  return exact;
}

function printAssessment(result) {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`${result.agentType}  [${result.family ?? "?"}]  ${result.modulePath ?? ""}`);
  console.log(`status: ${result.status}`);
  if (result.status === "UNLOCATABLE") {
    console.log(`reason: ${result.reason}`);
    return;
  }
  if (result.citation) console.log(`citation: ${result.citation}`);
  if (result.status === "QUERY_ERROR") {
    console.log(`reason: ${result.reason}`);
    return;
  }
  if (result.status === "INSUFFICIENT_SAMPLE") {
    console.log(`n: ${result.n}`);
    if (result.dateRange) console.log(`dateRange: ${JSON.stringify(result.dateRange)}`);
    console.log(`note: ${result.note}`);
    if (result.recentOutputsVerbatim?.length) {
      console.log(`\nrecent outputs verbatim (n=${result.recentOutputsVerbatim.length}):`);
      console.log(JSON.stringify(result.recentOutputsVerbatim, null, 2));
    }
    return;
  }
  console.log(`n_total: ${result.n_total}   n_sampled: ${result.n_sampled}`);
  console.log(`sampleNote: ${result.sampleNote}`);
  console.log(`dateRange: ${JSON.stringify(result.dateRange)}`);
  console.log(`primaryColumn: ${result.primaryColumn}  (valueType: ${result.valueType})`);
  console.log(`\nVARIANCE: distinctCount=${result.variance.distinctCount} over n=${result.variance.n}`);
  console.log(`  distribution (top ${result.variance.distribution.length}${result.variance.distributionTruncated ? `, +${result.variance.distributionTruncated} more` : ""}):`);
  for (const d of result.variance.distribution) {
    console.log(`    ${JSON.stringify(d.value)}: ${d.count}`);
  }
  console.log(`\nNULLITY: ${result.nullity.emptyCount}/${result.nullity.n} = ${(result.nullity.nullity * 100).toFixed(1)}%`);
  console.log(`\nBOILERPLATE:`);
  if (result.boilerplate.applicable) {
    console.log(`  dominantPrefixProportion=${(result.boilerplate.dominantPrefixProportion * 100).toFixed(1)}% share the first ${result.boilerplate.dominantPrefixWindow} chars: "${result.boilerplate.dominantPrefix}"`);
    console.log(`  longestCommonPrefix (len ${result.boilerplate.longestCommonPrefixLength}): "${result.boilerplate.longestCommonPrefix}"`);
  } else {
    console.log(`  not applicable: ${result.boilerplate.reason}`);
  }
  console.log(`\nGROUNDING:`);
  if (result.grounding.configured) {
    console.log(`  ${result.grounding.groundedCount}/${result.grounding.n} rows have a non-empty value in [${result.grounding.evidenceColumns.join(", ")}]  (${(result.grounding.groundedFraction * 100).toFixed(1)}%)`);
  } else {
    console.log(`  no evidence/sources/rationale/citations column configured for this agent -- treat as ungrounded`);
  }
  console.log(`\nSTALENESS: newestOutput=${result.staleness.newestOutputTs}  newestInput=${result.staleness.newestInputTs}`);
  if (result.staleness.gapDays !== null) console.log(`  gapDays=${result.staleness.gapDays.toFixed(2)}`);
  if (result.staleness.note) console.log(`  note: ${result.staleness.note}`);
  console.log(`\nrecent outputs verbatim (n=${result.recentOutputsVerbatim.length}, untruncated):`);
  console.log(JSON.stringify(result.recentOutputsVerbatim, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    const { failCount } = runSelfTest();
    process.exit(failCount > 0 ? 1 : 0);
  }

  const target = args.find((a) => !a.startsWith("--"));
  const sampleSizeArg = args.indexOf("--sample-size");
  const sampleSize = sampleSizeArg > -1 ? Number(args[sampleSizeArg + 1]) : 500;
  const asJson = args.includes("--json");

  if (!target) {
    console.error("Usage: node scripts/audit/output-quality-sampler.mjs <agentType|BEN-code|family> [--sample-size N] [--json]");
    console.error("       node scripts/audit/output-quality-sampler.mjs --self-test");
    console.error("Families: core, autonomous, pil, autoapply, all");
    process.exit(1);
  }

  console.error("READ-ONLY: this tool issues only SELECT (GET) queries against PostgREST. It never calls Claude and never executes an agent.\n");

  const entries = resolveEntries(target);
  if (entries.length === 0) {
    console.error(`No entry found for "${target}" in output-quality-locations.mjs (not a known agentType, BEN-code, or family).`);
    process.exit(1);
  }

  const results = [];
  for (const entry of entries) {
    const result = await assessAgent(entry, { sampleSize });
    results.push(result);
    if (!asJson) printAssessment(result);
  }

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
  } else if (results.length > 1) {
    const locatable = results.filter((r) => r.status !== "UNLOCATABLE").length;
    console.log(`\n${"=".repeat(78)}`);
    console.log(`SUMMARY for "${target}": ${results.length} agents, ${locatable} locatable, ${results.length - locatable} UNLOCATABLE`);
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], "file://" + process.cwd() + "/").href;
if (isMain || process.argv[1]?.endsWith("output-quality-sampler.mjs")) {
  main().catch((err) => {
    console.error("FATAL:", err.stack || err.message);
    process.exit(1);
  });
}
