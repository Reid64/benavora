// Verification for the 2026-08-16 Research & Discovery (#0284C7) section-accent
// pass on /funders, plus the fixed-teal (#22D3EE) "New funder" CTA treatment.
// Reuses the magic-link login technique established in
// verify-section-accents-2026-08-15.mjs / verify-foundations-accent-2026-08-16.mjs.
// Run with an argument of "before" or "after" to pick the screenshot filename;
// accent/CTA checks only run in "after" mode.
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
    await page.goto(BASE_URL + "/funders", { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(3000);
    log("loaded", page.url().includes("/funders"), page.url());

    await page.screenshot({
      path: `smoke-test-output/funders-accent-${MODE}-2026-08-16.png`,
      fullPage: true,
    });

    // Real data renders — title present.
    const titleText = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("h1"));
      const t = nodes.find((d) => d.textContent?.trim() === "Funders");
      return t ? t.textContent : null;
    });
    log("title-present", titleText === "Funders", String(titleText));

    // Search + filter bar intact (real functionality unbroken).
    const formOk = await page.evaluate(() => {
      const input = document.querySelector('input[aria-label="Search funders"]');
      return !!input;
    });
    log("search-filter-intact", formOk, String(formOk));

    if (MODE === "after") {
      const ACCENT = "rgb(2, 132, 199)"; // #0284C7
      const TEAL = "rgb(34, 211, 238)"; // #22D3EE

      // 1. PageHeader title + left-border accent.
      const headerAccent = await page.evaluate(() => {
        const h1 = Array.from(document.querySelectorAll("h1")).find((h) => h.textContent?.trim() === "Funders");
        const wrap = h1 ? h1.parentElement : null;
        return {
          titleColor: h1 ? getComputedStyle(h1).color : null,
          borderLeft: wrap ? getComputedStyle(wrap).borderLeftColor : null,
        };
      });
      log(
        "pageheader-accent",
        headerAccent.titleColor === ACCENT && headerAccent.borderLeft === ACCENT,
        JSON.stringify(headerAccent),
      );

      // 2. "New funder" CTA is fixed teal (both header and any empty-state instance).
      const ctaColors = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("a")).filter((a) => a.textContent?.trim() === "New funder").map((a) => ({
          bg: getComputedStyle(a).backgroundColor,
          color: getComputedStyle(a).color,
        }));
      });
      log(
        "new-funder-cta-teal",
        ctaColors.length > 0 && ctaColors.every((c) => c.bg === TEAL),
        JSON.stringify(ctaColors),
      );

      // 3. Category badges (Foundation/Corporate/Government) keep their own
      // distinct styling, NOT the section accent — spot-check any rendered.
      const badgeColors = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("span")).filter((s) =>
          ["Government", "Foundation", "Corporate"].includes(s.textContent?.trim() ?? ""),
        ).map((s) => ({ label: s.textContent?.trim(), bg: getComputedStyle(s).backgroundColor }));
      });
      const ACCENT_RGB = "rgb(2, 132, 199)";
      const badgesUntouched = badgeColors.every((b) => b.bg !== ACCENT_RGB);
      log("category-badges-untouched", badgesUntouched, JSON.stringify(badgeColors));

      // Shared shell (sidebar gradient + nav text) unchanged.
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
