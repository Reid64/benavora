#!/usr/bin/env node
// ============================================================================
// PT-14-004 verifier — Phase 14 consolidation / human review checkpoint
//
// Confirms the two consolidation documents this phase produces are real,
// non-empty deliverables, and that WIRING_GAP_REGISTER.md has actually grown
// beyond the last row before this consolidation (WGR-119, the last row filed
// during PT-14-005) with this consolidation's new finding (WGR-120), not just
// left at the state PT-14-005 closed with.
//
// Exits non-zero unless:
//   1. test-evidence/pt-14/PHASE-14-SUMMARY.md exists and is non-empty.
//   2. test-evidence/pt-14/REVIEW-PACK.md exists and is non-empty.
//   3. test-evidence/_register/WIRING_GAP_REGISTER.md exists, is non-empty,
//      contains the WGR-119 row (the last row before this consolidation) and
//      WGR-120 (this consolidation's new finding) -- proving the register
//      has moved past its pre-consolidation state with a real PT-14-004
//      finding, not just a partial or malformed append.
//   4. The register's total WGR row count is at least 1 greater than the
//      count of rows that exist through WGR-119 -- catches a silent partial
//      append or an accidental duplicate/overwrite (i.e. "register grew").
//
// Usage: node scripts/audit/verify-pt14-004.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFileExistsNonEmpty } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const summaryPath = path.join(repoRoot, "test-evidence", "pt-14", "PHASE-14-SUMMARY.md");
const reviewPackPath = path.join(repoRoot, "test-evidence", "pt-14", "REVIEW-PACK.md");
const registerPath = path.join(repoRoot, "test-evidence", "_register", "WIRING_GAP_REGISTER.md");

const PREV_LAST_ROW = "WGR-119";
const PT14_004_NEW_ROWS = ["WGR-120"];

let failed = false;
function fail(reason) {
  console.error(`PT-14-004 FAIL: ${reason}`);
  failed = true;
}

function main() {
  try {
    assertFileExistsNonEmpty(summaryPath);
  } catch (err) {
    fail(`PHASE-14-SUMMARY.md check failed: ${err.message}`);
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
          "this consolidation's new finding is missing, which means the register this phase is " +
          "checking is not the one PT-14-004 grew from."
      );
    }

    const missingRows = PT14_004_NEW_ROWS.filter(
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
    if (allRowMatches.length < prevIndex + PT14_004_NEW_ROWS.length) {
      fail(
        `WIRING_GAP_REGISTER.md has only ${allRowMatches.length} total WGR rows -- expected at ` +
          `least ${prevIndex + PT14_004_NEW_ROWS.length} (${prevIndex} rows through ` +
          `${PREV_LAST_ROW} plus this consolidation's ${PT14_004_NEW_ROWS.length} new row). A row ` +
          "may have been dropped, duplicated, or malformed during the append -- the register did " +
          "not actually grow."
      );
    }

    // WGR-023 (the middleware finding this consolidation re-confirmed in
    // production and updated in place) must carry this pass's confirmation
    // note, not just still read as pre-PT-14 local-dev-only evidence.
    const wgr023Match = registerContents.match(/^\|\s*WGR-023\s*\|.*$/m);
    if (!wgr023Match) {
      fail("WIRING_GAP_REGISTER.md is missing its WGR-023 row entirely.");
    } else if (!/PT-14-003/.test(wgr023Match[0])) {
      fail(
        "WGR-023's row does not reference PT-14-003's live-production confirmation update -- the " +
          "consolidation must confirm (not just leave stale) this finding's disposition, not only " +
          "add a new row."
      );
    }
  }

  // Both consolidation docs must actually mention the phase's real P0 count
  // (4) so a stripped-down or copy-pasted rewrite doesn't silently pass.
  if (fs.existsSync(summaryPath)) {
    const summaryText = fs.readFileSync(summaryPath, "utf8");
    if (!/WGR-108/.test(summaryText) || !/WGR-111/.test(summaryText)) {
      fail(
        "PHASE-14-SUMMARY.md does not reference both WGR-108 and WGR-111 (the phase's two most " +
          "load-bearing P0 findings) -- looks incomplete or stale relative to the real register."
      );
    }
    if (!/WGR-120/.test(summaryText)) {
      fail("PHASE-14-SUMMARY.md does not reference this consolidation's new finding, WGR-120.");
    }
  }
  if (fs.existsSync(reviewPackPath)) {
    const reviewText = fs.readFileSync(reviewPackPath, "utf8");
    if (!/secret/i.test(reviewText)) {
      fail(
        "REVIEW-PACK.md does not mention secrets/secret-leak status -- the task requires the " +
          "review pack to state the bundle-scan secret-leak status in plain terms."
      );
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log(
    "PT-14-004 PASS: PHASE-14-SUMMARY.md present, REVIEW-PACK.md present, " +
      `WIRING_GAP_REGISTER.md has grown beyond the pre-consolidation state (${PREV_LAST_ROW} ` +
      `present, ${PT14_004_NEW_ROWS.join(", ")} present, WGR-023 confirmed/updated). ` +
      `Register row count: ${postCountRows} (was ${preCountRows} rows through ${PREV_LAST_ROW}).`
  );
  process.exit(0);
}

main();
