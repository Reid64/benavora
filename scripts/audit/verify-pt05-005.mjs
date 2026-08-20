#!/usr/bin/env node
// ============================================================================
// PT-05-005 verifier — Phase 05 consolidation / human review checkpoint
//
// Confirms the two consolidation documents this phase produces are real,
// non-empty deliverables, and that WIRING_GAP_REGISTER.md has actually grown
// beyond PT-06's last row (WGR-070) with real PT-05 findings, not just left
// at whatever state it was in before this phase. WGR-070 is checked
// explicitly since it's the register floor this phase's own task
// instructions name ("continuing WGR-### numbering" from PT-06); PT-05's own
// first row, WGR-071, is also checked directly so this can't pass on the
// strength of an unrelated phase's rows alone.
//
// Exits non-zero unless:
//   1. test-evidence/pt-05/PHASE-05-SUMMARY.md exists and is non-empty.
//   2. test-evidence/pt-05/REVIEW-PACK.md exists and is non-empty.
//   3. test-evidence/_register/WIRING_GAP_REGISTER.md exists, is non-empty,
//      contains a WGR-070 row (PT-06's last row -- the register floor this
//      phase's own task instructions name), and contains a WGR-071 row
//      (PT-05's own first row -- proves the register grew with real PT-05
//      findings specifically, not just some other phase's rows).
//
// Usage: node scripts/audit/verify-pt05-005.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFileExistsNonEmpty } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const summaryPath = path.join(repoRoot, "test-evidence", "pt-05", "PHASE-05-SUMMARY.md");
const reviewPackPath = path.join(repoRoot, "test-evidence", "pt-05", "REVIEW-PACK.md");
const registerPath = path.join(repoRoot, "test-evidence", "_register", "WIRING_GAP_REGISTER.md");

const PT06_LAST_ROW = "WGR-070";
const PT05_FIRST_ROW = "WGR-071";

let failed = false;
function fail(reason) {
  console.error(`PT-05-005 FAIL: ${reason}`);
  failed = true;
}

function main() {
  try {
    assertFileExistsNonEmpty(summaryPath);
  } catch (err) {
    fail(`PHASE-05-SUMMARY.md check failed: ${err.message}`);
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
    if (!new RegExp(`\\|\\s*${PT06_LAST_ROW}\\s*\\|`).test(registerContents)) {
      fail(
        `WIRING_GAP_REGISTER.md does not contain a ${PT06_LAST_ROW} row -- PT-06's last row is ` +
          "missing, which means the register this phase is checking is not the one this task's own " +
          "instructions name as the growth floor."
      );
    }
    if (!new RegExp(`\\|\\s*${PT05_FIRST_ROW}\\s*\\|`).test(registerContents)) {
      fail(
        `WIRING_GAP_REGISTER.md does not contain a ${PT05_FIRST_ROW} row -- no PT-05-specific ` +
          "findings are recorded (a later phase's rows are not sufficient evidence that PT-05 " +
          "itself contributed to the register)."
      );
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log(
    "PT-05-005 PASS: PHASE-05-SUMMARY.md present, REVIEW-PACK.md present, " +
      `WIRING_GAP_REGISTER.md has grown beyond PT-06's last row (${PT06_LAST_ROW} present, ` +
      `PT-05's own first row ${PT05_FIRST_ROW} present).`
  );
  process.exit(0);
}

main();
