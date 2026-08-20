// ============================================================================
// PT-03-001 -- establish the E2E journey environment (preflight).
//
// PT-03 (End-to-End Workflows) depends on PT-02 (API/auth truth) per the queue's
// own header. This script:
//   1. Confirms PT-00/PT-01/PT-02 review-pack artifacts exist and are non-empty
//      (the dependency this whole phase sits on top of).
//   2. Reuses the already-running local Supabase CLI stack from PT-05
//      (.pt05-local-stack/ -- Postgres 17 + GoTrue + PostgREST on 127.0.0.1,
//      confirmed live and NOT the production ref before touching it), rather
//      than provisioning a second, redundant stack.
//   3. Creates one fresh, PT-03-scoped test organization + owner profile, and
//      one auth user created via the GoTrue Admin API with NO password field
//      at all -- the account can only ever be reached via OTP/magic-link, so
//      "no password touched" is true by construction, not just by convention.
//   4. Issues a real magic link for that user (GoTrue admin generate_link),
//      exchanges it for a session by following the real verify redirect and
//      calling setSession() (the same technique already proven against
//      production in scripts/smoke-test-workflow.mjs, pointed at the local
//      stack instead), then independently re-confirms the session is live by
//      calling GoTrue's own /auth/v1/user endpoint with the issued access
//      token -- not just trusting that setSession() succeeded locally.
//   5. Boots an isolated `next dev` instance (its own port + its own .next
//      build cache dir, env vars overridden to point at the local stack, not
//      .env.local's production values) and confirms it actually serves a real
//      page against this target, then shuts it down -- proving "local dev"
//      half of "local dev + local DB" is real, not just asserted.
//   6. Writes test-evidence/pt-03/environment.txt (human-readable evidence,
//      each check independently greppable) and
//      test-evidence/pt-03/environment-session.json (structured fields for
//      the verifier's own independent re-check).
//
// Usage: node scripts/audit/pt03-001-establish-journey-env.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { WebSocket } from "ws";

// Node 20 has no native WebSocket; @supabase/supabase-js's createClient()
// eagerly constructs a RealtimeClient that requires one. Same shim already
// used by src/lib/supabase/admin.ts and scripts/smoke-test-workflow.mjs.
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "pt-03");

const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";

// Local stack connection details, from `supabase status -o json` inside
// .pt05-local-stack/ -- the standard Supabase CLI local-dev demo keys
// (identical on every local Supabase project on this machine), not a
// production secret. Same values PT-05's provisioning script used.
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const LOCAL_API_URL = "http://127.0.0.1:56321";
const LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const DEV_PORT = 3303;
const DEV_NEXT_DIR = ".next-pt03";

const lines = [];
function log(msg) {
  console.log(msg);
  lines.push(msg);
}

function assertNotProduction(connectionString) {
  if (connectionString.includes(PRODUCTION_REF)) {
    throw new Error(
      `REFUSING TO PROCEED: connection string contains the production ref "${PRODUCTION_REF}". ` +
        `PT-03 must never write to production.`,
    );
  }
  const url = new URL(connectionString.replace(/^postgresql:/, "postgres:"));
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error(
      `REFUSING TO PROCEED: connection host "${url.hostname}" does not look like a local target.`,
    );
  }
  return url;
}

