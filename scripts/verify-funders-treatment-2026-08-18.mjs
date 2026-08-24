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
  await page.goto("http://localhost:3000/funders", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000);

  await page.screenshot({ path: `smoke-test-output/${label.toUpperCase()}-funders-2026-08-18.png`, fullPage: true });
  console.log(`captured ${label} screenshot`);

  const bodyBg = await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor);
  console.log("body bg:", bodyBg);
  const pageBg = await page.locator(".page-bg").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  console.log("page-bg div bg (should be Soft Stone #D8D3C8):", pageBg);

  // Header title + left-border accent bar (Bronze)
  const h1 = page.locator('h1:has-text("Funders")').first();
  if (await h1.count()) {
    const h1Color = await h1.evaluate((el) => getComputedStyle(el).color);
    console.log("Header title color:", h1Color);
    const barParent = h1.locator("xpath=ancestor::div[1]").first();
    const borderLeft = await barParent.evaluate((el) => getComputedStyle(el).borderLeftColor);
    console.log("Header left-border accent (should be Bronze #A4712C):", borderLeft);
  } else {
    console.log("Header h1: not found");
  }

  // New funder button (top-right CTA)
  const newFunderBtn = page.locator('a:has-text("New funder")').first();
  if (await newFunderBtn.count()) {
    const btnBg = await newFunderBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
    const btnColor = await newFunderBtn.evaluate((el) => getComputedStyle(el).color);
    console.log("New funder button bg (should be Bronze):", btnBg, "| text color:", btnColor);
  }

  // Search input frame (translucent navy field, per FunderCardGrid)
  const searchInput = page.locator('[aria-label="Search funders"]');
  if (await searchInput.count()) {
    const inputBg = await searchInput.evaluate((el) => getComputedStyle(el).backgroundColor);
    const inputBorder = await searchInput.evaluate((el) => getComputedStyle(el).borderColor);
    console.log("Search input bg:", inputBg, "| border:", inputBorder);
  } else {
    console.log("Search input: not found");
  }

  // First funder card — two-layer frame + Warm Ivory content
  await page.waitForSelector('div[role="button"]', { timeout: 15000 }).catch(() => {});
  const firstCard = page.locator('div[role="button"]').first();
  if (await firstCard.count()) {
    const outerBg = await firstCard.evaluate((el) => getComputedStyle(el).backgroundColor);
    const outerShadow = await firstCard.evaluate((el) => getComputedStyle(el).boxShadow);
    console.log("Funder card outer frame bg:", outerBg, "| shadow:", outerShadow);
    const inner = firstCard.locator("xpath=./div[1]").first();
    if (await inner.count()) {
      const innerBg = await inner.evaluate((el) => getComputedStyle(el).backgroundColor);
      console.log("Funder card inner content bg (should be Warm Ivory #F8F5EE):", innerBg);
    }
    const title = firstCard.locator("h3").first();
    if (await title.count()) {
      const titleColor = await title.evaluate((el) => getComputedStyle(el).color);
      console.log("Funder card title color:", titleColor);
    }
  } else {
    console.log("Funder card: none found on page (may be empty state)");
  }

  // Functionality: search box filters, category select exists, card is clickable link
  const cardsBefore = await page.locator('div[role="button"]').count();
  if (await searchInput.count()) {
    await searchInput.fill("zzz_no_match_zzz");
    await page.waitForTimeout(600);
    const cardsAfterFilter = await page.locator('div[role="button"]').count();
    console.log(`Search filter functional check: ${cardsBefore} cards -> ${cardsAfterFilter} cards after nonsense query`);
    await searchInput.fill("");
    await page.waitForTimeout(600);
  }

  await context.close();
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
