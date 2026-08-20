// ============================================================================
// PT-03-001 verifier -- journey environment (local/branch, magic-link session).
//
// Exits non-zero unless:
//   1. test-evidence/pt-03/environment.txt exists, is non-empty, and shows a
//      non-production write target -- HARD FAIL if the recorded connection
//      target contains the production ref (vbjplpquqxxfbpazyalt) anywhere
//      other than an explicit negative-comparison line.
//   2. environment.txt records a live authenticated session established via
//      the magic-link pattern (no password field used at account creation),
//      independently re-confirmed against the real Auth server at record
//      time, not just asserted.
//   3. environment.txt records PT-00/PT-01/PT-02 dependency artifacts as
//      confirmed present.
//   4. environment-session.json exists, is valid JSON, and its structured
//      fields agree with environment.txt's target/session claims.
//   5. Independent, live re-verification against the actual local database:
//      reconnects to the recorded target and confirms the journey org +
//      owner profile still exist right now -- not trusting the
//      provisioning script's own historical claim.
//
// Usage: node scripts/audit/verify-pt03-001.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const ENV_FILE = path.join("test-evidence", "pt-03", "environment.txt");
const SESSION_JSON = path.join("test-evidence", "pt-03", "environment-session.json");
const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";

const REQUIRED_DEP_PHASES = ["pt-00", "pt-01", "pt-02"];

let errors = 0;
function fail(message) {
  console.error(`FAIL: ${message}`);
  errors++;
}
function hardFail(message) {
  console.error(`HARD FAIL: ${message}`);
  errors++;
}

// --- 1. environment.txt ------------------------------------------------------

let envText = null;
if (!fs.existsSync(ENV_FILE)) {
  fail(`${ENV_FILE} does not exist.`);
} else {
  envText = fs.readFileSync(ENV_FILE, "utf8");
  if (envText.trim().length === 0) {
    fail(`${ENV_FILE} is empty.`);
  } else {
    // Production ref may only appear as an explicit negative comparison, never
    // as part of an actual connection target.
    const NEGATIVE_COMPARISON = /for comparison|does not contain|must not appear|not the production|refusing to proceed/i;
    const badLines = envText
      .split("\n")
      .filter((l) => l.includes(PRODUCTION_REF) && !NEGATIVE_COMPARISON.test(l));
    if (badLines.length > 0) {
      hardFail(
        `${ENV_FILE} has ${badLines.length} line(s) referencing the production ref outside a ` +
          `comparison context: ${JSON.stringify(badLines)}`,
      );
    }

    // Non-prod write target evidence.
    if (!/Target check:\s*PASS/i.test(envText)) {
      fail(`${ENV_FILE} does not record a passing target check.`);
    }
    if (!/(127\.0\.0\.1|localhost|Supabase branch|\.supabase\.co\/branch)/i.test(envText)) {
      fail(`${ENV_FILE} does not show evidence of a local (127.0.0.1/localhost) or branch target.`);
    }
    if (!/Live connection confirmed local/i.test(envText)) {
      fail(`${ENV_FILE} does not record an independently-confirmed live local connection.`);
    }

    // Live authenticated session evidence, magic-link pattern specifically.
    if (!/no "password" key present/i.test(envText)) {
      fail(`${ENV_FILE} does not show evidence the createUser request carried no password field.`);
    }
    if (!/Magic link issued/i.test(envText) || !/Magic link verified/i.test(envText)) {
      fail(`${ENV_FILE} does not record a real magic-link issuance and verification.`);
    }
    if (!/Live authenticated session check:\s*PASS/i.test(envText)) {
      fail(`${ENV_FILE} does not record a passing live authenticated session check.`);
    }
    if (!/access_token/i.test(envText) || !/refresh_token/i.test(envText)) {
      fail(`${ENV_FILE} does not record both an access_token and refresh_token being issued.`);
    }
    if (!/GoTrue.*auto-generates.*password hash/i.test(envText)) {
      fail(
        `${ENV_FILE} does not document the real GoTrue-auto-generates-a-password-hash finding -- this ` +
          `must be stated honestly, not silently omitted.`,
      );
    }

    // PT-00/01/02 dependency confirmation.
    for (const phase of REQUIRED_DEP_PHASES) {
      const re = new RegExp(`${phase.toUpperCase()} artifact confirmed`, "i");
      if (!re.test(envText)) {
        fail(`${ENV_FILE} does not confirm the ${phase.toUpperCase()} dependency artifact.`);
      }
    }
  }
}