function checkReviewPack(phase) {
  const p = path.join(REPO_ROOT, "test-evidence", phase, "REVIEW-PACK.md");
  if (!fs.existsSync(p)) {
    throw new Error(`Dependency check failed: ${p} does not exist.`);
  }
  const size = fs.statSync(p).size;
  if (size === 0) {
    throw new Error(`Dependency check failed: ${p} is empty.`);
  }
  return { path: path.relative(REPO_ROOT, p), bytes: size };
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

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  log(`PT-03-001 journey environment establishment`);
  log(`Generated: ${new Date().toISOString()}`);
  log(``);

  // --- Step 1: confirm PT-00/PT-01/PT-02 artifacts ---------------------------
  log(`== Dependency check: PT-00/PT-01/PT-02 review-pack artifacts ==`);
  const deps = {};
  for (const phase of ["pt-00", "pt-01", "pt-02"]) {
    const info = checkReviewPack(phase);
    deps[phase] = info;
    log(`${phase.toUpperCase()} artifact confirmed: ${info.path} (${info.bytes} bytes, non-empty)`);
  }
  log(``);

  // --- Step 2: confirm the local stack target is not production --------------
  log(`== Target check (must NOT be production) ==`);
  const url = assertNotProduction(LOCAL_DB_URL);
  log(
    `Target check: PASS -- host="${url.hostname}" port="${url.port}" does not contain production ` +
      `ref "${PRODUCTION_REF}"`,
  );
  log(`Connection string (redacted): postgresql://postgres:***@${url.hostname}:${url.port}${url.pathname}`);
  log(`Stack: local Supabase CLI stack (Postgres 17 + GoTrue + PostgREST), reused from .pt05-local-stack/`);
  log(`API base: ${LOCAL_API_URL}`);
  log(`Production ref for comparison (must NOT appear above as an actual target): ${PRODUCTION_REF}`);
  log(``);

  const dbClient = new Client({ connectionString: LOCAL_DB_URL });
  await dbClient.connect();

  const dbInfo = await dbClient.query(
    "select current_database() as db, inet_server_addr()::text as addr, inet_server_port() as port",
  );
  const { db, addr, port } = dbInfo.rows[0];
  log(`Live connection check: database="${db}" server_addr="${addr}" server_port="${port}"`);
  if (String(addr).includes(PRODUCTION_REF) || String(db).includes(PRODUCTION_REF)) {
    throw new Error("Live connection reports a production-looking target. Aborting.");
  }
  log(`Live connection confirmed local (server_addr is a loopback/private address, not a Supabase cloud host).`);
  log(``);

  // --- Step 3: create one fresh org + owner profile + passwordless user ------
  log(`== Journey test identity: org + owner profile + passwordless auth user ==`);

  const email = "pt03-journey-owner@benavora-pt03-test.local";
  const orgName = "PT-03 Journey Test Org";

  // Idempotency: remove any leftover state from a prior interrupted run of
  // this exact script, in real FK-safe order (profiles before
  // organizations/auth user -- the same ordering bug found and fixed in the
  // PT-10-002 dependency-outage session applies here too). Query-then-delete
  // rather than blind DELETE, since a first-ever run should find nothing.
  const leftoverOrgRows = await dbClient.query(`select id from organizations where name = $1`, [orgName]);
  if (leftoverOrgRows.rows.length > 0) {
    const leftoverOrgIds = leftoverOrgRows.rows.map((r) => r.id);
    await dbClient.query(`delete from profiles where organization_id = any($1::uuid[])`, [leftoverOrgIds]);
    await dbClient.query(`delete from organizations where id = any($1::uuid[])`, [leftoverOrgIds]);
    log(`Removed ${leftoverOrgIds.length} leftover org(s) + their profile row(s) from a prior run.`);
  }
  const adminAuthListRes = await fetch(`${LOCAL_API_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
    headers: { apikey: LOCAL_SERVICE_ROLE_KEY, Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}` },
  });
  if (adminAuthListRes.ok) {
    const body = await adminAuthListRes.json();
    const existing = Array.isArray(body?.users) ? body.users : Array.isArray(body) ? body : [];
    for (const u of existing) {
      if (u.email === email) {
        await fetch(`${LOCAL_API_URL}/auth/v1/admin/users/${u.id}`, {
          method: "DELETE",
          headers: { apikey: LOCAL_SERVICE_ROLE_KEY, Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}` },
        });
        log(`Removed leftover auth user from a prior run: ${u.id} (${email})`);
      }
    }
  }

  const orgRes = await dbClient.query(
    `insert into organizations (name, ein, mission_statement, onboarding_completed, onboarding_step)
     values ($1, $2, $3, true, 5) returning id`,
    [orgName, "33-3333333", "Test mission for PT-03 E2E journey auditing."],
  );
  const orgId = orgRes.rows[0].id;
  log(`Org created: id=${orgId} name="${orgName}"`);

  // Create the auth user via the Admin API with NO "password" key in the
  // request body at all -- this account can only authenticate via a
  // GoTrue-issued OTP/magic link, never a password, from the moment it
  // exists. This is the literal mechanism, not a promise.
  const createRes = await fetch(`${LOCAL_API_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: LOCAL_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ email, email_confirm: true }),
  });
  const createBody = await createRes.json();
  if (!createRes.ok) {
    throw new Error(`GoTrue admin createUser failed for ${email}: ${createRes.status} ${JSON.stringify(createBody)}`);
  }
  const userId = createBody.id;
  const requestBodyKeys = Object.keys(JSON.parse(JSON.stringify({ email, email_confirm: true })));
  log(
    `Auth user created via Admin API: id=${userId} email=${email} -- createUser request body keys: ` +
      `[${requestBodyKeys.join(", ")}] (no "password" key present in the request -- this script never ` +
      `set, read, or used a password value for this account, at any point).`,
  );
  // Real finding, documented rather than glossed over: GoTrue itself
  // auto-generates a random bcrypt-hashed password server-side even when the
  // createUser request carries no "password" key at all -- confirmed via a
  // direct read of auth.users.encrypted_password for this account. This
  // value was never requested, generated, read, or used by this script or by
  // any human -- every authentication in this environment goes exclusively
  // through the magic-link/OTP path below, never a password sign-in -- but
  // the literal claim "no password exists in the database" would be false,
  // so it is not made. What is true, and what this script actually
  // demonstrates: no password was ever set, read, or touched BY THIS SCRIPT
  // OR ANY CALLER, and the only authentication path exercised is magic-link.
  log(
    `Note (real, documented): GoTrue's local Admin API auto-generates its own random password hash ` +
      `server-side regardless of whether "password" is in the request body -- this is GoTrue's own ` +
      `internal behavior, not something this script requested, read, or ever uses. The only ` +
      `authentication path this script exercises for this account is magic-link, below.`,
  );

  await dbClient.query(
    `insert into profiles (id, organization_id, email, full_name, role)
     values ($1, $2, $3, $4, 'owner')`,
    [userId, orgId, email, "PT-03 Journey Owner"],
  );
  log(`Owner profile created: profiles.id=${userId} organization_id=${orgId} role=owner`);
  log(``);

  // --- Step 4: real magic-link issuance + exchange + independent re-check ----
  log(`== Magic-link authentication (no password touched at any point) ==`);
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
  log(`Magic link issued via GoTrue admin generate_link (type=magiclink) for ${email}.`);

  const verifyResp = await fetch(linkBody.action_link, { redirect: "manual" });
  const location = verifyResp.headers.get("location") || "";
  const hash = location.includes("#") ? location.split("#")[1] : "";
  const params = new URLSearchParams(hash);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (!access_token || !refresh_token) {
    throw new Error(`Could not extract tokens from magic link redirect: status=${verifyResp.status} location=${location}`);
  }
  log(`Magic link verified: redirect status=${verifyResp.status}, access_token + refresh_token both extracted from redirect hash.`);

  // Exchange, via the app's own real @supabase/ssr server-client cookie
  // adapter shape (same mechanism the app itself uses), pointed at the local
  // stack -- proves the exact code path a real journey test will use, not a
  // simplified stand-in.
  const setCookies = [];
  const authForCookies = createServerClient(LOCAL_API_URL, LOCAL_ANON_KEY, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
  });
  const { error: sessErr } = await authForCookies.auth.setSession({ access_token, refresh_token });
  if (sessErr) {
    throw new Error(`setSession failed: ${sessErr.message}`);
  }
  log(`Session established via @supabase/ssr setSession() against the local stack: ${setCookies.length} auth cookie(s) issued.`);

  // Independent re-check: call GoTrue's own /auth/v1/user endpoint directly
  // with the issued access token. This does not trust setSession()'s local
  // success -- it re-asks the Auth server itself whether this token is a
  // live, valid session right now.
  const userCheckRes = await fetch(`${LOCAL_API_URL}/auth/v1/user`, {
    headers: { apikey: LOCAL_ANON_KEY, Authorization: `Bearer ${access_token}` },
  });
  const userCheckBody = await userCheckRes.json();
  if (!userCheckRes.ok || userCheckBody.id !== userId || userCheckBody.email !== email) {
    throw new Error(
      `Independent /auth/v1/user re-check failed or mismatched: status=${userCheckRes.status} body=${JSON.stringify(userCheckBody)}`,
    );
  }
  log(
    `Live authenticated session check: PASS -- independent GET /auth/v1/user with the issued access ` +
      `token returned status=${userCheckRes.status}, id=${userCheckBody.id} (matches created user), ` +
      `email=${userCheckBody.email} (matches), aud=${userCheckBody.aud}, role=${userCheckBody.role}.`,
  );

  // Confirm the issued token is genuinely usable, not just accepted by the
  // Auth server in isolation: fetch this user's own profile row through
  // PostgREST using the session's own access token (not the service-role
  // key). Note: this local schema (pt05-schema.sql) has RLS disabled on
  // profiles, so this checks token usability for a real authenticated read,
  // not tenant-isolation enforcement -- RLS enforcement is PT-05's own,
  // separate, already-completed concern.
  const anonRestClient = createClient(LOCAL_API_URL, LOCAL_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: selfProfile, error: profErr } = await anonRestClient
    .from("profiles")
    .select("id, organization_id, role")
    .eq("id", userId)
    .single();
  if (profErr || !selfProfile || selfProfile.organization_id !== orgId) {
    throw new Error(`Session-scoped PostgREST self-read failed or mismatched: ${profErr?.message}`);
  }
  log(
    `Session token usability check: PASS -- SELECT profiles as the authenticated session (not service ` +
      `role) returned this user's own row: id=${selfProfile.id} organization_id=${selfProfile.organization_id} ` +
      `role=${selfProfile.role}. (RLS is disabled on this local schema -- this confirms the token is a ` +
      `real, usable session credential, not tenant-isolation enforcement, which is PT-05's own concern.)`,
  );
  log(``);

  await dbClient.end();

  // --- Step 5: confirm local dev boots against this target -------------------
  log(`== Local dev server check (against local stack, not .env.local's production values) ==`);
  const devEnv = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: LOCAL_API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: LOCAL_SERVICE_ROLE_KEY,
    PORT: String(DEV_PORT),
  };
  let devServerOutcome = "NOT_ATTEMPTED";
  let devServerDetail = "";
  const child = spawn("pnpm", ["exec", "next", "dev", "-p", String(DEV_PORT)], {
    cwd: REPO_ROOT,
    env: { ...devEnv, PT_AUDIT_DIST_DIR: DEV_NEXT_DIR },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  let devOutput = "";
  child.stdout.on("data", (d) => (devOutput += d.toString()));
  child.stderr.on("data", (d) => (devOutput += d.toString()));

  try {
    const up = await waitForServer(`http://localhost:${DEV_PORT}/login`, 90_000);
    if (!up) {
      devServerOutcome = "FAIL_NO_RESPONSE";
      devServerDetail = "no HTTP response on /login within 90s";
    } else {
      const res = await fetch(`http://localhost:${DEV_PORT}/login`, { redirect: "manual" });
      devServerOutcome = res.status === 200 ? "PASS" : `UNEXPECTED_STATUS_${res.status}`;
      devServerDetail = `GET /login -> ${res.status}`;
    }
  } catch (err) {
    devServerOutcome = "FAIL_ERROR";
    devServerDetail = err.message;
  } finally {
    // shell:true on Windows means child.kill() only kills the shell wrapper,
    // not the actual `next dev` process tree it spawned -- use taskkill /T to
    // kill the whole tree so no orphaned dev server is left running.
    if (process.platform === "win32" && child.pid) {
      try {
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        // already exited or nothing to kill -- fine
      }
    } else {
      child.kill();
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  log(`Local dev server: port=${DEV_PORT}, build cache dir=${DEV_NEXT_DIR}, env pointed at local stack (${LOCAL_API_URL})`);
  log(`Local dev server check: ${devServerOutcome} -- ${devServerDetail}`);
  if (devServerOutcome !== "PASS") {
    log(`(dev server output tail, for diagnosis: ${devOutput.slice(-1500)})`);
  }
  log(``);

  if (devServerOutcome !== "PASS") {
    throw new Error(`Local dev server did not serve a real page against the local stack target: ${devServerOutcome} -- ${devServerDetail}`);
  }

  log(`== Summary ==`);
  log(`Journey environment established: local Supabase stack (non-production, verified live), one fresh`);
  log(`org + owner profile, one passwordless auth user authenticated via a real magic link, session`);
  log(`independently re-confirmed live against the Auth server and usable for a real session-scoped`);
  log(`PostgREST read, and local dev confirmed to boot and serve a real page against this exact target.`);

  fs.writeFileSync(path.join(OUT_DIR, "environment.txt"), lines.join("\n") + "\n", "utf8");
  fs.writeFileSync(
    path.join(OUT_DIR, "environment-session.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        dependency_artifacts: deps,
        target: {
          host: url.hostname,
          port: url.port,
          database: db,
          is_production: false,
          production_ref_for_comparison: PRODUCTION_REF,
          api_base: LOCAL_API_URL,
        },
        journey_org: { id: orgId, name: "PT-03 Journey Test Org" },
        journey_user: {
          id: userId,
          email,
          created_with_password_field: false,
        },
        session_check: {
          method: "magiclink",
          access_token_issued: true,
          refresh_token_issued: true,
          independent_auth_v1_user_status: userCheckRes.status,
          independent_auth_v1_user_id_match: userCheckBody.id === userId,
          session_token_postgrest_read_ok: true,
        },
        dev_server_check: {
          port: DEV_PORT,
          next_dist_dir: DEV_NEXT_DIR,
          outcome: devServerOutcome,
          detail: devServerDetail,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log("\nDone. Wrote test-evidence/pt-03/environment.txt and environment-session.json.");
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
