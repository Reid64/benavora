// ============================================================================
// PT-01-003 -- nav resolution across every real nav surface
//
// PT-00-003's deadNav check (test-evidence/pt-00/route-manifest.json,
// deadNav: []) was a STATIC cross-reference: it compared nav-items.ts hrefs
// against the build's route manifest, never touching a running app. This
// script settles the same question with LIVE evidence: for every nav element
// on the sidebar, the header tab bar, the header avatar/org menu, the
// settings sub-nav, and the admin (Platform) nav, it authenticates as a real
// user, actually CLICKS the element in a real rendered DOM, and records
// whether the result is a real page, a 404, an error boundary, a blank
// render, or a link that never rendered onto the page in the first place.
//
// Auth: same admin-issued magic-link pattern as PT-00-005/PT-01-002 -- no
// password touched.
//
// Nav element source (read directly from these files this session, same
// precedent PT-01-002 already established for its own PRIMARY_NAV_PATHS --
// not re-derived automatically; re-read all four files if they may have
// drifted before trusting this list again):
//   - src/components/layout/nav-items.ts   (NAV_ITEMS incl. children,
//     DONOR_DISCOVERY_NAV_ITEMS, RESOURCES_NAV_ITEMS, SETTINGS_NAV_ITEM,
//     PLATFORM_NAV_ITEMS)
//   - src/components/layout/Header.tsx     (TABS, MENU_LINKS)
//   - src/app/(dashboard)/settings/layout.tsx  (NAV_ITEMS, "SettingsNav")
//
// Container selectors, read from the same files:
//   sidebar / admin  -> aside[aria-label="Primary navigation"] (PLATFORM_NAV_ITEMS
//                        and RESOURCES_NAV_ITEMS/DONOR_DISCOVERY_NAV_ITEMS use a
//                        literal href, never section-memory-rewritten; only the
//                        19 top-level NAV_ITEMS entries and SETTINGS_NAV_ITEM do)
//   header_tabs      -> nav[aria-label="Primary sections"]
//   header_avatar_menu -> button[aria-label="Organization menu"] to open,
//                        then [role="menu"]
//   settings_nav     -> nav[aria-label="Settings navigation"]
//
// Test-order note (load-bearing, not arbitrary): src/lib/navigation/
// section-memory.ts rewrites a NAV_ITEMS top-level href (and SETTINGS_NAV_ITEM)
// to the last-visited sub-path within that same first URL segment, once one
// has been visited (sessionStorage-backed). PLATFORM_NAV_ITEMS/RESOURCES_NAV_ITEMS/
// DONOR_DISCOVERY_NAV_ITEMS and every child link use a literal href and are
// immune to this. To test the sidebar's own bare "/settings" link (and the
// header avatar menu's bare "/settings" link) at their literal, undisturbed
// target, this script visits them BEFORE the settings_nav surface, which
// deliberately visits ten separate /settings/* sub-paths and would otherwise
// contaminate what "/settings" resolves to for anything tested after it.
// Order enforced below: sidebar -> admin -> header_tabs -> header_avatar_menu
// -> settings_nav (settings_nav always last).
//
// Writes test-evidence/pt-01/nav-resolution.json.
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
const RESULTS_PATH = path.join(REPO_ROOT, "test-evidence", "pt-01", "nav-resolution.json");
const ROUTE_MANIFEST_PATH = path.join(REPO_ROOT, "test-evidence", "pt-00", "route-manifest.json");

const NAV_TIMEOUT_MS = 15000;
const FIND_TIMEOUT_MS = 8000;
const NETWORK_IDLE_TIMEOUT_MS = 8000;
const SETTLE_MS = 500;
// How long to poll page.url() for a change after a click, before concluding
// the click never navigated at all. Set generously -- confirmed live this
// session (three throwaway reproduction scripts, deleted after use) that a
// fixed ~400ms settle between consecutive sidebar clicks is NOT reliable in
// this dev-mode app: waitForLoadState("networkidle") can resolve before the
// freshly-mounted page's client bundle has finished hydrating enough for the
// next Link's click handler to be live, silently swallowing the click with
// no error and no navigation. Polling for an actual URL change (rather than
// trusting a fixed delay or "networkidle") is what made three consecutive
// sidebar clicks reproduce reliably in that same reproduction.
const URL_CHANGE_POLL_TIMEOUT_MS = 15000;
const URL_CHANGE_POLL_INTERVAL_MS = 200;
const MIN_CONTENT_CHARS = 10;
const MAX_CONSOLE_ERRORS = 10;

