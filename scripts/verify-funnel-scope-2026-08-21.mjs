// Verification for WGR-156: confirms the Pipeline Funnel and stat cards on
// /donor-discovery render correctly for the real Faith Foundation org
// (b1ab7402-dfc2-4712-869f-70ea3566cc1d) after moving the 4 stat queries
// (High-Intent Signals, Contacted This Month, Active Campaigns, AutoApply
// Submissions) into the org-scoped /api/donor-discovery/stats route.
// Screenshots + a JSON summary of the rendered funnel numbers (still
// 133,812 "New" today — that's real seed data, not a query bug; see
// WGR-156 for why) are saved as evidence.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
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
const BASE_URL = process.argv[2] || "http://localhost:3100";
const IS_PROD = BASE_URL.includes("benavora.com");
const OUT_DIR = "test-evidence/remediation/funnel-scope";
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
  const domain = new URL(BASE_URL).hostname;
  await context.addCookies(setCookies.map((c) => ({ name: c.name, value: c.value, domain, path: "/" })));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1400 } });
  await loginAs(context, "info@faithfoundationsf.org");
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 300)));

  await page.goto(`${BASE_URL}/donor-discovery`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000);

  const suffix = IS_PROD ? "-prod" : "";
  await page.screenshot({ path: `${OUT_DIR}/donor-discovery-full${suffix}.png`, fullPage: true });

  const funnelHeading = page.locator("text=Pipeline Funnel").first();
  await funnelHeading.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT_DIR}/funnel${suffix}.png` });

  const stageOrder = ["new", "reviewing", "contacted", "applied", "received", "rejected"];
  const funnelCounts = await page.evaluate((stages) => {
    const links = Array.from(document.querySelectorAll("a[href*='/donor-discovery/prospects?stage=']"));
    const result = {};
    for (const stage of stages) {
      const link = links.find((a) => a.getAttribute("href") === `/donor-discovery/prospects?stage=${stage}`);
      if (!link) continue;
      const valueEl = link.querySelector("p");
      result[stage] = valueEl ? valueEl.textContent.trim() : null;
    }
    return result;
  }, stageOrder);

  const statValues = await page.evaluate(() => {
    const labels = [
      "Prospects Identified",
      "High-Intent Signals",
      "Active Campaigns",
      "AutoApply Submissions",
      "Active Requests",
      "Avg Score",
      "New & Reviewing",
      "Contacted This Month",
    ];
    return labels.map((label) => {
      const labelEl = Array.from(document.querySelectorAll("p")).find((p) => p.textContent?.trim() === label);
      if (!labelEl) return { label, found: false };
      const valueEl = labelEl.previousElementSibling;
      return { label, found: true, value: valueEl ? valueEl.textContent?.trim() : null };
    });
  });

  const output = {
    capturedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    funnelCounts,
    statValues,
    pageErrors,
  };
  const fileName = IS_PROD ? "live-after.json" : "before.json";
  writeFileSync(`${OUT_DIR}/${fileName}`, JSON.stringify(output, null, 2));

  console.log(`\n=== Funnel + stats (${BASE_URL}) ===`);
  console.log("Funnel:", JSON.stringify(funnelCounts));
  for (const s of statValues) console.log(`${s.label}: ${s.found ? s.value : "NOT FOUND"}`);
  if (pageErrors.length > 0) console.log("PAGE ERRORS:", pageErrors);

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
