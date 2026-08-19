// ============================================================================
// PT-02-002 -- unauthenticated-rejection sweep over the full API-route working set
//
// For every route in test-evidence/pt-02/api-routes.json (318 routes), issues one
// UNAUTHENTICATED request (zero cookies, zero Authorization header, zero secret/token)
// with the route's primary method: GET where the route exports it, else the first
// mutation method the route actually exports (POST/PATCH/PUT/DELETE, in that
// preference order) with a minimal `{}` JSON body -- per this task's own instruction,
// safe because the expected result is rejection BEFORE any write. Dynamic segments are
// filled with a placeholder id/slug so the route is reachable (not a 404-by-shape).
//
// Classifies each route's expected behavior from its real, live-verified auth
// mechanism (this session read middleware.ts and every none_detected route's source
// directly -- see NONE_DETECTED_OVERRIDE below), then records the ACTUAL observed
// status/location and a verdict. This app's middleware (src/middleware.ts) is the
// primary gate for almost every route -- confirmed live this session: an unauthenticated
// request to a non-public path gets a 307 redirect to /login from middleware itself,
// before the route's own requireRole()/auth.getUser()/CRON_SECRET/signature check ever
// runs. A redirect to /login is treated as a valid, safe rejection (no data exposure) --
// the literal "401/403" the task describes is one of two safe outcomes this app
// actually produces, not the only one.
//
// The one thing this sweep exists to catch: a route whose classified mechanism requires
// a credential, but that returns a real 2xx to a request carrying none. That is a
// register-worthy P0 auth-bypass finding, independent of which safe-rejection shape
// every other route takes.
//
// Writes test-evidence/pt-02/unauth-sweep.json: one row per route with
// { path, method, status, location, expected, category, verdict, note?, bodySnippet? }.
// ASCII only. Node 20 compatible (uses only global fetch, node:fs, node:path).
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..");
const BASE_URL = process.env.PT02_BASE_URL || "http://localhost:3000";
const API_ROUTES_PATH = path.join(REPO_ROOT, "test-evidence", "pt-02", "api-routes.json");
const OUT_PATH = path.join(REPO_ROOT, "test-evidence", "pt-02", "unauth-sweep.json");

const PLACEHOLDER_UUID = "00000000-0000-0000-0000-000000000000";
const PLACEHOLDER_SLUG = "unauth-sweep-slug";

function fillDynamicSegments(routePath) {
  return routePath
    .replace(/\[\[\.\.\.[^\]]+\]\]/g, PLACEHOLDER_SLUG)
    .replace(/\[\.\.\.[^\]]+\]/g, PLACEHOLDER_SLUG)
    .replace(/\[[^\]]+\]/g, PLACEHOLDER_UUID);
}

const METHOD_PREFERENCE = ["GET", "POST", "PATCH", "PUT", "DELETE"];
function pickMethod(methods) {
  for (const m of METHOD_PREFERENCE) {
    if (methods.includes(m)) return m;
  }
  return methods[0] || "GET";
}

// pt02-001's static classifier correctly flags 8 routes as none_detected (no
// requireRole/requireAuth/checkPermission/auth.getUser/cron_secret/webhook_signature/
// oauth_code_exchange pattern found by source inspection) and explicitly defers their
// real classification to a later phase (its own header comment says so). This is that
// phase: every one of the 8 was read in full this session, cross-referenced against
// src/middleware.ts's real PUBLIC_PATHS/isPublicPath logic, and live-curl-verified.
// Do not silently treat an unmapped none_detected route as safe -- classify() below
// falls through to UNCLASSIFIED for anything not listed here.
const NONE_DETECTED_OVERRIDE = {
  "/api/calendar/callback": {
    category: "session",
    note:
      "Google Calendar OAuth callback. Not in middleware PUBLIC_PATHS/isPublicPath -- " +
      "middleware requires a Benavora session to reach it. In the real flow the same " +
      "browser tab that initiated the OAuth handshake still carries the Benavora session " +
      "cookie when Google redirects back, so this does not break the real user flow, but " +
      "it does mean a truly credential-less caller cannot reach it either.",
  },
  "/api/onboarding": {
    category: "session",
    note: "Own code also checks x-organization-id/x-user-id headers, which only middleware injects after a valid session.",
  },
  "/api/onboarding/complete-setup": {
    category: "session",
    note: "Own code also checks x-organization-id/x-user-id headers, which only middleware injects after a valid session.",
  },
  "/api/onboarding/generate-narratives": {
    category: "session",
    note: "Own code also checks x-organization-id header, which only middleware injects after a valid session.",
  },
  "/api/platform/bootstrap": {
    category: "intended-public-but-middleware-blocked",
    note:
      "Route's own code comment: 'This endpoint is intentionally unauthenticated for " +
      "initial setup, but self-disables after first platform_owner is created.' Middleware " +
      "requires a session for this path (not in PUBLIC_PATHS), contradicting that design. " +
      "Not an auth-bypass -- middleware rejects with no data exposure -- but the route's own " +
      "documented reachability is currently false. See WGR-023.",
  },
  "/api/sources/state-portals": {
    category: "session",
    note:
      "Route itself has zero auth/role check of its own; protection is entirely " +
      "middleware's session gate (any authenticated user of any role can call it -- an " +
      "authorization-granularity question, out of this sweep's unauthenticated-rejection scope).",
  },
  "/api/unsubscribe": {
    category: "intended-public-but-middleware-blocked",
    note:
      "Bearer-token unsubscribe link, meant to work for a logged-out email recipient " +
      "(already flagged by pt02-001 as possibleMiddlewareConflict=true). Middleware requires " +
      "a session for this path (not in PUBLIC_PATHS), so a real recipient without an active " +
      "Benavora session is redirected to /login instead of the unsubscribe confirmation page. " +
      "Not an auth-bypass -- registered separately as WGR-023.",
  },
  "/api/users/accept": {
    category: "public",
    note: "Exact-matched in middleware PUBLIC_PATHS (isPublicPath). Genuinely public, invite-token-in-body authed.",
  },
};