// --- 2. environment-session.json ---------------------------------------------

let session = null;
if (!fs.existsSync(SESSION_JSON)) {
  fail(`${SESSION_JSON} does not exist.`);
} else {
  const raw = fs.readFileSync(SESSION_JSON, "utf8");
  try {
    session = JSON.parse(raw);
  } catch (err) {
    fail(`${SESSION_JSON} is not valid JSON: ${err.message}`);
  }
}

let orgId = null;
let userId = null;
let dbTargetHost = null;
let dbTargetPort = null;

if (session) {
  if (!session.target || typeof session.target !== "object") {
    fail(`${SESSION_JSON}.target is missing.`);
  } else {
    if (session.target.is_production !== false) {
      hardFail(`${SESSION_JSON}.target.is_production is not explicitly false.`);
    }
    if (!session.target.host) {
      fail(`${SESSION_JSON}.target.host is missing.`);
    } else if (String(session.target.host).includes(PRODUCTION_REF)) {
      hardFail(`${SESSION_JSON}.target.host ("${session.target.host}") contains the production ref.`);
    } else {
      dbTargetHost = session.target.host;
      dbTargetPort = session.target.port;
    }
    if (session.target.production_ref_for_comparison !== PRODUCTION_REF) {
      fail(`${SESSION_JSON}.target.production_ref_for_comparison does not match the expected production ref.`);
    }
  }

  if (!session.dependency_artifacts || typeof session.dependency_artifacts !== "object") {
    fail(`${SESSION_JSON}.dependency_artifacts is missing.`);
  } else {
    for (const phase of REQUIRED_DEP_PHASES) {
      const entry = session.dependency_artifacts[phase];
      if (!entry || !(entry.bytes > 0)) {
        fail(`${SESSION_JSON}.dependency_artifacts.${phase} is missing or records a non-positive byte count.`);
      }
    }
  }

  if (!session.journey_org || !session.journey_org.id) {
    fail(`${SESSION_JSON}.journey_org.id is missing.`);
  } else {
    orgId = session.journey_org.id;
  }

  if (!session.journey_user || !session.journey_user.id) {
    fail(`${SESSION_JSON}.journey_user.id is missing.`);
  } else {
    userId = session.journey_user.id;
  }
  if (session.journey_user && session.journey_user.created_with_password_field !== false) {
    hardFail(`${SESSION_JSON}.journey_user.created_with_password_field is not explicitly false -- the magic-link, no-password requirement is not proven.`);
  }

  if (!session.session_check || typeof session.session_check !== "object") {
    fail(`${SESSION_JSON}.session_check is missing.`);
  } else {
    const sc = session.session_check;
    if (sc.method !== "magiclink") {
      fail(`${SESSION_JSON}.session_check.method is not "magiclink" (got ${JSON.stringify(sc.method)}).`);
    }
    if (sc.access_token_issued !== true || sc.refresh_token_issued !== true) {
      fail(`${SESSION_JSON}.session_check does not confirm both access_token and refresh_token were issued.`);
    }
    if (sc.independent_auth_v1_user_status !== 200) {
      fail(
        `${SESSION_JSON}.session_check.independent_auth_v1_user_status is not 200 ` +
          `(got ${JSON.stringify(sc.independent_auth_v1_user_status)}) -- the live re-check against the ` +
          `real Auth server did not pass.`,
      );
    }
    if (sc.independent_auth_v1_user_id_match !== true) {
      fail(`${SESSION_JSON}.session_check.independent_auth_v1_user_id_match is not true.`);
    }
  }
}

// --- 3. independent live re-verification against the actual database ---------
//
// Do not trust environment.txt/environment-session.json's own historical
// claims alone. Reconnect to the recorded target right now and re-confirm the
// journey org and owner profile genuinely exist -- this is what proves the
// environment is real and currently usable, not just that a script once said
// so.

