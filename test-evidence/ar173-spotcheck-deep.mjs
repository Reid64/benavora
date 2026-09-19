#!/usr/bin/env node
// AR-17.3 deep spot-check. READ-ONLY, GET-only.
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
const pick = (k) => (new RegExp(`^${k}=(.+)$`, "m").exec(env)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
const url = pick("NEXT_PUBLIC_SUPABASE_URL") || pick("SUPABASE_URL"), key = pick("SUPABASE_SERVICE_ROLE_KEY");
async function pgGet(q, exact) {
  const r = await fetch(`${url}/rest/v1/${q}`, { method: "GET", headers: { apikey: key, Authorization: `Bearer ${key}`, ...(exact ? { Prefer: "count=exact", Range: "0-0" } : {}) } });
  if (!r.ok) throw new Error(`${r.status} ${q}: ${await r.text()}`);
  return exact ? Number(r.headers.get("content-range").split("/")[1]) : r.json();
}
const out = {};

// --- A. the only rows where a stored-source comparison is possible ---------
const withDocs = await pgGet("opportunities?select=id,name,source,url,deadline,amount_min,amount_max,eligibility_requirements,application_method,opportunity_documents&opportunity_documents=not.is.null&order=discovered_at.desc&limit=10");
out.withDocs = withDocs.map((r) => {
  const docs = r.opportunity_documents;
  const docText = JSON.stringify(docs);
  return {
    id: r.id, name: String(r.name).slice(0, 70), source: r.source,
    docShape: Array.isArray(docs) ? `array[${docs.length}]` : typeof docs,
    docKeys: Array.isArray(docs) ? [...new Set(docs.flatMap((d) => (d && typeof d === "object" ? Object.keys(d) : [typeof d])))] : (docs && typeof docs === "object" ? Object.keys(docs) : []),
    docHoldsSourceText: /"(text|content|body|raw|html|extracted)"\s*:/.test(docText),
    docSample: docText.slice(0, 300),
    claims: { deadline: r.deadline, amount_min: r.amount_min, amount_max: r.amount_max, eligibility: r.eligibility_requirements ? String(r.eligibility_requirements).slice(0, 120) : null },
  };
});

// --- B. internal-consistency / plausibility checks on actionable claims ----
const TODAY = "2026-09-19";
out.consistency = {
  total: await pgGet("opportunities?select=id", true),
  open_but_deadline_past: await pgGet(`opportunities?select=id&status=eq.open&deadline=lt.${TODAY}`, true),
  deadline_beyond_2029: await pgGet("opportunities?select=id&deadline=gte.2029-01-01", true),
  deadline_present: await pgGet("opportunities?select=id&deadline=not.is.null", true),
  amount_min_gt_amount_max: null, // computed below
  description_is_bare_url: null,
  no_url_at_all: await pgGet("opportunities?select=id&url=is.null", true),
  no_url_but_has_deadline: await pgGet("opportunities?select=id&url=is.null&deadline=not.is.null", true),
  no_url_but_has_eligibility: await pgGet("opportunities?select=id&url=is.null&eligibility_requirements=not.is.null", true),
};

// amount_min > amount_max is a self-contradiction no real source can produce
const amts = await pgGet("opportunities?select=id,name,source,amount_min,amount_max&amount_min=not.is.null&amount_max=not.is.null&limit=1000");
const bad = amts.filter((r) => Number(r.amount_min) > Number(r.amount_max));
out.consistency.amount_min_gt_amount_max = bad.length;
out.amountContradictions = bad.slice(0, 10);
out.consistency.amount_pairs_checked = amts.length;

// description that is a bare URL rather than a description = the field does
// not contain what its name promises
const descs = await pgGet("opportunities?select=id,source,description&description=not.is.null&limit=1000");
const bareUrl = descs.filter((r) => /^https?:\/\/\S*$/.test(String(r.description).trim()));
out.consistency.description_is_bare_url = bareUrl.length;
out.consistency.descriptions_checked = descs.length;
out.bareUrlBySource = bareUrl.reduce((a, r) => ((a[r.source] = (a[r.source] ?? 0) + 1), a), {});

// --- C. eligibility text that admits uncertainty (coverage honesty) -------
const elig = await pgGet("opportunities?select=id,source,eligibility_requirements&eligibility_requirements=not.is.null&limit=1000");
out.eligibility = {
  checked: elig.length,
  hedged_explicitly: elig.filter((r) => /not confirmed|verify on|unable to determine|not specified|unknown/i.test(r.eligibility_requirements)).length,
};
out.eligibilityBySource = elig.reduce((a, r) => ((a[r.source] = (a[r.source] ?? 0) + 1), a), {});

console.log(JSON.stringify(out, null, 2));
