// Verification for the 2026-08-16 Research & Discovery (#0284C7) section-accent
// pass on /nonprofits. Reuses the magic-link login technique established in
// verify-section-accents-2026-08-15.mjs / verify-dashboard-accent-2026-08-16.mjs.
// Run with an argument of "before" or "after" to pick the screenshot filename;
// accent-element checks only run in "after" mode.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { WebSocket } from "ws";
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

const MODE = process.argv[2] === "after" ? "after" : "before";

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
  const context = await browser.newContext({ viewport: { width: 1600, height: 1400 } });
  await loginAsFaith(context);
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  try {
    await page.goto(BASE_URL + "/nonprofits", { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(2500);
    log("loaded", page.url().includes("/nonprofits"), page.url());

    await page.screenshot({
      path: `smoke-test-output/nonprofits-accent-${MODE}-2026-08-16.png`,
      fullPage: true,
    });

    // Real data renders — title + count present.
    const titleText = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("div"));
      const t = nodes.find((d) => d.textContent?.trim() === "Nonprofit Directory");
      return t ? t.textContent : null;
    });
    log("title-present", titleText === "Nonprofit Directory", String(titleText));

    // Table rows present (real data, not empty state) unless explicitly filtered to nothing.
    const rowCount = await page.evaluate(() => {
      const grid = Array.from(document.querySelectorAll("span")).filter((s) => s.textContent === "Name");
      return grid.length;
    });
    log("table-header-present", rowCount >= 1, `count=${rowCount}`);

    // Search + state filter form still present and functional-looking.
    const formOk = await page.evaluate(() => {
      const input = document.querySelector('input[name="search"]');
      const select = document.querySelector('select[name="state"]');
      const submit = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Search");
      return !!input && !!select && !!submit;
    });
    log("search-filter-form-intact", formOk, String(formOk));

    // A real per-row website link still exists and is unstyled by this pass (#00B4D8).
    const websiteLinkColor = await page.evaluate(() => {
      const a = document.querySelector('a[target="_blank"][rel="noreferrer"]');
      return a ? getComputedStyle(a).color : null;
    });
    log(
      "website-link-present-and-unchanged",
      websiteLinkColor === "rgb(0, 180, 216)",
      `expected=rgb(0, 180, 216) actual=${websiteLinkColor}`,
    );

    // Revenue semantic-ish green untouched.
    const revenueColor = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll("span"));
      const rev = spans.find((s) => /^\$/.test(s.textContent?.trim() ?? ""));
      return rev ? getComputedStyle(rev).color : null;
    });
    log(
      "revenue-color-untouched",
      revenueColor === "rgb(52, 211, 153)",
      `expected=rgb(52, 211, 153) actual=${revenueColor}`,
    );

    if (MODE === "after") {
      const ACCENT = "rgb(2, 132, 199)"; // #0284C7

      // 1. Page's own header chrome left-border-bar. Exclude the sidebar nav
      // link, which shares the exact same text ("Nonprofit Directory").
      const headerBorder = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll("main div, body > div div")).filter(
          (d) => d.textContent?.trim() === "Nonprofit Directory" && !d.closest("aside"),
        );
        const title = nodes[0];
        const wrap = title ? title.parentElement : null;
        return wrap ? getComputedStyle(wrap).borderLeftColor : null;
      });
      log("header-chrome-accent", headerBorder === ACCENT, `expected=${ACCENT} actual=${headerBorder}`);

      // 2. Stat pill values carry the accent.
      const chipValueColor = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll("span"));
        const totalChip = spans.find((s) => s.textContent?.startsWith("Total:"));
        const valueSpan = totalChip ? totalChip.querySelector("span") : null;
        return valueSpan ? getComputedStyle(valueSpan).color : null;
      });
      log("stat-pill-value-accent", chipValueColor === "rgb(56, 189, 248)", `actual=${chipValueColor}`);

      const chipBorderColor = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll("span"));
        const totalChip = spans.find((s) => s.textContent?.startsWith("Total:"));
        return totalChip ? getComputedStyle(totalChip).borderColor : null;
      });
      log("stat-pill-border-accent-tint", (chipBorderColor || "").includes("2, 132, 199"), `actual=${chipBorderColor}`);

      // 3. Table header bottom-border accent.
      const tableHeaderBorder = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll("span"));
        const nameLabel = spans.find((s) => s.textContent?.trim() === "Name");
        const headerRow = nameLabel ? nameLabel.parentElement : null;
        return headerRow ? getComputedStyle(headerRow).borderBottomColor : null;
      });
      log("table-header-accent", tableHeaderBorder === ACCENT, `expected=${ACCENT} actual=${tableHeaderBorder}`);

      // Shared shell (sidebar gradient + header + nav text) unchanged.
      const sidebarBg = await page.evaluate(() => {
        const aside = document.querySelector("aside[aria-label='Primary navigation']");
        return aside ? getComputedStyle(aside).backgroundImage : null;
      });
      log(
        "shell-sidebar-gradient-unchanged",
        !!sidebarBg && sidebarBg.includes("29, 78, 216") && sidebarBg.includes("2, 132, 199"),
        String(sidebarBg),
      );
      const navColors = await page.evaluate(() => {
        const aside = document.querySelector("aside[aria-label='Primary navigation']");
        if (!aside) return [];
        return Array.from(aside.querySelectorAll("nav a, a#tour-nav-settings")).map((a) => getComputedStyle(a).color);
      });
      const badNav = navColors.filter((c) => c !== "rgb(255, 255, 255)");
      log("shell-nav-text-white", navColors.length > 0 && badNav.length === 0, `total=${navColors.length} bad=${JSON.stringify(badNav)}`);
    }

    log("console-errors", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 10)));
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
