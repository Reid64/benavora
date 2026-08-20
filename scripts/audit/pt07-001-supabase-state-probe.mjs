// ============================================================================
// PT-07-001 — real, read-only Supabase state probe.
//
// Precondition: PT-00's artifacts (test-evidence/pt-00/*) must exist before
// this runs -- PT-00 is the baseline every later phase builds on. This script
// checks for them and halts if any are missing, rather than silently probing
// against an unconfirmed baseline.
//
// Four real probes against production, each with an actual response
// captured (never assumed):
//   1. DB connectivity  -- a real `select` over DATABASE_URL, forced into a
//      read-only session the same way PT-06-001 proved (SET
//      default_transaction_read_only = on, then a real rejected CREATE TABLE
//      to prove the read-only property is enforced by Postgres, not just
//      requested).
//   2. Auth              -- a real session issue + verify. Uses the
//      established magic-link technique (see PT-00-005/PT-01-00x/PT-04-002):
//      admin.auth.admin.generateLink() issues a real magiclink for the real
//      Faith Foundation org owner (info@faithfoundationsf.org, the
//      established safe real-account convention in this audit program --
//      never a throwaway/synthetic account for this specific check), the
//      action_link is followed to capture a real access_token/refresh_token,
//      and that token is verified by calling auth.getUser(access_token) on a
//      fresh anon client -- confirming Supabase Auth actually accepted the
//      token and returns the real user record for it, not just that a
//      redirect happened.
//   3. Storage buckets    -- a real service-role storage.listBuckets() call,
//      cross-referenced against the bucket names this app's own source code
//      actually references (grepped from src/, both static literals and the
//      per-org dynamic `org-${organizationId}` pattern), so a bucket the app
//      expects but that does not exist live is a real, evidenced finding,
//      not a guess.
//   4. Realtime publication membership -- a real query against
//      pg_publication_tables for the `supabase_realtime` publication (the
//      actual list of tables Postgre's logical-replication layer will emit
//      change events for), cross-referenced against every table this app's
//      own source code subscribes to via `postgres_changes` (grepped from
//      src/components and src/app/api). A table the app subscribes to that
//      is NOT a member of the publication is a real, evidenced finding --
//      Realtime silently never fires for it, no error, no signal.
//
// Evidence: test-evidence/pt-07/supabase-state.json
// Usage: node scripts/audit/pt07-001-supabase-state-probe.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { WebSocket } from "ws";
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

const REPO_ROOT = process.cwd();
const ENV_FILE = path.join(REPO_ROOT, ".env.local");
const PT00_DIR = path.join(REPO_ROOT, "test-evidence", "pt-00");
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "pt-07");
const OUT_FILE = path.join(OUT_DIR, "supabase-state.json");

const AUTH_TEST_EMAIL = "info@faithfoundationsf.org";

// Static bucket-name literals this app's own source code references
// (grepped: `.storage.from("...")` calls and their resolved `const bucket =`
// assignments across src/). The one per-org dynamic bucket pattern
// (`org-${organizationId}`) is checked separately below against a real org id.
const EXPECTED_STATIC_BUCKETS = [
  "documents",
  "org-documents",
  "org-branding",
  "nofa-pdfs",
  "autoapply-screenshots",
  "session-recordings",
];

// Tables this app's own source code subscribes to via Supabase Realtime
// (`postgres_changes`), grepped from src/components/autoapply/*.tsx,
// src/components/command-center/CommandCenterLive.tsx, and
// src/app/api/admin/command-center/route.ts.
const EXPECTED_REALTIME_TABLES = [
  "submission_queue",
  "autoapply_submissions",
  "autoapply_review_queue",
  "worker_status",
  "agent_runs",
  "agent_decisions",
  "applications",
];

function loadEnv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

function redactConnectionString(connectionString) {
  return connectionString.replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/, "$1***$2");
}

