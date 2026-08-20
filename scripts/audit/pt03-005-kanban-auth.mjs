// ============================================================================
// PT-03-004 -- Kanban stage-transition enforcement + auth flows
//   (test-evidence/pt-03/kanban-auth.json).
//
// Two independent concerns, driven against the same local (non-production)
// Supabase CLI stack PT-03-001 established (.pt05-local-stack/, reused --
// still running, confirmed live before this script touches anything):
//
//  PART 1 -- KANBAN: drives real `applications` rows through the documented
//    12-stage pipeline (src/lib/utils/constants.ts PIPELINE_STAGES) using the
//    real, unmodified transition logic from
//    src/components/applications/pipeline.ts (getTransitionRule,
//    executeTransition, canMoveToStage, evaluateCondition), imported directly
//    via `node --import tsx` -- not reimplemented, not mocked. Every legal
//    transition in BEHAVIORAL_CONTRACTS Sec6's forward graph is exercised at
//    least once across three application journeys, touching all 12 stages.
//    A full 12x12 transition-rule matrix is computed. Six illegal
//    (stage-skipping) transitions are confirmed rejected BY THE RULE
//    FUNCTION. Separately -- and this is the actual point of "asserting the
//    rules are enforced" rather than just "asserting the rule function
//    exists" -- this script tests whether anything downstream of that pure
//    function actually stops an illegal write from persisting: (a) calling
//    executeTransition() directly with an illegal target, bypassing the
//    React modal's canConfirm gate that is the ONLY call site checking
//    getTransitionRule() before invoking it; (b) a raw
//    supabase.from("applications").update({stage}) with no executeTransition
//    involved at all; (c) a "viewer"-role session executing a transition
//    (ready_for_review -> submitted) that canMoveToStage() says only
//    owner/admin may perform. All three bypass paths are real, live writes
//    against the real local Postgres -- their actual outcome (rejected vs.
//    silently persisted) is recorded as fact, not assumed from reading the
//    source. A persisted illegal write is recorded as a finding, per this
//    task's explicit instruction that an unenforced illegal transition is a
//    finding, not a footnote.
//
//  PART 2 -- AUTH FLOWS, each exercised for real, no shortcuts:
//    - Password reset: real /forgot-password form submission (Playwright) ->
//      a genuine email delivered by the local stack's real Mailpit SMTP
//      catcher (not an admin-generated link) -> the real recovery redirect's
//      hash tokens landed on the real /reset-password page -> a real new
//      password submitted through that page's real form -> independently
//      re-verified (old password now rejected, new password now accepted)
//      against the live Auth server, not just trusted from a "success" UI
//      state.
//    - Magic-link login: real self-service signInWithOtp (the same
//      anon-key-callable method an in-app "email me a link" button would
//      use) -> a genuine email via Mailpit -> the real verify redirect's
//      hash tokens -> a real session established via the app's own
//      @supabase/ssr cookie-adapter shape -> those cookies injected into a
//      real Playwright browser context -> a real navigation to /dashboard
//      confirms the app's own middleware (which re-validates the session
//      server-side on every request) accepts it. NOTE, stated plainly: this
//      app's /login page has no magic-link UI trigger at all (password only)
//      and no page auto-consumes a bare magic-link hash redirect the way
//      /reset-password does for recovery tokens -- confirmed by reading both
//      files before writing this test. The underlying Supabase Auth
//      capability is real and was exercised end to end; there is simply no
//      in-app page designed to land a real user on it. Recorded as a
//      documented scope note, not silently treated as "the flow doesn't
//      exist" or overstated as "the UI supports this."
//    - Session persistence across a reload: a real password sign-in through
//      the actual /login form, landing on /dashboard, followed by a real
//      full-page reload (page.reload(), a genuine new HTTP request through
//      the app's middleware, not a client-side soft nav) -- confirms the
//      session cookie and the authenticated page state both survive, and
//      that a second page opened in the same browser context (same cookie
//      jar) also lands authenticated without re-entering credentials.
//
// Usage: node --import tsx scripts/audit/pt03-005-kanban-auth.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";
import { WebSocket } from "ws";

if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

// Real, unmodified transition logic -- not reimplemented.
import {
  getTransitionRule,
  executeTransition,
  canMoveToStage,
  evaluateCondition,
} from "../../src/components/applications/pipeline.ts";
import { PIPELINE_STAGES } from "../../src/lib/utils/constants.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "pt-03");
const SHOT_DIR = path.join(OUT_DIR, "screenshots");

const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";

const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const LOCAL_API_URL = "http://127.0.0.1:56321";
const LOCAL_MAILPIT_URL = "http://127.0.0.1:56324";
const LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const DEV_PORT = 3305;
const DEV_NEXT_DIR = ".next-pt03-kanban-auth";
const BASE_URL = `http://localhost:${DEV_PORT}`;

const TEST_ORG_NAME = "PT-03 Kanban+Auth Journeys Org";
const OWNER_EMAIL = "pt03-kanban-auth-owner@benavora-pt03-test.local";
const OWNER_INITIAL_PASSWORD = "Pt03KanbanAuthInit!2026";
const OWNER_NEW_PASSWORD = "Pt03KanbanAuthReset!2026New";
const VIEWER_EMAIL = "pt03-kanban-auth-viewer@benavora-pt03-test.local";

function nowIso() {
  return new Date().toISOString();
}

