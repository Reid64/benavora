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
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
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
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 700 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  mkdirSync("smoke-test-output", { recursive: true });

  await page.goto("http://localhost:3000/settings/scraping", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/agents/custom-scrape") && r.request().method() === "POST", { timeout: 60000 }),
    page.locator('button:has-text("Run Now")').first().click(),
  ]);
  console.log("custom-scrape POST status:", resp.status());
  const body = await resp.json().catch(() => null);
  console.log("response body:", JSON.stringify(body));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "smoke-test-output/ITEM3-FINAL-scraping-2026-08-18.png" });

  const link = page.locator('a:has-text("opportunit")');
  console.log("results link count:", await link.count());
  if (await link.count() > 0) {
    console.log("link text:", await link.first().textContent());
    console.log("link href:", await link.first().getAttribute("href"));
  }
  await browser.close();
})();
