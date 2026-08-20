#!/usr/bin/env node
// ============================================================================
// PT-08-004 verifier — Phase 08 consolidation / human review checkpoint
//
// Confirms the two consolidation documents this phase produces are real,
// non-empty deliverables, and that WIRING_GAP_REGISTER.md has actually grown
// beyond the last row before PT-08 (WGR-032, PT-02's last row -- there is no
// PT-03 through PT-07 register content yet) with real PT-08 findings, not
// just left at the state PT-02 closed with.
//
// Exits non-zero unless:
//   1. test-evidence/pt-08/PHASE-08-SUMMARY.md exists and is non-empty.
//   2. test-evidence/pt-08/REVIEW-PACK.md exists and is non-empty.
//   3. test-evidence/_register/WIRING_GAP_REGISTER.md exists, is non-empty,
//      and contains both a WGR-032 row (the last row before PT-08) and a
//      WGR-033 row (PT-08's first finding) -- proving the register has moved
//      past its pre-PT-08 state with real PT-08 findings.
//
// Usage: node scripts/audit/verify-pt08-004.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFileExistsNonEmpty } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const summaryPath = path.join(repoRoot, "test-evidence", "pt-08", "PHASE-08-SUMMARY.md");
const reviewPackPath = path.join(repoRoot, "test-evidence", "pt-08", "REVIEW-PACK.md");
const registerPath = path.join(repoRoot, "test-evidence", "_register", "WIRING_GAP_REGISTER.md");

const PREV_LAST_ROW = "WGR-032";
const PT08_FIRST_ROW = "WGR-033";

let failed = false;
function fail(reason) {
  console.error(`PT-08-004 FAIL: ${reason}`);
  failed = true;
}

function main() {
  try {
    assertFileExistsNonEmpty(summaryPath);
  } catch (err) {
    fail(`PHASE-08-SUMMARY.md check failed: ${err.message}`);
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
          "PT-08 is missing, which means the register this phase is checking is not the one " +
          "PT-08 grew from."
      );
    }
    if (!new RegExp(`\\|\\s*${PT08_FIRST_ROW}\\s*\\|`).test(registerContents)) {
      fail(
        `WIRING_GAP_REGISTER.md does not contain a ${PT08_FIRST_ROW} row -- the register has not ` +
          `grown beyond the pre-PT-08 state (${PREV_LAST_ROW}); no PT-08 findings are recorded.`
      );
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log(
    "PT-08-004 PASS: PHASE-08-SUMMARY.md present, REVIEW-PACK.md present, " +
      `WIRING_GAP_REGISTER.md has grown beyond the pre-PT-08 state (${PREV_LAST_ROW} present, ` +
      `${PT08_FIRST_ROW} present).`
  );
  process.exit(0);
}

main();
