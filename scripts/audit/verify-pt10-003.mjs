#!/usr/bin/env node
// ============================================================================
// PT-10-003 verifier — Phase 10 consolidation / human review checkpoint
//
// Confirms the two consolidation documents this phase produces are real,
// non-empty deliverables, and that WIRING_GAP_REGISTER.md has actually grown
// beyond the pre-consolidation state (WGR-122, the last row filed before this
// pass) with this consolidation's new PT-10-002 findings (WGR-123 through
// WGR-128), not just left at the state the prior PT-10-001/002 sessions
// closed with.
//
// Exits non-zero unless:
//   1. test-evidence/pt-10/PHASE-10-SUMMARY.md exists and is non-empty.
//   2. test-evidence/pt-10/REVIEW-PACK.md exists and is non-empty.
//   3. test-evidence/_register/WIRING_GAP_REGISTER.md exists, is non-empty,
//      contains the WGR-122 row (the last row before this consolidation) and
//      all of WGR-123..WGR-128 (this consolidation's new findings) -- proving
//      the register has moved past its pre-consolidation state with real
//      PT-10-003 findings, not just a partial or malformed append.
//   4. The register's total WGR row count is at least 1 greater than the
//      count of rows that exist through WGR-122 plus this pass's new rows --
//      catches a silent partial append or an accidental duplicate/overwrite
//      (i.e. "register grew", not just "register unchanged").
//   5. Both consolidation docs reference the phase's real evidence (the
//      malformed-payloads.json / outage-simulation.json finding counts and at
//      least one specific WGR id each) so a stripped-down or copy-pasted
//      rewrite doesn't silently pass.
//
// Usage: node scripts/audit/verify-pt10-003.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFileExistsNonEmpty } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const summaryPath = path.join(repoRoot, "test-evidence", "pt-10", "PHASE-10-SUMMARY.md");
const reviewPackPath = path.join(repoRoot, "test-evidence", "pt-10", "REVIEW-PACK.md");
const registerPath = path.join(repoRoot, "test-evidence", "_register", "WIRING_GAP_REGISTER.md");

const PREV_LAST_ROW = "WGR-122";
const PT10_003_NEW_ROWS = ["WGR-123", "WGR-124", "WGR-125", "WGR-126", "WGR-127", "WGR-128"];

let failed = false;
function fail(reason) {
  console.error(`PT-10-003 FAIL: ${reason}`);
  failed = true;
}

function main() {
  try {
    assertFileExistsNonEmpty(summaryPath);
  } catch (err) {
    fail(`PHASE-10-SUMMARY.md check failed: ${err.message}`);
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

  let preCountRows = 0;
  let postCountRows = 0;

  if (registerContents !== undefined) {
    if (!new RegExp(`\\|\\s*${PREV_LAST_ROW}\\s*\\|`).test(registerContents)) {
      fail(
        `WIRING_GAP_REGISTER.md does not contain a ${PREV_LAST_ROW} row -- the last row before ` +
          "this consolidation's new findings is missing, which means the register this phase is " +
          "checking is not the one PT-10-003 grew from."
      );
    }

    const missingRows = PT10_003_NEW_ROWS.filter(
      (id) => !new RegExp(`\\|\\s*${id}\\s*\\|`).test(registerContents)
    );
    if (missingRows.length > 0) {
      fail(
        `WIRING_GAP_REGISTER.md is missing ${missingRows.length} of this consolidation's new ` +
          `finding(s): ${missingRows.join(", ")} -- the register has not fully grown beyond the ` +
          `pre-consolidation state (${PREV_LAST_ROW}).`
      );
    }

    // Register has actually grown: total WGR row count must be at least
    // (index of PREV_LAST_ROW) + (count of this pass's new rows).
    const allRowMatches = registerContents.match(/^\|\s*WGR-\d+\s*\|/gm) || [];
    const prevIndexMatch = PREV_LAST_ROW.match(/WGR-(\d+)/);
    const prevIndex = prevIndexMatch ? parseInt(prevIndexMatch[1], 10) : 0;
    preCountRows = prevIndex;
    postCountRows = allRowMatches.length;
    if (allRowMatches.length < prevIndex + PT10_003_NEW_ROWS.length) {
      fail(
        `WIRING_GAP_REGISTER.md has only ${allRowMatches.length} total WGR rows -- expected at ` +
          `least ${prevIndex + PT10_003_NEW_ROWS.length} (${prevIndex} rows through ` +
          `${PREV_LAST_ROW} plus this consolidation's ${PT10_003_NEW_ROWS.length} new row(s)). A ` +
          "row may have been dropped, duplicated, or malformed during the append -- the register " +
          "did not actually grow."
      );
    }
  }

  // Both consolidation docs must actually mention this phase's real finding
  // counts / anchor WGR ids so a stripped-down or copy-pasted rewrite doesn't
  // silently pass.
  if (fs.existsSync(summaryPath)) {
    const summaryText = fs.readFileSync(summaryPath, "utf8");
    if (!/WGR-125/.test(summaryText) || !/WGR-124/.test(summaryText)) {
      fail(
        "PHASE-10-SUMMARY.md does not reference both WGR-124 and WGR-125 (the phase's two most " +
          "load-bearing findings from PT-10-002) -- looks incomplete or stale relative to the real " +
          "register."
      );
    }
    if (!/WGR-121/.test(summaryText) || !/WGR-122/.test(summaryText)) {
      fail(
        "PHASE-10-SUMMARY.md does not reference PT-10-001's own findings (WGR-121/WGR-122) -- must " +
          "consolidate both sub-passes, not just the newly-registered one."
      );
    }
    if (!/\b16\b/.test(summaryText) || !/\b5\b/.test(summaryText)) {
      fail(
        "PHASE-10-SUMMARY.md does not appear to cite the real finding counts (16 from PT-10-001, " +
          "5 from PT-10-002) anywhere -- looks like it may not have transcribed the real evidence " +
          "file numbers."
      );
    }
  }
  if (fs.existsSync(reviewPackPath)) {
    const reviewText = fs.readFileSync(reviewPackPath, "utf8");
    if (!/stuck|stranded|permanent/i.test(reviewText)) {
      fail(
        "REVIEW-PACK.md does not mention the permanently-stuck-queue-row finding (WGR-125, this " +
          "phase's most severe result) in plain language -- the task requires the review pack to " +
          "state the highest-severity finding plainly."
      );
    }
    if (!/WGR-/.test(reviewText)) {
      fail("REVIEW-PACK.md does not cite any WGR id -- must be traceable back to the register.");
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log(
    "PT-10-003 PASS: PHASE-10-SUMMARY.md present, REVIEW-PACK.md present, " +
      `WIRING_GAP_REGISTER.md has grown beyond the pre-consolidation state (${PREV_LAST_ROW} ` +
      `present, ${PT10_003_NEW_ROWS.join(", ")} present). ` +
      `Register row count: ${postCountRows} (was ${preCountRows} rows through ${PREV_LAST_ROW}).`
  );
  process.exit(0);
}

main();
