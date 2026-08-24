// knw-004 live verification against `next start -p 3101`.
// 1) As info@faithfoundationsf.org (real prod org): open /dashboard, click
//    Assist, ask about upcoming deadlines (expect toolsUsed to include
//    upcoming_deadlines) and ask "What is a 990-PF?" (expect an irs.gov
//    citation). Screenshots saved to test-evidence/knowledge/knw-004/.
// 2) Isolation check: call POST /api/assist directly as beta1@benavora-test.com
//    with "list my opportunities" and confirm the answer does not mention any
//    of Faith Foundation's real opportunity titles.
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
const BASE_URL = "http://localhost:3101";
const COOKIE_DOMAIN = "localhost";
const OUT_DIR = "test-evidence/knowledge/knw-004";
mkdirSync(OUT_DIR, { recursive: true });

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function magicLinkCookies(email) {
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
  console.log(`[${ok ? "OK" : "FAIL"}] ${step} :: ${JSON.stringify(detail).slice(0, 500)}`);
}

async function main() {
  // --- Faith Foundation's real opportunity titles (for the isolation check) ---
  const { data: ffProfile } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("email", "info@faithfoundationsf.org")
    .maybeSingle();
  const { data: ffOpps } = await admin
    .from("opportunities")
    .select("name")
    .eq("organization_id", ffProfile.organization_id)
    .limit(20);
  const ffTitles = (ffOpps ?? []).map((o) => o.name);
  log("faith-foundation-opportunity-titles-loaded", ffTitles.length > 0, { count: ffTitles.length });

  // --- Part 1: authenticated UI walkthrough as Faith Foundation ---
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const ffCookies = await magicLinkCookies("info@faithfoundationsf.org");
  await context.addCookies(
    ffCookies.map((c) => ({ name: c.name, value: c.value, domain: COOKIE_DOMAIN, path: "/", secure: false, sameSite: "Lax" })),
  );

  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  let assistJson1 = null;
  let assistJson2 = null;
  page.on("response", async (resp) => {
    if (resp.url().endsWith("/api/assist") && resp.request().method() === "POST") {
      try {
        const json = await resp.json();
        if (!assistJson1) assistJson1 = json;
        else assistJson2 = json;
      } catch {
        // ignore non-JSON
      }
    }
  });

  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT_DIR}/01-dashboard.png`, fullPage: true });
  log("dashboard-loads", true, { consoleErrorCount: consoleErrors.length });

  await page.getByRole("button", { name: "Open Benavora Assist" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT_DIR}/02-assist-panel-open.png`, fullPage: true });
  log("assist-panel-opens", true, {});

  const textarea = page.getByPlaceholder("Ask about your deadlines, pipeline, or drafts...");
  await textarea.fill("What deadlines do I have in the next 30 days?");
  await textarea.press("Enter");
  await page.waitForResponse((r) => r.url().endsWith("/api/assist") && r.request().method() === "POST", { timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT_DIR}/03-deadlines-answer.png`, fullPage: true });
  const deadlinesToolsUsed = assistJson1?.toolsUsed ?? [];
  log("deadlines-question-answered", !!assistJson1?.answer, { answerPreview: (assistJson1?.answer ?? "").slice(0, 200) });
  log("deadlines-toolsUsed-includes-upcoming_deadlines", deadlinesToolsUsed.includes("upcoming_deadlines"), { toolsUsed: deadlinesToolsUsed });

  await textarea.fill("What is a 990-PF?");
  await textarea.press("Enter");
  await page.waitForResponse((r) => r.url().endsWith("/api/assist") && r.request().method() === "POST", { timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT_DIR}/04-990pf-answer.png`, fullPage: true });
  const citations2 = assistJson2?.citations ?? [];
  const hasIrsCitation = citations2.some((c) => /irs\.gov/i.test(c.url ?? ""));
  log("990pf-question-answered", !!assistJson2?.answer, { answerPreview: (assistJson2?.answer ?? "").slice(0, 200) });
  log("990pf-has-irs-gov-citation", hasIrsCitation, { citations: citations2 });

  log("zero-console-errors-ff-session", consoleErrors.length === 0, { errors: consoleErrors.slice(0, 5) });
  await browser.close();

  // --- Part 2: isolation check as beta1@benavora-test.com ---
  const { data: betaProfiles } = await admin
    .from("profiles")
    .select("id, organization_id, role")
    .eq("email", "beta1@benavora-test.com");
  log("beta1-accounts-found", (betaProfiles ?? []).length > 0, { count: (betaProfiles ?? []).length, profiles: betaProfiles });

  const betaCookies = await magicLinkCookies("beta1@benavora-test.com");
  const isoContext = await (await chromium.launch({ headless: true })).newContext();
  await isoContext.addCookies(
    betaCookies.map((c) => ({ name: c.name, value: c.value, domain: COOKIE_DOMAIN, path: "/", secure: false, sameSite: "Lax" })),
  );
  const isoPage = await isoContext.newPage();
  // Establish the session in-browser first (cookies alone won't run middleware refresh), then call the API via page.evaluate so the request carries the real session cookies.
  await isoPage.goto(`${BASE_URL}/dashboard`, { waitUntil: "load", timeout: 45000 });
  await isoPage.waitForTimeout(1000);
  await isoPage.screenshot({ path: `${OUT_DIR}/05-beta1-dashboard.png`, fullPage: true });

  const isoResult = await isoPage.evaluate(async () => {
    const res = await fetch("/api/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "List my opportunities.", history: [] }),
    });
    const status = res.status;
    const json = await res.json().catch(() => null);
    return { status, json };
  });
  log("beta1-assist-call-status", isoResult.status === 200, { status: isoResult.status });

  const betaAnswer = isoResult.json?.answer ?? "";
  const leakedTitles = ffTitles.filter((title) => betaAnswer.toLowerCase().includes(title.toLowerCase()));
  log("isolation-no-faith-foundation-titles-in-beta1-answer", leakedTitles.length === 0, {
    leakedTitles,
    betaAnswerPreview: betaAnswer.slice(0, 300),
    betaToolsUsed: isoResult.json?.toolsUsed,
  });

  await isoContext.close();

  const failed = results.filter((r) => !r.ok);
  const summary = `knw-004 live verification - ${new Date().toISOString()}\n\n${results
    .map((r) => `[${r.ok ? "OK" : "FAIL"}] ${r.step} :: ${JSON.stringify(r.detail)}`)
    .join("\n")}\n\n${results.length - failed.length}/${results.length} checks passed\n`;
  writeFileSync("test-evidence/knowledge/knw-004-verify.txt", summary, "utf8");
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