// -- Nav element definitions, read directly from source this session --------

const SIDEBAR = 'aside[aria-label="Primary navigation"]';
const HEADER_TABS = 'nav[aria-label="Primary sections"]';
const AVATAR_MENU_TRIGGER = 'button[aria-label="Organization menu"]';
const AVATAR_MENU = '[role="menu"]';
const SETTINGS_NAV = 'nav[aria-label="Settings navigation"]';

// Top-level NAV_ITEMS in sidebar (children rendered only while parent active
// -- tested by clicking parent first, then each child, in this order).
const SIDEBAR_NAV_ITEMS = [
  { label: "Alerts", href: "/alerts" },
  { label: "Activity", href: "/activity" },
  { label: "Funders", href: "/funders" },
  { label: "Foundations", href: "/foundations" },
  { label: "Contacts", href: "/contacts" },
  { label: "Applications", href: "/applications" },
  { label: "Documents", href: "/documents" },
  { label: "Knowledge Base", href: "/knowledge-base" },
  { label: "Intelligence Library", href: "/intelligence-library" },
  { label: "Agent Marketplace", href: "/agents/marketplace" },
  { label: "Deadlines", href: "/deadlines" },
  { label: "Compliance", href: "/compliance" },
  { label: "Outcomes & Analytics", href: "/outcomes" },
  { label: "Financials", href: "/financials" },
  { label: "Marketplace", href: "/marketplace" },
  {
    label: "Reports",
    href: "/reports",
    children: [
      { label: "Simulator", href: "/reports/simulate" },
      { label: "ROI Insights", href: "/reports/roi" },
      { label: "Funding Forecast", href: "/reports/forecast" },
    ],
  },
  {
    label: "Intelligence",
    href: "/intelligence",
    children: [
      { label: "Digital Twin", href: "/intelligence/twin" },
      { label: "Match Feed", href: "/intelligence/match-feed" },
      { label: "Knowledge Engine", href: "/intelligence/knowledge" },
      { label: "Recommendations", href: "/intelligence/recommendations" },
      { label: "Gap Analyzer", href: "/intelligence/gap-analysis" },
      { label: "Competitors", href: "/intelligence/competitors" },
      { label: "Semantic Matches", href: "/intelligence/matches" },
      { label: "Reputation", href: "/intelligence/reputation" },
      { label: "Disaster Response", href: "/intelligence/disaster" },
      { label: "Community Need", href: "/intelligence/community-need" },
      { label: "Donor Intent", href: "/intelligence/donor-intent" },
      { label: "Relationship Graph", href: "/intelligence/relationship-graph" },
      { label: "Strategic Advisor", href: "/intelligence/strategic-advisor" },
    ],
  },
  {
    label: "Email",
    href: "/email",
    children: [
      { label: "Campaigns", href: "/email/campaigns" },
      { label: "Templates", href: "/email/templates" },
    ],
  },
  {
    label: "Outreach",
    href: "/outreach",
    children: [{ label: "Templates", href: "/outreach/templates" }],
  },
];

const DONOR_DISCOVERY_NAV_ITEMS = [
  { label: "Prospects", href: "/donor-discovery/prospects" },
  { label: "Intent Signals", href: "/donor-discovery/intent-signals" },
];

const RESOURCES_NAV_ITEMS = [{ label: "Nonprofit Directory", href: "/nonprofits" }];

const SETTINGS_NAV_ITEM = { label: "Settings", href: "/settings" };

const PLATFORM_NAV_ITEMS = [
  { label: "Command Center", href: "/command-center" },
  { label: "Organizations", href: "/admin/orgs" },
  { label: "System Health", href: "/admin/system" },
  { label: "Import", href: "/import" },
  { label: "Sales Outreach", href: "/admin/sales-outreach" },
  { label: "AutoApply Ops", href: "/admin/autoapply-ops" },
  { label: "Monitor", href: "/admin/monitor" },
  { label: "Improvements", href: "/admin/improvements" },
  { label: "Audit Log", href: "/admin/audit-log" },
];

const HEADER_TABS_ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Research", href: "/research" },
  { label: "Opportunities", href: "/opportunities" },
  { label: "AutoApply", href: "/autoapply" },
  { label: "Draft Generator", href: "/draft-generator" },
  { label: "Donor Discovery", href: "/donor-discovery" },
];

