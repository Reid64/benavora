// ============================================================================
// PT-01-002 — authenticated render pass over every page route
//
// Deeper than PT-00-005's smoke sweep: PT-00 recorded HTTP status only. This
// records whether the RENDERED DOM shows a Next.js error boundary, an empty
// shell, or real page content -- for every route in
// test-evidence/pt-01/page-routes.json (146 page routes).
//
// Auth: same admin-issued magic-link pattern as PT-00-005
// (scripts/audit/pt00-005-smoke-suite.mjs) -- no password touched.
//
// Dynamic [id] routes: a real id is resolved live via a direct, scoped
// Supabase query (service-role client) against the authenticated org's own
// data wherever a row exists. Where no row exists, the route is tested with
// a placeholder UUID and tagged idSource="placeholder-no-data" /
// scopeTag="PENDING-SCOPE" -- per PT-00's own lesson, a "not found"/"invalid"
// render for a placeholder id is NOT counted as a bug; a hard error or blank
// render still IS, even on a PENDING-SCOPE route.
//
// For each route, captures:
//   (a) final HTTP status of the initial navigation response
//   (b) whether an error-boundary/500-class signature is present in the DOM
//   (c) whether the page rendered real content vs an empty/blank shell
//   (d) console errors (console.error + uncaught pageerror) during the visit
//
// Writes test-evidence/pt-01/render-results.json (one row per route).
// Screenshots every failure into test-evidence/pt-01/render-failures/.
//
// Primary-nav (P0-eligible) paths are the literal top-level entries in
// src/components/layout/nav-items.ts (NAV_ITEMS, SETTINGS_NAV_ITEM,
// PLATFORM_NAV_ITEMS, RESOURCES_NAV_ITEMS) plus src/components/layout/
// Header.tsx's TABS array -- read directly as of this session, same
// precedent WGR-004/WGR-010 already established (not re-derived
// automatically; a future session should re-read both files if they may
// have drifted). Everything else is P1.
//
// ASCII only. Node 20 compatible.
// ============================================================================

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

const REPO_ROOT = process.cwd();
const BASE_URL = process.env.PT01_BASE_URL || "http://localhost:3000";
const EMAIL = "info@faithfoundationsf.org";
const PAGE_ROUTES_PATH = path.join(REPO_ROOT, "test-evidence", "pt-01", "page-routes.json");
const RESULTS_PATH = path.join(REPO_ROOT, "test-evidence", "pt-01", "render-results.json");
const FAILURES_DIR = path.join(REPO_ROOT, "test-evidence", "pt-01", "render-failures");

const PLACEHOLDER_UUID = "00000000-0000-0000-0000-000000000000";
const NAV_TIMEOUT_MS = 30000; // matches PT-00-005 exactly, for fair WGR-004 reproduction
const NETWORK_IDLE_TIMEOUT_MS = 8000; // best-effort, bounded
const SETTLE_MS = 400;
const MIN_CONTENT_CHARS = 10;
const MAX_CONSOLE_ERRORS = 20;

// -- Primary-nav path set, read directly from nav-items.ts / Header.tsx -----
const PRIMARY_NAV_PATHS = new Set([
  // NAV_ITEMS top-level hrefs (src/components/layout/nav-items.ts)
  "/alerts", "/activity", "/funders", "/foundations", "/contacts", "/applications",
  "/documents", "/knowledge-base", "/intelligence-library", "/agents/marketplace",
  "/deadlines", "/compliance", "/outcomes", "/financials", "/marketplace",
  "/reports", "/intelligence", "/email", "/outreach",
  // SETTINGS_NAV_ITEM
  "/settings",
  // PLATFORM_NAV_ITEMS
  "/command-center", "/admin/orgs", "/admin/system", "/import", "/admin/sales-outreach",
  "/admin/autoapply-ops", "/admin/monitor", "/admin/improvements", "/admin/audit-log",
  // RESOURCES_NAV_ITEMS
  "/nonprofits",
  // Header.tsx TABS
  "/dashboard", "/research", "/opportunities", "/autoapply", "/draft-generator", "/donor-discovery",
]);

