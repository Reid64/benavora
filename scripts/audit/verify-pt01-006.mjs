#!/usr/bin/env node
// ============================================================================
// PT-01-006 verifier — Phase 01 consolidation / human review checkpoint
//
// Confirms the two consolidation documents this phase produces are real,
// non-empty deliverables, and that WIRING_GAP_REGISTER.md has actually grown
// beyond PT-00's last row (WGR-011) with real PT-01 findings, not just left
// at the state PT-00 closed with.
//
// Exits non-zero unless:
//   1. test-evidence/pt-01/PHASE-01-SUMMARY.md exists and is non-empty.
//   2. test-evidence/pt-01/REVIEW-PACK.md exists and is non-empty.
//   3. test-evidence/_register/WIRING_GAP_REGISTER.md exists, is non-empty,
//      and contains at least a WGR-012 row (the register must have moved
//      past PT-00's last row, WGR-011, with real PT-01 findings).
//
// Usage: node scripts/audit/verify-pt01-006.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFileExistsNonEmpty } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const summaryPath = path.join(repoRoot, "test-evidence", "pt-01", "PHASE-01-SUMMARY.md");
const reviewPackPath = path.join(repoRoot, "test-evidence", "pt-01", "REVIEW-PACK.md");
const registerPath = path.join(repoRoot, "test-evidence", "_register", "WIRING_GAP_REGISTER.md");

const PT00_LAST_ROW = "WGR-011";
const PT01_FIRST_ROW = "WGR-012";

let failed = false;
function fail(reason) {
  console.error(`PT-01-006 FAIL: ${reason}`);
  failed = true;
}

function main() {
  try {
    assertFileExistsNonEmpty(summaryPath);
  } catch (err) {
    fail(`PHASE-01-SUMMARY.md check failed: ${err.message}`);
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
    if (!new RegExp(`\\|\\s*${PT00_LAST_ROW}\\s*\\|`).test(registerContents)) {
      fail(
        `WIRING_GAP_REGISTER.md does not contain a ${PT00_LAST_ROW} row -- PT-00's own last row is ` +
          "missing, which means the register this phase is checking is not the one PT-00 closed with."
      );
    }
    if (!new RegExp(`\\|\\s*${PT01_FIRST_ROW}\\s*\\|`).test(registerContents)) {
      fail(
        `WIRING_GAP_REGISTER.md does not contain a ${PT01_FIRST_ROW} row -- the register has not grown ` +
          `beyond PT-00's last row (${PT00_LAST_ROW}); no PT-01 findings are recorded.`
      );
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log(
    "PT-01-006 PASS: PHASE-01-SUMMARY.md present, REVIEW-PACK.md present, " +
      `WIRING_GAP_REGISTER.md has grown beyond PT-00's last row (${PT00_LAST_ROW} present, ` +
      `${PT01_FIRST_ROW} present).`
  );
  process.exit(0);
}

main();
