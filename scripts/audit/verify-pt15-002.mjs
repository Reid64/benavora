// ============================================================================
// PT-15-002 verifier — production readiness ops check.
//
// Fails unless test-evidence/pt-15/readiness-ops.json exists and its content
// actually records, with real evidence rather than restated hearsay, all
// three things this phase was asked to settle:
//   1. The restore drill: either a genuine PROVEN restore-to-a-copy result
//      (census + integrity check both present and passing), or an honest
//      PENDING-SCOPE record that explicitly flags production has no proven
//      restore path.
//   2. The app's rate-limiting posture on auth and expensive endpoints,
//      backed by a live mechanism test (not just a source-code claim).
//   3. Confirmation that the deploy-verifier's false-PASS bug is fixed --
//      it must WARN/report UNVERIFIED on PENDING/INDETERMINATE, never PASS.
//
// Also guards against a secret VALUE having been captured anywhere in the
// evidence directory, same convention as verify-pt15-001.mjs /
// verify-pt00-004.mjs.
//
// Usage: node scripts/audit/verify-pt15-002.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const EVIDENCE_DIR = path.join("test-evidence", "pt-15");
const TARGET = path.join(EVIDENCE_DIR, "readiness-ops.json");
const REGISTER_PATH = path.join("test-evidence", "_register", "WIRING_GAP_REGISTER.md");