function classify(route) {
  const mech = route.auth.mechanism;
  if (["requireRole", "requireAuth", "checkPermission", "auth.getUser"].includes(mech)) {
    return {
      category: "session",
      expected: "401, 403, or a redirect to /login (middleware session gate runs before the route's own check)",
    };
  }
  if (mech === "cron_secret" || mech === "webhook_signature") {
    return {
      category: "secret",
      expected:
        "401, 403, 400, or a redirect to /login (this app's middleware is not path-exempted for " +
        "cron/webhook routes, so it rejects before the route's own CRON_SECRET/signature check runs)",
    };
  }
  if (mech === "oauth_code_exchange") {
    return { category: "public", expected: "200 or a redirect (public callback; own logic redirects when required params are absent)" };
  }
  if (mech === "none_detected") {
    const override = NONE_DETECTED_OVERRIDE[route.path];
    if (!override) {
      return {
        category: "UNCLASSIFIED",
        expected: "unknown -- none_detected route with no override entry, requires manual classification before trusting this row",
        note: "pt02-002's NONE_DETECTED_OVERRIDE map does not cover this path. Do not assume safe.",
      };
    }
    if (override.category === "public") {
      return { category: "public", expected: "200, redirect, or a 4xx from the route's own token validation", note: override.note };
    }
    if (override.category === "session") {
      return {
        category: "session",
        expected: "401, 403, or a redirect to /login (middleware session gate)",
        note: override.note,
      };
    }
    if (override.category === "intended-public-but-middleware-blocked") {
      return {
        category: "intended-public-but-blocked",
        expected: "route intends unauthenticated reachability; middleware currently requires a session first",
        note: override.note,
      };
    }
  }
  return { category: "UNCLASSIFIED", expected: `unknown mechanism: ${mech}`, note: "unrecognized auth mechanism, requires manual classification" };
}

function isRedirectToLogin(status, location) {
  return status >= 300 && status < 400 && typeof location === "string" && location.includes("/login");
}

function verdictFor(category, status, location) {
  const redirectsToLogin = isRedirectToLogin(status, location);
  const is2xx = status >= 200 && status < 300;

  if (category === "session" || category === "secret") {
    if (status === 401 || status === 403) return "PASS";
    if (redirectsToLogin) return "PASS";
    if (is2xx) return "FINDING_P0_AUTH_BYPASS";
    if (status >= 500) return "REVIEW"; // server error is ambiguous, not a confirmed bypass, but not a clean pass either
    if (status === 400 || status === 404 || status === 405 || status === 429) return "PASS"; // rejected, no data returned
    return "REVIEW"; // any other shape (e.g. a redirect NOT to /login) needs a human look
  }

  if (category === "public") {
    if (status >= 500) return "REVIEW";
    if (status >= 200 && status < 500) return "PASS";
    return "REVIEW";
  }

  if (category === "intended-public-but-blocked") {
    // The route wants to be reachable without a session; middleware currently blocks it.
    // Not a security bypass either way -- record which side of that contradiction the
    // live server is actually on today.
    if (redirectsToLogin) return "PASS_DESIGN_MISMATCH";
    if (is2xx) return "PASS"; // actually reachable as designed -- even better
    if (status === 400 || status === 404) return "PASS"; // reached the route, rejected on its own token check
    return "REVIEW";
  }

  return "REVIEW"; // UNCLASSIFIED
}

