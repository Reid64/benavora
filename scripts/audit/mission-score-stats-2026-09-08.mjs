import fs from "node:fs";
const env = Object.fromEntries(
  fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const orgId = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";

async function rest(path, extraHeaders = {}) {
  const res = await fetch(`${base}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, ...extraHeaders } });
  return { status: res.status, headers: res.headers, body: await res.json() };
}

const scored = await rest(`opportunities?organization_id=eq.${orgId}&mission_relevance_score=not.is.null&select=id`, { Prefer: "count=exact", Range: "0-0" });
console.log("rows WITH mission_relevance_score:", scored.headers.get("content-range"));

const lowScore = await rest(`opportunities?organization_id=eq.${orgId}&mission_relevance_score=lt.15&select=id,name,source,mission_relevance_score`, {});
console.log("rows scored <15 (irrelevant threshold per kb-relevance.ts):", JSON.stringify(lowScore.body));

// category breakdown
let all = [];
let offset = 0;
while (true) {
  const page = await rest(`opportunities?organization_id=eq.${orgId}&select=category&order=id`, { Range: `${offset}-${offset+999}` });
  if (!Array.isArray(page.body) || page.body.length === 0) break;
  all = all.concat(page.body);
  if (page.body.length < 1000) break;
  offset += 1000;
}
const byCat = {};
for (const r of all) byCat[r.category] = (byCat[r.category]||0)+1;
console.log("BY CATEGORY:", JSON.stringify(byCat, null, 2));