const SECRET_VALUE_PATTERNS = [
  /sk-[A-Za-z0-9_-]{10,}/, // OpenAI/Stripe-style secret keys
  /sbp_[A-Za-z0-9]{10,}/, // Supabase Management API PAT
  /sb_secret_[A-Za-z0-9]{10,}/, // Supabase new-format secret key
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, // JWT (header.payload) -- catches anon/service-role keys
  /AIza[A-Za-z0-9_-]{20,}/, // Google API key
  /postgres(ql)?:\/\/[^\s"]+:[^\s"]+@/, // DB connection string with embedded credentials
  /https?:\/\/[^\s"]+:[^\s"]+@[^\s"]+/, // any URL with embedded basic-auth credentials
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key block
];

let failures = 0;
function fail(message) {
  console.error(`FAIL: ${message}`);
  failures++;
}
function warn(message) {
  console.warn(`WARN: ${message}`);
}

if (!fs.existsSync(EVIDENCE_DIR)) {
  fail(`${EVIDENCE_DIR} does not exist.`);
  process.exit(1);
}
if (!fs.existsSync(TARGET)) {
  fail(`${TARGET} does not exist.`);
  process.exit(1);
}

const raw = fs.readFileSync(TARGET, "utf8");
if (raw.trim().length === 0) {
  fail(`${TARGET} is empty.`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  fail(`${TARGET} is not valid JSON: ${err.message}`);
  process.exit(1);
}
if (!data || typeof data !== "object") {
  fail(`${TARGET} did not parse to an object.`);
  process.exit(1);
}

// --- 1. Restore drill --------------------------------------------------------

const rd = data.restoreDrill;
if (!rd || typeof rd !== "object") {
  fail(`${TARGET} is missing "restoreDrill".`);
} else {
  if (typeof rd.scope !== "string" || !["PROVEN", "PENDING-SCOPE"].includes(rd.scope)) {
    fail(`restoreDrill.scope must be "PROVEN" or "PENDING-SCOPE" (got: ${JSON.stringify(rd.scope)}).`);
  }
  if (typeof rd.conclusion !== "string" || rd.conclusion.length < 40) {
    fail(`restoreDrill.conclusion is missing or too short to be a real finding.`);
  }

  if (rd.scope === "PROVEN") {
    if (!rd.censusSummary || typeof rd.censusSummary !== "object") {
      fail(`restoreDrill.censusSummary is required when scope is "PROVEN".`);
    } else {
      if (typeof rd.censusSummary.tablesChecked !== "number" || rd.censusSummary.tablesChecked < 1) {
        fail(`restoreDrill.censusSummary.tablesChecked must be a positive number.`);
      }
      if (!Array.isArray(rd.censusSummary.inconsistentTables)) {
        fail(`restoreDrill.censusSummary.inconsistentTables must be an array.`);
      }
    }
    if (typeof rd.integrityVerdict !== "string" || rd.integrityVerdict.length === 0) {
      fail(`restoreDrill.integrityVerdict is required when scope is "PROVEN".`);
    }
    // The detail object must show the actual identity checks that prove this
    // was a real restore of prod, not an unrelated/fabricated project.
    const idc = rd.detail?.identityChecks;
    if (!idc || typeof idc !== "object") {
      fail(`restoreDrill.detail.identityChecks is missing -- cannot confirm the drill target was genuinely a restore of production.`);
    } else {
      for (const key of ["branchRefDiffersFromProd", "parentRefIsProd", "withDataTrue", "isActiveHealthy"]) {
        if (idc[key] !== true) {
          fail(`restoreDrill.detail.identityChecks.${key} is not true (got ${JSON.stringify(idc[key])}) -- restore-target identity not confirmed.`);
        }
      }
    }
    const integrity = rd.detail?.integrity;
    if (!integrity || typeof integrity !== "object") {
      fail(`restoreDrill.detail.integrity is missing.`);
    } else {
      if (!integrity.foreignKeyEmbedCheck || typeof integrity.foreignKeyEmbedCheck !== "object") {
        fail(`restoreDrill.detail.integrity.foreignKeyEmbedCheck is missing -- no basic integrity check on the restored data was recorded.`);
      }
      if (!integrity.rlsCheck || !integrity.rlsCheck.attempted) {
        warn(`restoreDrill.detail.integrity.rlsCheck was not attempted -- RLS-on-restored-copy was not independently confirmed.`);
      } else if (integrity.rlsCheck.verdict === "RLS_APPEARS_OPEN_ON_RESTORED_COPY") {
        fail(`restoreDrill RLS check found the restored copy's RLS APPEARS OPEN to the anon key -- this is a real security finding, not a pass.`);
      }
    }
    // Teardown must be recorded so a PROVEN drill doesn't quietly leave a
    // live, billed branch behind.
    const teardown = rd.detail?.teardown;
    if (!teardown || teardown.attempted !== true) {
      fail(`restoreDrill.detail.teardown was not recorded as attempted -- a PROVEN drill must record its own cleanup.`);
    } else if (teardown.ok !== true) {
      warn(`restoreDrill.detail.teardown.ok is not true -- the drill branch may still be live; check manually.`);
    }
  } else {
    // PENDING-SCOPE: the task explicitly requires flagging that production
    // has no proven restore path as a real readiness gap.
    const flagsGap = /no proven restore path/i.test(rd.conclusion) || /readiness gap/i.test(rd.conclusion);
    if (!flagsGap) {
      fail(
        `restoreDrill.scope is "PENDING-SCOPE" but restoreDrill.conclusion does not explicitly flag that ` +
          `production has no proven restore path (required by the task).`,
      );
    }
  }
}

// --- 2. Rate-limiting posture -------------------------------------------------

const rl = data.rateLimiting;
if (!rl || typeof rl !== "object") {
  fail(`${TARGET} is missing "rateLimiting".`);
} else {
  for (const field of ["authRateLimiting", "expensiveEndpointRateLimiting", "liveMechanismVerdict"]) {
    if (typeof rl[field] !== "string" || rl[field].length < 5) {
      fail(`rateLimiting.${field} is missing or too short.`);
    }
  }
  // The posture claim must be backed by a genuinely-executed live mechanism
  // test, not just a static source-code assertion.
  const lmt = rl.detail?.liveMechanismTest;
  if (!lmt || typeof lmt !== "object") {
    fail(`rateLimiting.detail.liveMechanismTest is missing -- posture is not backed by a live test.`);
  } else {
    if (!Array.isArray(lmt.callResults) || lmt.callResults.length === 0) {
      fail(`rateLimiting.detail.liveMechanismTest.callResults is missing/empty -- no real calls were recorded.`);
    }
    if (lmt.verdict !== "MECHANISM_CONFIRMED_WORKING") {
      fail(`rateLimiting.detail.liveMechanismTest.verdict is "${lmt.verdict}", not MECHANISM_CONFIRMED_WORKING.`);
    }
    if (lmt.keyIsolationConfirmed !== true) {
      fail(`rateLimiting.detail.liveMechanismTest.keyIsolationConfirmed is not true.`);
    }
  }
  // Auth posture must state plainly whether this app has its own auth API
  // route, since that's the load-bearing fact for "does the app rate-limit
  // auth."
  const ap = rl.detail?.authPosture;
  if (!ap || typeof ap.hasCustomLoginOrSignupRoute !== "boolean") {
    fail(`rateLimiting.detail.authPosture.hasCustomLoginOrSignupRoute is missing or not boolean.`);
  }
  // Expensive-endpoint posture must be a real, itemized scan, not a summary
  // number alone.
  const eep = rl.detail?.expensiveEndpointPosture;
  if (!eep || !Array.isArray(eep.allRoutes) || eep.allRoutes.length === 0) {
    fail(`rateLimiting.detail.expensiveEndpointPosture.allRoutes is missing/empty -- posture is not backed by a real route scan.`);
  }
  if (!Array.isArray(eep?.expensiveAndUnprotected)) {
    fail(`rateLimiting.detail.expensiveEndpointPosture.expensiveAndUnprotected must be an array (even if empty).`);
  }
}

// --- 3. Deploy-verifier confirmation ------------------------------------------

const dv = data.deployVerifier;
if (!dv || typeof dv !== "object") {
  fail(`${TARGET} is missing "deployVerifier".`);
} else {
  if (dv.wgrReference !== "WGR-002") {
    fail(`deployVerifier.wgrReference must be "WGR-002" (got ${JSON.stringify(dv.wgrReference)}).`);
  }
  if (typeof dv.standingGapResolved !== "boolean") {
    fail(`deployVerifier.standingGapResolved must be boolean.`);
  }
  if (typeof dv.overallVerdict !== "string" || dv.overallVerdict.length < 10) {
    fail(`deployVerifier.overallVerdict is missing or too short.`);
  } else if (!dv.overallVerdict.startsWith("CONFIRMED")) {
    fail(`deployVerifier.overallVerdict does not start with "CONFIRMED" -- the false-PASS fix was not confirmed in place: ${dv.overallVerdict}`);
  }

  const live = dv.detail?.liveScriptCheck;
  if (!live || typeof live !== "object") {
    fail(`deployVerifier.detail.liveScriptCheck is missing -- no live run of scripts/verify-deployment.ts was recorded.`);
  } else {
    if (live.neverFalselyClaimedPass !== true) {
      fail(`deployVerifier.detail.liveScriptCheck.neverFalselyClaimedPass is not true -- a false PASS may have been observed.`);
    }
    if (typeof live.exitCode !== "number") {
      fail(`deployVerifier.detail.liveScriptCheck.exitCode is missing.`);
    }
    // Never allow exit 0 (PASS) to be recorded as the observed live state
    // while VERCEL_TOKEN/VERCEL_PROJECT_ID are absent -- that would BE the
    // false-PASS bug this whole check exists to catch.
    const envPresent = live.envVarsPresentLocally || {};
    if ((!envPresent.VERCEL_TOKEN || !envPresent.VERCEL_PROJECT_ID) && live.exitCode === 0) {
      fail(
        `deployVerifier reports exit code 0 (PASS) while VERCEL_TOKEN/VERCEL_PROJECT_ID are recorded as absent -- ` +
          `this is exactly the false-PASS bug DIRECTIVE-019/WGR-002 exist to prevent.`,
      );
    }
  }

  const forgeGate = dv.detail?.forgeGateCheck;
  if (!forgeGate || typeof forgeGate !== "object") {
    fail(`deployVerifier.detail.forgeGateCheck is missing.`);
  } else if (forgeGate.readable === true) {
    for (const key of ["case1_FAIL_hardFails", "case2_PENDING_warnsNotPasses", "case3_INDETERMINATE_warnsNotPasses"]) {
      if (forgeGate[key] !== true) {
        fail(`deployVerifier.detail.forgeGateCheck.${key} is not true -- FORGE-side gate wrapper does not confirm the fix.`);
      }
    }
  } else {
    warn(`deployVerifier.detail.forgeGateCheck.readable is not true -- FORGE gate wrapper could not be independently re-read this run (path outside this repo).`);
  }
}

// --- 4. Cross-check the register was updated for the confirmed rate-limit gap -

if (rl?.detail?.expensiveEndpointPosture?.expensiveAndUnprotected?.length > 0) {
  if (!fs.existsSync(REGISTER_PATH)) {
    fail(`${REGISTER_PATH} does not exist -- cannot confirm the confirmed rate-limiting gap was registered.`);
  } else {
    const registerContent = fs.readFileSync(REGISTER_PATH, "utf8");
    if (!/WGR-\d+.*rate.?limit/i.test(registerContent.replace(/\n/g, " "))) {
      fail(`No WGR-* row in ${REGISTER_PATH} appears to reference the confirmed rate-limiting gap found in this phase.`);
    }
  }
}

// --- 5. Secret-value guard: scan every file in the evidence dir --------------

const filesToScan = fs
  .readdirSync(EVIDENCE_DIR)
  .filter((f) => f.endsWith(".json") || f.endsWith(".txt"))
  .map((f) => path.join(EVIDENCE_DIR, f));

const leaks = [];
for (const file of filesToScan) {
  const content = fs.readFileSync(file, "utf8");
  for (const pattern of SECRET_VALUE_PATTERNS) {
    const match = content.match(pattern);
    if (match) leaks.push(`${file}: ${pattern} -> matched "${match[0].slice(0, 12)}..."`);
  }
}
if (leaks.length > 0) {
  fail(`Possible secret VALUE(s) found in test-evidence/pt-15/:\n  ${leaks.join("\n  ")}`);
}

// --- 6. Producer scripts must actually exist on disk --------------------------

for (const script of [
  "scripts/audit/pt15-002-restore-drill.mjs",
  "scripts/audit/pt15-002-rate-limit-posture.mjs",
  "scripts/audit/pt15-002-deploy-verifier-check.mjs",
]) {
  if (!fs.existsSync(script)) {
    fail(`${script} does not exist.`);
  }
}

if (failures > 0) {
  console.error(`\nFAIL: ${failures} check(s) failed.`);
  process.exit(1);
}

console.log(`PASS: ${TARGET} is valid.`);
console.log(`  restoreDrill.scope: ${data.restoreDrill.scope}`);
console.log(`  rateLimiting.authRateLimiting: ${data.rateLimiting.authRateLimiting}`);
console.log(`  rateLimiting.expensiveEndpointRateLimiting: ${data.rateLimiting.expensiveEndpointRateLimiting}`);
console.log(`  deployVerifier.overallVerdict: ${data.deployVerifier.overallVerdict}`);
if (data.summary) {
  console.log(`  standingGaps recorded: ${data.summary.standingGaps.length}`);
}
process.exit(0);
