// Live verification of the research page bronze/gold -> teal button recolor
// (2026-08-20). Logs in as a real user via magic link (no password), loads
// the real /research page, and reads getComputedStyle() on every recolored
// button — source reading alone doesn't prove globals.css isn't silently
// overriding these inline styles.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync } from "node:fs";
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
const OUT_DIR = "test-evidence/remediation/ui-research";
mkdirSync(OUT_DIR, { recursive: true });

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

const TEAL_RGB = "rgb(46, 107, 102)";
const WHITE_RGB = "rgb(255, 255, 255)";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1400 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`${BASE_URL}/research`, { waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("text=Research Command Center", { timeout: 20000 });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: `${OUT_DIR}/research-page-top.png`, fullPage: false });

  // 1. Poll Now button (Funding Source Directory)
  const pollNow = page.locator("button", { hasText: /Poll Now|Polling/ }).first();
  await pollNow.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT_DIR}/research-poll-now-and-directory.png`, fullPage: false });
  await checkButton(page, pollNow, "Poll Now");

  // 2. Search button (submit, opportunity search bar)
  const searchBtn = page.locator('button[type="submit"]', { hasText: "Search" }).first();
  await searchBtn.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT_DIR}/research-search-and-opportunities.png`, fullPage: false });
  await checkButton(page, searchBtn, "Search");

  // 3. Pull Historical Awards button
  const pullAwards = page.locator("button", { hasText: /Pull Historical Awards|Pulling/ }).first();
  await pullAwards.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT_DIR}/research-historical-awards.png`, fullPage: false });
  await checkButton(page, pullAwards, "Pull Historical Awards");

  // 4. Resources section: scroll to it, expand "Browse all", check the toggle button + at least one "Visit" link
  const browseAllBtn = page.locator("button", { hasText: /Browse all|Hide/ }).first();
  const browseAllVisible = await browseAllBtn.count();
  if (browseAllVisible > 0) {
    await browseAllBtn.scrollIntoViewIfNeeded();
    await checkButton(page, browseAllBtn, "Browse all resources");
  } else {
    log("button[Browse all resources]-exists", false, "button not found on page");
  }

  const visitLink = page.locator("a", { hasText: "Visit" }).first();
  const visitCount = await page.locator("a", { hasText: "Visit" }).count();
  log("visit-links-count", visitCount > 0, `found ${visitCount} 'Visit' resource links`);
  if (visitCount > 0) {
    await checkButton(page, visitLink, "Visit (resource link)");
  }

  // 5. Apply link (opportunity card) — exact text match only; "Apply" as a
  // substring also matches unrelated nav items like "AutoApply".
  const applyLinks = page.locator("a", { hasText: /^Apply$/ });
  const applyCount = await applyLinks.count();
  log("apply-links-count", true, `found ${applyCount} exact-'Apply' opportunity links (0 is valid if all opportunities already have applications)`);
  if (applyCount > 0) {
    await checkButton(page, applyLinks.first(), "Apply (opportunity link)");
  }

  // Non-button controls that must remain bronze (not part of this change):
  // PageHeader accent (title text/border) and the active-tab underline.
  const title = page.locator("h1", { hasText: "Research Command Center" });
  const titleColor = await title.evaluate((el) => getComputedStyle(el).color);
  log(
    "page-header-accent-unchanged",
    titleColor === "rgb(164, 113, 44)",
    `PageHeader title color: ${titleColor} (expected bronze rgb(164, 113, 44) — not a button, out of scope)`,
  );

  await browser.close();

  async function checkButton(pg, locator, label) {
    const exists = (await locator.count()) > 0;
    if (!exists) {
      log(`button[${label}]-exists`, false, "not found");
      return;
    }
    const computed = await locator.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { backgroundColor: cs.backgroundColor, color: cs.color, tag: el.tagName };
    });
    log(
      `button[${label}]-background-teal`,
      computed.backgroundColor === TEAL_RGB,
      `<${computed.tag}> background-color: ${computed.backgroundColor} (expected ${TEAL_RGB})`,
    );
    log(
      `button[${label}]-text-white`,
      computed.color === WHITE_RGB,
      `<${computed.tag}> color: ${computed.color} (expected ${WHITE_RGB})`,
    );
  }

  console.log("\n=== Console errors captured ===");
  console.log(consoleErrors.length ? consoleErrors.join("\n") : "(none)");

  console.log("\n=== Results summary ===");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.step}: ${r.detail}`);

  const failCount = results.filter((r) => !r.ok).length;
  if (failCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
