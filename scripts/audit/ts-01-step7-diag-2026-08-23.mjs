import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
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
const BASE_URL = "https://www.benavora.com";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const email = "info@faithfoundationsf.org";
const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email });
const verifyResp = await fetch(linkData.properties.action_link, { redirect: "manual" });
const location = verifyResp.headers.get("location") || "";
const params = new URLSearchParams(location.split("#")[1]);
const access_token = params.get("access_token");
const refresh_token = params.get("refresh_token");
const { createServerClient } = await import("@supabase/ssr");
const setCookies = [];
const authForCookies = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (l) => setCookies.push(...l) } });
await authForCookies.auth.setSession({ access_token, refresh_token });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
await context.addCookies(setCookies.map((c) => ({ name: c.name, value: c.value, domain: "www.benavora.com", path: "/", secure: true, sameSite: "Lax" })));

for (const path of ["/autoapply/recordings", "/autoapply/analytics"]) {
  const page = await context.newPage();
  page.on("response", async (resp) => {
    if (resp.status() >= 400) {
      console.log(`[${path}] ${resp.status()} ${resp.url()}`);
    }
  });
  page.on("console", (msg) => { if (msg.type() === "error") console.log(`[${path}] console.error:`, msg.text()); });
  await page.goto(`${BASE_URL}${path}`, { timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.close();
}
await browser.close();
