// ============================================================================
// WGR-017 / WGR-012 fix verification
//
// (Not "PT-01-006" -- that phase label is already taken by
// scripts/audit/verify-pt01-006.mjs, the audit program's own Phase-01
// consolidation checkpoint. This is a standalone remediation-verification
// script, run once to confirm the fix below actually closes the gap.)
//
// ProspectDetail.tsx unguarded enrichment.giving_focus_areas.length /
// enrichment.in_kind_history_signals.length (lines 574/587) threw
// "Cannot read properties of undefined (reading 'length')" for prospects
// whose linked donor_discovery_directory row has an incomplete enrichment
// jsonb shape (missing those fields). WGR-017 confirmed ~4-5 of 5 real
// prospects sampled had this incomplete shape and blank-rendered
// (mainTextLen: 57, chrome only).
//
// WGR-017's own named ids (716a1077-.../deb11e9d-.../etc, from
// test-evidence/pt-01/element-graph.json) no longer resolve against a
// direct id lookup -- this org's donor_discovery_prospects table has grown
// to 133,812 rows since that session, well past PostgREST's 1000-row page
// cap. Rather than trust a stale id list, this resolves a fresh, live set
// of prospects (starting with WGR-012's original id, still a real row) and
// independently re-confirms each one still carries the same
// incomplete-enrichment shape before treating it as a valid regression-test
// candidate, then authenticated-navigates to at least 3 of them and asserts
// the page now renders real content instead of the blank shell.
//
// Auth: same admin-issued magic-link pattern as PT-01-002.
// ASCII only. Node 20 compatible.
// ============================================================================

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

const REPO_ROOT = process.cwd();
const BASE_URL = process.env.PT01_BASE_URL || "http://localhost:3000";
const EMAIL = "info@faithfoundationsf.org";
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "pt-01", "wgr-017-fix");
const NAV_TIMEOUT_MS = 30000;
const MIN_CONTENT_CHARS = 200;

// WGR-017's register row names 5 partial prospect ids as of its own session
// (716a1077-.../deb11e9d-.../38fa36b4-.../28f27b2e-.../b045b765-...). This
// org's donor_discovery_prospects table has since grown to 133,812 rows
// (confirmed live, 2026-08-19) -- well past PostgREST's 1000-row default
// page cap -- and none of those 5 prefixes resolve against a direct id
// lookup today, so they are no longer reachable by id prefix alone. Rather
// than trust a stale id list, this resolves a fresh, real, live-queried set
// of prospects and independently confirms each one still carries the same
// incomplete-enrichment shape WGR-012/WGR-017 described (giving_focus_areas
// and in_kind_history_signals both absent) before treating it as a valid
// regression-test candidate. This is a stronger check than reusing the old
// ids verbatim would have been: it re-proves the underlying data gap is
// still live today, not just replaying a historical finding.
const ONE_CONFIRMED_ID = "19ec603e-bb4d-4e10-9482-e864dc85f511"; // WGR-012's original id, checked first

function loadEnv() {
  const raw = fs.readFileSync(path.join(REPO_ROOT, ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

async function loginAsFaith(env, context) {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: EMAIL,
  });
  if (linkErr) throw new Error(`generateLink failed: ${linkErr.message}`);
  const verifyResp = await fetch(linkData.properties.action_link, { redirect: "manual" });
  const hash = (verifyResp.headers.get("location") || "").split("#")[1];
  if (!hash) throw new Error("magic link did not return a redirect with an auth fragment");
  const params = new URLSearchParams(hash);
  const { createServerClient } = await import("@supabase/ssr");
  const setCookies = [];
  const authForCookies = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
  });
  const { error: sessErr } = await authForCookies.auth.setSession({
    access_token: params.get("access_token"),
    refresh_token: params.get("refresh_token"),
  });
  if (sessErr) throw new Error(`setSession failed: ${sessErr.message}`);
  await context.addCookies(
    setCookies.map((c) => ({ name: c.name, value: c.value, domain: "localhost", path: "/" }))
  );
  return admin;
}

