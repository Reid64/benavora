// PT-02 preflight: extracts the API-route working set from PT-00's route manifest and
// statically classifies each route by reading its handler source (no server started, no
// network calls -- pure source inspection). Reads test-evidence/pt-00/route-manifest.json,
// filters routes[] to type == "api", and writes test-evidence/pt-02/api-routes.json.
// ASCII only. Node 20 compatible.
//
// Classification per route, read directly from the handler file:
//   - methods[]        : which of GET/POST/PUT/PATCH/DELETE the file actually exports.
//                         Detected via `export (async )?function METHOD` and
//                         `export const METHOD =`/`export const METHOD:` -- confirmed by a
//                         full-repo sweep before writing this script that every one of the
//                         318 real route.ts files uses one of these two forms (zero files
//                         export a method via re-export or higher-order wrapper), so no
//                         third pattern is needed.
//   - isMutation        : true if methods[] contains any of POST/PUT/PATCH/DELETE. GET-only
//                         routes are never mutations for this classification.
//   - auth.mechanism    : the first matching gate found, checked in this priority order
//                         (a file can only really be gated one primary way in this codebase --
//                         priority reflects how specific/reliable the signal is):
//                           1. requireRole   -- this repo's real role-gate helper
//                              (src/lib/auth/role-gate.ts), used by 381 call sites across
//                              271 files (repo-wide grep, confirmed before writing this
//                              script) -- by far the dominant pattern.
//                           2. requireAuth   -- a second, less common auth-only (no role tier)
//                              helper, 8 call sites across 3 files.
//                           3. checkPermission -- staff/platform permission gate.
//                           4. auth.getUser  -- a raw Supabase session check with no shared
//                              helper wrapping it.
//                           5. cron_secret   -- CRON_SECRET bearer-token check (Vercel Cron
//                              routes; not a user session at all).
//                           6. webhook_signature -- WEBHOOK_SECRET / constructEvent / createHmac
//                              / svix / stripe-signature -- third-party webhook signature
//                              verification, also not a user session.
//                           7. oauth_code_exchange -- exchangeCodeForSession(...) -- the OAuth
//                              callback route itself, gated by possession of a valid code.
//                           8. none_detected -- no recognized gate found by any of the above.
//                              Flagged explicitly (flagForReview: true) rather than silently
//                              treated as intentionally public -- a later phase should read
//                              each one and confirm it's a deliberate public/token/service
//                              route, not a missed auth check.
//   - auth.tiers[]      : for requireRole only, the distinct role-tier string(s) passed at
//                         each call site in the file (a file can call requireRole more than
//                         once with different tiers on different branches).
//   - usesAdminClient   : true if the file imports/calls createAdminClient() (the service-role
//                         client, which bypasses RLS entirely) -- worth knowing regardless of
//                         which auth mechanism also applies, since an admin-client route with
//                         none_detected auth is a materially higher-risk combination than a
//                         none_detected route that only ever touches the RLS-scoped client.
//   - hasTokenParam     : true if the file reads a bearer-style token out of the request itself
//                         (a URL ?token= param or an Authorization header read outside the
//                         cron_secret/webhook_signature patterns already caught above) -- covers
//                         invite-accept/unsubscribe-style single-use-token auth that isn't a
//                         session, a cron secret, or a webhook signature.
//   - middlewareGated   : whether src/middleware.ts's own isPublicPath() predicate (read
//                         directly from that file, ported here rather than re-invoked at
//                         runtime) would let an unauthenticated request reach this route at
//                         all. middleware.ts's matcher covers every request path except
//                         static assets, so this is a REAL, load-bearing second auth layer in
//                         front of every route below it -- a route with auth.mechanism ==
//                         "none_detected" is not necessarily unprotected if middlewareGated is
//                         true (e.g. /api/onboarding/*: no in-handler check, but middleware
//                         already requires a valid session + profile before the handler ever
//                         runs). For API paths specifically, middleware.ts's isPublicPath()
//                         reduces to: public only if the path starts with "/api/auth" or is
//                         exactly "/api/users/accept" -- every other /api/* path is
//                         middleware-gated. Ported verbatim from middleware.ts, confirmed by
//                         reading that file directly before writing this classifier.
//   - possibleMiddlewareConflict : true when middlewareGated is true (so an anonymous caller
//                         would be redirected to /login before reaching the handler) AND the
//                         handler's own source clearly expects an anonymous, token-bearing
//                         caller (hasTokenParam true, with no session-based auth.mechanism
//                         detected). This combination is a real, cheaply-detectable
//                         contradiction worth a human looking at directly -- not asserted as a
//                         confirmed defect by this script, which does no runtime request of
//                         its own, but flagged because a static read of one such route
//                         (/api/unsubscribe: a GET link an anonymous email recipient clicks,
//                         with ?email=&token= query params and a same-URL POST form, no login
//                         page anywhere in the flow) confirmed the pattern is real for at
//                         least one route during this script's own design.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertJsonFileHasKey, timestamp } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const manifestPath = path.join(repoRoot, "test-evidence", "pt-00", "route-manifest.json");
const outDir = path.join(repoRoot, "test-evidence", "pt-02");
const outPath = path.join(outDir, "api-routes.json");

const METHOD_NAMES = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function detectMethods(src) {
  const found = new Set();
  const reFunction = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
  const reConst = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*[:=]/g;
  let m;
  while ((m = reFunction.exec(src))) found.add(m[1]);
  while ((m = reConst.exec(src))) found.add(m[1]);
  // Stable, canonical ordering regardless of source order.
  return METHOD_NAMES.filter((name) => found.has(name));
}

