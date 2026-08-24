// Live LOCAL verification (2026-08-22) of the corrected grantmaker-mode
// Donor Discovery run (request 3c9faddc-...): /donor-discovery and the top 3
// real prospect detail pages, as the real Faith Foundation user. Local (not
// production) because this session's fix has not been pushed/deployed --
// production still runs the pre-fix code. Zero console errors required.
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
const BASE_URL = "http://localhost:3103";
const COOKIE_DOMAIN = "localhost";
const OUT_DIR = "test-evidence/remediation/dd-real-run-3";
mkdirSync(OUT_DIR, { recursive: true });

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TOP_3 = [
  { id: "331e00c5-578c-4518-9f33-f144f97aba5a", name: "CLIMB HAIER INTERNATIONAL INC" },
  { id: "69563b2e-8704-45cc-8988-b4e6189d28df", name: "LUBBOCK YOUNG WOMENS LEADER FOUNDATION" },
  { id: "31850639-ecdc-4511-9579-957d862e42b7", name: "ED RACHAL FOUNDATION" },
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
    setCookies.map((c) => ({ name: c.name, value: c.value, domain: COOKIE_DOMAIN, path: "/", secure: false, sameSite: "Lax" })),
  );

  // --- /donor-discovery ---
  {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

    await page.goto(`${BASE_URL}/donor-discovery`, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(15000);
    await page.screenshot({ path: `${OUT_DIR}/donor-discovery-overview.png`, fullPage: true });

    const bodyText = await page.evaluate(() => document.body.innerText);
    const has17 = /\b17\b/.test(bodyText);
    log("donor-discovery-page-loads", true, { consoleErrorCount: consoleErrors.length });
    log("donor-discovery-shows-17-prospects", has17, { has17 });
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
    await page.waitForTimeout(15000);
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
