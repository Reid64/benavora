#!/usr/bin/env node
// ============================================================================
// PT-00-006 verifier — Phase 00 consolidation / human review checkpoint
//
// Confirms the two consolidation documents this phase produces are real,
// non-empty deliverables, and that WIRING_GAP_REGISTER.md has actually been
// populated with findings (not just the scaffold's empty table from PT-00-001).
//
// Exits non-zero unless:
//   1. test-evidence/pt-00/PHASE-00-SUMMARY.md exists and is non-empty.
//   2. test-evidence/pt-00/REVIEW-PACK.md exists and is non-empty.
//   3. test-evidence/_register/WIRING_GAP_REGISTER.md exists, is non-empty,
//      and contains at least a WGR-001 row (the register must have moved
//      past the empty-table scaffold state PT-00-001 leaves it in).
//
// Usage: node scripts/audit/verify-pt00-006.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFileExistsNonEmpty } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const summaryPath = path.join(repoRoot, "test-evidence", "pt-00", "PHASE-00-SUMMARY.md");
const reviewPackPath = path.join(repoRoot, "test-evidence", "pt-00", "REVIEW-PACK.md");
const registerPath = path.join(repoRoot, "test-evidence", "_register", "WIRING_GAP_REGISTER.md");

let failed = false;
function fail(reason) {
  console.error(`PT-00-006 FAIL: ${reason}`);
  failed = true;
}

function main() {
  try {
    assertFileExistsNonEmpty(summaryPath);
  } catch (err) {
    fail(`PHASE-00-SUMMARY.md check failed: ${err.message}`);
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

  if (registerContents !== undefined && !/\|\s*WGR-001\s*\|/.test(registerContents)) {
    fail(
      "WIRING_GAP_REGISTER.md does not contain a WGR-001 row -- the register is still the empty " +
        "scaffold, not the populated PT-00 findings table this consolidation phase requires."
    );
  }

  if (failed) {
    process.exit(1);
  }

  console.log(
    "PT-00-006 PASS: PHASE-00-SUMMARY.md present, REVIEW-PACK.md present, " +
      "WIRING_GAP_REGISTER.md populated (WGR-001 row confirmed)."
  );
  process.exit(0);
}

main();
