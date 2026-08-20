#!/usr/bin/env node
// ============================================================================
// PT-09-004 verifier — Phase 09 consolidation / human review checkpoint
//
// Confirms the two consolidation documents this phase produces are real,
// non-empty deliverables, and that WIRING_GAP_REGISTER.md has actually grown
// beyond the last row before this consolidation's own new findings (WGR-089,
// the last row filed during PT-09-002/PT-09-003 execution proof) with real
// PT-09-004 findings (WGR-090, the first row this consolidation pass added),
// not just left at the state PT-09-003 closed with.
//
// Exits non-zero unless:
//   1. test-evidence/pt-09/PHASE-09-SUMMARY.md exists and is non-empty.
//   2. test-evidence/pt-09/REVIEW-PACK.md exists and is non-empty.
//   3. test-evidence/_register/WIRING_GAP_REGISTER.md exists, is non-empty,
//      and contains both a WGR-089 row (the last row before this
//      consolidation) and a WGR-090 row (this consolidation's first new
//      finding) -- proving the register has moved past its pre-consolidation
//      state with real PT-09-004 findings.
//
// Usage: node scripts/audit/verify-pt09-004.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFileExistsNonEmpty } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const summaryPath = path.join(repoRoot, "test-evidence", "pt-09", "PHASE-09-SUMMARY.md");
const reviewPackPath = path.join(repoRoot, "test-evidence", "pt-09", "REVIEW-PACK.md");
const registerPath = path.join(repoRoot, "test-evidence", "_register", "WIRING_GAP_REGISTER.md");

const PREV_LAST_ROW = "WGR-089";
const PT09_004_FIRST_ROW = "WGR-090";

let failed = false;
function fail(reason) {
  console.error(`PT-09-004 FAIL: ${reason}`);
  failed = true;
}

function main() {
  try {
    assertFileExistsNonEmpty(summaryPath);
  } catch (err) {
    fail(`PHASE-09-SUMMARY.md check failed: ${err.message}`);
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
          "checking is not the one PT-09-004 grew from."
      );
    }
    if (!new RegExp(`\\|\\s*${PT09_004_FIRST_ROW}\\s*\\|`).test(registerContents)) {
      fail(
        `WIRING_GAP_REGISTER.md does not contain a ${PT09_004_FIRST_ROW} row -- the register has ` +
          `not grown beyond the pre-consolidation state (${PREV_LAST_ROW}); no PT-09-004 findings ` +
          "are recorded."
      );
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log(
    "PT-09-004 PASS: PHASE-09-SUMMARY.md present, REVIEW-PACK.md present, " +
      `WIRING_GAP_REGISTER.md has grown beyond the pre-consolidation state (${PREV_LAST_ROW} ` +
      `present, ${PT09_004_FIRST_ROW} present).`
  );
  process.exit(0);
}

main();
