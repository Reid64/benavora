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

async function main() {
  mkdirSync("smoke-test-output", { recursive: true });
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

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1800 } });
  await context.addCookies(setCookies.map((c) => ({ name: c.name, value: c.value, domain: "localhost", path: "/" })));
  const page = await context.newPage();
  await page.goto("http://localhost:3000/autoapply", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000);

  const cardBox = await page.evaluate(() => {
    const label = Array.from(document.querySelectorAll("p")).find((p) => p.textContent?.trim() === "Sessions Today");
    let el = label;
    for (let i = 0; i < 2; i++) el = el.parentElement;
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  });
  console.log("cardBox:", JSON.stringify(cardBox));

  await page.screenshot({
    path: "smoke-test-output/ZOOM-autoapply-card1-2026-08-18.png",
    clip: { x: Math.max(0, cardBox.x - 15), y: Math.max(0, cardBox.y - 15), width: cardBox.w + 30, height: cardBox.h + 30 },
  });

  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
