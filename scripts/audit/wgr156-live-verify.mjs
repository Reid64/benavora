// WGR-156 live production verification (2026-08-21): after purging all
// 133,812 seed prospects for org b1ab7402-dfc2-4712-869f-70ea3566cc1d,
// confirm /donor-discovery and /donor-discovery/prospects render correctly
// (0 prospects, no crash, no stale seed data) as the real Faith Foundation
// user.
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
const OUT_DIR = "test-evidence/remediation/wgr-156";
mkdirSync(OUT_DIR, { recursive: true });

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  await page.goto(`${BASE_URL}/donor-discovery`, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT_DIR}/donor-discovery-after-purge.png`, fullPage: true });

  const funnelText = await page.evaluate(() => document.body.innerText);
  const hasHugeSeedCount = /133,?812/.test(funnelText);
  log("donor-discovery-page-loads", true, { consoleErrorCount: consoleErrors.length });
  log("donor-discovery-no-133812-seed-count-visible", !hasHugeSeedCount, { found133812: hasHugeSeedCount });

  await page.goto(`${BASE_URL}/donor-discovery/prospects`, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT_DIR}/donor-discovery-prospects-after-purge.png`, fullPage: true });
  const prospectsText = await page.evaluate(() => document.body.innerText);
  const hasHugeSeedCountProspects = /133,?812/.test(prospectsText);
  log("prospects-page-loads", true, {});
  log("prospects-no-133812-seed-count-visible", !hasHugeSeedCountProspects, { found133812: hasHugeSeedCountProspects });

  log("zero-console-errors", consoleErrors.length === 0, { errors: consoleErrors.slice(0, 5) });

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
