// Verification of the gold/bronze layered-depth pass + Deep Navy third
// accent (2026-08-17). Logs in via magic link, drives /draft-generator
// against :3100, screenshots Choose a Template / Stats+Recent Drafts /
// Version History zoomed in enough to see the frame+item layering, and
// re-confirms the white-value audit stays clean.
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
      if (bl !== null && bl > 0.55) bad.push({ text: text.slice(0, 40), color, bg });
    }
    return bad.slice(0, 30);
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1600 } });
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

    let whiteOnLight = await scanWhiteOnLight(page);
    log("re-audit-step1-zero-white", whiteOnLight.length === 0, JSON.stringify(whiteOnLight));

    // Select an opportunity so Version History renders.
    await page.evaluate(() => {
      const btn = document.querySelector('main button[aria-pressed]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(500);

    // --- Choose a Template: full step screenshot + zoomed crop ---
    await clickStep(page, "Customize");
    await page.waitForTimeout(400);
    whiteOnLight = await scanWhiteOnLight(page);
    log("re-audit-step2-zero-white", whiteOnLight.length === 0, JSON.stringify(whiteOnLight));

    const templateFrame = await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll("p")).find((el) => el.textContent?.trim() === "Choose a template");
      const frame = p ? p.parentElement : null;
      const btn = document.querySelector('button[role="radio"]');
      return {
        frameBg: frame ? getComputedStyle(frame).backgroundColor : null,
        itemBg: btn ? getComputedStyle(btn).backgroundColor : null,
        itemShadow: btn ? getComputedStyle(btn).boxShadow : null,
      };
    });
    log("template-frame-gold-item-ivory", templateFrame.frameBg === "rgb(184, 138, 46)" && templateFrame.itemBg === "rgb(248, 245, 238)", JSON.stringify(templateFrame));

    await page.screenshot({ path: `${OUT_DIR}/depth-step2-template-full-2026-08-17.png`, fullPage: true });
    const templateBox = await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll("p")).find((el) => el.textContent?.trim() === "Choose a template");
      const frame = p ? p.parentElement : null;
      if (!frame) return null;
      const r = frame.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    if (templateBox) {
      await page.screenshot({
        path: `${OUT_DIR}/depth-step2-template-zoom-2026-08-17.png`,
        clip: { x: Math.max(0, templateBox.x - 10), y: Math.max(0, templateBox.y - 10), width: templateBox.width + 20, height: Math.min(templateBox.height + 20, 900) },
      });
    }

    // --- Recent Drafts + Version History: navigate to bottom, zoomed crop ---
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
    whiteOnLight = await scanWhiteOnLight(page);
    log("re-audit-bottom-section-zero-white", whiteOnLight.length === 0, JSON.stringify(whiteOnLight));

    const recentDraftsFrame = await page.evaluate(() => {
      const header = Array.from(document.querySelectorAll("span")).find((el) => el.textContent?.trim() === "Opportunity" && getComputedStyle(el.closest("div")).backgroundColor !== "rgba(0, 0, 0, 0)");
      const headerRow = header ? header.closest('div[role="row"]') : null;
      const outerFrame = headerRow ? headerRow.parentElement.parentElement : null;
      return {
        outerFrameBg: outerFrame ? getComputedStyle(outerFrame).backgroundColor : null,
        headerRowBg: headerRow ? getComputedStyle(headerRow).backgroundColor : null,
      };
    });
    log("recent-drafts-gold-frame-navy-header", recentDraftsFrame.outerFrameBg === "rgb(184, 138, 46)" && recentDraftsFrame.headerRowBg === "rgb(16, 27, 45)", JSON.stringify(recentDraftsFrame));

    const versionHistoryFrame = await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll("p")).find((el) => el.textContent?.trim() === "Version history");
      const frame = p ? p.parentElement : null;
      const li = document.querySelector("ul li");
      return {
        frameBg: frame ? getComputedStyle(frame).backgroundColor : null,
        frameBorderLeft: frame ? getComputedStyle(frame).borderLeftColor : null,
        itemBg: li ? getComputedStyle(li).backgroundColor : null,
        itemShadow: li ? getComputedStyle(li).boxShadow : null,
      };
    });
    log("version-history-bronze-frame-navy-border-ivory-item", versionHistoryFrame.frameBg === "rgb(164, 113, 44)" && versionHistoryFrame.frameBorderLeft === "rgb(16, 27, 45)" && versionHistoryFrame.itemBg === "rgb(248, 245, 238)", JSON.stringify(versionHistoryFrame));

    await page.screenshot({ path: `${OUT_DIR}/depth-recent-drafts-version-history-full-2026-08-17.png`, fullPage: true });

    const vhBox = await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll("p")).find((el) => el.textContent?.trim() === "Version history");
      const frame = p ? p.parentElement : null;
      if (!frame) return null;
      const r = frame.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    if (vhBox) {
      await page.screenshot({
        path: `${OUT_DIR}/depth-version-history-zoom-2026-08-17.png`,
        clip: { x: Math.max(0, vhBox.x - 10), y: Math.max(0, vhBox.y - 10), width: vhBox.width + 20, height: Math.min(vhBox.height + 20, 900) },
      });
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
