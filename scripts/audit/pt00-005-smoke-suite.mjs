// ============================================================================
// PT-00-005 — authenticated smoke suite over the full route manifest
//
// Broad and shallow: for every route in test-evidence/pt-00/route-manifest.json
// (464 routes: 146 page, 318 api), confirm it returns a non-error response to
// a real authenticated session. Depth (functional correctness) is out of
// scope here -- that's PT-01/PT-02.
//
// Page routes: real Playwright navigation via an admin-issued magic-link
// session (no password touched), status + rendered-without-error-boundary +
// hard-error/white-screen recorded.
// API routes: a safe authenticated call. GET if the route file exports GET;
// otherwise OPTIONS (Next.js answers OPTIONS for any route without invoking
// a state-changing handler), so this never fires a blind POST/DELETE/PATCH.
//
// Dynamic segments ([id], [...slug], [[...slug]]) are filled with a
// placeholder so the route is actually reachable; a 404 for a fake id is not
// a finding, a 500/white-screen for one is.
//
// Writes test-evidence/pt-00/smoke-results.json (one row per route) and
// screenshots any failure into test-evidence/pt-00/smoke-failures/.
// ============================================================================

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

const REPO_ROOT = process.cwd();
const BASE_URL = process.env.PT00_BASE_URL || "http://localhost:3000";
const EMAIL = "info@faithfoundationsf.org";
const MANIFEST_PATH = path.join(REPO_ROOT, "test-evidence", "pt-00", "route-manifest.json");
const RESULTS_PATH = path.join(REPO_ROOT, "test-evidence", "pt-00", "smoke-results.json");
const FAILURES_DIR = path.join(REPO_ROOT, "test-evidence", "pt-00", "smoke-failures");

const PLACEHOLDER_UUID = "00000000-0000-0000-0000-000000000000";
const PLACEHOLDER_SLUG = "smoke-test-slug";

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

function fillDynamicSegments(routePath) {
  return routePath
    .replace(/\[\[\.\.\.[^\]]+\]\]/g, PLACEHOLDER_SLUG)
    .replace(/\[\.\.\.[^\]]+\]/g, PLACEHOLDER_SLUG)
    .replace(/\[[^\]]+\]/g, PLACEHOLDER_UUID);
}

function resolveApiMethod(fileRelPath) {
  const abs = path.join(REPO_ROOT, fileRelPath);
  let src = "";
  try {
    src = fs.readFileSync(abs, "utf8");
  } catch {
    return "OPTIONS"; // file unreadable -- do not guess, use the safest verb
  }
  const hasGet =
    /export\s+(async\s+)?function\s+GET\b/.test(src) || /export\s+const\s+GET\s*=/.test(src);
  return hasGet ? "GET" : "OPTIONS";
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
}

