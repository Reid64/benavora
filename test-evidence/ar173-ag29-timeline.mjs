#!/usr/bin/env node
// AR-17.3 ag-29 timeline probe. READ-ONLY, GET-only.
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
const pick = (k) => (new RegExp(`^${k}=(.+)$`, "m").exec(env)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
const url = pick("NEXT_PUBLIC_SUPABASE_URL") || pick("SUPABASE_URL"), key = pick("SUPABASE_SERVICE_ROLE_KEY");
async function pgGet(q, exact) {
  const r = await fetch(`${url}/rest/v1/${q}`, { method: "GET", headers: { apikey: key, Authorization: `Bearer ${key}`, ...(exact ? { Prefer: "count=exact", Range: "0-0" } : {}) } });
  if (!r.ok) return { err: `${r.status} ${await r.text()}` };
  return { body: await r.json(), total: r.headers.get("content-range") ? Number(r.headers.get("content-range").split("/")[1]) : null };
}
const cnt = async (q) => { const r = await pgGet(q, true); return r.err ?? r.total; };
const out = {};

// earliest and latest run that actually processed something
out.first_productive = (await pgGet("agent_runs?select=started_at,items_processed&agent_type=eq.ag-29-knowledge-indexer&items_processed=gt.0&order=started_at.asc&limit=3")).body;
out.last_productive  = (await pgGet("agent_runs?select=started_at,items_processed&agent_type=eq.ag-29-knowledge-indexer&items_processed=gt.0&order=started_at.desc&limit=3")).body;
out.first_run_ever   = (await pgGet("agent_runs?select=started_at&agent_type=eq.ag-29-knowledge-indexer&order=started_at.asc&limit=1")).body;

// runs that found rows but embedded none = the real failure signature
out.found_gt0_processed_0 = await cnt("agent_runs?select=id&agent_type=eq.ag-29-knowledge-indexer&items_found=gt.0&items_processed=eq.0");
out.found_0 = await cnt("agent_runs?select=id&agent_type=eq.ag-29-knowledge-indexer&items_found=eq.0");

// how much of the corpus is still unembedded -- i.e. is there real work left?
for (const t of ["intelligence_proposal_sections", "outcomes", "foundation_directory"]) {
  out[`${t}__total`] = await cnt(`${t}?select=id`);
  out[`${t}__unembedded`] = await cnt(`${t}?select=id&embedding=is.null`);
}
// run cadence today
out.runs_last_24h = await cnt(`agent_runs?select=id&agent_type=eq.ag-29-knowledge-indexer&started_at=gte.2026-09-18T14:00:00Z`);
out.productive_last_24h = await cnt(`agent_runs?select=id&agent_type=eq.ag-29-knowledge-indexer&items_processed=gt.0&started_at=gte.2026-09-18T14:00:00Z`);
console.log(JSON.stringify(out, null, 2));
