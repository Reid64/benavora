#!/usr/bin/env node
// AR-17.3 verification companion. READ-ONLY: GET-only against PostgREST,
// never calls Claude, never executes an agent, never writes.
//
// Produces the two numbers AR-17.3 must state from live data rather than
// from the prompt: (a) the live ag-29-knowledge-indexer run counts and its
// share of agent_runs, and (b) the platform-wide proportion of enriched
// funder fields that carry provenance.

import { readFileSync } from "node:fs";

function loadEnv() {
  const env = readFileSync(".env.local", "utf8");
  const pick = (k) =>
    (new RegExp(`^${k}=(.+)$`, "m").exec(env)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  return { url: pick("NEXT_PUBLIC_SUPABASE_URL") || pick("SUPABASE_URL"), key: pick("SUPABASE_SERVICE_ROLE_KEY") };
}
const { url, key } = loadEnv();

async function pgGet(q, { exact = false } = {}) {
  const res = await fetch(`${url}/rest/v1/${q}`, {
    method: "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(exact ? { Prefer: "count=exact", Range: "0-0" } : {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${q}: ${await res.text()}`);
  const cr = res.headers.get("content-range");
  const body = await res.json();
  return { body, total: cr ? Number(cr.split("/")[1]) : null };
}
const countOf = async (q) => (await pgGet(q, { exact: true })).total;

const out = {};

// --- 1. ag-29 live figures -------------------------------------------------
out.agent_runs_total = await countOf("agent_runs?select=id");
out.ag29_runs = await countOf("agent_runs?select=id&agent_type=eq.ag-29-knowledge-indexer");
out.ag29_share = out.ag29_runs / out.agent_runs_total;

// status breakdown for ag-29
for (const s of ["completed", "failed", "running", "pending", "cancelled"]) {
  try {
    out[`ag29_status_${s}`] = await countOf(
      `agent_runs?select=id&agent_type=eq.ag-29-knowledge-indexer&status=eq.${s}`
    );
  } catch (e) {
    out[`ag29_status_${s}`] = `N/A (${String(e.message).match(/enum[^"]*"[^"]*"/)?.[0] ?? "error"})`;
  }
}
// what did they actually process? sample recent result payloads
const ag29 = await pgGet(
  "agent_runs?select=id,status,started_at,completed_at,items_found,items_processed,items_queued,output_summary,error_message,tokens_used&agent_type=eq.ag-29-knowledge-indexer&order=started_at.desc&limit=25"
);
out.ag29_recent = ag29.body;
out.ag29_items_processed_gt0 = await countOf("agent_runs?select=id&agent_type=eq.ag-29-knowledge-indexer&items_processed=gt.0");
out.ag29_items_found_gt0 = await countOf("agent_runs?select=id&agent_type=eq.ag-29-knowledge-indexer&items_found=gt.0");
out.ag29_tokens_gt0 = await countOf("agent_runs?select=id&agent_type=eq.ag-29-knowledge-indexer&tokens_used=gt.0");

// the set ag-29 believes it iterates over
for (const t of ["knowledge_base_entries", "knowledge_documents", "kb_narratives", "documents", "organization_knowledge"]) {
  try { out[`table_${t}`] = await countOf(`${t}?select=id`); }
  catch (e) { out[`table_${t}`] = `ERR ${String(e.message).slice(0, 80)}`; }
}

// --- 2. platform-wide provenance on enriched funder fields -----------------
// "enriched funder field" = a non-null value an agent wrote on `opportunities`
// that a customer would act on. Provenance = a stored source pointer on the
// same row (url, or opportunity_documents holding a document reference).
const FIELDS = [
  "deadline", "amount_min", "amount_max", "amount_available",
  "eligibility_requirements", "application_method", "required_documents",
  "geographic_restrictions", "description",
];
out.opportunities_total = await countOf("opportunities?select=id");
out.opportunities_with_url = await countOf("opportunities?select=id&url=not.is.null");
out.opportunities_with_docs = await countOf("opportunities?select=id&opportunity_documents=not.is.null");

out.fields = {};
for (const f of FIELDS) {
  const filled = await countOf(`opportunities?select=id&${f}=not.is.null`);
  const filledWithUrl = await countOf(`opportunities?select=id&${f}=not.is.null&url=not.is.null`);
  out.fields[f] = { filled, filledWithUrl, provenanceRate: filled ? filledWithUrl / filled : null };
}
const totFilled = Object.values(out.fields).reduce((a, x) => a + x.filled, 0);
const totWithProv = Object.values(out.fields).reduce((a, x) => a + x.filledWithUrl, 0);
out.platform_field_provenance = { totalFilledFields: totFilled, withProvenance: totWithProv, rate: totFilled ? totWithProv / totFilled : null };

// corporate_prospects enrichment provenance (source_adapters is the pointer)
out.cp_total = await countOf("corporate_prospects?select=id");
out.cp_enriched = await countOf("corporate_prospects?select=id&enrichment_completed_at=not.is.null");
out.cp_with_adapters = await countOf("corporate_prospects?select=id&source_adapters=not.is.null");

// funder_intelligence provenance: raw_data is the stored source
out.fi_total = await countOf("funder_intelligence?select=id");
out.fi_with_raw = await countOf("funder_intelligence?select=id&raw_data=not.is.null");

console.log(JSON.stringify(out, null, 2));
