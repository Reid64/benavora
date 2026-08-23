// TS-03: Research agents verification. Real, foreground, synchronous requests
// against the live production deployment (benavora.com) as info@faithfoundationsf.org.
// Magic-link auth (service-role admin.generateLink + verifyOtp equivalent via
// @supabase/ssr setSession) mints a real session without touching the password.
// No process is backgrounded; every request is awaited before moving on.

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
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
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const PROD_URL = "https://www.benavora.com";
const ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const EMAIL = "info@faithfoundationsf.org";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function magicLinkLogin() {
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: EMAIL,
  });
  if (linkErr || !linkData) throw new Error("generateLink failed: " + linkErr?.message);

  const actionLink = linkData.properties.action_link;
  const verifyResp = await fetch(actionLink, { redirect: "manual" });
  const location = verifyResp.headers.get("location") || "";
  const hash = location.includes("#") ? location.split("#")[1] : "";
  const params = new URLSearchParams(hash);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (!access_token || !refresh_token) {
    throw new Error("Could not extract tokens from magic link redirect: " + location);
  }

  const setCookies = [];
  const authForCookies = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [],
      setAll: (list) => setCookies.push(...list),
    },
  });
  const { error: sessErr } = await authForCookies.auth.setSession({
    access_token,
    refresh_token,
  });
  if (sessErr) throw new Error("setSession failed: " + sessErr.message);

  return setCookies;
}

async function main() {
  mkdirSync("test-evidence/verification/ts-03", { recursive: true });

  console.log("=== STEP 1: magic-link login + real prod ids ===");
  const setCookies = await magicLinkLogin();
  console.log(`Login OK: ${setCookies.length} cookies minted for ${EMAIL}`);

  const cookieHeader = setCookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const oppRes = await admin
    .from("opportunities")
    .select("id, name, created_at")
    .eq("organization_id", ORG_ID)
    .order("created_at", { ascending: false })
    .limit(1);
  if (oppRes.error || !oppRes.data?.length) {
    throw new Error("Could not resolve a real opportunity id: " + oppRes.error?.message);
  }
  const opportunityId = oppRes.data[0].id;
  console.log("Top opportunity id:", opportunityId, "-", oppRes.data[0].name);

  const funderRes = await admin
    .from("funders")
    .select("id, name")
    .eq("organization_id", ORG_ID)
    .order("created_at", { ascending: false })
    .limit(1);
  const funderId = funderRes.data?.[0]?.id ?? null;
  console.log("Funder id:", funderId, funderRes.error?.message ?? "");

  const appRes = await admin
    .from("applications")
    .select("id, opportunity_id, stage")
    .eq("organization_id", ORG_ID)
    .order("created_at", { ascending: false })
    .limit(1);
  const applicationId = appRes.data?.[0]?.id ?? null;
  console.log("Application id:", applicationId, appRes.error?.message ?? "");

  console.log("\n=== STEP 2: synchronous authenticated requests ===");
  // NOTE: the task's literal body shapes ({opportunity_id}, {funder_id}) do not
  // match the real route contracts (read from source): eligibility/nofa-parser
  // take opportunityId (camelCase); funder-intel takes funderId; research takes
  // {agentType, profileId?} or {sources}, not opportunity_id at all;
  // success-probability takes applicationId (not opportunityId);
  // deadline-prediction/semantic-matching take optional filters, no id at all.
  // Real shapes are used below rather than the task's literal (incorrect) spec.
  const endpoints = [
    {
      name: "POST /api/agents/eligibility",
      method: "POST",
      path: "/api/agents/eligibility",
      body: { opportunityId },
    },
    {
      name: "POST /api/agents/research",
      method: "POST",
      path: "/api/agents/research",
      body: { agentType: "foundation_research" },
    },
    {
      name: "POST /api/agents/funder-intel",
      method: "POST",
      path: "/api/agents/funder-intel",
      body: funderId ? { funderId } : {},
    },
    {
      name: "POST /api/agents/foundation-finder",
      method: "POST",
      path: "/api/agents/foundation-finder",
      body: {},
    },
    {
      name: "POST /api/agents/nofa-parser",
      method: "POST",
      path: "/api/agents/nofa-parser",
      body: { opportunityId },
    },
    {
      name: "POST /api/agents/success-probability",
      method: "POST",
      path: "/api/agents/success-probability",
      body: applicationId ? { applicationId } : { applicationId: opportunityId },
    },
    {
      name: "POST /api/agents/deadline-prediction",
      method: "POST",
      path: "/api/agents/deadline-prediction",
      body: {},
    },
    {
      name: "POST /api/agents/semantic-matching",
      method: "POST",
      path: "/api/agents/semantic-matching",
      body: { topN: 5 },
    },
    {
      name: "GET /api/agents/registry",
      method: "GET",
      path: "/api/agents/registry",
      body: null,
    },
    {
      name: "POST /api/agents/morning-digest",
      method: "POST",
      path: "/api/agents/morning-digest",
      body: {},
    },
  ];

  const results = [];
  for (const ep of endpoints) {
    const start = Date.now();
    let status = null;
    let bodyText = "";
    let errorMsg = "";
    try {
      const resp = await fetch(PROD_URL + ep.path, {
        method: ep.method,
        headers: {
          Cookie: cookieHeader,
          ...(ep.method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        body: ep.method === "POST" ? JSON.stringify(ep.body ?? {}) : undefined,
      });
      status = resp.status;
      bodyText = await resp.text();
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    }
    const elapsedMs = Date.now() - start;
    const excerpt = bodyText.slice(0, 200);
    results.push({
      name: ep.name,
      status,
      elapsedMs,
      excerpt,
      empty: bodyText.trim().length === 0,
      error: errorMsg,
    });
    console.log(
      `[${status ?? "ERR"}] ${ep.name} (${elapsedMs}ms) :: ${errorMsg || excerpt.slice(0, 120)}`,
    );
  }

  console.log("\n=== STEP 3: screenshots ===");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies(
    setCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: "www.benavora.com",
      path: "/",
    })),
  );
  const page = await context.newPage();

  const pages = [
    { path: "/research", out: "test-evidence/verification/ts-03/01-research.png" },
    { path: "/funders", out: "test-evidence/verification/ts-03/02-funders.png" },
    { path: "/research/match", out: "test-evidence/verification/ts-03/03-match.png" },
  ];
  for (const p of pages) {
    await page.goto(PROD_URL + p.path, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: p.out, fullPage: true });
    console.log("Screenshot saved:", p.out, "from URL:", page.url());
  }

  await browser.close();

  writeFileSync(
    "test-evidence/verification/ts-03/results.json",
    JSON.stringify({ opportunityId, funderId, applicationId, results }, null, 2),
  );

  console.log("\n=== RESULTS TABLE ===");
  console.log(
    "| Endpoint | HTTP Status | Real Data | Response Time (ms) | Error |",
  );
  console.log("|---|---|---|---|---|");
  for (const r of results) {
    const realData = r.status && r.status < 300 && !r.empty ? "yes" : "no";
    console.log(
      `| ${r.name} | ${r.status ?? "ERR"} | ${realData} | ${r.elapsedMs} | ${r.error || (r.status >= 500 ? r.excerpt.replace(/\n/g, " ").slice(0, 80) : "")} |`,
    );
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
