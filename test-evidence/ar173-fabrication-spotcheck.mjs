#!/usr/bin/env node
// AR-17.3 fabrication spot-check. READ-ONLY, GET-only.
//
// Selection rule, fixed BEFORE looking at any content so the sample cannot be
// cherry-picked: the 10 most recently discovered `opportunities` rows that
// carry at least one actionable enriched claim (deadline, amount, eligibility
// or application_method). No quality filter of any kind is applied.
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
const pick = (k) => (new RegExp(`^${k}=(.+)$`, "m").exec(env)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
const url = pick("NEXT_PUBLIC_SUPABASE_URL") || pick("SUPABASE_URL"), key = pick("SUPABASE_SERVICE_ROLE_KEY");
async function pgGet(q) {
  const r = await fetch(`${url}/rest/v1/${q}`, { method: "GET", headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`${r.status} ${q}: ${await r.text()}`);
  return r.json();
}

const cols = "id,name,source,source_type,discovered_at,url,opportunity_documents,deadline,amount_min,amount_max,amount_available,eligibility_requirements,application_method,required_documents,geographic_restrictions,description";
const rows = await pgGet(
  `opportunities?select=${cols}&or=(deadline.not.is.null,amount_max.not.is.null,eligibility_requirements.not.is.null,application_method.not.is.null)&order=discovered_at.desc&limit=10`
);

const CLAIMS = ["deadline", "amount_min", "amount_max", "amount_available", "eligibility_requirements", "application_method", "required_documents", "geographic_restrictions"];

const report = rows.map((r) => {
  const storedSource =
    r.opportunity_documents && (Array.isArray(r.opportunity_documents) ? r.opportunity_documents.length : Object.keys(r.opportunity_documents).length)
      ? "opportunity_documents"
      : null;
  const claims = {};
  for (const c of CLAIMS) {
    if (r[c] === null || r[c] === undefined) continue;
    claims[c] = {
      value: typeof r[c] === "string" ? r[c].slice(0, 220) : r[c],
      // A stored source is a retained copy of the source material. A bare
      // `url` is a POINTER to a live page, not a stored source: it cannot be
      // used to verify the claim offline and the page may have changed since.
      storedSource,
      urlPointer: r.url ?? null,
      verdict: storedSource ? "CHECKABLE_AGAINST_STORED_SOURCE" : (r.url ? "UNVERIFIABLE_POINTER_ONLY" : "UNVERIFIABLE_NO_SOURCE"),
    };
  }
  return { id: r.id, name: r.name, source: r.source, discovered_at: r.discovered_at, url: r.url, storedSource, descriptionIsAUrl: typeof r.description === "string" && /^https?:\/\//.test(r.description.trim()), claims };
});

const tally = { CHECKABLE_AGAINST_STORED_SOURCE: 0, UNVERIFIABLE_POINTER_ONLY: 0, UNVERIFIABLE_NO_SOURCE: 0 };
for (const rec of report) for (const c of Object.values(rec.claims)) tally[c.verdict]++;
console.log(JSON.stringify({ tally, totalClaims: Object.values(tally).reduce((a, b) => a + b, 0), records: report }, null, 2));
