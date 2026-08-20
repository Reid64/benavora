// ============================================================================
// PT-15-002b — rate-limiting posture on auth and expensive endpoints.
//
// Two parts:
//
//   1. LIVE mechanism test. `src/lib/utils/rate-limit.ts`'s exported
//      `checkRateLimit()` (the one shared, reusable in-process rate limiter
//      in this codebase) is imported directly and actually called past its
//      limit, in-process, to prove the mechanism itself works -- not just
//      that it's present in source. No network call, no production traffic;
//      this only exercises the pure function.
//
//   2. STATIC posture audit. Every route.ts under src/app/api/ai and
//      src/app/api/agents (the "expensive" surface -- Claude/agent-calling,
//      most with maxDuration>=120) is grepped for the presence of (a) a rate
//      limit call (either the shared checkRateLimit or each route's own
//      copy-pasted isRateLimited, both grepped for by name), (b) a
//      role/auth gate (requireRole/requireAuth), and (c) a billing-tier
//      throttle (enforceLimit/withUsageCheck/checkTierGate) -- a different
//      but real protection layer against runaway cost, not a request-rate
//      limit, and recorded as a separate field so the two are never
//      conflated.
//
//      Separately, src/app/api/auth/ is inventoried directly: this app has
//      no server-side login/signup route of its own (confirmed by listing
//      that directory) -- sign-in/sign-up go straight from the browser to
//      Supabase's own GoTrue auth API via the client SDK
//      (src/app/login/LoginPageClient.tsx, src/app/register/RegisterPageClient.tsx).
//      This app's own middleware.ts (read directly, in full) has zero rate-
//      limiting logic of any kind. So: this app cannot rate-limit auth
//      attempts itself, by construction -- whatever protection exists there
//      is entirely Supabase's own platform-level GoTrue rate limits, which
//      are NOT independently re-verified here (no CLI/API path was found in
//      this session to read the project's live auth-rate-limit config
//      values -- `supabase config push` exists but no `pull`/`get`
//      equivalent in this CLI version) -- stated as an open, unverified
//      fact, not assumed either way.
//
// Usage: node scripts/audit/pt15-002-rate-limit-posture.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

import { checkRateLimit } from "../../src/lib/utils/rate-limit.ts";

const REPO_ROOT = process.cwd();
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "pt-15");
const OUT_JSON = path.join(OUT_DIR, "_rate-limit-posture-summary.json");

function listRouteFiles(dir) {
  const results = [];
  function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") results.push(full);
    }
  }
  walk(dir);
  return results;
}

function toRepoRelative(p) {
  return path.relative(REPO_ROOT, p).replace(/\\/g, "/");
}