function loadEnv() {
  const raw = fs.readFileSync(path.join(REPO_ROOT, ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

async function loginAsFaith(env, context) {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: EMAIL,
  });
  if (linkErr) throw new Error(`generateLink failed: ${linkErr.message}`);
  const verifyResp = await fetch(linkData.properties.action_link, { redirect: "manual" });
  const hash = (verifyResp.headers.get("location") || "").split("#")[1];
  if (!hash) throw new Error("magic link did not return a redirect with an auth fragment");
  const params = new URLSearchParams(hash);
  const { createServerClient } = await import("@supabase/ssr");
  const setCookies = [];
  const authForCookies = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
  });
  const { error: sessErr } = await authForCookies.auth.setSession({
    access_token: params.get("access_token"),
    refresh_token: params.get("refresh_token"),
  });
  if (sessErr) throw new Error(`setSession failed: ${sessErr.message}`);
  await context.addCookies(
    setCookies.map((c) => ({ name: c.name, value: c.value, domain: "localhost", path: "/" }))
  );
  return admin;
}

// -- Real-id resolution for dynamic routes -----------------------------------
// Each resolver returns { value, table, idSource } or { value: null, table, idSource: "placeholder-no-data" }.
// "redirect" routes are id-independent by confirmed source read -- no query needed.
async function resolveDynamicIds(admin, orgId) {
  const resolvers = {
    "/admin/orgs/[id]": async () => ({ value: orgId, table: "organizations", idSource: "real" }),
    "/agents/marketplace/[agentId]": async () => {
      const { data } = await admin.from("agent_registry").select("agent_id").limit(1);
      return data && data[0]
        ? { value: data[0].agent_id, table: "agent_registry", idSource: "real" }
        : { value: null, table: "agent_registry", idSource: "placeholder-no-data" };
    },
    "/applications/[id]": async () => scoped("applications", orgId),
    "/autoapply/[sessionId]": async () => scoped("automation_sessions", orgId),
    "/board/[id]": async () => scoped("board_members", orgId),
    "/contacts/[id]": async () => scoped("contacts", orgId),
    "/donor-discovery/outreach/prospects/[id]": async () => {
      const { data } = await admin.from("corporate_prospects").select("id").limit(1);
      return data && data[0]
        ? { value: data[0].id, table: "corporate_prospects", idSource: "real" }
        : { value: null, table: "corporate_prospects", idSource: "placeholder-no-data" };
    },
    "/donor-discovery/prospects/[id]": async () => scoped("donor_discovery_prospects", orgId),
    "/draft-generator/[id]": async () => scoped("applications", orgId),
    "/email/campaigns/[id]": async () => scoped("email_campaign_sequences", orgId),
    "/foundations/[id]": async () => {
      const { data } = await admin.from("foundation_directory").select("id").limit(1);
      return data && data[0]
        ? { value: data[0].id, table: "foundation_directory", idSource: "real" }
        : { value: null, table: "foundation_directory", idSource: "placeholder-no-data" };
    },
    "/funders/[id]": async () => scoped("funders", orgId),
    "/funders/[id]/relationship": async () => scoped("funders", orgId),
    "/invite/[token]": async () => {
      const { data } = await admin
        .from("user_invitations")
        .select("token")
        .eq("organization_id", orgId)
        .eq("status", "pending")
        .limit(1);
      return data && data[0]
        ? { value: data[0].token, table: "user_invitations", idSource: "real" }
        : { value: null, table: "user_invitations", idSource: "placeholder-no-data" };
    },
    "/knowledge-base/narratives/[id]": async () => scoped("knowledge_base", orgId),
    "/opportunities/[id]": async () => scoped("opportunities", orgId),
    "/outreach/campaigns/[id]": async () => ({
      value: null,
      table: null,
      idSource: "n/a-id-independent-redirect", // confirmed: this page.tsx unconditionally redirect()s regardless of id
    }),
  };

  async function scoped(table, org) {
    const { data, error } = await admin.from(table).select("id").eq("organization_id", org).limit(1);
    if (error) return { value: null, table, idSource: "placeholder-no-data", queryError: error.message };
    return data && data[0]
      ? { value: data[0].id, table, idSource: "real" }
      : { value: null, table, idSource: "placeholder-no-data" };
  }

  const out = {};
  for (const [pattern, fn] of Object.entries(resolvers)) {
    out[pattern] = await fn();
  }
  return out;
}

