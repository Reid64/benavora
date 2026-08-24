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

async function main() {
  mkdirSync("smoke-test-output", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  await page.goto("http://localhost:3000/opportunities", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000);

  // 1. Filter chip click: Federal
  await page.locator("button", { hasText: "Federal" }).first().click();
  await page.waitForTimeout(500);
  const federalActiveBg = await page.locator("button", { hasText: "Federal" }).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  console.log("Federal chip clicked, active bg:", federalActiveBg);

  // 2. Search box
  await page.locator('input[placeholder="Search opportunities, funders..."]').fill("Agriculture");
  await page.waitForTimeout(500);
  const cardTitles = await page.locator("a", { hasText: "Agriculture" }).count();
  console.log("Search 'Agriculture' result count (link matches):", cardTitles);
  await page.locator('input[placeholder="Search opportunities, funders..."]').fill("");
  await page.locator("button", { hasText: "All" }).first().click();
  await page.waitForTimeout(500);

  // 3. Sort dropdown
  await page.locator('select[aria-label="Sort opportunities"]').selectOption("deadline-asc");
  await page.waitForTimeout(500);
  const sortValue = await page.locator('select[aria-label="Sort opportunities"]').inputValue();
  console.log("Sort set to:", sortValue);

  // 4. Score Breakdown expand
  const breakdownBtn = page.locator("button", { hasText: "Score Breakdown" }).first();
  await breakdownBtn.click();
  await page.waitForTimeout(500);
  const expanded = await page.locator("text=Key Risks").count();
  console.log("Score breakdown expanded, 'Key Risks' visible:", expanded > 0);

  // 5. View link navigates
  const viewLink = page.locator("a", { hasText: "View" }).first();
  const href = await viewLink.getAttribute("href");
  console.log("View link href:", href);

  await page.screenshot({ path: "smoke-test-output/FUNCTIONALITY-opportunities-2026-08-18.png", fullPage: false });
  console.log("Functionality check complete");

  await context.close();
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
