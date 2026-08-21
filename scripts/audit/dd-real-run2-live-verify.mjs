// Live production verification (2026-08-21) of the real Donor Discovery run
// (WGR-158/159 post-fix): /donor-discovery and the top 3 real prospect
// detail pages, as the real Faith Foundation user. Zero console errors
// required.
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
const BASE_URL = "https://www.benavora.com";
const COOKIE_DOMAIN = "www.benavora.com";
const OUT_DIR = "test-evidence/remediation/dd-real-run-2";
mkdirSync(OUT_DIR, { recursive: true });

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TOP_3 = [
  { id: "c8d9c596-8841-4c7c-924b-fd27a15dc868", name: "GIL CHARITABLE FOUNDATION INC" },
  { id: "4fab71cf-6354-4c04-8050-dda4557c823a", name: "KOONCE FAMILY FOUNDATION TR" },
  { id: "e9d10307-60d7-4f94-bcbf-f6e05d945a23", name: "BROWNSON HOME INC" },
];

async function loginAndGetCookies() {
  const email = "info@faithfoundationsf.org";
  const { data: linkData, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const verifyResp = await fetch(linkData.properties.action_link, { redirect: "manual" });
  const location = verifyResp.headers.get("location") || "";
  const hash = location.split("#")[1];
  const params = new URLSearchParams(hash);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (!access_token || !refresh_token) throw new Error("No tokens in magic-link redirect: " + location);
  const { createServerClient } = await import("@supabase/ssr");
  const setCookies = [];
  const authForCookies = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
  });
  await authForCookies.auth.setSession({ access_token, refresh_token });
  return setCookies;
}

const results = [];
function log(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`[${ok ? "OK" : "FAIL"}] ${step} :: ${JSON.stringify(detail)}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  const setCookies = await loginAndGetCookies();
  await context.addCookies(
    setCookies.map((c) => ({ name: c.name, value: c.value, domain: COOKIE_DOMAIN, path: "/", secure: true, sameSite: "Lax" })),
  );

  // --- /donor-discovery ---
  {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

    await page.goto(`${BASE_URL}/donor-discovery`, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT_DIR}/donor-discovery-overview.png`, fullPage: true });

    const bodyText = await page.evaluate(() => document.body.innerText);
    const has59 = /\b59\b/.test(bodyText);
    log("donor-discovery-page-loads", true, { consoleErrorCount: consoleErrors.length });
    log("donor-discovery-shows-59-prospects", has59, { has59 });
    log("donor-discovery-zero-console-errors", consoleErrors.length === 0, { errors: consoleErrors.slice(0, 5) });
    await page.close();
  }

  // --- top 3 prospect detail pages ---
  for (const prospect of TOP_3) {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

    await page.goto(`${BASE_URL}/donor-discovery/prospects/${prospect.id}`, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(3000);
    const safeSlug = prospect.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    await page.screenshot({ path: `${OUT_DIR}/prospect-${safeSlug}.png`, fullPage: true });

    const mainText = await page.evaluate(() => document.querySelector("main")?.textContent?.trim() ?? document.body.innerText);
    log("prospect-detail-nonblank", mainText.length > 50, { id: prospect.id, name: prospect.name, mainTextLen: mainText.length });
    log("prospect-detail-zero-console-errors", consoleErrors.length === 0, { id: prospect.id, errors: consoleErrors.slice(0, 5) });
    await page.close();
  }

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
