// Ground-truth "before" probes for WGR-138/139/142/143 — makes ONE real live
// call per integration reproducing the exact request the app currently
// sends, and saves the real response to
// test-evidence/remediation/int-fix/<name>-live-before.json.
//
// Run: node scripts/audit/int-fix-live-before.mjs

import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const ENV_FILE = path.join(REPO_ROOT, ".env.local");
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "remediation", "int-fix");
fs.mkdirSync(OUT_DIR, { recursive: true });

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnv(ENV_FILE);
const SAM_KEY = env.SAM_GOV_API_KEY;

async function realCall(url, opts = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000), ...opts });
    const elapsedMs = Date.now() - started;
    const bodyText = await res.text();
    let bodyJson = null;
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      bodyJson = null;
    }
    return {
      url,
      status: res.status,
      statusText: res.statusText,
      elapsedMs,
      bodySample: bodyText.slice(0, 1500),
      bodyJson,
    };
  } catch (err) {
    return { url, networkError: String(err) };
  }
}

function save(name, data) {
  const file = path.join(OUT_DIR, `${name}-live-before.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`wrote ${file}`);
}

async function main() {
  // WGR-138 — Grants.gov, exact current (broken) request.
  const grantsgov = await realCall(
    "https://api.grants.gov/grantsws/rest/opportunities/search/v2",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: "housing",
        oppStatuses: "posted",
        rows: 100,
        startRecordNum: 0,
      }),
    },
  );
  save("wgr-138-grantsgov", { finding: "WGR-138", capturedAt: new Date().toISOString(), request: "as-coded", response: grantsgov });

  if (!SAM_KEY) {
    console.error("SAM_GOV_API_KEY not found in .env.local — skipping SAM.gov before-probes.");
  } else {
    // WGR-139 — SAM.gov opportunities/v2/search, exact current (broken) request (no date range).
    const samgovOpps = await realCall(
      `https://api.sam.gov/opportunities/v2/search?${new URLSearchParams({
        api_key: SAM_KEY,
        ptype: "o",
        limit: "100",
      })}`,
    );
    save("wgr-139-samgov-opportunities", {
      finding: "WGR-139",
      capturedAt: new Date().toISOString(),
      request: "as-coded (no postedFrom/postedTo)",
      response: { ...samgovOpps, url: samgovOpps.url.replace(SAM_KEY, "REDACTED") },
    });

    // WGR-142 — SAM.gov Entity Management v3, exact current (broken) request (activeDate set).
    function toSamDate(date) {
      const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(date.getUTCDate()).padStart(2, "0");
      const yyyy = date.getUTCFullYear();
      return `${mm}/${dd}/${yyyy}`;
    }
    const entityUrl = new URL("https://api.sam.gov/entity-information/v3/entities");
    entityUrl.searchParams.set("api_key", SAM_KEY);
    entityUrl.searchParams.set("purposeOfRegistrationCode", "Z2");
    entityUrl.searchParams.set("naicsCode", "236220");
    entityUrl.searchParams.set("activeDate", toSamDate(new Date()));
    entityUrl.searchParams.set("size", "100");
    const samgovEntity = await realCall(entityUrl.toString());
    save("wgr-142-samgov-entity", {
      finding: "WGR-142",
      capturedAt: new Date().toISOString(),
      request: "as-coded (activeDate param, rejected by real API)",
      response: { ...samgovEntity, url: samgovEntity.url.replace(SAM_KEY, "REDACTED") },
    });

    // WGR-143 — SAM.gov Award Notices (ptype=a), exact current (broken-parse) request.
    function daysAgo(days) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - days);
      return d;
    }
    const awardUrl = new URL("https://api.sam.gov/opportunities/v2/search");
    awardUrl.searchParams.set("api_key", SAM_KEY);
    awardUrl.searchParams.set("ptype", "a");
    awardUrl.searchParams.set("limit", "1000");
    awardUrl.searchParams.set("postedFrom", toSamDate(daysAgo(90)));
    awardUrl.searchParams.set("postedTo", toSamDate(new Date()));
    const samgovAward = await realCall(awardUrl.toString());
    const hits = samgovAward.bodyJson?.opportunitiesData ?? [];
    const hitsWithTopLevelAwardee = hits.filter((h) => h?.awardee?.name).length;
    const hitsWithNestedAwardAwardee = hits.filter((h) => h?.award?.awardee?.name).length;
    save("wgr-143-samgov-award-notices", {
      finding: "WGR-143",
      capturedAt: new Date().toISOString(),
      request: "as-coded (normalizeAwardee reads raw.awardee, real data at raw.award.awardee)",
      response: {
        url: awardUrl.toString().replace(SAM_KEY, "REDACTED"),
        status: samgovAward.status,
        statusText: samgovAward.statusText,
        elapsedMs: samgovAward.elapsedMs,
        totalRecords: samgovAward.bodyJson?.totalRecords,
        hitsReturned: hits.length,
        hitsWithTopLevelAwardee,
        hitsWithNestedAwardAwardee,
        firstHitSample: hits[0] ?? null,
      },
    });
  }

  console.log("done");
}

main();
