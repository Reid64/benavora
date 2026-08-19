#!/usr/bin/env node
// ============================================================================
// PT-00-005 verifier — authenticated smoke suite coverage + structural check
//
// Exits non-zero unless:
//   1. test-evidence/pt-00/smoke-results.json exists, is non-empty, parses.
//   2. its "results" array is present and non-empty.
//   3. every route in test-evidence/pt-00/route-manifest.json has a
//      corresponding row in smoke-results.json matching on BOTH path and
//      type -- a raw count match alone proves nothing (it would pass even if
//      a route were silently dropped and a duplicate substituted in its
//      place), so this walks the full manifest set and confirms coverage
//      route-by-route, not just totalRoutes === routes.length.
//   4. every result row has the required fields (path, type, status,
//      rendered_ok, error) with sane types.
//   5. no result row is a duplicate of another (same path+type twice would
//      also let a real route silently go untested while still passing a
//      naive count check).
//
// Usage: node scripts/audit/verify-pt00-005.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");
const manifestPath = path.join(repoRoot, "test-evidence", "pt-00", "route-manifest.json");
const resultsPath = path.join(repoRoot, "test-evidence", "pt-00", "smoke-results.json");

let failed = false;
function fail(reason) {
  console.error(`PT-00-005 FAIL: ${reason}`);
  failed = true;
}

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`${label} does not exist at ${filePath}`);
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  if (raw.trim().length === 0) {
    fail(`${label} is empty`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`${label} is not valid JSON: ${err.message}`);
    return null;
  }
}

function main() {
  const manifest = readJson(manifestPath, "route-manifest.json");
  const smoke = readJson(resultsPath, "smoke-results.json");
  if (!manifest || !smoke) {
    console.error("PT-00-005 FAIL: cannot proceed without both files parsing.");
    process.exit(1);
  }

  if (!Array.isArray(manifest.routes) || manifest.routes.length === 0) {
    fail('route-manifest.json "routes" must be a non-empty array');
    process.exit(1);
  }
  if (!Array.isArray(smoke.results) || smoke.results.length === 0) {
    fail('smoke-results.json "results" must be a non-empty array');
    process.exit(1);
  }

  // --- structural check on every result row ---
  const REQUIRED_FIELDS = ["path", "type", "status", "rendered_ok", "error"];
  const seen = new Map(); // "type::path" -> count
  for (const [i, row] of smoke.results.entries()) {
    for (const field of REQUIRED_FIELDS) {
      if (!(field in row)) {
        fail(`results[${i}] (path=${row.path ?? "?"}) is missing required field "${field}"`);
      }
    }
    if (row.type !== "page" && row.type !== "api") {
      fail(`results[${i}].type must be "page" or "api", got ${JSON.stringify(row.type)}`);
    }
    if (typeof row.rendered_ok !== "boolean") {
      fail(`results[${i}] (path=${row.path}) .rendered_ok must be boolean, got ${typeof row.rendered_ok}`);
    }
    if (row.status !== null && typeof row.status !== "number") {
      fail(`results[${i}] (path=${row.path}) .status must be a number or null, got ${typeof row.status}`);
    }
    const key = `${row.type}::${row.path}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }

  const duplicates = [...seen.entries()].filter(([, count]) => count > 1);
  if (duplicates.length > 0) {
    fail(
      `${duplicates.length} duplicate result row(s) found -- a duplicate could mask a dropped route ` +
        `while still passing a raw count check: ${duplicates.map(([k, c]) => `${k} (x${c})`).join(", ")}`
    );
  }

  // --- coverage check: every manifest route has exactly one matching result row ---
  const missing = [];
  for (const route of manifest.routes) {
    const key = `${route.type}::${route.path}`;
    if (!seen.has(key)) missing.push(key);
  }
  if (missing.length > 0) {
    fail(
      `${missing.length} route(s) from route-manifest.json have NO corresponding row in ` +
        `smoke-results.json: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? ", ..." : ""}`
    );
  }

  // --- extra rows not in the manifest are not a failure on their own, but flag them ---
  const manifestKeys = new Set(manifest.routes.map((r) => `${r.type}::${r.path}`));
  const extras = [...seen.keys()].filter((k) => !manifestKeys.has(k));
  if (extras.length > 0) {
    console.warn(
      `PT-00-005 WARN: ${extras.length} result row(s) do not correspond to any manifest route ` +
        `(not a failure, but worth checking): ${extras.slice(0, 10).join(", ")}`
    );
  }

  if (failed) {
    console.error(
      `\nPT-00-005 FAIL: manifest has ${manifest.routes.length} routes, smoke-results.json has ` +
        `${smoke.results.length} rows (${seen.size} unique) -- coverage/structural check did not pass.`
    );
    process.exit(1);
  }

  // --- summarize findings (informational only -- this script verifies coverage/structure, ---
  // --- not that every route passed; findings themselves are recorded, not gated, here) ---
  const notRendered = smoke.results.filter((r) => r.rendered_ok !== true);
  const hardFailures = smoke.results.filter(
    (r) =>
      (typeof r.status === "number" && r.status >= 500) ||
      (typeof r.error === "string" && /white screen|500|internal server error/i.test(r.error))
  );

  console.log(
    `PT-00-005 PASS: ${manifest.routes.length}/${manifest.routes.length} manifest routes covered ` +
      `(${smoke.results.filter((r) => r.type === "page").length} page, ` +
      `${smoke.results.filter((r) => r.type === "api").length} api), zero duplicates, zero missing.`
  );
  console.log(
    `  ${notRendered.length} route(s) not rendered_ok, ${hardFailures.length} hard 500/white-screen finding(s).`
  );
  if (hardFailures.length > 0) {
    console.log("  Hard findings:");
    for (const f of hardFailures) {
      console.log(`    [${f.type}] ${f.path} -> status=${f.status} error=${f.error}`);
    }
  }
  process.exit(0);
}

main();
