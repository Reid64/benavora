import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../../../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const base = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) {
  console.error("Missing SUPABASE_URL or SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

async function rest(path) {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "count=exact",
    },
  });
  const contentRange = res.headers.get("content-range");
  const body = await res.json();
  return { status: res.status, contentRange, body };
}

async function main() {
  const total = await rest("opportunities?select=id&limit=1");
  console.log("TOTAL opportunities content-range:", total.contentRange, "status", total.status);
  if (total.status >= 400) console.log(JSON.stringify(total.body));

  const bySource = new Map(); // physical `source` column
  const bySourceType = new Map(); // `source_type` enum column
  const maxDiscoveredAtSource = new Map();
  const maxDiscoveredAtSourceType = new Map();
  const sampleNameSource = new Map();
  const sampleNameSourceType = new Map();
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const res = await fetch(
      `${base}/rest/v1/opportunities?select=source,source_type,discovered_at,name&order=id.asc`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Range: `${from}-${from + pageSize - 1}`,
        },
      },
    );
    const data = await res.json();
    if (!Array.isArray(data)) {
      console.error("Non-array response", res.status, data);
      break;
    }
    if (data.length === 0) break;
    for (const row of data) {
      const track = (map, maxMap, sampleMap, key) => {
        map.set(key, (map.get(key) ?? 0) + 1);
        const d = row.discovered_at;
        if (d && (!maxMap.has(key) || d > maxMap.get(key))) {
          maxMap.set(key, d);
          sampleMap.set(key, row.name ?? "(no name)");
        }
      };
      track(bySource, maxDiscoveredAtSource, sampleNameSource, row.source ?? "(null)");
      track(bySourceType, maxDiscoveredAtSourceType, sampleNameSourceType, row.source_type ?? "(null)");
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  console.log("\n=== grouped by `source` (physical text column) ===");
  console.log("source | count | max(discovered_at) | sample name");
  for (const [src, count] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${src} | ${count} | ${maxDiscoveredAtSource.get(src)} | ${sampleNameSource.get(src)}`);
  }

  console.log("\n=== grouped by `source_type` (enum column) ===");
  console.log("source_type | count | max(discovered_at) | sample name");
  for (const [src, count] of [...bySourceType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${src} | ${count} | ${maxDiscoveredAtSourceType.get(src)} | ${sampleNameSourceType.get(src)}`);
  }

  const funders = await rest("funders?select=id&limit=1");
  console.log("\nTOTAL funders content-range:", funders.contentRange);

  const fi = await rest(
    "funder_intelligence?select=funder_id,updated_at,recent_grants&order=updated_at.desc&limit=5",
  );
  console.log("\nMost recent funder_intelligence rows:", JSON.stringify(fi.body, null, 2));

  for (const t of ["custom_api_connections", "scraping_targets", "state_portals", "search_profiles"]) {
    const r = await rest(`${t}?select=id&limit=1`);
    console.log(`\n${t} content-range:`, r.contentRange, "status", r.status);
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
