// ============================================================================
// PT-07-001 verifier — Supabase real-state probe.
//
// Exits non-zero unless test-evidence/pt-07/supabase-state.json exists, is
// valid JSON, and records a REAL, captured response (not just a PASS label)
// for all four probes: DB connectivity, Auth session issue+verify, Storage
// bucket listing, and the Realtime publication's actual member-table list.
//
// A "FINDING" verdict on storage or realtime is NOT a verifier failure --
// that's an honest, evidenced gap the probe is designed to surface (e.g. a
// missing bucket, or a table the app subscribes to that isn't published).
// This verifier only fails if a probe did not actually run and capture real
// data (HALT), or if the recorded data doesn't look like a real response.
//
// Usage: node scripts/audit/verify-pt07-001.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const STATE_FILE = path.join("test-evidence", "pt-07", "supabase-state.json");

let errors = 0;
function fail(message) {
  console.error(`FAIL: ${message}`);
  errors++;
}
function ok(message) {
  console.log(`OK: ${message}`);
}

if (!fs.existsSync(STATE_FILE)) {
  fail(`${STATE_FILE} does not exist.`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

const raw = fs.readFileSync(STATE_FILE, "utf8");
if (raw.trim().length === 0) {
  fail(`${STATE_FILE} is empty.`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  fail(`${STATE_FILE} is not valid JSON: ${err.message}`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

// --- PT-00 precondition -----------------------------------------------------

if (!data.pt00Precondition || data.pt00Precondition.ok !== true) {
  fail(`pt00Precondition.ok is not true -- PT-00 artifacts were not confirmed present before probing.`);
} else {
  ok(`PT-00 precondition confirmed (${(data.pt00Precondition.requiredFiles || []).length} required artifacts checked).`);
}

if (data.pt00Precondition?.halted || data.halted) {
  fail(`Probe run recorded halted=true -- one or more probes did not complete.`);
}

const probes = data.probes || {};

// --- Probe 1: DB connectivity ------------------------------------------------

const db = probes.db;
if (!db) {
  fail(`probes.db is missing.`);
} else {
  if (db.verdict !== "PASS") {
    fail(`probes.db.verdict is "${db.verdict}", expected "PASS". error=${db.error ?? "n/a"}`);
  }
  if (!db.realResponse || typeof db.realResponse !== "object") {
    fail(`probes.db.realResponse is missing -- no real DB response was captured.`);
  } else {
    if (!db.realResponse.db) fail(`probes.db.realResponse.db (current_database) is missing.`);
    if (!db.realResponse.server_time) fail(`probes.db.realResponse.server_time is missing.`);
    if (!db.realResponse.pg_version) fail(`probes.db.realResponse.pg_version is missing.`);
  }
  if (db.selectOneResult?.ok !== 1) {
    fail(`probes.db.selectOneResult does not show a real "select 1" result of 1.`);
  }
  if (!db.realTableSelect || typeof db.realTableSelect.rowCount !== "number") {
    fail(`probes.db.realTableSelect is missing a real numeric rowCount -- no real table select was captured.`);
  }
  if (db.readOnlySessionConfirmed !== true) {
    fail(`probes.db.readOnlySessionConfirmed is not true -- the read-only session was not confirmed.`);
  }
  if (db.writeRejectionProof?.rejected !== true || db.writeRejectionProof?.matchesExpectedReadOnlyCode !== true) {
    fail(`probes.db.writeRejectionProof does not show a real, engine-rejected write (SQLSTATE 25006).`);
  }
  if (errors === 0 || (db.verdict === "PASS" && db.realResponse)) {
    ok(`DB probe: real select against ${db.realResponse?.db} (${db.realTableSelect?.table}=${db.realTableSelect?.rowCount} rows), read-only enforcement proven.`);
  }
}

// --- Probe 2: Auth -----------------------------------------------------------

const auth = probes.auth;
if (!auth) {
  fail(`probes.auth is missing.`);
} else {
  if (auth.verdict !== "PASS") {
    fail(`probes.auth.verdict is "${auth.verdict}", expected "PASS". error=${auth.error ?? "n/a"}`);
  }
  if (!auth.issue || auth.issue.generated !== true) {
    fail(`probes.auth.issue does not show a real generateLink() issue step.`);
  }
  if (!auth.issue?.gotAccessToken || !auth.issue?.gotRefreshToken) {
    fail(`probes.auth.issue does not record a real captured access_token/refresh_token.`);
  }
  if (!auth.verify || auth.verify.verified !== true) {
    fail(`probes.auth.verify does not show the issued session was actually verified.`);
  }
  const realUser = auth.verify?.realResponse;
  if (!realUser || !realUser.id || !realUser.email || realUser.aud !== "authenticated") {
    fail(`probes.auth.verify.realResponse does not look like a real Supabase Auth user record.`);
  }
  if (errors === 0 || realUser) {
    ok(`Auth probe: real session issued + verified for ${realUser?.email} (user id ${realUser?.id}).`);
  }
}

// --- Probe 3: Storage buckets -------------------------------------------------

const storage = probes.storage;
if (!storage) {
  fail(`probes.storage is missing.`);
} else {
  if (storage.verdict !== "PASS" && storage.verdict !== "FINDING") {
    fail(`probes.storage.verdict is "${storage.verdict}", expected "PASS" or "FINDING". error=${storage.error ?? "n/a"}`);
  }
  if (!Array.isArray(storage.realResponse)) {
    fail(`probes.storage.realResponse is not an array -- no real bucket list was captured.`);
  } else if (storage.realResponse.length === 0) {
    fail(`probes.storage.realResponse is an empty array -- zero real buckets returned (unexpected for a live project).`);
  } else {
    for (const [i, b] of storage.realResponse.entries()) {
      if (!b.id || typeof b.public !== "boolean" || !b.created_at) {
        fail(`probes.storage.realResponse[${i}] is missing id/public/created_at -- does not look like a real bucket record.`);
      }
    }
  }
  if (!Array.isArray(storage.expectedAllBuckets) || storage.expectedAllBuckets.length === 0) {
    fail(`probes.storage.expectedAllBuckets is missing or empty -- no expected-bucket baseline was recorded.`);
  }
  if (!Array.isArray(storage.missingExpectedBuckets)) {
    fail(`probes.storage.missingExpectedBuckets must be an array (even if empty).`);
  }
  if (storage.verdict === "PASS" && Array.isArray(storage.realResponse)) {
    ok(`Storage probe: ${storage.realResponse.length} real bucket(s) listed, ${storage.missingExpectedBuckets?.length ?? "?"} missing expected bucket(s).`);
  } else if (storage.verdict === "FINDING") {
    ok(`Storage probe: real data captured, FINDING recorded (${storage.finding}).`);
  }
}

// --- Probe 4: Realtime publication member list --------------------------------

const realtime = probes.realtime;
if (!realtime) {
  fail(`probes.realtime is missing.`);
} else {
  if (realtime.verdict !== "PASS" && realtime.verdict !== "FINDING") {
    fail(`probes.realtime.verdict is "${realtime.verdict}", expected "PASS" or "FINDING". error=${realtime.error ?? "n/a"}`);
  }
  if (realtime.publicationExists !== true) {
    fail(`probes.realtime.publicationExists is not true -- the supabase_realtime publication was not confirmed to exist.`);
  }
  if (!realtime.realResponse || !Array.isArray(realtime.realResponse.memberTables)) {
    fail(`probes.realtime.realResponse.memberTables is missing or not an array -- the actual member-table list was not queried.`);
  }
  if (!Array.isArray(realtime.expectedRealtimeTables) || realtime.expectedRealtimeTables.length === 0) {
    fail(`probes.realtime.expectedRealtimeTables is missing or empty -- no expected-subscription baseline was recorded.`);
  }
  if (!Array.isArray(realtime.missingFromPublication)) {
    fail(`probes.realtime.missingFromPublication must be an array (even if empty).`);
  }
  if (realtime.realResponse?.memberTables) {
    ok(
      `Realtime probe: real query of pg_publication_tables returned ${realtime.realResponse.memberTables.length} member table(s); ` +
        `${realtime.missingFromPublication?.length ?? "?"} of ${realtime.expectedRealtimeTables?.length ?? "?"} expected tables missing.`
    );
  }
}

// --- Summary consistency -------------------------------------------------------

if (data.summary) {
  if (data.summary.db_verdict !== db?.verdict) fail(`summary.db_verdict does not match probes.db.verdict.`);
  if (data.summary.auth_verdict !== auth?.verdict) fail(`summary.auth_verdict does not match probes.auth.verdict.`);
  if (data.summary.storage_verdict !== storage?.verdict) fail(`summary.storage_verdict does not match probes.storage.verdict.`);
  if (data.summary.realtime_verdict !== realtime?.verdict) fail(`summary.realtime_verdict does not match probes.realtime.verdict.`);
} else {
  fail(`data.summary is missing.`);
}

if (errors > 0) {
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

console.log(`\nPASS: ${STATE_FILE} records real, captured responses for DB, Auth, Storage buckets, and the Realtime publication member list.`);
process.exit(0);