// Bonus surface beyond the four named in the task -- same Header.tsx file,
// same click-based method, cheap extra coverage of "every navigation surface."
const HEADER_AVATAR_MENU_ITEMS = [
  { label: "Settings", href: "/settings" },
  { label: "Billing", href: "/billing" },
  { label: "Onboarding", href: "/onboarding" },
  { label: "Audit Log", href: "/admin/audit-log" },
  { label: "AutoApply Ops", href: "/admin/autoapply-ops" },
];

// src/app/(dashboard)/settings/layout.tsx NAV_ITEMS -- ownerOnly entries only
// render for role==="owner"; the authenticated test account is confirmed
// owner (profiles.role, checked live this session), so all ten are testable.
const SETTINGS_NAV_ITEMS = [
  { label: "General", href: "/settings" },
  { label: "Organization Setup", href: "/settings/organization-setup" },
  { label: "Integrations", href: "/settings/integrations" },
  { label: "Agents", href: "/settings/agents" },
  { label: "Notifications", href: "/settings/notifications" },
  { label: "Branding", href: "/settings/branding" },
  { label: "Custom APIs", href: "/settings/custom-apis" },
  { label: "Scraping Targets", href: "/settings/scraping" },
  { label: "Billing", href: "/settings/billing", ownerOnly: true },
  { label: "White-Label", href: "/settings/white-label", ownerOnly: true },
];

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

function isLoadingOnly(text) {
  const t = text.trim().toLowerCase();
  if (t.length === 0) return false;
  return /^(loading|loading\.{1,3}|please wait\.{0,3}|please wait|one moment\.{0,3})$/.test(t);
}

// Same classifier PT-01-002 uses for a crash/500 signature -- kept separate
// from the 404 check below, since a real Next.js not-found render is a
// designed page, not a runtime crash.
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

function detect404(bodyText) {
  return /this page could not be found/i.test(bodyText);
}

const BUILD_CONTENTION_SIGNATURE = /cannot find module .*vendor-chunks|webpack-runtime|module_not_found/i;
function looksLikeBuildContention(consoleErrors) {
  return consoleErrors.some((e) => BUILD_CONTENTION_SIGNATURE.test(e));
}

/**
 * Locates a nav <a href="target"> inside containerSelector and clicks it.
 * Returns a fully-populated result row. Never throws -- every failure mode
 * becomes a resolved_status value instead.
 */
