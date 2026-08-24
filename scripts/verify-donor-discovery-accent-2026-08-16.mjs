// Verification for the /donor-discovery page treatment pass (2026-08-16), per
// PAGE_TREATMENT_PROTOCOL.md: Research & Discovery section, accent #0284C7.
// Checks: page loads without error, header accent applied, "Discover
// Prospects" header CTA uses the fixed teal #22D3EE, Prospects
// Identified/Active Campaigns stats use the section accent while
// High-Intent Signals (amber)/AutoApply Submissions (green) stay semantic,
// the four quick-action cards render a polished empty-state CTA chip (teal)
// where their underlying data is empty, no console errors, real data
// renders, and the shared sidebar/header shell + nav text are unchanged.
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

const MODE = process.argv[2] || "after"; // "before" | "after"

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  try {
    await page.goto(BASE_URL + "/donor-discovery", { waitUntil: "load", timeout: 30000 });
    await page
      .waitForFunction(
        () => !Array.from(document.querySelectorAll("p")).some((p) => p.textContent?.trim() === "Loading…"),
        { timeout: 20000 },
      )
      .catch(() => {});
    await page.waitForTimeout(500);
    log("loaded", page.url().includes("/donor-discovery"), page.url());

    const bodyText = await page.evaluate(() => document.body.innerText);
    log("no-error-message", !/could not load/i.test(bodyText), "checked for 'could not load' text");

    await page.screenshot({ path: `smoke-test-output/donor-discovery-accent-${MODE}-2026-08-16.png`, fullPage: true });

    if (MODE === "after") {
      // Header title color + left border
      const header = await page.evaluate(() => {
        const h1 = Array.from(document.querySelectorAll("h1")).find((h) => h.textContent?.trim() === "Donor Discovery");
        const wrap = h1 ? h1.closest("div") : null;
        return {
          color: h1 ? getComputedStyle(h1).color : null,
          borderLeft: wrap ? getComputedStyle(wrap).borderLeftColor : null,
        };
      });
      log("header-title-color", header.color === "rgb(2, 132, 199)", `actual=${header.color}`);
      log("header-left-border-color", header.borderLeft === "rgb(2, 132, 199)", `actual=${header.borderLeft}`);

      // Header "Discover Prospects" CTA -> fixed teal
      const headerCta = await page.evaluate(() => {
        const a = Array.from(document.querySelectorAll("a")).find((el) => el.textContent?.trim() === "Discover Prospects" && el.getAttribute("href") === "/donor-discovery/new");
        return a ? { bg: getComputedStyle(a).backgroundColor, color: getComputedStyle(a).color } : null;
      });
      log(
        "header-cta-teal",
        !!headerCta && headerCta.bg === "rgb(34, 211, 238)" && headerCta.color === "rgb(10, 22, 40)",
        JSON.stringify(headerCta),
      );

      // Top KPI row: Prospects Identified + Active Campaigns -> accent; High-Intent (amber) + AutoApply (green) untouched
      const statColors = await page.evaluate(() => {
        const labels = ["Prospects Identified", "High-Intent Signals", "Active Campaigns", "AutoApply Submissions"];
        return labels.map((label) => {
          const el = Array.from(document.querySelectorAll("p")).find((p) => p.textContent?.trim() === label);
          const valueEl = el ? el.nextElementSibling : null;
          return { label, color: valueEl ? getComputedStyle(valueEl).color : null };
        });
      });
      const prospectsStat = statColors.find((s) => s.label === "Prospects Identified");
      const highIntentStat = statColors.find((s) => s.label === "High-Intent Signals");
      const campaignsStat = statColors.find((s) => s.label === "Active Campaigns");
      const autoApplyStat = statColors.find((s) => s.label === "AutoApply Submissions");
      log("stat-prospects-identified-accent", prospectsStat?.color === "rgb(2, 132, 199)", JSON.stringify(prospectsStat));
      log("stat-active-campaigns-accent", campaignsStat?.color === "rgb(2, 132, 199)", JSON.stringify(campaignsStat));
      log("stat-high-intent-still-amber", highIntentStat?.color === "rgb(245, 158, 11)", JSON.stringify(highIntentStat));
      log("stat-autoapply-still-green", autoApplyStat?.color === "rgb(16, 185, 129)", JSON.stringify(autoApplyStat));

      // Quick-action cards: empty ones should show a teal CTA chip
      const cardChecks = await page.evaluate(() => {
        const labels = ["Discover Prospects", "Corporate Marketplace", "Corporate Outreach", "Intent Signals"];
        return labels.map((label) => {
          const p = Array.from(document.querySelectorAll("p")).find((el) => el.textContent?.trim() === label && el.className.includes("font-bold"));
          const card = p ? p.closest("a") : null;
          if (!card) return { label, found: false };
          const chip = Array.from(card.querySelectorAll("span")).find((s) => getComputedStyle(s).borderRadius === "9999px");
          return {
            label,
            found: true,
            chipText: chip ? chip.textContent?.trim() : null,
            chipBg: chip ? getComputedStyle(chip).backgroundColor : null,
          };
        });
      });
      for (const c of cardChecks) {
        log(`quick-action-card:${c.label}`, c.found, JSON.stringify(c));
      }
      const emptyChipsOk = cardChecks.every((c) => !c.chipBg || c.chipBg === "rgb(34, 211, 238)");
      log("quick-action-empty-chips-teal", emptyChipsOk, JSON.stringify(cardChecks));

      log("real-data-renders", /Active Requests|Pipeline Funnel|Top Prospects/.test(bodyText), "checked for section headings");

      await checkShell(page);
    }

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
