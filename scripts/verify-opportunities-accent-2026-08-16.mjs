// Verification for the /opportunities page treatment pass (2026-08-16), per
// PAGE_TREATMENT_PROTOCOL.md: Research & Discovery section, accent #0284C7.
// Checks: page loads without error, header accent applied, filter-pill active
// state uses the section accent, "Add Opportunity"/"Apply Now" buttons use
// the fixed teal #22D3EE, probability/deadline colors are untouched (real
// semantic colors), no console errors, real data renders, and the shared
// sidebar/header shell + nav text are unchanged.
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  try {
    await page.goto(BASE_URL + "/opportunities", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(3000);
    log("loaded", page.url().includes("/opportunities"), page.url());

    const bodyText = await page.evaluate(() => document.body.innerText);
    log("no-error-message", !/could not load/i.test(bodyText), "checked for 'could not load' text");

    await page.screenshot({ path: "smoke-test-output/opportunities-accent-after-2026-08-16.png", fullPage: true });

    // Header title color + left border
    const headerColor = await page.evaluate(() => {
      const h1 = Array.from(document.querySelectorAll("h1")).find((h) => h.textContent?.trim() === "Opportunities");
      return h1 ? getComputedStyle(h1).color : null;
    });
    log("header-title-color", headerColor === "rgb(2, 132, 199)", `expected rgb(2, 132, 199) actual=${headerColor}`);

    const headerBorder = await page.evaluate(() => {
      const h1 = Array.from(document.querySelectorAll("h1")).find((h) => h.textContent?.trim() === "Opportunities");
      const wrap = h1 ? h1.closest("div") : null;
      return wrap ? getComputedStyle(wrap).borderLeftColor : null;
    });
    log("header-left-border-color", headerBorder === "rgb(2, 132, 199)", `expected rgb(2, 132, 199) actual=${headerBorder}`);

    // Add Opportunity button -> fixed teal
    const addOppBtn = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll("a")).find((el) => el.textContent?.includes("Add Opportunity"));
      return a ? { bg: getComputedStyle(a).backgroundColor, color: getComputedStyle(a).color } : null;
    });
    log(
      "add-opportunity-button-teal",
      !!addOppBtn && addOppBtn.bg === "rgb(34, 211, 238)",
      JSON.stringify(addOppBtn),
    );

    // Filter pills: click "Federal", confirm active pill uses section accent
    await page.click("button:has-text('Federal')");
    await page.waitForTimeout(500);
    const activePill = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Federal");
      return btn ? { bg: getComputedStyle(btn).backgroundColor, color: getComputedStyle(btn).color } : null;
    });
    log(
      "filter-pill-active-accent",
      !!activePill && activePill.bg === "rgb(2, 132, 199)" && activePill.color === "rgb(255, 255, 255)",
      JSON.stringify(activePill),
    );
    // Confirm an inactive pill is NOT accented
    const inactivePill = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "All");
      return btn ? { bg: getComputedStyle(btn).backgroundColor } : null;
    });
    log("filter-pill-inactive-not-accented", !!inactivePill && inactivePill.bg !== "rgb(2, 132, 199)", JSON.stringify(inactivePill));
    // Reset to All
    await page.click("button:has-text('All')");
    await page.waitForTimeout(500);

    // Stat cards: Open Opportunities should be section accent; High Probability/Closing This Week stay semantic
    const statColors = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll("div")).filter((d) =>
        ["Open Opportunities", "High Probability >70%", "Closing This Week", "Total Potential"].includes(d.textContent?.trim()),
      );
      return labels.map((l) => {
        const valueEl = l.nextElementSibling;
        return { label: l.textContent?.trim(), color: valueEl ? getComputedStyle(valueEl).color : null };
      });
    });
    const openStat = statColors.find((s) => s.label === "Open Opportunities");
    const totalStat = statColors.find((s) => s.label === "Total Potential");
    const highProbStat = statColors.find((s) => s.label === "High Probability >70%");
    const closingStat = statColors.find((s) => s.label === "Closing This Week");
    log("stat-open-opportunities-accent", openStat?.color === "rgb(2, 132, 199)", JSON.stringify(openStat));
    log("stat-total-potential-accent", totalStat?.color === "rgb(2, 132, 199)", JSON.stringify(totalStat));
    log("stat-high-probability-still-green", highProbStat?.color === "rgb(22, 163, 74)", JSON.stringify(highProbStat));
    log("stat-closing-soon-still-amber", closingStat?.color === "rgb(217, 119, 6)", JSON.stringify(closingStat));

    // Apply Now buttons -> fixed teal, and probability badges keep real semantic colors (not accent, not teal)
    const cardChecks = await page.evaluate(() => {
      const applyLinks = Array.from(document.querySelectorAll("a")).filter((a) => a.textContent?.trim() === "Apply Now");
      const applyColors = applyLinks.slice(0, 5).map((a) => getComputedStyle(a).backgroundColor);
      return { applyCount: applyLinks.length, applyColors };
    });
    log(
      "apply-now-buttons-teal",
      cardChecks.applyCount > 0 && cardChecks.applyColors.every((c) => c === "rgb(34, 211, 238)"),
      JSON.stringify(cardChecks),
    );

    log("real-opportunity-data-renders", /\$|Due |Rolling deadline/.test(bodyText), "checked for currency/deadline text");

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