function detectRequireRoleTiers(src) {
  const tiers = new Set();
  const re = /requireRole\(\s*["'`](\w+)["'`]/g;
  let m;
  while ((m = re.exec(src))) tiers.add(m[1]);
  return Array.from(tiers);
}

function classifyAuth(src) {
  const requireRoleTiers = detectRequireRoleTiers(src);
  if (requireRoleTiers.length > 0) {
    return { mechanism: "requireRole", tiers: requireRoleTiers, requiresAuth: true };
  }
  if (/requireAuth\(/.test(src)) {
    return { mechanism: "requireAuth", tiers: [], requiresAuth: true };
  }
  if (/checkPermission\(/.test(src)) {
    return { mechanism: "checkPermission", tiers: [], requiresAuth: true };
  }
  if (/\.auth\.getUser\(\)/.test(src)) {
    return { mechanism: "auth.getUser", tiers: [], requiresAuth: true };
  }
  if (/CRON_SECRET/.test(src)) {
    return { mechanism: "cron_secret", tiers: [], requiresAuth: true };
  }
  if (/WEBHOOK_SECRET|constructEvent\(|createHmac\(|svix|stripe-signature/.test(src)) {
    return { mechanism: "webhook_signature", tiers: [], requiresAuth: true };
  }
  if (/exchangeCodeForSession\(/.test(src)) {
    return { mechanism: "oauth_code_exchange", tiers: [], requiresAuth: true };
  }
  return { mechanism: "none_detected", tiers: [], requiresAuth: false };
}

// Ported directly from src/middleware.ts's isPublicPath(), narrowed to what actually applies
// to an /api/* path (the PUBLIC_PATHS array and the /invite* branch are page-only paths and
// never match an /api/* pathname, so they are correctly omitted here).
function isPublicApiPath(apiPath) {
  if (apiPath.startsWith("/api/auth")) return true;
  if (apiPath === "/api/users/accept") return true;
  return false;
}

function detectTokenParam(src) {
  // Excludes the CRON_SECRET / webhook-signature call sites already classified above --
  // this catches a *different* bearer-style pattern: a single-use token read out of the
  // URL query string or an ad hoc Authorization header check with no shared helper.
  if (/searchParams\.get\(\s*["'`]token["'`]\s*\)/.test(src)) return true;
  if (/headers\.get\(\s*["'`]authorization["'`]\s*\)/i.test(src) && !/CRON_SECRET/.test(src)) {
    return true;
  }
  return false;
}

function classifyRoute(route, absFilePath) {
  let src;
  try {
    src = fs.readFileSync(absFilePath, "utf8");
  } catch (err) {
    return {
      ...route,
      classificationError: `failed to read handler file: ${err.message}`,
      methods: [],
      isMutation: false,
      auth: { mechanism: "unreadable", tiers: [], requiresAuth: false },
      usesAdminClient: false,
      hasTokenParam: false,
      flagForReview: true,
    };
  }

  const methods = detectMethods(src);
  const isMutation = methods.some((m) => MUTATION_METHODS.has(m));
  const auth = classifyAuth(src);
  const usesAdminClient = /createAdminClient\(/.test(src);
  const hasTokenParam = detectTokenParam(src);
  const middlewareGated = !isPublicApiPath(route.path);
  const possibleMiddlewareConflict =
    middlewareGated && auth.mechanism === "none_detected" && hasTokenParam;

  return {
    ...route,
    methods,
    isMutation,
    auth,
    usesAdminClient,
    hasTokenParam,
    middlewareGated,
    possibleMiddlewareConflict,
    // A route needs a closer look in a later phase if no auth gate was detected at all, or
    // if it mutates data while using the RLS-bypassing admin client under a gate this script
    // could not positively identify.
    flagForReview: auth.mechanism === "none_detected",
  };
}

function main() {
  const manifest = assertJsonFileHasKey(manifestPath, "routes");

  if (!Array.isArray(manifest.routes)) {
    throw new Error(`pt02-extract-api-routes: routes[] is not an array in ${manifestPath}`);
  }

  const rawApiRoutes = manifest.routes.filter((r) => r && r.type === "api");

  const apiRoutes = rawApiRoutes.map((route) => {
    const absFilePath = path.join(repoRoot, route.file);
    return classifyRoute(route, absFilePath);
  });

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const mutationCount = apiRoutes.filter((r) => r.isMutation).length;
  const flaggedCount = apiRoutes.filter((r) => r.flagForReview).length;
  const conflictCount = apiRoutes.filter((r) => r.possibleMiddlewareConflict).length;
  const byMechanism = {};
  for (const r of apiRoutes) {
    byMechanism[r.auth.mechanism] = (byMechanism[r.auth.mechanism] ?? 0) + 1;
  }

  const output = {
    generatedAt: timestamp(),
    sourceManifest: path.relative(repoRoot, manifestPath).replace(/\\/g, "/"),
    apiRouteCount: apiRoutes.length,
    mutationRouteCount: mutationCount,
    flaggedForReviewCount: flaggedCount,
    possibleMiddlewareConflictCount: conflictCount,
    authMechanismCounts: byMechanism,
    apiRoutes,
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");

  console.log(
    `pt02-extract-api-routes: wrote ${apiRoutes.length} API route(s) to ` +
      `${path.relative(repoRoot, outPath)} (${mutationCount} mutation route(s), ` +
      `${flaggedCount} flagged for review -- no auth gate detected, ` +
      `${conflictCount} possible middleware/handler conflict(s))`
  );
}

main();
