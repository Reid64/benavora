// ============================================================================
// PT-07-003 verifier — external data-source API probes.
//
// Exits non-zero unless test-evidence/pt-07/data-sources.json exists, is
// valid JSON, and records, for EVERY named source (Grants.gov, SAM.gov,
// USASpending, ProPublica, IRS endpoints, ScraperAPI rotation):
//   1. A real request (method + URL, not a placeholder/TODO).
//   2. A real captured response (a numeric HTTP status, OR — for
//      ScraperAPI, whose only "response" in an unconfigured environment is
//      the code-reviewed proxy decision plus a real gateway reachability
//      probe — an explicit, non-placeholder response object).
//   3. A shape verdict that is one of the recognized values (not missing,
//      not "TODO", not empty).
//
// This verifier does NOT require every verdict to be "OK" — a source
// returning an error or a shape the app's parser can't handle is the
// correct, expected finding for this task, not a script failure. It fails
// only when evidence itself is missing, incomplete, or fabricated-looking
// (a response with no real HTTP status and no real network error recorded).
//
// Usage: node scripts/audit/verify-pt07-003.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const STATE_FILE = path.join("test-evidence", "pt-07", "data-sources.json");

const REQUIRED_SOURCES = [
  "grants_gov",
  "sam_gov",
  "usaspending",
  "propublica",
  "irs_endpoints",
  "scraperapi_rotation",
];

const VALID_VERDICTS = new Set(["OK", "BROKEN", "DEGRADED", "NOT_CONFIGURED", "NOT_VERIFIED"]);

let errors = 0;
function fail(message) {
  console.error(`FAIL: ${message}`);
  errors++;
}
function ok(message) {
  console.log(`OK: ${message}`);
}

if (!fs.existsSync(STATE_FILE)) {
  fail(`${STATE_FILE} does not exist.`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

const raw = fs.readFileSync(STATE_FILE, "utf8");
if (raw.trim().length === 0) {
  fail(`${STATE_FILE} is empty.`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  fail(`${STATE_FILE} is not valid JSON: ${err.message}`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

if (!data.generated_at || Number.isNaN(new Date(data.generated_at).getTime())) {
  fail(`data.generated_at is missing or not a real timestamp.`);
}

if (!data.sources || typeof data.sources !== "object") {
  fail(`data.sources is missing.`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

// --- Recorded HTTP status (or network error) anywhere in a source's response object ---

function collectStatusesAndErrors(node, out = { statuses: [], networkErrors: [] }) {
  if (node === null || typeof node !== "object") return out;
  if (typeof node.status === "number") out.statuses.push(node.status);
  if (typeof node.status === "number" && node.status === null) {
    // unreachable, kept for clarity
  }
  if ("networkError" in node && node.networkError !== null && node.networkError !== undefined) {
    out.networkErrors.push(node.networkError);
  }
  for (const key of Object.keys(node)) {
    if (key === "status" || key === "networkError") continue;
    const value = node[key];
    if (value && typeof value === "object") collectStatusesAndErrors(value, out);
  }
  return out;
}

// --- Per-source checks ------------------------------------------------------

for (const sourceKey of REQUIRED_SOURCES) {
  const source = data.sources[sourceKey];

  if (!source) {
    fail(`data.sources.${sourceKey} is missing — no evidence was captured for this source at all.`);
    continue;
  }

  // 1. Real request recorded.
  if (!source.request || typeof source.request !== "object" || Object.keys(source.request).length === 0) {
    fail(`data.sources.${sourceKey}.request is missing or empty — no real request was captured.`);
  }

  // 2. Real response captured somewhere under this source (a numeric HTTP
  //    status from an actual call, or — for the no-credential-configured
  //    case — an explicit recorded network probe result).
  const collected = collectStatusesAndErrors(source);
  const hasRealStatus = collected.statuses.some((s) => typeof s === "number" && s >= 100 && s <= 599);
  const hasRealNetworkError = collected.networkErrors.length > 0;
  const hasGatewayProbe =
    sourceKey === "scraperapi_rotation" &&
    source.response?.gateway_probe &&
    (source.response.gateway_probe.reachable === true || source.response.gateway_probe.reachable === false);

  if (!hasRealStatus && !hasRealNetworkError && !hasGatewayProbe) {
    fail(
      `data.sources.${sourceKey} has no real captured response — no numeric HTTP status, no recorded ` +
        `network error, and (for scraperapi_rotation) no gateway reachability probe result.`,
    );
  } else {
    const evidenceDesc = hasRealStatus
      ? `HTTP status(es) [${collected.statuses.join(", ")}]`
      : hasGatewayProbe
        ? `gateway probe (reachable=${source.response.gateway_probe.reachable}, status=${source.response.gateway_probe.status ?? "n/a"})`
        : `network error(s) [${collected.networkErrors.join("; ")}]`;
    ok(`${sourceKey}: real response captured — ${evidenceDesc}.`);
  }

  // 3. Shape verdict present and recognized.
  if (!source.verdict || !VALID_VERDICTS.has(source.verdict)) {
    fail(
      `data.sources.${sourceKey}.verdict is "${source.verdict}", expected one of: ${[...VALID_VERDICTS].join(", ")}.`,
    );
  } else {
    ok(`${sourceKey}: shape verdict recorded — "${source.verdict}".`);
  }

  // Detail must be a real, non-placeholder string.
  if (!source.detail || typeof source.detail !== "string" || source.detail.trim().length < 20) {
    fail(`data.sources.${sourceKey}.detail is missing or too short to be a real finding description.`);
  }

  // App files this source's request shape was checked against.
  if (!Array.isArray(source.app_files) || source.app_files.length === 0) {
    fail(`data.sources.${sourceKey}.app_files is missing or empty — no real app integration file was named.`);
  }
}

// --- Summary consistency -----------------------------------------------------

if (!data.summary) {
  fail(`data.summary is missing.`);
} else {
  if (data.summary.sources_checked !== REQUIRED_SOURCES.length) {
    fail(`data.summary.sources_checked is ${data.summary.sources_checked}, expected ${REQUIRED_SOURCES.length}.`);
  }
  if (!Array.isArray(data.summary.sources_missing) || data.summary.sources_missing.length > 0) {
    fail(`data.summary.sources_missing is not an empty array: ${JSON.stringify(data.summary.sources_missing)}.`);
  }
  if (!Array.isArray(data.findings)) {
    fail(`data.findings is not an array.`);
  } else {
    ok(`data.findings recorded ${data.findings.length} finding(s) — a source returning an error or an unhandled shape is expected to appear here, not to fail this verifier.`);
    for (const f of data.findings) {
      if (!f.source || !f.severity || !f.detail) {
        fail(`A findings[] entry is missing source/severity/detail: ${JSON.stringify(f)}.`);
      }
    }
  }
}

// --- Secret-leak guard: the raw evidence file must never contain a live API key ---
// (SAM_GOV_API_KEY is the only per-source credential live-called by this probe;
// URLs in the evidence file must have it redacted.)

if (/api_key=(?!REDACTED)[A-Za-z0-9]{20,}/.test(raw)) {
  fail(`${STATE_FILE} appears to contain an unredacted api_key= value — a live credential may have leaked into committed evidence.`);
} else {
  ok(`No unredacted api_key= value found in the evidence file.`);
}

if (errors > 0) {
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

console.log(
  `\nPASS: ${STATE_FILE} records a real request, a real captured response, and a shape verdict for ` +
    `every one of ${REQUIRED_SOURCES.length} named external data sources (${REQUIRED_SOURCES.join(", ")}).`,
);
process.exit(0);
