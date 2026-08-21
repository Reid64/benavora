// Live production smoke test (2026-08-21) against https://www.benavora.com,
// magic-link auth as info@faithfoundationsf.org, verifying:
//   (a) SSRF guard blocks an internal-target URL through WGR-108's real HTTP
//       route (POST /api/intelligence/ingest). WGR-109/WGR-110's guarded
//       fetch calls are NOT reachable via any direct HTTP route (WGR-109
//       fires only from a real AutoApply queue event inside the worker
//       process; WGR-110 fires only from worker/queue-processor.ts's browser
//       navigation, also worker-only) -- both are instead verified by
//       invoking the exact same safeFetch()/assertUrlSafe() primitive that
//       gates them, imported straight from the deployed source tree, against
//       an internal target, honestly labeled as a code-level check rather
//       than an HTTP-route check.
//   (b) POST /api/ai/draft persists a real draft_versions row (WGR-129 fix).
//   (c) /donor-discovery/prospects/[id] renders non-blank for 3 sampled ids
//       (WGR-017 fix).
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
const OUT_DIR = "test-evidence/remediation/prod-deploy-2026-08-21";
mkdirSync(OUT_DIR, { recursive: true });

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const OPPORTUNITY_ID = "6b89eebf-5773-4cb3-a193-651955f0f69d";
const PROSPECT_IDS = [
  "19ec603e-bb4d-4e10-9482-e864dc85f511",
  "16934ed5-1d76-4cfa-9b3a-f087cabfd7ef",
  "aff22886-83e0-4fab-99eb-d5f0c380d23d",
];

const results = { timestamp: null, deployment: "dpl_695pVGDQ7TbKzNUMGpj2Mp48cG1C", checks: [] };
function log(step, ok, detail) {
  results.checks.push({ step, ok, detail });
  console.log(`[${ok ? "OK" : "FAIL"}] ${step} :: ${JSON.stringify(detail)}`);
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

async function main() {
  results.timestamp = new Date().toISOString();
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
  const cookieHeader = (await context.cookies())
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  // ---- (a) SSRF guard: WGR-108 real HTTP route ----
  const internalTargets = [
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:22/",
    "http://localhost:5432/",
  ];
  for (const target of internalTargets) {
    const resp = await fetch(`${BASE_URL}/api/intelligence/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ source: "url", url: target }),
    });
    const body = await resp.json().catch(() => ({}));
    log(
      "ssrf-wgr108-intelligence-ingest",
      resp.status === 422 && body.code === "url_blocked",
      { target, status: resp.status, body },
    );
  }

  // WGR-109/WGR-110: no direct HTTP route fires the guarded fetch/navigation
  // synchronously (both only fire from real worker-side events). Verified
  // instead by invoking the exact deployed guard primitive directly.
  try {
    const { assertUrlSafe } = await import("../../src/lib/security/ssrf-guard.ts");
    for (const target of internalTargets) {
      try {
        await assertUrlSafe(target);
        log("ssrf-wgr109-110-guard-primitive", false, { target, blocked: false, note: "expected throw, none occurred" });
      } catch (err) {
        log("ssrf-wgr109-110-guard-primitive", true, { target, blocked: true, error: String(err?.message || err) });
      }
    }
  } catch (err) {
    log("ssrf-wgr109-110-guard-primitive", false, { error: "could not import ssrf-guard.ts directly: " + String(err) });
  }

  // ---- (b) POST /api/ai/draft, then count draft_versions rows ----
  const draftResp = await fetch(`${BASE_URL}/api/ai/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ opportunityId: OPPORTUNITY_ID, templateType: "grant_narrative" }),
    signal: AbortSignal.timeout(280000),
  }).catch((err) => ({ __fetchError: String(err) }));

  if (draftResp.__fetchError) {
    log("draft-generation-http", false, { error: draftResp.__fetchError });
  } else {
    const draftBody = await draftResp.json().catch(() => ({}));
    const draftId = draftBody?.savedVersion?.id ?? null;
    log("draft-generation-http", draftResp.status === 200, { status: draftResp.status, hasSavedVersion: !!draftBody.savedVersion, draftId });

    if (draftId) {
      const { data: rows, error } = await admin
        .from("draft_versions")
        .select("id, created_at")
        .eq("id", draftId);
      log("draft-versions-row-count", !error && (rows?.length ?? 0) >= 1, { draftId, rows, error });
    } else {
      log("draft-versions-row-count", false, { note: "no savedVersion.id in response body", draftBody });
    }
  }

  // ---- (c) /donor-discovery/prospects/[id] non-blank for 3 sampled ids ----
  for (const id of PROSPECT_IDS) {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/donor-discovery/prospects/${id}`, { waitUntil: "load", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const mainText = await page.evaluate(() => document.querySelector("main")?.textContent?.trim() ?? "").catch(() => "");
    await page.screenshot({ path: `${OUT_DIR}/prospect-${id}.png` }).catch(() => {});
    log("donor-discovery-prospect-nonblank", mainText.length > 50, { id, mainTextLen: mainText.length });
    await page.close();
  }

  await browser.close();

  writeFileSync(`${OUT_DIR}/smoke-results.json`, JSON.stringify(results, null, 2));
  console.log("\n=== Summary ===");
  const failed = results.checks.filter((c) => !c.ok);
  console.log(`${results.checks.length - failed.length}/${results.checks.length} passed`);
  if (failed.length) {
    console.log("FAILED:", JSON.stringify(failed, null, 2));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
