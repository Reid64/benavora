// Live verification of the opportunities page color pass (2026-08-20):
// slate-blue action buttons, olive "Add Opportunity", and varied stat-number
// colors. Logs in as a real user via magic link (no password), loads the
// real /opportunities page, and reads getComputedStyle() on every recolored
// element — source reading alone doesn't prove globals.css isn't silently
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
const OUT_DIR = "test-evidence/remediation/ui-opportunities";
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

const SLATE_BLUE = "rgb(79, 109, 143)";
const OLIVE = "rgb(92, 105, 53)";
const WHITE = "rgb(255, 255, 255)";
const NAVY = "rgb(16, 27, 45)";
const TEAL = "rgb(46, 107, 102)";
const PLUM = "rgb(122, 89, 128)";
const BRONZE = "rgb(164, 113, 44)";

async function checkEl(locator, label, expectedBg, expectedColor) {
  const exists = (await locator.count()) > 0;
  if (!exists) {
    log(`${label}-exists`, false, "not found");
    return;
  }
  const computed = await locator.first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { backgroundColor: cs.backgroundColor, color: cs.color, tag: el.tagName };
  });
  if (expectedBg !== null) {
    log(`${label}-background`, computed.backgroundColor === expectedBg, `<${computed.tag}> background-color: ${computed.backgroundColor} (expected ${expectedBg})`);
  }
  if (expectedColor !== null) {
    log(`${label}-color`, computed.color === expectedColor, `<${computed.tag}> color: ${computed.color} (expected ${expectedColor})`);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1400 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`${BASE_URL}/opportunities`, { waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("h1:has-text('Opportunities')", { timeout: 20000 });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: `${OUT_DIR}/opportunities-page-top.png`, fullPage: false });

  // Run Land Bank Discovery (header) — the "Run Discovery" button, primary action.
  const runDiscovery = page.locator("button", { hasText: /Run Land Bank Discovery|Discovering/ }).first();
  await checkEl(runDiscovery, "run-discovery-button", SLATE_BLUE, WHITE);

  // Add Opportunity
  const addOpp = page.locator("a", { hasText: "Add Opportunity" }).first();
  await checkEl(addOpp, "add-opportunity-button", OLIVE, WHITE);

  // Filter chips (active state) — generic bronze/gold button, now slate blue.
  const activeChip = page.locator("button.__nonexistent__"); // placeholder, replaced below
  const chipButtons = page.locator("button");
  // Find the chip that's currently active by checking for the slate-blue bg among small pill buttons.
  const allButtons = await page.locator("button").all();
  let chipChecked = false;
  for (const btn of allButtons) {
    const txt = (await btn.textContent())?.trim();
    if (txt === "All") {
      const cs = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
      log("filter-chip-active-background", cs === SLATE_BLUE, `'All' chip background-color: ${cs} (expected ${SLATE_BLUE})`);
      chipChecked = true;
      break;
    }
  }
  if (!chipChecked) log("filter-chip-active-background", false, "'All' filter chip not found");

  // Apply Now (per-opportunity-card link) — generic bronze/gold button.
  const applyNow = page.locator("a", { hasText: "Apply Now" }).first();
  const applyNowCount = await page.locator("a", { hasText: "Apply Now" }).count();
  log("apply-now-count", true, `found ${applyNowCount} 'Apply Now' links`);
  if (applyNowCount > 0) {
    await checkEl(applyNow, "apply-now-button", SLATE_BLUE, WHITE);
  }

  // Stat boxes — 4 numbers, each a different assigned hex, in order.
  const statCards = page.locator("div", { hasText: /Open Opportunities/ });
  await page.waitForTimeout(300);
  const statInfo = await page.evaluate(() => {
    const labels = ["Open Opportunities", "High Probability", "Closing This Week", "Total Potential"];
    return labels.map((partial) => {
      const labelEl = Array.from(document.querySelectorAll("div")).find(
        (d) => d.textContent?.trim().toUpperCase().startsWith(partial.toUpperCase()) && d.children.length === 0,
      );
      if (!labelEl) return { label: partial, found: false };
      const valueEl = labelEl.previousElementSibling;
      return {
        label: partial,
        found: true,
        value: valueEl ? valueEl.textContent.trim() : null,
        color: valueEl ? getComputedStyle(valueEl).color : null,
      };
    });
  });
  const expectedStatColors = [NAVY, TEAL, PLUM, SLATE_BLUE];
  statInfo.forEach((s, i) => {
    log(
      `stat-box[${s.label}]-color`,
      s.found && s.color === expectedStatColors[i],
      `value="${s.value}" color=${s.color} (expected ${expectedStatColors[i]})`,
    );
  });

  // Scroll to stat boxes and screenshot.
  const openOppLabel = page.locator("text=Open Opportunities").first();
  if ((await openOppLabel.count()) > 0) {
    await openOppLabel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT_DIR}/opportunities-stat-boxes.png`, fullPage: false });
  }

  // Land Bank spotlight section + its "Discover More" button (also generic slate blue).
  const discoverMore = page.locator("button", { hasText: /Discover More Land Bank Opportunities|Discovering/ }).first();
  const discoverMoreCount = await discoverMore.count();
  if (discoverMoreCount > 0) {
    await discoverMore.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT_DIR}/opportunities-landbank-spotlight.png`, fullPage: false });
    await checkEl(discoverMore, "discover-more-landbank-button", SLATE_BLUE, WHITE);
  } else {
    log("discover-more-landbank-button-exists", false, "not found (org may not be flagged housing-focused, or already discovered)");
  }

  // Page title must remain bronze — it's the frame accent, not a button.
  const title = page.locator("h1", { hasText: "Opportunities" }).first();
  const titleColor = await title.evaluate((el) => getComputedStyle(el).color);
  log("page-title-accent-unchanged", titleColor === BRONZE, `title color: ${titleColor} (expected bronze ${BRONZE} — frame accent, not a button, out of scope)`);

  await browser.close();

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
