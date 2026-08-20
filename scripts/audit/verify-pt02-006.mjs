#!/usr/bin/env node
// ============================================================================
// PT-02-006 verifier — Phase 02 consolidation / human review checkpoint
//
// Confirms the two consolidation documents this phase produces are real,
// non-empty deliverables, and that WIRING_GAP_REGISTER.md has actually grown
// beyond PT-01's last row (WGR-022) with real PT-02 findings, not just left
// at the state PT-01 closed with.
//
// Exits non-zero unless:
//   1. test-evidence/pt-02/PHASE-02-SUMMARY.md exists and is non-empty.
//   2. test-evidence/pt-02/REVIEW-PACK.md exists and is non-empty.
//   3. test-evidence/_register/WIRING_GAP_REGISTER.md exists, is non-empty,
//      and contains at least a WGR-023 row (the register must have moved
//      past PT-01's last row, WGR-022, with real PT-02 findings).
//
// Usage: node scripts/audit/verify-pt02-006.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFileExistsNonEmpty } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const summaryPath = path.join(repoRoot, "test-evidence", "pt-02", "PHASE-02-SUMMARY.md");
const reviewPackPath = path.join(repoRoot, "test-evidence", "pt-02", "REVIEW-PACK.md");
const registerPath = path.join(repoRoot, "test-evidence", "_register", "WIRING_GAP_REGISTER.md");

const PT01_LAST_ROW = "WGR-022";
const PT02_FIRST_ROW = "WGR-023";

let failed = false;
function fail(reason) {
  console.error(`PT-02-006 FAIL: ${reason}`);
  failed = true;
}

function main() {
  try {
    assertFileExistsNonEmpty(summaryPath);
  } catch (err) {
    fail(`PHASE-02-SUMMARY.md check failed: ${err.message}`);
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
    if (!new RegExp(`\\|\\s*${PT01_LAST_ROW}\\s*\\|`).test(registerContents)) {
      fail(
        `WIRING_GAP_REGISTER.md does not contain a ${PT01_LAST_ROW} row -- PT-01's own last row is ` +
          "missing, which means the register this phase is checking is not the one PT-01 closed with."
      );
    }
    if (!new RegExp(`\\|\\s*${PT02_FIRST_ROW}\\s*\\|`).test(registerContents)) {
      fail(
        `WIRING_GAP_REGISTER.md does not contain a ${PT02_FIRST_ROW} row -- the register has not grown ` +
          `beyond PT-01's last row (${PT01_LAST_ROW}); no PT-02 findings are recorded.`
      );
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log(
    "PT-02-006 PASS: PHASE-02-SUMMARY.md present, REVIEW-PACK.md present, " +
      `WIRING_GAP_REGISTER.md has grown beyond PT-01's last row (${PT01_LAST_ROW} present, ` +
      `${PT02_FIRST_ROW} present).`
  );
  process.exit(0);
}

main();
