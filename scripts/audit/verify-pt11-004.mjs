#!/usr/bin/env node
// ============================================================================
// PT-11-004 verifier — Phase 11 consolidation / human review checkpoint
//
// Confirms the two consolidation documents this phase produces are real,
// non-empty deliverables, and that WIRING_GAP_REGISTER.md has actually grown
// beyond the last row before this consolidation's own new findings (WGR-094,
// the last row filed during PT-09-004) with real PT-11-004 findings (WGR-095,
// the first row this consolidation pass added), not just left at the state
// PT-09-004 closed with.
//
// Exits non-zero unless:
//   1. test-evidence/pt-11/PHASE-11-SUMMARY.md exists and is non-empty.
//   2. test-evidence/pt-11/REVIEW-PACK.md exists and is non-empty.
//   3. test-evidence/_register/WIRING_GAP_REGISTER.md exists, is non-empty,
//      and contains both a WGR-094 row (the last row before this
//      consolidation) and a WGR-095 row (this consolidation's first new
//      finding) -- proving the register has moved past its pre-consolidation
//      state with real PT-11-004 findings.
//
// Usage: node scripts/audit/verify-pt11-004.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFileExistsNonEmpty } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const summaryPath = path.join(repoRoot, "test-evidence", "pt-11", "PHASE-11-SUMMARY.md");
const reviewPackPath = path.join(repoRoot, "test-evidence", "pt-11", "REVIEW-PACK.md");
const registerPath = path.join(repoRoot, "test-evidence", "_register", "WIRING_GAP_REGISTER.md");

const PREV_LAST_ROW = "WGR-094";
const PT11_004_FIRST_ROW = "WGR-095";

let failed = false;
function fail(reason) {
  console.error(`PT-11-004 FAIL: ${reason}`);
  failed = true;
}

function main() {
  try {
    assertFileExistsNonEmpty(summaryPath);
  } catch (err) {
    fail(`PHASE-11-SUMMARY.md check failed: ${err.message}`);
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
          "checking is not the one PT-11-004 grew from."
      );
    }
    if (!new RegExp(`\\|\\s*${PT11_004_FIRST_ROW}\\s*\\|`).test(registerContents)) {
      fail(
        `WIRING_GAP_REGISTER.md does not contain a ${PT11_004_FIRST_ROW} row -- the register has ` +
          `not grown beyond the pre-consolidation state (${PREV_LAST_ROW}); no PT-11-004 findings ` +
          "are recorded."
      );
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log(
    "PT-11-004 PASS: PHASE-11-SUMMARY.md present, REVIEW-PACK.md present, " +
      `WIRING_GAP_REGISTER.md has grown beyond the pre-consolidation state (${PREV_LAST_ROW} ` +
      `present, ${PT11_004_FIRST_ROW} present).`
  );
  process.exit(0);
}

main();
