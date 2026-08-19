// PT-01-002 verifier: confirms render-results.json covers every route in
// page-routes.json (exact count match) and that every row has all four
// required render-verdict fields populated (httpStatus, errorBoundaryInDom,
// hasRealContent, consoleErrors -- the fields the task itself named:
// "(a) final HTTP status, (b) whether an error-boundary/500 component is in
// the DOM, (c) whether the page has real content vs an empty shell,
// (d) console errors"). Exits 0 only if all checks pass; exits 1 with a
// printed reason otherwise. ASCII only. Node 20 compatible.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertJsonFileHasKey } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const pageRoutesPath = path.join(repoRoot, "test-evidence", "pt-01", "page-routes.json");
const resultsPath = path.join(repoRoot, "test-evidence", "pt-01", "render-results.json");

function fail(reason) {
  console.error(`PT-01-002 FAIL: ${reason}`);
  process.exit(1);
}

function main() {
  let pageRoutesFile;
  try {
    pageRoutesFile = assertJsonFileHasKey(pageRoutesPath, "pageRoutes");
  } catch (err) {
    fail(`page-routes.json check failed: ${err.message}`);
    return;
  }
  if (!Array.isArray(pageRoutesFile.pageRoutes)) {
    fail(`pageRoutes[] is not an array in ${pageRoutesPath}`);
    return;
  }
  const expectedCount = pageRoutesFile.pageRoutes.length;
  const expectedPaths = new Set(pageRoutesFile.pageRoutes.map((r) => r.path));

  let resultsFile;
  try {
    resultsFile = assertJsonFileHasKey(resultsPath, "results");
  } catch (err) {
    fail(`render-results.json check failed: ${err.message}`);
    return;
  }
  if (!Array.isArray(resultsFile.results)) {
    fail(`results[] is not an array in ${resultsPath}`);
    return;
  }

  const actualCount = resultsFile.results.length;
  if (resultsFile.totalRoutes !== actualCount) {
    fail(
      `totalRoutes field (${resultsFile.totalRoutes}) does not match results[] length ` +
        `(${actualCount}) in ${resultsPath}`
    );
    return;
  }

  if (actualCount !== expectedCount) {
    fail(
      `render-results.json has ${actualCount} row(s), but page-routes.json has ${expectedCount} ` +
        `page route(s) -- counts do not match, routes may have been dropped`
    );
    return;
  }

  // Every route in page-routes.json must have exactly one corresponding row.
  const resultPaths = resultsFile.results.map((r) => r && r.path);
  const resultPathSet = new Set(resultPaths);
  if (resultPathSet.size !== resultPaths.length) {
    fail(`render-results.json has duplicate "path" entries -- ${resultPaths.length} rows but only ${resultPathSet.size} distinct paths`);
    return;
  }
  const missing = [...expectedPaths].filter((p) => !resultPathSet.has(p));
  if (missing.length > 0) {
    fail(`${missing.length} route(s) from page-routes.json have no row in render-results.json: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "..." : ""}`);
    return;
  }

  // Every row must have all four required fields populated (present as a
  // key with the correct type -- httpStatus/errorBoundaryInDom/
  // hasRealContent may legitimately be null/false, but the key itself and
  // consoleErrors (an array) must always be present).
  const REQUIRED_FIELDS = ["httpStatus", "errorBoundaryInDom", "hasRealContent", "consoleErrors"];
  const badRows = [];
  for (const row of resultsFile.results) {
    if (!row || typeof row !== "object") {
      badRows.push({ path: "(unknown)", reason: "row is not an object" });
      continue;
    }
    for (const field of REQUIRED_FIELDS) {
      if (!(field in row)) {
        badRows.push({ path: row.path, reason: `missing field "${field}"` });
      }
    }
    if ("errorBoundaryInDom" in row && typeof row.errorBoundaryInDom !== "boolean") {
      badRows.push({ path: row.path, reason: `errorBoundaryInDom is not boolean (got ${typeof row.errorBoundaryInDom})` });
    }
    if ("hasRealContent" in row && typeof row.hasRealContent !== "boolean") {
      badRows.push({ path: row.path, reason: `hasRealContent is not boolean (got ${typeof row.hasRealContent})` });
    }
    if ("consoleErrors" in row && !Array.isArray(row.consoleErrors)) {
      badRows.push({ path: row.path, reason: `consoleErrors is not an array (got ${typeof row.consoleErrors})` });
    }
    // httpStatus may be null (navigation never completed) or a number -- both are valid "populated" states.
    if ("httpStatus" in row && row.httpStatus !== null && typeof row.httpStatus !== "number") {
      badRows.push({ path: row.path, reason: `httpStatus is neither null nor a number (got ${typeof row.httpStatus})` });
    }
  }

  if (badRows.length > 0) {
    fail(
      `${badRows.length} row(s) missing/malformed required field(s): ` +
        badRows.slice(0, 10).map((b) => `${b.path} (${b.reason})`).join("; ") +
        (badRows.length > 10 ? "; ..." : "")
    );
    return;
  }

  console.log(
    `PT-01-002 PASS: render-results.json covers all ${actualCount} page route(s) from page-routes.json, ` +
      `every row has httpStatus/errorBoundaryInDom/hasRealContent/consoleErrors populated.`
  );
  process.exit(0);
}

main();
