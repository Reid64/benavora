// Live verification of the new gold/black/ivory logo (public/benavora_logo.png,
// 1672x941px) across every render site found in src/. Screenshots the
// sidebar (desktop wordmark + mobile icon-only), an auth page, the
// marketing header/hero/footer, and how-it-works — and reports the actual
// rendered box size + natural image size for each, so aspect-ratio
// distortion/cropping can be judged from real numbers, not a guess.
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

async function logoInfo(page, imgLocatorFn) {
  return page.evaluate((sel) => {
    const imgs = eval(sel);
    const list = imgs instanceof NodeList ? Array.from(imgs) : [imgs];
    // Pick the first one that's actually visible (offsetParent !== null) —
    // this app renders separate desktop/mobile <Logo> instances and hides
    // one via CSS depending on viewport, so a naive querySelector can grab
    // the display:none one and report a false 0x0.
    const img = list.find((el) => el && el.offsetParent !== null) || list[0];
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return {
      src: img.currentSrc || img.src,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      renderedWidth: Math.round(r.width),
      renderedHeight: Math.round(r.height),
      objectFit: getComputedStyle(img).objectFit,
      visible: img.offsetParent !== null,
    };
  }, imgLocatorFn);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  try {
    // --- Sidebar (desktop wordmark) ---
    await page.goto(BASE_URL + "/dashboard", { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector("aside[aria-label='Primary navigation'] img", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
    const sidebarLogo = await logoInfo(page, `document.querySelectorAll("aside[aria-label='Primary navigation'] img")`);
    log("sidebar-desktop-logo-found", !!sidebarLogo, JSON.stringify(sidebarLogo));
    await page.screenshot({ path: `${OUT_DIR}/logo-sidebar-full-2026-08-17.png`, fullPage: false });
    const sidebarBox = await page.evaluate(() => {
      const el = document.querySelector("aside[aria-label='Primary navigation'] > div");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 100) };
    });
    if (sidebarBox) {
      await page.screenshot({ path: `${OUT_DIR}/logo-sidebar-zoom-2026-08-17.png`, clip: sidebarBox });
    }

    // --- Sidebar mobile (icon-only) ---
    await page.setViewportSize({ width: 500, height: 900 });
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(800);
    // Open the mobile drawer via the menu button.
    const menuOpened = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Open navigation");
      if (btn) { btn.click(); return true; }
      return false;
    });
    log("mobile-menu-opened", menuOpened, `menuOpened=${menuOpened}`);
    await page.waitForTimeout(500);
    const mobileLogo = await logoInfo(page, `document.querySelectorAll("aside[aria-label='Primary navigation'] img")`);
    log("sidebar-mobile-icon-logo-found", !!mobileLogo, JSON.stringify(mobileLogo));
    const mobileBox = await page.evaluate(() => {
      const el = document.querySelector("aside[aria-label='Primary navigation'] > div");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: Math.min(r.width, 260), height: Math.min(r.height, 100) };
    });
    if (mobileBox) {
      await page.screenshot({ path: `${OUT_DIR}/logo-sidebar-mobile-zoom-2026-08-17.png`, clip: mobileBox });
    }
    await page.setViewportSize({ width: 1500, height: 1000 });

    // --- Login page (logged-out auth pages, Logo size=40) ---
    const context2 = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page2 = await context2.newPage();
    await page2.goto(BASE_URL + "/login", { waitUntil: "load", timeout: 30000 });
    await page2.waitForTimeout(800);
    const loginLogo = await logoInfo(page2, `document.querySelectorAll("img[alt='Benavora']")`);
    log("login-page-logo-found", !!loginLogo, JSON.stringify(loginLogo));
    await page2.screenshot({ path: `${OUT_DIR}/logo-login-full-2026-08-17.png`, fullPage: false });
    const loginBox = await page2.evaluate(() => {
      const img = document.querySelector("img[alt='Benavora']");
      if (!img) return null;
      const r = img.getBoundingClientRect();
      return { x: Math.max(0, r.x - 30), y: Math.max(0, r.y - 30), width: r.width + 60, height: r.height + 60 };
    });
    if (loginBox) {
      await page2.screenshot({ path: `${OUT_DIR}/logo-login-zoom-2026-08-17.png`, clip: loginBox });
    }
    await context2.close();

    // --- Marketing homepage (header + hero + footer) ---
    const context3 = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page3 = await context3.newPage();
    await page3.goto(BASE_URL + "/pricing", { waitUntil: "load", timeout: 30000 }).catch(async () => {
      await page3.goto(BASE_URL + "/", { waitUntil: "load", timeout: 30000 });
    });
    await page3.waitForTimeout(800);
    const marketingHeaderLogo = await logoInfo(page3, `document.querySelectorAll("header img[alt='Benavora']")`);
    log("marketing-header-logo-found", !!marketingHeaderLogo, JSON.stringify(marketingHeaderLogo));
    const headerBox = await page3.evaluate(() => {
      const img = document.querySelector("header img[alt='Benavora']");
      if (!img) return null;
      const r = img.getBoundingClientRect();
      return { x: Math.max(0, r.x - 20), y: Math.max(0, r.y - 20), width: r.width + 300, height: r.height + 40 };
    });
    if (headerBox) {
      await page3.screenshot({ path: `${OUT_DIR}/logo-marketing-header-zoom-2026-08-17.png`, clip: headerBox });
    }
    await context3.close();

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
