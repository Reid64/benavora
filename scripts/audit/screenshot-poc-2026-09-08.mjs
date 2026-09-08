import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";
import ws from "ws";

const FAITH_EMAIL = "info@faithfoundationsf.org";
const PROD_URL = "https://www.benavora.com";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

async function mintCookies() {
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: ws } });
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: FAITH_EMAIL });
  if (linkError || !linkData) throw new Error(`generateLink failed: ${linkError?.message}`);
  const verifyResp = await fetch(linkData.properties.action_link, { redirect: "manual" });
  const location = verifyResp.headers.get("location") || "";
  const hash = location.split("#")[1];
  if (!hash) throw new Error(`No hash in redirect location: ${location}`);
  const params = new URLSearchParams(hash);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (!access_token || !refresh_token) throw new Error("No tokens in redirect hash");

  const setCookies = [];
  const authForCookies = createServerClient(url, anonKey, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
    realtime: { transport: ws },
  });
  await authForCookies.auth.setSession({ access_token, refresh_token });
  if (setCookies.length === 0) throw new Error("setSession produced zero cookies");

  return setCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: "www.benavora.com",
    path: "/",
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  }));
}

async function main() {
  const cookies = await mintCookies();
  console.log("Minted", cookies.length, "cookies for", FAITH_EMAIL, "at", new Date().toISOString());

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await context.addCookies(cookies);
  const page = await context.newPage();

  // Draft Generator opportunity selector
  await page.goto(`${PROD_URL}/draft-generator`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  console.log("draft-generator URL after load:", page.url());
  await page.screenshot({ path: "scripts/audit/screenshots-2026-09-08/draft-generator-selector.png", fullPage: true });

  // Try searching for one of the new opportunity names to confirm it's selectable
  const searchBox = page.locator('input[type="search"], input[placeholder*="Search" i]').first();
  if (await searchBox.count() > 0) {
    await searchBox.fill("Reentry Housing Assistance");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "scripts/audit/screenshots-2026-09-08/draft-generator-search-reentry.png", fullPage: true });
  } else {
    console.log("No search box found on draft-generator page");
  }

  // AutoApply queue
  await page.goto(`${PROD_URL}/autoapply/queue`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  console.log("autoapply/queue URL after load:", page.url());
  await page.screenshot({ path: "scripts/audit/screenshots-2026-09-08/autoapply-queue.png", fullPage: true });

  await browser.close();
  console.log("Done at", new Date().toISOString());
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