function checkPt00Preconditions() {
  const required = [
    "PHASE-00-SUMMARY.md",
    "README.md",
    "REVIEW-PACK.md",
    "build-config.txt",
    "build-proof.txt",
    "env-audit.json",
    "route-manifest.json",
    "smoke-results.json",
  ];
  const missing = [];
  for (const name of required) {
    if (!fs.existsSync(path.join(PT00_DIR, name))) missing.push(name);
  }
  return { checkedDir: PT00_DIR, requiredFiles: required, missing, ok: missing.length === 0 };
}

// ---- Probe 1: DB connectivity, forced read-only, real select -------------

async function probeDb(env) {
  const probe = {
    method: "pg.Client against DATABASE_URL, forced into a read-only session (SET " +
      "default_transaction_read_only = on), a real `select`, then a real write attempt " +
      "(CREATE TABLE) that must be rejected by Postgres to prove read-only enforcement is " +
      "real, not merely requested.",
    connectionStringRedacted: env.DATABASE_URL ? redactConnectionString(env.DATABASE_URL) : null,
  };

  if (!env.DATABASE_URL) {
    probe.verdict = "HALT";
    probe.error = "DATABASE_URL not present in .env.local";
    return probe;
  }

  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: 10000,
  });

  try {
    await client.connect();
    const who = await client.query(
      "select current_database() as db, current_user as usr, now() as server_time, version() as pg_version"
    );
    probe.realResponse = who.rows[0];

    await client.query("SET default_transaction_read_only = on");
    const roCheck = await client.query("SHOW default_transaction_read_only");
    probe.readOnlySessionConfirmed = roCheck.rows[0].default_transaction_read_only === "on";

    const selectOne = await client.query("select 1 as ok");
    probe.selectOneResult = selectOne.rows[0];

    // Real row-count select against a real table, proving this is a genuine
    // data-plane connection, not just `select 1`.
    const orgCount = await client.query("select count(*)::int as n from organizations");
    probe.realTableSelect = { table: "organizations", rowCount: orgCount.rows[0].n };

    let writeRejection = { attempted: true };
    try {
      await client.query("BEGIN");
      await client.query("CREATE TABLE pt07_readonly_probe_should_never_exist (x int)");
      await client.query("ROLLBACK");
      writeRejection.rejected = false;
      writeRejection.note = "write succeeded -- read-only enforcement is NOT real";
    } catch (writeErr) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // transaction already aborted; ignore
      }
      writeRejection.rejected = true;
      writeRejection.sqlstate = writeErr.code;
      writeRejection.message = writeErr.message;
      writeRejection.matchesExpectedReadOnlyCode = writeErr.code === "25006";
    }
    probe.writeRejectionProof = writeRejection;

    probe.verdict =
      probe.readOnlySessionConfirmed &&
      probe.selectOneResult?.ok === 1 &&
      writeRejection.rejected === true &&
      writeRejection.matchesExpectedReadOnlyCode === true
        ? "PASS"
        : "FAIL";
  } catch (err) {
    probe.verdict = "HALT";
    probe.error = err.message;
  } finally {
    try {
      await client.end();
    } catch {
      // ignore
    }
  }

  return probe;
}

// ---- Probe 2: Auth -- real session issue + verify -------------------------

async function probeAuth(env) {
  const probe = {
    method:
      "admin.auth.admin.generateLink({type:'magiclink'}) issues a real session for a real " +
      "existing production user (info@faithfoundationsf.org, the Faith Foundation org owner -- " +
      "the established safe real-account convention throughout this audit program). The " +
      "action_link is followed (redirect: manual) to capture the real access_token/" +
      "refresh_token fragment, then that token is verified via auth.getUser(access_token) on a " +
      "fresh anon client -- confirming Supabase Auth actually issued and accepts a working " +
      "session, not just that a redirect occurred.",
    email: AUTH_TEST_EMAIL,
  };

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    probe.verdict = "HALT";
    probe.error = "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY";
    return probe;
  }

  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: AUTH_TEST_EMAIL,
    });
    if (linkErr) throw new Error(`generateLink failed: ${linkErr.message}`);
    probe.issue = {
      generated: true,
      actionLinkHost: new URL(linkData.properties.action_link).host,
    };

    const verifyResp = await fetch(linkData.properties.action_link, { redirect: "manual" });
    const location = verifyResp.headers.get("location") || "";
    const hash = location.split("#")[1];
    if (!hash) throw new Error("magic link did not return a redirect with an auth fragment");
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    probe.issue.redirectStatus = verifyResp.status;
    probe.issue.gotAccessToken = Boolean(accessToken);
    probe.issue.gotRefreshToken = Boolean(refreshToken);

    if (!accessToken) throw new Error("no access_token in the redirect fragment");

    const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userErr } = await anon.auth.getUser(accessToken);
    if (userErr) throw new Error(`auth.getUser(access_token) failed to verify the issued session: ${userErr.message}`);

    probe.verify = {
      verified: true,
      realResponse: {
        id: userData.user.id,
        email: userData.user.email,
        aud: userData.user.aud,
        role: userData.user.role,
        last_sign_in_at: userData.user.last_sign_in_at,
      },
    };
    probe.verdict = "PASS";
  } catch (err) {
    probe.verdict = "HALT";
    probe.error = err.message;
  }

  return probe;
}

