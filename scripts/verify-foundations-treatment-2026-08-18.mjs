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
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function loginAsFaith(context) {
  const email = "info@faithfoundationsf.org";
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const verifyResp = await fetch(linkData.properties.action_link, { redirect: "manual" });
  const hash = (verifyResp.headers.get("location") || "").split("#")[1];
  const params = new URLSearchParams(hash);
  const { createServerClient } = await import("@supabase/ssr");
  const setCookies = [];
  const authForCookies = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
  });
  await authForCookies.auth.setSession({ access_token: params.get("access_token"), refresh_token: params.get("refresh_token") });
  await context.addCookies(setCookies.map((c) => ({ name: c.name, value: c.value, domain: "localhost", path: "/" })));
}

const label = process.argv[2] || "after";

async function main() {
  mkdirSync("smoke-test-output", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1800 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  await page.goto("http://localhost:3000/foundations", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000);

  await page.screenshot({ path: `smoke-test-output/${label.toUpperCase()}-foundations-2026-08-18.png`, fullPage: true });
  console.log(`captured ${label} screenshot`);

  // Page background (Soft Stone, site-wide)
  const bodyBg = await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor);
  console.log("body bg:", bodyBg);
  const pageBg = await page.locator(".page-bg").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  console.log("page-bg div bg (should be Soft Stone #D8D3C8):", pageBg);

  // Header — outer Bronze frame + inner Warm Ivory content
  const headerFrame = page.locator('h1:has-text("Foundation Directory")').locator("xpath=ancestor::div[2]").first();
  if (await headerFrame.count()) {
    const bg = await headerFrame.evaluate((el) => getComputedStyle(el).backgroundColor);
    const shadow = await headerFrame.evaluate((el) => getComputedStyle(el).boxShadow);
    console.log("Header outer frame bg:", bg, "| shadow:", shadow);
    const inner = headerFrame.locator("xpath=./div[1]").first();
    if (await inner.count()) {
      const innerBg = await inner.evaluate((el) => getComputedStyle(el).backgroundColor);
      console.log("Header inner content bg:", innerBg);
    }
  } else {
    console.log("Header frame: locator not found");
  }
  const h1Color = await page.locator('h1:has-text("Foundation Directory")').evaluate((el) => getComputedStyle(el).color);
  console.log("Header title color:", h1Color);

  // Stat card frame
  const statFrame = page.locator('div[style*="border-radius: 14px"]').first();
  if (await statFrame.count()) {
    const frameBg = await statFrame.evaluate((el) => getComputedStyle(el).backgroundColor);
    console.log("Stat card outer frame bg:", frameBg);
  }

  // Filter bar frame
  const filterInput = page.locator('[aria-label="Search foundations"]');
  if (await filterInput.count()) {
    const inputBg = await filterInput.evaluate((el) => getComputedStyle(el).backgroundColor);
    console.log("Filter search input bg:", inputBg);
    const frame = filterInput.locator("xpath=ancestor::div[contains(@style,'border-radius: 14px')]").first();
    if (await frame.count()) {
      const frameBg = await frame.evaluate((el) => getComputedStyle(el).backgroundColor);
      console.log("Filter bar outer frame bg:", frameBg);
    }
  }

  // First foundation card — two-layer frame + Warm Ivory content
  await page.waitForSelector("a[href^='/foundations/']", { timeout: 15000 }).catch(() => {});
  const firstCardLink = page.locator("a[href^='/foundations/']").first();
  if (await firstCardLink.count()) {
    const cardOuter = firstCardLink.locator("xpath=ancestor::div[2]").first();
    const cardInner = firstCardLink.locator("xpath=ancestor::div[1]").first();
    const outerBg = await cardOuter.evaluate((el) => getComputedStyle(el).backgroundColor);
    const outerShadow = await cardOuter.evaluate((el) => getComputedStyle(el).boxShadow);
    const innerBg = await cardInner.evaluate((el) => getComputedStyle(el).backgroundColor);
    console.log("Foundation card outer frame bg:", outerBg, "| shadow:", outerShadow);
    console.log("Foundation card inner content bg:", innerBg);

    const importBtn = firstCardLink.locator("xpath=ancestor::div[1]").locator("button", { hasText: "Import as Funder" }).first();
    if (await importBtn.count()) {
      const btnBg = await importBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
      const btnColor = await importBtn.evaluate((el) => getComputedStyle(el).color);
      console.log("Import as Funder button bg:", btnBg, "color:", btnColor);
    }

    const assetsValue = firstCardLink.locator("xpath=ancestor::div[1]//p[contains(@class,'font-bold')]").first();
    if (await assetsValue.count()) {
      const c = await assetsValue.evaluate((el) => getComputedStyle(el).color);
      console.log("Assets value (Slate Blue accent) color:", c);
    }
  } else {
    console.log("Foundation card: none found on page");
  }

  await context.close();
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
