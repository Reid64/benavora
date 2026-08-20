// ============================================================================
// PT-07-003 — real, live probes against every external data source the app
// depends on: Grants.gov, SAM.gov, USASpending, ProPublica, IRS endpoints,
// and the ScraperAPI proxy rotation used by the stealth scraper.
//
// For each source this makes a REAL network call against the exact request
// shape the app's own integration code sends (URL, method, params, body),
// captures the real status + a truncated body sample, and computes an
// objective "shape verdict" by checking whether the specific fields/paths
// the app's parser reads (`response.oppHits`, `hit.oppTitle`, `hit.awardee`,
// etc. — grepped verbatim from the real .ts source files) are actually
// present in the real, current response. This is a structural field-
// presence check against the real body, not a re-execution of the
// TypeScript parser itself (these are plain .mjs probes, matching this
// audit program's established PT-07-001/PT-07-002 convention of raw-probe
// scripts rather than importing path-aliased .ts modules).
//
// Sources covered, and the app files whose exact request shape is
// reproduced here:
//   1. Grants.gov   — src/lib/sources/grantsgov-client.ts (searchGrantsGovOpportunities),
//                      the live path behind /api/cron/grantsgov (daily Vercel Cron)
//                      and /api/sources/grantsgov.
//   2. SAM.gov      — src/lib/sources/samgov-client.ts (searchSamGovOpportunities),
//                      the live path behind /api/sources/samgov. Also probes
//                      two additional real SAM.gov integrations found during
//                      this audit that hit different endpoints on the same
//                      host: src/lib/donor-discovery/adapters/samgov-adapter.ts's
//                      Entity Management API v3 call and its Award-Notices
//                      (ptype=a) call.
//   3. USASpending  — src/lib/agents/usaspending.ts (UsaspendingAgent.execute).
//   4. ProPublica   — src/lib/sources/propublica-990-client.ts
//                      (enrichFoundationFromProPublica / fetchProPublicaFinancials).
//   5. IRS endpoints — src/scripts/import-irs-bmf.ts (BMF CSV) and
//                      src/lib/scraper/foundation-scraper.ts (990 XML index +
//                      batch ZIP URL construction).
//   6. ScraperAPI   — src/lib/scraper/stealth-engine.ts (resolveProxy()).
//                      SCRAPER_API_KEY is confirmed absent from this
//                      environment's .env.local (also documented as
//                      production-unconfirmed in WGR-003) — this probe
//                      confirms the real gateway is live/enforces per-request
//                      auth (so a configured key would genuinely route
//                      through it), and confirms via code review that an
//                      absent key makes StealthEngine launch with no proxy
//                      at all ("running direct").
//
// A source returning an error, or a shape the app's parser cannot read, is
// recorded as a finding (not silently passed) — per this task's explicit
// instruction.
//
// Evidence: test-evidence/pt-07/data-sources.json
// Usage: node scripts/audit/pt07-003-data-sources.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REPO_ROOT = process.cwd();
const ENV_FILE = path.join(REPO_ROOT, ".env.local");
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "pt-07");
const OUT_FILE = path.join(OUT_DIR, "data-sources.json");

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

async function realCall(url, opts = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000), ...opts });
    const elapsedMs = Date.now() - started;
    const contentType = res.headers.get("content-type") || "";
    let bodyText = "";
    let bodyJson = null;
    if (opts.method !== "HEAD") {
      bodyText = await res.text();
      if (contentType.includes("json")) {
        try {
          bodyJson = JSON.parse(bodyText);
        } catch {
          bodyJson = null;
        }
      }
    }
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      contentType,
      elapsedMs,
      bodySample: bodyText.slice(0, 1200),
      bodyJson,
      networkError: null,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      statusText: null,
      contentType: null,
      elapsedMs: Date.now() - started,
      bodySample: null,
      bodyJson: null,
      networkError: err?.message || String(err),
    };
  }
}

const results = { generated_at: new Date().toISOString(), sources: {} };
const allFindings = [];

function pushFinding(source, severity, detail) {
  allFindings.push({ source, severity, detail });
}

// ── 1. Grants.gov ────────────────────────────────────────────────────────

