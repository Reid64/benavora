// TS-05 verification: WGR-004 /documents hang re-test + follow-ups/compliance/
// outcomes/alerts screenshots. Foreground only, no background processes.
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
const BASE_URL = "http://localhost:3002";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const results = [];
function log(step, ok, detail) {
  results.push({ step, ok, detail, at: new Date().toISOString() });
  console.log(`[${ok ? "OK" : "FAIL"}] ${step} :: ${detail}`);
}

async function loginAsFaith(context) {
  const email = "info@faithfoundationsf.org";
  const { data: linkData, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error("generateLink failed: " + error.message);
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

async function timedGoto(page, path, timeoutMs) {
  const start = Date.now();
  try {
    await page.goto(BASE_URL + path, { waitUntil: "load", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
    return { ok: true, ms: Date.now() - start };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: String(e) };
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await loginAsFaith(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

  // STEP 1: /documents with 15s timeout
  const docsResult = await timedGoto(page, "/documents", 15000);
  log("wgr004-documents-nav", docsResult.ok, JSON.stringify(docsResult));
  if (docsResult.ok) {
    await page.screenshot({ path: "test-evidence/verification/ts-05/01-documents.png", fullPage: true });
    log("wgr004-documents-screenshot", true, `loaded in ${docsResult.ms}ms`);
  } else {
    await page.screenshot({ path: "test-evidence/verification/ts-05/01-documents-TIMEOUT.png", fullPage: true }).catch(() => {});
    log("wgr004-documents-screenshot", false, "navigation did not complete within 15000ms");
  }
  log("wgr004-documents-console-errors", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 5)));

  // STEP 2: screenshots of follow-ups, compliance, outcomes, alerts
  const pages = [
    { path: "/follow-ups", out: "test-evidence/verification/ts-05/02-follow-ups.png" },
    { path: "/compliance", out: "test-evidence/verification/ts-05/03-compliance.png" },
    { path: "/outcomes", out: "test-evidence/verification/ts-05/04-outcomes.png" },
    { path: "/alerts", out: "test-evidence/verification/ts-05/05-alerts.png" },
  ];
  for (const p of pages) {
    const r = await timedGoto(page, p.path, 15000);
    log(`nav-${p.path}`, r.ok, JSON.stringify(r));
    await page.screenshot({ path: p.out, fullPage: true }).catch((e) => log(`screenshot-${p.path}`, false, String(e)));
  }

  await browser.close();
  console.log("\n=== RESULTS JSON ===");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
