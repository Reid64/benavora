#!/usr/bin/env node
// ============================================================================
// PT-03-005 verifier — Phase 03 consolidation / human review checkpoint
//
// Confirms the two consolidation documents this phase produces are real,
// non-empty deliverables, and that WIRING_GAP_REGISTER.md has actually grown
// beyond PT-10's last row (WGR-128) with real PT-03 findings -- both the row
// registered earlier in this phase (WGR-129) and the rows this closing pass
// itself registered (WGR-130 through WGR-134) -- not just left at whatever
// state the phase happened to be in when this verifier was written.
//
// Exits non-zero unless:
//   1. test-evidence/pt-03/PHASE-03-SUMMARY.md exists and is non-empty.
//   2. test-evidence/pt-03/REVIEW-PACK.md exists and is non-empty.
//   3. test-evidence/_register/WIRING_GAP_REGISTER.md exists, is non-empty,
//      contains PT-10's own last row (WGR-128, confirming this is the same
//      register PT-10 closed with, not a truncated/reset one), and contains
//      every one of PT-03's own rows (WGR-129 through WGR-134) -- the
//      register must have grown past PT-10's last row with real PT-03
//      findings, not just PT-03's first row alone.
//
// Usage: node scripts/audit/verify-pt03-005.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFileExistsNonEmpty } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const summaryPath = path.join(repoRoot, "test-evidence", "pt-03", "PHASE-03-SUMMARY.md");
const reviewPackPath = path.join(repoRoot, "test-evidence", "pt-03", "REVIEW-PACK.md");
const registerPath = path.join(repoRoot, "test-evidence", "_register", "WIRING_GAP_REGISTER.md");

const PT10_LAST_ROW = "WGR-128";
const PT03_ROWS = ["WGR-129", "WGR-130", "WGR-131", "WGR-132", "WGR-133", "WGR-134"];

let failed = false;
function fail(reason) {
  console.error(`PT-03-005 FAIL: ${reason}`);
  failed = true;
}

function main() {
  try {
    const size = assertFileExistsNonEmpty(summaryPath);
    console.log(`OK: PHASE-03-SUMMARY.md exists and is non-empty (${size} bytes).`);
  } catch (err) {
    fail(`PHASE-03-SUMMARY.md check failed: ${err.message}`);
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
    if (!new RegExp(`\\|\\s*${PT10_LAST_ROW}\\s*\\|`).test(registerContents)) {
      fail(
        `WIRING_GAP_REGISTER.md does not contain a ${PT10_LAST_ROW} row -- PT-10's own last row is ` +
          "missing, which means the register this phase is checking is not the one PT-10 closed with."
      );
    } else {
      console.log(`OK: register contains PT-10's last row (${PT10_LAST_ROW}).`);
    }

    const missing = PT03_ROWS.filter(
      (id) => !new RegExp(`\\|\\s*${id}\\s*\\|`).test(registerContents)
    );
    if (missing.length > 0) {
      fail(
        `WIRING_GAP_REGISTER.md is missing ${missing.length} of PT-03's own row(s): ` +
          `${missing.join(", ")}. The register has not grown to cover all of PT-03's findings ` +
          `(expected ${PT03_ROWS.join(", ")}).`
      );
    } else {
      console.log(
        `OK: register contains all ${PT03_ROWS.length} of PT-03's own rows (${PT03_ROWS.join(", ")}).`
      );
    }

    // Sanity check: every PT-03 row must actually carry a well-formed 7-column table row
    // (ID | Layer | Severity | Finding | Evidence Path | Reproduction | Scope Tag), not just
    // exist as a bare substring match somewhere else in the document (e.g. inside prose).
    const lines = registerContents.split(/\r?\n/);
    for (const id of PT03_ROWS) {
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
    "PT-03-005 PASS: PHASE-03-SUMMARY.md present, REVIEW-PACK.md present, " +
      `WIRING_GAP_REGISTER.md has grown beyond PT-10's last row (${PT10_LAST_ROW} present) with all ` +
      `of PT-03's own rows (${PT03_ROWS.join(", ")}) present as well-formed table rows.`
  );
  process.exit(0);
}

main();
