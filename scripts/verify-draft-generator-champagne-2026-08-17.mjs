// Verification of the champagne rebalance + free wizard navigation +
// template/review color integration + layout density fix + opportunity
// search (2026-08-17). Logs in via magic link (no password), drives the
// real /draft-generator page against the dev server on :3100, screenshots
// all 4 steps (reached via direct rail clicks — free navigation), and
// asserts computed styles for the six requested fixes.
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
    // Free navigation means the wizard may restore onto any step — force
    // step 1 explicitly before testing step-1-specific UI (the search box).
    await clickStep(page, "Select Opportunity");

    // --- Item 1: champagne background + no white-on-light text ---
    const bg = await page.evaluate(() => {
      const outer = document.querySelector("main > div");
      return outer ? getComputedStyle(outer).backgroundColor : null;
    });
    log("champagne-page-bg", bg === "rgb(232, 215, 168)", `actual=${bg}`);

    const shellMainBg = await page.evaluate(() => {
      const main = document.querySelector("main");
      return main ? getComputedStyle(main).backgroundColor : null;
    });
    log("shell-main-champagne", shellMainBg === "rgb(232, 215, 168)", `actual=${shellMainBg}`);

    const h1 = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("h1")).find((h) => h.textContent?.trim() === "Draft Generator");
      return el ? getComputedStyle(el).color : null;
    });
    log("h1-navy-not-white", h1 === "rgb(16, 27, 45)", `actual=${h1}`);
    log("h1-not-white", h1 !== "rgb(255, 255, 255)" && h1 !== "rgb(248, 245, 238)", `actual=${h1}`);

    // Scan every element with visible text for a literal white-on-white /
    // near-white-on-light violation: text color close to white while the
    // element's own background (or its nearest ancestor with a set bg) is
    // also light.
    const whiteOnLight = await page.evaluate(() => {
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
        // Walk up to the nearest ancestor with a substantially opaque
        // background — skip faint decorative overlay tints (e.g. the
        // rail's rgba(255,255,255,0.04) row highlight over navy), since
        // those don't actually make the surface light.
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
        if (el.children.length > 0) continue; // leaf text nodes only
        const text = el.textContent?.trim();
        if (!text) continue;
        const color = getComputedStyle(el).color;
        const cl = luminance(color);
        if (cl === null || cl < 0.85) continue; // not near-white text
        const bg = bgOf(el);
        const bl = luminance(bg);
        if (bl !== null && bl > 0.55) {
          bad.push({ text: text.slice(0, 40), color, bg });
        }
      }
      return bad.slice(0, 20);
    });
    log("no-white-on-light-anywhere", whiteOnLight.length === 0, JSON.stringify(whiteOnLight));

    await page.screenshot({ path: `${OUT_DIR}/dg-champagne-step1-2026-08-17.png`, fullPage: true });

    // --- Item 2 (part 1): free jump to step 4 before anything is selected —
    // proves rail navigation is truly unconditional, and that step 4 always
    // renders something real (empty-state fallback), never a blank void.
    await clickStep(page, "Review & Export");
    const onStep4Early = await page.evaluate(() => {
      const span = Array.from(document.querySelectorAll("span")).find((el) => el.textContent?.trim() === "Review & Export");
      const btn = span ? span.closest("button") : null;
      return btn ? btn.getAttribute("aria-current") === "step" : false;
    });
    log("rail-jump-to-step4-from-step1-works", onStep4Early, `onStep4Early=${onStep4Early}`);
    const step4Fallback = await page.evaluate(() => document.body.innerText.includes("No draft yet for this opportunity"));
    const step4HasReview = await page.evaluate(() => document.body.innerText.toLowerCase().includes("review & edit"));
    log("step4-renders-something-not-blank", step4Fallback || step4HasReview, `fallback=${step4Fallback} review=${step4HasReview}`);
    await page.screenshot({ path: `${OUT_DIR}/dg-champagne-step4-early-2026-08-17.png`, fullPage: true });
    await clickStep(page, "Select Opportunity");

    // --- Item 6: opportunity search actually filters ---
    const searchInput = page.locator('input[aria-label="Search opportunities"]');
    const beforeCount = await page.evaluate(() =>
      document.querySelectorAll('main button[aria-pressed]').length,
    );
    await searchInput.fill("zzz_no_such_opportunity_zzz");
    await page.waitForTimeout(300);
    const afterNoMatch = await page.evaluate(() => document.body.innerText.includes("No opportunities match"));
    log("search-filters-to-zero", afterNoMatch, `afterNoMatch=${afterNoMatch}, beforeCount=${beforeCount}`);
    await searchInput.fill("");
    await page.waitForTimeout(200);
    const firstOppName = await page.evaluate(() => {
      const btn = document.querySelector('main button[aria-pressed]');
      const span = btn ? btn.querySelector("span") : null;
      return span ? span.textContent : null;
    });
    if (firstOppName) {
      const partial = firstOppName.slice(0, 6);
      await searchInput.fill(partial);
      await page.waitForTimeout(300);
      const filteredCount = await page.evaluate(() => document.querySelectorAll('main button[aria-pressed]').length);
      log("search-filters-real-results", filteredCount > 0 && filteredCount <= beforeCount, `query=${partial} filteredCount=${filteredCount} beforeCount=${beforeCount}`);
    } else {
      log("search-filters-real-results", false, "no opportunity rows found to test with");
    }
    await searchInput.fill("");
    await page.waitForTimeout(300);

    // Select the first opportunity so later steps have real state.
    await page.evaluate(() => {
      const btn = document.querySelector('main button[aria-pressed]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(400);

    // --- Item 5: no large empty void on step 1 (tips panel present) ---
    const tipsOnStep1 = await page.evaluate(() => document.body.innerText.toLowerCase().includes("intelligence tips"));
    log("step1-has-tips-panel-no-void", tipsOnStep1, `tipsOnStep1=${tipsOnStep1}`);

    // --- Item 2: all 4 rail steps directly clickable regardless of state ---
    // Jump to step 2 directly from step 1 (skipping the linear order).
    await clickStep(page, "Customize");
    const onStep2Now = await page.evaluate(() => {
      const span = Array.from(document.querySelectorAll("span")).find((el) => el.textContent?.trim() === "Customize");
      const btn = span ? span.closest("button") : null;
      return btn ? btn.getAttribute("aria-current") === "step" : false;
    });
    log("rail-jump-to-step2-from-step4-works", onStep2Now, `onStep2Now=${onStep2Now}`);
    log("step2-has-tips-panel-no-void", await page.evaluate(() => document.body.innerText.toLowerCase().includes("intelligence tips")), "checked");
    await page.screenshot({ path: `${OUT_DIR}/dg-champagne-step2-2026-08-17.png`, fullPage: true });

    // --- Item 3: template cards champagne-styled (check an UNselected card
    // — index 0 may already be selected via restored state). ---
    const templateCardStyle = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button[role="radio"]')).find((b) => b.getAttribute("aria-checked") === "false");
      return btn ? { bg: getComputedStyle(btn).backgroundColor, border: getComputedStyle(btn).borderColor, textColor: (() => { const s = btn.querySelector("span"); return s ? getComputedStyle(s).color : null; })() } : null;
    });
    log("template-card-champagne-bg", templateCardStyle?.bg === "rgb(232, 215, 168)", JSON.stringify(templateCardStyle));

    // Select an unselected template card, then check its now-selected style.
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button[role="radio"]')).find((b) => b.getAttribute("aria-checked") === "false");
      if (btn) btn.click();
    });
    await page.waitForTimeout(300);
    const selectedTemplateStyle = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button[role="radio"]')).find((b) => b.getAttribute("aria-checked") === "true");
      return btn ? { bg: getComputedStyle(btn).backgroundColor, borderColor: getComputedStyle(btn).borderColor } : null;
    });
    log("template-selected-clearly-defined-border", !!selectedTemplateStyle && selectedTemplateStyle.borderColor.includes("201, 163, 78"), JSON.stringify(selectedTemplateStyle));

    // --- Step 3: Generate — jump directly via rail, verify tips + no void ---
    await clickStep(page, "Generate");
    log("step3-has-tips-panel-no-void", await page.evaluate(() => document.body.innerText.toLowerCase().includes("intelligence tips")), "checked");
    await page.screenshot({ path: `${OUT_DIR}/dg-champagne-step3-2026-08-17.png`, fullPage: true });

    // --- Item 2: Back/Next always solid gold, never disabled-looking ---
    const backBtn = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim().includes("Back"));
      return btn ? { bg: getComputedStyle(btn).backgroundColor, disabled: btn.disabled, opacity: getComputedStyle(btn).opacity } : null;
    });
    log("back-button-solid-gold-not-disabled", backBtn?.bg === "rgb(201, 163, 78)" && backBtn?.disabled === false, JSON.stringify(backBtn));
    const nextBtn = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Next"));
      return btn ? { bg: getComputedStyle(btn).backgroundColor, disabled: btn.disabled } : null;
    });
    log("next-button-solid-gold-not-disabled", nextBtn?.bg === "rgb(201, 163, 78)" && nextBtn?.disabled === false, JSON.stringify(nextBtn));

    // --- Item 4: Review & Export with real content, via an existing draft ---
    await clickStep(page, "Select Opportunity");
    await page.waitForTimeout(300);
    // Back out to the page-level Recent Drafts table (always rendered once
    // opportunities load) and open a real existing draft to see step 4 with
    // real content, not just the empty-state fallback.
    const openClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Open");
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    log("recent-drafts-open-link-clicked", openClicked, `openClicked=${openClicked}`);
    await page.waitForTimeout(800);
    const reviewHeaderColor = await page.evaluate(() => {
      const h3 = Array.from(document.querySelectorAll("h3")).find((el) => el.textContent?.trim() === "Sources used");
      return h3 ? getComputedStyle(h3).color : null;
    });
    log("review-sources-header-navy-not-white", reviewHeaderColor === "rgb(16, 27, 45)", `actual=${reviewHeaderColor}`);
    const reviewCardBorderTop = await page.evaluate(() => {
      const span = Array.from(document.querySelectorAll("span")).find((el) => el.textContent?.trim() === "Review & edit");
      let node = span ? span.parentElement : null;
      while (node) {
        const w = parseFloat(getComputedStyle(node).borderTopWidth);
        if (w >= 3) return getComputedStyle(node).borderTopColor;
        node = node.parentElement;
      }
      return null;
    });
    log("review-main-card-navy-accent", reviewCardBorderTop === "rgb(16, 27, 45)", `actual=${reviewCardBorderTop}`);
    await page.screenshot({ path: `${OUT_DIR}/dg-champagne-step4-review-2026-08-17.png`, fullPage: true });

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