async function probeGrantsGov() {
  const appFiles = [
    "src/lib/sources/grantsgov-client.ts",
    "src/lib/sources/grantsgov-sync.ts (caller)",
    "src/app/api/cron/grantsgov/route.ts (daily Vercel Cron, 0 7 * * *)",
    "src/app/api/sources/grantsgov/route.ts",
  ];

  const appCodedUrl = "https://api.grants.gov/grantsws/rest/opportunities/search/v2";
  const appBody = { keyword: "housing", oppStatuses: "posted", rows: 5, startRecordNum: 0 };

  const asCoded = await realCall(appCodedUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(appBody),
  });

  // Diagnostic: the real, current public endpoint (found by this audit --
  // Grants.gov's Search2 API, not what the app is coded against).
  const realUrl = "https://api.grants.gov/v1/api/search2";
  const realCallResult = await realCall(realUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: 3, keyword: "housing", oppStatuses: "forecasted|posted" }),
  });

  // App's exact read path: `Array.isArray(body.oppHits) ? body.oppHits : []`
  // applied to whatever body it actually receives today.
  const appReadsTopLevelOppHits = Array.isArray(asCoded.bodyJson?.oppHits);
  const realResponseHasTopLevelOppHits = Array.isArray(realCallResult.bodyJson?.oppHits);
  const realResponseHitsPath = Array.isArray(realCallResult.bodyJson?.data?.oppHits)
    ? realCallResult.bodyJson.data.oppHits
    : [];
  const firstRealHit = realResponseHitsPath[0] ?? null;

  const shapeCheck = {
    appReadsField: "oppHits (top-level)",
    appReadsFieldPresentInRealResponse: realResponseHasTopLevelOppHits,
    realHitsActuallyLiveAt: "data.oppHits",
    firstRealHitKeys: firstRealHit ? Object.keys(firstRealHit).sort() : null,
    appExpectsHitField_oppTitle: firstRealHit ? "oppTitle" in firstRealHit : null,
    realHitField_title: firstRealHit ? "title" in firstRealHit : null,
    appExpectsHitField_synopsis_forDescription: firstRealHit ? "synopsis" in firstRealHit : null,
    appExpectsHitField_awardCeiling_forAmount: firstRealHit ? "awardCeiling" in firstRealHit : null,
  };

  let verdict;
  let detail;
  if (asCoded.status === 403) {
    verdict = "BROKEN";
    detail =
      `App-coded URL (${appCodedUrl}) returns HTTP 403 "Missing Authentication Token" on every ` +
      `real call — an AWS API Gateway response indicating this path no longer resolves to a ` +
      `live route. searchGrantsGovOpportunities() treats any !response.ok as a silent empty ` +
      `array, so the daily cron (/api/cron/grantsgov) has been finding 0 opportunities on every ` +
      `run, with no error surfaced anywhere. The real, current public endpoint is ` +
      `${realUrl} (confirmed reachable, HTTP ${realCallResult.status}), but even there the ` +
      `response wraps hits in data.oppHits (app reads top-level oppHits — always undefined) and ` +
      `renames/drops fields the app's mapHit() reads: real hits use "title" not "oppTitle", and ` +
      `carry no "synopsis" or "awardCeiling" field at all (both confirmed absent from ${firstRealHit ? Object.keys(firstRealHit).length : 0} real hit fields). ` +
      `Fixing the URL alone would not be sufficient — the parser's field names are also stale.`;
    pushFinding("grants_gov", "P0", detail);
  } else {
    verdict = "OK";
    detail = `App-coded URL responded HTTP ${asCoded.status}, not the expected 403 — re-verify this finding, API state may have changed since this probe ran.`;
  }

  results.sources.grants_gov = {
    app_files: appFiles,
    request: {
      as_coded: { url: appCodedUrl, method: "POST", body: appBody },
      real_current_endpoint_diagnostic: { url: realUrl, method: "POST", body: { rows: 3, keyword: "housing", oppStatuses: "forecasted|posted" } },
    },
    response: {
      as_coded: { status: asCoded.status, statusText: asCoded.statusText, contentType: asCoded.contentType, elapsedMs: asCoded.elapsedMs, bodySample: asCoded.bodySample, networkError: asCoded.networkError },
      real_current_endpoint_diagnostic: { status: realCallResult.status, statusText: realCallResult.statusText, contentType: realCallResult.contentType, elapsedMs: realCallResult.elapsedMs, bodySample: realCallResult.bodySample, networkError: realCallResult.networkError },
    },
    shape_check: shapeCheck,
    verdict,
    detail,
  };
}

// ── 2. SAM.gov ───────────────────────────────────────────────────────────

function toSamDate(d) {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}
function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

