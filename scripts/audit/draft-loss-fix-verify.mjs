// Real, evidence-standard verification of the WGR-129 fix (silent AI-draft
// data loss): a real dev server against the already-running local Supabase
// stack, a real authenticated writer session (no browser needed — real
// signInWithPassword + real @supabase/ssr cookie derivation, same pattern as
// pt02-004-crud-cycles.mjs), and TWO real POST /api/ai/draft calls (real
// Claude generations, not mocked):
//
//   1. FAILURE case: the draft_versions.version_number auto-assign trigger
//      (trg_set_draft_version_number) is dropped first — reproducing the
//      exact real failure mode WGR-129's own root-cause finding documents
//      (version_number NOT NULL, no default, no trigger => insert fails).
//      Asserts the endpoint now returns a real error status (not 200), zero
//      draft_versions rows exist for the call, and agent_runs is marked
//      'failed' — proving generateDraft() no longer swallows the failure.
//   2. SUCCESS case: the trigger is restored, a second real draft is
//      generated. Asserts a 200, a real draft_versions row exists, and its
//      `content` matches the response body's `content` byte-for-byte.
//
// Run: node scripts/audit/draft-loss-fix-verify.mjs
// Requires the local Supabase stack (`.pt05-local-stack`) already running.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { Client } from "pg";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import ws from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "remediation", "draft-loss-fix");
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROD_REF = "vbjplpquqxxfbpazyalt";
const LOCAL_API_URL = "http://127.0.0.1:56321";
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const DEV_PORT = 3306;
const BASE_URL = `http://localhost:${DEV_PORT}`;
const REALTIME_OPT = { realtime: { transport: ws } };

const TEST_EMAIL = "draft-loss-fix-verify@wgr129.local";
const PASSWORD = "DraftLossFix!2026";
const TEST_ORG_NAME = "WGR-129 Draft Loss Fix Verify Org";

function assertNotProd() {
  if (LOCAL_DB_URL.includes(PROD_REF) || LOCAL_API_URL.includes(PROD_REF)) {
    throw new Error("HARD STOP: target looks like production. Aborting.");
  }
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function startDevServer() {
  const devEnv = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: LOCAL_API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: LOCAL_SERVICE_KEY,
    PORT: String(DEV_PORT),
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
      /* already exited */
    }
  } else {
    child.kill();
  }
}

async function setupFixtures(db) {
  const admin = createServiceClient(LOCAL_API_URL, LOCAL_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...REALTIME_OPT,
  });

  // Re-runnable: clean up any prior run's fixtures first.
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  for (const u of existingUsers?.users ?? []) {
    if (u.email === TEST_EMAIL) await admin.auth.admin.deleteUser(u.id);
  }
  await admin.from("organizations").delete().eq("name", TEST_ORG_NAME);

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({
      name: TEST_ORG_NAME,
      onboarding_completed: true,
      mission_statement: "A throwaway test org for WGR-129 draft-loss-fix verification.",
    })
    .select("id")
    .single();
  if (orgErr) throw new Error("org insert failed: " + orgErr.message);
  const orgId = org.id;

  const { data: opp, error: oppErr } = await admin
    .from("opportunities")
    .insert({
      organization_id: orgId,
      name: "WGR-129 Verify Opportunity",
      category: "local_community_grant",
      description: "Throwaway opportunity for draft-loss-fix verification.",
      status: "open",
    })
    .select("id")
    .single();
  if (oppErr) throw new Error("opportunity insert failed: " + oppErr.message);
  const opportunityId = opp.id;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (createErr) throw new Error("createUser failed: " + createErr.message);
  const userId = created.user.id;

  const { error: profileErr } = await admin.from("profiles").insert({
    id: userId,
    organization_id: orgId,
    email: TEST_EMAIL,
    full_name: "WGR-129 Verify Writer",
    role: "writer",
  });
  if (profileErr) throw new Error("profile insert failed: " + profileErr.message);

  const anonClient = createServiceClient(LOCAL_API_URL, LOCAL_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...REALTIME_OPT,
  });
  const { data: signIn, error: signInErr } = await anonClient.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: PASSWORD,
  });
  if (signInErr) throw new Error("signIn failed: " + signInErr.message);

  const jar = new Map();
  const ssrClient = createServerClient(LOCAL_API_URL, LOCAL_ANON_KEY, {
    ...REALTIME_OPT,
    cookies: {
      getAll() {
        return Array.from(jar.entries()).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) jar.set(name, value);
      },
    },
  });
  const { error: setSessionErr } = await ssrClient.auth.setSession({
    access_token: signIn.session.access_token,
    refresh_token: signIn.session.refresh_token,
  });
  if (setSessionErr) throw new Error("setSession failed: " + setSessionErr.message);

  const cookieHeader = Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  if (!cookieHeader) throw new Error("no cookies captured");

  return { orgId, opportunityId, userId, cookieHeader };
}