async function clickNavElement(page, surface, containerSelector, item, opts = {}) {
  const target = item.href;
  const result = {
    surface,
    label: item.label,
    target,
    foundInDom: false,
    clicked: false,
    finalPath: null,
    pathMatchesTarget: null,
    hasRealContent: false,
    mainTextLength: 0,
    errorBoundaryInDom: false,
    errorBoundaryDetail: null,
    is404: false,
    navigationError: null,
    consoleErrorCount: 0,
    consoleErrors: [],
    contentPreview: "",
    resolved_status: null,
    verdict: null,
  };

  if (opts.preClick) {
    try {
      await opts.preClick();
    } catch (err) {
      result.navigationError = `preClick failed: ${String(err.message || err).split("\n")[0]}`;
      result.resolved_status = "precondition_failed";
      result.verdict = "CONFIRMED-BROKEN";
      return result;
    }
  }

  const linkLocator = page.locator(`${containerSelector} a[href="${target}"]`).first();
  try {
    await linkLocator.waitFor({ state: "visible", timeout: FIND_TIMEOUT_MS });
    result.foundInDom = true;
  } catch (err) {
    result.resolved_status = "nav_element_not_found_in_dom";
    result.verdict = "CONFIRMED-BROKEN";
    return result;
  }

  const consoleErrors = [];
  const onConsole = (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
  };
  const onPageErr = (err) => {
    consoleErrors.push(`[uncaught] ${String(err && err.message ? err.message : err).slice(0, 300)}`);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageErr);

  const beforeUrl = page.url();
  let urlChanged = false;
  try {
    await linkLocator.click({ timeout: FIND_TIMEOUT_MS });
    result.clicked = true;
    // Poll for an actual URL change rather than trusting networkidle+a fixed
    // delay -- see URL_CHANGE_POLL_TIMEOUT_MS comment above for why.
    const pollStart = Date.now();
    while (Date.now() - pollStart < URL_CHANGE_POLL_TIMEOUT_MS) {
      if (page.url() !== beforeUrl) {
        urlChanged = true;
        break;
      }
      await page.waitForTimeout(URL_CHANGE_POLL_INTERVAL_MS);
    }
    await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
  } catch (err) {
    result.navigationError = `click failed: ${String(err.message || err).split("\n")[0]}`;
  }

  page.off("console", onConsole);
  page.off("pageerror", onPageErr);
  result.consoleErrorCount = consoleErrors.length;
  result.consoleErrors = consoleErrors.slice(0, MAX_CONSOLE_ERRORS);

  const finalUrl = page.url();
  result.finalPath = finalUrl.replace(BASE_URL, "").split("?")[0] || "/";
  const beforePath = beforeUrl.replace(BASE_URL, "").split("?")[0] || "/";
  const expectedPath = target.split("?")[0];
  result.pathMatchesTarget = result.finalPath === expectedPath;
  result.urlChangedAfterClick = urlChanged;
  // Distinct from a genuine redirect: the click never moved the browser off
  // its starting URL at all within the poll window (a real nav failure, not
  // "resolved somewhere else").
  result.clickDidNotNavigate = !urlChanged && result.finalPath === beforePath && result.finalPath !== expectedPath;

  let bodyText = "";
  let htmlLower = "";
  let mainText = "";
  if (!result.navigationError) {
    try {
      bodyText = await page.evaluate(() => (document.body ? document.body.innerText : ""));
      htmlLower = (await page.content()).toLowerCase();
      mainText = await page.evaluate(() => {
        const main = document.querySelector("main");
        return main ? main.innerText : document.body ? document.body.innerText : "";
      });
    } catch (err) {
      result.navigationError = `could not read rendered DOM: ${String(err.message || err).split("\n")[0]}`;
    }
  }

  const trimmedMain = mainText.trim();
  result.mainTextLength = trimmedMain.length;
  result.contentPreview = trimmedMain.slice(0, 200).replace(/\s+/g, " ");
  result.hasRealContent = trimmedMain.length >= MIN_CONTENT_CHARS && !isLoadingOnly(trimmedMain);

  result.is404 = detect404(bodyText);
  const errDetail = result.is404 ? null : detectErrorBoundary(bodyText, htmlLower);
  if (errDetail) {
    result.errorBoundaryInDom = true;
    result.errorBoundaryDetail = errDetail;
  }
  result.buildContentionSuspected = looksLikeBuildContention(result.consoleErrors);

  if (result.navigationError) {
    result.resolved_status = "navigation_error";
    result.verdict = "CONFIRMED-BROKEN";
  } else if (result.clickDidNotNavigate) {
    result.resolved_status = "click_did_not_navigate";
    result.verdict = "CONFIRMED-BROKEN";
  } else if (result.is404) {
    result.resolved_status = "404_not_found";
    result.verdict = "CONFIRMED-BROKEN";
  } else if (result.errorBoundaryInDom) {
    result.resolved_status = "error_boundary";
    result.verdict = "CONFIRMED-BROKEN";
  } else if (!result.hasRealContent) {
    result.resolved_status = "blank_render";
    result.verdict = "CONFIRMED-BROKEN";
  } else if (!result.pathMatchesTarget) {
    result.resolved_status = "resolved_via_redirect";
    result.verdict = "CONFIRMED-OK";
  } else {
    result.resolved_status = "renders";
    result.verdict = "CONFIRMED-OK";
  }

  return result;
}

function isFailure(row) {
  return row.verdict === "CONFIRMED-BROKEN";
}

async function withRetries(fn, label) {
  let result = await fn();
  const attempts = [result];
  const delaysMs = [1500, 4000];
  for (const delayMs of delaysMs) {
    if (!isFailure(result)) break;
    console.log(`  retrying ${label} in ${delayMs}ms (last: ${result.resolved_status})...`);
    await new Promise((r) => setTimeout(r, delayMs));
    result = await fn();
    attempts.push(result);
  }
  if (attempts.length > 1) {
    result.attemptCount = attempts.length;
    result.priorAttempts = attempts.slice(0, -1).map((a) => ({
      resolved_status: a.resolved_status,
      navigationError: a.navigationError,
    }));
  }
  return result;
}