function fillPath(routePath, resolution) {
  if (!resolution || resolution.idSource === "n/a-id-independent-redirect") {
    return routePath.replace(/\[[^\]]+\]/g, PLACEHOLDER_UUID);
  }
  const value = resolution.value ?? PLACEHOLDER_UUID;
  return routePath.replace(/\[[^\]]+\]/g, value);
}

function isPrimaryNav(routePath) {
  if (PRIMARY_NAV_PATHS.has(routePath)) return true;
  // Dynamic-segment routes: check the static-prefix root, e.g. "/funders/[id]" -> "/funders"
  const root = "/" + routePath.split("/").filter(Boolean)[0];
  return PRIMARY_NAV_PATHS.has(root) && routePath === root; // only exact top-level match counts, not sub-pages
}

function isLoadingOnly(text) {
  const t = text.trim().toLowerCase();
  if (t.length === 0) return false; // handled separately as "empty"
  return /^(loading|loading\.{1,3}|please wait\.{0,3}|please wait|one moment\.{0,3})$/.test(t);
}

function detectErrorBoundary(bodyText, htmlLower) {
  if (htmlLower.includes("nextjs-portal") && htmlLower.includes("runtime error")) {
    return "Next.js dev error overlay (Unhandled Runtime Error)";
  }
  if (/application error: a client-side exception has occurred/i.test(bodyText)) {
    return "React client-side exception boundary";
  }
  if (/unhandled runtime error/i.test(bodyText)) {
    return "Unhandled Runtime Error text present";
  }
  if (/^\s*500\s*$/i.test(bodyText.trim())) {
    return "bare 500 body";
  }
  if (/internal server error/i.test(bodyText) && !/this page could not be found/i.test(bodyText)) {
    return "Internal Server Error text present";
  }
  return null;
}

