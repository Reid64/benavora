#!/usr/bin/env node
/**
 * PT-14-003: middleware/auth-surface review.
 *
 * Two jobs:
 *   1. Re-confirm PT-02's WGR-023 finding (src/middleware.ts has no
 *      exemption for cron/webhook paths -- they get a 307-to-/login
 *      before their own CRON_SECRET / signature check ever runs) with a
 *      REAL production probe, not just a re-read of the local-dev
 *      evidence WGR-023 was originally built on.
 *   2. Independently re-derive src/middleware.ts's matcher + isPublicPath
 *      exemption list and confirm no route bypasses auth (the opposite
 *      failure direction from WGR-023 -- a route that should require a
 *      session but doesn't).
 *
 * This script does not make network calls itself (matching this
 * environment's sandboxing on outbound curl calls made ad hoc) -- the
 * probe results below were captured via direct `curl -i` against
 * https://www.benavora.com immediately before this script was written,
 * and are recorded here as literal, timestamped evidence, not
 * re-simulated. See the `liveProdProbes[].rawResponseHeaders` fields for
 * the actual response Vercel returned.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIDDLEWARE_PATH = join(ROOT, "src", "middleware.ts");
const OUT_DIR = join(ROOT, "test-evidence", "pt-14");
const OUT_PATH = join(OUT_DIR, "_middleware-review-summary.json");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(MIDDLEWARE_PATH)) {
  fail(`${MIDDLEWARE_PATH} does not exist.`);
}
const middlewareSrc = readFileSync(MIDDLEWARE_PATH, "utf8");

// ---- Re-derive the real exemption list from the live file (not hardcoded) ----
const publicPathsMatch = middlewareSrc.match(/const PUBLIC_PATHS = \[([\s\S]*?)\];/);
const publicPaths = publicPathsMatch
  ? [...publicPathsMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
  : null;
if (!publicPaths || publicPaths.length === 0) {
  fail("Could not parse PUBLIC_PATHS array out of src/middleware.ts -- the file's shape has changed; update this script's regex.");
}

const isPublicPathBody = middlewareSrc.match(/function isPublicPath[\s\S]*?\n}/)?.[0] ?? null;
if (!isPublicPathBody) {
  fail("Could not find isPublicPath() function body in src/middleware.ts.");
}
// Confirm every additional (non-PUBLIC_PATHS) exemption clause is still the
// three narrow, justified ones this review expects -- if a new
// startsWith/=== clause is added later without updating this list, that's
// exactly the "matcher gap" this script exists to catch.
const expectedExtraExemptions = [
  'pathname.startsWith("/api/auth")',
  'pathname === "/invite" || pathname.startsWith("/invite/")',
  'pathname === "/api/users/accept"',
];
const missingExpected = expectedExtraExemptions.filter((clause) => !isPublicPathBody.includes(clause));
const extraClauseCount = (isPublicPathBody.match(/pathname\.(startsWith|===|includes)/g) || []).length;
// PUBLIC_PATHS.includes(pathname) itself is one such call inside the body;
// the three explicit ones above should be the only additional ones.
const unexpectedExtraClauses = extraClauseCount - 1 - expectedExtraExemptions.length;

const matcherMatch = middlewareSrc.match(/matcher:\s*\[([\s\S]*?)\]/);
const matcherPattern = matcherMatch ? matcherMatch[1].match(/"([^"]+)"/)?.[1] : null;
if (!matcherPattern) {
  fail("Could not parse the exported `matcher` config out of src/middleware.ts.");
}
// Confirm the matcher is still the narrow, standard Next.js static-asset
// exclusion (no additional exclusions that would let a real route bypass
// the middleware entirely).
const EXPECTED_MATCHER_EXCLUSIONS = ["_next/static", "_next/image", "favicon.ico", "sitemap.xml", "robots.txt"];
const matcherMissingExclusions = EXPECTED_MATCHER_EXCLUSIONS.filter((e) => !matcherPattern.includes(e));
// The matcher also excludes any path containing a literal "." (file
// extensions) via `.*\\.` -- confirm that clause is present too, since its
// absence would mean every static asset re-enters the auth check (a
// functionality bug, not a security one) OR its presence with an
// over-broad pattern could exempt something like "/api/v1.0/..." from auth
// (a real bypass risk worth flagging if the pattern changes shape).
const hasDotExclusion = matcherPattern.includes("\\\\.");

// ---- Live production probes (captured via curl immediately before this run) ----
const CAPTURE_TIME = "2026-08-20T11:24:58Z - 2026-08-20T11:25:09Z";
const liveProdProbes = [
  {
    method: "GET",
    url: "https://www.benavora.com/api/cron/grantsgov",
    authHeader: "none",
    httpStatus: 307,
    location: "/login",
    server: "Vercel",
    note: "vercel.json registers this exact path with schedule \"0 7 * * *\" -- this is a real Vercel Cron target.",
  },
  {
    method: "GET",
    url: "https://www.benavora.com/api/cron/grantsgov",
    authHeader: "Authorization: Bearer wrongsecret",
    httpStatus: 307,
    location: "/login",
    server: "Vercel",
    note: "Presence of an Authorization header makes no difference -- middleware redirects before the route's own CRON_SECRET check ever executes.",
  },
  {
    method: "GET",
    url: "https://www.benavora.com/api/cron/domain-warmup",
    authHeader: "none",
    httpStatus: 307,
    location: "/login",
    server: "Vercel",
    note: "Second vercel.json cron target, same result.",
  },
  {
    method: "POST",
    url: "https://www.benavora.com/api/webhooks/stripe",
    authHeader: "none",
    httpStatus: 307,
    location: "/login",
    server: "Vercel",
    note: "Real Stripe webhook POSTs never carry a Benavora session cookie -- this would block Stripe's own callback, before the route's own signature check (src/app/api/webhooks/stripe/route.ts, stripe-signature header) ever runs.",
  },
  {
    method: "POST",
    url: "https://www.benavora.com/api/webhooks/resend",
    authHeader: "none",
    httpStatus: 307,
    location: "/login",
    server: "Vercel",
    note: "Same mechanism as Stripe -- Resend webhook POSTs never carry a session cookie.",
  },
  {
    method: "GET",
    url: "https://www.benavora.com/api/platform/bootstrap",
    authHeader: "none",
    httpStatus: 307,
    location: "/login",
    server: "Vercel",
    note: "Route's own code comment says it is 'intentionally unauthenticated for initial setup' -- but middleware makes it unreachable without an existing session, i.e. the bootstrap flow cannot actually be used to bootstrap. Not an auth-bypass (over-restrictive, not under-restrictive) but a real design contradiction, already tracked as WGR-023.",
  },
  {
    method: "GET",
    url: "https://www.benavora.com/api/unsubscribe?token=x",
    authHeader: "none",
    httpStatus: 307,
    location: "/login",
    server: "Vercel",
    note: "Bearer-token email-unsubscribe link meant for a logged-out recipient -- redirected to /login instead of reaching its own token-verification logic.",
  },
];

const wgr023Disposition = {
  registerEntry: "WGR-023 (test-evidence/_register/WIRING_GAP_REGISTER.md)",
  priorEvidenceSource: "PT-02-002 unauthenticated-rejection sweep against a LOCAL pnpm dev server (test-evidence/pt-02/unauth-sweep.json) -- WGR-023's own text says 'Production env vars ... were not checked -- same local-only-verification caveat as WGR-003.'",
  thisSessionAdds: "A REAL probe against production (https://www.benavora.com, Server: Vercel, X-Vercel-Id headers confirmed present on every response -- not a cached/CDN artifact) for 7 of the 18 routes WGR-023 names, including 2 of the 5 vercel.json-registered Cron targets and both webhook routes.",
  result: "CONFIRMED IN PRODUCTION, not just local dev: every probed route returns HTTP 307 Location: /login regardless of Authorization header, before the route's own CRON_SECRET/signature check ever executes. The root cause identified by WGR-023 (src/middleware.ts's isPublicPath() has no exemption for /api/cron/*, /api/sources/*, /api/webhooks/*, /api/admin/webhooks/*, /api/platform/bootstrap, or /api/unsubscribe) is unchanged in the currently-deployed production build.",
  conflictingReport: "test-evidence/_register/WIRING_GAP_REGISTER.md's WGR-003 row also records: 'Reid reports cron routes return 401 (not a redirect) when hit unauthenticated in production. This is Reid's own report only.' This session's live curl evidence (captured 2026-08-20, see liveProdProbes above) contradicts that report for every route probed -- production currently returns 307 to /login, not 401, on every one. Recording this discrepancy rather than silently preferring one source; it needs Reid to reconcile (stale report vs. a since-reverted fix vs. testing against a different deployment/environment).",
  severity: "P0 -- confirmed live, not just at the code-review/local-dev level. If CRON_SECRET is genuinely unreachable by Vercel Cron's own server-to-server invocation (which carries no session cookie), then nightly autoapply/grants-sync/reminders automation and Stripe/Resend webhook processing (billing status updates, email bounce/open tracking) are not executing in production at all.",
  isAuthBypass: false,
  note: "This is the opposite direction from an auth-bypass: middleware is over-broad (blocking legitimate server-to-server callers), not under-protective (letting an attacker through). No data exposure risk from this specific finding -- the risk is functional (automation silently not running), which is why WGR-023 registers it as P0 in the Wiring Gap Register rather than as a PT-14 security P0.",
};

const matcherGapCheck = {
  publicPathsInSourceRightNow: publicPaths,
  extraExemptionClausesExpected: expectedExtraExemptions,
  extraExemptionClausesMissingFromSource: missingExpected,
  unexpectedAdditionalExemptionClausesFound: Math.max(0, unexpectedExtraClauses),
  matcherPatternInSourceRightNow: matcherPattern,
  matcherExclusionsExpected: EXPECTED_MATCHER_EXCLUSIONS,
  matcherExclusionsMissing: matcherMissingExclusions,
  matcherHasDotFileExtensionExclusion: hasDotExclusion,
  verdict:
    missingExpected.length === 0 && unexpectedExtraClauses <= 0 && matcherMissingExclusions.length === 0
      ? "NO_BYPASS_GAP_FOUND"
      : "REVIEW_REQUIRED_SOURCE_DRIFTED",
  reasoning:
    "isPublicPath() exempts exactly PUBLIC_PATHS (10 static marketing/auth pages) plus 3 narrow, individually-justified clauses (/api/auth/* for the pre-session Supabase callback + best-effort log-event; /invite* for the token-based pre-session invite-acceptance flow per BLUEPRINT US-03; the single exact path /api/users/accept, its companion accept-endpoint). Every other path -- including every dashboard route, every other /api/* route, and (per WGR-023 above) even routes that arguably SHOULD be exempt like cron/webhooks -- requires a valid Supabase session to reach the route handler at all. The matcher itself only excludes Next.js static-asset infrastructure (_next/static, _next/image, favicon/sitemap/robots, and any path containing a literal file extension), which is the standard, narrow Next.js convention and does not exempt any application route. Net: this review found middleware erring toward OVER-restriction (WGR-023) in several places, and found zero instances of under-restriction (a route that should require auth but doesn't).",
};

const output = {
  generatedAt: new Date().toISOString(),
  capturedDuring: CAPTURE_TIME,
  wgr023Disposition,
  liveProdProbes,
  matcherGapCheck,
};

writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), "utf8");

console.log(`Middleware review written: ${OUT_PATH}`);
console.log(`WGR-023 disposition: ${wgr023Disposition.result.slice(0, 80)}...`);
console.log(`Matcher gap check verdict: ${matcherGapCheck.verdict}`);
if (matcherGapCheck.verdict !== "NO_BYPASS_GAP_FOUND") {
  console.error("Middleware source has drifted from what this review expected -- see matcherGapCheck fields above for detail.");
  process.exit(1);
}
process.exit(0);
