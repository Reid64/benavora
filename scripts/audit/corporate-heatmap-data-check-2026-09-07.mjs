import { readFileSync } from "node:fs";
function loadEnv() {
  const raw = readFileSync(".env.local", "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}
const env = loadEnv();
const BASE = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
const HEADERS = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function restSelect(path) {
  const res = await fetch(`${BASE}/${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

const CORP_CATEGORIES = ["corporate_donation", "corporate_sponsorship", "corporate_foundation"];

async function main() {
  const orFilter = `or=(category.in.(${CORP_CATEGORIES.join(",")}),source_type.eq.corporate_giving)`;
  const corpRows = await restSelect(`opportunities?select=id,name,category,source_type,discovered_at,organization_id,funder_id&${orFilter}&order=discovered_at.asc`);

  const funderRows = await restSelect(`funders?select=id,name,category,created_at,organization_id&category=in.(${CORP_CATEGORIES.join(",")})&order=created_at.asc`);

  const orgIds = [...new Set([...corpRows.map(r => r.organization_id), ...funderRows.map(r => r.organization_id)])];
  const orgs = await restSelect(`organizations?select=id,name&id=in.(${orgIds.join(",")})`);
  const orgById = Object.fromEntries(orgs.map(o => [o.id, o.name]));

  console.log("=== corporate-category OPPORTUNITIES (with org name) ===");
  for (const r of corpRows) {
    console.log(`- "${r.name}" | category=${r.category} source_type=${r.source_type} | discovered_at=${r.discovered_at} | org="${orgById[r.organization_id]}"`);
  }

  console.log("\n=== corporate-category FUNDERS (with org name) ===");
  for (const r of funderRows) {
    console.log(`- "${r.name}" | category=${r.category} | created_at=${r.created_at} | org="${orgById[r.organization_id]}"`);
  }
}

main().catch((e) => {
  console.error("Query failed:", e);
  process.exitCode = 1;
});