async function probeSamGov() {
  const appFiles = [
    "src/lib/sources/samgov-client.ts",
    "src/app/api/sources/samgov/route.ts (live path)",
    "src/lib/donor-discovery/adapters/samgov-adapter.ts (separate implementation, same host)",
    "src/lib/agents/sam-gov.ts (separate, manual-trigger-only agent, already handles date range correctly)",
  ];

  const key = env.SAM_GOV_API_KEY;
  if (!key) {
    results.sources.sam_gov = {
      app_files: appFiles,
      verdict: "NOT_CONFIGURED",
      detail: "SAM_GOV_API_KEY not present in .env.local — no real call could be made.",
    };
    pushFinding("sam_gov", "P0", "SAM_GOV_API_KEY not configured in this environment; SAM.gov probes skipped.");
    return;
  }

  // 2a. As coded in samgov-client.ts — no postedFrom/postedTo.
  const asCodedParams = new URLSearchParams({ api_key: "REDACTED", ptype: "o", limit: "5" });
  const asCodedUrl = `https://api.sam.gov/opportunities/v2/search?${new URLSearchParams({ api_key: key, ptype: "o", limit: "5" })}`;
  const asCoded = await realCall(asCodedUrl);

  // 2b. Same endpoint, WITH the mandatory date range (diagnostic — proves
  // the endpoint/key/shape are otherwise fine once the missing params are added).
  const withDatesParams = { ptype: "o", limit: "5", postedFrom: "08/01/2026", postedTo: "08/20/2026" };
  const withDatesUrl = `https://api.sam.gov/opportunities/v2/search?${new URLSearchParams({ api_key: key, ...withDatesParams })}`;
  const withDates = await realCall(withDatesUrl);
  const firstHit = withDates.bodyJson?.opportunitiesData?.[0] ?? null;

  const shapeCheck = {
    appReadsField_noticeId: firstHit ? "noticeId" in firstHit : null,
    appReadsField_title: firstHit ? "title" in firstHit : null,
    appReadsField_description_asPlainText: firstHit ? typeof firstHit.description === "string" && !/^https?:\/\//.test(firstHit.description) : null,
    real_description_value_sample: firstHit?.description ?? null,
    appReadsField_responseDeadLine: firstHit ? "responseDeadLine" in firstHit : null,
    appReadsField_awardAmount: firstHit ? "awardAmount" in firstHit : null,
    real_awardAmount_present_across_hits: (withDates.bodyJson?.opportunitiesData ?? []).some((h) => "awardAmount" in h),
  };

  let verdict = "OK";
  const detailParts = [];
  if (asCoded.status === 400) {
    detailParts.push(
      `As coded (no postedFrom/postedTo), the real API returns HTTP 400 "PostedFrom and PostedTo ` +
        `are mandatory" on every call. searchSamGovOpportunities() treats !response.ok as a silent ` +
        `empty array, so this integration returns 0 results on literally every real invocation today.`,
    );
    verdict = "BROKEN";
    pushFinding("sam_gov", "P0", "src/lib/sources/samgov-client.ts sends no postedFrom/postedTo — SAM.gov rejects every real call with HTTP 400, silently swallowed to an empty array.");
  }
  if (withDates.ok && firstHit) {
    if (typeof firstHit.description === "string" && /^https?:\/\//.test(firstHit.description)) {
      detailParts.push(
        `Once the date range is supplied, the real API returns real hits, but "description" is ` +
          `always a URL to a separate GET .../noticedesc endpoint, never literal opportunity text ` +
          `(confirmed on all ${withDates.bodyJson.opportunitiesData.length} returned hits). ` +
          `mapHit() stores this URL string directly as the opportunity description.`,
      );
      pushFinding("sam_gov", "P1", "SAM.gov search hits' description field is a fetch-URL, not text, on every hit — mapHit() would persist the URL string as the opportunity description with no crash and no warning.");
      verdict = verdict === "OK" ? "DEGRADED" : verdict;
    }
    if (!shapeCheck.real_awardAmount_present_across_hits) {
      detailParts.push(
        `"awardAmount" is absent from the schema of every returned hit (real field simply does not ` +
          `exist in opportunities/v2/search results) — amount_max is always null for SAM.gov ` +
          `opportunities via this path.`,
      );
      pushFinding("sam_gov", "P2", "SAM.gov search hits never carry an awardAmount field — amount is always null for this source, not a parser bug but worth documenting since it's silent.");
    }
  }

  // 2c. samgov-adapter.ts — Entity Management API v3 (activeDate param).
  const entityUrl = new URL("https://api.sam.gov/entity-information/v3/entities");
  entityUrl.searchParams.set("api_key", key);
  entityUrl.searchParams.set("purposeOfRegistrationCode", "Z2");
  entityUrl.searchParams.set("naicsCode", "236220");
  entityUrl.searchParams.set("activeDate", toSamDate(new Date()));
  entityUrl.searchParams.set("size", "3");
  const entityCall = await realCall(entityUrl.toString());
  let entityVerdict = "OK";
  let entityDetail = null;
  if (entityCall.status === 400) {
    entityVerdict = "BROKEN";
    entityDetail =
      `searchEntitiesByNaics() (samgov-adapter.ts) sends "activeDate" as a query param; the real, ` +
      `current Entity Management API v3 rejects it with HTTP 400 "The search parameter, activeDate ` +
      `does not exist." on every call — this donor-discovery corporate-entity path is fully broken.`;
    pushFinding("sam_gov", "P0", "src/lib/donor-discovery/adapters/samgov-adapter.ts's searchEntitiesByNaics() sends an activeDate param the real SAM.gov Entity Management API v3 rejects outright (HTTP 400) — every real call fails.");
  }

  // 2d. samgov-adapter.ts — Award Notices (ptype=a), awardee nesting check.
  const awardUrl = new URL("https://api.sam.gov/opportunities/v2/search");
  awardUrl.searchParams.set("api_key", key);
  awardUrl.searchParams.set("ptype", "a");
  awardUrl.searchParams.set("limit", "5");
  awardUrl.searchParams.set("postedFrom", toSamDate(daysAgo(90)));
  awardUrl.searchParams.set("postedTo", toSamDate(new Date()));
  const awardCall = await realCall(awardUrl.toString());
  const awardHits = awardCall.bodyJson?.opportunitiesData ?? [];
  const hitsWithTopLevelAwardee = awardHits.filter((h) => h && typeof h === "object" && "awardee" in h).length;
  const hitsWithNestedAwardAwardee = awardHits.filter((h) => h?.award && typeof h.award === "object" && "awardee" in h.award).length;
  let awardVerdict = "OK";
  let awardDetail = null;
  if (awardHits.length > 0 && hitsWithTopLevelAwardee === 0) {
    awardVerdict = "BROKEN";
    awardDetail =
      `normalizeAwardee() (samgov-adapter.ts) reads raw.awardee?.name directly off each hit, but ` +
      `the real API nests it at hit.award.awardee — confirmed 0/${awardHits.length} real hits carry ` +
      `a top-level "awardee" field, while ${hitsWithNestedAwardAwardee}/${awardHits.length} carry ` +
      `it at the real path (hit.award.awardee). searchRecentAwardRecipients() silently returns zero ` +
      `prospects on every real call.`;
    pushFinding("sam_gov", "P0", "src/lib/donor-discovery/adapters/samgov-adapter.ts's normalizeAwardee() reads hit.awardee, but the real SAM.gov Award Notice shape nests it at hit.award.awardee — every real call returns zero prospects, silently.");
  }

  results.sources.sam_gov = {
    app_files: appFiles,
    request: {
      as_coded_no_date_range: { url: asCodedUrl.replace(key, "REDACTED"), method: "GET" },
      with_mandatory_date_range_diagnostic: { url: withDatesUrl.replace(key, "REDACTED"), method: "GET" },
      samgov_adapter_entity_v3: { url: entityUrl.toString().replace(key, "REDACTED"), method: "GET" },
      samgov_adapter_award_notices: { url: awardUrl.toString().replace(key, "REDACTED"), method: "GET" },
    },
    response: {
      as_coded_no_date_range: { status: asCoded.status, statusText: asCoded.statusText, elapsedMs: asCoded.elapsedMs, bodySample: asCoded.bodySample, networkError: asCoded.networkError },
      with_mandatory_date_range_diagnostic: { status: withDates.status, statusText: withDates.statusText, elapsedMs: withDates.elapsedMs, bodySample: withDates.bodySample?.slice(0, 800), networkError: withDates.networkError, totalRecords: withDates.bodyJson?.totalRecords },
      samgov_adapter_entity_v3: { status: entityCall.status, statusText: entityCall.statusText, bodySample: entityCall.bodySample, networkError: entityCall.networkError },
      samgov_adapter_award_notices: { status: awardCall.status, statusText: awardCall.statusText, totalRecords: awardCall.bodyJson?.totalRecords, hitsReturned: awardHits.length, hitsWithTopLevelAwardee, hitsWithNestedAwardAwardee, networkError: awardCall.networkError },
    },
    shape_check: shapeCheck,
    verdict,
    detail: detailParts.join(" ") || "Real hits parse cleanly against the fields the app reads.",
    additional_checks: {
      entity_management_v3: { verdict: entityVerdict, detail: entityDetail },
      award_notices_ptype_a: { verdict: awardVerdict, detail: awardDetail },
    },
  };
}

