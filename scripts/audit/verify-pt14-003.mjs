#!/usr/bin/env node
/**
 * PT-14-003 verifier: fails unless (1) the client-bundle secret scan
 * actually ran and produced real output on disk (test-evidence/pt-14/
 * bundle-scan.txt), and (2) the middleware/auth-surface review is recorded
 * with a real, live production probe backing its WGR-023 disposition and a
 * completed matcher-gap check -- both rolled up into
 * test-evidence/pt-14/bundle-and-middleware.json.
 *
 * This does not re-run the scan or the review; it checks that a prior run
 * left real, internally-consistent evidence behind, the same contract every
 * other verify-ptXX-*.mjs script in this directory follows.
 *
 * Exit 0 = pass, exit 1 = fail (prints the reason).
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TXT_PATH = join(ROOT, "test-evidence", "pt-14", "bundle-scan.txt");
const JSON_PATH = join(ROOT, "test-evidence", "pt-14", "bundle-and-middleware.json");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

// ---- Requirement 1: the bundle scan ran and left real output on disk ----
if (!existsSync(TXT_PATH)) {
  fail(`${TXT_PATH} does not exist. Run scripts/audit/pt14-003-bundle-secret-scan.mjs (against a real \`pnpm run build\` output) first.`);
}
const txtStat = statSync(TXT_PATH);
if (!txtStat.isFile() || txtStat.size === 0) {
  fail(`${TXT_PATH} exists but is empty -- the scan must produce real captured output.`);
}
const txtRaw = readFileSync(TXT_PATH, "utf8");
const REQUIRED_TXT_SECTIONS = ["=== SCOPE ===", "=== KNOWN-VALUE PASS ===", "=== PATTERN PASS ===", "=== JWT ROLE-CLAIM PASS ===", "=== SUMMARY ==="];
const missingTxtSections = REQUIRED_TXT_SECTIONS.filter((s) => !txtRaw.includes(s));
if (missingTxtSections.length > 0) {
  fail(`bundle-scan.txt is missing expected section(s): ${missingTxtSections.join(", ")} -- looks like a stale or hand-written file, not real scan output.`);
}
if (!/TOTAL shipped files scanned:\s+(\d+)/.test(txtRaw)) {
  fail("bundle-scan.txt has no 'TOTAL shipped files scanned' count -- cannot confirm the scan actually walked real build output.");
}
const scannedCountMatch = txtRaw.match(/TOTAL shipped files scanned:\s+(\d+)/);
const scannedCount = scannedCountMatch ? parseInt(scannedCountMatch[1], 10) : 0;
if (scannedCount === 0) {
  fail("bundle-scan.txt reports 0 shipped files scanned -- the build output was empty or the scan didn't run against a real build.");
}
if (!/VERDICT: (PASS|FAIL)/.test(txtRaw)) {
  fail("bundle-scan.txt has no VERDICT line.");
}

// ---- Requirement 2: bundle-and-middleware.json exists and is well-formed ----
if (!existsSync(JSON_PATH)) {
  fail(`${JSON_PATH} does not exist. Run scripts/audit/pt14-003-combine.mjs after both pt14-003-bundle-secret-scan.mjs and pt14-003-middleware-review.mjs.`);
}
let combined;
try {
  combined = JSON.parse(readFileSync(JSON_PATH, "utf8"));
} catch (err) {
  fail(`bundle-and-middleware.json is not valid JSON: ${err.message}`);
}
if (!combined || typeof combined !== "object") fail("bundle-and-middleware.json root is not an object.");

const { bundleSecretScan, middlewareReview, overallVerdict, p0Findings } = combined;
if (!bundleSecretScan || typeof bundleSecretScan !== "object") fail("bundle-and-middleware.json missing bundleSecretScan.");
if (!middlewareReview || typeof middlewareReview !== "object") fail("bundle-and-middleware.json missing middlewareReview.");
if (typeof overallVerdict !== "string" || overallVerdict.trim().length === 0) fail("bundle-and-middleware.json missing overallVerdict.");
if (!Array.isArray(p0Findings)) fail("bundle-and-middleware.json's p0Findings is not an array.");

// bundleSecretScan section must cross-reference the raw .txt file and carry
// a real summary with the scope counts it claims.
if (bundleSecretScan.rawOutputFile !== "test-evidence/pt-14/bundle-scan.txt") {
  fail("bundleSecretScan.rawOutputFile does not point at test-evidence/pt-14/bundle-scan.txt.");
}
if (!bundleSecretScan.scope || typeof bundleSecretScan.scope.totalShippedFilesScanned !== "number" || bundleSecretScan.scope.totalShippedFilesScanned <= 0) {
  fail("bundleSecretScan.scope.totalShippedFilesScanned is missing or not a positive number.");
}
if (bundleSecretScan.scope.totalShippedFilesScanned !== scannedCount) {
  fail(`bundleSecretScan.scope.totalShippedFilesScanned (${bundleSecretScan.scope.totalShippedFilesScanned}) does not match the count recorded in bundle-scan.txt (${scannedCount}) -- the JSON summary and the raw scan output have drifted apart.`);
}
if (!bundleSecretScan.summary || typeof bundleSecretScan.summary.p0Count !== "number" || typeof bundleSecretScan.summary.verdict !== "string") {
  fail("bundleSecretScan.summary is missing p0Count or verdict.");
}
if (!Array.isArray(bundleSecretScan.knownValuePass?.secretsChecked) || bundleSecretScan.knownValuePass.secretsChecked.length === 0) {
  fail("bundleSecretScan.knownValuePass.secretsChecked is empty -- the known-value pass must have checked at least one real secret from .env.local, or explicitly recorded that none were available.");
}

// ---- Requirement 3: the middleware review is recorded with a REAL prod probe ----
const { wgr023Disposition, liveProdProbes, matcherGapCheck } = middlewareReview;
if (!wgr023Disposition || typeof wgr023Disposition.result !== "string" || wgr023Disposition.result.trim().length === 0) {
  fail("middlewareReview.wgr023Disposition.result is missing -- the WGR-023 disposition must be explicitly recorded.");
}
if (!Array.isArray(liveProdProbes) || liveProdProbes.length === 0) {
  fail("middlewareReview.liveProdProbes is empty -- the task requires confirming WGR-023's disposition with a real prod probe, not just re-reading prior evidence.");
}
const probesMissingFields = liveProdProbes.filter(
  (p) => typeof p.url !== "string" || typeof p.httpStatus !== "number" || typeof p.method !== "string",
);
if (probesMissingFields.length > 0) {
  fail(`${probesMissingFields.length} liveProdProbes entries are missing url/httpStatus/method -- these must be real, structured probe results.`);
}
const nonProdProbes = liveProdProbes.filter((p) => !p.url.includes("benavora.com"));
if (nonProdProbes.length > 0) {
  fail(`${nonProdProbes.length} liveProdProbes entries do not target a benavora.com URL -- the task requires a real PRODUCTION probe, not a local dev server.`);
}
// Confirm at least one probe actually targets a real vercel.json cron
// schedule entry (not just an arbitrary API route) and at least one targets
// a webhook route -- this is the specific WGR-023 claim being re-tested.
const hasCronProbe = liveProdProbes.some((p) => p.url.includes("/api/cron/"));
const hasWebhookProbe = liveProdProbes.some((p) => p.url.includes("/api/webhooks/"));
if (!hasCronProbe) fail("No liveProdProbes entry targets a /api/cron/* route -- WGR-023's core claim (cron routes) was not actually probed.");
if (!hasWebhookProbe) fail("No liveProdProbes entry targets a /api/webhooks/* route -- WGR-023's core claim (webhook routes) was not actually probed.");

if (!matcherGapCheck || typeof matcherGapCheck.verdict !== "string") {
  fail("middlewareReview.matcherGapCheck.verdict is missing -- the matcher/exemption-list bypass review must be recorded.");
}
const VALID_MATCHER_VERDICTS = new Set(["NO_BYPASS_GAP_FOUND", "REVIEW_REQUIRED_SOURCE_DRIFTED"]);
if (!VALID_MATCHER_VERDICTS.has(matcherGapCheck.verdict)) {
  fail(`matcherGapCheck.verdict "${matcherGapCheck.verdict}" is outside the known set: ${[...VALID_MATCHER_VERDICTS].join(", ")}`);
}
if (!Array.isArray(matcherGapCheck.publicPathsInSourceRightNow) || matcherGapCheck.publicPathsInSourceRightNow.length === 0) {
  fail("matcherGapCheck.publicPathsInSourceRightNow is empty -- the review must have actually parsed PUBLIC_PATHS out of the live src/middleware.ts, not asserted a verdict without reading the source.");
}

// ---- Requirement 4: overallVerdict is consistent with its inputs, not hand-set ----
const expectedOverall =
  bundleSecretScan.summary.verdict === "PASS" && matcherGapCheck.verdict === "NO_BYPASS_GAP_FOUND"
    ? "PASS"
    : "REVIEW_REQUIRED";
if (overallVerdict !== expectedOverall) {
  fail(`overallVerdict is "${overallVerdict}" but recomputing from bundleSecretScan.summary.verdict + matcherGapCheck.verdict gives "${expectedOverall}" -- looks hand-edited/drifted.`);
}

console.log(`PASS: bundle scan ran for real (${scannedCount} shipped files scanned, ${bundleSecretScan.summary.p0Count} P0 secret finding(s)) and the middleware review is recorded with ${liveProdProbes.length} real production probe(s) (cron + webhook both covered) and a completed matcher-gap check (${matcherGapCheck.verdict}).`);
console.log(`  Bundle scan verdict: ${bundleSecretScan.summary.verdict}`);
console.log(`  WGR-023 disposition severity: ${wgr023Disposition.severity ?? "(not set)"}`);
console.log(`  Overall verdict: ${overallVerdict}`);
console.log(`  P0 findings recorded: ${p0Findings.length}`);
process.exit(0);
