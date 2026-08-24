// Live verification of the BenavoraMarketing <style> hydration-mismatch fix
// (2026-08-21). Loads the real marketing/landing page (unauthenticated) and
// a real authenticated dashboard page, capturing ALL console messages and
// page errors, specifically looking for "hydrat" (hydration) or "Text
// content does not match" — the exact error signature reported.
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
const OUT_DIR = "test-evidence/remediation/hydration-fix";
mkdirSync(OUT_DIR, { recursive: true });

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function loginAs(context, email) {
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

const results = [];
function log(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`[${ok ? "OK" : "FAIL"}] ${step} :: ${detail}`);
}

function isHydrationError(text) {
  const t = text.toLowerCase();
  return (
    t.includes("hydrat") ||
    t.includes("text content does not match") ||
    t.includes("did not match") ||
    t.includes("server-rendered html")
  );
}

async function checkPage(browser, { name, url, authed }) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  if (authed) {
    await loginAs(context, "beta2@benavora-test.com");
  }
  const page = await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  page.on("console", (msg) => consoleMessages.push({ type: msg.type(), text: msg.text() }));
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto(`${BASE_URL}${url}`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000);

  const hydrationConsoleErrors = consoleMessages.filter((m) => isHydrationError(m.text));
  const hydrationPageErrors = pageErrors.filter((e) => isHydrationError(e));

  log(
    `${name}-no-hydration-error`,
    hydrationConsoleErrors.length === 0 && hydrationPageErrors.length === 0,
    hydrationConsoleErrors.length === 0 && hydrationPageErrors.length === 0
      ? "no hydration-related console/page errors found"
      : `console: ${JSON.stringify(hydrationConsoleErrors)}, pageErrors: ${JSON.stringify(hydrationPageErrors)}`,
  );

  const bodyText = await page.locator("body").innerText().catch(() => "");
  log(`${name}-renders-content`, bodyText.trim().length > 100, `body text length: ${bodyText.trim().length}`);

  await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: false });

  console.log(`\n--- ${name}: all console messages (${consoleMessages.length}) ---`);
  for (const m of consoleMessages) console.log(`  [${m.type}] ${m.text.slice(0, 200)}`);
  console.log(`--- ${name}: all page errors (${pageErrors.length}) ---`);
  for (const e of pageErrors) console.log(`  ${e.slice(0, 300)}`);

  await context.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  await checkPage(browser, { name: "marketing-landing-page", url: "/", authed: false });
  await checkPage(browser, { name: "authenticated-dashboard", url: "/dashboard", authed: true });

  await browser.close();

  console.log("\n=== Results summary ===");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.step}: ${r.detail}`);

  const failCount = results.filter((r) => !r.ok).length;
  if (failCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
