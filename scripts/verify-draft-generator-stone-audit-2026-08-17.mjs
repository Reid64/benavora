// Verification of the Soft Stone rebalance + full white-value audit/
// elimination (2026-08-17). Logs in via magic link, drives the real
// /draft-generator page against :3100, screenshots all 4 steps, and
// scans the live DOM for any remaining white-on-light / light-on-light
// violation (the actual Step 4 re-audit, not a visual guess).
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
const BASE_URL = "http://localhost:3100";
const OUT_DIR = "smoke-test-output";
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

async function clickStep(page, label) {
  await page.evaluate((lbl) => {
    const span = Array.from(document.querySelectorAll("span")).find((el) => el.textContent?.trim() === lbl);
    const btn = span ? span.closest("button") : null;
    if (btn) btn.click();
  }, label);
  await page.waitForTimeout(500);
}

async function scanWhiteOnLight(page) {
  return page.evaluate(() => {
    function luminance(rgb) {
      const m = rgb.match(/\d+/g);
      if (!m) return null;
      const [r, g, b] = m.map(Number);
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
    function alphaOf(rgb) {
      const m = rgb.match(/[\d.]+/g);
      return m && m.length === 4 ? Number(m[3]) : 1;
    }
    function bgOf(el) {
      let node = el;
      while (node) {
        const c = getComputedStyle(node).backgroundColor;
        if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent" && alphaOf(c) >= 0.5) return c;
        node = node.parentElement;
      }
      return "rgb(255,255,255)";
    }
    const bad = [];
    const nodes = document.querySelectorAll("main *");
    for (const el of nodes) {
      if (el.children.length > 0) continue;
      const text = el.textContent?.trim();
      if (!text) continue;
      const color = getComputedStyle(el).color;
      const cl = luminance(color);
      if (cl === null || cl < 0.85) continue;
      const bg = bgOf(el);
      const bl = luminance(bg);
      if (bl !== null && bl > 0.55) {
        bad.push({ text: text.slice(0, 40), color, bg });
      }
    }
    return bad.slice(0, 30);
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  try {
    await page.goto(BASE_URL + "/draft-generator", { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => document.body.innerText.includes("Grant Draft Wizard"), { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await clickStep(page, "Select Opportunity");

    // --- Palette checks ---
    const bg = await page.evaluate(() => {
      const outer = document.querySelector("main > div");
      return outer ? getComputedStyle(outer).backgroundColor : null;
    });
    log("stone-page-bg", bg === "rgb(216, 211, 200)", `actual=${bg}`);
    const shellMainBg = await page.evaluate(() => {
      const main = document.querySelector("main");
      return main ? getComputedStyle(main).backgroundColor : null;
    });
    log("shell-main-stone", shellMainBg === "rgb(216, 211, 200)", `actual=${shellMainBg}`);
    const h1 = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("h1")).find((h) => h.textContent?.trim() === "Draft Generator");
      return el ? getComputedStyle(el).color : null;
    });
    log("h1-navy", h1 === "rgb(16, 27, 45)", `actual=${h1}`);

    // --- Full re-audit: zero white-on-light anywhere ---
    let whiteOnLight = await scanWhiteOnLight(page);
    await page.screenshot({ path: `${OUT_DIR}/dg-stone-step1-2026-08-17.png`, fullPage: true });
    log("step1-zero-white-on-light", whiteOnLight.length === 0, JSON.stringify(whiteOnLight));

    // Select the first opportunity + search test
    const searchInput = page.locator('input[aria-label="Search opportunities"]');
    await searchInput.fill("Rural");
    await page.waitForTimeout(300);
    const filteredCount = await page.evaluate(() => document.querySelectorAll('main button[aria-pressed]').length);
    log("search-filters-real-results", filteredCount > 0, `filteredCount=${filteredCount}`);
    await searchInput.fill("");
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const btn = document.querySelector('main button[aria-pressed]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(400);
    log("step1-tips-panel-no-void", await page.evaluate(() => document.body.innerText.toLowerCase().includes("intelligence tips")), "checked");

    // --- Free navigation: jump step1 -> step2 (template cards) ---
    await clickStep(page, "Customize");
    await page.waitForTimeout(300);
    whiteOnLight = await scanWhiteOnLight(page);
    await page.screenshot({ path: `${OUT_DIR}/dg-stone-step2-2026-08-17.png`, fullPage: true });
    log("step2-zero-white-on-light", whiteOnLight.length === 0, JSON.stringify(whiteOnLight));
    log("step2-tips-panel-no-void", await page.evaluate(() => document.body.innerText.toLowerCase().includes("intelligence tips")), "checked");

    const unselectedCard = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button[role="radio"]')).find((b) => b.getAttribute("aria-checked") === "false");
      return btn ? { bg: getComputedStyle(btn).backgroundColor } : null;
    });
    log("template-card-ivory-not-white", unselectedCard?.bg === "rgb(248, 245, 238)", JSON.stringify(unselectedCard));
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button[role="radio"]')).find((b) => b.getAttribute("aria-checked") === "false");
      if (btn) btn.click();
    });
    await page.waitForTimeout(300);

    // --- Step 3: Generate ---
    await clickStep(page, "Generate");
    await page.waitForTimeout(300);
    whiteOnLight = await scanWhiteOnLight(page);
    await page.screenshot({ path: `${OUT_DIR}/dg-stone-step3-2026-08-17.png`, fullPage: true });
    log("step3-zero-white-on-light", whiteOnLight.length === 0, JSON.stringify(whiteOnLight));
    log("step3-tips-panel-no-void", await page.evaluate(() => document.body.innerText.toLowerCase().includes("intelligence tips")), "checked");

    // --- Back/Next always solid Rich Gold, never disabled ---
    const backBtn = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim().includes("Back"));
      return btn ? { bg: getComputedStyle(btn).backgroundColor, disabled: btn.disabled } : null;
    });
    log("back-button-rich-gold-not-disabled", backBtn?.bg === "rgb(184, 138, 46)" && backBtn?.disabled === false, JSON.stringify(backBtn));
    const nextBtn = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Next"));
      return btn ? { bg: getComputedStyle(btn).backgroundColor, disabled: btn.disabled } : null;
    });
    log("next-button-rich-gold-not-disabled", nextBtn?.bg === "rgb(184, 138, 46)" && nextBtn?.disabled === false, JSON.stringify(nextBtn));

    // --- Free rail navigation: jump directly to step4 from step3 ---
    await clickStep(page, "Review & Export");
    await page.waitForTimeout(300);
    const onStep4 = await page.evaluate(() => {
      const span = Array.from(document.querySelectorAll("span")).find((el) => el.textContent?.trim() === "Review & Export");
      const btn = span ? span.closest("button") : null;
      return btn ? btn.getAttribute("aria-current") === "step" : false;
    });
    log("rail-free-jump-to-step4-works", onStep4, `onStep4=${onStep4}`);

    // Open a real existing draft so Review & Export shows real content.
    const openClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Open");
      if (btn) { btn.click(); return true; }
      return false;
    });
    log("recent-drafts-open-clicked", openClicked, `openClicked=${openClicked}`);
    await page.waitForTimeout(800);

    whiteOnLight = await scanWhiteOnLight(page);
    await page.screenshot({ path: `${OUT_DIR}/dg-stone-step4-2026-08-17.png`, fullPage: true });
    log("step4-zero-white-on-light", whiteOnLight.length === 0, JSON.stringify(whiteOnLight));

    const sourcesHeaderColor = await page.evaluate(() => {
      const h3 = Array.from(document.querySelectorAll("h3")).find((el) => el.textContent?.trim() === "Sources used");
      return h3 ? getComputedStyle(h3).color : null;
    });
    log("sources-header-navy", sourcesHeaderColor === "rgb(16, 27, 45)", `actual=${sourcesHeaderColor}`);

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
