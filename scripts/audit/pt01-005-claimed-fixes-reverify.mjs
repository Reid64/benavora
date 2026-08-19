// ============================================================================
// PT-01-005 -- re-verify the 5 commit-less "claimed fixes" from scratch
//
// Context: STATE_OF_THE_BUILD.md's 2026-08-18 session entry flagged that a
// prior request described "5 structural bug fixes" as already done --
// Integrations 404, queue-completion links, logo upload, Billing nav bug --
// with a fifth left unnamed -- but `git log` showed no commit matching any
// of them, and that session's own "quick source check... was not a full
// investigation." This script is that dedicated, from-scratch, live
// re-verification: no prior claim (fixed OR broken) is trusted without fresh
// evidence captured against a real authenticated session this run.
//
// The 5 items, as scoped by this task:
//   a. Integrations Configure  -- previously reported 404. The only real
//      "Configure" affordance on /settings/integrations is the State Grant
//      Portals card's Configure link (src/app/(dashboard)/settings/
//      integrations/page.tsx, configurePath="/settings/state-portals" --
//      confirmed by source read before writing this script: Grants.gov,
//      ProPublica, and SAM.gov cards pass no configurePath at all, so this
//      is the only candidate that could 404 under this label).
//   b. Grants.gov "Run Now"   -- previously reported broken. Real button,
//      real POST /api/agents/grants-gov (writer-role gated, maxDuration=300,
//      runs a live GrantsGovResearchAgent search). "Exercise it
//      (non-destructively)" per the task -- clicking Run Now is this
//      feature's own designed, sanctioned action (same real-usage pattern
//      as every other live agent-trigger session in this project's history),
//      not a destructive operation; captures the real POST response.
//   c. Scraping Targets link  -- previously reported broken. Settings
//      sub-nav entry -> /settings/scraping.
//   d. Branding logo upload   -- previously reported fixed. Verifies the
//      file-input control is present and wired to a real Supabase Storage
//      bucket target (source-confirmed as "org-branding", migration 140)
//      WITHOUT uploading anything to prod -- DOM presence/wiring check plus
//      a live (read-only) storage.listBuckets() call to confirm the bucket
//      itself really exists, never a file POST.
//   e. Billing nav            -- previously reported fixed. Settings
//      sub-nav entry -> /settings/billing.
//
// Auth: same admin-issued magic-link pattern as PT-01-002/003/004 -- no
// password touched.
//
// Every item gets one full-page screenshot into
// test-evidence/pt-01/claimed-fixes/, taken on the actually-resulting page
// (not the pre-click page), and one row in
// test-evidence/pt-01/claimed-fixes-reverify.json with prior_claim /
// current_state / evidence_file / verdict.
//
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
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "pt-01", "claimed-fixes");
const RESULTS_PATH = path.join(REPO_ROOT, "test-evidence", "pt-01", "claimed-fixes-reverify.json");

const NAV_TIMEOUT_MS = 30000;
const URL_CHANGE_POLL_TIMEOUT_MS = 15000;
const RUN_NOW_RESPONSE_TIMEOUT_MS = 120000; // maxDuration=300 server-side; audit caps its own wait

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
  if (/^\s*404\s*$/i.test(bodyText) || /this page could not be found/i.test(bodyText)) {
    return "Next.js 404 page";
  }
  return null;
}

async function pollForUrlChange(page, fromUrl, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (page.url() !== fromUrl) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

// Settle the page after a goto() BEFORE querying for elements, not just
// before screenshotting. Found live, this run: querying immediately after
// goto({waitUntil:"load"}) races this app's client-side hydration/async
// data-loading (e.g. isConfigured()/statePortalCount fetched on mount) --
// a standalone debug script that waited before querying found every
// element (Billing, Configure, Run Now x4, Scraping Targets) present on
// the exact same page the unwaited main-script query reported as absent.
// Without this, the script would silently misreport a real, present,
// working element as CONFIRMED-BROKEN.
async function settlePage(page) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
}

