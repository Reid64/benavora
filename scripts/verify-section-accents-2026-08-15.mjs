// Verification for the 2026-08-15 "section accent colors" task: confirms
// that (a) six representative pages, one per logical nav section, each
// render their own signature accent color, (b) the shared sidebar/header
// shell stays the one consistent deep-blue gradient across all six, and
// (c) sidebar/header nav text stays solid white on every page. Reuses the
// magic-link login technique from verify-brand-nav-white-text-2026-08-15.mjs.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { WebSocket } from "ws";
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

function loadEnv() {
  const raw = readFileSync(".env.local", "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}
const env = loadEnv();
const BASE_URL = "http://localhost:3000";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function loginAsFaith(context) {
  const email = "info@faithfoundationsf.org";
  const { data: linkData, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const verifyResp = await fetch(linkData.properties.action_link, { redirect: "manual" });
  const location = verifyResp.headers.get("location") || "";
  const hash = location.split("#")[1];
  const params = new URLSearchParams(hash);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  const { createServerClient } = await import("@supabase/ssr");
  const setCookies = [];
  const authForCookies = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
  });
  await authForCookies.auth.setSession({ access_token, refresh_token });
  await context.addCookies(setCookies.map((c) => ({ name: c.name, value: c.value, domain: "localhost", path: "/" })));
}

const results = [];
function log(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`[${ok ? "OK" : "FAIL"}] ${step} :: ${detail}`);
}

// One representative page per logical section, its expected signature
// accent (rgb form, since getComputedStyle always returns rgb/rgba), and a
// selector for the element that should carry that accent.
const PAGES = [
  {
    section: "Dashboard/Home",
    path: "/alerts",
    expectedRgb: "rgb(29, 78, 216)", // #1D4ED8
    selector: "h1",
    prop: "color",
    screenshot: "smoke-test-output/section-accent-dashboard-alerts.png",
  },
  {
    section: "Research & Discovery",
    path: "/foundations",
    expectedRgb: "rgb(2, 132, 199)", // #0284C7
    selector: "h1",
    prop: "color",
    screenshot: "smoke-test-output/section-accent-research-foundations.png",
  },
  {
    section: "Applications & Pipeline",
    path: "/applications",
    expectedRgb: "rgb(14, 116, 144)", // #0E7490
    selector: "h1",
    prop: "color",
    screenshot: "smoke-test-output/section-accent-pipeline-applications.png",
  },
  {
    section: "Intelligence & Reports",
    path: "/outcomes",
    expectedRgb: "rgb(124, 58, 237)", // #7C3AED
    selector: "h1",
    prop: "color",
    screenshot: "smoke-test-output/section-accent-intelligence-outcomes.png",
  },
  {
    section: "Donor Discovery & Outreach",
    path: "/donor-discovery/prospects",
    expectedRgb: "rgb(76, 81, 198)", // #4C51C6
    selector: "h1",
    prop: "color",
    screenshot: "smoke-test-output/section-accent-outreach-prospects.png",
  },
  {
    section: "Admin & Settings",
    path: "/admin/orgs",
    expectedRgb: "rgb(34, 211, 238)", // #22D3EE (border, not text — checked separately below)
    selector: null,
    prop: null,
    screenshot: "smoke-test-output/section-accent-admin-orgs.png",
  },
];

async function checkShell(page, label) {
  const sidebarBg = await page.evaluate(() => {
    const aside = document.querySelector("aside[aria-label='Primary navigation']");
    return aside ? getComputedStyle(aside).backgroundImage : null;
  });
  const sidebarOk = !!sidebarBg && sidebarBg.includes("29, 78, 216") && sidebarBg.includes("2, 132, 199");
  log(`${label}:shell-sidebar-gradient-unchanged`, sidebarOk, String(sidebarBg));

  const headerBg = await page.evaluate(() => {
    const header = document.querySelector("header");
    return header ? getComputedStyle(header).backgroundColor : null;
  });
  log(`${label}:shell-header-deep-blue-unchanged`, headerBg === "rgb(29, 78, 216)", String(headerBg));

  const navColors = await page.evaluate(() => {
    const aside = document.querySelector("aside[aria-label='Primary navigation']");
    if (!aside) return [];
    return Array.from(aside.querySelectorAll("nav a, a#tour-nav-settings")).map((a) => getComputedStyle(a).color);
  });
  const badNav = navColors.filter((c) => c !== "rgb(255, 255, 255)");
  log(`${label}:shell-nav-text-white`, navColors.length > 0 && badNav.length === 0, `total=${navColors.length} bad=${JSON.stringify(badNav)}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await loginAsFaith(context);
  const page = await context.newPage();

  try {
    for (const p of PAGES) {
      const consoleErrors = [];
      const handler = (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); };
      page.on("console", handler);

      await page.goto(BASE_URL + p.path, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(2000);
      log(`${p.section}:loaded`, page.url().includes(p.path), page.url());

      await page.screenshot({ path: p.screenshot, fullPage: false });

      if (p.selector) {
        const actual = await page.evaluate(
          ({ sel, prop }) => {
            const el = document.querySelector(sel);
            return el ? getComputedStyle(el)[prop] : null;
          },
          { sel: p.selector, prop: p.prop },
        );
        log(`${p.section}:accent-applied`, actual === p.expectedRgb, `expected=${p.expectedRgb} actual=${actual}`);
      } else if (p.path === "/admin/orgs") {
        // Admin header uses a bottom-border accent, not a text color, to
        // preserve white-on-dark contrast — checked directly.
        const borderColor = await page.evaluate(() => {
          const h1 = document.querySelector("h1");
          const panel = h1 ? h1.closest("div") : null;
          return panel ? getComputedStyle(panel).borderBottomColor : null;
        });
        log(`${p.section}:accent-applied`, borderColor === p.expectedRgb, `expected=${p.expectedRgb} actual=${borderColor}`);
      }

      await checkShell(page, p.section);

      page.off("console", handler);
      log(`${p.section}:console-errors`, consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 5)));
    }
  } catch (err) {
    log("fatal", false, err.stack || String(err));
  } finally {
    await browser.close();
  }

  console.log("\n=== RESULTS JSON ===");
  console.log(JSON.stringify(results, null, 2));
  const allOk = results.every((r) => r.ok);
  console.log(`\n${allOk ? "ALL PASS" : "SOME FAILED"} (${results.filter((r) => r.ok).length}/${results.length})`);
  process.exit(allOk ? 0 : 1);
}

main();
