// TS-01: AutoApply end-to-end verification (2026-08-23). Proves the pipeline
// works against a real opportunity without any external submission occurring.
// Auth: magic-link as info@faithfoundationsf.org (established pattern, see
// scripts/audit/prod-smoke-2026-08-21.mjs). All steps run foreground/synchronous.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
const OUT_DIR = "test-evidence/verification/ts-01";
mkdirSync(OUT_DIR, { recursive: true });

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const APPLICATION_ID = "1944f4e3-eade-48e7-b314-f5bb8001f56a";
const FEATURE_FLAG_ID = "67511e44-c614-4382-8a34-ba7771b8252f";

const report = {
  timestamp: null,
  applicationId: APPLICATION_ID,
  sessionId: null,
  statusTransitions: [],
  externalSubmissionOccurred: null,
  consoleErrorCount: 0,
  notes: [],
};

let consoleErrors = 0;
function wirePageErrorTracking(page) {
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors++;
      console.log("[console.error]", msg.text());
    }
  });
  page.on("pageerror", (err) => {
    consoleErrors++;
    console.log("[pageerror]", String(err));
  });
}

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

async function setFeatureFlag(value) {
  const res = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/platform_config?id=eq.${FEATURE_FLAG_ID}`,
    {
      method: "PATCH",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ value: String(value) }),
    },
  );
  const body = await res.json().catch(() => null);
  console.log(`[flag] feature.browser_automation -> ${value} :: status ${res.status}`, JSON.stringify(body));
  return res.status === 200;
}

async function main() {
  report.timestamp = new Date().toISOString();

  // Flag was OFF in prod for this org (route.ts:104 would 403 feature_disabled
  // otherwise). Flip ON for the duration of this test, restore to OFF at the end.
  console.log("=== Enabling feature.browser_automation for org (was false) ===");
  const flagOn = await setFeatureFlag(true);
  report.notes.push({ step: "flag-enable", ok: flagOn });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const setCookies = await loginAndGetCookies();
  await context.addCookies(
    setCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: COOKIE_DOMAIN,
      path: "/",
      secure: true,
      sameSite: "Lax",
    })),
  );
  const cookieHeader = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");

  try {
    // ---- STEP 3: /autoapply home ----
    console.log("=== STEP 3: /autoapply ===");
    const page3 = await context.newPage();
    wirePageErrorTracking(page3);
    await page3.goto(`${BASE_URL}/autoapply`, { timeout: 45000 });
    await page3.waitForLoadState("networkidle", { timeout: 30000 }).catch((e) =>
      console.log("[warn] networkidle timeout on /autoapply:", String(e)),
    );
    await page3.screenshot({ path: `${OUT_DIR}/01-autoapply-home.png`, fullPage: true });
    console.log("[ok] screenshot 01-autoapply-home.png saved");
    await page3.close();

    // ---- STEP 4: trigger session, hold at awaiting_approval, poll ----
    console.log("=== STEP 4: POST /api/agents/automation ===");
    const postResp = await fetch(`${BASE_URL}/api/agents/automation`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ applicationId: APPLICATION_ID }),
      signal: AbortSignal.timeout(280000),
    });
    const postBody = await postResp.json().catch(() => ({}));
    console.log("[trigger] status", postResp.status, JSON.stringify(postBody));
    if (postResp.status !== 200 || !postBody.sessionId) {
      report.notes.push({ step: "trigger", ok: false, status: postResp.status, body: postBody });
      throw new Error(`Trigger failed: ${postResp.status} ${JSON.stringify(postBody)}`);
    }
    const sessionId = postBody.sessionId;
    report.sessionId = sessionId;
    report.statusTransitions.push({ t: new Date().toISOString(), status: postBody.status, source: "trigger-response" });
    console.log(`[session] id=${sessionId} initial status=${postBody.status}`);

    const HARD_CAP_MS = 10 * 60 * 1000;
    const POLL_INTERVAL_MS = 15 * 1000;
    const start = Date.now();
    let lastStatus = postBody.status;
    let terminalReached = lastStatus === "awaiting_approval" || lastStatus === "failed";
    while (!terminalReached && Date.now() - start < HARD_CAP_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const pollResp = await fetch(`${BASE_URL}/api/agents/automation/${sessionId}`, {
        headers: { Cookie: cookieHeader },
      });
      const pollBody = await pollResp.json().catch(() => ({}));
      const status = pollBody?.session?.status ?? null;
      console.log(`[poll ${Math.round((Date.now() - start) / 1000)}s] status=${status}`);
      if (status && status !== lastStatus) {
        report.statusTransitions.push({ t: new Date().toISOString(), status, source: "poll" });
        lastStatus = status;
      }
      if (status === "awaiting_approval" || status === "failed") {
        terminalReached = true;
      }
    }
    if (!terminalReached) {
      report.notes.push({ step: "poll", ok: false, note: "10-minute hard cap reached without terminal status" });
      console.log("[FAIL] 10-minute hard cap reached without reaching awaiting_approval/failed");
    } else {
      console.log(`[ok] terminal status reached: ${lastStatus}`);
    }

    // ---- STEP 5: /autoapply/review-queue ----
    console.log("=== STEP 5: /autoapply/review-queue ===");
    const page5 = await context.newPage();
    wirePageErrorTracking(page5);
    await page5.goto(`${BASE_URL}/autoapply/review-queue`, { timeout: 45000 });
    await page5.waitForLoadState("networkidle", { timeout: 30000 }).catch((e) =>
      console.log("[warn] networkidle timeout on /autoapply/review-queue:", String(e)),
    );
    await page5.screenshot({ path: `${OUT_DIR}/02-review-card.png`, fullPage: true });
    const reviewText = await page5.evaluate(() => document.body.innerText).catch(() => "");
    const hasOppName = reviewText.includes("Rural Housing Preservation Grant");
    report.notes.push({ step: "review-card-content", opportunityNameVisible: hasOppName });
    console.log(`[check] review-queue text contains opportunity name: ${hasOppName}`);
    await page5.close();

    // ---- STEP 6: cancel via API, verify status + no external submission ----
    console.log("=== STEP 6: cancel session ===");
    const cancelResp = await fetch(`${BASE_URL}/api/agents/automation/${sessionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ action: "reject", notes: "TS-01 verification: deliberate cancel, no approval." }),
    });
    const cancelBody = await cancelResp.json().catch(() => ({}));
    const cancelStatus = cancelBody?.session?.status ?? null;
    console.log("[cancel] http status", cancelResp.status, "session status", cancelStatus);
    report.statusTransitions.push({ t: new Date().toISOString(), status: cancelStatus, source: "cancel-response" });

    const { data: sessionRow, error: sessionErr } = await admin
      .from("automation_sessions")
      .select("id, status, confirmation_number, target_url")
      .eq("id", sessionId)
      .single();
    console.log("[db] automation_sessions row:", JSON.stringify(sessionRow), sessionErr ? String(sessionErr) : "");

    const { data: stepsRows, error: stepsErr } = await admin
      .from("automation_steps")
      .select("step_number, action, status")
      .eq("session_id", sessionId)
      .order("step_number", { ascending: true });
    console.log("[db] automation_steps:", JSON.stringify(stepsRows), stepsErr ? String(stepsErr) : "");
    const submitStep = (stepsRows || []).find((s) =>
      /submit/i.test(s.action || "") && !/no.?submit/i.test(s.action || ""),
    );
    report.externalSubmissionOccurred = Boolean(submitStep) || Boolean(sessionRow?.confirmation_number);
    report.notes.push({
      step: "action-log-check",
      table: "automation_steps",
      stepCount: (stepsRows || []).length,
      submitStepFound: Boolean(submitStep),
      confirmationNumber: sessionRow?.confirmation_number ?? null,
    });

    // ---- STEP 7: recordings + analytics ----
    console.log("=== STEP 7: /autoapply/recordings + /autoapply/analytics ===");
    const page7a = await context.newPage();
    wirePageErrorTracking(page7a);
    await page7a.goto(`${BASE_URL}/autoapply/recordings`, { timeout: 45000 });
    await page7a.waitForLoadState("networkidle", { timeout: 30000 }).catch((e) =>
      console.log("[warn] networkidle timeout on /autoapply/recordings:", String(e)),
    );
    await page7a.screenshot({ path: `${OUT_DIR}/03-recordings.png`, fullPage: true });
    await page7a.close();

    const page7b = await context.newPage();
    wirePageErrorTracking(page7b);
    await page7b.goto(`${BASE_URL}/autoapply/analytics`, { timeout: 45000 });
    await page7b.waitForLoadState("networkidle", { timeout: 30000 }).catch((e) =>
      console.log("[warn] networkidle timeout on /autoapply/analytics:", String(e)),
    );
    await page7b.screenshot({ path: `${OUT_DIR}/04-analytics.png`, fullPage: true });
    await page7b.close();
  } finally {
    await browser.close();
    console.log("=== Restoring feature.browser_automation to false ===");
    const flagOff = await setFeatureFlag(false);
    report.notes.push({ step: "flag-restore", ok: flagOff });
  }

  report.consoleErrorCount = consoleErrors;
  writeFileSync(`${OUT_DIR}/ts-01-results.json`, JSON.stringify(report, null, 2));
  console.log("\n=== TS-01 FINAL REPORT ===");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
