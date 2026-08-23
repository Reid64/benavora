// TS-05 STEP 3: call compliance/check, alerts, intelligence/evaluation
// synchronously as info@faithfoundationsf.org and record responses.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
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
const APPLICATION_ID = "581f6778-5984-4226-ba8a-2b792042319d";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await loginAsFaith(context);
  // Warm the session cookie via a real page load first.
  const page = await context.newPage();
  await page.goto(BASE_URL + "/dashboard", { waitUntil: "load" });

  const out = {};

  // POST /api/compliance/check
  const complianceResp = await context.request.post(BASE_URL + "/api/compliance/check", {
    data: { application_id: APPLICATION_ID },
    timeout: 60000,
  });
  out.compliance_check = {
    status: complianceResp.status(),
    body: await complianceResp.json().catch(async () => await complianceResp.text()),
  };
  console.log("POST /api/compliance/check ->", out.compliance_check.status);
  console.log(JSON.stringify(out.compliance_check.body, null, 2));

  // GET /api/alerts
  const alertsResp = await context.request.get(BASE_URL + "/api/alerts", { timeout: 30000 });
  out.alerts = {
    status: alertsResp.status(),
    body: await alertsResp.json().catch(async () => await alertsResp.text()),
  };
  console.log("\nGET /api/alerts ->", out.alerts.status);
  console.log(JSON.stringify({ counts: out.alerts.body?.counts, alertCount: out.alerts.body?.alerts?.length }, null, 2));

  // GET /api/intelligence/evaluation?category=housing
  const evalResp = await context.request.get(BASE_URL + "/api/intelligence/evaluation?category=housing", { timeout: 60000 });
  out.intelligence_evaluation = {
    status: evalResp.status(),
    body: await evalResp.json().catch(async () => await evalResp.text()),
  };
  console.log("\nGET /api/intelligence/evaluation?category=housing ->", out.intelligence_evaluation.status);
  console.log(JSON.stringify(out.intelligence_evaluation.body, null, 2).slice(0, 2000));

  await browser.close();
  writeFileSync("test-evidence/verification/ts-05/03-api-responses.json", JSON.stringify(out, null, 2));
  console.log("\nSaved to test-evidence/verification/ts-05/03-api-responses.json");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
