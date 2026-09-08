import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";
import ws from "ws";

const FAITH_EMAIL = "info@faithfoundationsf.org";
const PROD_URL = "https://www.benavora.com";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

async function mintCookies() {
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: ws } });
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: FAITH_EMAIL });
  if (linkError || !linkData) throw new Error(`generateLink failed: ${linkError?.message}`);
  const verifyResp = await fetch(linkData.properties.action_link, { redirect: "manual" });
  const location = verifyResp.headers.get("location") || "";
  const hash = location.split("#")[1];
  const params = new URLSearchParams(hash);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  const setCookies = [];
  const authForCookies = createServerClient(url, anonKey, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
    realtime: { transport: ws },
  });
  await authForCookies.auth.setSession({ access_token, refresh_token });
  return setCookies.map((c) => ({ name: c.name, value: c.value, domain: "www.benavora.com", path: "/", httpOnly: false, secure: true, sameSite: "Lax" }));
}

async function main() {
  const cookies = await mintCookies();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await context.addCookies(cookies);
  const page = await context.newPage();

  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("response", (res) => { if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url()}`); });

  // Fresh load, clear any localStorage wizard state
  await page.goto(`${PROD_URL}/draft-generator`, { waitUntil: "load", timeout: 45000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(1500);

  // Click "Select Opportunity" step explicitly
  const selectStep = page.getByText("Select Opportunity", { exact: false }).first();
  if (await selectStep.count() > 0) {
    await selectStep.click();
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: "scripts/audit/screenshots-2026-09-08/v2-select-opportunity-step.png", fullPage: true });

  // Look for an in-panel search/filter input (not the global Ctrl+K)
  const panelInputs = await page.locator('input').all();
  console.log("input count on page:", panelInputs.length);
  for (let i = 0; i < panelInputs.length; i++) {
    const ph = await panelInputs[i].getAttribute("placeholder");
    console.log(`input[${i}] placeholder:`, ph);
  }

  // Dump visible text mentioning our new opportunity names
  const bodyText = await page.locator("body").innerText();
  const targets = ["Reentry Housing", "Neighborhood Stabilization", "Homeless Veterans Reintegration", "Community Housing Development Organizations", "Rural Capacity Building"];
  for (const t of targets) {
    console.log(`page contains "${t}":`, bodyText.includes(t));
  }

  console.log("=== console errors ===", JSON.stringify(consoleErrors.slice(0, 10)));
  console.log("=== failed requests (draft-generator) ===", JSON.stringify(failedRequests.slice(0, 10)));

  // Now AutoApply queue - capture the real error
  consoleErrors.length = 0;
  failedRequests.length = 0;
  await page.goto(`${PROD_URL}/autoapply/queue`, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(2000);
  console.log("=== console errors (autoapply/queue) ===", JSON.stringify(consoleErrors.slice(0, 10)));
  console.log("=== failed requests (autoapply/queue) ===", JSON.stringify(failedRequests.slice(0, 10)));
  await page.screenshot({ path: "scripts/audit/screenshots-2026-09-08/v2-autoapply-queue-error.png", fullPage: true });

  await browser.close();
  console.log("Done at", new Date().toISOString());
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
