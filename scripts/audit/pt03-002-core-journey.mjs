// ============================================================================
// PT-03-002 -- drive the primary end-to-end customer journey (local/branch):
//   signup -> onboarding completion -> a discovery run -> generate a draft ->
//   move an item through the pipeline -> set/hit a deadline.
//
// At each stage: capture the real DB row state before and after the action,
// perform the action through the real UI (Playwright against a local `next
// dev` instance pointed at the local, non-production Supabase stack -- same
// target PT-03-001 established), take a screenshot, and assert the stage
// actually persisted (row written / status changed) and that the UI reflects
// it. A stage that silently no-ops, loses data, or shows success without
// persistence is recorded as a finding (see FINDINGS below) rather than
// silently passed.
//
// Design notes, stated up front rather than left implicit:
//   - This script drives real form submissions and real button clicks for
//     every state-changing action (signup, each onboarding step, template
//     selection + Generate draft, Create application + Move application,
//     Add to Calendar + Mark deadline complete). Between-page navigation
//     (e.g. jumping straight to /draft-generator?opportunity=<id> instead of
//     re-finding and clicking through card grids) uses direct page.goto() to
//     the exact URL the real in-app link would produce -- a real signed-in
//     user can always navigate this way (bookmark, typed URL, browser back).
//     This is documented per-stage, not hidden.
//   - Stage 3 (discovery run): onboarding's own POST /api/onboarding/complete-setup
//     enqueues a real agent_queue row (agent_id="ag-17-discovery",
//     trigger_source="onboarding") but nothing processes agent_queue against
//     this local stack (no worker process is running here). This script
//     simulates the worker picking up that row exactly the way
//     worker/autonomous-orchestrator.ts's routeQueueItem() does for that
//     agent_id: `runOpportunityDiscovery(orgId, supabase, "manual")`, the
//     real, unmodified exported function from
//     src/lib/agents/opportunity-discovery-agent.ts -- not a mock, not a
//     re-implementation. Run via `node --import tsx` so this .mjs file can
//     import that .ts module directly (tsx registers a loader hook for the
//     whole process; verified working before writing this script).
//   - The local stack (reused from PT-05, established by PT-03-001) was
//     missing two tables from migration 001 (`programs`, `pipeline_history`)
//     that the real onboarding wizard and the real Apply flow both need --
//     confirmed absent via a live schema query before touching anything, and
//     applied directly (CREATE TABLE IF NOT EXISTS, verbatim from migration
//     001) since this is a local, non-production instance under this
//     script's own control, not a production migration. Also applied
//     supabase/migrations/002_register_organization.sql (real signup calls
//     the register_organization() RPC, which was likewise absent). Both are
//     idempotent and were confirmed present before running any Playwright
//     step below.
//   - A third gap in the same class, found by an isolated diagnostic before
//     this script's own draft-generation stage was fixed up (see
//     scripts/audit/pt03-002-core-journey.mjs's stage 4 comment below): the
//     local stack's `draft_versions` table was missing
//     `009_draft_versions.sql`'s `trg_set_draft_version_number` BEFORE INSERT
//     trigger. `draft_versions.version_number` is `NOT NULL` with no column
//     default -- by design, the trigger (not application code) assigns it,
//     per migration 009's own header comment ("application code never
//     supplies it, avoids races"). With the trigger absent, EVERY insert
//     into draft_versions on this local stack violated the NOT NULL
//     constraint. `generateDraft()` (src/lib/drafts/generator.ts) treats the
//     draft_versions insert as best-effort (catches the error, logs it,
//     leaves `savedVersion: null`) so the API still returned a real 200 with
//     real generated content while silently persisting nothing -- this
//     silent-loss *pattern* is a real, code-level finding regardless of the
//     trigger's presence (see the registered WGR row), but the trigger's
//     literal absence here is independently confirmed to be a local-stack
//     schema gap, not a production one: `009_draft_versions.sql` is recorded
//     as fully APPLIED in `MIGRATION_AUDIT.md`'s production structural audit.
//     Applied directly here (idempotent CREATE OR REPLACE FUNCTION + a
//     DROP TRIGGER IF EXISTS/CREATE TRIGGER pair, verbatim from migration
//     009) for the same "local, non-production, under this script's own
//     control" reason as the two gaps above.
//
// Usage: node --import tsx scripts/audit/pt03-002-core-journey.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync, execSync } from "node:child_process";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { WebSocket } from "ws";

if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

// runOpportunityDiscovery is the real, unmodified agent entry point --
// same one worker/autonomous-orchestrator.ts's routeQueueItem() calls for
// agent_id "ag-17-discovery".
import { runOpportunityDiscovery } from "../../src/lib/agents/opportunity-discovery-agent.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "pt-03");
const SHOT_DIR = path.join(OUT_DIR, "screenshots");

const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";

// Same local Supabase CLI stack constants as pt03-001 (standard local-dev
// demo keys, not a production secret -- identical on every local Supabase
// project on this machine).
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const LOCAL_API_URL = "http://127.0.0.1:56321";
const LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const DEV_PORT = 3303;
const DEV_NEXT_DIR = ".next-pt03";
const BASE_URL = `http://localhost:${DEV_PORT}`;

const TEST_EMAIL = "pt03-core-journey-owner@benavora-pt03-test.local";
const TEST_PASSWORD = "Pt03CoreJourney!2026";
const TEST_ORG_NAME = "PT-03 Core Journey Org";

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

// One row per stage: { stage, description, before, action, after, assertions, screenshots }
const stages = [];
// { id, stage, severity, description, evidence }
const findings = [];
let nextFindingSeq = 1;

