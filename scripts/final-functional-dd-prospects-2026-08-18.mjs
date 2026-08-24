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
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
async function loginAsFaith(context) {
  const email = "info@faithfoundationsf.org";
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const verifyResp = await fetch(linkData.properties.action_link, { redirect: "manual" });
  const hash = (verifyResp.headers.get("location") || "").split("#")[1];
  const params = new URLSearchParams(hash);
  const { createServerClient } = await import("@supabase/ssr");
  const setCookies = [];
  const authForCookies = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) } });
  await authForCookies.auth.setSession({ access_token: params.get("access_token"), refresh_token: params.get("refresh_token") });
  await context.addCookies(setCookies.map((c) => ({ name: c.name, value: c.value, domain: "localhost", path: "/" })));
}
async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("http://localhost:3000/donor-discovery/prospects", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(6000);

  // sort by clicking Company header
  await page.locator("th", { hasText: "Company" }).click();
  await page.waitForTimeout(500);

  // search filter
  await page.locator('[aria-label="Search prospects"]').fill("Foundation");
  await page.waitForTimeout(500);
  const rowCountAfterSearch = await page.locator("tbody tr").count();
  console.log("rows after search 'Foundation':", rowCountAfterSearch);
  await page.locator('[aria-label="Search prospects"]').fill("");

  // taxonomy combobox open
  await page.locator('[aria-label="Filter by industry"]').click();
  await page.waitForTimeout(300);
  const dropdownVisible = await page.locator("input[aria-label='Search industries']").isVisible();
  console.log("taxonomy dropdown opened:", dropdownVisible);
  await page.keyboard.press("Escape");

  console.log("console/page errors:", errors.length ? errors.slice(0,5) : "none");
  await context.close();
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