// Polls up to timeoutMs for any client-side "Loading..." spinner text inside
// <main> to clear, so a screenshot/evidence capture reflects the page's real
// settled state rather than an in-flight async fetch. Returns whether it
// cleared (false = still showing a loading indicator when the poll gave up --
// itself worth recording plainly, not silently swallowed either way).
async function waitForLoadingToClear(page, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const stillLoading = await page
      .evaluate(() => {
        const main = document.querySelector("main");
        const text = main ? main.innerText : "";
        return /loading[\s.]*(\.\.\.|…)?/i.test(text) && text.trim().length < 400;
      })
      .catch(() => false);
    if (!stillLoading) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

async function captureState(page, label) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const cleared = await waitForLoadingToClear(page, 15000);
  if (!cleared) {
    console.log(`  NOTE: ${label} still showed a loading indicator after 15s settle wait.`);
  }
  const bodyText = await page.evaluate(() => document.body.innerText || "").catch(() => "");
  const htmlLower = (await page.content().catch(() => "")).toLowerCase();
  const mainText = await page
    .evaluate(() => {
      const main = document.querySelector("main");
      return main ? main.innerText.trim() : "";
    })
    .catch(() => "");
  const errorBoundary = detectErrorBoundary(bodyText, htmlLower);
  const screenshotName = `${label}.png`;
  const screenshotPath = path.join(OUT_DIR, screenshotName);
  await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 10000 }).catch((err) => {
    console.warn(`  WARN: screenshot failed for ${label}: ${err.message}`);
  });
  return {
    url: page.url(),
    errorBoundary,
    stillLoadingAfterSettle: !cleared,
    mainTextLen: mainText.length,
    mainTextSnippet: mainText.slice(0, 300),
    screenshotFile: fs.existsSync(screenshotPath) ? `test-evidence/pt-01/claimed-fixes/${screenshotName}` : null,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const env = loadEnv();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const items = [];

  try {
    console.log(`Logging in as ${EMAIL} via admin-issued magic link...`);
    const admin = await loginAsFaith(env, context);
    const page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") console.log(`  [console.error] ${msg.text().slice(0, 200)}`);
    });

    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
    await settlePage(page);
    if (page.url().includes("/login")) {
      throw new Error("FATAL: authenticated session redirected to /login on /dashboard sanity check.");
    }
    console.log(`Session confirmed authenticated (landed on ${page.url()}).`);

    await page.goto(`${BASE_URL}/settings/integrations`, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
    await settlePage(page);
    console.log(`Loaded ${page.url()}`);

    // ---------------------------------------------------------------------
    // Item a: Integrations Configure (State Grant Portals card -> the only
    // real Configure affordance on this page)
    // ---------------------------------------------------------------------
    {
      console.log("\n--- Item a: Integrations Configure ---");
      const configureLink = page.locator('a:has-text("Configure")').first();
      const linkCount = await page.locator('a:has-text("Configure")').count();
      let current_state;
      let verdict;
      let capture = null;
      if (linkCount === 0) {
        current_state = "No 'Configure' link found anywhere in the rendered DOM of /settings/integrations.";
        verdict = "CONFIRMED-BROKEN";
        capture = await captureState(page, "a_integrations_configure_not_found");
      } else {
        const href = await configureLink.getAttribute("href").catch(() => null);
        const beforeUrl = page.url();
        await configureLink.scrollIntoViewIfNeeded().catch(() => {});
        await configureLink.click();
        const navigated = await pollForUrlChange(page, beforeUrl, URL_CHANGE_POLL_TIMEOUT_MS);
        capture = await captureState(page, "a_integrations_configure");
        if (!navigated) {
          current_state = `Click on Configure link (href="${href}") did not navigate away from ${beforeUrl} within ${URL_CHANGE_POLL_TIMEOUT_MS}ms.`;
          verdict = "CONFIRMED-BROKEN";
        } else if (capture.errorBoundary) {
          current_state = `Configure link (href="${href}") navigated to ${capture.url}, which rendered a "${capture.errorBoundary}".`;
          verdict = "CONFIRMED-BROKEN";
        } else if (capture.mainTextLen < 10) {
          current_state = `Configure link (href="${href}") navigated to ${capture.url}, but <main> rendered ${capture.mainTextLen} characters (effectively blank).`;
          verdict = "CONFIRMED-BROKEN";
        } else if (capture.stillLoadingAfterSettle) {
          current_state = `Configure link (href="${href}") navigated to ${capture.url} with real page chrome/content, but <main> still showed a loading indicator after a 15s settle wait -- not conclusively resolved.`;
          verdict = "UNVERIFIED";
        } else {
          current_state = `Configure link (href="${href}") navigated to ${capture.url} and rendered real content (${capture.mainTextLen} chars in <main>), no error boundary. Real, live, confirmed working today -- not a 404.`;
          verdict = "CONFIRMED-OK";
        }
      }
      items.push({
        item: "Integrations Configure",
        prior_claim: "Reported broken: 404",
        current_state,
        evidence_file: capture ? capture.screenshotFile : null,
        verdict,
        detail: capture,
      });
      // Return to the integrations page for the next items.
      await page.goto(`${BASE_URL}/settings/integrations`, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
      await settlePage(page);
    }

    // ---------------------------------------------------------------------
    // Item b: Grants.gov "Run Now" -- exercised for real (non-destructive:
    // this is the button's own designed, sanctioned action)
    // ---------------------------------------------------------------------
    {
      console.log("\n--- Item b: Grants.gov Run Now ---");
      // Locate the Grants.gov card by its heading text, then its own Run Now button.
      const card = page.locator("text=Grants.gov").locator("xpath=ancestor::div[.//button[contains(., 'Run Now')]]").first();
      let runNowBtn = card.locator('button:has-text("Run Now")').first();
      let btnCount = await runNowBtn.count().catch(() => 0);
      if (btnCount === 0) {
        // Fallback: some heading/card structures don't satisfy the xpath ancestor
        // search cleanly -- fall back to the first Run Now button on the page,
        // which per the source (Section 2: Platform-Managed) is Grants.gov's,
        // confirmed by DOM order matching source order.
        runNowBtn = page.locator('button:has-text("Run Now")').first();
        btnCount = await runNowBtn.count().catch(() => 0);
      }

      let current_state;
      let verdict;
      let capture = null;
      let responseInfo = null;

      if (btnCount === 0) {
        current_state = "No 'Run Now' button found anywhere in the rendered DOM of /settings/integrations.";
        verdict = "CONFIRMED-BROKEN";
        capture = await captureState(page, "b_grants_gov_run_now_not_found");
      } else {
        const responsePromise = page
          .waitForResponse(
            (resp) => resp.url().includes("/api/agents/grants-gov") && resp.request().method() === "POST",
            { timeout: RUN_NOW_RESPONSE_TIMEOUT_MS }
          )
          .then(async (resp) => {
            let bodySnippet = null;
            try {
              const json = await resp.json();
              bodySnippet = JSON.stringify(json).slice(0, 500);
            } catch {
              bodySnippet = "(non-JSON or unreadable body)";
            }
            return { status: resp.status(), ok: resp.ok(), bodySnippet };
          })
          .catch((err) => ({ timedOut: true, message: err.message }));

        await runNowBtn.scrollIntoViewIfNeeded().catch(() => {});
        console.log("  Clicking Run Now -- waiting for POST /api/agents/grants-gov response (up to 120s)...");
        await runNowBtn.click();
        responseInfo = await responsePromise;
        await page.waitForTimeout(1000);
        capture = await captureState(page, "b_grants_gov_run_now");

        if (responseInfo.timedOut) {
          current_state = `Clicked Run Now; the real POST /api/agents/grants-gov request did not resolve within ${RUN_NOW_RESPONSE_TIMEOUT_MS}ms (route has maxDuration=300 server-side, so this is a real observed slow/hanging response, not necessarily a permanent failure). Playwright wait error: ${responseInfo.message}`;
          verdict = "UNVERIFIED";
        } else if (responseInfo.ok) {
          current_state = `Clicked Run Now; real POST /api/agents/grants-gov returned HTTP ${responseInfo.status} (ok). Response body: ${responseInfo.bodySnippet}. Genuinely working, not broken.`;
          verdict = "CONFIRMED-OK";
        } else {
          current_state = `Clicked Run Now; real POST /api/agents/grants-gov returned HTTP ${responseInfo.status} (error). Response body: ${responseInfo.bodySnippet}.`;
          verdict = "CONFIRMED-BROKEN";
        }
      }

      items.push({
        item: 'Grants.gov "Run Now"',
        prior_claim: "Reported broken",
        current_state,
        evidence_file: capture ? capture.screenshotFile : null,
        verdict,
        detail: { responseInfo, page: capture },
      });
    }

    // ---------------------------------------------------------------------
    // Item c: Scraping Targets link (settings sub-nav)
    // ---------------------------------------------------------------------
    {
      console.log("\n--- Item c: Scraping Targets link ---");
      await page.goto(`${BASE_URL}/settings/integrations`, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
      await settlePage(page);
      const link = page.locator('a:has-text("Scraping Targets")').first();
      const count = await link.count().catch(() => 0);
      let current_state;
      let verdict;
      let capture = null;
      if (count === 0) {
        current_state = "No 'Scraping Targets' link found in the settings sub-nav.";
        verdict = "CONFIRMED-BROKEN";
        capture = await captureState(page, "c_scraping_targets_not_found");
      } else {
        const href = await link.getAttribute("href").catch(() => null);
        const beforeUrl = page.url();
        await link.click();
        const navigated = await pollForUrlChange(page, beforeUrl, URL_CHANGE_POLL_TIMEOUT_MS);
        capture = await captureState(page, "c_scraping_targets");
        if (!navigated) {
          current_state = `Click on Scraping Targets link (href="${href}") did not navigate away from ${beforeUrl} within ${URL_CHANGE_POLL_TIMEOUT_MS}ms.`;
          verdict = "CONFIRMED-BROKEN";
        } else if (capture.errorBoundary) {
          current_state = `Scraping Targets link navigated to ${capture.url}, which rendered a "${capture.errorBoundary}".`;
          verdict = "CONFIRMED-BROKEN";
        } else if (capture.mainTextLen < 10) {
          current_state = `Scraping Targets link navigated to ${capture.url}, but <main> rendered ${capture.mainTextLen} characters (effectively blank).`;
          verdict = "CONFIRMED-BROKEN";
        } else if (capture.stillLoadingAfterSettle) {
          current_state = `Scraping Targets link navigated to ${capture.url} with real page chrome/content, but <main> still showed a loading indicator after a 15s settle wait -- not conclusively resolved.`;
          verdict = "UNVERIFIED";
        } else {
          current_state = `Scraping Targets link navigated to ${capture.url} and rendered real content (${capture.mainTextLen} chars in <main>), no error boundary.`;
          verdict = "CONFIRMED-OK";
        }
      }
      items.push({
        item: "Scraping Targets link",
        prior_claim: "Reported broken",
        current_state,
        evidence_file: capture ? capture.screenshotFile : null,
        verdict,
        detail: capture,
      });
    }

    // ---------------------------------------------------------------------
    // Item d: Branding logo upload -- DOM wiring check only, no real upload.
    // Cross-checked with a live (read-only) storage.listBuckets() call.
    // ---------------------------------------------------------------------
    {
      console.log("\n--- Item d: Branding logo upload ---");
      await page.goto(`${BASE_URL}/settings/branding`, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
      await settlePage(page);
      const fileInputCount = await page.locator('input[type="file"]').count().catch(() => 0);
      const accept = fileInputCount > 0
        ? await page.locator('input[type="file"]').first().getAttribute("accept").catch(() => null)
        : null;

      const capture = await captureState(page, "d_branding_logo_upload");

      // Read-only live check: does the real "org-branding" storage bucket
      // this control uploads to (confirmed via source read, migration 140)
      // actually exist? Never uploads/writes anything.
      let bucketCheck = { checked: false };
      try {
        const { data: buckets, error } = await admin.storage.listBuckets();
        if (error) {
          bucketCheck = { checked: true, error: error.message };
        } else {
          const found = (buckets || []).find((b) => b.name === "org-branding");
          bucketCheck = { checked: true, bucketExists: !!found, bucketPublic: found ? found.public : null };
        }
      } catch (err) {
        bucketCheck = { checked: true, error: err.message };
      }

      let current_state;
      let verdict;
      if (capture.errorBoundary) {
        current_state = `/settings/branding rendered a "${capture.errorBoundary}" -- could not evaluate the logo upload control.`;
        verdict = "CONFIRMED-BROKEN";
      } else if (fileInputCount === 0) {
        current_state = `/settings/branding rendered real content, but no <input type="file"> element was found in the DOM -- the logo upload control is not present/wired.`;
        verdict = "CONFIRMED-BROKEN";
      } else {
        const bucketNote = bucketCheck.error
          ? `storage.listBuckets() check failed: ${bucketCheck.error}`
          : bucketCheck.bucketExists
            ? `Live storage.listBuckets() confirms the real target bucket "org-branding" (public=${bucketCheck.bucketPublic}) exists.`
            : `Live storage.listBuckets() found NO bucket named "org-branding" -- the upload control is present but points at a nonexistent bucket, meaning any real upload would fail.`;
        current_state = `/settings/branding rendered real content with a real <input type="file" accept="${accept}"> present in the DOM (source-confirmed at src/app/(dashboard)/settings/branding/page.tsx, uploads via supabase.storage.from("org-branding").upload(...)). No file was uploaded (read-only verification per task instruction). ${bucketNote}`;
        verdict = bucketCheck.bucketExists ? "CONFIRMED-OK" : "CONFIRMED-BROKEN";
      }

      items.push({
        item: "Branding logo upload",
        prior_claim: "Reported fixed",
        current_state,
        evidence_file: capture.screenshotFile,
        verdict,
        detail: { fileInputCount, accept, bucketCheck, page: capture },
      });
    }

    // ---------------------------------------------------------------------
    // Item e: Billing nav (settings sub-nav)
    // ---------------------------------------------------------------------
    {
      console.log("\n--- Item e: Billing nav ---");
      await page.goto(`${BASE_URL}/settings/integrations`, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
      await settlePage(page);
      const link = page.locator('a:has-text("Billing")').first();
      const count = await link.count().catch(() => 0);
      let current_state;
      let verdict;
      let capture = null;
      if (count === 0) {
        current_state = "No 'Billing' link found in the settings sub-nav.";
        verdict = "CONFIRMED-BROKEN";
        capture = await captureState(page, "e_billing_nav_not_found");
      } else {
        const href = await link.getAttribute("href").catch(() => null);
        const beforeUrl = page.url();
        await link.click();
        const navigated = await pollForUrlChange(page, beforeUrl, URL_CHANGE_POLL_TIMEOUT_MS);
        capture = await captureState(page, "e_billing_nav");
        if (!navigated) {
          current_state = `Click on Billing link (href="${href}") did not navigate away from ${beforeUrl} within ${URL_CHANGE_POLL_TIMEOUT_MS}ms.`;
          verdict = "CONFIRMED-BROKEN";
        } else if (capture.errorBoundary) {
          current_state = `Billing link navigated to ${capture.url}, which rendered a "${capture.errorBoundary}".`;
          verdict = "CONFIRMED-BROKEN";
        } else if (capture.mainTextLen < 10) {
          current_state = `Billing link navigated to ${capture.url}, but <main> rendered ${capture.mainTextLen} characters (effectively blank).`;
          verdict = "CONFIRMED-BROKEN";
        } else if (capture.stillLoadingAfterSettle) {
          current_state = `Billing link navigated to ${capture.url} with real page chrome/content, but <main> still showed a loading indicator after a 15s settle wait -- not conclusively resolved.`;
          verdict = "UNVERIFIED";
        } else {
          current_state = `Billing link navigated to ${capture.url} and rendered real content (${capture.mainTextLen} chars in <main>), no error boundary. Resolves correctly.`;
          verdict = "CONFIRMED-OK";
        }
      }
      items.push({
        item: "Billing nav",
        prior_claim: "Reported fixed",
        current_state,
        evidence_file: capture ? capture.screenshotFile : null,
        verdict,
        detail: capture,
      });
    }

    const summary = {
      total: items.length,
      confirmedOk: items.filter((i) => i.verdict === "CONFIRMED-OK").length,
      confirmedBroken: items.filter((i) => i.verdict === "CONFIRMED-BROKEN").length,
      unverified: items.filter((i) => i.verdict === "UNVERIFIED").length,
    };

    const output = {
      generatedAt: new Date().toISOString(),
      authenticatedAs: EMAIL,
      baseUrl: BASE_URL,
      taskContext:
        "Re-verification of 5 'claimed fixes' flagged in STATE_OF_THE_BUILD.md's 2026-08-18 session as having no matching commit in git history. No prior claim (broken or fixed) was trusted -- every item below was driven live against a real authenticated session this run.",
      summary,
      items,
    };

    fs.writeFileSync(RESULTS_PATH, JSON.stringify(output, null, 2), "utf8");
    console.log(`\nWrote ${RESULTS_PATH}`);
    console.log(
      `Summary: ${summary.total} items, ${summary.confirmedOk} CONFIRMED-OK, ${summary.confirmedBroken} CONFIRMED-BROKEN, ${summary.unverified} UNVERIFIED.`
    );
    for (const it of items) {
      console.log(`  [${it.verdict}] ${it.item}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("PT-01-005 FATAL:", err);
  process.exit(1);
});