async function testRoute(route) {
  const method = pickMethod(route.methods);
  const filledPath = fillDynamicSegments(route.path);
  const url = BASE_URL + filledPath;
  const { category, expected, note } = classify(route);

  const fetchOpts = {
    method,
    redirect: "manual",
    headers: { Accept: "application/json" },
  };
  if (method !== "GET") {
    fetchOpts.headers["Content-Type"] = "application/json";
    fetchOpts.body = "{}";
  }

  const row = {
    path: route.path,
    method,
    mechanism: route.auth.mechanism,
    category,
    expected,
    status: null,
    location: null,
    verdict: null,
  };
  if (note) row.note = note;

  try {
    const resp = await fetch(url, fetchOpts);
    row.status = resp.status;
    row.location = resp.headers.get("location");
    row.verdict = verdictFor(category, row.status, row.location);
    if (row.verdict === "FINDING_P0_AUTH_BYPASS" || row.verdict === "REVIEW") {
      let bodySnippet = "";
      try {
        bodySnippet = (await resp.text()).slice(0, 2000);
      } catch {
        bodySnippet = "(could not read response body)";
      }
      row.bodySnippet = bodySnippet;
      row.responseHeaders = Object.fromEntries(resp.headers.entries());
    }
  } catch (err) {
    row.status = null;
    row.verdict = "REVIEW";
    row.error = `fetch failed: ${err.message.split("\n")[0]}`;
  }

  return row;
}

async function main() {
  const apiRoutesFile = JSON.parse(fs.readFileSync(API_ROUTES_PATH, "utf8"));
  const routes = apiRoutesFile.apiRoutes;
  console.log(`PT-02-002: ${routes.length} API route(s) to sweep, unauthenticated, against ${BASE_URL}`);

  const results = [];
  let done = 0;
  for (const route of routes) {
    const row = await testRoute(route);
    results.push(row);
    done++;
    if (done % 50 === 0 || done === routes.length) {
      console.log(`  ${done}/${routes.length} tested...`);
    }
  }

  const verdictCounts = {};
  for (const r of results) {
    verdictCounts[r.verdict] = (verdictCounts[r.verdict] || 0) + 1;
  }
  const p0Findings = results.filter((r) => r.verdict === "FINDING_P0_AUTH_BYPASS");
  const reviewRows = results.filter((r) => r.verdict === "REVIEW");
  const designMismatchRows = results.filter((r) => r.verdict === "PASS_DESIGN_MISMATCH");

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        sourceApiRoutes: path.relative(REPO_ROOT, API_ROUTES_PATH).replace(/\\/g, "/"),
        totalRoutes: results.length,
        verdictCounts,
        p0FindingCount: p0Findings.length,
        reviewCount: reviewRows.length,
        designMismatchCount: designMismatchRows.length,
        results,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`\nPT-02-002 DONE: ${results.length} routes swept.`);
  console.log(`  Verdict counts: ${JSON.stringify(verdictCounts)}`);
  if (p0Findings.length > 0) {
    console.log(`\n  *** ${p0Findings.length} P0 AUTH-BYPASS FINDING(S) ***`);
    for (const f of p0Findings) {
      console.log(`    [${f.method}] ${f.path} (${f.mechanism}) -> HTTP ${f.status}`);
    }
  } else {
    console.log("  No P0 auth-bypass findings.");
  }
  if (reviewRows.length > 0) {
    console.log(`\n  ${reviewRows.length} row(s) need manual REVIEW:`);
    for (const r of reviewRows) {
      console.log(`    [${r.method}] ${r.path} (${r.mechanism}) -> status=${r.status} location=${r.location} ${r.error || ""}`);
    }
  }
  if (designMismatchRows.length > 0) {
    console.log(`\n  ${designMismatchRows.length} route(s) flagged PASS_DESIGN_MISMATCH (safe, but contradicts the route's own documented intent -- see WGR-023):`);
    for (const r of designMismatchRows) {
      console.log(`    [${r.method}] ${r.path}`);
    }
  }
  console.log(`\nResults written to ${path.relative(REPO_ROOT, OUT_PATH)}`);
}

main().catch((err) => {
  console.error("PT-02-002 FATAL:", err);
  process.exit(1);
});
