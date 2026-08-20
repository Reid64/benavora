#!/usr/bin/env node
// ============================================================================
// PT-04-004 verifier — Phase 04 consolidation / human review checkpoint
//
// Confirms the two consolidation documents this phase produces are real,
// non-empty deliverables, and that WIRING_GAP_REGISTER.md has actually grown
// beyond PT-03's last row (WGR-134) with real PT-04 findings (WGR-135 through
// WGR-137) -- not just left at whatever state the phase happened to be in
// when this verifier was written.
//
// Exits non-zero unless:
//   1. test-evidence/pt-04/PHASE-04-SUMMARY.md exists and is non-empty.
//   2. test-evidence/pt-04/REVIEW-PACK.md exists and is non-empty.
//   3. test-evidence/_register/WIRING_GAP_REGISTER.md exists, is non-empty,
//      contains PT-03's own last row (WGR-134, confirming this is the same
//      register PT-03 closed with, not a truncated/reset one), and contains
//      every one of PT-04's own rows (WGR-135 through WGR-137) -- the
//      register must have grown past PT-03's last row with real PT-04
//      findings, not just PT-03's rows alone.
//
// Usage: node scripts/audit/verify-pt04-004.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFileExistsNonEmpty } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const summaryPath = path.join(repoRoot, "test-evidence", "pt-04", "PHASE-04-SUMMARY.md");
const reviewPackPath = path.join(repoRoot, "test-evidence", "pt-04", "REVIEW-PACK.md");
const registerPath = path.join(repoRoot, "test-evidence", "_register", "WIRING_GAP_REGISTER.md");

const PT03_LAST_ROW = "WGR-134";
const PT04_ROWS = ["WGR-135", "WGR-136", "WGR-137"];

let failed = false;
function fail(reason) {
  console.error(`PT-04-004 FAIL: ${reason}`);
  failed = true;
}

function main() {
  try {
    const size = assertFileExistsNonEmpty(summaryPath);
    console.log(`OK: PHASE-04-SUMMARY.md exists and is non-empty (${size} bytes).`);
  } catch (err) {
    fail(`PHASE-04-SUMMARY.md check failed: ${err.message}`);
  }

  try {
    const size = assertFileExistsNonEmpty(reviewPackPath);
    console.log(`OK: REVIEW-PACK.md exists and is non-empty (${size} bytes).`);
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
    if (!new RegExp(`\\|\\s*${PT03_LAST_ROW}\\s*\\|`).test(registerContents)) {
      fail(
        `WIRING_GAP_REGISTER.md does not contain a ${PT03_LAST_ROW} row -- PT-03's own last row is ` +
          "missing, which means the register this phase is checking is not the one PT-03 closed with."
      );
    } else {
      console.log(`OK: register contains PT-03's last row (${PT03_LAST_ROW}).`);
    }

    const missing = PT04_ROWS.filter(
      (id) => !new RegExp(`\\|\\s*${id}\\s*\\|`).test(registerContents)
    );
    if (missing.length > 0) {
      fail(
        `WIRING_GAP_REGISTER.md is missing ${missing.length} of PT-04's own row(s): ` +
          `${missing.join(", ")}. The register has not grown to cover all of PT-04's findings ` +
          `(expected ${PT04_ROWS.join(", ")}).`
      );
    } else {
      console.log(
        `OK: register contains all ${PT04_ROWS.length} of PT-04's own rows (${PT04_ROWS.join(", ")}).`
      );
    }

    // Sanity check: every PT-04 row must actually carry a well-formed 7-column table row
    // (ID | Layer | Severity | Finding | Evidence Path | Reproduction | Scope Tag), not just
    // exist as a bare substring match somewhere else in the document (e.g. inside prose).
    const lines = registerContents.split(/\r?\n/);
    for (const id of PT04_ROWS) {
      const rowLine = lines.find((l) => l.startsWith(`| ${id} `) || l.startsWith(`|${id} `));
      if (!rowLine) {
        fail(`${id} is referenced somewhere in the register but has no real table row (line starting "| ${id} ").`);
        continue;
      }
      const cellCount = rowLine.split(" | ").length;
      if (cellCount < 7) {
        fail(`${id}'s table row has ${cellCount} cell(s), expected at least 7 (ID/Layer/Severity/Finding/Evidence/Repro/ScopeTag).`);
      }
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log(
    "PT-04-004 PASS: PHASE-04-SUMMARY.md present, REVIEW-PACK.md present, " +
      `WIRING_GAP_REGISTER.md has grown beyond PT-03's last row (${PT03_LAST_ROW} present) with all ` +
      `of PT-04's own rows (${PT04_ROWS.join(", ")}) present as well-formed table rows.`
  );
  process.exit(0);
}

main();
