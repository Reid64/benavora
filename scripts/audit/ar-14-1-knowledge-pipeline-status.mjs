#!/usr/bin/env node
// AR-14.1 evidence probe - reports the live state of the ag-29 knowledge
// pipeline in one pass, so "before" and "after" are the same measurement
// rather than two differently-worded queries.
//
// Reports, live from production PostgREST:
//   - embedding coverage on each of ag-29's three real source tables
//     (intelligence_proposal_sections, outcomes, foundation_directory).
//     These are the pipeline's actual output: the indexer writes a vector
//     back onto an existing row, it does not insert rows anywhere except
//     knowledge_patterns.
//   - knowledge_patterns row count (the one table ag-29 inserts into, on a
//     24h aggregation cadence).
//   - ag-29's run rate and status split over a window, which is the number
//     every platform metric and AR-6.4 dashboard is sensitive to: ag-29 was
//     ~44% of all agent_runs ever recorded and ~88% over the 6h sampled on
//     2026-09-19.
//   - knowledge_base, for contrast only. It is NOT part of this pipeline -
//     no embedding column, written solely by org onboarding and
//     src/lib/intelligence/twin-auto-populate.ts. It is reported here
//     because a live gate was once pointed at it to verify this work, and a
//     zero there means "nobody onboarded an org recently", never "the
//     indexer is broken".
//
// Usage: node scripts/audit/ar-14-1-knowledge-pipeline-status.mjs [--window 6h]
import { readFileSync } from "node:fs";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > -1 ? process.argv[i + 1] : d; };
const windowS = arg("window", "6h");
const m = /^(\d+)([hmd])$/.exec(windowS);
if (!m) { console.error(`--window must look like 3h, 90m or 2d (got "${windowS}")`); process.exit(1); }
const since = new Date(Date.now() - Number(m[1]) * ({ m: 60e3, h: 3600e3, d: 86400e3 })[m[2]]).toISOString();

let env = "";
try { env = readFileSync(".env.local", "utf8"); } catch { console.error("cannot read .env.local"); process.exit(1); }
const pick = (k) => (new RegExp(`^${k}=(.+)$`, "m").exec(env)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
const url = pick("NEXT_PUBLIC_SUPABASE_URL") || pick("SUPABASE_URL");
const key = pick("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) { console.error("Supabase credentials missing from .env.local"); process.exit(1); }

async function count(query) {
  const r = await fetch(`${url}/rest/v1/${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact", Range: "0-0" },
  });
  if (!r.ok) throw new Error(`${query.split("?")[0]}: HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 160)}`);
  const n = Number((r.headers.get("content-range") ?? "").split("/")[1]);
  return Number.isFinite(n) ? n : 0;
}

const SOURCES = ["intelligence_proposal_sections", "outcomes", "foundation_directory"];
const STATUSES = ["completed", "skipped", "failed", "running"];

console.log(`AR-14.1 knowledge pipeline - live state (window: last ${windowS}, since ${since})\n`);

console.log("Embedding coverage on ag-29's source tables (the pipeline's real output):");
for (const t of SOURCES) {
  const [total, embedded] = await Promise.all([
    count(`${t}?select=id`),
    count(`${t}?select=id&embedding=not.is.null`),
  ]);
  const pct = total > 0 ? ((embedded / total) * 100).toFixed(2) : "0.00";
  console.log(`  ${t.padEnd(32)} ${embedded}/${total} embedded (${pct}%), ${total - embedded} pending`);
}

const [patterns, patternsWindow] = await Promise.all([
  count("knowledge_patterns?select=id"),
  count(`knowledge_patterns?select=id&created_at=gte.${since}`),
]);
console.log(`\nknowledge_patterns (ag-29's only INSERT target, 24h cadence): ${patterns} total, ${patternsWindow} in the last ${windowS}`);

const [allRuns, ag29Runs] = await Promise.all([
  count(`agent_runs?select=id&created_at=gte.${since}`),
  count(`agent_runs?select=id&created_at=gte.${since}&agent_type=eq.ag-29-knowledge-indexer`),
]);
const share = allRuns > 0 ? ((ag29Runs / allRuns) * 100).toFixed(1) : "0.0";
console.log(`\nagent_runs in the last ${windowS}: ${allRuns} total, ${ag29Runs} from ag-29 (${share}% of all runs)`);
console.log("  ag-29 status split:");
for (const s of STATUSES) {
  const n = await count(`agent_runs?select=id&created_at=gte.${since}&agent_type=eq.ag-29-knowledge-indexer&status=eq.${s}`);
  console.log(`    ${s.padEnd(10)} ${n}`);
}
const didWork = await count(`agent_runs?select=id&created_at=gte.${since}&agent_type=eq.ag-29-knowledge-indexer&items_processed=gt.0`);
console.log(`    (of which items_processed > 0: ${didWork})`);

const [kbTotal, kbWindow] = await Promise.all([
  count("knowledge_base?select=id"),
  count(`knowledge_base?select=id&created_at=gte.${since}`),
]);
console.log(`\nknowledge_base (NOT this pipeline - onboarding/twin-auto-populate only): ${kbTotal} total, ${kbWindow} in the last ${windowS}`);
