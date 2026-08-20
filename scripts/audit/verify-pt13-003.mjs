#!/usr/bin/env node
// ============================================================================
// PT-13-003 verifier — Phase 13 consolidation / human review checkpoint
//
// Confirms the two consolidation documents this phase produces are real,
// non-empty deliverables, and that WIRING_GAP_REGISTER.md has actually grown
// beyond the last row before this consolidation (WGR-100, the last row filed
// during PT-11-004) with all seven of this consolidation's new findings
// (WGR-101 through WGR-107), not just left at the state PT-11-004 closed
// with.
//
// Exits non-zero unless:
//   1. test-evidence/pt-13/PHASE-13-SUMMARY.md exists and is non-empty.
//   2. test-evidence/pt-13/REVIEW-PACK.md exists and is non-empty.
//   3. test-evidence/_register/WIRING_GAP_REGISTER.md exists, is non-empty,
//      contains the WGR-100 row (the last row before this consolidation) and
//      every one of WGR-101 through WGR-107 (this consolidation's new
//      findings) -- proving the register has moved past its
//      pre-consolidation state with real PT-13-003 findings, not just a
//      partial or malformed append.
//   4. The register's total WGR row count is at least 7 greater than the
//      count of rows that exist before WGR-101 -- catches a silent partial
//      append or an accidental duplicate/overwrite.
//
// Usage: node scripts/audit/verify-pt13-003.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFileExistsNonEmpty } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const summaryPath = path.join(repoRoot, "test-evidence", "pt-13", "PHASE-13-SUMMARY.md");
const reviewPackPath = path.join(repoRoot, "test-evidence", "pt-13", "REVIEW-PACK.md");
const registerPath = path.join(repoRoot, "test-evidence", "_register", "WIRING_GAP_REGISTER.md");

const PREV_LAST_ROW = "WGR-100";
const PT13_003_NEW_ROWS = [
  "WGR-101",
  "WGR-102",
  "WGR-103",
  "WGR-104",
  "WGR-105",
  "WGR-106",
  "WGR-107",
];

let failed = false;
function fail(reason) {
  console.error(`PT-13-003 FAIL: ${reason}`);
  failed = true;
}

function main() {
  try {
    assertFileExistsNonEmpty(summaryPath);
  } catch (err) {
    fail(`PHASE-13-SUMMARY.md check failed: ${err.message}`);
  }

  try {
    assertFileExistsNonEmpty(reviewPackPath);
  } catch (err) {
    fail(`REVIEW-PACK.md check failed: ${err.message}`);
  }

  let registerContents;
  try {
    assertFileExistsNonEmpty(registerPath);
    registerContents = fs.readFileSync(registerPath, "utf8");
  } catch (err) {
    fail(`WIRING_GAP_REGISTER.md check failed: ${err.message}`);
  }

  if (registerContents !== undefined) {
    if (!new RegExp(`\\|\\s*${PREV_LAST_ROW}\\s*\\|`).test(registerContents)) {
      fail(
        `WIRING_GAP_REGISTER.md does not contain a ${PREV_LAST_ROW} row -- the last row before ` +
          "this consolidation's new findings is missing, which means the register this phase is " +
          "checking is not the one PT-13-003 grew from."
      );
    }

    const missingRows = PT13_003_NEW_ROWS.filter(
      (id) => !new RegExp(`\\|\\s*${id}\\s*\\|`).test(registerContents)
    );
    if (missingRows.length > 0) {
      fail(
        `WIRING_GAP_REGISTER.md is missing ${missingRows.length} of this consolidation's new ` +
          `findings: ${missingRows.join(", ")} -- the register has not fully grown beyond the ` +
          `pre-consolidation state (${PREV_LAST_ROW}).`
      );
    }

    // Count total WGR rows to catch a silent partial/duplicate append.
    const allRowMatches = registerContents.match(/^\|\s*WGR-\d+\s*\|/gm) || [];
    const prevIndexMatch = PREV_LAST_ROW.match(/WGR-(\d+)/);
    const prevIndex = prevIndexMatch ? parseInt(prevIndexMatch[1], 10) : 0;
    if (allRowMatches.length < prevIndex + PT13_003_NEW_ROWS.length) {
      fail(
        `WIRING_GAP_REGISTER.md has only ${allRowMatches.length} total WGR rows -- expected at ` +
          `least ${prevIndex + PT13_003_NEW_ROWS.length} (${prevIndex} rows through ${PREV_LAST_ROW} ` +
          `plus this consolidation's ${PT13_003_NEW_ROWS.length} new rows). A row may have been ` +
          "dropped, duplicated, or malformed during the append."
      );
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log(
    "PT-13-003 PASS: PHASE-13-SUMMARY.md present, REVIEW-PACK.md present, " +
      `WIRING_GAP_REGISTER.md has grown beyond the pre-consolidation state (${PREV_LAST_ROW} ` +
      `present, all of ${PT13_003_NEW_ROWS.join(", ")} present).`
  );
  process.exit(0);
}

main();