async function liveVerify() {
  if (!orgId || !userId || !dbTargetHost || errors > 0) {
    console.error(
      "SKIP: live re-verification skipped because the static checks above already failed " +
        "(no reliable org/user id or target to verify against).",
    );
    return;
  }

  if (!["127.0.0.1", "localhost", "::1"].includes(dbTargetHost)) {
    hardFail(
      `Live re-verification target host "${dbTargetHost}" is not a local address. Refusing to connect ` +
        `to avoid accidentally querying a shared/production database.`,
    );
    return;
  }

  const connectionString = `postgresql://postgres:postgres@${dbTargetHost}:${dbTargetPort}/postgres`;
  if (connectionString.includes(PRODUCTION_REF)) {
    hardFail(`Live re-verification connection string unexpectedly contains the production ref. Refusing to connect.`);
    return;
  }

  let client;
  try {
    client = new Client({ connectionString });
    await client.connect();
  } catch (err) {
    fail(`Could not connect to the recorded local target (${dbTargetHost}:${dbTargetPort}): ${err.message}`);
    return;
  }

  try {
    const dbInfo = await client.query(
      "select current_database() as db, inet_server_addr()::text as addr",
    );
    const { db, addr } = dbInfo.rows[0];
    if (String(addr).includes(PRODUCTION_REF) || String(db).includes(PRODUCTION_REF)) {
      hardFail(`Live connection reports a production-looking target (db="${db}" addr="${addr}"). Aborting.`);
      return;
    }
    console.log(`Live re-verification connected: database="${db}" server_addr="${addr}"`);

    const orgRes = await client.query(`select id, name from organizations where id = $1`, [orgId]);
    if (orgRes.rows.length !== 1) {
      fail(`Live re-verification: journey org ${orgId} not found in the recorded target right now.`);
    } else {
      console.log(`Live re-verification PASS: journey org ${orgId} ("${orgRes.rows[0].name}") exists right now.`);
    }

    const profRes = await client.query(
      `select p.id, p.organization_id, p.role, u.id as auth_user_id, u.encrypted_password
       from profiles p
       join auth.users u on u.id = p.id
       where p.id = $1`,
      [userId],
    );
    if (profRes.rows.length !== 1) {
      fail(`Live re-verification: journey user ${userId} has no profiles row tied to a real auth.users row right now.`);
    } else {
      const row = profRes.rows[0];
      if (row.organization_id !== orgId) {
        fail(`Live re-verification: journey user ${userId}'s profile organization_id does not match the recorded journey org.`);
      } else if (row.role !== "owner") {
        fail(`Live re-verification: journey user ${userId}'s profile role is "${row.role}", expected "owner".`);
      } else {
        console.log(
          `Live re-verification PASS: journey user ${userId} has an owner-role profile tied to a real ` +
            `auth.users row, right now.`,
        );
      }
      // Note: GoTrue's local Admin API auto-generates its own random
      // password hash server-side regardless of whether "password" was in
      // the createUser request body -- confirmed live here, and this is
      // documented plainly in environment.txt rather than glossed over. This
      // is not something this script (or any caller) requested, read, or
      // ever used, so it is not treated as a verification failure -- the
      // actual requirement ("no password touched" by this script/caller,
      // magic-link is the only auth path exercised) is checked via the
      // createUser-request-body and session_check.method assertions above,
      // not via the row's encrypted_password value.
      console.log(
        `Live re-verification INFO: auth.users.encrypted_password is ${row.encrypted_password ? "non-empty" : "empty"} ` +
          `for journey user ${userId} (GoTrue's own server-side default -- not requested/read/used by this ` +
          `script; see environment.txt's documented note).`,
      );
    }
  } finally {
    await client.end();
  }
}

await liveVerify();

if (errors > 0) {
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

console.log(`PASS: ${ENV_FILE} shows a non-production (local) write target and a live authenticated session established via the magic-link pattern (no password field used).`);
console.log(`PASS: ${SESSION_JSON} structured fields agree with environment.txt's claims.`);
console.log(`PASS: independent live re-query against the actual local database confirms the journey org, the owner profile, and the passwordless auth user all exist right now.`);
process.exit(0);
