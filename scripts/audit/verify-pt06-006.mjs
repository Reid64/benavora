#!/usr/bin/env node
// ============================================================================
// PT-06-006 verifier — Phase 06 consolidation / human review checkpoint
//
// Confirms the two consolidation documents this phase produces are real,
// non-empty deliverables, and that WIRING_GAP_REGISTER.md has actually grown
// beyond PT-02's last row (WGR-032) with real PT-06 findings, not just left
// at whatever state it was in before this phase (PT-02 and PT-08 both landed
// rows before PT-06 -- PT-02's last row is checked explicitly since it's the
// register floor named in this phase's own task instructions; PT-06's own
// first row, WGR-041, is also checked directly so this can't pass on the
// strength of an unrelated phase's rows alone).
//
// Exits non-zero unless:
//   1. test-evidence/pt-06/PHASE-06-SUMMARY.md exists and is non-empty.
//   2. test-evidence/pt-06/REVIEW-PACK.md exists and is non-empty.
//   3. test-evidence/_register/WIRING_GAP_REGISTER.md exists, is non-empty,
//      contains a WGR-032 row (PT-02's last row -- the register floor this
//      phase's own task instructions name), and contains a WGR-041 row
//      (PT-06's own first row -- proves the register grew with real PT-06
//      findings specifically, not just some other phase's rows).
//
// Usage: node scripts/audit/verify-pt06-006.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFileExistsNonEmpty } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const summaryPath = path.join(repoRoot, "test-evidence", "pt-06", "PHASE-06-SUMMARY.md");
const reviewPackPath = path.join(repoRoot, "test-evidence", "pt-06", "REVIEW-PACK.md");
const registerPath = path.join(repoRoot, "test-evidence", "_register", "WIRING_GAP_REGISTER.md");

const PT02_LAST_ROW = "WGR-032";
const PT06_FIRST_ROW = "WGR-041";

let failed = false;
function fail(reason) {
  console.error(`PT-06-006 FAIL: ${reason}`);
  failed = true;
}

function main() {
  try {
    assertFileExistsNonEmpty(summaryPath);
  } catch (err) {
    fail(`PHASE-06-SUMMARY.md check failed: ${err.message}`);
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
    if (!new RegExp(`\\|\\s*${PT02_LAST_ROW}\\s*\\|`).test(registerContents)) {
      fail(
        `WIRING_GAP_REGISTER.md does not contain a ${PT02_LAST_ROW} row -- PT-02's last row is ` +
          "missing, which means the register this phase is checking is not the one this task's own " +
          "instructions name as the growth floor."
      );
    }
    if (!new RegExp(`\\|\\s*${PT06_FIRST_ROW}\\s*\\|`).test(registerContents)) {
      fail(
        `WIRING_GAP_REGISTER.md does not contain a ${PT06_FIRST_ROW} row -- no PT-06-specific ` +
          "findings are recorded (a later phase's rows, e.g. PT-08's, are not sufficient evidence " +
          "that PT-06 itself contributed to the register)."
      );
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log(
    "PT-06-006 PASS: PHASE-06-SUMMARY.md present, REVIEW-PACK.md present, " +
      `WIRING_GAP_REGISTER.md has grown beyond PT-02's last row (${PT02_LAST_ROW} present, ` +
      `PT-06's own first row ${PT06_FIRST_ROW} present).`
  );
  process.exit(0);
}

main();
