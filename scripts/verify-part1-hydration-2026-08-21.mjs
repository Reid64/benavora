// Part 1 verification (2026-08-21 session 3): confirm the hydration fix
// holds and all four required pages render with no hydration error, reached
// via the real "Explore the platform first" onboarding bypass as an
// authenticated but un-onboarded user.
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
  return t.includes("hydrat") || t.includes("text content does not match") || t.includes("server-rendered html");
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } });

  const consoleMessages = [];
  const pageErrors = [];

  const page = await context.newPage();
  page.on("console", (msg) => consoleMessages.push({ url: page.url(), type: msg.type(), text: msg.text() }));
  page.on("pageerror", (err) => pageErrors.push({ url: page.url(), text: String(err) }));

  // --- 1. Landing page, unauthenticated ---
  await page.goto(`${BASE_URL}/`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT_DIR}/session3-01-landing-page.png` });
  const bodyLen1 = (await page.locator("body").innerText().catch(() => "")).trim().length;
  log("landing-page-renders", bodyLen1 > 100, `body text length: ${bodyLen1}`);

  // --- Login as un-onboarded user, go through onboarding + Explore bypass ---
  await loginAs(context, "beta2@benavora-test.com");
  await page.goto(`${BASE_URL}/onboarding`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(4000);
  const exploreBtn = page.locator("button", { hasText: "Explore the platform first" });
  const btnCount = await exploreBtn.count();
  log("explore-bypass-button-exists", btnCount === 1, `found ${btnCount}`);
  if (btnCount === 1) {
    await exploreBtn.click();
    await page.waitForTimeout(4000);
  }
  log("bypass-reached-dashboard", page.url().endsWith("/dashboard"), `URL after bypass click: ${page.url()}`);
  await page.screenshot({ path: `${OUT_DIR}/session3-02-dashboard.png` });
  const bodyLen2 = (await page.locator("body").innerText().catch(() => "")).trim().length;
  log("dashboard-renders", bodyLen2 > 100, `body text length: ${bodyLen2}`);

  // --- 3. Draft Generator ---
  await page.goto(`${BASE_URL}/draft-generator`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(4000);
  log("draft-generator-not-bounced", page.url().endsWith("/draft-generator"), `URL: ${page.url()}`);
  await page.screenshot({ path: `${OUT_DIR}/session3-03-draft-generator.png` });
  const bodyLen3 = (await page.locator("body").innerText().catch(() => "")).trim().length;
  log("draft-generator-renders", bodyLen3 > 100, `body text length: ${bodyLen3}`);

  // --- 4. Opportunities ---
  await page.goto(`${BASE_URL}/opportunities`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(4000);
  log("opportunities-not-bounced", page.url().endsWith("/opportunities"), `URL: ${page.url()}`);
  await page.screenshot({ path: `${OUT_DIR}/session3-04-opportunities.png` });
  const bodyLen4 = (await page.locator("body").innerText().catch(() => "")).trim().length;
  log("opportunities-renders", bodyLen4 > 100, `body text length: ${bodyLen4}`);

  await browser.close();

  const hydrationConsole = consoleMessages.filter((m) => isHydrationError(m.text));
  const hydrationPageErrors = pageErrors.filter((e) => isHydrationError(e.text));
  log(
    "no-hydration-errors-anywhere",
    hydrationConsole.length === 0 && hydrationPageErrors.length === 0,
    hydrationConsole.length === 0 && hydrationPageErrors.length === 0
      ? "zero hydration-related messages across all 4 pages"
      : `console: ${JSON.stringify(hydrationConsole)}, pageErrors: ${JSON.stringify(hydrationPageErrors)}`,
  );

  console.log("\n=== All console messages ===");
  for (const m of consoleMessages) console.log(`  [${m.type}] (${m.url}) ${m.text.slice(0, 150)}`);
  console.log("\n=== All page errors ===");
  for (const e of pageErrors) console.log(`  (${e.url}) ${e.text.slice(0, 250)}`);

  console.log("\n=== Results summary ===");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.step}: ${r.detail}`);

  const failCount = results.filter((r) => !r.ok).length;
  if (failCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
