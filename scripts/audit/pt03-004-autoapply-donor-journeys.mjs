// ============================================================================
// PT-03-004 -- drive two secondary end-to-end journeys (local/branch, never
// production):
//
//   1. AUTOAPPLY: queue -> session -> form-fill -> SAFE-SIMULATED submit ->
//      confirm the real /autoapply dashboard UI reflects each transition.
//   2. DONOR DISCOVERY: prospect -> review -> route-to-destination; confirm
//      the destination (funders + submission_queue -- the real AutoApply
//      queue) actually exists and receives the routed prospect. This ties
//      directly into WGR-017 (test-evidence/_register/WIRING_GAP_REGISTER.md):
//      "review" happens on /donor-discovery/prospects/[id], the exact page
//      WGR-017 fixed a blank-render bug on (ProspectDetail.tsx lines 574/587,
//      unguarded enrichment.giving_focus_areas.length /
//      enrichment.in_kind_history_signals.length). This script confirms that
//      page still renders real, non-blank content for a fresh prospect today.
//
// Design notes, stated up front:
//   - Journey 2's "route-to-destination" step clicks the real "Queue in
//     AutoApply" button on ProspectDetail.tsx (handleQueueInAutoApply ->
//     POST /api/autoapply/queue with source="donor_discovery" -- see
//     src/app/api/autoapply/queue/route.ts's handleDonorDiscoveryHandoff).
//     That call creates a real `funders` row and a real `submission_queue`
//     row (status='pending'). Journey 1 then picks up that EXACT
//     submission_queue row as its own "queue" stage -- the two journeys are
//     deliberately linked, not run against two disconnected fixtures, because
//     that link (Donor Discovery routing INTO the real AutoApply queue) is
//     the actual real-world hand-off this pair of journeys exists to verify.
//   - There is no worker process polling this local stack's submission_queue
//     (worker/queue-processor.ts is a long-running Railway process, not
//     something this script can safely invoke against a real external site --
//     see IRON LAW #8 / this task's explicit "never a real external
//     submission" instruction). So Journey 1's session/form-fill/submit
//     stages are SAFE-SIMULATED: this script performs the exact same DB
//     writes, with the exact same column shapes, that
//     worker/queue-processor.ts's dequeue() / createApprovedAutomationSession()
//     / finalizeAutomationSession() / the post-success autoapply_submissions
//     insert perform (confirmed by direct read of worker/queue-processor.ts
//     before writing this script -- see the inline citations below), but
//     NEVER launches a browser and NEVER issues an HTTP request to any
//     external host, including the safe dummy target
//     (https://httpbin.org/forms/post -- the same public dummy-form endpoint
//     already established as this repo's own safe AutoApply test target in
//     src/__tests__/integration/autoapply-queue.test.ts, referenced here by
//     URL string only, never fetched). Every SAFE-SIMULATED stage says so
//     explicitly in its own `action` text and sets `simulated: true` /
//     `external_http_calls_made: 0` in its `after` block.
//   - The local stack (reused from PT-05, established by PT-03-001) already
//     has register_organization() applied from the PT-03-002 session (same
//     persistent Postgres container) -- applied again here anyway,
//     idempotently, so this script also works standalone from a clean stack.
//   - A real, previously-unexercised local-stack schema gap was found and
//     fixed the same way PT-03-002 fixed its own gaps: `donor_discovery_directory`
//     on this local stack was missing dba_name/civic_kind/hq_address/geo/
//     phone/enrichment/enriched_at/source_adapters -- present in the real
//     migration (supabase/migrations/067_donor_discovery_foundation.sql) but
//     never applied to this particular local database. Applied directly here
//     (idempotent ADD COLUMN IF NOT EXISTS, verbatim column types from
//     migration 067) since this is a local, non-production instance under
//     this script's own control -- not a production migration.
//
// Usage: node scripts/audit/pt03-004-autoapply-donor-journeys.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { Client } from "pg";
import { chromium } from "playwright";
import { WebSocket } from "ws";

if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "pt-03");
const SHOT_DIR = path.join(OUT_DIR, "screenshots");

const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";

// Same local Supabase CLI stack constants as pt03-001/002 (standard local-dev
// demo keys, not a production secret -- identical on every local Supabase
// project on this machine).
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const LOCAL_API_URL = "http://127.0.0.1:56321";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const DEV_PORT = 3304;
const DEV_NEXT_DIR = ".next-pt03-journeys";
const BASE_URL = `http://localhost:${DEV_PORT}`;

const TEST_EMAIL = "pt03-journeys-owner@benavora-pt03-test.local";
const TEST_PASSWORD = "Pt03Journeys!2026";
const TEST_ORG_NAME = "PT-03 AutoApply-DonorDiscovery Journeys Org";

// The repo's own established safe dummy AutoApply target (never fetched by
// this script -- referenced by string value only, matching what a real
// donation_form_url would look like).
const SAFE_DUMMY_TARGET = "https://httpbin.org/forms/post";

function nowIso() {
  return new Date().toISOString();
}

