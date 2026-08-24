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

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  mkdirSync("smoke-test-output", { recursive: true });

  await page.goto("http://localhost:3000/settings/branding", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles("public/benavora_logo.png");
  await page.waitForTimeout(1000);
  const uploadBtn = page.locator('button:has-text("Upload logo")');
  await uploadBtn.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "smoke-test-output/ITEM4-branding-after-upload-2026-08-18.png" });

  // Now check sidebar logo across a nav to a fresh page load
  await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const headerLogoSrc = await page.locator("img[alt='Benavora']").first().getAttribute("src").catch(() => null);
  console.log(`Sidebar logo src after fresh upload + navigation: ${headerLogoSrc}`);
  await page.screenshot({ path: "smoke-test-output/ITEM4-dashboard-after-upload-2026-08-18.png" });

  await browser.close();
})();
