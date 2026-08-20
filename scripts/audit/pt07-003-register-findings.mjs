// ============================================================================
// PT-07-003 — register the real, live-confirmed findings from
// test-evidence/pt-07/data-sources.json into the WIRING_GAP_REGISTER.
//
// Every row below is appended via appendFindingRow() (evidence-lib.mjs),
// the same mechanism every prior *-register-findings.mjs script in this
// audit program uses. Run once; re-running will append duplicate rows, so
// this is not idempotent by design (matching the register's own append-only
// convention — see WGR-071/073/076/114/120 for the precedent on grouping a
// clean/mitigated result set into one row instead of many).
//
// Usage: node scripts/audit/pt07-003-register-findings.mjs
// ============================================================================

import { appendFindingRow } from "./evidence-lib.mjs";

const EVIDENCE = "test-evidence/pt-07/data-sources.json";
const REPRO_CAPTURE = "node scripts/audit/pt07-003-data-sources.mjs (re-runs the real live calls); node scripts/audit/verify-pt07-003.mjs (validates the captured evidence)";

const findings = [
  {
    id: "WGR-138",
    layer: "Integration/Parser",
    severity: "P0",
    description:
      "Grants.gov (src/lib/sources/grantsgov-client.ts searchGrantsGovOpportunities(), the live path " +
      "behind the daily Vercel Cron /api/cron/grantsgov \"0 7 * * *\" and /api/sources/grantsgov): the " +
      "app-coded URL (https://api.grants.gov/grantsws/rest/opportunities/search/v2) returns a real, " +
      "reproducible HTTP 403 \"Missing Authentication Token\" (AWS API Gateway error — the path no " +
      "longer resolves to a live route) on every call, confirmed twice. searchGrantsGovOpportunities() " +
      "treats any !response.ok as a silent empty array — no error is ever surfaced, so the daily cron " +
      "has been finding 0 opportunities on every run. The real, current public endpoint " +
      "(https://api.grants.gov/v1/api/search2, live-confirmed HTTP 200) would not fix this alone: its " +
      "response wraps hits in data.oppHits, not the top-level oppHits the app reads, and real hits use " +
      "\"title\" (not \"oppTitle\") with no \"synopsis\" or \"awardCeiling\" field at all — both fields " +
      "mapHit() reads for description/amount are confirmed absent from the real schema entirely. " +
      "Complements WGR-126 (same file, malformed-JSON-crash case from a mocked fetch) — this is the " +
      "well-formed-but-wrong-shape case: it never crashes, it silently returns nothing, forever.",
    evidencePath: `${EVIDENCE}#sources.grants_gov`,
    reproduction: REPRO_CAPTURE + "; or curl -X POST https://api.grants.gov/grantsws/rest/opportunities/search/v2 -H \"Content-Type: application/json\" -d '{\"keyword\":\"housing\"}' -> 403.",
    scopeTag: "CONFIRMED-BROKEN",
  },
  {
    id: "WGR-139",
    layer: "Integration/Parser",
    severity: "P0",
    description:
      "SAM.gov opportunities/v2/search (src/lib/sources/samgov-client.ts searchSamGovOpportunities(), " +
      "the live path behind /api/sources/samgov): as coded, the request omits postedFrom/postedTo. The " +
      "real, current API rejects this on every call with HTTP 400 \"PostedFrom and PostedTo are " +
      "mandatory\" — confirmed live. Same non-crashing, silent failure mode as WGR-138: " +
      "searchSamGovOpportunities() returns an empty array on !response.ok with no error surfaced, so " +
      "this integration returns 0 real results on literally every real invocation today. Adding the two " +
      "mandatory params (verified live, same session) makes the endpoint return real data — the fix is " +
      "small, but the current live behavior is a total, silent no-op.",
    evidencePath: `${EVIDENCE}#sources.sam_gov`,
    reproduction: REPRO_CAPTURE + "; or curl \"https://api.sam.gov/opportunities/v2/search?api_key=<key>&ptype=o&limit=5\" -> 400.",
    scopeTag: "CONFIRMED-BROKEN",
  },
  {
    id: "WGR-140",
    layer: "Integration/Parser",
    severity: "P1",
    description:
      "SAM.gov opportunities/v2/search (same file as WGR-139): once a valid date range is supplied, real " +
      "hits' \"description\" field is always a URL to a separate GET .../noticedesc endpoint, never " +
      "literal opportunity text — confirmed on every one of 5 real sampled hits (housing keyword, " +
      "2026-08-01..2026-08-20). mapHit()'s `description: toStr(hit.description) || null` stores this URL " +
      "string directly as the opportunity's description with no crash and no warning — a real, silent " +
      "data-quality bug distinct from WGR-139's total-failure case (this fires once the mandatory date " +
      "params are added).",
    evidencePath: `${EVIDENCE}#sources.sam_gov.shape_check`,
    reproduction: REPRO_CAPTURE,
    scopeTag: "CONFIRMED-BROKEN",
  },
  {
    id: "WGR-141",
    layer: "Integration/Parser",
    severity: "P2",
    description:
      "SAM.gov opportunities/v2/search (same file as WGR-139/140): real search hits never carry an " +
      "\"awardAmount\" field at all (confirmed absent from the schema of every one of 5 real sampled " +
      "hits) — toAmount(hit.awardAmount) always evaluates on undefined and returns null. amount_max is " +
      "therefore always null for every SAM.gov-sourced opportunity via this path. Not a crash, and " +
      "toAmount() already handles undefined gracefully by design — logged because it's a silent, " +
      "permanent data gap someone could otherwise assume is just \"most opportunities lack an amount\" " +
      "rather than \"this field never populates from this source.\"",
    evidencePath: `${EVIDENCE}#sources.sam_gov.shape_check`,
    reproduction: REPRO_CAPTURE,
    scopeTag: "CONFIRMED-BROKEN",
  },
  {
    id: "WGR-142",
    layer: "Integration/Parser",
    severity: "P0",
    description:
      "SAM.gov Entity Management API v3 (src/lib/donor-discovery/adapters/samgov-adapter.ts " +
      "searchEntitiesByNaics(), a separate implementation from samgov-client.ts, same api.sam.gov host): " +
      "the request unconditionally sets an \"activeDate\" query param. The real, current v3 Entity API " +
      "rejects this outright with HTTP 400 \"The search parameter, activeDate does not exist.\", " +
      "confirmed live (naicsCode=236220, purposeOfRegistrationCode=Z2). Unlike WGR-138/139, this function " +
      "throws a real SamGovError on !response.ok rather than degrading silently — but the net effect is " +
      "the same: this donor-discovery corporate-entity-by-NAICS path is fully broken on every real call.",
    evidencePath: `${EVIDENCE}#sources.sam_gov.additional_checks.entity_management_v3`,
    reproduction: REPRO_CAPTURE + "; or curl \"https://api.sam.gov/entity-information/v3/entities?api_key=<key>&purposeOfRegistrationCode=Z2&naicsCode=236220&activeDate=08/20/2026\" -> 400.",
    scopeTag: "CONFIRMED-BROKEN",
  },
  {
    id: "WGR-143",
    layer: "Integration/Parser",
    severity: "P0",
    description:
      "SAM.gov Award Notices (src/lib/donor-discovery/adapters/samgov-adapter.ts " +
      "searchRecentAwardRecipients()/normalizeAwardee(), ptype=a on the same opportunities/v2/search " +
      "endpoint as WGR-139/140/141, a second, separate consumer of that endpoint): normalizeAwardee() " +
      "reads raw.awardee?.name directly off each hit, but the real API nests the awardee block one level " +
      "deeper, at hit.award.awardee — confirmed live: 0 of 5 real sampled Award Notice hits carry a " +
      "top-level \"awardee\" field, while 5 of 5 carry it at the real path (hit.award.awardee, with a " +
      "real {name, location} shape). Since legalName is always undefined at the path the code reads, " +
      "every hit is silently skipped and searchRecentAwardRecipients() returns zero prospects on every " +
      "real call, with no error.",
    evidencePath: `${EVIDENCE}#sources.sam_gov.additional_checks.award_notices_ptype_a`,
    reproduction: REPRO_CAPTURE + "; or curl \"https://api.sam.gov/opportunities/v2/search?api_key=<key>&ptype=a&limit=5&postedFrom=05/22/2026&postedTo=08/20/2026\" and inspect opportunitiesData[0].award.awardee vs. opportunitiesData[0].awardee.",
    scopeTag: "CONFIRMED-BROKEN",
  },
  {
    id: "WGR-144",
    layer: "Data/Script",
    severity: "P3",
    description:
      "IRS BMF CSV (src/scripts/import-irs-bmf.ts): the file's own comment (\"IRS EO BMF files have NO " +
      "header row, so we supply the column names\") and its importFile() loop (`for await (const line of " +
      "rl)`, no header-skip logic) both assume every line is data. Live-confirmed against a real, current " +
      "download (https://www.irs.gov/pub/irs-soi/eo_wy.csv): the file's first line IS a literal header " +
      "row (\"EIN,NAME,ICO,STREET,CITY,STATE,ZIP,GROUP,SUBSECTION,...\"). Positionally re-applying " +
      "BMF_HEADERS to that header row and running the real isFoundation() filter against it confirms it " +
      "is currently harmless BY COINCIDENCE ONLY: the literal string \"FOUNDATION\" (in the header row's " +
      "FOUNDATION column) doesn't match the '02'/'04' codes isFoundation() checks for, so the header row " +
      "is filtered out before any insert. The stale no-header-row assumption itself is a real drift from " +
      "the current live file shape, not currently a data-corruption bug.",
    evidencePath: `${EVIDENCE}#sources.irs_endpoints.shape_check`,
    reproduction: REPRO_CAPTURE + "; or curl https://www.irs.gov/pub/irs-soi/eo_wy.csv | head -1 -> a literal header row.",
    scopeTag: "CONFIRMED-BROKEN",
  },
  {
    id: "WGR-145",
    layer: "Integration",
    severity: "P1",
    description:
      "ScraperAPI proxy rotation (src/lib/scraper/stealth-engine.ts resolveProxy()/StealthEngine." +
      "launchContext()): SCRAPER_API_KEY is confirmed absent from this environment's .env.local " +
      "(consistent with WGR-003, which already flagged it as production-unconfirmed). resolveProxy() " +
      "returns undefined when the key is unset, and launchContext() only sets launchArgs.proxy when " +
      "truthy — so with no key, chromium.launch() runs with ZERO proxy configured: every scrape from " +
      "this environment connects directly from the scraping machine's own IP, not through any rotating " +
      "pool. Live-confirmed the gateway itself is real and reachable: a CONNECT-tunnel HTTPS request " +
      "through proxy-server.scraperapi.com:8001 with a deliberately invalid key returns a real, live " +
      "HTTP 401 \"Unauthorized request, please make sure your API key is valid.\" — proving the mechanism " +
      "resolveProxy() constructs is genuine and enforces real per-key auth, so a configured key would " +
      "genuinely route through it. Actual IP rotation (a server-side ScraperAPI account feature, not " +
      "client logic in this codebase) cannot be verified without a real, funded credential, which does " +
      "not exist in this environment or (per WGR-003) confirmed to exist in production either.",
    evidencePath: `${EVIDENCE}#sources.scraperapi_rotation`,
    reproduction: REPRO_CAPTURE + "; or curl -sk -x \"http://scraperapi:<key-or-fake>@proxy-server.scraperapi.com:8001\" https://httpbin.org/ip.",
    scopeTag: "CONFIRMED-BROKEN",
  },
];

for (const finding of findings) {
  const row = appendFindingRow(finding);
  console.log(`Appended ${finding.id}: ${row.slice(0, 120)}...`);
}

console.log(`\nAppended ${findings.length} finding(s) to the register.`);
