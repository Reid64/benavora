// PT-00-001 verification: confirms the audit evidence-infrastructure scaffold is present.
// Exits 0 only if all checks pass; exits 1 with a printed reason on any failure.
// ASCII only. Node 20 compatible.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFileExistsNonEmpty } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const registerPath = path.join(repoRoot, "test-evidence", "_register", "WIRING_GAP_REGISTER.md");
const evidenceLibPath = path.join(__dirname, "evidence-lib.mjs");

const REQUIRED_LEGEND_TERMS = ["P0", "P1", "P2", "P3"];

function fail(reason) {
  console.error(`PT-00-001 FAIL: ${reason}`);
  process.exit(1);
}

function main() {
  // 1. evidence-lib.mjs must exist and be non-empty.
  try {
    assertFileExistsNonEmpty(evidenceLibPath);
  } catch (err) {
    fail(`evidence-lib.mjs check failed: ${err.message}`);
    return;
  }

  // 2. Register must exist and be non-empty.
  let registerContents;
  try {
    assertFileExistsNonEmpty(registerPath);
    registerContents = fs.readFileSync(registerPath, "utf8");
  } catch (err) {
    fail(`WIRING_GAP_REGISTER.md check failed: ${err.message}`);
    return;
  }

  // 3. Register must contain the P0..P3 legend text.
  const missing = REQUIRED_LEGEND_TERMS.filter((term) => !registerContents.includes(term));
  if (missing.length > 0) {
    fail(`WIRING_GAP_REGISTER.md is missing legend term(s): ${missing.join(", ")}`);
    return;
  }

  console.log("PT-00-001 PASS: evidence-lib.mjs present, register present, P0-P3 legend confirmed.");
  process.exit(0);
}

main();
