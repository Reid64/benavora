// Verification for the 2026-08-16 Dashboard (#1D4ED8) section-accent pass on
// /dashboard itself. Reuses the magic-link login technique established in
// verify-section-accents-2026-08-15.mjs. Run with an argument of "before" or
// "after" to pick the screenshot filename; accent-element checks only run in
// "after" mode (before mode is the pre-edit load-check / baseline shot).
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
    await page.goto(BASE_URL + "/dashboard", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2500);
    log("loaded", page.url().includes("/dashboard"), page.url());

    await page.screenshot({
      path: `smoke-test-output/dashboard-accent-${MODE}-2026-08-16.png`,
      fullPage: true,
    });

    // Real data renders — org name heading present and non-empty.
    const h1Text = await page.evaluate(() => document.querySelector("h1")?.textContent ?? null);
    log("real-org-name-heading", !!h1Text && h1Text.trim().length > 0, String(h1Text));

    // Pipeline strip present with 6 stages.
    const stageCount = await page.evaluate(() => {
      const strip = Array.from(document.querySelectorAll("div")).find((d) =>
        d.textContent?.trim().startsWith("Pipeline") && d.querySelector("a"),
      );
      return strip ? strip.querySelectorAll("a").length : 0;
    });
    log("pipeline-6-stages-present", stageCount === 6, `count=${stageCount}`);

    if (MODE === "after") {
      const ACCENT = "rgb(29, 78, 216)"; // #1D4ED8

      // 1. Page's own header chrome (org name row) left-border-bar.
      const headerBorder = await page.evaluate(() => {
        const h1 = document.querySelector("h1");
        const wrap = h1 ? h1.parentElement : null;
        return wrap ? getComputedStyle(wrap).borderLeftColor : null;
      });
      log("header-chrome-accent", headerBorder === ACCENT, `expected=${ACCENT} actual=${headerBorder}`);

      // 2. Pipeline strip outer container chrome.
      const pipelineBorder = await page.evaluate(() => {
        const strip = Array.from(document.querySelectorAll("div")).find((d) =>
          Array.from(d.children).some((c) => c.textContent?.trim() === "Pipeline"),
        );
        return strip ? getComputedStyle(strip).borderLeftColor : null;
      });
      log("pipeline-strip-chrome-accent", pipelineBorder === ACCENT, `expected=${ACCENT} actual=${pipelineBorder}`);

      // 3. KPI Scorecard container chrome.
      const kpiBorder = await page.evaluate(() => {
        const label = Array.from(document.querySelectorAll("span")).find(
          (s) => s.textContent?.trim() === "Platform KPI Scorecard",
        );
        const panel = label ? label.closest("div")?.parentElement : null;
        return panel ? getComputedStyle(panel).borderLeftColor : null;
      });
      log("kpi-scorecard-chrome-accent", kpiBorder === ACCENT, `expected=${ACCENT} actual=${kpiBorder}`);

      // 4. AI Triggers panel chrome.
      const aiTriggersBorder = await page.evaluate(() => {
        const label = Array.from(document.querySelectorAll("div")).find(
          (d) => d.textContent?.trim() === "AI Triggers" && d.children.length === 0,
        );
        const panel = label ? label.parentElement : null;
        return panel ? getComputedStyle(panel).borderLeftColor : null;
      });
      log("ai-triggers-chrome-accent", aiTriggersBorder === ACCENT, `expected=${ACCENT} actual=${aiTriggersBorder}`);

      // Stage colors untouched (spot-check: Onboard stage should still be
      // green #10B981, not the new accent) — the individual pipeline stage
      // differentiation must survive this pass.
      const onboardStageColor = await page.evaluate(() => {
        const link = Array.from(document.querySelectorAll("a")).find((a) =>
          a.textContent?.toLowerCase().includes("onboard"),
        );
        const divs = link ? Array.from(link.querySelectorAll("div")) : [];
        const valueDiv = divs[1] ?? null;
        return valueDiv ? getComputedStyle(valueDiv).color : null;
      });
      log(
        "pipeline-stage-colors-untouched",
        onboardStageColor === "rgb(16, 185, 129)",
        `Onboard stage value color=${onboardStageColor} (expect green rgb(16,185,129), unchanged)`,
      );

      // Alerts panel semantic red border untouched.
      const alertsBorder = await page.evaluate(() => {
        const label = Array.from(document.querySelectorAll("div")).find(
          (d) => d.textContent?.trim() === "Alerts" && d.children.length === 0,
        );
        const panel = label ? label.parentElement : null;
        return panel ? getComputedStyle(panel).borderLeftColor : null;
      });
      log(
        "alerts-semantic-red-untouched",
        alertsBorder === "rgb(239, 68, 68)",
        `expected=rgb(239, 68, 68) actual=${alertsBorder}`,
      );

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

      // Hero/page dark theme itself untouched (still navy background).
      const bg = await page.evaluate(() => {
        const main = document.querySelector("h1")?.closest('[style*="min-height"]');
        return main ? getComputedStyle(main).backgroundColor : null;
      });
      log("dark-hero-theme-untouched", bg === "rgb(10, 22, 40)", `expected=rgb(10, 22, 40) actual=${bg}`);
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
