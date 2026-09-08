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

// total count
const total = await rest(`opportunities?organization_id=eq.${orgId}&select=id`, { Prefer: "count=exact", Range: "0-0" });
console.log("TOTAL count-range:", total.headers.get("content-range"));

// group by source manually (fetch all source values, paginated)
let all = [];
let offset = 0;
const pageSize = 1000;
while (true) {
  const page = await rest(`opportunities?organization_id=eq.${orgId}&select=source,created_at&order=id`, {
    Range: `${offset}-${offset + pageSize - 1}`,
  });
  if (!Array.isArray(page.body) || page.body.length === 0) break;
  all = all.concat(page.body);
  if (page.body.length < pageSize) break;
  offset += pageSize;
}
console.log("fetched rows:", all.length);
const bySource = {};
for (const r of all) {
  bySource[r.source] = (bySource[r.source] || 0) + 1;
}
console.log("BY SOURCE:", JSON.stringify(bySource, null, 2));

// rows created in the last 30 minutes (this session's live runs)
const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
const recent = all.filter(r => r.created_at >= cutoff);
console.log("rows created in last 30 min:", recent.length);
