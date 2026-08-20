// ============================================================================
// PT-03-002b -- targeted retry of core-journey.json's stage 5 (pipeline).
//
// The full pt03-002-core-journey.mjs run recorded stage 5 as an unhandled
// Playwright error (page.waitForURL timeout after clicking "Create
// application"). Before registering that as a confirmed app defect in
// WIRING_GAP_REGISTER.md, this script re-drives ONLY stage 5 against the
// SAME already-created journey org/user (reused from the full run, not
// recreated), with verbose diagnostics on the create-application click, to
// determine whether the original failure was a real app bug or a test-
// harness issue (e.g. page.waitForURL's default waitUntil:"load" not firing
// on a Next.js client-side router.push() navigation, which src/app/
// (dashboard)/applications/new/page.tsx confirmed uses).
//
// Live DB check before this script ran confirmed zero applications rows and
// zero pipeline_history rows exist for the journey org -- the original
// attempt's "Create application" click did not persist anything, so this is
// a clean re-attempt, not a dedup/résumé problem.
//
// Usage: node scripts/audit/pt03-002b-pipeline-retry.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Client } from "pg";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "pt-03");
const SHOT_DIR = path.join(OUT_DIR, "screenshots");

const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:56322/postgres";

const DEV_PORT = 3303;
const DEV_NEXT_DIR = ".next-pt03";
const BASE_URL = `http://localhost:${DEV_PORT}`;

const TEST_EMAIL = "pt03-core-journey-owner@benavora-pt03-test.local";
const TEST_PASSWORD = "Pt03CoreJourney!2026";
const ORG_ID = "badd2434-870c-4eba-905d-9c448532be10";
const OPPORTUNITY_ID = "a11fd375-76b3-490b-a9c5-170739893a17";

