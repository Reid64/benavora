// Captures "before" scrollbar screenshots (old 10px beige/champagne thumb)
// on the same 3 pages/crops the after-script uses, for a real side-by-side.
// Run this ONLY while globals.css is stashed back to its pre-change state.
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
const BASE_URL = "http://localhost:3100";
const OUT_DIR = "smoke-test-output";
mkdirSync(OUT_DIR, { recursive: true });

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

const PAGES = [
  { path: "/draft-generator", label: "draft-generator" },
  { path: "/research", label: "research" },
  { path: "/applications", label: "applications" },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 500 } });
  await loginAsFaith(context);
  const page = await context.newPage();

  for (const { path, label } of PAGES) {
    await page.goto(BASE_URL + path, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(1200);
    const mainRect = await page.evaluate(() => {
      const main = document.querySelector("main");
      if (!main) return null;
      if (main.scrollHeight <= main.clientHeight) {
        const pad = document.createElement("div");
        pad.style.height = "2500px";
        pad.setAttribute("data-scrollbar-test-pad", "1");
        main.appendChild(pad);
      }
      const r = main.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    await page.waitForTimeout(300);
    if (mainRect) {
      const sbX = mainRect.x + mainRect.width - 22;
      await page.screenshot({
        path: `${OUT_DIR}/scrollbar-${label}-before-2026-08-17.png`,
        clip: { x: Math.max(0, sbX), y: mainRect.y, width: 22, height: Math.min(500, mainRect.height) },
      });
    }
    console.log(`captured before: ${label} mainRect=${JSON.stringify(mainRect)}`);
  }

  await browser.close();
}

main();
