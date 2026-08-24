// Verification for the /research page treatment pass (2026-08-16), per
// PAGE_TREATMENT_PROTOCOL.md: Research & Discovery section, accent #0284C7.
// Checks: page loads without error, PageHeader accent applied, tab-bar
// active indicator uses the section accent, Research Resources "Visit"
// buttons use the fixed teal #22D3EE, no console errors, real data renders,
// and the shared sidebar/header shell + nav text are unchanged.
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  try {
    // BEFORE screenshot not needed here (code diff is the record); capture AFTER state.
    await page.goto(BASE_URL + "/research", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2500);
    log("loaded", page.url().includes("/research"), page.url());

    const bodyText = await page.evaluate(() => document.body.innerText);
    log("no-error-message", !/could not load/i.test(bodyText), "checked for 'could not load' text");

    await page.screenshot({ path: "smoke-test-output/research-accent-after-2026-08-16.png", fullPage: true });

    // PageHeader accent (h1 color + left border)
    const headerColor = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      return h1 ? getComputedStyle(h1).color : null;
    });
    log("pageheader-title-color", headerColor === "rgb(2, 132, 199)", `expected rgb(2, 132, 199) actual=${headerColor}`);

    const headerBorder = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      const wrap = h1 ? h1.closest("div") : null;
      return wrap ? getComputedStyle(wrap).borderLeftColor : null;
    });
    log("pageheader-left-border-color", headerBorder === "rgb(2, 132, 199)", `expected rgb(2, 132, 199) actual=${headerBorder}`);

    // Tab bar active indicator
    const activeTabBorder = await page.evaluate(() => {
      const nav = document.querySelector("nav[aria-label='Research tabs']");
      if (!nav) return null;
      const activeBtn = Array.from(nav.querySelectorAll("button")).find(
        (b) => b.getAttribute("aria-current") === "page",
      );
      return activeBtn ? getComputedStyle(activeBtn).borderBottomColor : null;
    });
    log("active-tab-indicator-color", activeTabBorder === "rgb(2, 132, 199)", `expected rgb(2, 132, 199) actual=${activeTabBorder}`);

    // Click the Search Configuration tab, confirm it becomes active with the accent, and Research becomes inactive.
    await page.click("nav[aria-label='Research tabs'] button:has-text('Search Configuration')");
    await page.waitForTimeout(500);
    const configTabState = await page.evaluate(() => {
      const nav = document.querySelector("nav[aria-label='Research tabs']");
      const buttons = Array.from(nav.querySelectorAll("button"));
      return buttons.map((b) => ({
        label: b.textContent,
        current: b.getAttribute("aria-current"),
        borderColor: getComputedStyle(b).borderBottomColor,
      }));
    });
    log(
      "tab-switch-works",
      configTabState.some((b) => b.label?.includes("Search Configuration") && b.current === "page" && b.borderColor === "rgb(2, 132, 199)") &&
        configTabState.some((b) => b.label?.includes("Research") && !b.label?.includes("Search") && b.current !== "page"),
      JSON.stringify(configTabState),
    );
    // Switch back to Research tab for the rest of the checks.
    await page.click("nav[aria-label='Research tabs'] button:has-text('Research')");
    await page.waitForTimeout(500);

    // Research Resources "Visit" buttons -> fixed teal #22D3EE
    const visitButtons = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a")).filter((a) => a.textContent.trim() === "Visit");
      return anchors.map((a) => ({
        bg: getComputedStyle(a).backgroundColor,
        color: getComputedStyle(a).color,
        href: a.getAttribute("href"),
      }));
    });
    const allTeal = visitButtons.length > 0 && visitButtons.every((b) => b.bg === "rgb(34, 211, 238)");
    log("resource-visit-buttons-teal", allTeal, JSON.stringify(visitButtons));

    // Confirm real resource names render (Grants.gov etc.)
    log(
      "real-resource-names-render",
      /Grants\.gov/i.test(bodyText) && (/SAM\.gov/i.test(bodyText) || /USAspending/i.test(bodyText)),
      "checked for Grants.gov + SAM.gov/USAspending text",
    );

    await checkShell(page);

    log("console-errors", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 8)));
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

async function checkShell(page) {
  const sidebarBg = await page.evaluate(() => {
    const aside = document.querySelector("aside[aria-label='Primary navigation']");
    return aside ? getComputedStyle(aside).backgroundImage : null;
  });
  const sidebarOk = !!sidebarBg && sidebarBg.includes("29, 78, 216") && sidebarBg.includes("2, 132, 199");
  log("shell-sidebar-gradient-unchanged", sidebarOk, String(sidebarBg));

  const headerBg = await page.evaluate(() => {
    const header = document.querySelector("header");
    return header ? getComputedStyle(header).backgroundColor : null;
  });
  log("shell-header-deep-blue-unchanged", headerBg === "rgb(29, 78, 216)", String(headerBg));

  const navColors = await page.evaluate(() => {
    const aside = document.querySelector("aside[aria-label='Primary navigation']");
    if (!aside) return [];
    return Array.from(aside.querySelectorAll("nav a, a#tour-nav-settings")).map((a) => getComputedStyle(a).color);
  });
  const badNav = navColors.filter((c) => c !== "rgb(255, 255, 255)");
  log("shell-nav-text-white", navColors.length > 0 && badNav.length === 0, `total=${navColors.length} bad=${JSON.stringify(badNav)}`);
}

main();
