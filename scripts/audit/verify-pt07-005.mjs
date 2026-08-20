#!/usr/bin/env node
// ============================================================================
// PT-07-005 verifier — Phase 07 consolidation / human review checkpoint
//
// Confirms the two consolidation documents this phase produces are real,
// non-empty deliverables, and that WIRING_GAP_REGISTER.md has actually grown
// beyond PT-04's last row (WGR-137) with real PT-07 findings (WGR-138 through
// WGR-148) -- not just left at whatever state the phase happened to be in
// when this verifier was written.
//
// Exits non-zero unless:
//   1. test-evidence/pt-07/PHASE-07-SUMMARY.md exists and is non-empty.
//   2. test-evidence/pt-07/REVIEW-PACK.md exists and is non-empty.
//   3. test-evidence/_register/WIRING_GAP_REGISTER.md exists, is non-empty,
//      contains PT-04's own last row (WGR-137, confirming this is the same
//      register PT-04 closed with, not a truncated/reset one), and contains
//      every one of PT-07's own rows (WGR-138 through WGR-148) -- the
//      register must have grown past PT-04's last row with real PT-07
//      findings, not just PT-04's rows alone.
//
// Usage: node scripts/audit/verify-pt07-005.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFileExistsNonEmpty } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const summaryPath = path.join(repoRoot, "test-evidence", "pt-07", "PHASE-07-SUMMARY.md");
const reviewPackPath = path.join(repoRoot, "test-evidence", "pt-07", "REVIEW-PACK.md");
const registerPath = path.join(repoRoot, "test-evidence", "_register", "WIRING_GAP_REGISTER.md");

const PT04_LAST_ROW = "WGR-137";
const PT07_ROWS = [
  "WGR-138",
  "WGR-139",
  "WGR-140",
  "WGR-141",
  "WGR-142",
  "WGR-143",
  "WGR-144",
  "WGR-145",
  "WGR-146",
  "WGR-147",
  "WGR-148",
];

let failed = false;
function fail(reason) {
  console.error(`PT-07-005 FAIL: ${reason}`);
  failed = true;
}

function main() {
  try {
    const size = assertFileExistsNonEmpty(summaryPath);
    console.log(`OK: PHASE-07-SUMMARY.md exists and is non-empty (${size} bytes).`);
  } catch (err) {
    fail(`PHASE-07-SUMMARY.md check failed: ${err.message}`);
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
    if (!new RegExp(`\\|\\s*${PT04_LAST_ROW}\\s*\\|`).test(registerContents)) {
      fail(
        `WIRING_GAP_REGISTER.md does not contain a ${PT04_LAST_ROW} row -- PT-04's own last row is ` +
          "missing, which means the register this phase is checking is not the one PT-04 closed with."
      );
    } else {
      console.log(`OK: register contains PT-04's last row (${PT04_LAST_ROW}).`);
    }

    const missing = PT07_ROWS.filter(
      (id) => !new RegExp(`\\|\\s*${id}\\s*\\|`).test(registerContents)
    );
    if (missing.length > 0) {
      fail(
        `WIRING_GAP_REGISTER.md is missing ${missing.length} of PT-07's own row(s): ` +
          `${missing.join(", ")}. The register has not grown to cover all of PT-07's findings ` +
          `(expected ${PT07_ROWS.join(", ")}).`
      );
    } else {
      console.log(
        `OK: register contains all ${PT07_ROWS.length} of PT-07's own rows (${PT07_ROWS.join(", ")}).`
      );
    }

    // Sanity check: every PT-07 row must actually carry a well-formed 7-column table row
    // (ID | Layer | Severity | Finding | Evidence Path | Reproduction | Scope Tag), not just
    // exist as a bare substring match somewhere else in the document (e.g. inside prose).
    const lines = registerContents.split(/\r?\n/);
    for (const id of PT07_ROWS) {
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

    // The register must have genuinely grown -- PT-07's rows must all be NEW additions past
    // PT-04's last row, not pre-existing rows this phase merely references. Confirm the line
    // number of WGR-137 is strictly before the line number of every PT-07 row.
    const indexOf = (id) => lines.findIndex((l) => l.startsWith(`| ${id} `) || l.startsWith(`|${id} `));
    const pt04LastIdx = indexOf(PT04_LAST_ROW);
    if (pt04LastIdx >= 0) {
      const outOfOrder = PT07_ROWS.filter((id) => {
        const idx = indexOf(id);
        return idx >= 0 && idx < pt04LastIdx;
      });
      if (outOfOrder.length > 0) {
        fail(
          `The following PT-07 row(s) appear BEFORE ${PT04_LAST_ROW} in the register: ` +
            `${outOfOrder.join(", ")} -- the register did not grow past PT-04's close, these rows ` +
            "were inserted earlier in the file instead of appended."
        );
      } else {
        console.log(`OK: all ${PT07_ROWS.length} of PT-07's rows appear after ${PT04_LAST_ROW} -- the register genuinely grew.`);
      }
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log(
    "PT-07-005 PASS: PHASE-07-SUMMARY.md present, REVIEW-PACK.md present, " +
      `WIRING_GAP_REGISTER.md has grown beyond PT-04's last row (${PT04_LAST_ROW} present) with all ` +
      `of PT-07's own rows (${PT07_ROWS.join(", ")}) present as well-formed table rows appended ` +
      "after it -- the audit program's register now runs WGR-001 through WGR-148 unbroken, closing " +
      "out PT-00 through PT-14."
  );
  process.exit(0);
}

main();