function classifyRoute(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const hasSharedRateLimit = /checkRateLimit\s*\(/.test(src);
  const hasLocalRateLimit = /function\s+isRateLimited\s*\(/.test(src);
  const hasRoleGate = /requireRole\s*\(/.test(src);
  const hasAuthGate = /requireAuth\s*\(/.test(src) || /auth\.getUser\s*\(/.test(src);
  const hasTierEnforcement = /enforceLimit\s*\(|withUsageCheck\s*\(|checkTierGate\s*\(/.test(src);
  const maxDurationMatch = src.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
  const maxDuration = maxDurationMatch ? Number(maxDurationMatch[1]) : null;

  return {
    file: toRepoRelative(filePath),
    hasRateLimit: hasSharedRateLimit || hasLocalRateLimit,
    rateLimitMechanism: hasSharedRateLimit ? "shared_checkRateLimit" : hasLocalRateLimit ? "local_isRateLimited_copy" : "none",
    hasAuthGate: hasRoleGate || hasAuthGate,
    authMechanism: hasRoleGate ? "requireRole" : hasAuthGate ? "requireAuth_or_getUser" : "none",
    hasTierEnforcement,
    maxDuration,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // --- Part 1: live mechanism test of the shared rate limiter ---------------
  const testKey = `pt15-posture-test-${Date.now()}`;
  const limit = 3;
  const calls = [];
  for (let i = 0; i < 6; i++) {
    calls.push(checkRateLimit(testKey, limit));
  }
  const expectedShape = [true, true, true, false, false, false];
  const mechanismWorksAsDesigned = JSON.stringify(calls) === JSON.stringify(expectedShape);

  // Confirm a DIFFERENT key is unaffected by the first key's exhausted limit
  // (proves the limiter is keyed correctly, not a global counter).
  const otherKey = `pt15-posture-test-other-${Date.now()}`;
  const otherKeyFirstCall = checkRateLimit(otherKey, limit);

  const liveMechanismTest = {
    function: "checkRateLimit (src/lib/utils/rate-limit.ts)",
    testKey,
    limitUsed: limit,
    callResults: calls,
    expectedResults: expectedShape,
    blocksAfterLimitReached: mechanismWorksAsDesigned,
    keyIsolationConfirmed: otherKeyFirstCall === true,
    verdict: mechanismWorksAsDesigned && otherKeyFirstCall === true ? "MECHANISM_CONFIRMED_WORKING" : "MECHANISM_FAILED_LIVE_TEST",
    note:
      "In-process only -- confirmed against Node's own live execution, not a network call. " +
      "This does NOT prove distributed correctness across multiple serverless instances: the " +
      "module's own header comment states plainly that this is per-process, in-memory, and resets " +
      "on cold start/redeploy -- a real, accepted, already-documented limitation for a multi-instance " +
      "Vercel deployment, not newly discovered here.",
  };

  // --- Part 2: auth-surface inventory ----------------------------------------
  const authDir = path.join(REPO_ROOT, "src", "app", "api", "auth");
  const authRouteFiles = listRouteFiles(authDir).map(toRepoRelative);
  const middlewareSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "middleware.ts"), "utf8");
  const middlewareHasRateLimit = /rate.?limit/i.test(middlewareSrc);

  const clientAuthFiles = ["src/app/login/LoginPageClient.tsx", "src/app/register/RegisterPageClient.tsx"].filter((f) =>
    fs.existsSync(path.join(REPO_ROOT, f)),
  );

  const authPosture = {
    customAuthApiRoutes: authRouteFiles,
    hasCustomLoginOrSignupRoute: authRouteFiles.some((f) => /login|signup|signin|register/i.test(f)),
    middlewareHasAnyRateLimitLogic: middlewareHasRateLimit,
    clientSideAuthEntryPoints: clientAuthFiles,
    conclusion:
      "This app has no server-side API route for login or signup -- confirmed by directory listing " +
      "(src/app/api/auth/ contains only callback/ and log-event/, neither of which authenticates a " +
      "credential). Sign-in and sign-up happen entirely client-side via the Supabase JS SDK talking " +
      "directly to Supabase's own GoTrue auth API (LoginPageClient.tsx, RegisterPageClient.tsx). " +
      "src/middleware.ts (read in full) contains zero rate-limiting logic of any kind -- it only " +
      "refreshes the session and redirects unauthenticated/incomplete-onboarding requests. " +
      "Consequence: this application cannot itself rate-limit auth attempts, by construction -- " +
      "there is no app-controlled code in the credential-check path to attach a limiter to. Whatever " +
      "protection exists against auth brute-forcing / credential stuffing is entirely Supabase's own " +
      "platform-level GoTrue rate limits (documented Supabase product behavior for sign-in/sign-up/" +
      "OTP/password-recovery endpoints), which this session did NOT independently re-verify against " +
      "this specific project's live configured values -- no CLI/API read path was found this session " +
      "(`supabase config push` exists, no `pull`/`get` equivalent in the installed CLI version 2.102.0). " +
      "Recorded as an open, unverified-but-plausible fact, not assumed true or false.",
  };

  // --- Part 3: expensive-endpoint (AI/agents) static posture ------------------
  const aiRoutes = listRouteFiles(path.join(REPO_ROOT, "src", "app", "api", "ai")).map(classifyRoute);
  const agentRoutes = listRouteFiles(path.join(REPO_ROOT, "src", "app", "api", "agents")).map(classifyRoute);
  const allExpensiveRoutes = [...aiRoutes, ...agentRoutes];

  const rateLimited = allExpensiveRoutes.filter((r) => r.hasRateLimit);
  const notRateLimited = allExpensiveRoutes.filter((r) => !r.hasRateLimit);
  const notRateLimitedNoAuthGate = notRateLimited.filter((r) => !r.hasAuthGate);
  const notRateLimitedButTierEnforced = notRateLimited.filter((r) => r.hasTierEnforcement);
  const notRateLimitedAndNoTierEnforcement = notRateLimited.filter((r) => !r.hasTierEnforcement);
  const expensiveUnprotected = notRateLimited.filter(
    (r) => !r.hasTierEnforcement && (r.maxDuration === null || r.maxDuration >= 60),
  );

  const expensiveEndpointPosture = {
    totalRoutesScanned: allExpensiveRoutes.length,
    scanScope: "src/app/api/ai/**/route.ts + src/app/api/agents/**/route.ts",
    rateLimitedCount: rateLimited.length,
    notRateLimitedCount: notRateLimited.length,
    notRateLimitedWithNoAuthGateAtAll: notRateLimitedNoAuthGate.map((r) => r.file),
    notRateLimitedButTierEnforcedCount: notRateLimitedButTierEnforced.length,
    notRateLimitedAndNoTierEnforcementCount: notRateLimitedAndNoTierEnforcement.length,
    // The real finding worth surfacing: routes with no rate limit, no
    // billing-tier throttle, AND a long/unbounded maxDuration -- an
    // authenticated user of any allowed role could call these repeatedly
    // with no in-app mechanism slowing them down or capping cost.
    expensiveAndUnprotected: expensiveUnprotected.map((r) => ({
      file: r.file,
      authMechanism: r.authMechanism,
      maxDuration: r.maxDuration,
    })),
    allRoutes: allExpensiveRoutes,
  };

  const summary = {
    task: "PT-15-002b: rate-limiting posture on auth and expensive endpoints",
    generatedAt: new Date().toISOString(),
    liveMechanismTest,
    authPosture,
    expensiveEndpointPosture,
    overallPosture: {
      authRateLimiting: "APP_HAS_NONE — relies entirely on Supabase platform-level GoTrue limits (unverified exact config)",
      expensiveEndpointRateLimiting:
        expensiveUnprotected.length > 0
          ? `PARTIAL — ${rateLimited.length}/${allExpensiveRoutes.length} routes rate-limited; ${expensiveUnprotected.length} route(s) have neither a rate limit nor a billing-tier throttle and run with maxDuration>=60s (or unset)`
          : `${rateLimited.length}/${allExpensiveRoutes.length} routes rate-limited; all remaining routes have at least a billing-tier throttle`,
      mechanismCorrectness: liveMechanismTest.verdict,
    },
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Live mechanism test: ${liveMechanismTest.verdict}`);
  console.log(
    `Expensive endpoints: ${rateLimited.length}/${allExpensiveRoutes.length} rate-limited, ${expensiveUnprotected.length} fully unprotected`,
  );
}

main().catch((err) => {
  console.error(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});
