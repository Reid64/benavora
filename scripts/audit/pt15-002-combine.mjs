// ============================================================================
// PT-15-002 combine — merges the three sub-checks (restore drill, rate-
// limiting posture, deploy-verifier confirmation) into the single deliverable
// test-evidence/pt-15/readiness-ops.json. Run after all three producer
// scripts (pt15-002-restore-drill.mjs, pt15-002-rate-limit-posture.mjs,
// pt15-002-deploy-verifier-check.mjs) have written their own intermediate
// summary files.
//
// Usage: node scripts/audit/pt15-002-combine.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "test-evidence", "pt-15");
const RESTORE_PATH = path.join(OUT_DIR, "_restore-drill-summary.json");
const RATE_LIMIT_PATH = path.join(OUT_DIR, "_rate-limit-posture-summary.json");
const DEPLOY_VERIFIER_PATH = path.join(OUT_DIR, "_deploy-verifier-summary.json");
const FINAL_PATH = path.join(OUT_DIR, "readiness-ops.json");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

for (const [name, p] of [
  ["restore drill", RESTORE_PATH],
  ["rate-limit posture", RATE_LIMIT_PATH],
  ["deploy-verifier check", DEPLOY_VERIFIER_PATH],
]) {
  if (!fs.existsSync(p)) {
    fail(`${p} missing — run the ${name} producer script first.`);
  }
}

const restoreDrill = JSON.parse(fs.readFileSync(RESTORE_PATH, "utf8"));
const rateLimitPosture = JSON.parse(fs.readFileSync(RATE_LIMIT_PATH, "utf8"));
const deployVerifier = JSON.parse(fs.readFileSync(DEPLOY_VERIFIER_PATH, "utf8"));

const combined = {
  task: "PT-15-002: production readiness — restore drill, rate-limiting posture, deploy-verifier confirmation",
  generatedAt: new Date().toISOString(),

  restoreDrill: {
    scope: restoreDrill.scope, // "PROVEN" or "PENDING-SCOPE"
    method: restoreDrill.method,
    conclusion: restoreDrill.conclusion,
    censusSummary: restoreDrill.censusSummary,
    integrityVerdict: restoreDrill.integrity?.overallVerdict,
    detail: restoreDrill,
  },

  rateLimiting: {
    authRateLimiting: rateLimitPosture.overallPosture.authRateLimiting,
    expensiveEndpointRateLimiting: rateLimitPosture.overallPosture.expensiveEndpointRateLimiting,
    liveMechanismVerdict: rateLimitPosture.overallPosture.mechanismCorrectness,
    expensiveAndUnprotectedCount: rateLimitPosture.expensiveEndpointPosture.expensiveAndUnprotected.length,
    detail: rateLimitPosture,
  },

  deployVerifier: {
    wgrReference: deployVerifier.wgrReference,
    standingGapResolved: deployVerifier.standingGap.resolved,
    overallVerdict: deployVerifier.overallVerdict,
    detail: deployVerifier,
  },

  summary: {
    restoreDrillProven: restoreDrill.scope === "PROVEN" && restoreDrill.integrity?.overallVerdict === "PASS",
    rateLimitingPostureRecorded: true,
    deployVerifierNeverFalselyPasses: deployVerifier.overallVerdict.startsWith("CONFIRMED"),
    standingGaps: [
      "WGR-002 (deploy-verifier PENDING/INDETERMINATE without VERCEL_TOKEN/VERCEL_PROJECT_ID) remains open — not resolved by this session, only re-confirmed to still be handled honestly (no false PASS).",
      ...(rateLimitPosture.expensiveEndpointPosture.expensiveAndUnprotected.length > 0
        ? [
            `${rateLimitPosture.expensiveEndpointPosture.expensiveAndUnprotected.length} expensive (Claude/agent-calling, maxDuration>=60s) API routes under src/app/api/ai and src/app/api/agents have neither request-rate limiting nor billing-tier cost throttling — role-gated (mostly requireRole writer+) but otherwise unprotected against repeated/runaway calls. See WGR-153.`,
          ]
        : []),
      "This app has no server-side auth (login/signup) API route of its own and no rate-limiting logic anywhere in src/middleware.ts — auth-attempt throttling is entirely delegated to Supabase's own platform-level GoTrue rate limits, whose exact configured values for this project were NOT independently verified this session (no read-only CLI/API path was found).",
    ],
  },
};

fs.writeFileSync(FINAL_PATH, JSON.stringify(combined, null, 2), "utf8");
console.log(`Wrote ${FINAL_PATH}`);
console.log(`restoreDrillProven: ${combined.summary.restoreDrillProven}`);
console.log(`deployVerifierNeverFalselyPasses: ${combined.summary.deployVerifierNeverFalselyPasses}`);
console.log(`standingGaps: ${combined.summary.standingGaps.length}`);
process.exit(0);
