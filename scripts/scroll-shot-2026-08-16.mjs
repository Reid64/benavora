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
async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const email = "info@faithfoundationsf.org";
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const verifyResp = await fetch(linkData.properties.action_link, { redirect: "manual" });
  const location = verifyResp.headers.get("location") || "";
  const hash = location.split("#")[1];
  const params = new URLSearchParams(hash);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  const { createServerClient } = await import("@supabase/ssr");
  const setCookies = [];
  const authForCookies = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
  });
  await authForCookies.auth.setSession({ access_token, refresh_token });
  await context.addCookies(setCookies.map((c) => ({ name: c.name, value: c.value, domain: "localhost", path: "/" })));
  const page = await context.newPage();
  await page.goto("http://localhost:3000/autoapply", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("*"));
    let best = { tag: "body", scrollHeight: document.body.scrollHeight, clientHeight: document.body.clientHeight };
    for (const el of all) {
      if (el.scrollHeight - el.clientHeight > 50 && el.scrollHeight > best.scrollHeight) {
        best = { tag: el.tagName + "." + el.className, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
      }
    }
    return best;
  });
  console.log("scroll container", JSON.stringify(info));

  await page.evaluate(() => document.querySelector("main").scrollTo(0, 1600));
  await page.waitForTimeout(300);
  await page.screenshot({ path: "smoke-test-output/autoapply-accent-sessionlist-2026-08-16.png" });

  await page.evaluate(() => document.querySelector("main").scrollTo(0, 3586));
  await page.waitForTimeout(300);
  const expandBtn = await page.$("text=Expand");
  if (expandBtn) await expandBtn.click();
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector("main").scrollTo(0, 999999));
  await page.waitForTimeout(300);
  await page.screenshot({ path: "smoke-test-output/autoapply-accent-analytics-2026-08-16.png" });

  await browser.close();
}
main();
