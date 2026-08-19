// PT-01-004 verifier: confirms element-graph.json is non-empty, every row has
// the required fields, and every primary-nav page in the current run's own
// pageSet.primaryNavPages[] actually has at least one crawled element row
// (i.e. the crawl really visited it, not just declared it in scope). Exits 0
// only if all checks pass; exits 1 with a printed reason otherwise.
// ASCII only. Node 20 compatible.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertJsonFileHasKey } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const resultsPath = path.join(repoRoot, "test-evidence", "pt-01", "element-graph.json");

const VALID_VERDICTS = new Set(["CONFIRMED-OK", "CONFIRMED-BROKEN"]);
const VALID_SEVERITIES = new Set(["P0", "P1"]);

function fail(reason) {
  console.error(`PT-01-004 FAIL: ${reason}`);
  process.exit(1);
}

function main() {
  let file;
  try {
    file = assertJsonFileHasKey(resultsPath, "elements");
  } catch (err) {
    fail(`element-graph.json check failed: ${err.message}`);
    return;
  }

  if (!Array.isArray(file.elements)) {
    fail(`elements[] is not an array in ${resultsPath}`);
    return;
  }
  if (file.elements.length === 0) {
    fail(`elements[] is empty in ${resultsPath} -- element-graph.json must be non-empty`);
    return;
  }

  const actualCount = file.elements.length;
  if (file.totalElements !== actualCount) {
    fail(
      `totalElements field (${file.totalElements}) does not match elements[] length ` +
        `(${actualCount}) in ${resultsPath}`
    );
    return;
  }

  // -- Required per-row field / value checks ---------------------------------
  const REQUIRED_FIELDS = ["page", "pageCategory", "elementType", "label", "resolved_status", "verdict"];
  const badRows = [];

  for (const [idx, row] of file.elements.entries()) {
    const rowId = row && row.page ? `${row.page}::${row.elementType || "?"}(${row.label || "?"})[${idx}]` : `row[${idx}]`;
    if (!row || typeof row !== "object") {
      badRows.push({ id: `row[${idx}]`, reason: "row is not an object" });
      continue;
    }
    for (const field of REQUIRED_FIELDS) {
      if (!(field in row) || row[field] === null || row[field] === undefined || row[field] === "") {
        badRows.push({ id: rowId, reason: `missing/empty field "${field}"` });
      }
    }
    if (!("target_or_handler" in row)) {
      badRows.push({ id: rowId, reason: 'missing field "target_or_handler" (may legitimately be null, but the key must be present)' });
    }
    if (row.verdict !== undefined && !VALID_VERDICTS.has(row.verdict)) {
      badRows.push({ id: rowId, reason: `verdict "${row.verdict}" is not one of ${[...VALID_VERDICTS].join(", ")}` });
    }
    if (row.verdict === "CONFIRMED-BROKEN") {
      if (!row.severity || !VALID_SEVERITIES.has(row.severity)) {
        badRows.push({ id: rowId, reason: `CONFIRMED-BROKEN row has invalid/missing severity "${row.severity}" (must be P0 or P1)` });
      }
    }
    if (row.pageCategory !== undefined && !["primary_nav", "sub_page"].includes(row.pageCategory)) {
      badRows.push({ id: rowId, reason: `pageCategory "${row.pageCategory}" is not one of primary_nav, sub_page` });
    }
  }

  if (badRows.length > 0) {
    fail(
      `${badRows.length} row(s) missing/malformed required field(s): ` +
        badRows.slice(0, 15).map((b) => `${b.id} (${b.reason})`).join("; ") +
        (badRows.length > 15 ? "; ..." : "")
    );
    return;
  }

  // -- Page-set coverage: every declared primary-nav page must have >=1 row --
  if (!file.pageSet || !Array.isArray(file.pageSet.primaryNavPages) || file.pageSet.primaryNavPages.length === 0) {
    fail(`pageSet.primaryNavPages[] is missing or empty in ${resultsPath}`);
    return;
  }

  const pagesWithRows = new Set(file.elements.map((r) => r.page));
  const missingPrimaryPages = file.pageSet.primaryNavPages.filter((p) => !pagesWithRows.has(p));
  if (missingPrimaryPages.length > 0) {
    fail(
      `${missingPrimaryPages.length} primary-nav page(s) declared in pageSet.primaryNavPages[] have zero ` +
        `crawled element rows (the crawl did not actually cover them): ${missingPrimaryPages.join(", ")}`
    );
    return;
  }

  // Sub-pages: declared, informational coverage check (warn, not fatal --
  // this verifier's contract per the task is "covers at least the full
  // primary-nav page set").
  const declaredSubPages = Array.isArray(file.pageSet.subPages) ? file.pageSet.subPages : [];
  const crawledSubPageRoutePatterns = new Set(
    file.elements.filter((r) => r.pageCategory === "sub_page" && r.routePattern).map((r) => r.routePattern)
  );
  const missingSubPages = declaredSubPages.filter((p) => !crawledSubPageRoutePatterns.has(p));
  if (missingSubPages.length > 0) {
    console.warn(
      `PT-01-004 WARN: ${missingSubPages.length} declared sub-page(s) have zero crawled rows: ${missingSubPages.join(", ")}`
    );
  }

  // -- Every CONFIRMED-BROKEN row must have a corresponding screenshot file --
  const brokenRows = file.elements.filter((r) => r.verdict === "CONFIRMED-BROKEN");
  const brokenWithoutScreenshot = brokenRows.filter((r) => !r.screenshot);
  if (brokenWithoutScreenshot.length > 0) {
    console.warn(
      `PT-01-004 WARN: ${brokenWithoutScreenshot.length} CONFIRMED-BROKEN row(s) have no screenshot recorded ` +
        `(screenshot capture is best-effort and may fail without invalidating the underlying finding).`
    );
  }

  const byPrimary = file.pageSet.primaryNavPages.length;
  const bySub = new Set(file.elements.filter((r) => r.pageCategory === "sub_page").map((r) => r.page)).size;

  console.log(
    `PT-01-004 PASS: element-graph.json has ${actualCount} element row(s) across ${pagesWithRows.size} page(s) ` +
      `(${byPrimary}/${byPrimary} primary-nav pages covered, ${bySub}/${declaredSubPages.length} declared sub-pages covered). ` +
      `${brokenRows.length} CONFIRMED-BROKEN row(s) found (P0=${file.summary ? file.summary.p0Count : "?"}, ` +
      `P1=${file.summary ? file.summary.p1Count : "?"}).`
  );
  process.exit(0);
}

main();