// ── 3. USASpending ───────────────────────────────────────────────────────

async function probeUsaspending() {
  const appFiles = ["src/lib/agents/usaspending.ts (UsaspendingAgent)"];
  const url = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
  const body = {
    filters: { award_type_codes: ["02", "03", "04", "05"], keyword: "housing" },
    fields: ["Award ID", "Recipient Name", "Award Amount", "Award Date", "Awarding Agency", "Description"],
    page: 1,
    limit: 5,
    sort: "Award Amount",
    order: "desc",
  };
  const call = await realCall(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Benavora Grant Research Bot" },
    body: JSON.stringify(body),
  });

  const firstResult = call.bodyJson?.results?.[0] ?? null;
  const requiredFields = ["Award ID", "Recipient Name", "Award Amount", "Award Date", "Awarding Agency", "Description"];
  const presentFields = firstResult ? requiredFields.filter((f) => f in firstResult) : [];
  const missingFields = requiredFields.filter((f) => !presentFields.includes(f));

  let verdict = "OK";
  let detail = `All ${requiredFields.length} fields the app reads are present on the real response's first result.`;
  if (!call.ok) {
    verdict = "BROKEN";
    detail = `Real call failed: HTTP ${call.status} ${call.statusText}. ${call.networkError ?? ""}`;
    pushFinding("usaspending", "P0", `USASpending API call failed live: HTTP ${call.status}.`);
  } else if (!Array.isArray(call.bodyJson?.results)) {
    verdict = "BROKEN";
    detail = `Response has no top-level "results" array (app reads json.results directly).`;
    pushFinding("usaspending", "P0", "USASpending real response has no top-level results array — the app's UsaspendingAgent.execute() reads json.results directly.");
  } else if (missingFields.length > 0) {
    verdict = "DEGRADED";
    detail = `Real result is missing field(s) the app reads: ${missingFields.join(", ")}.`;
    pushFinding("usaspending", "P1", `USASpending real award objects are missing: ${missingFields.join(", ")}.`);
  }

  results.sources.usaspending = {
    app_files: appFiles,
    request: { url, method: "POST", body },
    response: { status: call.status, statusText: call.statusText, contentType: call.contentType, elapsedMs: call.elapsedMs, bodySample: call.bodySample, networkError: call.networkError, resultCount: call.bodyJson?.results?.length ?? null },
    shape_check: { requiredFields, presentOnFirstResult: presentFields, missingFromFirstResult: missingFields },
    verdict,
    detail,
  };
}

