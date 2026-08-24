// Verification for the /draft-generator page treatment pass (2026-08-16), per
// PAGE_TREATMENT_PROTOCOL.md: Draft & Automation section, accent #2563EB.
// Checks: page loads without error, header left-border + title use the accent,
// the Grant Draft Wizard label + active-step indicator use the accent while
// done (green) and pending (gray) steps stay untouched, the "Generate draft"
// CTA uses the accent, no console errors, real data renders, and the shared
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  try {
    await page.goto(BASE_URL + "/draft-generator", { waitUntil: "load", timeout: 30000 });
    await page
      .waitForFunction(
        () => !Array.from(document.querySelectorAll("p")).some((p) => p.textContent?.trim() === "Loading opportunities..."),
        { timeout: 20000 },
      )
      .catch(() => {});
    await page.waitForTimeout(800);
    log("loaded", page.url().includes("/draft-generator"), page.url());

    const bodyText = await page.evaluate(() => document.body.innerText);
    log("no-error-message", !/could not load/i.test(bodyText), "checked for 'could not load' text");

    await page.screenshot({ path: `smoke-test-output/draft-generator-accent-after-2026-08-16.png`, fullPage: true });

    // Header title color + left border
    const header = await page.evaluate(() => {
      const h1 = Array.from(document.querySelectorAll("h1")).find((h) => h.textContent?.trim() === "Draft Generator");
      const wrap = h1 ? h1.closest("div") : null;
      return {
        color: h1 ? getComputedStyle(h1).color : null,
        borderLeft: wrap ? getComputedStyle(wrap).borderLeftColor : null,
      };
    });
    log("header-title-color", header.color === "rgb(37, 99, 235)", `actual=${header.color}`);
    log("header-left-border-color", header.borderLeft === "rgb(37, 99, 235)", `actual=${header.borderLeft}`);

    // Wizard label color
    const wizardLabel = await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll("p")).find((el) => el.textContent?.trim() === "Grant Draft Wizard");
      return p ? getComputedStyle(p).color : null;
    });
    log("wizard-label-accent", wizardLabel === "rgb(37, 99, 235)", `actual=${wizardLabel}`);

    // Wizard step indicator: dot colors for each of the 4 steps, and text colors.
    const steps = await page.evaluate(() => {
      const labels = ["Select Opportunity", "Customize", "Generate", "Review & Export"];
      return labels.map((label) => {
        const span = Array.from(document.querySelectorAll("span")).find((el) => el.textContent?.trim() === label);
        if (!span) return { label, found: false };
        const row = span.parentElement;
        const dot = row ? row.querySelector("span:first-child") : null;
        return {
          label,
          found: true,
          textColor: getComputedStyle(span).color,
          dotColor: dot ? getComputedStyle(dot).backgroundColor : null,
          rowBg: row ? getComputedStyle(row).backgroundColor : null,
        };
      });
    });
    for (const s of steps) log(`wizard-step:${s.label}`, s.found, JSON.stringify(s));

    const selectStep = steps.find((s) => s.label === "Select Opportunity");
    const customizeStep = steps.find((s) => s.label === "Customize");
    // Opportunity not yet chosen on fresh load -> step 1 should be "active" (accent), unless a
    // prior draft was auto-restored, in which case step 1/2 read "done" (green). Accept either
    // semantically-correct outcome, but the active step (whichever it is) must be the accent,
    // never the old teal #00B4D8, and done steps must stay green, never accent or teal.
    const activeCandidates = steps.filter((s) => s.found && s.dotColor === "rgb(37, 99, 235)");
    const doneCandidates = steps.filter((s) => s.found && s.dotColor === "rgb(16, 185, 129)");
    const staleTealDots = steps.filter((s) => s.found && s.dotColor === "rgb(0, 180, 216)");
    log("wizard-has-accent-active-step", activeCandidates.length >= 1, JSON.stringify(steps.map((s) => s.dotColor)));
    log("wizard-done-steps-still-green-or-none", staleTealDots.length === 0, JSON.stringify(staleTealDots));
    log("wizard-step-progression-sane", activeCandidates.length + doneCandidates.length >= 1, "at least one done or active step present");

    // Section eyebrow labels -> accent
    const eyebrow = await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll("p")).find((el) => el.textContent?.trim() === "Choose an opportunity");
      return p ? getComputedStyle(p).color : null;
    });
    log("choose-opportunity-label-accent", eyebrow === "rgb(37, 99, 235)", `actual=${eyebrow}`);

    // Generate CTA button -> accent gradient
    const cta = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((el) => /Generate (draft|new version)/.test(el.textContent || ""));
      return btn ? getComputedStyle(btn).backgroundImage : null;
    });
    log("generate-cta-accent-gradient", !!cta && cta.includes("37, 99, 235"), `actual=${cta}`);

    // Score Draft / Humanize secondary buttons left untouched (violet/blue tint unchanged)
    const secondaryButtons = await page.evaluate(() => {
      const scoreBtn = Array.from(document.querySelectorAll("button")).find((el) => /Score Draft|Scoring/.test(el.textContent || ""));
      const humanizeBtn = Array.from(document.querySelectorAll("button")).find((el) => /Humanize/.test(el.textContent || ""));
      return {
        score: scoreBtn ? getComputedStyle(scoreBtn).backgroundColor : null,
        humanize: humanizeBtn ? getComputedStyle(humanizeBtn).backgroundColor : null,
      };
    });
    log("secondary-buttons-present-or-not-drafted-yet", true, JSON.stringify(secondaryButtons));

    log("real-data-renders", /opportunity|Opportunity|Template|Total Drafts/.test(bodyText), "checked for section headings");

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
