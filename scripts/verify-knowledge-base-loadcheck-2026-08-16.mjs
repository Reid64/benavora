// Load-check for /knowledge-base BEFORE any styling work, per
// PAGE_TREATMENT_PROTOCOL.md's "load-check first" requirement.
// Read-only verification: does the page load with real data under a real
// authenticated session? No code changes.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
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
const BASE_URL = "http://localhost:3000";
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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  const netFailures = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));
  page.on("requestfailed", (req) => netFailures.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText}`));
  page.on("response", async (res) => {
    if (res.url().includes("/api/knowledge-base") || res.url().includes("knowledge_base") || res.url().includes("proven_narratives")) {
      netFailures.push(`RESPONSE ${res.status()} ${res.url()}`);
    }
  });

  try {
    await page.goto(BASE_URL + "/knowledge-base", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(8000);

    const finalUrl = page.url();
    const bodyText = await page.evaluate(() => document.body.innerText);
    const hasErrorBanner = /could not load/i.test(bodyText);

    const navLabels = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a")).map((a) => a.textContent?.trim()).filter(Boolean);
    });

    const h1 = await page.evaluate(() => document.querySelector("h1")?.textContent || null);

    // completeness bar / percentage text
    const percentMatch = bodyText.match(/(\d{1,3})\s*%/);

    await page.screenshot({ path: "smoke-test-output/knowledge-base-loadcheck-2026-08-16.png", fullPage: true });

    console.log("=== RESULT ===");
    console.log("final URL:", finalUrl);
    console.log("h1:", h1);
    console.log("error banner present:", hasErrorBanner);
    console.log("percent match found:", percentMatch ? percentMatch[0] : "none");
    console.log("console/page errors:", JSON.stringify(consoleErrors, null, 2));
    console.log("network (api/table related):", JSON.stringify(netFailures, null, 2));
    console.log("nav-ish links (first 40):", JSON.stringify(navLabels.slice(0, 40), null, 2));
    console.log("--- body text (first 3000 chars) ---");
    console.log(bodyText.slice(0, 3000));
  } catch (err) {
    console.log("FATAL:", err.stack || String(err));
  } finally {
    await browser.close();
  }
}

main();