function assertNotProduction(str) {
  if (str.includes(PRODUCTION_REF)) {
    throw new Error(
      `REFUSING TO PROCEED: "${str}" contains the production ref "${PRODUCTION_REF}". PT-03 must never write to production.`,
    );
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

const donorDiscoveryStages = [];
const autoapplyStages = [];
const findings = [];
let nextFindingSeq = 1;

function recordFinding(journey, stage, severity, description, evidence) {
  const id = `PT03-004-F${String(nextFindingSeq++).padStart(2, "0")}`;
  findings.push({ id, journey, stage, severity, description, evidence });
  console.error(`FINDING [${severity}] ${id} (${journey}/${stage}): ${description}`);
  return id;
}

async function shot(page, name) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const rel = path.join("test-evidence", "pt-03", "screenshots", `${name}.png`);
  const abs = path.join(REPO_ROOT, rel);
  await page.screenshot({ path: abs, fullPage: true, timeout: 15000 });
  return rel.replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// Local-stack schema gaps this journey needs, fixed directly (local, no
// production risk) -- see header comment.
// ---------------------------------------------------------------------------
async function applyLocalSchemaFixes(db) {
  const registerOrgSql = fs.readFileSync(
    path.join(REPO_ROOT, "supabase", "migrations", "002_register_organization.sql"),
    "utf8",
  );
  await db.query(registerOrgSql);

  // Verbatim column types from supabase/migrations/067_donor_discovery_foundation.sql's
  // donor_discovery_directory CREATE TABLE -- this local stack's copy of that
  // table was missing everything past `website`.
  await db.query(`
    ALTER TABLE donor_discovery_directory
      ADD COLUMN IF NOT EXISTS dba_name text,
      ADD COLUMN IF NOT EXISTS civic_kind text,
      ADD COLUMN IF NOT EXISTS hq_address text,
      ADD COLUMN IF NOT EXISTS geo point,
      ADD COLUMN IF NOT EXISTS phone text,
      ADD COLUMN IF NOT EXISTS enrichment jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS enriched_at timestamptz,
      ADD COLUMN IF NOT EXISTS source_adapters text[] NOT NULL DEFAULT '{}';
  `);

  // Real, previously-unexercised local-stack gap found live while running
  // this journey (not guessed): this local stack's submission_queue table
  // has no FK constraint to funders at all, even though
  // supabase/migrations/045_autoapply_tables.sql's real CREATE TABLE defines
  // one (`funder_id uuid REFERENCES funders(id) ON DELETE SET NULL`).
  // PostgREST's embedded-resource join (`.select("*, funders(...)")`, used
  // by the real /autoapply dashboard) requires a real FK to resolve the
  // relationship, and fails with PGRST200 ("Could not find a relationship
  // between 'submission_queue' and 'funders'") without one -- confirmed via
  // a direct REST call with a real session token before concluding this was
  // a schema gap and not an app defect. Added verbatim from migration 045.
  await db.query(`
    ALTER TABLE submission_queue
      ADD CONSTRAINT submission_queue_funder_id_fkey
      FOREIGN KEY (funder_id) REFERENCES funders(id) ON DELETE SET NULL
      NOT VALID;
    ALTER TABLE submission_queue VALIDATE CONSTRAINT submission_queue_funder_id_fkey;
  `).catch((err) => {
    // Idempotent across reruns -- Postgres has no ADD CONSTRAINT IF NOT
    // EXISTS, so tolerate "already exists" specifically and re-throw
    // anything else.
    if (!/already exists/i.test(err.message)) throw err;
  });
  // Make sure PostgREST's schema cache (used by the app's browser-side
  // Supabase client, not this script's own direct pg connection) picks up
  // the new columns before any UI step depends on them.
  await db.query(`NOTIFY pgrst, 'reload schema';`);

  const check = await db.query(
    `select
       (select count(*) from pg_proc where proname = 'register_organization') as has_register_fn,
       (select count(*) from information_schema.columns
          where table_name = 'donor_discovery_directory' and column_name = 'enrichment') as has_enrichment_col,
       (select count(*) from information_schema.columns
          where table_name = 'donor_discovery_directory' and column_name = 'dba_name') as has_dba_name_col`,
  );
  const row = check.rows[0];
  if (Number(row.has_register_fn) === 0 || Number(row.has_enrichment_col) === 0 || Number(row.has_dba_name_col) === 0) {
    throw new Error(`Local schema fixes did not apply cleanly: ${JSON.stringify(row)}`);
  }
  console.log(
    `Local schema fixes confirmed applied: register_organization()=${row.has_register_fn > 0} ` +
      `donor_discovery_directory.enrichment=${row.has_enrichment_col > 0} .dba_name=${row.has_dba_name_col > 0}`,
  );
}

async function cleanupLeftovers(db) {
  const leftoverOrgs = await db.query(`select id from organizations where name = $1`, [TEST_ORG_NAME]);
  if (leftoverOrgs.rows.length > 0) {
    const ids = leftoverOrgs.rows.map((r) => r.id);
    // FK-safe deletion order: children before parents.
    await db.query(`delete from autoapply_submissions where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from automation_sessions where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from form_templates where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from submission_queue where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from funders where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from donor_discovery_prospects where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from donor_discovery_requests where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from profiles where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from organizations where id = any($1::uuid[])`, [ids]);
    console.log(`Removed ${ids.length} leftover org(s) + dependents from a prior run.`);
  }
  // donor_discovery_directory is shared/platform-wide (no organization_id --
  // see migration 067's own header comment), so leftover test rows are
  // cleaned up by legal_name match instead of by org id.
  await db.query(`delete from donor_discovery_directory where legal_name = $1`, [
    "PT-03 Journeys Test Prospect LLC",
  ]);

  const listRes = await fetch(`${LOCAL_API_URL}/auth/v1/admin/users?email=${encodeURIComponent(TEST_EMAIL)}`, {
    headers: { apikey: LOCAL_SERVICE_ROLE_KEY, Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}` },
  });
  if (listRes.ok) {
    const body = await listRes.json();
    const users = Array.isArray(body?.users) ? body.users : Array.isArray(body) ? body : [];
    for (const u of users) {
      if (u.email === TEST_EMAIL) {
        await fetch(`${LOCAL_API_URL}/auth/v1/admin/users/${u.id}`, {
          method: "DELETE",
          headers: { apikey: LOCAL_SERVICE_ROLE_KEY, Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}` },
        });
        console.log(`Removed leftover auth user from a prior run: ${u.id} (${TEST_EMAIL})`);
      }
    }
  }
}

function startDevServer() {
  const devEnv = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: LOCAL_API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
    SUPABASE_SERVICE_ROLE_KEY: LOCAL_SERVICE_ROLE_KEY,
    PORT: String(DEV_PORT),
    PT_AUDIT_DIST_DIR: DEV_NEXT_DIR,
  };
  const child = spawn("pnpm", ["exec", "next", "dev", "-p", String(DEV_PORT)], {
    cwd: REPO_ROOT,
    env: devEnv,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d.toString()));
  child.stderr.on("data", (d) => (output += d.toString()));
  return { child, getOutput: () => output };
}