function recordFinding(stage, severity, description, evidence) {
  const id = `PT03-002-F${String(nextFindingSeq++).padStart(2, "0")}`;
  findings.push({ id, stage, severity, description, evidence });
  console.error(`FINDING [${severity}] ${id} (${stage}): ${description}`);
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

  await db.query(`
    CREATE TABLE IF NOT EXISTS pipeline_history (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id  uuid NOT NULL REFERENCES organizations(id),
      application_id   uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      from_stage       pipeline_stage,
      to_stage         pipeline_stage NOT NULL,
      changed_by       uuid REFERENCES profiles(id),
      notes            text,
      created_at       timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_pipeline_history_app ON pipeline_history (application_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_history_date ON pipeline_history (created_at);

    CREATE TABLE IF NOT EXISTS programs (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id       uuid NOT NULL REFERENCES organizations(id),
      name                  text NOT NULL,
      description           text,
      budget                numeric(12,2),
      beneficiaries_served  integer,
      start_date            date,
      status                text DEFAULT 'active',
      impact_metrics        jsonb,
      created_at            timestamptz DEFAULT now(),
      updated_at            timestamptz DEFAULT now()
    );
  `);

  // 009_draft_versions.sql's trigger, verbatim -- see the header comment
  // above for why this is being applied directly to the local stack.
  await db.query(`
    CREATE OR REPLACE FUNCTION public.set_draft_version_number()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.version_number IS NULL OR NEW.version_number = 0 THEN
        SELECT COALESCE(MAX(version_number), 0) + 1
          INTO NEW.version_number
          FROM public.draft_versions
         WHERE opportunity_id = NEW.opportunity_id;
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_set_draft_version_number ON draft_versions;
    CREATE TRIGGER trg_set_draft_version_number
      BEFORE INSERT ON draft_versions
      FOR EACH ROW
      EXECUTE FUNCTION public.set_draft_version_number();
  `);

  const check = await db.query(
    `select
       (select to_regclass('public.programs') is not null) as has_programs,
       (select to_regclass('public.pipeline_history') is not null) as has_pipeline_history,
       (select count(*) from pg_proc where proname = 'register_organization') as has_register_fn,
       (select count(*) from pg_trigger where tgrelid = 'draft_versions'::regclass and tgname = 'trg_set_draft_version_number') as has_draft_version_trigger`,
  );
  const row = check.rows[0];
  if (
    !row.has_programs ||
    !row.has_pipeline_history ||
    Number(row.has_register_fn) === 0 ||
    Number(row.has_draft_version_trigger) === 0
  ) {
    throw new Error(
      `Local schema fixes did not apply cleanly: ${JSON.stringify(row)}`,
    );
  }
  console.log(
    `Local schema fixes confirmed applied: programs=${row.has_programs} pipeline_history=${row.has_pipeline_history} ` +
      `register_organization()=${row.has_register_fn > 0} draft_versions_trigger=${row.has_draft_version_trigger > 0}`,
  );
}

