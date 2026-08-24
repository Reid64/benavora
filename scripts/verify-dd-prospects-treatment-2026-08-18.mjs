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
  await page.goto("http://localhost:3000/donor-discovery/prospects", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000);

  await page.screenshot({ path: `smoke-test-output/${label.toUpperCase()}-dd-prospects-2026-08-18.png`, fullPage: true });
  console.log(`captured ${label} screenshot`);

  // Page background (Soft Stone, site-wide — should be unchanged either way)
  const bodyBg = await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor);
  console.log("body bg:", bodyBg);

  // Filter panel — should be Warm Ivory content inside a Bronze-tinted frame after fix.
  const filterPanel = page.locator("div.rounded-xl").filter({ has: page.locator('[aria-label="Filter by request"]') }).first();
  const filterExists = await filterPanel.count();
  if (filterExists) {
    const fpBg = await filterPanel.evaluate((el) => getComputedStyle(el).backgroundColor);
    const fpBorder = await filterPanel.evaluate((el) => getComputedStyle(el).borderColor);
    const fpShadow = await filterPanel.evaluate((el) => getComputedStyle(el).boxShadow);
    console.log("Filter panel bg:", fpBg, "| border:", fpBorder, "| shadow:", fpShadow);
  } else {
    console.log("Filter panel: locator not found");
  }

  // Table container
  const tableContainer = page.locator("table").locator("xpath=ancestor::div[contains(@class,'overflow-x-auto')]").first();
  const tableExists = await tableContainer.count();
  if (tableExists) {
    const tBg = await tableContainer.evaluate((el) => getComputedStyle(el).backgroundColor);
    const tBorder = await tableContainer.evaluate((el) => getComputedStyle(el).borderColor);
    const tShadow = await tableContainer.evaluate((el) => getComputedStyle(el).boxShadow);
    console.log("Table container bg:", tBg, "| border:", tBorder, "| shadow:", tShadow);
  } else {
    console.log("Table container: not found (likely empty state)");
  }

  // Stat card frame (already-applied reference: outer frame + inner F8F5EE)
  const statFrame = page.locator('div[style*="border-radius: 14px"]').first();
  const statFrameCount = await statFrame.count();
  if (statFrameCount) {
    const frameBg = await statFrame.evaluate((el) => getComputedStyle(el).backgroundColor);
    console.log("Stat card outer frame bg:", frameBg);
    const inner = statFrame.locator('div[class*="rounded-[11px]"]').first();
    if (await inner.count()) {
      const innerBg = await inner.evaluate((el) => getComputedStyle(el).backgroundColor);
      console.log("Stat card inner content bg:", innerBg);
    }
  }

  // Discover More button
  const discoverBtn = page.locator("a", { hasText: "Discover More" }).first();
  if (await discoverBtn.count()) {
    const btnBg = await discoverBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
    const btnColor = await discoverBtn.evaluate((el) => getComputedStyle(el).color);
    console.log("Discover More button bg:", btnBg, "color:", btnColor);
  }

  await context.close();
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