async function callDraftApi(cookieHeader, opportunityId) {
  const res = await fetch(`${BASE_URL}/api/ai/draft`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: cookieHeader,
    },
    body: JSON.stringify({ opportunityId, templateType: "letter_of_inquiry" }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, ok: res.ok, json, text };
}

async function main() {
  assertNotProd();
  const results = { capturedAt: new Date().toISOString() };

  const db = new Client({ connectionString: LOCAL_DB_URL });
  await db.connect();
  const dbInfo = await db.query(
    "select current_database() as db, inet_server_addr()::text as addr",
  );
  if (String(dbInfo.rows[0].addr).includes(PROD_REF)) {
    throw new Error("HARD STOP: connected DB looks like production.");
  }
  console.log("Confirmed local target:", dbInfo.rows[0]);

  console.log("Setting up throwaway org/opportunity/writer session...");
  const { orgId, opportunityId, cookieHeader } = await setupFixtures(db);
  console.log(`orgId=${orgId} opportunityId=${opportunityId}`);

  console.log(`Starting dev server on ${BASE_URL} against the local stack...`);
  const { child: devChild, getOutput } = startDevServer();

  try {
    const up = await waitForServer(`${BASE_URL}/login`, 120_000);
    if (!up) throw new Error(`Dev server did not come up. Output tail:\n${getOutput().slice(-3000)}`);
    console.log("Dev server is up.");

    // --- 1. FAILURE case: drop the version_number trigger to reproduce the
    //        exact real failure mode WGR-129's root-cause finding documents.
    console.log("\n=== FAILURE case: dropping trg_set_draft_version_number ===");
    await db.query("DROP TRIGGER IF EXISTS trg_set_draft_version_number ON draft_versions;");
    const triggerCheckBefore = await db.query(
      "SELECT tgname FROM pg_trigger WHERE tgrelid = 'draft_versions'::regclass AND NOT tgisinternal;",
    );
    console.log("Triggers on draft_versions after drop:", triggerCheckBefore.rows);

    const before = await db.query(
      "SELECT count(*)::int AS n FROM draft_versions WHERE organization_id = $1",
      [orgId],
    );

    console.log("Calling POST /api/ai/draft (expect real failure, real Claude call)...");
    const failRes = await callDraftApi(cookieHeader, opportunityId);
    console.log(`  status=${failRes.status}`);

    const after = await db.query(
      "SELECT count(*)::int AS n FROM draft_versions WHERE organization_id = $1",
      [orgId],
    );
    const agentRunFail = await db.query(
      `SELECT status, error_message FROM agent_runs
       WHERE organization_id = $1 AND agent_type = 'narrative_drafting'
       ORDER BY created_at DESC LIMIT 1`,
      [orgId],
    );

    results.failureCase = {
      description: "draft_versions.version_number trigger dropped, then POST /api/ai/draft called for real",
      http_status: failRes.status,
      http_ok: failRes.ok,
      response_body: failRes.json ?? failRes.text.slice(0, 2000),
      draft_versions_count_before: before.rows[0].n,
      draft_versions_count_after: after.rows[0].n,
      agent_run_status: agentRunFail.rows[0]?.status ?? null,
      agent_run_error_message: agentRunFail.rows[0]?.error_message ?? null,
      outcome:
        !failRes.ok &&
        failRes.status !== 200 &&
        after.rows[0].n === before.rows[0].n &&
        agentRunFail.rows[0]?.status === "failed"
          ? "PASS — endpoint failed loud (non-200), zero rows persisted, agent_run marked failed"
          : "FAIL — endpoint did not fail loud as expected",
    };
    console.log(results.failureCase.outcome);

    // Restore the trigger for the success case.
    console.log("\nRestoring trg_set_draft_version_number...");
    await db.query(`
      CREATE TRIGGER trg_set_draft_version_number
      BEFORE INSERT ON draft_versions
      FOR EACH ROW EXECUTE FUNCTION set_draft_version_number();
    `);
    const triggerCheckAfter = await db.query(
      "SELECT tgname FROM pg_trigger WHERE tgrelid = 'draft_versions'::regclass AND NOT tgisinternal;",
    );
    console.log("Triggers on draft_versions after restore:", triggerCheckAfter.rows);

    // --- 2. SUCCESS case: real generation, real persist, read back and compare.
    console.log("\n=== SUCCESS case: real draft generation with trigger restored ===");
    const beforeSuccess = await db.query(
      "SELECT count(*)::int AS n FROM draft_versions WHERE organization_id = $1",
      [orgId],
    );
    console.log("Calling POST /api/ai/draft (expect real success, real Claude call)...");
    const okRes = await callDraftApi(cookieHeader, opportunityId);
    console.log(`  status=${okRes.status}`);

    const savedVersionId = okRes.json?.savedVersion?.id ?? null;
    let dbRow = null;
    if (savedVersionId) {
      const rowRes = await db.query(
        "SELECT id, organization_id, opportunity_id, content, template_type, confidence_score, version_number FROM draft_versions WHERE id = $1",
        [savedVersionId],
      );
      dbRow = rowRes.rows[0] ?? null;
    }
    const afterSuccess = await db.query(
      "SELECT count(*)::int AS n FROM draft_versions WHERE organization_id = $1",
      [orgId],
    );
    const agentRunOk = await db.query(
      `SELECT status FROM agent_runs
       WHERE organization_id = $1 AND agent_type = 'narrative_drafting'
       ORDER BY created_at DESC LIMIT 1`,
      [orgId],
    );

    const contentMatches = !!dbRow && dbRow.content === okRes.json?.content;

    results.successCase = {
      description: "trigger restored, POST /api/ai/draft called for real, response compared against the real persisted row",
      http_status: okRes.status,
      http_ok: okRes.ok,
      response_content_length: okRes.json?.content?.length ?? null,
      response_confidence_score: okRes.json?.confidenceScore ?? null,
      saved_version_id: savedVersionId,
      draft_versions_count_before: beforeSuccess.rows[0].n,
      draft_versions_count_after: afterSuccess.rows[0].n,
      db_row_found: !!dbRow,
      db_row_content_length: dbRow?.content?.length ?? null,
      db_row_version_number: dbRow?.version_number ?? null,
      content_matches_response_exactly: contentMatches,
      agent_run_status: agentRunOk.rows[0]?.status ?? null,
      outcome:
        okRes.ok &&
        okRes.status === 200 &&
        !!dbRow &&
        contentMatches &&
        afterSuccess.rows[0].n === beforeSuccess.rows[0].n + 1 &&
        agentRunOk.rows[0]?.status === "completed"
          ? "PASS — 200, real row persisted, content matches response exactly, agent_run marked completed"
          : "FAIL — persist or content-match did not hold",
    };
    console.log(results.successCase.outcome);

    results.summary = {
      failureCasePassed: results.failureCase.outcome.startsWith("PASS"),
      successCasePassed: results.successCase.outcome.startsWith("PASS"),
    };
    results.summary.allPassed = results.summary.failureCasePassed && results.summary.successCasePassed;
  } finally {
    console.log("\nStopping dev server...");
    stopDevServer(devChild);
    await db.end();
  }

  const outFile = path.join(OUT_DIR, "draft-loss-fix-verify.json");
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`\nwrote ${outFile}`);
  console.log(JSON.stringify(results.summary, null, 2));

  if (!results.summary?.allPassed) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