function cookieHeaderFrom(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

// Signatures that indicate a hard error / white screen rather than real app
// content. Kept generic (no app-specific error.tsx exists in this repo, so
// Next.js's own dev-mode overlay and default error strings are what fires).
function detectHardError(bodyText, htmlLower) {
  if (bodyText.trim().length === 0) return "empty body (white screen)";
  if (htmlLower.includes("nextjs-portal") && htmlLower.includes("runtime error")) {
    return "Next.js dev error overlay (Unhandled Runtime Error)";
  }
  if (/application error: a client-side exception has occurred/i.test(bodyText)) {
    return "React client-side exception boundary";
  }
  if (/^\s*500\s*$/i.test(bodyText.trim()) || /internal server error/i.test(bodyText)) {
    return "500 / Internal Server Error body";
  }
  if (/this page could not be found/i.test(bodyText) === false && /unhandled runtime error/i.test(bodyText)) {
    return "Unhandled Runtime Error text present";
  }
  return null;
}

async function testPageRoute(page, route, filledPath) {
  const url = BASE_URL + filledPath;
  const result = { path: route.path, type: "page", status: null, rendered_ok: false, error: null };
  let response;
  try {
    response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (err) {
    result.error = `navigation failed: ${err.message.split("\n")[0]}`;
    return result;
  }
  result.status = response ? response.status() : null;
  await page.waitForTimeout(600); // let client-side hydration/redirects settle

  const finalUrl = page.url();
  const finalPath = finalUrl.replace(BASE_URL, "").split("?")[0];

  let bodyText = "";
  let htmlLower = "";
  try {
    bodyText = await page.evaluate(() => document.body ? document.body.innerText : "");
    htmlLower = (await page.content()).toLowerCase();
  } catch (err) {
    result.error = `could not read rendered DOM: ${err.message.split("\n")[0]}`;
    return result;
  }

  if (result.status !== null && result.status >= 500) {
    result.error = `HTTP ${result.status}`;
    return result;
  }

  const hardErr = detectHardError(bodyText, htmlLower);
  if (hardErr) {
    result.error = hardErr;
    return result;
  }

  if (finalPath === "/login" && route.path !== "/login") {
    result.error = `authenticated session redirected to /login (was ${route.path})`;
    return result;
  }

  result.rendered_ok = true;
  return result;
}

async function testApiRoute(cookieHeader, route, filledPath) {
  const method = resolveApiMethod(route.file);
  const url = BASE_URL + filledPath;
  const result = { path: route.path, type: "api", status: null, rendered_ok: false, error: null, method };
  try {
    const resp = await fetch(url, {
      method,
      redirect: "manual",
      headers: { Cookie: cookieHeader, Accept: "application/json" },
    });
    result.status = resp.status;
    if (resp.status >= 500) {
      let bodySnippet = "";
      try {
        bodySnippet = (await resp.text()).slice(0, 300);
      } catch {}
      result.error = `HTTP ${resp.status}${bodySnippet ? ": " + bodySnippet : ""}`;
      return result;
    }
    result.rendered_ok = true;
    return result;
  } catch (err) {
    result.error = `fetch failed: ${err.message.split("\n")[0]}`;
    return result;
  }
}

async function screenshotFailure(page, route) {
  fs.mkdirSync(FAILURES_DIR, { recursive: true });
  const safeName = route.path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "root";
  const filePath = path.join(FAILURES_DIR, `${safeName}.png`);
  try {
    await page.screenshot({ path: filePath, fullPage: true, timeout: 10000 });
    return path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");
  } catch (err) {
    return null;
  }
}

async function main() {
  const env = loadEnv();
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const routes = manifest.routes;
  console.log(`PT-00-005: ${routes.length} routes to test (${routes.filter((r) => r.type === "page").length} page, ${routes.filter((r) => r.type === "api").length} api)`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await loginAsFaith(env, context);
  const page = await context.newPage();

  // Sanity check: confirm the session actually lands on an authenticated page,
  // not /login -- fail loudly here rather than silently mislabeling every
  // subsequent route as a real finding.
  const sanity = await page.goto(BASE_URL + "/dashboard", { waitUntil: "domcontentloaded", timeout: 30000 });
  const sanityPath = page.url().replace(BASE_URL, "").split("?")[0];
  if (sanityPath === "/login") {
    console.error("PT-00-005 FATAL: authenticated session redirected to /login on /dashboard sanity check.");
    await browser.close();
    process.exit(1);
  }
  console.log(`PT-00-005: session sanity check OK (${sanity ? sanity.status() : "?"} on /dashboard)`);

  const cookieHeader = cookieHeaderFrom(await context.cookies());

  const results = [];
  let done = 0;
  for (const route of routes) {
    const filledPath = fillDynamicSegments(route.path);
    let result;
    if (route.type === "page") {
      result = await testPageRoute(page, route, filledPath);
      if (!result.rendered_ok) {
        const shot = await screenshotFailure(page, route);
        if (shot) result.screenshot = shot;
      }
    } else {
      result = await testApiRoute(cookieHeader, route, filledPath);
    }
    result.dynamic = route.dynamic;
    result.testedPath = filledPath;
    results.push(result);
    done++;
    if (done % 25 === 0 || done === routes.length) {
      console.log(`  ${done}/${routes.length} tested...`);
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
        totalRoutes: results.length,
        results,
      },
      null,
      2
    ),
    "utf8"
  );

  const failures = results.filter((r) => !r.rendered_ok);
  const hardFailures = failures.filter(
    (r) => (r.status !== null && r.status >= 500) || (r.error && /white screen|500|Internal Server Error/i.test(r.error))
  );
  console.log(`\nPT-00-005 DONE: ${results.length} routes tested, ${failures.length} not rendered_ok, ${hardFailures.length} hard 500/white-screen findings.`);
  console.log(`Results written to ${path.relative(REPO_ROOT, RESULTS_PATH)}`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`  [${f.type}] ${f.path} -> status=${f.status} error=${f.error}`);
    }
  }
}

main().catch((err) => {
  console.error("PT-00-005 FATAL:", err);
  process.exit(1);
});
