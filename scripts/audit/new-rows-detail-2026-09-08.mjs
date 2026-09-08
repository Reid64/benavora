import fs from "node:fs";
const env = Object.fromEntries(
  fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const orgId = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
const res = await fetch(`${base}/rest/v1/opportunities?organization_id=eq.${orgId}&created_at=gte.${cutoff}&select=id,name,source,category,description,mission_relevance_score,mission_relevance_scored_at,match_percentage,status,created_at&order=created_at`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` }
});
const rows = await res.json();
console.log(JSON.stringify(rows, null, 2));
