// Verification for the 2026-08-16 Research & Discovery (#0284C7) section-accent
// pass on /contacts, plus the fixed-teal (#22D3EE) "New contact" CTA treatment.
// Reuses the magic-link login technique established in
// verify-section-accents-2026-08-15.mjs / verify-foundations-accent-2026-08-16.mjs.
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
    await page.goto(BASE_URL + "/contacts", { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(3000);
    log("loaded", page.url().includes("/contacts"), page.url());

    await page.screenshot({
      path: `smoke-test-output/contacts-accent-${MODE}-2026-08-16.png`,
      fullPage: true,
    });

    // Real data renders — title present.
    const titleText = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("h1, h2, div"));
      const t = nodes.find((d) => d.textContent?.trim() === "Contacts");
      return t ? t.textContent : null;
    });
    log("title-present", titleText === "Contacts", String(titleText));

    // Contact rows or empty state present (real data check).
    const searchOk = await page.evaluate(() => {
      const input = document.querySelector('input[aria-label="Search contacts"]');
      return !!input;
    });
    log("search-filter-intact", searchOk, String(searchOk));

    if (MODE === "after") {
      const ACCENT = "rgb(2, 132, 199)"; // #0284C7
      const TEAL = "rgb(34, 211, 238)"; // #22D3EE

      // 1. PageHeader title + left border accent.
      const headerAccent = await page.evaluate(() => {
        const h1 = Array.from(document.querySelectorAll("h1")).find((h) => h.textContent?.trim() === "Contacts");
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

      // 2. "New contact" CTA is fixed teal.
      const ctaColor = await page.evaluate(() => {
        const link = Array.from(document.querySelectorAll("a")).find((a) => a.textContent?.trim() === "New contact");
        return link ? { bg: getComputedStyle(link).backgroundColor, color: getComputedStyle(link).color } : null;
      });
      log("new-contact-cta-teal", !!ctaColor && ctaColor.bg === TEAL, JSON.stringify(ctaColor));

      // 3. Search input focus ring color (arbitrary-value class present).
      const searchFocusClass = await page.evaluate(() => {
        const input = document.querySelector('input[aria-label="Search contacts"]');
        return input ? input.className : null;
      });
      log(
        "search-focus-ring-accent",
        !!searchFocusClass && searchFocusClass.includes("focus:border-[#0284C7]"),
        String(searchFocusClass),
      );

      // 4. List/Grid view toggle active state uses accent.
      const toggleAccent = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll("button")).find(
          (b) => b.getAttribute("aria-pressed") === "true",
        );
        return btn ? getComputedStyle(btn).backgroundColor : null;
      });
      log("view-toggle-accent", toggleAccent === ACCENT, String(toggleAccent));

      // 5. Relationship-warmth badges keep their own semantic color (not the accent).
      const badgeColors = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll("span"));
        return spans
          .filter((s) => ["Cold", "Warm", "Active", "Champion"].includes(s.textContent?.trim() ?? ""))
          .map((s) => ({ text: s.textContent?.trim(), bg: getComputedStyle(s).backgroundColor }));
      });
      const badgesNotAccented = badgeColors.every((b) => b.bg !== ACCENT && b.bg !== TEAL);
      log("relationship-badges-semantic", badgesNotAccented, JSON.stringify(badgeColors));

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
