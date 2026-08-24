// Real verification for the Draft & Automation accent (#2563EB) pass on /alerts,
// per PAGE_TREATMENT_PROTOCOL.md step 6. Reuses the magic-link login technique.
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
const BASE_URL = "http://localhost:3000";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function loginAsFaith(context) {
  const email = "info@faithfoundationsf.org";
  const { data: linkData, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
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
}

mkdirSync("smoke-test-output", { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  await loginAsFaith(context);
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  await page.goto(BASE_URL + "/alerts", { waitUntil: "load", timeout: 30000 });
  await page
    .waitForFunction(
      () => !Array.from(document.querySelectorAll("span")).some((el) => el.textContent?.trim() === "Loading alerts..."),
      { timeout: 20000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1000);

  const checks = await page.evaluate(() => {
    const title = document.querySelector("h1, [class*='PageHeader'] h1") || Array.from(document.querySelectorAll("h1")).find(h => h.textContent?.includes("Alerts"));
    const markAllBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Mark all read");
    const allPill = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "All");
    const markAsReadLinks = Array.from(document.querySelectorAll("button")).filter((b) => b.textContent?.trim() === "Mark as read");
    const overdueBorders = Array.from(document.querySelectorAll("li")).slice(0, 5).map((li) => getComputedStyle(li).borderLeftColor);
    return {
      titleColor: title ? getComputedStyle(title).color : null,
      markAllBg: markAllBtn ? getComputedStyle(markAllBtn).backgroundColor : null,
      allPillBg: allPill ? getComputedStyle(allPill).backgroundColor : null,
      markAsReadColor: markAsReadLinks[0] ? getComputedStyle(markAsReadLinks[0]).color : null,
      markAsReadCount: markAsReadLinks.length,
      overdueBorders,
    };
  });

  await page.screenshot({ path: "smoke-test-output/alerts-accent-verify-2026-08-16.png", fullPage: false });

  console.log(JSON.stringify({ checks, consoleErrors }, null, 2));
  await browser.close();
}
main();