// ---- Probe 3: Storage buckets ---------------------------------------------

async function probeStorage(env) {
  const probe = {
    method:
      "A real service-role storage.listBuckets() call against production, cross-referenced " +
      "against every bucket name this app's own source code references (both static literals " +
      "and the per-org dynamic `org-${organizationId}` pattern, resolved against a real org id " +
      "read from FAITH_FOUNDATION_ORG_ID / the DB).",
    expectedStaticBuckets: EXPECTED_STATIC_BUCKETS,
  };

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    probe.verdict = "HALT";
    probe.error = "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY";
    return probe;
  }

  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: buckets, error } = await admin.storage.listBuckets();
    if (error) throw new Error(`storage.listBuckets() failed: ${error.message}`);

    probe.realResponse = buckets.map((b) => ({
      id: b.id,
      name: b.name,
      public: b.public,
      created_at: b.created_at,
    }));

    const liveBucketIds = new Set(buckets.map((b) => b.id));

    const dynamicOrgBucketId = env.FAITH_FOUNDATION_ORG_ID
      ? `org-${env.FAITH_FOUNDATION_ORG_ID}`
      : null;
    const expectedAll = dynamicOrgBucketId
      ? [...EXPECTED_STATIC_BUCKETS, dynamicOrgBucketId]
      : [...EXPECTED_STATIC_BUCKETS];
    probe.dynamicOrgBucketChecked = dynamicOrgBucketId;

    const missing = expectedAll.filter((name) => !liveBucketIds.has(name));
    const unexpected = buckets
      .map((b) => b.id)
      .filter((id) => !expectedAll.includes(id) && !/^org-[0-9a-f-]{36}$/.test(id));

    probe.expectedAllBuckets = expectedAll;
    probe.missingExpectedBuckets = missing;
    probe.unexpectedBuckets = unexpected;
    probe.verdict = missing.length === 0 ? "PASS" : "FINDING";
    if (missing.length > 0) {
      probe.finding = `${missing.length} bucket(s) the app's source code expects are missing live: ${missing.join(", ")}`;
    }
  } catch (err) {
    probe.verdict = "HALT";
    probe.error = err.message;
  }

  return probe;
}

// ---- Probe 4: Realtime publication membership ------------------------------