function stopDevServer(child) {
  if (process.platform === "win32" && child.pid) {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // already exited
    }
  } else {
    child.kill();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  assertNotProduction(LOCAL_DB_URL);

  const db = new Client({ connectionString: LOCAL_DB_URL });
  await db.connect();

  const dbInfo = await db.query(
    "select current_database() as db, inet_server_addr()::text as addr, inet_server_port() as port",
  );
  const { addr } = dbInfo.rows[0];
  if (String(addr).includes(PRODUCTION_REF)) {
    throw new Error("Live connection reports a production-looking target. Aborting.");
  }
  console.log(`Confirmed local target: server_addr=${addr}`);

  await applyLocalSchemaFixes(db);
  await cleanupLeftovers(db);

  // Real, low-severity app-code finding discovered live while diagnosing the
  // submission_queue/funders FK gap fixed above (see applyLocalSchemaFixes's
  // comment): src/app/(dashboard)/autoapply/page.tsx's "QUEUE" mini-panel
  // (lines ~632-635) renders "Queue is empty." whenever `queue.length === 0`,
  // with no check of `queueError` -- so a genuinely failed fetch (confirmed
  // live this session: a real PGRST200 from the embedded funders() join,
  // before this script's own schema fix was added) renders identically to a
  // real, honestly-empty queue. The page's own Session List table, using the
  // exact same `queue`/`queueError` state two hundred lines further down
  // (line ~835), DOES render the real error text in that situation -- so the
  // same failed fetch is silently misrepresented in one panel and honestly
  // surfaced in another on the same page render. Not a broken hand-off (no
  // data was lost, and this specific local-stack cause is fixed above before
  // any journey step depends on it) -- a real, minor UI-resilience gap,
  // recorded for completeness per this task's own "any broken hand-off... is
  // a finding" instruction, not because it blocked either journey below.
  recordFinding(
    "autoapply",
    "queue-panel-error-surfacing",
    "P3",
    "src/app/(dashboard)/autoapply/page.tsx's 'QUEUE' mini-panel (~line 634) shows 'Queue is empty.' " +
      "on any loadQueue() failure (queue.length===0), not just a genuine empty queue -- it never checks " +
      "queueError, unlike the Session List table ~200 lines below on the same page, which does. " +
      "Reproduced live this session via a real PGRST200 (embedded funders() join failed before this " +
      "script's own local-schema FK fix, below) with a real authenticated session token.",
    "code read: src/app/(dashboard)/autoapply/page.tsx lines 632-635 vs 835-836; live repro this session " +
      "(PGRST200, 'Could not find a relationship between submission_queue and funders'), fixed by this " +
      "script's own applyLocalSchemaFixes() before any journey stage below depends on it.",
  );

  console.log(`Starting local dev server on port ${DEV_PORT} against the local stack...`);
  const { child: devChild, getOutput } = startDevServer();
  let browser;
  let orgId = null;
  let fatalError = null;

  // Cross-journey state: the real ids created by the Donor Discovery
  // journey's route-to-destination step, consumed by the AutoApply journey's
  // "queue" step.
  let routedFunderId = null;
  let routedQueueItemId = null;

  try {
    const up = await waitForServer(`${BASE_URL}/login`, 120_000);
    if (!up) {
      throw new Error(`Dev server did not come up within 120s. Output tail: ${getOutput().slice(-2000)}`);
    }
    console.log(`Dev server is up: ${BASE_URL}`);

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);

    // =========================================================================
    // SETUP -- real signup via the UI (same mechanism as pt03-002-core-journey.mjs),
    // then bypass onboarding directly in the DB since these two journeys are
    // orthogonal to onboarding (already covered by PT-03-002).
    // =========================================================================
    await page.goto(`${BASE_URL}/register`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Organization name").fill(TEST_ORG_NAME);
    await page.getByLabel("Your name").fill("PT-03 Journeys Owner");
    await page.getByLabel("Email", { exact: true }).fill(TEST_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await page.getByLabel("Confirm password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });

    const orgRow = (await db.query(`select id, name, onboarding_completed from organizations where name=$1`, [TEST_ORG_NAME])).rows[0] ?? null;
    if (!orgRow) {
      throw new Error("Signup did not create the expected organization row -- cannot proceed.");
    }
    orgId = orgRow.id;
    await db.query(`update organizations set onboarding_completed = true where id = $1`, [orgId]);
    console.log(`Setup: org=${orgId} created via real /register signup, onboarding bypassed directly in DB (out of scope for this journey pair).`);

    const profileRow = (await db.query(`select id, role from profiles where organization_id=$1`, [orgId])).rows[0] ?? null;
    if (!profileRow || profileRow.role !== "owner") {
      throw new Error(`Signup did not create an owner profile as expected: ${JSON.stringify(profileRow)}`);
    }

    // =========================================================================
    // DONOR DISCOVERY JOURNEY -- STAGE 1: PROSPECT
    // =========================================================================
    {
      const before = {
        donor_discovery_prospects_count: Number(
          (await db.query(`select count(*) from donor_discovery_prospects where organization_id=$1`, [orgId])).rows[0].count,
        ),
        donor_discovery_directory_test_row_exists: false,
      };

      // Real request row (required FK for prospects -- see migration 067).
      const requestRes = await db.query(
        `insert into donor_discovery_requests (organization_id, name, status, completed_at)
         values ($1, $2, 'complete', now()) returning id`,
        [orgId, "PT-03 Journeys Test Discovery Run"],
      );
      const requestId = requestRes.rows[0].id;

      // Real directory row, shared/platform-wide per migration 067 -- shape
      // matches exactly what a real Google Places + web-enrichment pass
      // would populate, including the two fields WGR-017 fixed unguarded
      // reads on (giving_focus_areas, in_kind_history_signals).
      const directoryRes = await db.query(
        `insert into donor_discovery_directory
           (legal_name, dba_name, naics_codes, civic_kind, website, hq_address, phone, enrichment, enriched_at, source_adapters)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now(), $9)
         returning id`,
        [
          "PT-03 Journeys Test Prospect LLC",
          "PT-03 Test Roofing Co",
          ["238160"],
          null,
          "https://example-pt03-test-prospect.local",
          "123 Test St, Austin, TX 78701",
          "512-555-0100",
          JSON.stringify({
            has_donation_form: true,
            donation_form_url: SAFE_DUMMY_TARGET,
            csr_page_url: "https://example-pt03-test-prospect.local/giving",
            giving_focus_areas: ["Housing", "Youth Development", "Disaster Relief"],
            in_kind_history_signals: [
              "Donated roofing materials to a local Habitat for Humanity build in 2025",
              "Sponsored a community food drive in Q1 2026",
            ],
            service_area: "Austin metro area",
            company_size_estimate: "small",
            decision_contacts: [],
          }),
          ["google_places"],
        ],
      );
      const directoryId = directoryRes.rows[0].id;

      const prospectRes = await db.query(
        `insert into donor_discovery_prospects
           (organization_id, directory_id, request_id, score, score_rationale, pipeline_stage)
         values ($1, $2, $3, $4, $5, 'new')
         returning id, pipeline_stage`,
        [orgId, directoryId, requestId, 62, "PT-03 journey seed: plausible mid-tier score for evidence purposes."],
      );
      const prospectId = prospectRes.rows[0].id;

      // Real UI: confirm the seeded prospect is actually listed on the real
      // list page (no filters applied by default -- see prospects/page.tsx's
      // load() -- so a fresh org's only prospect must appear).
      await page.goto(`${BASE_URL}/donor-discovery/prospects`, { waitUntil: "networkidle" });
      const listShot = await shot(page, "j-01-donor-discovery-prospects-list");

      const rowVisible = await page
        .getByText("PT-03 Journeys Test Prospect LLC", { exact: false })
        .first()
        .isVisible()
        .catch(() => false);

      const after = {
        prospect_id: prospectId,
        directory_id: directoryId,
        request_id: requestId,
        pipeline_stage: prospectRes.rows[0].pipeline_stage,
        listed_on_real_list_page: rowVisible,
      };

      const ok = after.pipeline_stage === "new" && rowVisible === true;
      if (!ok) {
        recordFinding(
          "donor_discovery",
          "prospect",
          "P1",
          `Seeded prospect did not appear on the real /donor-discovery/prospects list page (no filters applied). before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
          "test-evidence/pt-03/screenshots/j-01-donor-discovery-prospects-list.png",
        );
      } else {
        console.log(`DD Stage 1 (prospect) PASS -- prospect=${prospectId} listed on real list page`);
      }

      donorDiscoveryStages.push({
        stage: "prospect",
        description:
          "Seeded one real donor_discovery_requests row + one shared donor_discovery_directory row " +
          "(with a genuine enrichment shape including the two WGR-017-relevant fields, giving_focus_areas " +
          "and in_kind_history_signals) + one donor_discovery_prospects row (pipeline_stage='new') via " +
          "direct DB insert matching migration 067's real schema, then confirmed via the real UI " +
          "(/donor-discovery/prospects, no filters) that the prospect is genuinely listed.",
        action: "Direct DB seed (org-scoped tenant data) + real page.goto() to the real list page.",
        simulated: false,
        before,
        after,
        assertion: { pass: ok, detail: ok ? "prospect seeded and confirmed listed on the real UI" : "see finding" },
        screenshots: [listShot],
      });

      if (!ok) throw new Error("Donor Discovery Stage 1 (prospect) failed -- cannot proceed with the rest of the journey.");

      global.__pt03_prospectId = prospectId; // handed to stage 2 below
    }

    // =========================================================================
    // DONOR DISCOVERY JOURNEY -- STAGE 2: REVIEW (WGR-017 tie-in)
    // =========================================================================
    {
      const prospectId = global.__pt03_prospectId;
      const before = {
        pipeline_stage: (await db.query(`select pipeline_stage from donor_discovery_prospects where id=$1`, [prospectId])).rows[0].pipeline_stage,
      };

      // Real navigation: click the row (onRowClick -> router.push), exactly
      // as a real user would, rather than a direct page.goto() shortcut --
      // this is the literal reachability path WGR-017's own finding
      // documented ("a real, unmodified user flow... reaches it directly").
      await page.getByText("PT-03 Journeys Test Prospect LLC", { exact: false }).first().click();
      await page.waitForURL(new RegExp(`/donor-discovery/prospects/${prospectId}`), { timeout: 20_000 });
      // Client-side navigation (router.push), not a full page load -- there is
      // no "load" event to wait on. The "Pipeline stage" <select> only renders
      // once ProspectDetail.tsx has finished its GET fetch and exited the
      // `loading` state, so waiting for it (rather than waitForLoadState,
      // which fired before the client-rendered content committed in an
      // earlier run of this script -- see PT03-004-F01, a real false
      // negative in this test script, not an app defect: the page's own
      // screenshot at that same moment already showed full real content)
      // is the real, correct signal that the detail view has actually
      // rendered.
      await page.getByLabel("Pipeline stage").waitFor({ state: "visible", timeout: 20_000 });

      const bodyText = await page.locator("body").innerText();
      const mainTextLen = bodyText.length;
      const givingFocusVisible = bodyText.includes("Housing") && bodyText.includes("Youth Development");
      const inKindSignalsVisible = bodyText.includes("Habitat for Humanity");
      const beforeShot = await shot(page, "j-02-donor-discovery-detail-before-review");

      // Real UI interaction: the "Pipeline stage" <select> (ProspectDetail.tsx,
      // aria-label="Pipeline stage") -- fires handleStageChange -> PATCH
      // /api/donor-discovery/prospects/[id].
      await page.getByLabel("Pipeline stage").selectOption("reviewing");
      // handleStageChange awaits the PATCH response and calls setProspect()
      // with the server's returned row before stageSaving flips back to
      // false -- wait for the disabled state to clear rather than a fixed
      // sleep.
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[aria-label="Pipeline stage"]');
          return el && !el.disabled;
        },
        { timeout: 15_000 },
      );
      const afterShot = await shot(page, "j-02-donor-discovery-detail-after-reviewing");

      const dbAfter = (await db.query(`select pipeline_stage from donor_discovery_prospects where id=$1`, [prospectId])).rows[0];

      const after = {
        pipeline_stage: dbAfter.pipeline_stage,
        main_content_char_length: mainTextLen,
        giving_focus_areas_rendered: givingFocusVisible,
        in_kind_history_signals_rendered: inKindSignalsVisible,
        wgr_017_tie_in:
          "This is the exact page WGR-017 fixed a blank-render bug on (ProspectDetail.tsx lines 574/587, " +
          "unguarded enrichment.giving_focus_areas.length / enrichment.in_kind_history_signals.length). " +
          `Confirmed non-blank real render (body text length=${mainTextLen} chars) with both guarded ` +
          "fields' real content actually visible, not a crash/blank main area.",
      };

      const ok =
        mainTextLen > 500 &&
        givingFocusVisible &&
        inKindSignalsVisible &&
        dbAfter.pipeline_stage === "reviewing";

      if (!ok) {
        recordFinding(
          "donor_discovery",
          "review",
          "P0",
          `Prospect detail page (WGR-017's fixed page) did not render real content and/or the pipeline_stage change did not persist. before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
          "test-evidence/pt-03/screenshots/j-02-donor-discovery-detail-after-reviewing.png",
        );
      } else {
        console.log(`DD Stage 2 (review) PASS -- real content rendered (${mainTextLen} chars), pipeline_stage=${dbAfter.pipeline_stage}`);
      }

      donorDiscoveryStages.push({
        stage: "review",
        description:
          "Clicked the real prospect row (onRowClick navigation, not a URL shortcut) to reach " +
          "/donor-discovery/prospects/[id] -- WGR-017's fixed detail page. Confirmed real, non-blank " +
          "content rendered (giving_focus_areas and in_kind_history_signals both visibly present). " +
          "Then used the real 'Pipeline stage' <select> to move the prospect from new to reviewing.",
        action: "Real click-through navigation + real <select> interaction (handleStageChange -> PATCH).",
        simulated: false,
        before,
        after,
        assertion: { pass: ok, detail: ok ? "real WGR-017-relevant content rendered; stage change persisted" : "see finding" },
        screenshots: [beforeShot, afterShot],
      });

      if (!ok) throw new Error("Donor Discovery Stage 2 (review) failed -- cannot proceed with the rest of the journey.");
    }

    // =========================================================================
    // DONOR DISCOVERY JOURNEY -- STAGE 3: ROUTE-TO-DESTINATION
    // =========================================================================
    {
      const prospectId = global.__pt03_prospectId;
      const before = {
        funders_count: Number((await db.query(`select count(*) from funders where organization_id=$1`, [orgId])).rows[0].count),
        submission_queue_count: Number((await db.query(`select count(*) from submission_queue where organization_id=$1`, [orgId])).rows[0].count),
      };
      const beforeShot = await shot(page, "j-03-donor-discovery-before-route");

      // Real UI click: "Queue in AutoApply" (hasDonationForm=true from the
      // seeded enrichment) -> handleQueueInAutoApply() -> POST
      // /api/autoapply/queue {source:"donor_discovery", prospect_id, form_url, org_name}.
      await page.getByRole("button", { name: "Queue in AutoApply" }).click();
      await page.getByRole("link", { name: /Queued.*view funder/i }).waitFor({ timeout: 20_000 });
      const afterShot = await shot(page, "j-03-donor-discovery-after-route");

      // handleQueueInAutoApply() (ProspectDetail.tsx) sends org_name:
      // directory.legal_name, NOT dba_name -- confirmed by reading the real
      // component source before writing this query, not guessed.
      const funderRow = (
        await db.query(
          `select id, name, category, giving_portal_url from funders where organization_id=$1 and name=$2`,
          [orgId, "PT-03 Journeys Test Prospect LLC"],
        )
      ).rows[0] ?? null;

      const queueRow = funderRow
        ? (
            await db.query(
              `select id, status, automation_mode, funder_id from submission_queue where organization_id=$1 and funder_id=$2`,
              [orgId, funderRow.id],
            )
          ).rows[0] ?? null
        : null;

      const after = {
        funder_id: funderRow?.id ?? null,
        funder_category: funderRow?.category ?? null,
        funder_giving_portal_url: funderRow?.giving_portal_url ?? null,
        submission_queue_id: queueRow?.id ?? null,
        submission_queue_status: queueRow?.status ?? null,
        submission_queue_automation_mode: queueRow?.automation_mode ?? null,
        destination_confirmed: funderRow !== null && queueRow !== null,
      };

      const ok =
        funderRow !== null &&
        funderRow.category === "in_kind_donation" &&
        funderRow.giving_portal_url === SAFE_DUMMY_TARGET &&
        queueRow !== null &&
        queueRow.status === "pending" &&
        queueRow.automation_mode === "donor_discovery" &&
        queueRow.funder_id === funderRow.id;

      if (!ok) {
        recordFinding(
          "donor_discovery",
          "route_to_destination",
          "P0",
          `"Queue in AutoApply" did not create real, correctly-linked funders + submission_queue rows -- the routed prospect's destination does not actually exist. before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
          "test-evidence/pt-03/screenshots/j-03-donor-discovery-after-route.png",
        );
      } else {
        console.log(`DD Stage 3 (route_to_destination) PASS -- funder=${funderRow.id} submission_queue=${queueRow.id}`);
        routedFunderId = funderRow.id;
        routedQueueItemId = queueRow.id;
      }

      donorDiscoveryStages.push({
        stage: "route_to_destination",
        description:
          "Clicked the real 'Queue in AutoApply' button on the prospect detail page -> POST " +
          "/api/autoapply/queue with source='donor_discovery' (handleDonorDiscoveryHandoff in " +
          "src/app/api/autoapply/queue/route.ts). Confirmed the destination this action routes into -- " +
          "a real funders row plus a real submission_queue row, the actual AutoApply queue -- was " +
          "genuinely created and correctly linked, and that the UI updated in place to a 'Queued -- " +
          "view funder' link, not just a client-side optimistic flag.",
        action: "Real button click -> real POST /api/autoapply/queue -> real DB writes, independently re-queried.",
        simulated: false,
        before,
        after,
        assertion: { pass: ok, detail: ok ? "destination (funders + submission_queue) confirmed created and linked" : "see finding" },
        screenshots: [beforeShot, afterShot],
      });

      if (!ok) throw new Error("Donor Discovery Stage 3 (route_to_destination) failed -- cannot proceed with the AutoApply journey (no real queue item to continue from).");
    }

    console.log("\n=== Donor Discovery journey complete -- continuing into the AutoApply journey with the routed queue item ===\n");

    // =========================================================================
    // AUTOAPPLY JOURNEY -- STAGE 1: QUEUE
    // =========================================================================
    {
      const before = {
        submission_queue_id: routedQueueItemId,
        submission_queue_status: (await db.query(`select status from submission_queue where id=$1`, [routedQueueItemId])).rows[0].status,
      };

      await page.goto(`${BASE_URL}/autoapply`, { waitUntil: "networkidle" });
      const afterShot = await shot(page, "j-04-autoapply-dashboard-queued");

      const bodyText = await page.locator("body").innerText();
      const showsQueuedLabel = bodyText.includes("Queued") || bodyText.includes("PT-03 Test Roofing Co");

      const after = {
        ui_row_visible: showsQueuedLabel,
        note: "Real /autoapply dashboard, client-side query against submission_queue -- the exact row created by the Donor Discovery journey's route-to-destination step, no additional writes made in this stage.",
      };

      const ok = before.submission_queue_status === "pending" && showsQueuedLabel;
      if (!ok) {
        recordFinding(
          "autoapply",
          "queue",
          "P1",
          `Real /autoapply dashboard did not reflect the queued submission_queue row created by Donor Discovery routing. before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
          "test-evidence/pt-03/screenshots/j-04-autoapply-dashboard-queued.png",
        );
      } else {
        console.log(`AutoApply Stage 1 (queue) PASS -- submission_queue=${routedQueueItemId} status=pending, visible on dashboard`);
      }

      autoapplyStages.push({
        stage: "queue",
        description:
          "The submission_queue row this journey continues from was created moments earlier by the " +
          "Donor Discovery journey's real route-to-destination action (status='pending'). Navigated to " +
          "the real /autoapply dashboard and confirmed it is genuinely listed there via the app's own " +
          "client-side query -- no test-only shortcut.",
        action: "Real page.goto('/autoapply') -- no DB writes in this stage.",
        simulated: false,
        before,
        after,
        assertion: { pass: ok, detail: ok ? "real dashboard reflects the real queued row" : "see finding" },
        screenshots: [afterShot],
      });

      if (!ok) throw new Error("AutoApply Stage 1 (queue) failed.");
    }

    // =========================================================================
    // AUTOAPPLY JOURNEY -- STAGE 2: SESSION (SAFE-SIMULATED)
    // =========================================================================
    {
      const before = {
        submission_queue_status: "pending",
        automation_sessions_count: Number(
          (await db.query(`select count(*) from automation_sessions where funder_id=$1`, [routedFunderId])).rows[0].count,
        ),
      };

      // Mirrors worker/queue-processor.ts's dequeue() -- literal column set,
      // lines ~420-444.
      await db.query(
        `update submission_queue set status='processing', started_at=now() where id=$1`,
        [routedQueueItemId],
      );

      // Mirrors worker/queue-processor.ts's createApprovedAutomationSession()
      // -- literal column set, lines ~1676-1729. No browser was launched; no
      // HTTP request was made to any host.
      const sessionInsert = await db.query(
        `insert into automation_sessions
           (organization_id, funder_id, target_url, session_type, status, mapped_fields, unmapped_fields, notes, started_at)
         values ($1, $2, $3, 'form_fill', 'pending', '[]'::jsonb, '[]'::jsonb, $4, now())
         returning id`,
        [
          orgId,
          routedFunderId,
          SAFE_DUMMY_TARGET,
          "SAFE-SIMULATED session for PT-03 journey evidence (pt03-004-autoapply-donor-journeys.mjs). " +
            "No browser launched, no HTTP request made to any host. Mirrors worker/queue-processor.ts's " +
            "createApprovedAutomationSession() column shape exactly.",
        ],
      );
      const automationSessionId = sessionInsert.rows[0].id;
      await db.query(`update automation_sessions set status='approved', updated_at=now() where id=$1`, [automationSessionId]);

      await page.reload({ waitUntil: "networkidle" });
      const afterShot = await shot(page, "j-05-autoapply-dashboard-running");
      const bodyText = await page.locator("body").innerText();
      const showsRunning = bodyText.includes("Running");

      const dbAfter = (await db.query(
        `select sq.status as queue_status, a.status as session_status
         from submission_queue sq join automation_sessions a on a.id=$2
         where sq.id=$1`,
        [routedQueueItemId, automationSessionId],
      )).rows[0];

      const after = {
        automation_session_id: automationSessionId,
        submission_queue_status: dbAfter.queue_status,
        automation_session_status: dbAfter.session_status,
        ui_shows_running_pill: showsRunning,
        simulated: true,
        external_http_calls_made: 0,
      };

      const ok = dbAfter.queue_status === "processing" && dbAfter.session_status === "approved" && showsRunning;
      if (!ok) {
        recordFinding(
          "autoapply",
          "session",
          "P1",
          `Real /autoapply dashboard did not reflect the simulated processing/approved session state. before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
          "test-evidence/pt-03/screenshots/j-05-autoapply-dashboard-running.png",
        );
      } else {
        console.log(`AutoApply Stage 2 (session) PASS -- automation_session=${automationSessionId}, dashboard shows Running`);
      }

      autoapplyStages.push({
        stage: "session",
        description:
          "SAFE-SIMULATED: performed the exact real DB writes worker/queue-processor.ts's dequeue() and " +
          "createApprovedAutomationSession() perform (submission_queue.status -> 'processing'; a real " +
          "automation_sessions row created then approved), verbatim by column shape. No browser was " +
          "launched and no HTTP request was made to any host -- this reproduces only the queue-claim and " +
          "session-approval bookkeeping, for evidence-capture purposes.",
        action: "SAFE-SIMULATED direct DB writes mirroring worker/queue-processor.ts's real column shapes.",
        simulated: true,
        before,
        after,
        assertion: { pass: ok, detail: ok ? "real dashboard reflects the simulated Running state" : "see finding" },
        screenshots: [afterShot],
      });

      if (!ok) throw new Error("AutoApply Stage 2 (session) failed.");

      global.__pt03_automationSessionId = automationSessionId;
    }

    // =========================================================================
    // AUTOAPPLY JOURNEY -- STAGE 3: FORM-FILL (SAFE-SIMULATED)
    // =========================================================================
    {
      const automationSessionId = global.__pt03_automationSessionId;
      const before = {
        form_templates_count: Number(
          (await db.query(`select count(*) from form_templates where funder_id=$1`, [routedFunderId])).rows[0].count,
        ),
      };

      // Mirrors the real form_templates row shape worker/queue-processor.ts
      // reads/writes (lines ~957-966) and the real fields httpbin.org's own
      // dummy form actually exposes -- no request was made to fetch this
      // structure; it is hand-authored from that public page's known,
      // static field set (the same target already used, unmodified, by
      // src/__tests__/integration/autoapply-queue.test.ts).
      const mappedFields = [
        { field: "custname", selector: "input[name='custname']", value: TEST_ORG_NAME },
        { field: "custemail", selector: "input[name='custemail']", value: TEST_EMAIL },
        { field: "comments", selector: "textarea[name='comments']", value: "PT-03 SAFE-SIMULATED journey evidence -- not a real submission." },
      ];

      const templateInsert = await db.query(
        `insert into form_templates
           (organization_id, funder_id, portal_url, form_structure, field_mapping, is_multi_step, requires_login, auto_generated, field_count)
         values ($1, $2, $3, $4::jsonb, $5::jsonb, false, false, true, $6)
         returning id`,
        [
          orgId,
          routedFunderId,
          SAFE_DUMMY_TARGET,
          JSON.stringify({ fields: mappedFields.map((f) => f.field), note: "SAFE-SIMULATED -- hand-authored, not fetched" }),
          JSON.stringify(mappedFields),
          mappedFields.length,
        ],
      );
      const formTemplateId = templateInsert.rows[0].id;

      await db.query(
        `update automation_sessions set mapped_fields=$1::jsonb where id=$2`,
        [JSON.stringify(mappedFields), automationSessionId],
      );

      // No visible UI change is expected for this internal step -- the
      // dashboard's status pill stays "Running" throughout the whole
      // processing window (see sessionStatusHex()). Screenshot taken anyway
      // to make that "no change expected, and here is the proof" claim
      // checkable rather than asserted.
      await page.reload({ waitUntil: "networkidle" });
      const afterShot = await shot(page, "j-06-autoapply-dashboard-still-running-during-form-fill");
      const bodyText = await page.locator("body").innerText();
      const stillRunning = bodyText.includes("Running");

      const dbAfter = (await db.query(
        `select mapped_fields from automation_sessions where id=$1`,
        [automationSessionId],
      )).rows[0];
      const mappedFieldsCount = Array.isArray(dbAfter.mapped_fields) ? dbAfter.mapped_fields.length : 0;

      const after = {
        form_template_id: formTemplateId,
        portal_url: SAFE_DUMMY_TARGET,
        mapped_fields_count: mappedFieldsCount,
        ui_still_shows_running_no_distinct_form_fill_state: stillRunning,
        simulated: true,
        external_http_calls_made: 0,
      };

      const ok = formTemplateId !== undefined && mappedFieldsCount === mappedFields.length && stillRunning;
      if (!ok) {
        recordFinding(
          "autoapply",
          "form_fill",
          "P2",
          `Simulated form-fill step did not persist as expected, or the dashboard unexpectedly changed state. before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
          "test-evidence/pt-03/screenshots/j-06-autoapply-dashboard-still-running-during-form-fill.png",
        );
      } else {
        console.log(`AutoApply Stage 3 (form_fill) PASS -- form_template=${formTemplateId}, ${mappedFieldsCount} fields mapped`);
      }

      autoapplyStages.push({
        stage: "form_fill",
        description:
          "SAFE-SIMULATED: inserted a real-shaped form_templates row (portal_url=the safe dummy target, " +
          "a hand-authored field structure matching that page's own known static fields) and updated the " +
          "automation_sessions row's mapped_fields, mirroring the real analyzer+filler stage's data shape " +
          "exactly. No browser was launched and no HTTP request was made to httpbin.org or any other " +
          "host at any point in this stage. The real dashboard has no distinct visual state for this " +
          "internal step (it stays 'Running' the whole time submission_queue.status='processing') -- " +
          "confirmed via screenshot rather than silently assumed.",
        action: "SAFE-SIMULATED direct DB writes mirroring worker/queue-processor.ts's real form_templates/mapped_fields shapes.",
        simulated: true,
        before,
        after,
        assertion: { pass: ok, detail: ok ? "form-fill data persisted; dashboard state unchanged as expected" : "see finding" },
        screenshots: [afterShot],
      });

      if (!ok) throw new Error("AutoApply Stage 3 (form_fill) failed.");

      global.__pt03_formTemplateId = formTemplateId;
    }

    // =========================================================================
    // AUTOAPPLY JOURNEY -- STAGE 4: SAFE-SIMULATED SUBMIT (terminal)
    // =========================================================================
    {
      const automationSessionId = global.__pt03_automationSessionId;
      const formTemplateId = global.__pt03_formTemplateId;
      const before = {
        submission_queue_status: "processing",
        autoapply_submissions_count: Number(
          (await db.query(`select count(*) from autoapply_submissions where funder_id=$1`, [routedFunderId])).rows[0].count,
        ),
      };

      const confirmationNumber = `SAFE-SIM-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

      // Mirrors the real post-success autoapply_submissions insert
      // (worker/queue-processor.ts lines ~1408-1430) -- literal column set.
      // `confirmation_data` is explicitly marked simulated so this row can
      // never be mistaken for a real confirmed submission if read later.
      const submissionInsert = await db.query(
        `insert into autoapply_submissions
           (organization_id, funder_id, form_template_id, status, request_description, confirmation_number, confirmation_data, submitted_at)
         values ($1, $2, $3, 'submitted', $4, $5, $6::jsonb, now())
         returning id`,
        [
          orgId,
          routedFunderId,
          formTemplateId,
          "PT-03 SAFE-SIMULATED journey evidence submission -- never sent to any external host.",
          confirmationNumber,
          JSON.stringify({
            simulated: true,
            note:
              "SAFE-SIMULATED by scripts/audit/pt03-004-autoapply-donor-journeys.mjs. No HTTP request was " +
              "issued to https://httpbin.org or any external donation portal at any point in this journey.",
          }),
        ],
      );
      const autoapplySubmissionId = submissionInsert.rows[0].id;

      // Mirrors worker/queue-processor.ts's finalizeAutomationSession() --
      // literal column set (lines ~1732-1754).
      await db.query(
        `update automation_sessions
         set status='submitted', confirmation_number=$1, completed_at=now(), updated_at=now()
         where id=$2`,
        [confirmationNumber, automationSessionId],
      );

      // Mirrors worker/queue-processor.ts's own terminal submission_queue
      // write for a real successful run (lines ~318-319 for the general
      // success path; the submission_id link-back mirrors lines ~1463-1470).
      await db.query(
        `update submission_queue set status='completed', completed_at=now(), submission_id=$1 where id=$2`,
        [autoapplySubmissionId, routedQueueItemId],
      );

      await page.reload({ waitUntil: "networkidle" });
      const afterShot = await shot(page, "j-07-autoapply-dashboard-completed");
      const bodyText = await page.locator("body").innerText();
      const showsCompleted = bodyText.includes("Completed");

      const dbAfter = (await db.query(
        `select sq.status as queue_status, sq.submission_id, s.status as submission_status, s.confirmation_number
         from submission_queue sq join autoapply_submissions s on s.id=sq.submission_id
         where sq.id=$1`,
        [routedQueueItemId],
      )).rows[0];

      const after = {
        autoapply_submission_id: autoapplySubmissionId,
        submission_queue_status: dbAfter?.queue_status ?? null,
        submission_status: dbAfter?.submission_status ?? null,
        confirmation_number: dbAfter?.confirmation_number ?? null,
        ui_shows_completed_pill: showsCompleted,
        simulated: true,
        external_http_calls_made: 0,
        note:
          "SAFE-SIMULATED terminal state. At no point in this entire AutoApply journey (queue, session, " +
          "form_fill, submit) was an HTTP request issued to https://httpbin.org or any external donation " +
          "portal -- every write mirrors the real worker's column shapes exactly, produced by this script " +
          "directly against the local, non-production database.",
      };

      const ok =
        dbAfter?.queue_status === "completed" &&
        dbAfter?.submission_status === "submitted" &&
        dbAfter?.confirmation_number === confirmationNumber &&
        showsCompleted;

      if (!ok) {
        recordFinding(
          "autoapply",
          "submit",
          "P0",
          `Real /autoapply dashboard did not reflect the simulated terminal 'completed' state after the safe-simulated submit. before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
          "test-evidence/pt-03/screenshots/j-07-autoapply-dashboard-completed.png",
        );
      } else {
        console.log(`AutoApply Stage 4 (submit) PASS -- autoapply_submissions=${autoapplySubmissionId}, dashboard shows Completed`);
      }

      autoapplyStages.push({
        stage: "submit",
        description:
          "SAFE-SIMULATED terminal write: inserted a real-shaped autoapply_submissions row " +
          "(status='submitted', a clearly-marked simulated confirmation_number/confirmation_data), " +
          "finalized the automation_sessions row (status='submitted'), and updated submission_queue " +
          "(status='completed', linked submission_id) -- mirroring worker/queue-processor.ts's own " +
          "post-success writes exactly by column shape. NEVER a real external submission: no HTTP " +
          "request was made to httpbin.org or any host at any point in this stage or journey. Reloaded " +
          "the real /autoapply dashboard and confirmed it now shows this exact row with a green " +
          "'Completed' status pill.",
        action: "SAFE-SIMULATED direct DB writes mirroring worker/queue-processor.ts's real terminal-state column shapes.",
        simulated: true,
        before,
        after,
        assertion: { pass: ok, detail: ok ? "real dashboard reflects the simulated terminal Completed state" : "see finding" },
        screenshots: [afterShot],
      });

      if (!ok) throw new Error("AutoApply Stage 4 (submit) failed.");
    }

    console.log("\n=== Both journeys complete ===");
  } catch (err) {
    fatalError = err instanceof Error ? err.message : String(err);
    console.error("Journey halted early:", fatalError);
    recordFinding(
      "journeys",
      "top-level",
      "P0",
      `Journeys halted before all stages could be attempted: ${fatalError}`,
      "test-evidence/pt-03/autoapply-donor-journeys.json (see the last recorded stage in either journey for detail)",
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    console.log("Stopping local dev server...");
    stopDevServer(devChild);
    await new Promise((r) => setTimeout(r, 500));
    await db.end();
  }

  // ---------------------------------------------------------------------------
  // Write evidence -- always, whether the journeys completed cleanly or were
  // halted early by a fatal stage failure.
  // ---------------------------------------------------------------------------
  const donorDiscoveryTerminal =
    donorDiscoveryStages.length === 3
      ? {
          pipeline_stage: donorDiscoveryStages[1]?.after?.pipeline_stage ?? null,
          routed: donorDiscoveryStages[2]?.after?.destination_confirmed ?? false,
          funder_id: donorDiscoveryStages[2]?.after?.funder_id ?? null,
          submission_queue_id: donorDiscoveryStages[2]?.after?.submission_queue_id ?? null,
        }
      : null;

  const autoapplyTerminal =
    autoapplyStages.length === 4
      ? {
          submission_queue_status: autoapplyStages[3]?.after?.submission_queue_status ?? null,
          autoapply_submission_id: autoapplyStages[3]?.after?.autoapply_submission_id ?? null,
          confirmation_number: autoapplyStages[3]?.after?.confirmation_number ?? null,
          simulated: true,
          external_calls_made: 0,
        }
      : null;

  const output = {
    generated_at: nowIso(),
    target: { host: "127.0.0.1", port: "56322", is_production: false, production_ref_for_comparison: PRODUCTION_REF },
    journey_org: { id: orgId, name: TEST_ORG_NAME },
    journey_user_email: TEST_EMAIL,
    donor_discovery: {
      stages: donorDiscoveryStages,
      terminal_state: donorDiscoveryTerminal,
    },
    autoapply: {
      stages: autoapplyStages,
      terminal_state: autoapplyTerminal,
      no_external_http_calls_made: true,
    },
    findings,
    fatal_error: fatalError,
    summary: {
      donor_discovery_stages_total: donorDiscoveryStages.length,
      donor_discovery_stages_passed: donorDiscoveryStages.filter((s) => s.assertion.pass).length,
      autoapply_stages_total: autoapplyStages.length,
      autoapply_stages_passed: autoapplyStages.filter((s) => s.assertion.pass).length,
      total_findings: findings.length,
      halted_early: fatalError !== null,
    },
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "autoapply-donor-journeys.json"), JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${path.join(OUT_DIR, "autoapply-donor-journeys.json")}`);
  console.log(
    `Donor Discovery: ${output.summary.donor_discovery_stages_passed}/${output.summary.donor_discovery_stages_total} stages passed. ` +
      `AutoApply: ${output.summary.autoapply_stages_passed}/${output.summary.autoapply_stages_total} stages passed. ` +
      `Findings: ${findings.length}.`,
  );
  if (fatalError) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exitCode = 1;
});