async function testPageRoute(context, route, filledPath, resolution) {
  const url = BASE_URL + filledPath;
  const result = {
    path: route.path,
    file: route.file,
    dynamic: route.dynamic,
    testedPath: filledPath,
    idSource: resolution ? resolution.idSource : "n/a-static",
    resolverTable: resolution ? resolution.table : null,
    scopeTag: resolution && resolution.idSource === "placeholder-no-data" ? "PENDING-SCOPE" : null,
    httpStatus: null,
    finalPath: null,
    redirected: false,
    errorBoundaryInDom: false,
    errorBoundaryDetail: null,
    hasRealContent: false,
    mainTextLength: 0,
    contentPreview: "",
    consoleErrors: [],
    consoleErrorCount: 0,
    navigationError: null,
    primaryNav: isPrimaryNav(route.path),
    durationMs: null,
  };

  const startedAt = Date.now();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 500));
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(`[uncaught] ${String(err && err.message ? err.message : err).slice(0, 500)}`);
  });

  try {
    let response;
    try {
      response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    } catch (err) {
      result.navigationError = `navigation failed: ${String(err.message || err).split("\n")[0]}`;
      result.durationMs = Date.now() - startedAt;
      result.consoleErrors = consoleErrors.slice(0, MAX_CONSOLE_ERRORS);
      result.consoleErrorCount = consoleErrors.length;
      return result;
    }
    result.httpStatus = response ? response.status() : null;

    // Bounded best-effort network-idle wait -- many pages poll continuously
    // (agent-run status, live queue panels) and would never truly idle.
    await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);

    const finalUrl = page.url();
    result.finalPath = finalUrl.replace(BASE_URL, "").split("?")[0];
    result.redirected = result.finalPath !== filledPath.split("?")[0];

    let bodyText = "";
    let htmlLower = "";
    let mainText = "";
    try {
      bodyText = await page.evaluate(() => (document.body ? document.body.innerText : ""));
      htmlLower = (await page.content()).toLowerCase();
      mainText = await page.evaluate(() => {
        const main = document.querySelector("main");
        return main ? main.innerText : document.body ? document.body.innerText : "";
      });
    } catch (err) {
      result.navigationError = `could not read rendered DOM: ${String(err.message || err).split("\n")[0]}`;
      result.durationMs = Date.now() - startedAt;
      result.consoleErrors = consoleErrors.slice(0, MAX_CONSOLE_ERRORS);
      result.consoleErrorCount = consoleErrors.length;
      return result;
    }

    const trimmedMain = mainText.trim();
    result.mainTextLength = trimmedMain.length;
    result.contentPreview = trimmedMain.slice(0, 200).replace(/\s+/g, " ");
    result.hasRealContent = trimmedMain.length >= MIN_CONTENT_CHARS && !isLoadingOnly(trimmedMain);

    const errDetail = detectErrorBoundary(bodyText, htmlLower);
    if (errDetail) {
      result.errorBoundaryInDom = true;
      result.errorBoundaryDetail = errDetail;
    }

    if (result.finalPath === "/login" && route.path !== "/login") {
      result.navigationError = `authenticated session redirected to /login (was ${route.path})`;
    }
  } finally {
    result.consoleErrors = consoleErrors.slice(0, MAX_CONSOLE_ERRORS);
    result.consoleErrorCount = consoleErrors.length;
    result.durationMs = Date.now() - startedAt;
    await page.close().catch(() => {});
  }

  return result;
}

function isFailure(result) {
  if (result.navigationError) return true;
  if (result.errorBoundaryInDom) return true;
  if (result.httpStatus !== null && result.httpStatus >= 500) return true;
  if (!result.hasRealContent) return true;
  return false;
}