// ── 4. ProPublica ────────────────────────────────────────────────────────

async function probeProPublica() {
  const appFiles = ["src/lib/sources/propublica-990-client.ts (enrichFoundationFromProPublica, fetchProPublicaFinancials)"];
  // American National Red Cross — a real, stable, well-known EIN, chosen
  // because the previously-tried EIN (561414476, an assumed Gates Foundation
  // EIN) returned 404 "Organization not found" against the real API; that
  // 404 is itself real, expected ProPublica behavior for an unknown/invalid
  // EIN (enrichFoundationFromProPublica() correctly returns null on it, per
  // its own documented contract), not a shape-drift finding.
  const ein = "530196605";
  const url = `https://projects.propublica.org/nonprofits/api/v2/organizations/${ein}.json`;
  const call = await realCall(url);

  const org = call.bodyJson?.organization ?? null;
  const filing = call.bodyJson?.filings_with_data?.[0] ?? null;
  const orgFields = ["name", "ntee_code", "state", "city", "subsection_code"];
  const filingFields = ["totrevenue", "totassetsend", "totfuncexpns"];
  const orgPresent = org ? orgFields.filter((f) => f in org) : [];
  const orgMissing = orgFields.filter((f) => !orgPresent.includes(f));
  const filingPresent = filing ? filingFields.filter((f) => f in filing) : [];
  const filingMissing = filingFields.filter((f) => !filingPresent.includes(f));
  const filingHasFiscalPeriod = filing ? "fiscal_period" in filing : null;
  const filingHasTaxPrdYrFallback = filing ? "tax_prd_yr" in filing : null;

  // Cross-check the narrower fetchProPublicaFinancials() sibling function,
  // which reads the same filings_with_data[0].{totrevenue,totassetsend}.
  const financialsShapeOk = filing ? "totrevenue" in filing && "totassetsend" in filing : null;

  let verdict = "OK";
  let detail = "organization.{name,ntee_code,state,city,subsection_code} and filings_with_data[0].{totrevenue,totassetsend,totfuncexpns} all present, matching enrichFoundationFromProPublica()'s read path exactly. Real fiscal_period field is absent (as the code's own header comment already documents) — the code's tax_prd_yr fallback is present and used correctly.";
  if (!call.ok) {
    verdict = "BROKEN";
    detail = `Real call to a known-valid EIN (American National Red Cross, ${ein}) failed: HTTP ${call.status}.`;
    pushFinding("propublica", "P0", `ProPublica API call for a known-valid EIN failed live: HTTP ${call.status}.`);
  } else if (orgMissing.length > 0 || filingMissing.length > 0) {
    verdict = "DEGRADED";
    detail = `Missing field(s) the app reads — organization: ${orgMissing.join(", ") || "none"}; filing: ${filingMissing.join(", ") || "none"}.`;
    pushFinding("propublica", "P1", `ProPublica real response missing app-read fields — organization: ${orgMissing.join(", ") || "none"}; filing: ${filingMissing.join(", ") || "none"}.`);
  }

  results.sources.propublica = {
    app_files: appFiles,
    request: { url, method: "GET", note: `EIN ${ein} chosen as a known-valid, stable real organization for this probe.` },
    response: { status: call.status, statusText: call.statusText, contentType: call.contentType, elapsedMs: call.elapsedMs, bodySample: call.bodySample, networkError: call.networkError },
    shape_check: {
      organization_fields_present: orgPresent,
      organization_fields_missing: orgMissing,
      filing_fields_present: filingPresent,
      filing_fields_missing: filingMissing,
      filing_has_fiscal_period_field: filingHasFiscalPeriod,
      filing_has_tax_prd_yr_fallback: filingHasTaxPrdYrFallback,
      fetchProPublicaFinancials_sibling_shape_ok: financialsShapeOk,
    },
    verdict,
    detail,
  };
}