async function probeRealtime(env) {
  const probe = {
    method:
      "A real query against pg_publication_tables for the `supabase_realtime` publication -- " +
      "the actual, current list of tables Postgres logical replication will emit change events " +
      "for -- cross-referenced against every table this app's own source code subscribes to via " +
      "`postgres_changes` (grepped from src/components/autoapply/*.tsx, " +
      "src/components/command-center/CommandCenterLive.tsx, src/app/api/admin/command-center/route.ts).",
    expectedRealtimeTables: EXPECTED_REALTIME_TABLES,
  };

  if (!env.DATABASE_URL) {
    probe.verdict = "HALT";
    probe.error = "DATABASE_URL not present in .env.local";
    return probe;
  }

  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: 10000,
  });

  try {
    await client.connect();
    await client.query("SET default_transaction_read_only = on");

    const pubExists = await client.query(
      "select pubname from pg_publication where pubname = 'supabase_realtime'"
    );
    probe.publicationExists = pubExists.rows.length > 0;

    const memberRows = await client.query(
      "select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename"
    );
    const memberTables = memberRows.rows.map((r) => r.tablename);
    probe.realResponse = { publication: "supabase_realtime", memberTables };

    const missing = EXPECTED_REALTIME_TABLES.filter((t) => !memberTables.includes(t));
    probe.missingFromPublication = missing;
    probe.verdict = missing.length === 0 ? "PASS" : "FINDING";
    if (missing.length > 0) {
      probe.finding =
        `${missing.length} of ${EXPECTED_REALTIME_TABLES.length} tables the app subscribes to via ` +
        `postgres_changes are NOT members of the supabase_realtime publication: ${missing.join(", ")}. ` +
        `Realtime silently never fires change events for these tables -- no error, no signal, the ` +
        `subscribing component just never updates.`;
    }
  } catch (err) {
    probe.verdict = "HALT";
    probe.error = err.message;
  } finally {
    try {
      await client.end();
    } catch {
      // ignore
    }
  }

  return probe;
}

// ---- Main -------------------------------------------------------------

async function main() {
  if (!fs.existsSync(ENV_FILE)) {
    console.error(`HALT: ${ENV_FILE} not found.`);
    process.exit(1);
  }
  const env = loadEnv(ENV_FILE);

  const pt00Precondition = checkPt00Preconditions();
  console.log(
    `PT-00 precondition check: ${pt00Precondition.ok ? "PASS" : "FAIL"} ` +
      `(checked ${pt00Precondition.requiredFiles.length} required artifacts in ${pt00Precondition.checkedDir})`
  );
  if (!pt00Precondition.ok) {
    console.error(`HALT: PT-00 artifacts missing: ${pt00Precondition.missing.join(", ")}`);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(
      OUT_FILE,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          halted: true,
          reason: "PT-00 precondition failed",
          pt00Precondition,
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("Running probe 1/4: DB connectivity...");
  const db = await probeDb(env);
  console.log(`  DB probe verdict: ${db.verdict}`);

  console.log("Running probe 2/4: Auth (real session issue + verify)...");
  const auth = await probeAuth(env);
  console.log(`  Auth probe verdict: ${auth.verdict}`);

  console.log("Running probe 3/4: Storage buckets...");
  const storage = await probeStorage(env);
  console.log(`  Storage probe verdict: ${storage.verdict}`);

  console.log("Running probe 4/4: Realtime publication membership...");
  const realtime = await probeRealtime(env);
  console.log(`  Realtime probe verdict: ${realtime.verdict}`);

  const findings = [];
  if (storage.verdict === "FINDING") findings.push({ area: "storage_buckets", detail: storage.finding });
  if (realtime.verdict === "FINDING") findings.push({ area: "realtime_publication", detail: realtime.finding });

  const halted = [db, auth, storage, realtime].some((p) => p.verdict === "HALT");
  const anyFail = [db, auth].some((p) => p.verdict === "FAIL");

  const output = {
    generated_at: new Date().toISOString(),
    pt00Precondition,
    supabase_project_url: env.NEXT_PUBLIC_SUPABASE_URL || null,
    probes: { db, auth, storage, realtime },
    findings,
    summary: {
      db_verdict: db.verdict,
      auth_verdict: auth.verdict,
      storage_verdict: storage.verdict,
      realtime_verdict: realtime.verdict,
      halted,
      any_fail: anyFail,
      finding_count: findings.length,
    },
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`Findings: ${findings.length}`);
  for (const f of findings) console.log(`  - [${f.area}] ${f.detail}`);

  if (halted || anyFail) {
    console.error(`\nHALT/FAIL: one or more probes did not complete with a clean real response.`);
    process.exit(1);
  }

  console.log(
    `\nRESULT: all four probes returned a real, captured response. ${findings.length} finding(s) recorded ` +
      `(a finding here means a real, evidenced gap -- e.g. a missing bucket or an un-published Realtime table -- ` +
      `not a probe failure).`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(`HALT: unexpected error: ${err.stack || err.message}`);
  process.exit(1);
});
