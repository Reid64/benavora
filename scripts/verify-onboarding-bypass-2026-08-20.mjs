// Live verification of the "Explore the platform first" onboarding-bypass
// fix (2026-08-20). Logs in as a real, un-onboarded user via magic link, and
// proves: (1) the button exists, (2) clicking it lands on /dashboard (not
// bounced back to /onboarding), (3) the user can then navigate to another
// real page without being redirected back, (4) background API polling made
// while still on /onboarding no longer gets redirected to the onboarding
// HTML page (the WGR-111-class middleware bug fixed alongside this).
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
const OUT_DIR = "test-evidence/remediation/onboarding-bypass";
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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await loginAs(context, "beta2@benavora-test.com");
  const page = await context.newPage();

  const navCountsRedirected = [];
  page.on("response", (res) => {
    if (res.url().includes("/api/nav-counts") || res.url().includes("/api/notifications")) {
      // A redirected fetch resolves with the FINAL response's status (200 for
      // the onboarding HTML page it lands on) but request().redirectedFrom()
      // reveals the chain existed.
      if (res.request().redirectedFrom()) {
        navCountsRedirected.push(res.url());
      }
    }
  });

  // --- BEFORE: on /onboarding, un-onboarded, button visible, user "stuck" ---
  await page.goto(`${BASE_URL}/onboarding`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2500);
  log("on-onboarding-page", page.url().endsWith("/onboarding"), `URL: ${page.url()}`);
  await page.screenshot({ path: `${OUT_DIR}/before-stuck-on-onboarding.png` });

  const exploreBtn = page.locator("button", { hasText: "Explore the platform first" });
  const btnCount = await exploreBtn.count();
  log("explore-button-exists", btnCount === 1, `found ${btnCount} button(s)`);

  log(
    "api-polling-not-redirected-while-onboarding",
    navCountsRedirected.length === 0,
    navCountsRedirected.length === 0
      ? "no /api/nav-counts or /api/notifications requests were redirected while on /onboarding"
      : `redirected: ${navCountsRedirected.join(", ")}`,
  );

  // --- Click "Explore the platform first" ---
  await exploreBtn.click();
  await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // --- AFTER: landed on /dashboard, not bounced back ---
  log("landed-on-dashboard", page.url().endsWith("/dashboard"), `URL: ${page.url()}`);
  await page.screenshot({ path: `${OUT_DIR}/after-exploring-dashboard.png` });

  const cookies = await context.cookies();
  const skipCookie = cookies.find((c) => c.name === "benavora_onboarding_skip");
  log("skip-cookie-set", Boolean(skipCookie && skipCookie.value === "1"), `cookie: ${JSON.stringify(skipCookie)}`);

  // --- Navigate to a real app page (Opportunities) and confirm no bounce ---
  await page.goto(`${BASE_URL}/opportunities`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(1500);
  log("can-navigate-to-real-page", page.url().endsWith("/opportunities"), `URL: ${page.url()}`);
  await page.screenshot({ path: `${OUT_DIR}/after-navigating-opportunities.png` });

  // --- Navigate to Research too, for good measure ---
  await page.goto(`${BASE_URL}/research`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(1000);
  log("can-navigate-to-research", page.url().endsWith("/research"), `URL: ${page.url()}`);

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
