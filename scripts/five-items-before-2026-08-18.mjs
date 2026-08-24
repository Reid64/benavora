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

const TAG = process.argv[2] || "before";

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  mkdirSync("smoke-test-output", { recursive: true });

  // ITEM 1: Settings > Integrations > State Grant Portals > Configure
  await page.goto("http://localhost:3000/settings/integrations", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const configureLink = page.locator('a:has-text("Configure")').first();
  const configureHref = await configureLink.getAttribute("href").catch(() => null);
  console.log(`ITEM1 Configure href: ${configureHref}`);
  const [resp1] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(configureHref || "/settings/state-portals"), { timeout: 8000 }).catch(() => null),
    configureLink.click(),
  ]);
  await page.waitForTimeout(1500);
  console.log(`ITEM1 nav response status: ${resp1 ? resp1.status() : "no response captured"}`);
  console.log(`ITEM1 page title/h1 text: ${await page.locator("h1").first().textContent().catch(() => "N/A")}`);
  console.log(`ITEM1 body text sample: ${(await page.locator("body").innerText()).slice(0, 300)}`);
  await page.screenshot({ path: `smoke-test-output/ITEM1-state-portals-${TAG}-2026-08-18.png`, fullPage: true });

  // ITEM 2: Grants.gov Run Now -> check for a results link after completion
  await page.goto("http://localhost:3000/settings/integrations", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const grantsGovCard = page.locator("text=Grants.gov").locator("xpath=ancestor::div[contains(@class,'flex-col')][1]").first();
  const runNowBtn = page.locator('button:has-text("Run Now")').first();
  await runNowBtn.click().catch(() => {});
  await page.waitForTimeout(4000);
  const item2Html = await page.locator("body").innerHTML();
  const hasViewLink = /View Opportunities|opportunit/i.test(item2Html);
  console.log(`ITEM2 has a "view results" link after Run Now: ${hasViewLink}`);
  await page.screenshot({ path: `smoke-test-output/ITEM2-grantsgov-runnow-${TAG}-2026-08-18.png`, fullPage: true });

  // ITEM 3: Scraping Targets - add URL and run, check for results link
  await page.goto("http://localhost:3000/settings/scraping", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `smoke-test-output/ITEM3-scraping-targets-${TAG}-2026-08-18.png`, fullPage: true });
  const targetRunBtn = page.locator('button:has-text("Run Now")').first();
  const hasRunBtn = await targetRunBtn.count();
  console.log(`ITEM3 existing targets with a Run Now button: ${hasRunBtn}`);
  if (hasRunBtn > 0) {
    await targetRunBtn.click().catch(() => {});
    await page.waitForTimeout(5000);
    const item3Html = await page.locator("body").innerHTML();
    console.log(`ITEM3 has a "view results" link after Run Now: ${/View.*opportunit|Opportunities/i.test(item3Html)}`);
    await page.screenshot({ path: `smoke-test-output/ITEM3-scraping-after-run-${TAG}-2026-08-18.png`, fullPage: true });
  }

  // ITEM 4: Branding logo upload -> header
  await page.goto("http://localhost:3000/settings/branding", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `smoke-test-output/ITEM4-branding-${TAG}-2026-08-18.png` });
  const headerLogoSrc = await page.locator("img[alt='Benavora']").first().getAttribute("src").catch(() => null);
  console.log(`ITEM4 sidebar Logo img src (dashboard chrome): ${headerLogoSrc}`);

  // ITEM 5: Settings > Billing -> does sub-nav disappear?
  await page.goto("http://localhost:3000/settings", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const billingLink = page.locator('nav[aria-label="Settings navigation"] a:has-text("Billing")').first();
  const billingHref = await billingLink.getAttribute("href").catch(() => "NOT FOUND");
  console.log(`ITEM5 Billing nav href: ${billingHref}`);
  await billingLink.click().catch(() => {});
  await page.waitForTimeout(2000);
  const settingsNavStillPresent = await page.locator('nav[aria-label="Settings navigation"]').count();
  console.log(`ITEM5 URL after click: ${page.url()}`);
  console.log(`ITEM5 settings sub-nav still present after clicking Billing: ${settingsNavStillPresent > 0}`);
  await page.screenshot({ path: `smoke-test-output/ITEM5-billing-nav-${TAG}-2026-08-18.png`, fullPage: true });

  await browser.close();
})();