async function main() {
  const env = loadEnv();
  console.log(`PT-01-003: base URL ${BASE_URL}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await loginAsFaith(env, context);

  const page = await context.newPage();
  const sanity = await page.goto(BASE_URL + "/dashboard", { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  const sanityPath = page.url().replace(BASE_URL, "").split("?")[0];
  if (sanityPath === "/login") {
    console.error("PT-01-003 FATAL: authenticated session redirected to /login on /dashboard sanity check.");
    await browser.close();
    process.exit(1);
  }
  console.log(`PT-01-003: session sanity check OK (${sanity ? sanity.status() : "?"} on /dashboard)`);

  const results = [];

  // -- 1. Sidebar: top-level NAV_ITEMS (parent first, then children) --------
  console.log("\nPT-01-003: sidebar (NAV_ITEMS)...");
  for (const item of SIDEBAR_NAV_ITEMS) {
    const r = await withRetries(() => clickNavElement(page, "sidebar", SIDEBAR, item), `sidebar:${item.label}`);
    results.push(r);
    console.log(`  ${item.label} (${item.href}) -> ${r.resolved_status}`);
    if (item.children) {
      for (const child of item.children) {
        const cr = await withRetries(
          () => clickNavElement(page, "sidebar", SIDEBAR, child),
          `sidebar:${item.label}>${child.label}`
        );
        results.push(cr);
        console.log(`    - ${child.label} (${child.href}) -> ${cr.resolved_status}`);
      }
    }
  }

  // -- 2. Sidebar: Donor Discovery drilldown (requires /donor-discovery/* state) --
  console.log("\nPT-01-003: sidebar (Donor Discovery drilldown)...");
  await page.goto(BASE_URL + "/donor-discovery", { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
  for (const item of DONOR_DISCOVERY_NAV_ITEMS) {
    const r = await withRetries(
      () => clickNavElement(page, "sidebar", SIDEBAR, item),
      `sidebar-donor-discovery:${item.label}`
    );
    results.push(r);
    console.log(`  ${item.label} (${item.href}) -> ${r.resolved_status}`);
  }

  // -- 3. Sidebar: Resources section -----------------------------------------
  console.log("\nPT-01-003: sidebar (Resources)...");
  for (const item of RESOURCES_NAV_ITEMS) {
    const r = await withRetries(() => clickNavElement(page, "sidebar", SIDEBAR, item), `sidebar-resources:${item.label}`);
    results.push(r);
    console.log(`  ${item.label} (${item.href}) -> ${r.resolved_status}`);
  }

  // -- 4. Sidebar: Settings item (tested here, before settings_nav surface --
  //      rewrites what "/settings" resolves to via section-memory) ----------
  console.log("\nPT-01-003: sidebar (Settings item)...");
  {
    const r = await withRetries(
      () => clickNavElement(page, "sidebar", SIDEBAR, SETTINGS_NAV_ITEM),
      "sidebar:Settings"
    );
    results.push(r);
    console.log(`  ${SETTINGS_NAV_ITEM.label} (${SETTINGS_NAV_ITEM.href}) -> ${r.resolved_status}`);
  }

  // -- 5. Admin (Platform) nav -- literal hrefs, immune to section-memory ---
  console.log("\nPT-01-003: admin (PLATFORM_NAV_ITEMS)...");
  for (const item of PLATFORM_NAV_ITEMS) {
    const r = await withRetries(() => clickNavElement(page, "admin", SIDEBAR, item), `admin:${item.label}`);
    results.push(r);
    console.log(`  ${item.label} (${item.href}) -> ${r.resolved_status}`);
  }

  // -- 6. Header tab bar ------------------------------------------------------
  console.log("\nPT-01-003: header_tabs (TABS)...");
  for (const item of HEADER_TABS_ITEMS) {
    const r = await withRetries(() => clickNavElement(page, "header_tabs", HEADER_TABS, item), `header_tabs:${item.label}`);
    results.push(r);
    console.log(`  ${item.label} (${item.href}) -> ${r.resolved_status}`);
  }

  // -- 7. Header avatar/org menu (bonus surface, same file as TABS) ----------
  console.log("\nPT-01-003: header_avatar_menu (MENU_LINKS)...");
  for (const item of HEADER_AVATAR_MENU_ITEMS) {
    const r = await withRetries(
      () =>
        clickNavElement(page, "header_avatar_menu", AVATAR_MENU, item, {
          preClick: async () => {
            // Dropdown closes on navigation, and possibly on outside-click
            // from the prior test -- always (re)open it fresh.
            const menuVisible = await page.locator(AVATAR_MENU).isVisible().catch(() => false);
            if (!menuVisible) {
              await page.locator(AVATAR_MENU_TRIGGER).click({ timeout: FIND_TIMEOUT_MS });
              await page.waitForSelector(AVATAR_MENU, { state: "visible", timeout: FIND_TIMEOUT_MS });
            }
          },
        }),
      `header_avatar_menu:${item.label}`
    );
    results.push(r);
    console.log(`  ${item.label} (${item.href}) -> ${r.resolved_status}`);
  }

  // -- 8. Settings sub-nav -- LAST (deliberately visits ten /settings/* ------
  //      sub-paths, which would otherwise contaminate what a bare "/settings"
  //      link resolves to for any surface tested after it) ------------------
  console.log("\nPT-01-003: settings_nav (SettingsNav)...");
  await page.goto(BASE_URL + "/settings", { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
  for (const item of SETTINGS_NAV_ITEMS) {
    const r = await withRetries(
      () => clickNavElement(page, "settings_nav", SETTINGS_NAV, item),
      `settings_nav:${item.label}`
    );
    results.push(r);
    console.log(`  ${item.label} (${item.href}) -> ${r.resolved_status}`);
  }

  await browser.close();

  // -- Cross-check against PT-00's static deadNav claim ----------------------
  let pt00DeadNavCount = null;
  let pt00DeadNavClaimSource = null;
  try {
    const manifest = JSON.parse(fs.readFileSync(ROUTE_MANIFEST_PATH, "utf8"));
    pt00DeadNavCount = Array.isArray(manifest.deadNav) ? manifest.deadNav.length : null;
    pt00DeadNavClaimSource = "test-evidence/pt-00/route-manifest.json (deadNav[])";
  } catch (err) {
    console.warn(`PT-01-003: could not read ${ROUTE_MANIFEST_PATH} for cross-check: ${err.message}`);
  }

  const brokenEntries = results.filter(isFailure);
  const contradictsStaticFinding = pt00DeadNavCount === 0 && brokenEntries.length > 0;

  const output = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    authenticatedAs: EMAIL,
    totalEntries: results.length,
    results,
    crossCheckPt00DeadNavClaim: {
      claimSource: pt00DeadNavClaimSource,
      pt00DeadNavCount,
      pt00DeadNavClaimWasZero: pt00DeadNavCount === 0,
      liveNavResolutionBrokenCount: brokenEntries.length,
      contradictsStaticFinding,
      note: contradictsStaticFinding
        ? "PT-00's static nav-items.ts-vs-route-manifest cross-reference found 0 dead nav entries, " +
          "but this live, click-based pass found at least one nav element that does not resolve to a " +
          "working page. The static scan cannot see runtime-only failures (a route that exists in the " +
          "build manifest but crashes when rendered, is gated so the DOM element never appears, or " +
          "resolves via client-side navigation to something other than a real page) -- this is exactly " +
          "such a runtime-only miss."
        : "No contradiction: every nav element that PT-00's static scan would have flagged as pointing " +
          "at a real route also resolved correctly when actually clicked in a live authenticated session.",
    },
  };

  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(output, null, 2), "utf8");

  const bySurface = {};
  for (const r of results) {
    bySurface[r.surface] = bySurface[r.surface] || { total: 0, broken: 0 };
    bySurface[r.surface].total++;
    if (isFailure(r)) bySurface[r.surface].broken++;
  }

  console.log(`\nPT-01-003 DONE: ${results.length} nav element(s) tested across ${Object.keys(bySurface).length} surface(s).`);
  for (const [surface, stats] of Object.entries(bySurface)) {
    console.log(`  ${surface}: ${stats.total - stats.broken}/${stats.total} CONFIRMED-OK`);
  }
  console.log(`  ${brokenEntries.length} CONFIRMED-BROKEN total.`);
  console.log(`  Cross-check vs PT-00 deadNav claim: contradictsStaticFinding=${contradictsStaticFinding}`);
  if (brokenEntries.length > 0) {
    console.log("\nBroken entries:");
    for (const b of brokenEntries) {
      console.log(`  [${b.surface}] ${b.label} (${b.target}) -> ${b.resolved_status}`);
    }
  }
  console.log(`Results written to ${path.relative(REPO_ROOT, RESULTS_PATH)}`);
}

main().catch((err) => {
  console.error("PT-01-003 FATAL:", err);
  process.exit(1);
});
