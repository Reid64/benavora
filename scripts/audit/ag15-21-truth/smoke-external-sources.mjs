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

async function agent15_grantsGov() {
  // Real endpoint from src/lib/agents/grants-gov.ts (GRANTS_GOV_URL). Public, no auth.
  const res = await fetch(
    "https://apply07.grants.gov/grantsws/rest/opportunities/search/?keyword=housing&rows=3",
  );
  const body = await res.json().catch(() => null);
  console.log("\n=== Agent 15 (Grants.gov) — apply07.grants.gov ===");
  console.log("status:", res.status);
  const items = body?.oppHits ?? body?.opportunities ?? body?.opportunityListResponse ?? null;
  console.log("keys:", body ? Object.keys(body) : null);
  console.log(JSON.stringify(body, null, 2).slice(0, 1200));
}

async function agent16_samGov() {
  const key = env.SAM_GOV_API_KEY;
  console.log("\n=== Agent 16 (SAM.gov) — api.sam.gov ===");
  if (!key) {
    console.log("BLOCKED: no SAM_GOV_API_KEY in .env.local");
    return;
  }
  const res = await fetch(
    `https://api.sam.gov/prod/opportunities/v2/search?api_key=${key}&limit=3&postedFrom=08/01/2026&postedTo=09/05/2026&title=housing`,
  );
  const text = await res.text();
  console.log("status:", res.status);
  console.log(text.slice(0, 1200));
}

async function agent17_propublica() {
  console.log("\n=== Agent 17 (ProPublica 990 Mining) — projects.propublica.org ===");
  const res = await fetch(
    "https://projects.propublica.org/nonprofits/api/v2/search.json?q=faith+foundation&state[id]=CA",
  );
  const body = await res.json().catch(() => null);
  console.log("status:", res.status);
  console.log("total_results:", body?.total_results);
  console.log("first organization:", JSON.stringify(body?.organizations?.[0] ?? null, null, 2));
}

async function agent18_statePortal() {
  console.log("\n=== Agent 18 (State Portal) — egrants.gov.texas.gov (real registry's only entry) ===");
  const res = await fetch("https://egrants.gov.texas.gov/fundingopp");
  console.log("status:", res.status);
  const text = await res.text();
  console.log("bytes:", text.length, "title tag:", (text.match(/<title>(.*?)<\/title>/i) ?? [])[1]);
}

async function agent20_customScrape() {
  console.log("\n=== Agent 20 (Custom Scrape) — the one live scraping_targets URL ===");
  const targetUrl = "https://simpler.grants.gov/search?utm_source=Grants.gov";
  const res = await fetch(targetUrl);
  console.log("status:", res.status, "url:", targetUrl);
  const text = await res.text();
  console.log("bytes:", text.length, "title tag:", (text.match(/<title>(.*?)<\/title>/i) ?? [])[1]);
}

async function agent21_givingHistory() {
  console.log("\n=== Agent 21 (Giving History Extractor) — ProPublica filings for a real known EIN ===");
  // Ford Foundation EIN 131684331 — real, well-known private foundation, good fair test case.
  const res = await fetch("https://projects.propublica.org/nonprofits/api/v2/organizations/131684331.json");
  const body = await res.json().catch(() => null);
  console.log("status:", res.status);
  console.log("org name:", body?.organization?.name);
  console.log("filings_with_data count:", body?.filings_with_data?.length);
  console.log("most recent filing tax_prd_yr:", body?.filings_with_data?.[0]?.tax_prd_yr);
}

async function main() {
  await agent15_grantsGov();
  await agent16_samGov();
  await agent17_propublica();
  await agent18_statePortal();
  await agent20_customScrape();
  await agent21_givingHistory();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