async function screenshotFailure(context, route, filledPath) {
  // Re-navigate briefly to grab a screenshot for the failure record -- the
  // page used for testPageRoute is already closed by the time we know the
  // verdict, so open a short-lived one here.
  fs.mkdirSync(FAILURES_DIR, { recursive: true });
  const safeName = route.path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "root";
  const filePath = path.join(FAILURES_DIR, `${safeName}.png`);
  const page = await context.newPage();
  try {
    // Shorter timeout here than the main pass -- we already have the real
    // verdict; this is best-effort visual evidence, not worth a second full
    // 30s wait on a route already known to hang.
    await page.goto(BASE_URL + filledPath, { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: filePath, fullPage: true, timeout: 10000 });
    return path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");
  } catch (err) {
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const limitArg = argv.find((a) => a.startsWith("--limit="));
  const onlyArg = argv.find((a) => a.startsWith("--only="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : null;
  const only = onlyArg ? onlyArg.split("=")[1].split(",") : null;

  const env = loadEnv();
  const pageRoutesFile = JSON.parse(fs.readFileSync(PAGE_ROUTES_PATH, "utf8"));
  let routes = pageRoutesFile.pageRoutes;
  if (only) routes = routes.filter((r) => only.includes(r.path));
  if (limit) routes = routes.slice(0, limit);

  console.log(`PT-01-002: ${routes.length} page routes to render-test`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const admin = await loginAsFaith(env, context);

  // Sanity check -- same as PT-00-005: confirm the session actually lands on
  // an authenticated page before trusting any subsequent result.
  const sanityPage = await context.newPage();
  const sanity = await sanityPage.goto(BASE_URL + "/dashboard", { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  const sanityPath = sanityPage.url().replace(BASE_URL, "").split("?")[0];
  if (sanityPath === "/login") {
    console.error("PT-01-002 FATAL: authenticated session redirected to /login on /dashboard sanity check.");
    await browser.close();
    process.exit(1);
  }
  console.log(`PT-01-002: session sanity check OK (${sanity ? sanity.status() : "?"} on /dashboard)`);
  await sanityPage.close();

  // Resolve org id for the authenticated user.
  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("email", EMAIL)
    .maybeSingle();
  if (profErr || !profile) {
    console.error("PT-01-002 FATAL: could not resolve organization_id for", EMAIL, profErr && profErr.message);
    await browser.close();
    process.exit(1);
  }
  const orgId = profile.organization_id;
  console.log(`PT-01-002: resolved org id ${orgId} for ${EMAIL}`);

  const dynamicResolutions = await resolveDynamicIds(admin, orgId);
  console.log("PT-01-002: dynamic-route id resolutions:");
  for (const [pattern, res] of Object.entries(dynamicResolutions)) {
    console.log(`  ${pattern} -> idSource=${res.idSource}${res.value ? ` value=${res.value}` : ""}`);
  }

  // A concurrent, unrelated `next build` process was observed running in
  // this same repo directory while this sweep started (confirmed via
  // `wmic process`, PID 112940 as of session start) -- live-reproduced
  // (twice, identically) causing a real but environmental failure on
  // /email/campaigns/[id]: "Cannot find module
  // './vendor-chunks/@supabase+auth-js@2.108.0.js'", a dev-server webpack
  // chunk-manifest corruption, not an app bug. Waited ~6 minutes for that
  // build to exit; it did not finish. Rather than block indefinitely on a
  // process this session does not own and should not kill, every failing
  // route gets up to 2 retries with increasing delay, and any route still
  // failing after the full sweep gets one more, final re-check pass after
  // all 146 routes are done (by which point substantially more wall-clock
  // time has passed, increasing the odds the concurrent build has since
  // exited). A route resolved only on that final pass is marked
  // resolvedOnFinalRecheck=true with the original failure preserved.
  const BUILD_CONTENTION_SIGNATURE = /cannot find module .*vendor-chunks|webpack-runtime|MODULE_NOT_FOUND/i;
  function looksLikeBuildContention(consoleErrors) {
    return consoleErrors.some((e) => BUILD_CONTENTION_SIGNATURE.test(e));
  }

  async function testWithRetries(route, filledPath, resolution) {
    let result = await testPageRoute(context, route, filledPath, resolution);
    const attempts = [result];
    const delaysMs = [1500, 5000];
    for (const delayMs of delaysMs) {
      if (!isFailure(result)) break;
      await new Promise((r) => setTimeout(r, delayMs));
      result = await testPageRoute(context, route, filledPath, resolution);
      attempts.push(result);
    }
    if (attempts.length > 1) {
      const finalResult = attempts[attempts.length - 1];
      finalResult.attemptCount = attempts.length;
      finalResult.priorAttempts = attempts.slice(0, -1).map((a) => ({
        httpStatus: a.httpStatus,
        navigationError: a.navigationError,
        errorBoundaryInDom: a.errorBoundaryInDom,
        errorBoundaryDetail: a.errorBoundaryDetail,
        hasRealContent: a.hasRealContent,
        mainTextLength: a.mainTextLength,
        buildContentionSuspected: looksLikeBuildContention(a.consoleErrors || []),
      }));
      finalResult.flaky = !isFailure(finalResult) && attempts.length > 1;
      finalResult.buildContentionSuspected =
        looksLikeBuildContention(finalResult.consoleErrors || []) ||
        finalResult.priorAttempts.some((a) => a.buildContentionSuspected);
      return finalResult;
    }
    result.buildContentionSuspected = looksLikeBuildContention(result.consoleErrors || []);
    return result;
  }

  const results = [];
  let done = 0;
  for (const route of routes) {
    const resolution = route.dynamic ? dynamicResolutions[route.path] : null;
    if (route.dynamic && !resolution) {
      console.warn(`PT-01-002 WARNING: no resolver registered for dynamic route ${route.path} -- using placeholder`);
    }
    const filledPath = fillPath(route.path, resolution);
    const result = await testWithRetries(route, filledPath, resolution);

    if (isFailure(result)) {
      const shot = await screenshotFailure(context, route, filledPath);
      if (shot) result.screenshot = shot;
    }

    results.push(result);
    done++;
    if (done % 10 === 0 || done === routes.length) {
      console.log(`  ${done}/${routes.length} tested...`);
    }
  }

  // Final re-verification pass over anything still failing, after the rest
  // of the sweep has had time to run.
  const stillFailingIdx = results.map((r, i) => (isFailure(r) ? i : -1)).filter((i) => i >= 0);
  if (stillFailingIdx.length > 0) {
    console.log(`\nPT-01-002: ${stillFailingIdx.length} route(s) still failing after retries -- final re-check pass...`);
    await new Promise((r) => setTimeout(r, 5000));
    for (const idx of stillFailingIdx) {
      const route = routes[idx];
      const resolution = route.dynamic ? dynamicResolutions[route.path] : null;
      const filledPath = fillPath(route.path, resolution);
      const recheck = await testPageRoute(context, route, filledPath, resolution);
      recheck.buildContentionSuspected = looksLikeBuildContention(recheck.consoleErrors || []);
      if (!isFailure(recheck)) {
        recheck.resolvedOnFinalRecheck = true;
        recheck.originalFailure = {
          httpStatus: results[idx].httpStatus,
          navigationError: results[idx].navigationError,
          errorBoundaryInDom: results[idx].errorBoundaryInDom,
          errorBoundaryDetail: results[idx].errorBoundaryDetail,
          hasRealContent: results[idx].hasRealContent,
          buildContentionSuspected: results[idx].buildContentionSuspected,
        };
        results[idx] = recheck;
        console.log(`  RESOLVED on final recheck: ${route.path}`);
      } else {
        recheck.attemptCount = (results[idx].attemptCount || 1) + 1;
        recheck.priorAttempts = results[idx].priorAttempts || [];
        results[idx] = recheck;
        console.log(`  STILL FAILING on final recheck: ${route.path}`);
        const shot = await screenshotFailure(context, route, filledPath);
        if (shot) results[idx].screenshot = shot;
      }
    }
  }

  await browser.close();

  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  fs.writeFileSync(
    RESULTS_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        orgId,
        totalRoutes: results.length,
        results,
      },
      null,
      2
    ),
    "utf8"
  );

  const failures = results.filter(isFailure);
  const hardErrors = failures.filter((r) => r.navigationError || r.errorBoundaryInDom || (r.httpStatus !== null && r.httpStatus >= 500));
  const blankRenders = failures.filter((r) => !r.navigationError && !r.errorBoundaryInDom && !r.hasRealContent);
  const flakyResolved = results.filter((r) => r.flaky || r.resolvedOnFinalRecheck);
  const contentionSuspected = results.filter((r) => r.buildContentionSuspected);

  console.log(`\nPT-01-002 DONE: ${results.length} routes tested.`);
  console.log(`  ${failures.length} failure(s) total (${hardErrors.length} hard error, ${blankRenders.length} blank-render-only).`);
  console.log(`  ${flakyResolved.length} route(s) needed a retry/recheck to reach their final verdict.`);
  console.log(`  ${contentionSuspected.length} route(s) showed the concurrent-build-contention module-resolution signature at some point.`);
  console.log(`Results written to ${path.relative(REPO_ROOT, RESULTS_PATH)}`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(
        `  [${f.primaryNav ? "P0-candidate" : "P1-candidate"}] ${f.path} (tested=${f.testedPath}) ` +
          `status=${f.httpStatus} navErr=${f.navigationError} errBoundary=${f.errorBoundaryInDom}:${f.errorBoundaryDetail} ` +
          `hasContent=${f.hasRealContent} scopeTag=${f.scopeTag} buildContention=${f.buildContentionSuspected} attempts=${f.attemptCount || 1}`
      );
    }
  }
}

main().catch((err) => {
  console.error("PT-01-002 FATAL:", err);
  process.exit(1);
});