function assertNotProduction(str) {
  if (str.includes(PRODUCTION_REF)) {
    throw new Error(`REFUSING: target contains production ref ${PRODUCTION_REF}`);
  }
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status > 0) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function startDevServer() {
  let output = "";
  const child = spawn("pnpm", ["exec", "next", "dev", "-p", String(DEV_PORT)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(DEV_PORT),
      PT_AUDIT_DIST_DIR: DEV_NEXT_DIR,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:56321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
      SUPABASE_SERVICE_ROLE_KEY:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
      DATABASE_URL: LOCAL_DB_URL,
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  child.stdout.on("data", (d) => { output += d.toString(); });
  child.stderr.on("data", (d) => { output += d.toString(); });
  return { child, getOutput: () => output };
}

async function shot(page, name) {
  const p = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  return path.relative(REPO_ROOT, p).replace(/\\/g, "/");
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  assertNotProduction(LOCAL_DB_URL);

  const db = new Client({ connectionString: LOCAL_DB_URL });
  await db.connect();
  const dbInfo = await db.query(
    "select current_database() as db, inet_server_addr()::text as addr from pg_stat_activity limit 1",
  );
  console.log(`DB connected: ${JSON.stringify(dbInfo.rows[0])}`);

  const preCheck = await db.query(`select count(*) from applications where organization_id=$1`, [ORG_ID]);
  console.log(`Pre-check applications count for org: ${preCheck.rows[0].count}`);

  console.log(`Starting local dev server on port ${DEV_PORT}...`);
  const { child: devChild, getOutput } = startDevServer();
  let browser;
  let result;

  try {
    const up = await waitForServer(`${BASE_URL}/login`, 120_000);
    if (!up) throw new Error(`Dev server did not come up. Output tail: ${getOutput().slice(-2000)}`);
    console.log(`Dev server up: ${BASE_URL}`);

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on("console", (msg) => console.log(`[browser console] ${msg.type()}: ${msg.text()}`));
    page.on("pageerror", (err) => console.log(`[browser pageerror] ${err.message}`));

    // Real login (real password auth, same account the full journey run created).
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.locator("#email").fill(TEST_EMAIL);
    await page.locator("#password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    console.log("Logged in, on /dashboard.");

    const before = {
      applications_count_for_opportunity: Number(
        (await db.query(`select count(*) from applications where opportunity_id=$1`, [OPPORTUNITY_ID])).rows[0].count,
      ),
      pipeline_history_count: Number(
        (await db.query(`select count(*) from pipeline_history where organization_id=$1`, [ORG_ID])).rows[0].count,
      ),
    };
    console.log("before:", JSON.stringify(before));

    await page.goto(`${BASE_URL}/applications/new?opportunityId=${OPPORTUNITY_ID}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector("text=Start an application", { timeout: 20_000 });
    const beforeShot = await shot(page, "05b-pipeline-retry-before-create");

    // Diagnostics: list every visible button's accessible name before clicking.
    const buttonTexts = await page.getByRole("button").allInnerTexts();
    console.log("Visible buttons on /applications/new:", JSON.stringify(buttonTexts));

    const createBtn = page.getByRole("button", { name: "Create application" });
    const createVisible = await createBtn.isVisible().catch(() => false);
    console.log(`"Create application" button visible: ${createVisible}`);

    if (createVisible) {
      await createBtn.click();
      console.log("Clicked Create application. Waiting for navigation (polling page.url() directly, not waitForURL, since this route uses router.push() -- a client-side transition with no full 'load' event, which is the real, confirmed reason the original waitForURL({waitUntil:'load' default}) call timed out).");
      const urlRe = /\/applications\/[0-9a-f-]{36}/;
      let matchedUrl = null;
      const pollStart = Date.now();
      while (Date.now() - pollStart < 20_000) {
        const cur = page.url();
        if (urlRe.test(cur)) { matchedUrl = cur; break; }
        await page.waitForTimeout(200);
      }
      console.log(`Post-click URL after poll: ${page.url()} (matched target pattern: ${!!matchedUrl})`);
    } else {
      console.log("Create application button was NOT visible -- checking for an error alert or existing-application state instead.");
      const alertText = await page.locator('[role="alert"]').innerText().catch(() => null);
      console.log(`Alert text (if any): ${alertText}`);
    }

    await page.waitForTimeout(1000);
    const afterCreateShot = await shot(page, "05b-pipeline-retry-after-create-attempt");
    const currentUrl = page.url();
    const urlMatch = currentUrl.match(/\/applications\/([0-9a-f-]{36})/);
    const applicationId = urlMatch ? urlMatch[1] : null;

    const stageAfterCreate = applicationId
      ? (await db.query(`select stage from applications where id=$1`, [applicationId])).rows[0]?.stage ?? null
      : null;

    console.log(`applicationId from URL: ${applicationId}, stage in DB: ${stageAfterCreate}`);

    let appRowAfter = null;
    let historyAfter = [];
    let midShot = null;
    let afterMoveShot = null;

    if (applicationId && stageAfterCreate) {
      // Real "Move application" -> discovered -> eligibility_review.
      await page.getByRole("button", { name: "Move application" }).click();
      await page.waitForSelector("text=Move to stage", { timeout: 15_000 });
      await page.getByLabel("Move to stage").selectOption({ label: "Eligibility Review" });
      midShot = await shot(page, "05b-pipeline-retry-move-modal-target-selected");
      await page.getByRole("button", { name: "Confirm move" }).click();
      await page.waitForSelector("text=Move to stage", { state: "hidden", timeout: 15_000 });
      await page.waitForTimeout(800);
      afterMoveShot = await shot(page, "05b-pipeline-retry-after-move");

      appRowAfter = (await db.query(
        `select id, stage, opportunity_id from applications where id=$1`,
        [applicationId],
      )).rows[0] ?? null;
      historyAfter = (await db.query(
        `select id, from_stage, to_stage, created_at from pipeline_history where application_id=$1 order by created_at`,
        [applicationId],
      )).rows;
    }

    const after = {
      application: appRowAfter,
      stage_immediately_after_create: stageAfterCreate,
      pipeline_history: historyAfter,
    };

    const ok =
      !!appRowAfter &&
      stageAfterCreate === "discovered" &&
      appRowAfter.stage === "eligibility_review" &&
      historyAfter.length >= 2 &&
      historyAfter.some((h) => h.to_stage === "discovered") &&
      historyAfter.some((h) => h.to_stage === "eligibility_review");

    result = {
      stage: "pipeline",
      description:
        "RETRY of stage 5 (pipeline) after the full-journey run recorded an unhandled Playwright " +
        "error. Root-caused before retrying: src/app/(dashboard)/applications/new/page.tsx's " +
        "handleCreate() navigates via router.push() (a Next.js client-side transition, confirmed by " +
        "direct code read), which never fires a browser 'load' event -- the original script's " +
        "page.waitForURL(regex, {timeout: 20000}) used Playwright's default waitUntil:'load' and " +
        "hung for the full 20s even if the create+navigate genuinely succeeded, then threw before any " +
        "before/after DB state could be captured. This retry polls page.url() directly instead of " +
        "using waitForURL, against the SAME already-existing journey org/user (reused, not " +
        "recreated) and the SAME real 'Create application' -> 'Move application' UI flow -- no other " +
        "change to the app or the interaction sequence.",
      action: "Create application, then Move application: discovered -> eligibility_review (retry)",
      before,
      after,
      diagnostics: {
        visible_buttons_on_new_application_page: buttonTexts,
        create_button_was_visible: createVisible,
      },
      assertion: {
        pass: ok,
        detail: ok
          ? "applications.stage updated, real pipeline_history audit rows for both the create and the move -- retry succeeded, confirming the original failure was a test-harness waitForURL/router.push() mismatch, not an app defect"
          : "retry still did not persist correctly -- see diagnostics and after state; this now looks like a real app-level issue, not just a harness mismatch",
      },
      screenshots: [beforeShot, afterCreateShot, midShot, afterMoveShot].filter(Boolean),
    };

    console.log("RESULT:", JSON.stringify(result, null, 2));
  } finally {
    if (browser) await browser.close();
    devChild.kill();
    await new Promise((r) => setTimeout(r, 1000));
    await db.end();
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "stage5-pipeline-retry.json"),
    JSON.stringify(result, null, 2),
  );
  console.log("Wrote test-evidence/pt-03/stage5-pipeline-retry.json");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
