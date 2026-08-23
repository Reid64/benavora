// TS-02: Draft generator end-to-end verification (2026-08-23). WGR-129
// regression check - proves POST /api/ai/draft persists a real draft_versions
// row before returning 200. Auth: magic-link as info@faithfoundationsf.org
// (established pattern, see scripts/audit/ts-01-autoapply-e2e-2026-08-23.mjs).
// All steps run foreground/synchronous, no backgrounding.
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
const OUT_DIR = "test-evidence/verification/ts-02";
mkdirSync(OUT_DIR, { recursive: true });

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
// Top-scored opportunity for this org (real column is opportunities.match_percentage /
// eligibility_score - there is no probability_score column live on this table).
const OPPORTUNITY_ID = "8851652c-2def-4bc3-8428-308c4f23fd0b";
const OPPORTUNITY_NAME = "Texas Community Development Block Grant - Housing";
// Real applications row already linked to this opportunity (found via REST lookup
// before this run) - reused rather than fabricated, matching the app's own
// "reuse the opportunity's most recent application, or create one" logic.
const APPLICATION_ID = "61c21595-9aea-4c45-a82e-3c7ace99bc73";
const TEMPLATE_TYPE = "grant_narrative";

const report = {
  timestamp: null,
  opportunityId: OPPORTUNITY_ID,
  applicationId: APPLICATION_ID,
  step3: null,
  step4_wgr129: null,
  step5: null,
  step6_humanize: null,
  step6_review: null,
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

async function queryDraftVersions() {
  const endpoint =
    `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/draft_versions` +
    `?opportunity_id=eq.${OPPORTUNITY_ID}&select=id,version_number,humanization_status,created_at,application_id` +
    `&order=created_at.desc&limit=5`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  return { status: res.status, rows: await res.json() };
}

async function main() {
  report.timestamp = new Date().toISOString();

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
    // ---- STEP 2: /draft-generator home ----
    console.log("=== STEP 2: /draft-generator ===");
    const page2 = await context.newPage();
    wirePageErrorTracking(page2);
    await page2.goto(`${BASE_URL}/draft-generator`, { timeout: 45000 });
    await page2.waitForLoadState("networkidle", { timeout: 30000 }).catch((e) =>
      console.log("[warn] networkidle timeout on /draft-generator:", String(e)),
    );
    await page2.screenshot({ path: `${OUT_DIR}/01-draft-home.png`, fullPage: true });
    console.log("[ok] screenshot 01-draft-home.png saved");
    await page2.close();

    // ---- STEP 3: POST /api/ai/draft, foreground, synchronous ----
    console.log("=== STEP 3: POST /api/ai/draft ===");
    const t0 = Date.now();
    const draftResp = await fetch(`${BASE_URL}/api/ai/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ opportunityId: OPPORTUNITY_ID, templateType: TEMPLATE_TYPE }),
      signal: AbortSignal.timeout(290000),
    });
    const draftElapsedMs = Date.now() - t0;
    const draftBody = await draftResp.json().catch(() => ({}));
    const contentLength = typeof draftBody.content === "string" ? draftBody.content.length : 0;
    report.step3 = {
      httpStatus: draftResp.status,
      elapsedMs: draftElapsedMs,
      contentLength,
      confidenceScore: draftBody.confidenceScore ?? null,
      savedVersionId: draftBody.savedVersion?.id ?? null,
      savedVersionNumber: draftBody.savedVersion?.versionNumber ?? null,
    };
    console.log(
      `[draft] status=${draftResp.status} elapsedMs=${draftElapsedMs} contentLength=${contentLength} savedVersion.id=${draftBody.savedVersion?.id}`,
    );
    if (draftResp.status !== 200) {
      report.notes.push({ step: "draft", ok: false, status: draftResp.status, body: draftBody });
      throw new Error(`Draft generation failed: ${draftResp.status} ${JSON.stringify(draftBody)}`);
    }

    // ---- STEP 4: WGR-129 regression check - draft_versions must be >= 1 ----
    console.log("=== STEP 4: draft_versions WGR-129 check ===");
    const dv = await queryDraftVersions();
    const dvCount = Array.isArray(dv.rows) ? dv.rows.length : 0;
    const newestRow = Array.isArray(dv.rows) && dv.rows.length > 0 ? dv.rows[0] : null;
    const newestMatchesResponse = Boolean(
      newestRow && draftBody.savedVersion?.id && newestRow.id === draftBody.savedVersion.id,
    );
    report.step4_wgr129 = {
      draftVersionsCountForOpportunity: dvCount,
      newestRowId: newestRow?.id ?? null,
      newestRowMatchesApiResponse: newestMatchesResponse,
      status: dvCount >= 1 && newestMatchesResponse ? "RESOLVED-confirmed" : "REGRESSED",
    };
    console.log(
      `[WGR-129] draft_versions rows for opportunity=${dvCount} newestMatchesApiResponse=${newestMatchesResponse} -> ${report.step4_wgr129.status}`,
    );

    // ---- STEP 5: /draft-generator/[id] (real application id) ----
    console.log("=== STEP 5: /draft-generator/[id] ===");
    const page5 = await context.newPage();
    wirePageErrorTracking(page5);
    await page5.goto(`${BASE_URL}/draft-generator/${APPLICATION_ID}`, { timeout: 45000 });
    await page5.waitForLoadState("networkidle", { timeout: 30000 }).catch((e) =>
      console.log("[warn] networkidle timeout on /draft-generator/[id]:", String(e)),
    );
    await page5.screenshot({ path: `${OUT_DIR}/02-draft-view.png`, fullPage: true });
    const viewText = await page5.evaluate(() => document.body.innerText).catch(() => "");
    const hasOppName = viewText.includes(OPPORTUNITY_NAME) || viewText.includes("Texas Community Development");
    const wordCountVisible = viewText.trim().split(/\s+/).length;
    report.step5 = {
      opportunityNameVisible: hasOppName,
      visiblePageWordCount: wordCountVisible,
      nonZero: wordCountVisible > 0 && hasOppName,
    };
    console.log(`[view] opportunityNameVisible=${hasOppName} visiblePageWordCount=${wordCountVisible}`);
    await page5.close();

    // ---- STEP 6a: POST /api/drafts/[id]/humanize ----
    console.log("=== STEP 6a: POST /api/drafts/[id]/humanize ===");
    const dvBeforeHumanize = await queryDraftVersions();
    const countBefore = Array.isArray(dvBeforeHumanize.rows) ? dvBeforeHumanize.rows.length : 0;
    const humanizeResp = await fetch(`${BASE_URL}/api/drafts/${APPLICATION_ID}/humanize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(290000),
    });
    const humanizeBody = await humanizeResp.json().catch(() => ({}));
    const dvAfterHumanize = await queryDraftVersions();
    const countAfter = Array.isArray(dvAfterHumanize.rows) ? dvAfterHumanize.rows.length : 0;
    report.step6_humanize = {
      httpStatus: humanizeResp.status,
      humanizationScore: humanizeBody.humanizationScore ?? null,
      aiTellsRemovedCount: Array.isArray(humanizeBody.aiTellsRemoved) ? humanizeBody.aiTellsRemoved.length : null,
      draftVersionsCountBefore: countBefore,
      draftVersionsCountAfter: countAfter,
      newDraftVersionsRowCreated: countAfter > countBefore,
    };
    console.log(
      `[humanize] status=${humanizeResp.status} score=${humanizeBody.humanizationScore} dv_before=${countBefore} dv_after=${countAfter} newRowCreated=${countAfter > countBefore}`,
    );
    if (countAfter === countBefore) {
      report.notes.push({
        step: "humanize-draft-versions-check",
        note:
          "POST /api/drafts/[id]/humanize does NOT insert a new draft_versions row by design - " +
          "it updates applications.draft_content + applications.metadata (humanization_score/breakdown) " +
          "in place (see src/app/api/drafts/[id]/humanize/route.ts). Task STEP 6 expected a new " +
          "draft_versions row; real behavior is an in-place update, not a new version. Not treated as a " +
          "defect without further scoping - flagging for the register.",
      });
    }

    // ---- STEP 6b: POST /api/ai/review ----
    console.log("=== STEP 6b: POST /api/ai/review ===");
    const reviewResp = await fetch(`${BASE_URL}/api/ai/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ applicationId: APPLICATION_ID }),
      signal: AbortSignal.timeout(290000),
    });
    const reviewBody = await reviewResp.json().catch(() => ({}));
    report.step6_review = {
      httpStatus: reviewResp.status,
      hasScore: reviewBody.score != null || reviewBody.overallScore != null,
      hasFeedback: Boolean(reviewBody.feedback || reviewBody.sections || reviewBody.review),
      bodyKeys: Object.keys(reviewBody ?? {}),
    };
    console.log(`[review] status=${reviewResp.status} bodyKeys=${JSON.stringify(report.step6_review.bodyKeys)}`);

    // ---- STEP 7: /draft-generator/queue + /draft-generator/autonomous ----
    console.log("=== STEP 7: /draft-generator/queue + /draft-generator/autonomous ===");
    const page7a = await context.newPage();
    wirePageErrorTracking(page7a);
    await page7a.goto(`${BASE_URL}/draft-generator/queue`, { timeout: 45000 });
    await page7a.waitForLoadState("networkidle", { timeout: 30000 }).catch((e) =>
      console.log("[warn] networkidle timeout on /draft-generator/queue:", String(e)),
    );
    await page7a.screenshot({ path: `${OUT_DIR}/03-queue.png`, fullPage: true });
    await page7a.close();

    const page7b = await context.newPage();
    wirePageErrorTracking(page7b);
    await page7b.goto(`${BASE_URL}/draft-generator/autonomous`, { timeout: 45000 });
    await page7b.waitForLoadState("networkidle", { timeout: 30000 }).catch((e) =>
      console.log("[warn] networkidle timeout on /draft-generator/autonomous:", String(e)),
    );
    await page7b.screenshot({ path: `${OUT_DIR}/04-autonomous.png`, fullPage: true });
    await page7b.close();
  } finally {
    await browser.close();
  }

  report.consoleErrorCount = consoleErrors;
  writeFileSync(`${OUT_DIR}/ts-02-results.json`, JSON.stringify(report, null, 2));
  console.log("\n=== TS-02 FINAL REPORT ===");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
