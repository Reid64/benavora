#!/usr/bin/env node
/**
 * PT-14-003: combine the bundle-secret-scan summary and the
 * middleware-review summary into test-evidence/pt-14/bundle-and-middleware.json.
 * Run after both pt14-003-bundle-secret-scan.mjs and
 * pt14-003-middleware-review.mjs have produced their intermediate summary
 * files.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "test-evidence", "pt-14");
const BUNDLE_SUMMARY_PATH = join(OUT_DIR, "_bundle-scan-summary.json");
const MIDDLEWARE_SUMMARY_PATH = join(OUT_DIR, "_middleware-review-summary.json");
const FINAL_PATH = join(OUT_DIR, "bundle-and-middleware.json");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(BUNDLE_SUMMARY_PATH)) fail(`${BUNDLE_SUMMARY_PATH} missing -- run pt14-003-bundle-secret-scan.mjs first.`);
if (!existsSync(MIDDLEWARE_SUMMARY_PATH)) fail(`${MIDDLEWARE_SUMMARY_PATH} missing -- run pt14-003-middleware-review.mjs first.`);

const bundleScan = JSON.parse(readFileSync(BUNDLE_SUMMARY_PATH, "utf8"));
const middlewareReview = JSON.parse(readFileSync(MIDDLEWARE_SUMMARY_PATH, "utf8"));

const combined = {
  task: "PT-14-003: client-bundle secret scan + middleware review",
  generatedAt: new Date().toISOString(),
  bundleSecretScan: {
    rawOutputFile: "test-evidence/pt-14/bundle-scan.txt",
    ...bundleScan,
  },
  middlewareReview,
  overallVerdict:
    bundleScan.summary.verdict === "PASS" && middlewareReview.matcherGapCheck.verdict === "NO_BYPASS_GAP_FOUND"
      ? "PASS"
      : "REVIEW_REQUIRED",
  p0Findings: [
    ...bundleScan.summary.p0Count > 0
      ? [`${bundleScan.summary.p0Count} P0 secret(s) confirmed present in the shipped client bundle -- see bundleSecretScan for detail.`]
      : [],
    ...(middlewareReview.wgr023Disposition.severity.startsWith("P0")
      ? [`WGR-023 (middleware over-broadly redirects cron/webhook/bootstrap/unsubscribe routes to /login before their own auth check runs) reconfirmed live in production -- see middlewareReview.wgr023Disposition. Not an auth-bypass; a functional-automation risk, already tracked in the Wiring Gap Register.`]
      : []),
  ],
};

writeFileSync(FINAL_PATH, JSON.stringify(combined, null, 2), "utf8");
console.log(`Combined summary written: ${FINAL_PATH}`);
console.log(`Overall verdict: ${combined.overallVerdict}`);
console.log(`P0 findings recorded: ${combined.p0Findings.length}`);
process.exit(0);
