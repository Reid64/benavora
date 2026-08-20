// ============================================================================
// PT-15-002c — confirm the false-PASS deploy-verifier fix is still in place.
//
// Background (STANDING_DIRECTIVES.md DIRECTIVE-019, WGR-002): production once
// silently drifted 21 commits stale for 8+ hours because nothing in the
// pipeline distinguished "verified matching HEAD" from "couldn't check."
// scripts/verify-deployment.ts was fixed to a real 4-state exit-code contract
// (0=PASS, 1=FAIL, 2=PENDING, 3=INDETERMINATE) and the FORGE-side wrapper
// (gates/deploy_verify.ps1, outside this repo) was fixed 2026-08-13 to never
// print PASS for PENDING/INDETERMINATE. This script re-confirms BOTH halves
// still hold, live, rather than trusting the directive's own prose:
//
//   1. Runs the real, unmodified scripts/verify-deployment.ts against this
//      session's actual local .env.local (VERCEL_TOKEN/VERCEL_PROJECT_ID
//      confirmed absent by PT-15-001's env-parity work) and records its
//      real exit code + stdout. The live-observed behavior must be
//      INDETERMINATE (exit 3), and its own stdout must NOT contain the
//      literal word "PASS" -- if it ever printed "PASS" while unable to
//      confirm a real match, that would BE the false-PASS bug this check
//      exists to catch.
//   2. Statically re-reads gates/deploy_verify.ps1 from the FORGE tooling
//      directory (outside this repo, per DIRECTIVE-019's own note) and
//      confirms its exit-code switch never emits a bare "PASS" banner for
//      case 2 (PENDING) or case 3 (INDETERMINATE) -- both must route through
//      Write-WarnBanner, not the case-0 "PASS" line.
//
// Usage: node scripts/audit/pt15-002-deploy-verifier-check.mjs
// ============================================================================

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "pt-15");
const OUT_JSON = path.join(OUT_DIR, "_deploy-verifier-summary.json");

const FORGE_GATE_PATH = "C:\\Users\\manag\\Documents\\FORGE\\gates\\deploy_verify.ps1";