function detectErrorBoundary(bodyText, htmlLower) {
  if (htmlLower.includes("nextjs-portal") && htmlLower.includes("runtime error")) {
    return "Next.js dev error overlay (Unhandled Runtime Error)";
  }
  if (/application error: a client-side exception has occurred/i.test(bodyText)) {
    return "React client-side exception boundary";
  }
  if (/unhandled runtime error/i.test(bodyText)) {
    return "Unhandled Runtime Error text present";
  }
  return null;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const env = loadEnv();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Resolve full uuids for the candidate prefixes and confirm the
  // incomplete-enrichment shape still holds (giving_focus_areas AND
  // in_kind_history_signals both absent from the enrichment jsonb).
  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("email", EMAIL)
    .maybeSingle();
  if (profErr || !profile) throw new Error(`could not resolve org for ${EMAIL}: ${profErr && profErr.message}`);
  const orgId = profile.organization_id;

  function toCandidate(row) {
    const enrichment = row.directory ? row.directory.enrichment : null;
    const incompleteShape =
      !!enrichment &&
      enrichment.giving_focus_areas === undefined &&
      enrichment.in_kind_history_signals === undefined;
    return {
      found: true,
      prospectId: row.id,
      directoryId: row.directory ? row.directory.id : null,
      legalName: row.directory ? row.directory.legal_name : null,
      enrichmentKeys: enrichment ? Object.keys(enrichment) : null,
      incompleteShapeConfirmed: incompleteShape,
    };
  }

  const resolved = [];

  // Check WGR-012's original id first -- it is still a real row in this
  // table, so this doubles as a direct re-confirmation of that finding.
  const { data: originalRow } = await admin
    .from("donor_discovery_prospects")
    .select("id, directory:donor_discovery_directory(id, legal_name, enrichment)")
    .eq("id", ONE_CONFIRMED_ID)
    .maybeSingle();
  if (originalRow) resolved.push(toCandidate(originalRow));

  // Fill out to a sample of candidates via a live, org-scoped page query
  // (well within the 1000-row PostgREST cap for a single page).
  const { data: page, error: pageErr } = await admin
    .from("donor_discovery_prospects")
    .select("id, directory:donor_discovery_directory(id, legal_name, enrichment)")
    .eq("organization_id", orgId)
    .not("directory", "is", null)
    .limit(50);
  if (pageErr) throw new Error(`prospect page query failed: ${pageErr.message}`);
  for (const row of page || []) {
    if (row.id === ONE_CONFIRMED_ID) continue;
    resolved.push(toCandidate(row));
  }

  const testable = resolved.filter((r) => r.found && r.incompleteShapeConfirmed).slice(0, 3);
  console.log(
    "WGR-017-FIX: resolved candidates (first 8 shown):",
    JSON.stringify(resolved.slice(0, 8), null, 2)
  );
  console.log(
    `WGR-017-FIX: ${resolved.filter((r) => r.incompleteShapeConfirmed).length}/${resolved.length} sampled prospects confirmed with the incomplete enrichment shape.`
  );
  if (testable.length < 3) {
    console.error(`WGR-017-FIX FATAL: only ${testable.length}/3 candidates confirmed with the incomplete enrichment shape.`);
    process.exit(1);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await loginAsFaith(env, context);

  const sanityPage = await context.newPage();
  const sanity = await sanityPage.goto(BASE_URL + "/dashboard", { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  const sanityPath = sanityPage.url().replace(BASE_URL, "").split("?")[0];
  if (sanityPath === "/login") {
    console.error("WGR-017-FIX FATAL: authenticated session redirected to /login on /dashboard sanity check.");
    await browser.close();
    process.exit(1);
  }
  console.log(`WGR-017-FIX: session sanity check OK (${sanity ? sanity.status() : "?"} on /dashboard)`);
  await sanityPage.close();

  const results = [];
  for (const cand of testable) {
    const url = BASE_URL + `/donor-discovery/prospects/${cand.prospectId}`;
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 500));
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(`[uncaught] ${String(err && err.message ? err.message : err).slice(0, 500)}`);
    });

    const result = {
      prospectId: cand.prospectId,
      directoryId: cand.directoryId,
      legalName: cand.legalName,
      enrichmentKeys: cand.enrichmentKeys,
      url,
      httpStatus: null,
      errorBoundaryInDom: false,
      errorBoundaryDetail: null,
      mainTextLength: 0,
      contentPreview: "",
      consoleErrors: [],
      navigationError: null,
    };

    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      result.httpStatus = response ? response.status() : null;
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);

      const bodyText = await page.evaluate(() => (document.body ? document.body.innerText : ""));
      const htmlLower = (await page.content()).toLowerCase();
      const mainText = await page.evaluate(() => {
        const main = document.querySelector("main");
        return main ? main.innerText : document.body ? document.body.innerText : "";
      });
      const trimmed = mainText.trim();
      result.mainTextLength = trimmed.length;
      result.contentPreview = trimmed.slice(0, 300).replace(/\s+/g, " ");

      const errDetail = detectErrorBoundary(bodyText, htmlLower);
      if (errDetail) {
        result.errorBoundaryInDom = true;
        result.errorBoundaryDetail = errDetail;
      }
    } catch (err) {
      result.navigationError = `navigation failed: ${String(err.message || err).split("\n")[0]}`;
    } finally {
      result.consoleErrors = consoleErrors.slice(0, 20);
    }

    const safeName = cand.prospectId.slice(0, 8);
    const shotPath = path.join(OUT_DIR, `after_${safeName}.png`);
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    result.screenshot = path.relative(REPO_ROOT, shotPath).replace(/\\/g, "/");

    result.pass =
      !result.navigationError &&
      !result.errorBoundaryInDom &&
      result.httpStatus === 200 &&
      result.mainTextLength > MIN_CONTENT_CHARS;

    results.push(result);
    await page.close().catch(() => {});
    console.log(
      `  ${cand.prospectId}: httpStatus=${result.httpStatus} mainTextLength=${result.mainTextLength} ` +
        `errorBoundary=${result.errorBoundaryInDom} pass=${result.pass}`
    );
  }

  await browser.close();

  const allPass = results.every((r) => r.pass) && results.length >= 3;
  const outPath = path.join(OUT_DIR, "wgr-017-fix-verify.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        candidatesResolved: resolved,
        minContentChars: MIN_CONTENT_CHARS,
        results,
        allPass,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`\nWGR-017-FIX ${allPass ? "PASS" : "FAIL"}: ${results.filter((r) => r.pass).length}/${results.length} prospects render real content.`);
  console.log(`Evidence written to ${path.relative(REPO_ROOT, outPath)}`);
  if (!allPass) process.exit(1);
}

main().catch((err) => {
  console.error("WGR-017-FIX FATAL:", err);
  process.exit(1);
});