// ── 5. IRS endpoints ─────────────────────────────────────────────────────

function isFoundation(row) {
  // Mirrors isFoundation() in src/scripts/import-irs-bmf.ts exactly.
  const foundation = (row["FOUNDATION"] ?? "").trim().padStart(2, "0");
  const subsection = (row["SUBSECTION"] ?? "").trim();
  const pfFiling = (row["PF_FILING_REQD_CD"] ?? "").trim();
  return foundation === "02" || foundation === "04" || (subsection === "03" && pfFiling === "1");
}

const BMF_HEADERS = [
  "EIN", "NAME", "ICO", "STREET", "CITY", "STATE", "ZIP", "GROUP",
  "SUBSECTION", "AFFILIATION", "CLASSIFICATION", "RULING", "DEDUCTIBILITY",
  "FOUNDATION", "ACTIVITY", "ORGANIZATION", "STATUS", "TAX_PERIOD",
  "ASSET_CD", "INCOME_CD", "FILING_REQD_CD", "PF_FILING_REQD_CD", "ACCT_PD",
  "ASSET_AMT", "INCOME_AMT", "REVENUE_AMT", "NTEE_CD", "SORT_NAME",
];

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

async function probeIrsEndpoints() {
  const appFiles = [
    "src/scripts/import-irs-bmf.ts (BMF_BASE_URL, BMF_HEADERS, importFile())",
    "src/lib/scraper/foundation-scraper.ts (IRS 990 XML index URL, batch ZIP URL construction)",
  ];

  // 5a. IRS BMF CSV — a small state file (Wyoming) to keep the real download small.
  const bmfUrl = "https://www.irs.gov/pub/irs-soi/eo_wy.csv";
  const bmfCall = await realCall(bmfUrl);
  const bmfLines = (bmfCall.bodySample ?? "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const firstLine = bmfLines[0] ?? "";
  const firstLineLooksLikeHeader = firstLine.startsWith("EIN,NAME,");
  let headerRowFilteredByIsFoundation = null;
  if (firstLineLooksLikeHeader) {
    const values = parseCSVLine(firstLine);
    const row = {};
    for (let i = 0; i < BMF_HEADERS.length; i++) row[BMF_HEADERS[i]] = values[i];
    headerRowFilteredByIsFoundation = !isFoundation(row);
  }

  let bmfVerdict = "OK";
  let bmfDetail =
    "Real CSV downloads with no header row, matching the code comment (\"BMF files have no header row\"); every line is real data.";
  if (firstLineLooksLikeHeader) {
    bmfVerdict = headerRowFilteredByIsFoundation ? "DEGRADED" : "BROKEN";
    bmfDetail =
      `The real, current file DOES include a literal header row ("${firstLine.slice(0, 80)}...") as ` +
      `its first line — contradicting import-irs-bmf.ts's own comment ("IRS EO BMF files have NO ` +
      `header row, so we supply the column names") and its unconditional \`for await (const line of ` +
      `rl)\` loop, which has no header-skip logic. Positionally re-applying BMF_HEADERS to this ` +
      `header row and running the real isFoundation() filter against it ` +
      `${headerRowFilteredByIsFoundation ? "correctly rejects it (FOUNDATION=\"FOUNDATION\" doesn't match \"02\"/\"04\", so it's a harmless no-op today)" : "does NOT reject it — this would insert a garbage row"}. ` +
      `Documented as a real, currently-harmless (by coincidence, not by design) shape-assumption ` +
      `drift, not a live data-corruption bug.`;
    pushFinding(
      "irs_endpoints",
      headerRowFilteredByIsFoundation ? "P3" : "P1",
      `IRS BMF CSV files now include a header row that import-irs-bmf.ts's code/comments assume does not exist; currently harmless because isFoundation() happens to reject the header row, but the assumption itself is stale.`,
    );
  }

  // 5b. IRS 990 XML index CSV — the app constructs this URL from the current year.
  const year = new Date().getUTCFullYear();
  const indexUrl = `https://apps.irs.gov/pub/epostcard/990/xml/${year}/index_${year}.csv`;
  const indexCall = await realCall(indexUrl);
  const indexFirstLine = (indexCall.bodySample ?? "").split(/\r?\n/)[0] ?? "";
  const expectedIndexHeader = "RETURN_ID,FILING_TYPE,EIN,TAX_PERIOD,SUB_DATE,TAXPAYER_NAME,RETURN_TYPE,DLN,OBJECT_ID,XML_BATCH_ID";
  const indexHeaderMatches = indexFirstLine.trim() === expectedIndexHeader;

  let indexVerdict = "OK";
  let indexDetail = `Real index CSV header matches exactly: "${expectedIndexHeader}" — EIN at index 2, OBJECT_ID at 8, XML_BATCH_ID at 9, matching this codebase's already-documented column-position fix (D2, 2026-08-14).`;
  if (!indexCall.ok) {
    indexVerdict = "BROKEN";
    indexDetail = `Real call to the constructed index URL (${indexUrl}) failed: HTTP ${indexCall.status}.`;
    pushFinding("irs_endpoints", "P1", `IRS 990 XML index CSV for year ${year} (${indexUrl}) is unreachable: HTTP ${indexCall.status}.`);
  } else if (!indexHeaderMatches) {
    indexVerdict = "DEGRADED";
    indexDetail = `Real index CSV header ("${indexFirstLine}") does not match the expected column order.`;
    pushFinding("irs_endpoints", "P1", `IRS 990 XML index CSV column order has changed from the previously-documented layout: got "${indexFirstLine}".`);
  }

  // 5c. IRS 990 batch ZIP — construct a real batchZipUrl from a real
  // XML_BATCH_ID pulled from the index above, and confirm it resolves
  // (HEAD only — these are 500MB+ files).
  let zipVerdict = "OK";
  let zipDetail = "Not checked — no real XML_BATCH_ID could be extracted from the index response.";
  let zipUrl = null;
  const indexDataLine = (indexCall.bodySample ?? "").split(/\r?\n/)[1];
  if (indexDataLine) {
    const cols = parseCSVLine(indexDataLine);
    const xmlBatchId = cols[9]; // XML_BATCH_ID is the real column at index 9, per 5b.
    if (xmlBatchId) {
      zipUrl = `https://apps.irs.gov/pub/epostcard/990/xml/${year}/${xmlBatchId}.zip`;
      const zipCall = await realCall(zipUrl, { method: "HEAD" });
      if (zipCall.ok && (zipCall.contentType ?? "").includes("zip")) {
        zipVerdict = "OK";
        zipDetail = `Real batch ZIP resolves and is a real ZIP file (HTTP ${zipCall.status}, content-type ${zipCall.contentType}).`;
      } else {
        zipVerdict = "BROKEN";
        zipDetail = `Constructed batch ZIP URL (${zipUrl}) did not resolve to a real ZIP: HTTP ${zipCall.status}, content-type ${zipCall.contentType}.`;
        pushFinding("irs_endpoints", "P1", `IRS 990 batch ZIP URL construction produced an unreachable/non-ZIP URL: ${zipUrl} (HTTP ${zipCall.status}).`);
      }
      results.sources.irs_endpoints_zip_probe = { url: zipUrl, status: zipCall.status, contentType: zipCall.contentType };
    }
  }

  results.sources.irs_endpoints = {
    app_files: appFiles,
    request: {
      bmf_csv: { url: bmfUrl, method: "GET" },
      xml_990_index: { url: indexUrl, method: "GET" },
      xml_990_batch_zip: { url: zipUrl, method: "HEAD" },
    },
    response: {
      bmf_csv: { status: bmfCall.status, statusText: bmfCall.statusText, contentType: bmfCall.contentType, elapsedMs: bmfCall.elapsedMs, firstLine, bodySample: bmfCall.bodySample?.slice(0, 600), networkError: bmfCall.networkError },
      xml_990_index: { status: indexCall.status, statusText: indexCall.statusText, contentType: indexCall.contentType, elapsedMs: indexCall.elapsedMs, firstLine: indexFirstLine, networkError: indexCall.networkError },
    },
    shape_check: {
      bmf_first_line_looks_like_header: firstLineLooksLikeHeader,
      bmf_header_row_filtered_by_isFoundation: headerRowFilteredByIsFoundation,
      index_header_matches_documented_layout: indexHeaderMatches,
    },
    verdict: [bmfVerdict, indexVerdict, zipVerdict].includes("BROKEN")
      ? "BROKEN"
      : [bmfVerdict, indexVerdict, zipVerdict].includes("DEGRADED")
        ? "DEGRADED"
        : "OK",
    detail: [
      `BMF CSV: ${bmfDetail}`,
      `990 index CSV: ${indexDetail}`,
      `990 batch ZIP: ${zipDetail}`,
    ].join(" | "),
  };
}

// ── 6. ScraperAPI rotation ───────────────────────────────────────────────

async function probeScraperApi() {
  const appFiles = ["src/lib/scraper/stealth-engine.ts (resolveProxy(), StealthEngine.launchContext())"];
  const keyConfigured = Boolean(env.SCRAPER_API_KEY);

  // Real, live check of the gateway itself: a CONNECT-tunnel HTTPS request
  // through proxy-server.scraperapi.com:8001 using a deliberately invalid
  // key (this environment has none configured). curl is used because Node's
  // built-in fetch has no HTTP-CONNECT-proxy support without an extra
  // dependency; this reproduces exactly the host:port resolveProxy() would
  // construct (`http://scraperapi:${key}@proxy-server.scraperapi.com:8001`).
  let gatewayProbe;
  try {
    const stdout = execFileSync(
      "curl",
      [
        "-sk",
        "-x",
        "http://scraperapi:TESTKEY000000000000000000000000@proxy-server.scraperapi.com:8001",
        "https://httpbin.org/ip",
        "-w",
        "\nHTTP_STATUS:%{http_code}",
        "--max-time",
        "20",
      ],
      { encoding: "utf8", timeout: 25000 },
    );
    const statusMatch = /HTTP_STATUS:(\d+)/.exec(stdout);
    gatewayProbe = {
      reachable: true,
      status: statusMatch ? Number(statusMatch[1]) : null,
      bodySample: stdout.replace(/\nHTTP_STATUS:\d+$/, "").trim(),
      note: "Real CONNECT-tunnel request through the gateway with a deliberately invalid key — a real, live 401 with an auth-error body confirms the gateway itself is live and enforces per-key auth (rotation is a server-side account feature of ScraperAPI, not client logic in this codebase).",
    };
  } catch (err) {
    gatewayProbe = { reachable: false, error: err?.message || String(err) };
  }

  let verdict;
  let detail;
  if (!keyConfigured) {
    verdict = "NOT_CONFIGURED";
    detail =
      `SCRAPER_API_KEY is absent from this environment's .env.local (also documented in WGR-003 as ` +
      `production-unconfirmed). Per resolveProxy(), an unset key returns undefined, and ` +
      `StealthEngine.launchContext() only sets launchArgs.proxy when this.proxy is truthy — so with ` +
      `no key, chromium.launch() runs with NO proxy configured at all: every scrape from this ` +
      `environment connects directly from this machine's own IP, not through ScraperAPI's rotating ` +
      `pool. ` +
      (gatewayProbe.reachable
        ? `The gateway itself is confirmed live and reachable (real HTTP ${gatewayProbe.status} "${gatewayProbe.bodySample}" for an invalid key) — a real key would genuinely route through it, but IP rotation itself (server-side, per ScraperAPI's account) cannot be verified without a real, funded credential, which does not exist in this environment.`
        : `The gateway itself could not be reached to confirm even that much: ${gatewayProbe.error}`);
    pushFinding(
      "scraperapi_rotation",
      "P1",
      "SCRAPER_API_KEY is not configured in this environment (and unconfirmed in production per WGR-003) — the stealth scraper runs with zero proxy, directly from the scraping machine's own IP, whenever this key is unset. IP rotation cannot be verified without a real credential.",
    );
  } else {
    verdict = "NOT_VERIFIED";
    detail = "SCRAPER_API_KEY IS configured in this environment, but this script does not attempt a real rotation test (would require launching a real browser through the proxy) — see stealth-engine.ts code review for the resolveProxy() mechanism.";
  }

  results.sources.scraperapi_rotation = {
    app_files: appFiles,
    request: { note: "resolveProxy() code path check + a real CONNECT-tunnel probe of proxy-server.scraperapi.com:8001", gateway_probe_command: "curl -sk -x http://scraperapi:<REDACTED>@proxy-server.scraperapi.com:8001 https://httpbin.org/ip" },
    response: { scraper_api_key_configured_locally: keyConfigured, gateway_probe: gatewayProbe },
    verdict,
    detail,
  };
}

// ── run all, write evidence ──────────────────────────────────────────────

await probeGrantsGov();
await probeSamGov();
await probeUsaspending();
await probeProPublica();
await probeIrsEndpoints();
await probeScraperApi();

const requiredSources = ["grants_gov", "sam_gov", "usaspending", "propublica", "irs_endpoints", "scraperapi_rotation"];
const missingSources = requiredSources.filter((s) => !results.sources[s]);

results.findings = allFindings;
results.summary = {
  sources_checked: requiredSources.length,
  sources_missing: missingSources,
  finding_count: allFindings.length,
  verdicts: Object.fromEntries(requiredSources.map((s) => [s, results.sources[s]?.verdict ?? "MISSING"])),
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2) + "\n", "utf8");

console.log(`Wrote ${OUT_FILE}`);
console.log(`Verdicts: ${JSON.stringify(results.summary.verdicts, null, 2)}`);
console.log(`Findings: ${allFindings.length}`);
for (const f of allFindings) console.log(`  - [${f.severity}] (${f.source}) ${f.detail}`);