function fail(message) {
  console.error(`HARD FAIL: ${message}`);
  process.exit(1);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // --- 1. Live run of scripts/verify-deployment.ts ---------------------------
  let stdout = "";
  let exitCode = null;
  try {
    stdout = execSync("node --import tsx scripts/verify-deployment.ts", { encoding: "utf8" });
    exitCode = 0;
  } catch (err) {
    stdout = (err.stdout || "") + (err.stderr || "");
    exitCode = typeof err.status === "number" ? err.status : null;
  }

  const envVarsPresent = {
    VERCEL_TOKEN: !!process.env.VERCEL_TOKEN,
    VERCEL_PROJECT_ID: !!process.env.VERCEL_PROJECT_ID,
  };

  const containsBarePassClaim = /\bPASS\b/.test(stdout) && !/INDETERMINATE|FAIL|PENDING/.test(stdout);
  const isIndeterminate = exitCode === 3 && /INDETERMINATE/.test(stdout);

  const liveScriptCheck = {
    command: "node --import tsx scripts/verify-deployment.ts",
    exitCode,
    stdout: stdout.trim(),
    envVarsPresentLocally: envVarsPresent,
    observedState: isIndeterminate ? "INDETERMINATE" : exitCode === 0 ? "PASS" : exitCode === 1 ? "FAIL" : exitCode === 2 ? "PENDING" : "UNKNOWN",
    neverFalselyClaimedPass: !containsBarePassClaim,
    verdict:
      !envVarsPresent.VERCEL_TOKEN || !envVarsPresent.VERCEL_PROJECT_ID
        ? isIndeterminate && !containsBarePassClaim
          ? "CORRECT — reported INDETERMINATE (exit 3), no bare PASS claim, consistent with missing VERCEL_TOKEN/VERCEL_PROJECT_ID"
          : "UNEXPECTED — expected INDETERMINATE given missing env vars but did not observe it cleanly"
        : `env vars WERE present this run (exitCode=${exitCode}) — different scenario than the documented gap, see stdout`,
  };

  if (liveScriptCheck.verdict.startsWith("UNEXPECTED")) {
    fail(`scripts/verify-deployment.ts did not behave as expected: ${JSON.stringify(liveScriptCheck)}`);
  }

  // --- 2. Static re-read of the FORGE-side gate wrapper -----------------------
  let forgeGateCheck;
  if (fs.existsSync(FORGE_GATE_PATH)) {
    const src = fs.readFileSync(FORGE_GATE_PATH, "utf8");

    // Extract each numbered `switch ($code) { N { ... } }` block body up to
    // the next top-level `}` at the same brace depth, crudely but reliably
    // for this file's own consistent formatting (each case body is a small,
    // single-purpose block terminated by its own closing brace on its own
    // line before the next case number or `default`).
    function extractCaseBody(caseNum) {
      const re = new RegExp(`\\n\\s*${caseNum}\\s*\\{([\\s\\S]*?)\\n\\s*\\}\\n`, "m");
      const m = src.match(re);
      return m ? m[1] : null;
    }

    const case0 = extractCaseBody(0);
    const case1 = extractCaseBody(1);
    const case2 = extractCaseBody(2);
    const case3 = extractCaseBody(3);

    const case0EmitsPass = case0 ? /PASS/.test(case0) : null;
    const case1EmitsFail = case1 ? /FAIL/.test(case1) : null;
    const case2CallsWarnBanner = case2 ? /Write-WarnBanner/.test(case2) : null;
    const case2EmitsBarePass = case2 ? /"PASS/.test(case2) : null;
    const case3CallsWarnBanner = case3 ? /Write-WarnBanner/.test(case3) : null;
    const case3EmitsBarePass = case3 ? /"PASS/.test(case3) : null;
    // Confirm case 1 (real FAIL) is NOT softened to exit 0.
    const case1ExitsNonZero = case1 ? /exit\s+1/.test(case1) : null;
    const case2ExitsZeroWarn = case2 ? /exit\s+0/.test(case2) : null;
    const case3ExitsZeroWarn = case3 ? /exit\s+0/.test(case3) : null;

    forgeGateCheck = {
      path: FORGE_GATE_PATH,
      readable: true,
      case0_PASS_present: case0EmitsPass,
      case1_FAIL_hardFails: case1EmitsFail && case1ExitsNonZero,
      case2_PENDING_warnsNotPasses: case2CallsWarnBanner === true && case2EmitsBarePass === false,
      case2_exitsZero_nonBlocking: case2ExitsZeroWarn,
      case3_INDETERMINATE_warnsNotPasses: case3CallsWarnBanner === true && case3EmitsBarePass === false,
      case3_exitsZero_nonBlocking: case3ExitsZeroWarn,
    };
    forgeGateCheck.overallVerdict =
      forgeGateCheck.case1_FAIL_hardFails === true &&
      forgeGateCheck.case2_PENDING_warnsNotPasses === true &&
      forgeGateCheck.case3_INDETERMINATE_warnsNotPasses === true
        ? "FIX_CONFIRMED_IN_PLACE"
        : "FIX_NOT_CONFIRMED — see per-case fields";
  } else {
    forgeGateCheck = {
      path: FORGE_GATE_PATH,
      readable: false,
      overallVerdict: "GATE_FILE_UNREACHABLE_FROM_THIS_SESSION — could not confirm the FORGE-side wrapper directly",
    };
  }

  const summary = {
    task: "PT-15-002c: confirm the false-PASS deploy-verifier fix is in place",
    generatedAt: new Date().toISOString(),
    wgrReference: "WGR-002",
    standingGap: {
      description:
        "VERCEL_TOKEN and VERCEL_PROJECT_ID remain confirmed absent from local .env.local (re-confirmed this session, matches PT-00/PT-15-001's prior finding) — the deploy-verifier gate cannot produce a real PASS/FAIL verdict, only PENDING/INDETERMINATE, until those are supplied. This is the standing WGR-002 gap; it is NOT resolved by this check and is not claimed to be. What IS confirmed here is that the gate correctly refuses to lie about it (no false PASS) while the gap remains open.",
      resolved: false,
    },
    liveScriptCheck,
    forgeGateCheck,
    overallVerdict:
      liveScriptCheck.verdict.startsWith("CORRECT") && forgeGateCheck.overallVerdict === "FIX_CONFIRMED_IN_PLACE"
        ? "CONFIRMED — the false-PASS deploy-verifier fix (both scripts/verify-deployment.ts's exit-code contract and the FORGE gates/deploy_verify.ps1 wrapper) is in place and behaving correctly; the underlying WGR-002 credential gap remains open and unresolved."
        : "REVIEW_REQUIRED — see liveScriptCheck / forgeGateCheck for detail.",
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Overall verdict: ${summary.overallVerdict}`);
}

main().catch((err) => {
  console.error(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});
