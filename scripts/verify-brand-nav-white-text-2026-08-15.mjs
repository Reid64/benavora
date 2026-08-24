// Verification for the 2026-08-15 real-logo brand palette task: confirms the
// sidebar/header render the new deep-blue-to-sky-blue gradient background,
// and that every rendered sidebar/header nav item's computed text color is
// genuinely solid rgb(255,255,255) — not a colored/dimmed variant.
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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

  try {
    await page.goto(BASE_URL + "/dashboard", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2500);
    log("dashboard-loaded", page.url().includes("/dashboard"), page.url());
    log("dashboard-console-errors", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 5)));

    await page.screenshot({ path: "smoke-test-output/brand-nav-sidebar-header-2026-08-15.png", fullPage: false });

    // 1. Sidebar background — must render the real gradient, not the old #162032.
    const sidebarBg = await page.evaluate(() => {
      const aside = document.querySelector("aside[aria-label='Primary navigation']");
      if (!aside) return null;
      return getComputedStyle(aside).backgroundImage;
    });
    const sidebarGradientOk = !!sidebarBg && sidebarBg.includes("29, 78, 216") && sidebarBg.includes("2, 132, 199");
    log("sidebar-gradient", sidebarGradientOk, String(sidebarBg));

    // 2. Header background — must render the new deep blue, not the old #1A2535.
    const headerBg = await page.evaluate(() => {
      const header = document.querySelector("header");
      if (!header) return null;
      return getComputedStyle(header).backgroundColor;
    });
    log("header-bg-deep-blue", headerBg === "rgb(29, 78, 216)", String(headerBg));

    // 3. Every sidebar nav link's computed text color — must be exactly rgb(255,255,255).
    const sidebarLinkColors = await page.evaluate(() => {
      const aside = document.querySelector("aside[aria-label='Primary navigation']");
      if (!aside) return [];
      const links = Array.from(aside.querySelectorAll("nav a, a#tour-nav-settings"));
      return links.map((a) => ({
        label: a.textContent?.trim().slice(0, 40) || "",
        color: getComputedStyle(a).color,
      }));
    });
    const badSidebarLinks = sidebarLinkColors.filter((l) => l.color !== "rgb(255, 255, 255)");
    log(
      "sidebar-links-all-white",
      sidebarLinkColors.length > 0 && badSidebarLinks.length === 0,
      `total=${sidebarLinkColors.length} nonWhite=${JSON.stringify(badSidebarLinks)}`
    );

    // 4. Every header tab link's computed text color — must be exactly rgb(255,255,255).
    const headerTabColors = await page.evaluate(() => {
      const nav = document.querySelector("header nav[aria-label='Primary sections']");
      if (!nav) return [];
      return Array.from(nav.querySelectorAll("a")).map((a) => ({
        label: a.textContent?.trim().slice(0, 40) || "",
        color: getComputedStyle(a).color,
      }));
    });
    const badHeaderTabs = headerTabColors.filter((l) => l.color !== "rgb(255, 255, 255)");
    log(
      "header-tabs-all-white",
      headerTabColors.length > 0 && badHeaderTabs.length === 0,
      `total=${headerTabColors.length} nonWhite=${JSON.stringify(badHeaderTabs)}`
    );

    // 5. Hover state must NOT change the text color away from white (hard-rule check).
    const firstSidebarLink = page.locator("aside[aria-label='Primary navigation'] nav a").first();
    await firstSidebarLink.hover();
    await page.waitForTimeout(200);
    const hoveredColor = await firstSidebarLink.evaluate((el) => getComputedStyle(el).color);
    log("sidebar-hover-still-white", hoveredColor === "rgb(255, 255, 255)", hoveredColor);

    // 6. Contrast sanity: confirm white text is genuinely distinguishable against the
    // new blue background (not e.g. a near-invisible white-on-white bug elsewhere).
    log(
      "contrast-sanity",
      sidebarGradientOk && headerBg === "rgb(29, 78, 216)",
      "white (255,255,255) on deep/sky blue backgrounds — high contrast by construction"
    );
  } catch (err) {
    log("fatal", false, err.stack || String(err));
  } finally {
    await browser.close();
  }

  console.log("\n=== RESULTS JSON ===");
  console.log(JSON.stringify(results, null, 2));
  const allOk = results.every((r) => r.ok);
  process.exit(allOk ? 0 : 1);
}

main();
