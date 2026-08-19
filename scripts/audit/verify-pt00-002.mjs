#!/usr/bin/env node
// PT-00-002 verifier: confirms the build-worker-cap audit evidence exists and
// the captured build actually completed (not a 900s timeout / worker crash).
//
// Exits non-zero unless:
//   1. test-evidence/pt-00/build-config.txt exists
//   2. test-evidence/pt-00/build-proof.txt exists
//   3. build-proof.txt shows a genuine Next.js build success marker
//      ("Compiled successfully") AND an exit code of 0
//   4. build-proof.txt does NOT show the known timeout/crash signatures
//      (worker exit / STATUS_DLL_INIT_FAILED / a bare timeout kill)

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const evidenceDir = join(repoRoot, "test-evidence", "pt-00");
const configPath = join(evidenceDir, "build-config.txt");
const proofPath = join(evidenceDir, "build-proof.txt");

const failures = [];

if (!existsSync(configPath)) {
  failures.push(`Missing ${configPath}`);
}

if (!existsSync(proofPath)) {
  failures.push(`Missing ${proofPath}`);
} else {
  const proof = readFileSync(proofPath, "utf8");

  const hasSuccessMarker = /✓\s*Compiled successfully/.test(proof);
  if (!hasSuccessMarker) {
    failures.push('build-proof.txt does not contain the "✓ Compiled successfully" marker');
  }

  const exitCodeMatch = proof.match(/EXIT_CODE=(-?\d+)/);
  if (!exitCodeMatch) {
    failures.push("build-proof.txt has no EXIT_CODE= marker");
  } else if (exitCodeMatch[1] !== "0") {
    failures.push(`build-proof.txt shows a non-zero EXIT_CODE (${exitCodeMatch[1]})`);
  }

  const crashSignatures = [
    /Next\.js build worker exited with code/i,
    /STATUS_DLL_INIT_FAILED/i,
    /ELIFECYCLE/i,
    /Failed to compile/i,
    /\btimed?[ -]?out\b/i,
    /\bkilled\b/i,
  ];
  for (const pattern of crashSignatures) {
    if (pattern.test(proof)) {
      failures.push(`build-proof.txt contains a failure/timeout signature: ${pattern}`);
    }
  }
}

if (failures.length > 0) {
  console.error("PT-00-002 verification FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("PT-00-002 verification PASSED: build-config.txt and build-proof.txt present; build-proof.txt shows a completed, successful build (no timeout/crash signature).");
process.exit(0);