function assertNotProduction(str) {
  if (String(str).includes(PRODUCTION_REF)) {
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

let nextFindingSeq = 1;
const findings = [];
function recordFinding(area, severity, description, evidence) {
  const id = `PT03-KA-F${String(nextFindingSeq++).padStart(2, "0")}`;
  findings.push({ id, area, severity, description, evidence });
  console.error(`FINDING [${severity}] ${id} (${area}): ${description}`);
  return id;
}

const allScreenshots = [];
async function shot(page, name) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const rel = path.join("test-evidence", "pt-03", "screenshots", `${name}.png`);
  const abs = path.join(REPO_ROOT, rel);
  await page.screenshot({ path: abs, fullPage: true, timeout: 15000 });
  const relPosix = rel.replace(/\\/g, "/");
  allScreenshots.push(relPosix);
  return relPosix;
}

// ---------------------------------------------------------------------------
// Mailpit helpers (the local stack's real SMTP catcher -- confirmed live at
// 127.0.0.1:56324, Mailpit v1.22.3, not Inbucket despite the container name).
// ---------------------------------------------------------------------------
async function fetchLatestMailFor(email, sinceCount, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(
      `${LOCAL_MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const body = await res.json();
    if ((body.messages ?? []).length > sinceCount) {
      const latest = body.messages[0];
      const full = await (await fetch(`${LOCAL_MAILPIT_URL}/api/v1/message/${latest.ID}`)).json();
      return { list: body.messages, full };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`No new email arrived for ${email} within ${timeoutMs}ms`);
}

function extractVerifyLink(mailpitMessage) {
  const links = [...mailpitMessage.HTML.matchAll(/href="([^"]+)"/g)].map((m) =>
    m[1].replace(/&amp;/g, "&"),
  );
  const link = links.find((l) => l.includes("/auth/v1/verify"));
  if (!link) throw new Error("No /auth/v1/verify link found in email HTML.");
  return link;
}

// Follows the real /auth/v1/verify link (a genuine GoTrue verification, not
// simulated) and reports back whichever real redirect shape it produced.
// Which shape depends on which client library initiated the original
// request: the app's real browser client (@supabase/ssr's
// createBrowserClient, used by ForgotPasswordPageClient.tsx) defaults to the
// PKCE flow and gets `?code=...`; a plain @supabase/supabase-js client
// (used for the magic-link flow below, matching PT-03-001's own precedent)
// defaults to the implicit flow and gets `#access_token=...`. Both are real,
// both are handled -- this is not a workaround, it's what the app's actual
// client configuration produces for each call site.
async function followVerifyLink(verifyLink) {
  const resp = await fetch(verifyLink, { redirect: "manual" });
  const location = resp.headers.get("location") || "";
  const hash = location.includes("#") ? location.split("#")[1] : "";
  const hashParams = new URLSearchParams(hash);
  const access_token = hashParams.get("access_token");
  const refresh_token = hashParams.get("refresh_token");
  if (access_token && refresh_token) {
    return { flow: "implicit", access_token, refresh_token, type: hashParams.get("type"), redirectStatus: resp.status, location };
  }
  const queryString = location.includes("?") ? location.split("?")[1].split("#")[0] : "";
  const code = new URLSearchParams(queryString).get("code");
  if (code) {
    return { flow: "pkce", code, redirectStatus: resp.status, location };
  }
  throw new Error(`Could not extract tokens or a code from verify redirect: status=${resp.status} location=${location}`);
}

async function independentUserCheck(access_token) {
  const res = await fetch(`${LOCAL_API_URL}/auth/v1/user`, {
    headers: { apikey: LOCAL_ANON_KEY, Authorization: `Bearer ${access_token}` },
  });
  const body = await res.json();
  return { status: res.status, body };
}

// Build the real @supabase/ssr cookie(s) a browser would receive for a given
// access/refresh token pair, then convert to Playwright's addCookies() shape.
async function sessionCookiesForPlaywright(access_token, refresh_token) {
  const setCookies = [];
  const authForCookies = createServerClient(LOCAL_API_URL, LOCAL_ANON_KEY, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
  });
  const { error } = await authForCookies.auth.setSession({ access_token, refresh_token });
  if (error) throw new Error(`setSession failed: ${error.message}`);
  return setCookies.map((c) => ({
    name: c.name,
    value: c.value,
    url: BASE_URL,
    sameSite: "Lax",
    httpOnly: false,
  }));
}

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------
async function cleanupLeftovers(db) {
  const leftoverOrgs = await db.query(`select id from organizations where name = $1`, [
    TEST_ORG_NAME,
  ]);
  if (leftoverOrgs.rows.length > 0) {
    const ids = leftoverOrgs.rows.map((r) => r.id);
    // audit_logs rows get written for real by the app's own /api/audit route
    // when the session-persistence test's real password login triggers
    // recordAuthEvent("login") -- delete before profiles or the FK blocks it.
    await db.query(`delete from audit_logs where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from pipeline_history where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from applications where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from opportunities where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from funders where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from profiles where organization_id = any($1::uuid[])`, [ids]);
    await db.query(`delete from organizations where id = any($1::uuid[])`, [ids]);
    console.log(`Removed ${ids.length} leftover org(s) + dependents from a prior run.`);
  }
  for (const email of [OWNER_EMAIL, VIEWER_EMAIL]) {
    const listRes = await fetch(
      `${LOCAL_API_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      { headers: { apikey: LOCAL_SERVICE_ROLE_KEY, Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}` } },
    );
    if (listRes.ok) {
      const body = await listRes.json();
      const users = Array.isArray(body?.users) ? body.users : Array.isArray(body) ? body : [];
      for (const u of users) {
        if (u.email === email) {
          await fetch(`${LOCAL_API_URL}/auth/v1/admin/users/${u.id}`, {
            method: "DELETE",
            headers: { apikey: LOCAL_SERVICE_ROLE_KEY, Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}` },
          });
          console.log(`Removed leftover auth user from a prior run: ${u.id} (${email})`);
        }
      }
    }
  }
}

async function createAuthUser(email, password) {
  const res = await fetch(`${LOCAL_API_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: LOCAL_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ email, email_confirm: true, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`createUser failed for ${email}: ${res.status} ${JSON.stringify(body)}`);
  return body.id;
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

// A session-scoped supabase-js client (real bearer token, exactly what
// StageTransitionModal.tsx's createClient() call would hold once
// authenticated) -- used for every executeTransition() call below, not the
// service-role key, so the kanban tests reflect what a real signed-in user's
// browser is actually capable of, RLS included.
function sessionClient(access_token) {
  return createClient(LOCAL_API_URL, LOCAL_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function magicLinkSession(dbClient, email, userId) {
  const linkRes = await fetch(`${LOCAL_API_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: LOCAL_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const linkBody = await linkRes.json();
  if (!linkRes.ok || !linkBody.action_link) {
    throw new Error(`generate_link failed for ${email}: ${linkRes.status} ${JSON.stringify(linkBody)}`);
  }
  const verified = await followVerifyLink(linkBody.action_link);
  if (verified.flow !== "implicit") {
    throw new Error(`Expected an implicit-flow admin-generated magic link for ${email}, got flow="${verified.flow}".`);
  }
  const { access_token, refresh_token } = verified;
  const check = await independentUserCheck(access_token);
  if (check.status !== 200 || check.body.id !== userId) {
    throw new Error(`Independent session check failed for ${email}: ${JSON.stringify(check.body)}`);
  }
  return { access_token, refresh_token };
}

async function getStage(db, appId) {
  const r = await db.query(`select stage from applications where id = $1`, [appId]);
  return r.rows[0]?.stage ?? null;
}

async function getLatestHistoryRow(db, appId) {
  const r = await db.query(
    `select id, from_stage, to_stage, notes, changed_by, created_at from pipeline_history
     where application_id = $1 order by created_at desc limit 1`,
    [appId],
  );
  return r.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  assertNotProduction(LOCAL_DB_URL);
  assertNotProduction(LOCAL_API_URL);

  const db = new Client({ connectionString: LOCAL_DB_URL });
  await db.connect();
  console.log(`== Target check ==`);
  console.log(`Target: ${LOCAL_API_URL} (local Supabase CLI stack, non-production)`);
  console.log(`Production ref for comparison (must not appear as actual target): ${PRODUCTION_REF}`);
  console.log(``);

  await cleanupLeftovers(db);

  // --- Org, funders, opportunities, owner + viewer profiles ----------------
  const orgRes = await db.query(
    `insert into organizations (name, ein, mission_statement, onboarding_completed, onboarding_step)
     values ($1, $2, $3, true, 5) returning id`,
    [TEST_ORG_NAME, "44-4444444", "Test mission for PT-03-004 kanban+auth auditing."],
  );
  const orgId = orgRes.rows[0].id;
  console.log(`Org created: id=${orgId}`);

  const ownerId = await createAuthUser(OWNER_EMAIL, OWNER_INITIAL_PASSWORD);
  await db.query(
    `insert into profiles (id, organization_id, email, full_name, role) values ($1,$2,$3,$4,'owner')`,
    [ownerId, orgId, OWNER_EMAIL, "PT-03 Kanban Owner"],
  );
  const viewerId = await createAuthUser(VIEWER_EMAIL, "Pt03KanbanAuthViewer!2026");
  await db.query(
    `insert into profiles (id, organization_id, email, full_name, role) values ($1,$2,$3,$4,'viewer')`,
    [viewerId, orgId, VIEWER_EMAIL, "PT-03 Kanban Viewer"],
  );
  console.log(`Owner profile: ${ownerId} (role=owner). Viewer profile: ${viewerId} (role=viewer).`);

  async function makeFunderOpp(name, category, extra = {}) {
    const f = await db.query(
      `insert into funders (organization_id, name, category) values ($1,$2,$3) returning id`,
      [orgId, `${name} Funder`, category],
    );
    const o = await db.query(
      `insert into opportunities (organization_id, funder_id, name, category, required_documents, recurrence)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [orgId, f.rows[0].id, `${name} Opportunity`, category, extra.required_documents ?? [], extra.recurrence ?? null],
    );
    return o.rows[0].id;
  }
  const oppA = await makeFunderOpp("A-HappyPath", "housing_grant", { required_documents: [] });
  const oppB = await makeFunderOpp("B-DenyReapply", "government_grant", { recurrence: "annual" });
  const oppC = await makeFunderOpp("C-FollowUp+RoleGate", "education_grant", { required_documents: [] });
  const oppD = await makeFunderOpp("D-BypassTargets", "corporate_donation");
  console.log(`Opportunities created: A=${oppA} B=${oppB} C=${oppC} D=${oppD}`);
  console.log(``);

  // --- Real sessions ---------------------------------------------------------
  const ownerSess = await magicLinkSession(db, OWNER_EMAIL, ownerId);
  const viewerSess = await magicLinkSession(db, VIEWER_EMAIL, viewerId);
  const ownerClient = sessionClient(ownerSess.access_token);
  const viewerClient = sessionClient(viewerSess.access_token);
  console.log(`Real owner + viewer sessions established and independently confirmed live via /auth/v1/user.`);
  console.log(``);

  // ===========================================================================
  // PART 1 -- KANBAN
  // ===========================================================================
  console.log(`== PART 1: Kanban stage-transition matrix + enforcement ==`);

  // --- Full 12x12 transition-rule matrix (pure function, no DB) -------------
  const transitionMatrix = [];
  for (const from of PIPELINE_STAGES) {
    for (const to of PIPELINE_STAGES) {
      const rule = getTransitionRule(from, to);
      transitionMatrix.push({
        from,
        to,
        allowed: rule.allowed,
        direction: rule.direction,
        condition: rule.condition,
        requires_note: rule.requiresNote,
        reason: rule.reason ?? null,
      });
    }
  }
  console.log(
    `Transition matrix computed: ${transitionMatrix.length} pairs (${PIPELINE_STAGES.length}x${PIPELINE_STAGES.length}), ` +
      `${transitionMatrix.filter((r) => r.allowed).length} allowed, ${transitionMatrix.filter((r) => !r.allowed).length} disallowed.`,
  );

  // --- Journeys: drive real applications through legal transitions ----------
  const journeys = [];
  const appOpportunity = new Map(); // application_id -> opportunity_id, so runStep can pass a real FK through executeTransition (required for the creates_new_application branch's own insert).

  async function insertApp(opportunityId, requestedAmount = 50000) {
    const r = await db.query(
      `insert into applications (organization_id, opportunity_id, stage, requested_amount)
       values ($1,$2,'discovered',$3) returning id`,
      [orgId, opportunityId, requestedAmount],
    );
    appOpportunity.set(r.rows[0].id, opportunityId);
    return r.rows[0].id;
  }

  async function runStep(journeySteps, client, app, target, condition, note, label) {
    const before = await getStage(db, app);
    const rule = getTransitionRule(before, target);
    const opportunityId = appOpportunity.get(app);
    let executed = false;
    let errorMsg = null;
    let newAppId = null;
    try {
      await executeTransition({
        supabase: client,
        application: { id: app, stage: before, organization_id: orgId, opportunity_id: opportunityId, requested_amount: null },
        target,
        condition,
        changedBy: null,
        note,
      });
      executed = true;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    }
    const after = await getStage(db, app);
    const history = await getLatestHistoryRow(db, app);
    let newAppStage = null;
    if (condition === "creates_new_application") {
      const newest = await db.query(
        `select id, stage from applications where organization_id=$1 and opportunity_id=$2 and stage='discovered' and id != $3 order by created_at desc limit 1`,
        [orgId, opportunityId, app],
      );
      newAppId = newest.rows[0]?.id ?? null;
      newAppStage = newest.rows[0]?.stage ?? null;
      if (newAppId) appOpportunity.set(newAppId, opportunityId);
    }
    const step = {
      label,
      from_stage: before,
      to_stage: target,
      condition,
      requires_note: rule.requiresNote,
      note: note ?? null,
      rule_allowed: rule.allowed,
      executed,
      error: errorMsg,
      stage_after: after,
      new_application_id: newAppId,
      new_application_stage: newAppStage,
      pipeline_history: history
        ? { from_stage: history.from_stage, to_stage: history.to_stage, notes: history.notes, created_at: history.created_at }
        : null,
      assertion: {
        // "target" for a creates_new_application call is "discovered" (what
        // the NEW application's stage should be) -- the ORIGINAL application
        // is not touched by this branch at all (executeTransition() returns
        // before its normal .update() path), so the original row's stage
        // must equal `before`, unchanged, while the new row's stage is what
        // must equal `target`.
        pass:
          condition === "creates_new_application"
            ? executed && newAppId !== null && newAppStage === target && after === before
            : executed && after === target && history?.to_stage === target,
        description:
          condition === "creates_new_application"
            ? `Legal transition (creates_new_application): original application stays at "${before}" (unchanged), a NEW application was created in "${target}".`
            : `Legal transition persisted: stage moved ${before} -> ${target}, pipeline_history recorded to_stage="${target}".`,
      },
    };
    journeySteps.push(step);
    console.log(`  [${label}] ${before} -> ${target} :: executed=${executed} stage_after=${after} pass=${step.assertion.pass}`);
    if (!step.assertion.pass) {
      recordFinding(
        "kanban",
        "P1",
        `Legal transition step "${label}" (${before} -> ${target}) did not persist as expected.`,
        step,
      );
    }
    return newAppId;
  }

  // --- Journey A: full happy-path arc + a legal backward move ---------------
  {
    const app = await insertApp(oppA);
    const steps = [];
    await runStep(steps, ownerClient, app, "eligibility_review", "none", null, "discover -> eligibility review");
    await db.query(`update opportunities set eligibility_score = 82 where id = $1`, [oppA]);
    await runStep(steps, ownerClient, app, "qualified", "eligibility_score_exists", null, "eligibility review -> qualified (score now exists)");
    // Legal backward move, mandatory note.
    await runStep(steps, ownerClient, app, "eligibility_review", "none", "Reopening for a second eligibility pass before drafting.", "BACKWARD: qualified -> eligibility review (note supplied)");
    await runStep(steps, ownerClient, app, "qualified", "eligibility_score_exists", null, "eligibility review -> qualified (re-forward)");
    await runStep(steps, ownerClient, app, "drafting", "none", null, "qualified -> drafting");
    await db.query(`update applications set draft_content = 'Real draft narrative content for PT-03-004 kanban journey A.' where id = $1`, [app]);
    await runStep(steps, ownerClient, app, "awaiting_documents", "draft_not_empty", null, "drafting -> awaiting documents (draft now non-empty)");
    await runStep(steps, ownerClient, app, "ready_for_review", "documents_attached", null, "awaiting documents -> ready for review (0 required documents)");
    await runStep(steps, ownerClient, app, "submitted", "compliance_check", null, "ready for review -> submitted (manual compliance confirm)");
    await runStep(steps, ownerClient, app, "awarded", "none", null, "submitted -> awarded");
    await runStep(steps, ownerClient, app, "reporting_required", "none", null, "awarded -> reporting required");
    const newAppId = await runStep(steps, ownerClient, app, "renewal_opportunity", "report_submitted", null, "reporting required -> renewal opportunity (manual report confirm)");
    const newApp2 = await runStep(steps, ownerClient, app, "discovered", "creates_new_application", "Starting the next funding cycle.", "renewal opportunity -> discovered (NEW application created for next cycle)");
    journeys.push({ label: "A: full happy-path arc + legal backward move + renewal cycle", application_id: app, steps, new_cycle_application_id: newApp2 });
  }

  // --- Journey B: denial + recurring-opportunity reapply ---------------------
  {
    const app = await insertApp(oppB);
    const steps = [];
    await runStep(steps, ownerClient, app, "eligibility_review", "none", null, "discover -> eligibility review");
    await db.query(`update opportunities set eligibility_score = 30 where id = $1`, [oppB]);
    await runStep(steps, ownerClient, app, "denied", "eligibility_score_exists", null, "eligibility review -> denied (score exists, alternate edge)");
    await runStep(steps, ownerClient, app, "discovered", "opportunity_recurring", null, "denied -> discovered (reapply: SAME row, opportunity recurs annually)");
    journeys.push({ label: "B: denial + recurring-opportunity reapply (same row, not a new one)", application_id: app, steps });
  }

  // --- Journey C: follow-up path + embedded role-gate bypass ----------------
  let roleGateBypass;
  {
    const app = await insertApp(oppC);
    const steps = [];
    await runStep(steps, ownerClient, app, "eligibility_review", "none", null, "discover -> eligibility review");
    await db.query(`update opportunities set eligibility_score = 70 where id = $1`, [oppC]);
    await runStep(steps, ownerClient, app, "qualified", "eligibility_score_exists", null, "eligibility review -> qualified");
    await runStep(steps, ownerClient, app, "drafting", "none", null, "qualified -> drafting");
    await db.query(`update applications set draft_content = 'Real draft narrative for journey C.' where id = $1`, [app]);
    await runStep(steps, ownerClient, app, "awaiting_documents", "draft_not_empty", null, "drafting -> awaiting documents");
    await runStep(steps, ownerClient, app, "ready_for_review", "documents_attached", null, "awaiting documents -> ready for review");

    // ROLE-GATE TEST: canMoveToStage("submitted", "viewer") must be false --
    // confirm the pure function says so, then have the VIEWER session
    // actually perform the transition anyway (the real bypass: nothing
    // downstream of the React modal's role check re-verifies role).
    const roleRuleViewer = canMoveToStage("submitted", "viewer");
    const roleRuleOwner = canMoveToStage("submitted", "owner");
    const beforeViewerAttempt = await getStage(db, app);
    let viewerExecuted = false;
    let viewerError = null;
    try {
      await executeTransition({
        supabase: viewerClient,
        application: { id: app, stage: beforeViewerAttempt, organization_id: orgId, opportunity_id: appOpportunity.get(app), requested_amount: null },
        target: "submitted",
        condition: "compliance_check",
        changedBy: viewerId,
        note: null,
      });
      viewerExecuted = true;
    } catch (err) {
      viewerError = err instanceof Error ? err.message : String(err);
    }
    const afterViewerAttempt = await getStage(db, app);
    roleGateBypass = {
      label: "role-gate bypass: viewer-role session executes ready_for_review -> submitted (owner/admin-only per canMoveToStage)",
      application_id: app,
      canMoveToStage_viewer: roleRuleViewer,
      canMoveToStage_owner: roleRuleOwner,
      viewer_attempted_write: true,
      viewer_write_threw: !viewerExecuted,
      viewer_error: viewerError,
      stage_before: beforeViewerAttempt,
      stage_after: afterViewerAttempt,
      outcome: afterViewerAttempt === "submitted" ? "PERSISTED_DESPITE_ROLE_RULE" : "REJECTED",
    };
    console.log(
      `  [role-gate bypass] canMoveToStage(submitted, viewer)=${roleRuleViewer} canMoveToStage(submitted, owner)=${roleRuleOwner} :: viewer write outcome=${roleGateBypass.outcome}`,
    );
    if (roleGateBypass.outcome === "PERSISTED_DESPITE_ROLE_RULE") {
      roleGateBypass.finding_id = recordFinding(
        "kanban",
        "P1",
        `canMoveToStage() says only owner/admin may move an application to "submitted", but a "viewer"-role session's direct executeTransition() call persisted the exact same transition. The role gate is enforced only in StageTransitionModal.tsx's client-side canConfirm check -- executeTransition() itself, and the database (RLS "applications_org_isolation" scopes rows by organization only, not by role or target stage value), apply no equivalent check.`,
        roleGateBypass,
      );
    }
    steps.push({
      label: roleGateBypass.label,
      ...roleGateBypass,
      assertion: {
        pass: true, // the bypass attempt itself was successfully tested and its real result recorded -- see enforcement_gap_tests / findings for whether the underlying app behavior was good.
        description: `Role-gate bypass attempt recorded with a real outcome: ${roleGateBypass.outcome}.`,
      },
    });

    // Continue the journey as owner from wherever it actually landed, to
    // reach the two remaining un-visited stages (follow_up_due, denied).
    if (afterViewerAttempt !== "submitted") {
      // Role gate held (shouldn't happen per the code read, but handle it
      // honestly either way): finish the legal step as owner.
      await runStep(steps, ownerClient, app, "submitted", "compliance_check", null, "ready for review -> submitted (owner, since viewer attempt above did not persist)");
    }
    await runStep(steps, ownerClient, app, "follow_up_due", "none", null, "submitted -> follow-up due");
    await runStep(steps, ownerClient, app, "denied", "none", null, "follow-up due -> denied");
    journeys.push({ label: "C: follow-up path + embedded role-gate bypass test", application_id: app, steps });
  }

  const stagesVisited = new Set();
  for (const j of journeys) {
    for (const s of j.steps) {
      if (s.to_stage) stagesVisited.add(s.to_stage);
    }
  }
  stagesVisited.add("discovered"); // every app starts here
  const stagesVisitedArr = [...stagesVisited].sort();
  const missingStages = PIPELINE_STAGES.filter((s) => !stagesVisited.has(s));
  console.log(`Stages visited across all journeys: ${stagesVisitedArr.join(", ")}`);
  if (missingStages.length > 0) {
    recordFinding("kanban", "P1", `The following documented pipeline stages were never reached by any journey: ${missingStages.join(", ")}.`, { missingStages });
  }
  console.log(``);

  // --- Illegal transitions: rule-function rejection -------------------------
  const illegalCases = [
    { from: "discovered", to: "drafting" },
    { from: "discovered", to: "awarded" },
    { from: "discovered", to: "discovered" },
    { from: "eligibility_review", to: "submitted" },
    { from: "qualified", to: "submitted" },
    { from: "denied", to: "renewal_opportunity" },
  ];
  const illegalRuleTests = illegalCases.map(({ from, to }) => {
    const rule = getTransitionRule(from, to);
    const pass = rule.allowed === false;
    if (!pass) {
      recordFinding("kanban", "P0", `getTransitionRule(${from}, ${to}) returned allowed=true for a transition that should be an illegal stage-skip.`, rule);
    }
    console.log(`  [illegal rule check] ${from} -> ${to} :: allowed=${rule.allowed} (expected false) pass=${pass}`);
    return { from, to, rule: { allowed: rule.allowed, direction: rule.direction, condition: rule.condition, requires_note: rule.requiresNote, reason: rule.reason ?? null }, assertion: { pass, description: `getTransitionRule correctly reports this stage-skip as disallowed.` } };
  });
  console.log(``);

  // --- Enforcement-gap tests: does anything below the rule function stop a
  //     write that the rule function itself says is illegal? -----------------
  const enforcementGapTests = [];

  // (a) direct executeTransition() bypass, illegal skip, real owner session.
  {
    const app = await insertApp(oppD);
    const from = "discovered";
    const to = "drafting";
    const rule = getTransitionRule(from, to);
    let executed = false;
    let errorMsg = null;
    try {
      await executeTransition({
        supabase: ownerClient,
        application: { id: app, stage: from, organization_id: orgId, opportunity_id: appOpportunity.get(app), requested_amount: null },
        target: to,
        condition: "none",
        changedBy: ownerId,
        note: null,
      });
      executed = true;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    }
    const after = await getStage(db, app);
    const outcome = after === to ? "PERSISTED" : "REJECTED";
    const test = {
      id: "executeTransition_direct_bypass",
      label: "direct executeTransition() call with an illegal stage-skip target, bypassing StageTransitionModal's UI-layer canConfirm gate (the only call site that checks getTransitionRule() before invoking executeTransition)",
      application_id: app,
      from,
      to,
      ui_rule: { allowed: rule.allowed, reason: rule.reason ?? null },
      write_threw: !executed,
      write_error: errorMsg,
      stage_after: after,
      outcome,
    };
    console.log(`  [enforcement gap a] executeTransition(${from} -> ${to}) directly, no UI gate :: outcome=${outcome}`);
    if (outcome === "PERSISTED") {
      test.finding_id = recordFinding(
        "kanban",
        "P0",
        `getTransitionRule(discovered, drafting) correctly reports this stage-skip as illegal (allowed=false), but executeTransition() itself performs no such check -- calling it directly (as any caller other than StageTransitionModal.tsx would have to, since it is the pipeline's own exported, reusable function) silently persisted the illegal skip: applications.stage was written to "drafting" and a pipeline_history row was created recording from_stage="discovered", to_stage="drafting" as if it were a normal transition. The transition graph is enforced ONLY inside one React component's pre-submit check, nowhere in the reusable executor, an API route (none exists for stage mutation), or the database (no CHECK constraint or trigger on applications.stage transitions; pipeline_stage is a plain enum with no transition awareness).`,
        test,
      );
    }
    enforcementGapTests.push(test);
  }

  // (b) raw DB write, no executeTransition involved at all, illegal skip.
  {
    const app = await insertApp(oppD);
    const from = "discovered";
    const to = "awarded";
    const rule = getTransitionRule(from, to);
    const { error } = await ownerClient.from("applications").update({ stage: to }).eq("id", app);
    const after = await getStage(db, app);
    const outcome = after === to ? "PERSISTED" : "REJECTED";
    const test = {
      id: "raw_update_bypass",
      label: "raw supabase.from(\"applications\").update({stage}) call, entirely outside executeTransition() -- tests whether RLS or a DB constraint provides any backstop",
      application_id: app,
      from,
      to,
      ui_rule: { allowed: rule.allowed, reason: rule.reason ?? null },
      supabase_error: error?.message ?? null,
      stage_after: after,
      outcome,
    };
    console.log(`  [enforcement gap b] raw .update({stage:"${to}"}) on a "${from}" row, no executeTransition at all :: outcome=${outcome}`);
    if (outcome === "PERSISTED") {
      test.finding_id = recordFinding(
        "kanban",
        "P0",
        `A raw applications.update({stage:"awarded"}) call -- with no call to executeTransition() at all -- against a "discovered"-stage row, from a real authenticated session that is a member of the row's own organization, persisted with no error. The applications_org_isolation RLS policy (migration 001) scopes rows by organization_id only; it places no constraint on what value "stage" may be set to or on which prior stage value a given target is reachable from. There is no CHECK constraint, trigger, or any other database-level mechanism enforcing BEHAVIORAL_CONTRACTS Sec6's transition graph. Any authenticated writer-or-above session (or a bug in a future UI surface) can set any application straight to "awarded" from "discovered" with a single REST call.`,
        test,
      );
    }
    enforcementGapTests.push(test);
  }

  enforcementGapTests.push({ id: "role_gate_bypass", ...roleGateBypass });
  console.log(``);

  const kanban = {
    stage_count: PIPELINE_STAGES.length,
    stages: [...PIPELINE_STAGES],
    transition_matrix: transitionMatrix,
    journeys,
    stages_visited: stagesVisitedArr,
    illegal_transition_rule_tests: illegalRuleTests,
    enforcement_gap_tests: enforcementGapTests,
  };

  // ===========================================================================
  // PART 2 -- AUTH FLOWS
  // ===========================================================================
  console.log(`== PART 2: Auth flows (real, on local stack) ==`);

  console.log(`Starting local dev server on port ${DEV_PORT}...`);
  const { child: devChild, getOutput } = startDevServer();
  const devUp = await waitForServer(`${BASE_URL}/login`, 90_000);
  if (!devUp) {
    stopDevServer(devChild);
    throw new Error(`Dev server did not come up on ${BASE_URL} within 90s. Output tail: ${getOutput().slice(-2000)}`);
  }
  console.log(`Dev server up: GET ${BASE_URL}/login OK`);
  console.log(``);

  const browser = await chromium.launch();
  const authFlows = {};
  // Tracks whatever password is ACTUALLY valid for OWNER_EMAIL right now --
  // updated below only if the password-reset flow really changed it. The
  // session-persistence test signs in with whichever password is real at
  // that point, so a defect in the reset flow doesn't spuriously block the
  // (separate) reload-persistence test from running at all.
  let currentOwnerPassword = OWNER_INITIAL_PASSWORD;

  try {
    // ------------------------------------------------------------------
    // Password reset
    // ------------------------------------------------------------------
    console.log(`-- Password reset --`);
    {
      const steps = [];
      const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error" || msg.type() === "warning") consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
      });
      page.on("pageerror", (err) => consoleErrors.push(`[pageerror] ${err.message}`));

      await page.goto(`${BASE_URL}/forgot-password`);
      await page.fill("#email", OWNER_EMAIL);
      const cookiesBeforeSubmit = await context.cookies();
      const beforeMail = await (
        await fetch(`${LOCAL_MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${OWNER_EMAIL}`)}`)
      ).json();
      await page.click('button[type="submit"]');
      await page.waitForSelector('[role="status"]', { timeout: 10_000 });
      const sentShot = await shot(page, "auth-01-forgot-password-sent");
      steps.push({ step: "submit /forgot-password form", email: OWNER_EMAIL, ui_confirmed_sent: true, screenshot: sentShot });

      const { full } = await fetchLatestMailFor(OWNER_EMAIL, beforeMail.messages.length, 10_000);
      const subjectOk = /reset/i.test(full.Subject);
      steps.push({ step: "real recovery email delivered via Mailpit", subject: full.Subject, subject_confirms_reset: subjectOk });

      const verifyLink = extractVerifyLink(full);
      const verified = await followVerifyLink(verifyLink);
      steps.push({
        step: "followed real /auth/v1/verify link",
        flow: verified.flow,
        redirect_status: verified.redirectStatus,
        detail:
          verified.flow === "pkce"
            ? "Real browser client (ForgotPasswordPageClient.tsx's createClient(), @supabase/ssr default) used PKCE -- redirect carried a real one-time ?code=, exchanged by the SAME Playwright page/context that originally requested the reset (so its code_verifier cookie is present), via ResetPasswordPageClient.tsx's own exchangeCodeForSession(code) call -- not simulated here."
            : "Redirect carried real #access_token=/refresh_token= hash tokens (implicit flow), auto-detected by the browser client on page load.",
      });

      if (verified.flow === "pkce") {
        await page.goto(`${BASE_URL}/reset-password?code=${verified.code}`);
      } else {
        await page.goto(`${BASE_URL}/reset-password#access_token=${verified.access_token}&refresh_token=${verified.refresh_token}&type=${verified.type}`);
      }
      await page.waitForSelector("h1", { timeout: 10_000 });
      const h1Text = await page.locator("h1").first().innerText();
      const linkErrorShown = h1Text.includes("no longer valid");
      const cookiesAtExchange = await context.cookies();
      steps.push({
        step: "landed on real /reset-password page with real recovery credentials",
        heading: h1Text,
        link_error_shown: linkErrorShown,
        cookie_names_before_submit: cookiesBeforeSubmit.map((c) => c.name),
        cookie_names_at_exchange: cookiesAtExchange.map((c) => c.name),
        console_errors: consoleErrors.slice(),
      });
      if (linkErrorShown) {
        recordFinding(
          "auth",
          "P0",
          `A real, freshly-issued recovery link (not expired, not reused) was rejected by /reset-password as invalid, even though the underlying PKCE code exchange genuinely succeeds server-side. Root-caused by direct instrumentation of ResetPasswordPageClient.tsx (added temporarily, then reverted -- confirmed via "git diff" this repo carries no trace of it): its mount useEffect calls supabase.auth.exchangeCodeForSession(code) with no idempotency guard (no ref/flag preventing a repeat call, no AbortController, no cleanup). Because this app has reactStrictMode: true (next.config.mjs), React 18/19 Strict Mode double-invokes every effect on every mount in "next dev" -- exactly the "local/branch" execution context this task audits. The two invocations race for the single-use PKCE code_verifier stored in the "sb-127-auth-token-code-verifier" cookie: a real network response (200, confirmed via response capture) shows the exchange DOES succeed and a real session is briefly established, but the losing invocation's own exchangeCodeForSession call then fails with AuthPKCECodeVerifierMissingError (the verifier was already consumed) and calls setLinkError(true) unconditionally, with no check for whether a sibling invocation already succeeded -- so the user is shown "This link is no longer valid" for a link that, in fact, was completely valid and was actually exchanged successfully. This reproduces deterministically (confirmed across three separate diagnostic runs, with the target route pre-warmed to rule out a Next.js dev-server first-compile/Fast-Refresh remount as the cause). Not independently verified against a production build ("next build && next start", where Strict Mode's double-invoke does not occur) in this session -- stated as a real, current "next dev" defect, not asserted as a confirmed production-impacting one.`,
          { heading: h1Text, cookie_names_before_submit: cookiesBeforeSubmit.map((c) => c.name), cookie_names_at_exchange: cookiesAtExchange.map((c) => c.name), console_errors: consoleErrors.slice() },
        );
      }

      let reachedDashboard = false;
      if (!linkErrorShown) {
        await page.fill("#password", OWNER_NEW_PASSWORD);
        await page.fill("#confirmPassword", OWNER_NEW_PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForURL(/\/dashboard/, { timeout: 15_000 }).catch(() => {});
        const urlAfterSubmit = page.url();
        reachedDashboard = /\/dashboard/.test(urlAfterSubmit);
        const finalShot = await shot(page, "auth-02-reset-password-complete");
        steps.push({ step: "submitted new password via real form", new_password_form_submitted: true, url_after: urlAfterSubmit, reached_dashboard: reachedDashboard, screenshot: finalShot });
        if (!reachedDashboard) {
          recordFinding("auth", "P0", `Submitting a new password on /reset-password with a real, valid recovery session did not land the user on /dashboard. Landed on: ${urlAfterSubmit}`, { urlAfterSubmit });
        }
      } else {
        const blockedShot = await shot(page, "auth-02-reset-password-complete");
        steps.push({
          step: "password form was not reachable -- the page rendered the link-invalid error block instead (see the finding above), so no new password could be submitted through the UI",
          new_password_form_submitted: false,
          screenshot: blockedShot,
        });
      }

      // Independent re-verification against the live Auth server -- not
      // trusted from the UI's own state. Expected outcome depends on whether
      // the UI actually let a new password through: if it did, the OLD
      // password should now be rejected and the NEW one accepted; if the
      // link-invalid bug blocked the form (as currently reproduces, see
      // above), the password was never changed, so the ORIGINAL password
      // should still work and the "new" one should NOT.
      const anon = createClient(LOCAL_API_URL, LOCAL_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      const oldPwCheck = await anon.auth.signInWithPassword({ email: OWNER_EMAIL, password: OWNER_INITIAL_PASSWORD });
      const newPwCheck = await anon.auth.signInWithPassword({ email: OWNER_EMAIL, password: OWNER_NEW_PASSWORD });
      const oldPwAccepted = !oldPwCheck.error && !!oldPwCheck.data?.session;
      const newPwAccepted = !newPwCheck.error && !!newPwCheck.data?.session;
      const passwordActuallyChanged = reachedDashboard ? !oldPwAccepted && newPwAccepted : oldPwAccepted && !newPwAccepted;
      if (newPwAccepted) currentOwnerPassword = OWNER_NEW_PASSWORD;
      steps.push({
        step: "independent live re-verification against GoTrue (not the UI)",
        old_password_accepted: oldPwAccepted,
        old_password_error: oldPwCheck.error?.message ?? null,
        new_password_accepted: newPwAccepted,
        expected_given_ui_outcome: reachedDashboard ? "old rejected, new accepted (password was changed)" : "old still accepted, new rejected (password was never actually changed, since the UI never let the form submit)",
        matches_expectation: passwordActuallyChanged,
      });
      if (!passwordActuallyChanged) {
        recordFinding("auth", "P0", `The account's real, live authentication state (old/new password acceptance) does not match what the UI's own outcome implied.`, { reachedDashboard, oldPwAccepted, newPwAccepted });
      }

      const pass = subjectOk && !linkErrorShown && reachedDashboard && passwordActuallyChanged;
      authFlows.password_reset = { steps, outcome: pass ? "PASS" : "FAIL" };
      console.log(`Password reset outcome: ${authFlows.password_reset.outcome}`);
      await context.close();
    }
    console.log(``);

    // ------------------------------------------------------------------
    // Magic-link login
    // ------------------------------------------------------------------
    console.log(`-- Magic-link login --`);
    {
      const steps = [];
      steps.push({
        step: "scope note",
        detail:
          "/login has no magic-link UI trigger (password-only form, confirmed by reading LoginPageClient.tsx before writing this test) and no in-app page auto-consumes a bare magic-link hash redirect the way /reset-password does for recovery tokens (confirmed by reading every page for a mount-time createClient()+detectSessionInUrl call; only ResetPasswordPageClient.tsx has one). This test exercises the real, underlying Supabase Auth capability end to end via the same self-service signInWithOtp() an in-app trigger would call, and confirms the resulting session is accepted by the app's real middleware-gated pages once its cookies are present in the browser -- the mechanism this app WOULD use if a magic-link UI entry point existed.",
      });

      const beforeMail = await (
        await fetch(`${LOCAL_MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${OWNER_EMAIL}`)}`)
      ).json();
      const anon = createClient(LOCAL_API_URL, LOCAL_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error: otpError } = await anon.auth.signInWithOtp({ email: OWNER_EMAIL });
      steps.push({ step: "real self-service signInWithOtp() call", email: OWNER_EMAIL, error: otpError?.message ?? null });

      const { full } = await fetchLatestMailFor(OWNER_EMAIL, beforeMail.messages.length, 10_000);
      const subjectOk = /magic/i.test(full.Subject);
      steps.push({ step: "real magic-link email delivered via Mailpit", subject: full.Subject, subject_confirms_magic_link: subjectOk });

      const verifyLink = extractVerifyLink(full);
      const verified = await followVerifyLink(verifyLink);
      if (verified.flow !== "implicit") {
        throw new Error(`Expected implicit-flow hash tokens from the self-service magic link (plain @supabase/supabase-js client, not the app's PKCE-default browser client), got flow="${verified.flow}".`);
      }
      const { access_token, refresh_token, type, redirectStatus } = verified;
      steps.push({ step: "followed real /auth/v1/verify link, extracted hash tokens", type, redirect_status: redirectStatus, tokens_present: true, type_is_magiclink: type === "magiclink" });

      const check = await independentUserCheck(access_token);
      steps.push({ step: "independent GET /auth/v1/user with the issued token", status: check.status, id_matches: check.body?.id === ownerId, email_matches: check.body?.email === OWNER_EMAIL });

      const cookies = await sessionCookiesForPlaywright(access_token, refresh_token);
      steps.push({ step: "built real @supabase/ssr session cookie(s) from the magic-link tokens", cookie_names: cookies.map((c) => c.name) });

      const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
      await context.addCookies(cookies);
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
      const urlAfter = page.url();
      const landedOnDashboard = /\/dashboard/.test(urlAfter);
      const bodyText = await page.locator("body").innerText();
      const showsLoginForm = /sign in to your organization/i.test(bodyText);
      const magicShot = await shot(page, "auth-03-magic-link-dashboard");
      steps.push({
        step: "navigated a real Playwright browser context (cookies injected, no credentials re-entered) to /dashboard",
        url_after: urlAfter,
        landed_on_dashboard: landedOnDashboard,
        redirected_to_login: showsLoginForm,
        screenshot: magicShot,
      });
      if (!landedOnDashboard || showsLoginForm) {
        recordFinding("auth", "P0", `A real magic-link-issued session (valid per an independent /auth/v1/user check) was not accepted by the app's own middleware -- the browser was redirected to /login instead of rendering /dashboard.`, { urlAfter });
      }

      const pass = subjectOk && check.status === 200 && check.body?.id === ownerId && landedOnDashboard && !showsLoginForm;
      authFlows.magic_link_login = { steps, outcome: pass ? "PASS" : "FAIL" };
      console.log(`Magic-link login outcome: ${authFlows.magic_link_login.outcome}`);
      await context.close();
    }
    console.log(``);

    // ------------------------------------------------------------------
    // Session persistence across a reload
    // ------------------------------------------------------------------
    console.log(`-- Session persistence across a reload --`);
    {
      const steps = [];
      const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
      const page = await context.newPage();

      await page.goto(`${BASE_URL}/login`);
      await page.fill("#email", OWNER_EMAIL);
      // Uses whichever password is ACTUALLY valid right now (see
      // currentOwnerPassword's own comment) so a defect in the separate
      // password-reset flow above doesn't block this, independent, test.
      await page.fill("#password", currentOwnerPassword);
      await page.click('button[type="submit"]');
      await page.waitForURL(/\/dashboard/, { timeout: 15_000 }).catch(() => {});
      const urlAfterLogin = page.url();
      const loggedIn = /\/dashboard/.test(urlAfterLogin);
      const cookiesBefore = await context.cookies();
      const loginShot = await shot(page, "auth-04-password-login-dashboard");
      steps.push({
        step: "real password sign-in via the actual /login form",
        password_used: currentOwnerPassword === OWNER_NEW_PASSWORD ? "new (post-reset)" : "original (password-reset flow above did not actually change it -- see its own finding)",
        url_after_login: urlAfterLogin,
        landed_on_dashboard: loggedIn,
        cookie_names_before_reload: cookiesBefore.map((c) => c.name),
        screenshot: loginShot,
      });
      if (!loggedIn) {
        recordFinding("auth", "P0", `Real password sign-in via the /login form did not land on /dashboard.`, { urlAfterLogin });
      }

      await page.reload({ waitUntil: "networkidle" });
      const urlAfterReload = page.url();
      const stillOnDashboard = /\/dashboard/.test(urlAfterReload);
      const bodyAfterReload = await page.locator("body").innerText();
      const bouncedToLogin = /sign in to your organization/i.test(bodyAfterReload);
      const cookiesAfter = await context.cookies();
      const reloadShot = await shot(page, "auth-05-after-reload");
      steps.push({
        step: "page.reload() -- a genuine new HTTP request through the app's middleware, not a client-side soft nav",
        url_after_reload: urlAfterReload,
        still_on_dashboard: stillOnDashboard,
        bounced_to_login: bouncedToLogin,
        cookie_names_after_reload: cookiesAfter.map((c) => c.name),
        auth_cookie_still_present: cookiesAfter.some((c) => c.name.startsWith("sb-")),
        screenshot: reloadShot,
      });
      if (!stillOnDashboard || bouncedToLogin) {
        recordFinding("auth", "P0", `A full page reload of an authenticated /dashboard session bounced the user to /login -- the session did not persist across a reload.`, { urlAfterReload });
      }

      // Bonus real check: a second tab in the same cookie-jar context lands
      // authenticated too, without re-entering credentials.
      const page2 = await context.newPage();
      await page2.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
      const secondTabDashboard = /\/dashboard/.test(page2.url());
      steps.push({ step: "second page in the same browser context (same cookie jar) also lands on /dashboard with no re-authentication", second_tab_landed_on_dashboard: secondTabDashboard });
      if (!secondTabDashboard) {
        recordFinding("auth", "P1", `A second tab in the same authenticated browser context did not reuse the session cookie to reach /dashboard.`, { url: page2.url() });
      }

      const pass = loggedIn && stillOnDashboard && !bouncedToLogin && secondTabDashboard;
      authFlows.session_persistence_reload = { steps, outcome: pass ? "PASS" : "FAIL" };
      console.log(`Session persistence outcome: ${authFlows.session_persistence_reload.outcome}`);
      await context.close();
    }
  } finally {
    await browser.close().catch(() => {});
    stopDevServer(devChild);
    await new Promise((r) => setTimeout(r, 500));
  }

  await db.end();

  const output = {
    generated_at: nowIso(),
    target: {
      host: "127.0.0.1",
      port: "56322",
      api_base: LOCAL_API_URL,
      is_production: false,
      production_ref_for_comparison: PRODUCTION_REF,
    },
    kanban,
    auth_flows: authFlows,
    findings,
    screenshots: allScreenshots,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "kanban-auth.json"), JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(``);
  console.log(`== Summary ==`);
  console.log(`Kanban: ${transitionMatrix.length}-pair matrix; ${journeys.length} journeys covering ${stagesVisitedArr.length}/${PIPELINE_STAGES.length} stages; ${illegalRuleTests.length} illegal-transition rule checks; ${enforcementGapTests.length} enforcement-gap bypass tests.`);
  console.log(`Auth flows: password_reset=${authFlows.password_reset?.outcome} magic_link_login=${authFlows.magic_link_login?.outcome} session_persistence_reload=${authFlows.session_persistence_reload?.outcome}`);
  console.log(`Total findings: ${findings.length}`);
  console.log(`Written: test-evidence/pt-03/kanban-auth.json`);

  if (findings.some((f) => f.severity === "P0")) {
    console.log(`Note: P0 findings were recorded above (as instructed, an unenforced illegal transition or a broken auth flow is a finding, not a failure of this harness).`);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exitCode = 1;
});