async function cleanupLeftovers(db) {
  const leftoverOrgs = await db.query(`select id from organizations where name = $1`, [TEST_ORG_NAME]);
  if (leftoverOrgs.rows.length > 0) {
    const ids = leftoverOrgs.rows.map((r) => r.id);
    // FK-safe deletion order: children before organizations.
    await db.query(`delete from pipeline_history where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from audit_logs where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from deadlines where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from draft_versions where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from applications where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from opportunities where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from agent_decisions where org_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from agent_runs where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from agent_queue where org_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from search_profiles where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from board_members where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from programs where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from knowledge_base where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from profiles where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from organizations where id = any($1::uuid[])`, [ids]);
    console.log(`Removed ${ids.length} leftover org(s) + dependents from a prior run.`);
  }

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
    NEXT_PUBLIC_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
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

  console.log(`Starting local dev server on port ${DEV_PORT} against the local stack...`);
  const { child: devChild, getOutput } = startDevServer();
  let browser;
  let orgId = null;
  let fatalError = null;

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
    // STAGE 1 — SIGNUP
    // =========================================================================
    {
      const before = {
        organizations_count: Number(
          (await db.query(`select count(*) from organizations`)).rows[0].count,
        ),
        profiles_count: Number((await db.query(`select count(*) from profiles`)).rows[0].count),
        target_org_exists: (await db.query(`select id from organizations where name=$1`, [TEST_ORG_NAME]))
          .rows.length > 0,
      };

      await page.goto(`${BASE_URL}/register`, { waitUntil: "domcontentloaded" });
      await page.getByLabel("Organization name").fill(TEST_ORG_NAME);
      await page.getByLabel("Your name").fill("PT-03 Journey Owner");
      await page.getByLabel("Email", { exact: true }).fill(TEST_EMAIL);
      await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
      await page.getByLabel("Confirm password").fill(TEST_PASSWORD);
      const beforeShot = await shot(page, "01-signup-filled");

      await page.getByRole("button", { name: "Create account" }).click();
      await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
      const afterShot = await shot(page, "01-signup-after-onboarding-landing");

      // Independent re-query, not trusting the redirect alone.
      const authRes = await fetch(
        `${LOCAL_API_URL}/auth/v1/admin/users?email=${encodeURIComponent(TEST_EMAIL)}`,
        { headers: { apikey: LOCAL_SERVICE_ROLE_KEY, Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}` } },
      );
      const authBody = await authRes.json();
      const authUsers = Array.isArray(authBody?.users) ? authBody.users : Array.isArray(authBody) ? authBody : [];
      const authUser = authUsers.find((u) => u.email === TEST_EMAIL) ?? null;

      const orgRow = (await db.query(`select id, name, onboarding_completed from organizations where name=$1`, [TEST_ORG_NAME])).rows[0] ?? null;
      const profileRow = orgRow
        ? (await db.query(`select id, organization_id, role, email from profiles where organization_id=$1`, [orgRow.id])).rows[0] ?? null
        : null;

      const after = {
        auth_user: authUser ? { id: authUser.id, email: authUser.email } : null,
        organization: orgRow,
        profile: profileRow,
      };

      orgId = orgRow?.id ?? null;

      const ok =
        !!authUser &&
        !!orgRow &&
        !!profileRow &&
        profileRow.organization_id === orgRow.id &&
        profileRow.role === "owner" &&
        profileRow.id === authUser.id;

      if (!ok) {
        recordFinding(
          "signup",
          "P0",
          `Real signup form submission did not persist a complete auth user + organization + owner profile chain. before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
          "test-evidence/pt-03/core-journey.json#stages[0]",
        );
      } else {
        console.log(`Stage 1 (signup) PASS — org=${orgId} profile=${profileRow.id} role=${profileRow.role}`);
      }

      stages.push({
        stage: "signup",
        description:
          "Real signup form (/register) submitted with organization name, full name, email, password. " +
          "Local GoTrue has enable_confirmations=false, so signUp() returns a session immediately and " +
          "the client-side register_organization() RPC bootstraps the org + owner profile synchronously.",
        action: "Filled and submitted the real /register form; no API shortcuts.",
        before,
        after,
        assertion: { pass: ok, detail: ok ? "auth user + organization + owner profile all persisted and linked" : "see finding" },
        screenshots: [beforeShot, afterShot],
      });

      if (!ok) throw new Error("Stage 1 (signup) failed — cannot proceed with the rest of the journey.");
    }

    // =========================================================================
    // STAGE 2 — ONBOARDING COMPLETION
    // =========================================================================
    {
      const before = {
        onboarding_completed: (await db.query(`select onboarding_completed from organizations where id=$1`, [orgId])).rows[0].onboarding_completed,
        programs_count: Number((await db.query(`select count(*) from programs where organization_id=$1`, [orgId])).rows[0].count),
        board_members_count: Number((await db.query(`select count(*) from board_members where organization_id=$1`, [orgId])).rows[0].count),
        search_profiles_count: Number((await db.query(`select count(*) from search_profiles where organization_id=$1`, [orgId])).rows[0].count),
        agent_queue_count: Number((await db.query(`select count(*) from agent_queue where org_id=$1`, [orgId])).rows[0].count),
      };

      // Should have landed on /onboarding step 1 already from stage 1.
      await page.waitForSelector("text=Organization Profile", { timeout: 20_000 });
      const beforeShot = await shot(page, "02-onboarding-step1");

      // Step 1 — Organization Profile (name pre-filled from signup metadata;
      // fill the rest for realism, none of it required).
      await page.getByPlaceholder("Describe your organization's purpose in 1-3 sentences").fill(
        "PT-03 core journey test organization — verifying real end-to-end persistence.",
      );
      await page.getByPlaceholder("e.g. Greater Phoenix, AZ or Statewide").fill("Statewide");
      await page.getByPlaceholder("e.g. Low-income families, youth ages 12-18").fill("Families experiencing housing instability");
      await page.getByRole("button", { name: "Save & Continue" }).click();

      // Step 2 — Programs (at least one required). The wizard's own
      // useState default seeds one empty program row on first mount (not an
      // empty array), so "No programs added yet." never actually appears in
      // a real first-time flow -- fill the pre-existing row directly rather
      // than waiting for an empty state that's unreachable here.
      await page.waitForSelector('h2:has-text("Programs")', { timeout: 15_000 });
      await page.getByPlaceholder("e.g. Youth Mentorship Initiative").fill("PT-03 Housing Stability Program");
      await page.getByPlaceholder("What does this program do? Who does it serve?").fill(
        "Provides emergency rental assistance and case management.",
      );
      await page.getByRole("button", { name: "Save & Continue" }).click();

      // Step 3 — Knowledge Base (optional, skip). h2-scoped selector because
      // "Knowledge Base" also appears as a rail label on every step.
      await page.waitForSelector('h2:has-text("Knowledge Base")', { timeout: 15_000 });
      await page.getByRole("button", { name: "Save & Continue" }).click();

      // Step 4 — Board Members (at least one required). Same pre-seeded-
      // empty-row default as Programs above -- fill the existing row.
      await page.waitForSelector('h2:has-text("Board Members")', { timeout: 15_000 });
      await page.getByPlaceholder("Jane Smith").fill("Pat Journey");
      await page.getByPlaceholder("Chair, Secretary, Treasurer...").fill("Board Chair");
      await page.getByRole("button", { name: "Save & Continue" }).click();

      // Step 5 — Documents (optional, skip). h2-scoped selector because
      // "Documents" also appears as a rail label on every step.
      await page.waitForSelector('h2:has-text("Document Upload")', { timeout: 15_000 });
      await page.getByRole("button", { name: "Save & Continue" }).click();

      // Step 6 — Search Profile (at least one keyword required).
      await page.waitForSelector("text=First Search Profile", { timeout: 15_000 });
      await page.getByPlaceholder("e.g. Primary Grant Search").fill("PT-03 Journey Search Profile");
      const keywordInput = page.getByPlaceholder("youth, workforce, housing...");
      await keywordInput.fill("housing");
      await keywordInput.press("Enter");
      await page.getByPlaceholder("e.g. Arizona, National, or leave blank for any").fill("National");
      const midShot = await shot(page, "02-onboarding-step6-search-profile");
      await page.getByRole("button", { name: "Save & Continue" }).click();

      // Step 7 — Plan Selection: skip for free plan (real handleSkip() path,
      // which still runs the full complete-setup automation).
      await page.waitForSelector("text=Choose Your Plan", { timeout: 15_000 });
      await page.getByRole("button", { name: "Skip for now - continue with Free plan" }).click();

      // "Setting up your AI..." screen while /api/onboarding/complete-setup
      // runs server-side (real Digital Twin populate + real agent_queue
      // insert + real welcome notification, all best-effort/non-fatal).
      await page.waitForURL(/\/dashboard/, { timeout: 120_000 });
      const afterShot = await shot(page, "02-onboarding-complete-dashboard");

      const orgAfter = (await db.query(
        `select onboarding_completed, onboarding_completed_at from organizations where id=$1`,
        [orgId],
      )).rows[0];
      const programsAfter = (await db.query(`select id, name from programs where organization_id=$1`, [orgId])).rows;
      const boardMembersAfter = (await db.query(`select id, name from board_members where organization_id=$1`, [orgId])).rows;
      const searchProfilesAfter = (await db.query(
        `select id, name, keywords from search_profiles where organization_id=$1`,
        [orgId],
      )).rows;
      const agentQueueAfter = (await db.query(
        `select id, agent_id, status, trigger_source from agent_queue where org_id=$1`,
        [orgId],
      )).rows;

      const after = {
        organization: orgAfter,
        programs: programsAfter,
        board_members: boardMembersAfter,
        search_profiles: searchProfilesAfter,
        agent_queue: agentQueueAfter,
      };

      const ok =
        orgAfter.onboarding_completed === true &&
        !!orgAfter.onboarding_completed_at &&
        programsAfter.length === 1 &&
        boardMembersAfter.length === 1 &&
        searchProfilesAfter.length === 1 &&
        (searchProfilesAfter[0].keywords ?? []).includes("housing") &&
        agentQueueAfter.some((r) => r.agent_id === "ag-17-discovery" && r.status === "queued");

      if (!ok) {
        recordFinding(
          "onboarding",
          "P0",
          `Onboarding wizard completion did not persist all expected rows. before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
          "test-evidence/pt-03/core-journey.json#stages[1]",
        );
      } else {
        console.log(`Stage 2 (onboarding) PASS — org.onboarding_completed=true, 1 program, 1 board member, 1 search profile, discovery queued`);
      }

      stages.push({
        stage: "onboarding",
        description:
          "Real 7-step onboarding wizard driven end to end via the actual UI: Organization Profile, " +
          "Programs (added one), Knowledge Base (skipped, optional), Board Members (added one), " +
          "Documents (skipped, optional), Search Profile (added keyword 'housing'), Plan Selection " +
          "(clicked 'Skip for now - continue with Free plan', the real handleSkip() path).",
        action:
          "Filled and submitted each real wizard step's form; every 'Save & Continue' click POSTs to " +
          "the real /api/onboarding route for that step.",
        before,
        after,
        assertion: { pass: ok, detail: ok ? "organizations.onboarding_completed=true, programs/board_members/search_profiles each have 1 real row, discovery agent_queue row queued" : "see finding" },
        screenshots: [beforeShot, midShot, afterShot],
      });

      if (!ok) throw new Error("Stage 2 (onboarding) failed — cannot proceed with the rest of the journey.");
    }

    // =========================================================================
    // STAGE 3 — DISCOVERY RUN
    // =========================================================================
    let discoveredOpportunityId = null;
    {
      const before = {
        opportunities_count: Number((await db.query(`select count(*) from opportunities where organization_id=$1`, [orgId])).rows[0].count),
        agent_runs_count: Number((await db.query(`select count(*) from agent_runs where organization_id=$1 and agent_type='ag-17-discovery'`, [orgId])).rows[0].count),
        search_profile_last_run_at: (await db.query(`select last_run_at from search_profiles where organization_id=$1`, [orgId])).rows[0]?.last_run_at ?? null,
        agent_queue_row: (await db.query(`select id, status from agent_queue where org_id=$1 and agent_id='ag-17-discovery'`, [orgId])).rows[0] ?? null,
      };
      const beforeShot = await shot(page, "03-discovery-before-opportunities-empty");

      const supabaseAdmin = createClient(LOCAL_API_URL, LOCAL_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      console.log("Running the real OpportunityDiscoveryAgent (simulating the worker picking up the queued row)...");
      let discoveryResult = null;
      let discoveryError = null;
      try {
        discoveryResult = await Promise.race([
          runOpportunityDiscovery(orgId, supabaseAdmin, "manual"),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("discovery run exceeded 150s timeout")), 150_000),
          ),
        ]);
      } catch (err) {
        discoveryError = err instanceof Error ? err.message : String(err);
      }

      // Mark the queue row processed either way, matching what the real
      // worker does after routing an item (best-effort, matches worker
      // behavior; not asserted on).
      if (before.agent_queue_row) {
        await db.query(`update agent_queue set status=$1, completed_at=now() where id=$2`, [
          discoveryError ? "failed" : "completed",
          before.agent_queue_row.id,
        ]);
      }

      const opportunitiesAfter = (await db.query(
        `select id, name, category, deadline, created_at from opportunities where organization_id=$1 order by created_at desc`,
        [orgId],
      )).rows;
      const agentRunsAfter = (await db.query(
        `select id, status, items_found, items_processed, error_message from agent_runs where organization_id=$1 and agent_type='ag-17-discovery' order by created_at desc limit 1`,
        [orgId],
      )).rows;

      const after = {
        opportunities_count: opportunitiesAfter.length,
        opportunities: opportunitiesAfter.slice(0, 10),
        agent_run: agentRunsAfter[0] ?? null,
        discovery_result: discoveryResult,
        discovery_error: discoveryError,
      };

      discoveredOpportunityId = opportunitiesAfter[0]?.id ?? null;

      // Reload /opportunities to confirm the UI reflects the persisted state.
      await page.goto(`${BASE_URL}/opportunities`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      const afterShot = await shot(page, "03-discovery-after-opportunities-list");
      const pageText = await page.locator("body").innerText();
      const uiShowsNewOpportunity =
        discoveredOpportunityId != null &&
        opportunitiesAfter[0]?.name &&
        pageText.includes(opportunitiesAfter[0].name.slice(0, 20));

      const ok =
        !discoveryError &&
        agentRunsAfter.length > 0 &&
        agentRunsAfter[0].status === "completed" &&
        opportunitiesAfter.length > before.opportunities_count;

      if (!ok) {
        recordFinding(
          "discovery",
          discoveryError ? "P1" : "P2",
          `Discovery run did not produce the expected outcome. before=${JSON.stringify(before)} after=${JSON.stringify({ ...after, opportunities: after.opportunities.length })}`,
          "test-evidence/pt-03/core-journey.json#stages[2]",
        );
      } else if (!uiShowsNewOpportunity) {
        recordFinding(
          "discovery",
          "P2",
          `Discovery run persisted ${opportunitiesAfter.length - before.opportunities_count} new opportunity row(s) and a completed agent_runs row, but the newly discovered opportunity's name was not found in the rendered /opportunities page text.`,
          "test-evidence/pt-03/core-journey.json#stages[2]",
        );
      } else {
        console.log(`Stage 3 (discovery) PASS — ${opportunitiesAfter.length - before.opportunities_count} new opportunities, agent_runs status=completed`);
      }

      stages.push({
        stage: "discovery",
        description:
          "Onboarding queued a real agent_queue row for ag-17-discovery. No worker processes agent_queue " +
          "against this local stack, so this stage directly invokes the real, unmodified " +
          "runOpportunityDiscovery(orgId, supabase, 'manual') export from " +
          "src/lib/agents/opportunity-discovery-agent.ts -- the exact call " +
          "worker/autonomous-orchestrator.ts's routeQueueItem() makes for this agent_id -- simulating " +
          "the worker picking up the queued row. Real network calls to Grants.gov/SAM.gov/Federal " +
          "Register are made; result is whatever those live sources actually return today, not fabricated.",
        action: "runOpportunityDiscovery(orgId, supabase, 'manual') (real agent code, real external API calls)",
        before,
        after: { ...after, opportunities: after.opportunities.length + " row(s), see agent_run for detail", ui_shows_new_opportunity: uiShowsNewOpportunity },
        assertion: { pass: ok && uiShowsNewOpportunity, detail: ok ? (uiShowsNewOpportunity ? "new opportunities persisted, agent_runs completed, UI reflects it" : "persisted but UI mismatch, see finding") : "see finding" },
        screenshots: [beforeShot, afterShot],
      });

      // Fallback so the rest of the journey can still be exercised and
      // honestly reported even if discovery itself found nothing real this
      // run (e.g. no live source had a match for the seeded search profile).
      if (!discoveredOpportunityId) {
        const fallback = (await db.query(
          `select id, name from opportunities where organization_id=$1 order by created_at desc limit 1`,
          [orgId],
        )).rows[0];
        if (fallback) {
          discoveredOpportunityId = fallback.id;
          recordFinding(
            "discovery",
            "P1",
            `Discovery produced zero new opportunities for this org; falling back to opportunity ${fallback.id} ("${fallback.name}") for the remaining draft/pipeline/deadline stages so the rest of the journey can still be exercised honestly.`,
            "test-evidence/pt-03/core-journey.json#stages[2]",
          );
        } else {
          throw new Error(
            "Stage 3 (discovery) produced zero opportunities for this org and no fallback exists — cannot proceed to draft/pipeline/deadline stages.",
          );
        }
      }
    }

    // =========================================================================
    // STAGE 4 — GENERATE A DRAFT
    //
    // Unlike stages 1/2 (where a failure means there is no org/session left to
    // drive the rest of the journey through), a draft-generation failure does
    // NOT structurally block stages 5/6: pipeline (stage 5) creates its own
    // fresh `applications` row via the real Apply flow independent of any
    // draft content, and the deadline panel (stage 6) reads from
    // `opportunities`, not from `draft_versions` or `applications`. So this
    // stage is wrapped in its own try/catch -- a failure here is recorded
    // honestly as a finding, but the journey continues to stages 5 and 6
    // rather than halting the whole script, exactly as the audit prompt
    // requires ("real, honest zero-result outcome is a legitimate outcome,
    // not a reason to skip the rest of the journey").
    // =========================================================================
    try {
      const before = {
        draft_versions_count: Number((await db.query(`select count(*) from draft_versions where organization_id=$1`, [orgId])).rows[0].count),
        applications_count_for_opportunity: Number(
          (await db.query(`select count(*) from applications where opportunity_id=$1`, [discoveredOpportunityId])).rows[0].count,
        ),
      };

      await page.goto(`${BASE_URL}/draft-generator?opportunity=${discoveredOpportunityId}`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector("text=Choose a template", { timeout: 30_000 });
      const beforeShot = await shot(page, "04-draft-step2-customize");

      // Each template option is a real <button role="radio"> inside a
      // role="radiogroup" (TemplateSelector.tsx), not role="button".
      await page.getByRole("radio", { name: "Grant narrative" }).click();
      // Wizard rail step button's accessible name is "<n><label>" (a step-
      // number/checkmark span concatenated with the label span, e.g.
      // "3Generate") -- not exact "Generate". Substring match is safe here:
      // the step-3 "Generate draft" submit button doesn't exist in the DOM
      // yet (still on step 2), so there is nothing else to match against.
      await page.getByRole("button", { name: "Generate" }).click();
      await page.waitForSelector("text=Generate draft", { timeout: 15_000 });
      const generateBtn = page.getByRole("button", { name: /Generate draft|Generate new version/ });
      await generateBtn.click();

      // Real Claude call — /api/ai/draft has maxDuration=300 (non-streaming
      // Claude drafts routinely take ~180s in this project, per its own
      // established convention). An earlier isolated diagnostic this session
      // (test-evidence/pt-03/stage4-draft-persistence-diagnostic.json) timed
      // one real, successful end-to-end call at ~122s; a separate full-journey
      // run's call was still in flight past 320s when this script's own
      // process teardown killed it -- real, observed latency variance, not a
      // fixed constant. Wait generously past even the app's own 300s
      // maxDuration budget (which local `next dev` does not itself enforce)
      // so a slow-but-genuine completion is captured rather than an artifact
      // of an overly tight test-harness timeout.
      let generationError = null;
      const DRAFT_WAIT_MS = 480_000;
      try {
        await page.waitForFunction(
          () => !document.body.innerText.includes("Generating your draft"),
          { timeout: DRAFT_WAIT_MS },
        );
      } catch {
        generationError = `Generation did not complete within ${Math.round(DRAFT_WAIT_MS / 1000)}s (still showing 'Generating your draft…').`;
      }
      await page.waitForTimeout(1000);
      const bodyText = await page.locator("body").innerText();
      if (!generationError && /could not be generated|Network error while generating/i.test(bodyText)) {
        generationError = "Draft generator UI showed an error message after clicking Generate.";
      }
      const afterShot = await shot(page, "04-draft-after-generate");

      const draftVersionsAfter = (await db.query(
        `select id, template_type, created_at from draft_versions where organization_id=$1 order by created_at desc limit 5`,
        [orgId],
      )).rows;
      const newDraftVersions = draftVersionsAfter.filter(
        (r) => new Date(r.created_at).getTime() > Date.now() - 10 * 60 * 1000,
      );

      const after = {
        draft_versions_recent: draftVersionsAfter,
        new_draft_versions_count: newDraftVersions.length,
        generation_error: generationError,
      };

      const ok = !generationError && newDraftVersions.length > 0;

      if (!ok) {
        recordFinding(
          "draft",
          "P0",
          `Draft generation did not persist a new draft_versions row. before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
          "test-evidence/pt-03/core-journey.json#stages[3]",
        );
      } else {
        console.log(`Stage 4 (draft) PASS — ${newDraftVersions.length} new draft_versions row(s) for this org`);
      }

      stages.push({
        stage: "draft",
        description:
          "Real 4-step Draft Generator wizard: navigated to /draft-generator?opportunity=<id> (the same " +
          "target the real 'Apply Now' CTA on the opportunity detail page produces), selected the " +
          "'Grant narrative' template on the real Customize step, jumped to the Generate step via the " +
          "real wizard rail, and clicked the real 'Generate draft' button, which POSTs to the real " +
          "/api/ai/draft route (a genuine Claude API call, not mocked).",
        action: "Selected template + clicked 'Generate draft' (real /api/ai/draft POST, real LLM call)",
        before,
        after,
        assertion: { pass: ok, detail: ok ? "draft_versions row persisted, UI showed generated content (no error text)" : "see finding" },
        screenshots: [beforeShot, afterShot],
      });

      if (!ok) {
        console.error("Stage 4 (draft) failed — continuing to stages 5/6 (they do not depend on stage 4's outcome).");
      } else {
        console.log(`Stage 4 (draft) PASS`);
      }
    } catch (stage4Err) {
      const msg = stage4Err instanceof Error ? stage4Err.message : String(stage4Err);
      console.error("Stage 4 (draft) threw — recording as a finding and continuing:", msg);
      recordFinding(
        "draft",
        "P0",
        `Draft generation stage threw an unhandled error before it could complete its own checks: ${msg}`,
        "test-evidence/pt-03/core-journey.json#stages (draft)",
      );
      let crashShot = [];
      try {
        crashShot = [await shot(page, "04-draft-unhandled-error")];
      } catch {
        // page may itself be unusable at this point; screenshot best-effort only.
      }
      stages.push({
        stage: "draft",
        description: "Real 4-step Draft Generator wizard — see finding for the unhandled error that aborted this stage.",
        action: "Selected template + clicked 'Generate draft' (real /api/ai/draft POST, real LLM call)",
        before: { note: "stage threw before/after could be fully captured", error: msg },
        after: { note: "stage threw before/after could be fully captured", error: msg },
        assertion: { pass: false, detail: "see finding" },
        screenshots: crashShot,
      });
    }

    // =========================================================================
    // STAGE 5 — MOVE AN ITEM THROUGH THE PIPELINE
    //
    // Independent of stage 4: creates its own fresh `applications` row via the
    // real Apply flow regardless of whether a draft was generated. Wrapped in
    // its own try/catch for the same reason as stage 4 -- a failure here is a
    // real, honestly-recorded finding, not a reason to skip stage 6 (deadline
    // predictions read from `opportunities`, not from this stage's output).
    // =========================================================================
    let applicationId = null;
    try {
      const before = {
        applications_count_for_opportunity: Number(
          (await db.query(`select count(*) from applications where opportunity_id=$1`, [discoveredOpportunityId])).rows[0].count,
        ),
        pipeline_history_count: Number((await db.query(`select count(*) from pipeline_history where organization_id=$1`, [orgId])).rows[0].count),
      };

      // Real "Apply Now" target — creates a real applications row at
      // stage='discovered' via the real /applications/new page.
      await page.goto(`${BASE_URL}/applications/new?opportunityId=${discoveredOpportunityId}`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector("text=Start an application", { timeout: 20_000 });
      const beforeCreateShot = await shot(page, "05-pipeline-before-create-application");

      const createBtn = page.getByRole("button", { name: "Create application" });
      const openExistingBtn = page.getByRole("button", { name: "Open existing application" });
      if (await createBtn.isVisible().catch(() => false)) {
        await createBtn.click();
      } else if (await openExistingBtn.isVisible().catch(() => false)) {
        await openExistingBtn.click();
      }
      await page.waitForURL(/\/applications\/[0-9a-f-]{36}/, { timeout: 20_000 });
      applicationId = page.url().split("/applications/")[1].split(/[/?#]/)[0];

      const stageAfterCreate = (await db.query(`select stage from applications where id=$1`, [applicationId])).rows[0]?.stage;

      // Real "Move application" -> discovered -> eligibility_review (the
      // one real forward transition with condition:"none", so it needs no
      // preconditions from earlier agents).
      await page.getByRole("button", { name: "Move application" }).click();
      await page.waitForSelector("text=Move to stage", { timeout: 15_000 });
      await page.getByLabel("Move to stage").selectOption({ label: "Eligibility Review" });
      const midShot = await shot(page, "05-pipeline-move-modal-target-selected");
      await page.getByRole("button", { name: "Confirm move" }).click();
      await page.waitForSelector("text=Move to stage", { state: "hidden", timeout: 15_000 });
      await page.waitForTimeout(800);
      const afterShot = await shot(page, "05-pipeline-after-move");

      const appRowAfter = (await db.query(
        `select id, stage, opportunity_id from applications where id=$1`,
        [applicationId],
      )).rows[0];
      const historyAfter = (await db.query(
        `select id, from_stage, to_stage, created_at from pipeline_history where application_id=$1 order by created_at`,
        [applicationId],
      )).rows;

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

      if (!ok) {
        recordFinding(
          "pipeline",
          "P0",
          `Pipeline stage transition did not persist correctly. before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
          "test-evidence/pt-03/core-journey.json#stages[4]",
        );
      } else {
        console.log(`Stage 5 (pipeline) PASS — application ${applicationId}: discovered -> eligibility_review, ${historyAfter.length} pipeline_history rows`);
      }

      stages.push({
        stage: "pipeline",
        description:
          "Real Apply flow: /applications/new?opportunityId=<id> -> real 'Create application' button " +
          "(creates a real applications row at stage='discovered') -> real 'Move application' button on " +
          "the application detail page opens the real StageTransitionModal -> selected 'Eligibility " +
          "Review' as the target (the one real, precondition-free forward edge from 'discovered') -> " +
          "real 'Confirm move' button, which calls the real executeTransition() client function.",
        action: "Create application, then Move application: discovered -> eligibility_review",
        before,
        after,
        assertion: { pass: ok, detail: ok ? "applications.stage updated, real pipeline_history audit rows for both the create and the move" : "see finding" },
        screenshots: [beforeCreateShot, midShot, afterShot],
      });

      if (!ok) {
        console.error("Stage 5 (pipeline) failed — continuing to stage 6 (deadline predictions do not depend on stage 5's outcome).");
      }
    } catch (stage5Err) {
      const msg = stage5Err instanceof Error ? stage5Err.message : String(stage5Err);
      console.error("Stage 5 (pipeline) threw — recording as a finding and continuing:", msg);
      recordFinding(
        "pipeline",
        "P0",
        `Pipeline stage threw an unhandled error before it could complete its own checks: ${msg}`,
        "test-evidence/pt-03/core-journey.json#stages (pipeline)",
      );
      let crashShot = [];
      try {
        crashShot = [await shot(page, "05-pipeline-unhandled-error")];
      } catch {
        // page may itself be unusable at this point; screenshot best-effort only.
      }
      stages.push({
        stage: "pipeline",
        description: "Real Apply + Move application flow — see finding for the unhandled error that aborted this stage.",
        action: "Create application, then Move application: discovered -> eligibility_review",
        before: { note: "stage threw before/after could be fully captured", error: msg },
        after: { note: "stage threw before/after could be fully captured", error: msg },
        assertion: { pass: false, detail: "see finding" },
        screenshots: crashShot,
      });
    }

    // =========================================================================
    // STAGE 6 — SET / HIT A DEADLINE
    //
    // Independent of stages 4/5: reads from Predicted Deadlines, which is
    // derived from this org's real `opportunities` (stage 3's output), not
    // from any application or draft. Wrapped in the same try/catch pattern
    // as stages 4/5 so a real UI/selector problem here is recorded as an
    // honest finding rather than losing this stage's evidence entirely.
    // =========================================================================
    try {
      const before = {
        deadlines_count: Number((await db.query(`select count(*) from deadlines where organization_id=$1`, [orgId])).rows[0].count),
      };

      // The page defaults to the Month/Calendar view (view=null), which renders
      // CalendarGrid -- a cell grid with no per-row action buttons. The
      // "Mark deadline complete" toggle only exists in List view's row
      // renderer (src/app/(dashboard)/deadlines/page.tsx's `group.items.map`
      // block, only reached when `view === "list"`). The page reads its view
      // mode from the `view` URL search param (`searchParams.get("view")`),
      // so requesting List view directly avoids an extra, fragile UI click.
      await page.goto(`${BASE_URL}/deadlines?view=list`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("text=Predicted Deadlines", { timeout: 30_000 });
      const beforeShot = await shot(page, "06-deadlines-before-predicted");

      const addToCalendarBtn = page.getByRole("button", { name: "Add to Calendar" }).first();
      await addToCalendarBtn.waitFor({ state: "visible", timeout: 20_000 });
      await addToCalendarBtn.click();
      await page.waitForTimeout(1500);

      const deadlinesAfterAdd = (await db.query(
        `select id, title, deadline_type, due_date, is_completed, completed_at from deadlines where organization_id=$1 order by created_at desc`,
        [orgId],
      )).rows;

      if (deadlinesAfterAdd.length === 0) {
        recordFinding(
          "deadline",
          "P1",
          `Clicking 'Add to Calendar' on a predicted deadline did not persist a deadlines row. before=${JSON.stringify(before)}`,
          "test-evidence/pt-03/core-journey.json#stages[5]",
        );
        stages.push({
          stage: "deadline",
          description: "Real Predicted Deadlines panel on /deadlines: clicked 'Add to Calendar' on the first prediction.",
          action: "Add to Calendar (real deadlines insert)",
          before,
          after: { deadlines: deadlinesAfterAdd },
          assertion: { pass: false, detail: "no deadlines row created — see finding" },
          screenshots: [beforeShot],
        });
      } else {
        const newDeadline = deadlinesAfterAdd[0];
        const midShot = await shot(page, "06-deadlines-after-add");

        // "Hit" the deadline: mark it complete via the real toggle. Only one
        // real deadline row exists on this org at this point in the journey
        // (the one just created above), so the aria-labeled button is
        // unambiguous without scoping to a specific row container.
        const completeBtn = page.getByRole("button", { name: "Mark deadline complete" }).first();
        await completeBtn.waitFor({ state: "visible", timeout: 15_000 });
        await completeBtn.click();
        await page.waitForTimeout(1200);
        const afterShot = await shot(page, "06-deadlines-after-complete");

        const deadlineRowAfter = (await db.query(
          `select id, title, deadline_type, due_date, is_completed, completed_at from deadlines where id=$1`,
          [newDeadline.id],
        )).rows[0];

        const after = {
          deadlines_count: deadlinesAfterAdd.length,
          new_deadline_after_add: newDeadline,
          new_deadline_after_complete: deadlineRowAfter,
        };

        const ok =
          deadlinesAfterAdd.length > before.deadlines_count &&
          newDeadline.is_completed === false &&
          !!deadlineRowAfter &&
          deadlineRowAfter.is_completed === true &&
          !!deadlineRowAfter.completed_at;

        if (!ok) {
          recordFinding(
            "deadline",
            "P1",
            `Deadline set/hit did not persist correctly. before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
            "test-evidence/pt-03/core-journey.json#stages[5]",
          );
        } else {
          console.log(`Stage 6 (deadline) PASS — deadline ${newDeadline.id} created then marked complete`);
        }

        stages.push({
          stage: "deadline",
          description:
            "Real Predicted Deadlines panel on /deadlines (GET /api/intelligence/deadline-predictions, " +
            "real heuristic over this org's real opportunities with no deadline set): clicked the real " +
            "'Add to Calendar' button on the first prediction (real deadlines insert), then clicked the " +
            "real 'Mark deadline complete' toggle on that same row (real is_completed/completed_at update).",
          action: "Add to Calendar (set), then Mark deadline complete (hit)",
          before,
          after,
          assertion: { pass: ok, detail: ok ? "deadlines row created (is_completed=false) then updated (is_completed=true, completed_at set)" : "see finding" },
          screenshots: [beforeShot, midShot, afterShot],
        });
      }
    } catch (stage6Err) {
      const msg = stage6Err instanceof Error ? stage6Err.message : String(stage6Err);
      console.error("Stage 6 (deadline) threw — recording as a finding:", msg);
      recordFinding(
        "deadline",
        "P1",
        `Deadline stage threw an unhandled error before it could complete its own checks: ${msg}`,
        "test-evidence/pt-03/core-journey.json#stages (deadline)",
      );
      let crashShot = [];
      try {
        crashShot = [await shot(page, "06-deadlines-unhandled-error")];
      } catch {
        // page may itself be unusable at this point; screenshot best-effort only.
      }
      stages.push({
        stage: "deadline",
        description: "Real Predicted Deadlines panel flow — see finding for the unhandled error that aborted this stage.",
        action: "Add to Calendar (set), then Mark deadline complete (hit)",
        before: { note: "stage threw before/after could be fully captured", error: msg },
        after: { note: "stage threw before/after could be fully captured", error: msg },
        assertion: { pass: false, detail: "see finding" },
        screenshots: crashShot,
      });
    }

    console.log("\n=== Core journey complete ===");
  } catch (err) {
    // A thrown error here means one stage failed hard enough that later
    // stages could not be attempted. Record it as a top-level finding (in
    // addition to whatever stage-specific finding already triggered the
    // throw) and fall through to still write out whatever stages/findings
    // were captured so far -- this script must never lose evidence just
    // because a later stage in the chain couldn't run.
    fatalError = err instanceof Error ? err.message : String(err);
    console.error("Journey halted early:", fatalError);
    recordFinding(
      "journey",
      "P0",
      `Core journey halted before all 6 stages could be attempted: ${fatalError}`,
      "test-evidence/pt-03/core-journey.json#stages (see the last recorded stage for detail)",
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    console.log("Stopping local dev server...");
    stopDevServer(devChild);
    await new Promise((r) => setTimeout(r, 500));
    await db.end();
  }

  // ---------------------------------------------------------------------------
  // Write evidence -- always, whether the journey completed cleanly or was
  // halted early by a fatal stage failure.
  // ---------------------------------------------------------------------------
  const output = {
    generated_at: nowIso(),
    target: { host: "127.0.0.1", port: "56322", is_production: false, production_ref_for_comparison: PRODUCTION_REF },
    journey_org: { id: orgId, name: TEST_ORG_NAME },
    journey_user_email: TEST_EMAIL,
    stages,
    findings,
    fatal_error: fatalError,
    summary: {
      total_stages: stages.length,
      stages_passed: stages.filter((s) => s.assertion.pass).length,
      stages_with_findings: findings.length,
      halted_early: fatalError !== null,
    },
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "core-journey.json"), JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${path.join(OUT_DIR, "core-journey.json")}`);
  console.log(`Stages: ${output.summary.stages_passed}/${output.summary.total_stages} passed cleanly. Findings: ${findings.length}.`);
  if (fatalError) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exitCode = 1;
});
