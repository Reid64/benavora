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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  await page.goto("http://localhost:3000/opportunities", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000);

  await page.screenshot({ path: `smoke-test-output/${label.toUpperCase()}-opportunities-2026-08-18.png`, fullPage: true });
  console.log(`captured ${label} screenshot`);

  // Real computed-style checks, not source-reading.
  const h1 = await page.locator("h1", { hasText: "Opportunities" }).first();
  const h1Color = await h1.evaluate((el) => getComputedStyle(el).color);
  console.log("H1 color:", h1Color);

  // Active filter chip: "All" is active by default.
  const allChip = page.locator("button", { hasText: "All" }).first();
  const chipBg = await allChip.evaluate((el) => getComputedStyle(el).backgroundColor);
  const chipColor = await allChip.evaluate((el) => getComputedStyle(el).color);
  console.log("Active chip bg:", chipBg, "color:", chipColor);

  // Add Opportunity CTA button
  const addBtn = page.locator("a", { hasText: "Add Opportunity" }).first();
  const addBtnExists = await addBtn.count();
  if (addBtnExists) {
    const btnBg = await addBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
    const btnColor = await addBtn.evaluate((el) => getComputedStyle(el).color);
    console.log("Add Opportunity button bg:", btnBg, "color:", btnColor);
  } else {
    console.log("Add Opportunity button: not present (role gate or no opportunities)");
  }

  // Frame color on first opportunity card (if any)
  const cardCount = await page.locator('div[style*="border-radius: 14px"]').count();
  console.log("Card-shaped divs found:", cardCount);

  await context.close();
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
