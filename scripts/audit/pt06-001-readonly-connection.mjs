// ============================================================================
// PT-06-001 — establish a READ-ONLY connection to production Postgres and
// prove it with a trivial "select 1", per DIRECTIVE-017's DATABASE_URL /
// direct DDL connection string pattern.
//
// Safety design (this is the part that matters, not the SELECT 1 itself):
//   1. Connect using the DATABASE_URL from .env.local (never printed).
//   2. Immediately run `SET default_transaction_read_only = on` for the
//      session -- every subsequent transaction on this connection is now
//      rejected if it attempts a write, at the Postgres engine level, not
//      just by application-level discipline.
//   3. Run `select 1` to prove the connection itself works.
//   4. Prove the read-only enforcement is REAL, not just requested: attempt
//      a harmless CREATE TABLE (a real write, guaranteed rejected under
//      read-only mode per Postgres semantics -- SQLSTATE 25006) inside its
//      own transaction and confirm it is rejected with that exact SQLSTATE.
//      Since the statement is rejected, nothing is ever created; this proves
//      the safety property without risking one.
//   5. If steps 1-4 do not all succeed, HALT (non-zero exit, no evidence
//      file claiming success) rather than proceed on an unproven connection.
//
// Evidence: test-evidence/pt-06/connection-proof.txt
//
// Usage: node scripts/audit/pt06-001-readonly-connection.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ENV_FILE = ".env.local";
const OUT_DIR = path.join("test-evidence", "pt-06");
const OUT_FILE = path.join(OUT_DIR, "connection-proof.txt");

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

function redact(connectionString) {
  return connectionString.replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/, "$1***$2");
}

async function main() {
  if (!fs.existsSync(ENV_FILE)) {
    console.error(`HALT: ${ENV_FILE} not found -- cannot establish a connection.`);
    process.exit(1);
  }

  const env = loadEnv(ENV_FILE);
  if (!env.DATABASE_URL) {
    console.error(`HALT: DATABASE_URL not present in ${ENV_FILE} -- cannot establish a connection.`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const lines = [];
  const log = (line) => {
    lines.push(line);
    console.log(line);
  };

  log(`PT-06-001 read-only connection proof`);
  log(`Generated: ${new Date().toISOString()}`);
  log(`Connection string (redacted): ${redact(env.DATABASE_URL)}`);
  log("");

  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: 10000,
  });

  let haltReason = null;

  try {
    await client.connect();
    log(`Step 1 -- connect(): SUCCESS`);

    const who = await client.query(
      "select current_database() as db, current_user as usr, inet_server_addr()::text as server_addr, now() as server_time",
    );
    const row = who.rows[0];
    log(`  database: ${row.db}`);
    log(`  connected as: ${row.usr}`);
    log(`  server address: ${row.server_addr}`);
    log(`  server time: ${row.server_time}`);
    log("");

    // Step 2: force the session into read-only mode at the engine level.
    await client.query("SET default_transaction_read_only = on");
    const roCheck = await client.query("SHOW default_transaction_read_only");
    log(`Step 2 -- SET default_transaction_read_only = on: SUCCESS`);
    log(`  SHOW default_transaction_read_only => ${roCheck.rows[0].default_transaction_read_only}`);
    if (roCheck.rows[0].default_transaction_read_only !== "on") {
      haltReason = "default_transaction_read_only did not report 'on' after being set.";
    }
    log("");

    if (!haltReason) {
      // Step 3: the trivial select 1.
      const selectOne = await client.query("select 1 as ok");
      log(`Step 3 -- select 1: SUCCESS (result: ${JSON.stringify(selectOne.rows[0])})`);
      if (selectOne.rows[0].ok !== 1) {
        haltReason = "select 1 did not return the expected value.";
      }
      log("");
    }

    if (!haltReason) {
      // Step 4: prove read-only enforcement is real by attempting a write
      // that MUST be rejected. A rejected statement never executes, so this
      // is safe -- the point is confirming rejection, not attempting success.
      try {
        await client.query("BEGIN");
        await client.query("CREATE TABLE pt06_readonly_probe_should_never_exist (x int)");
        // If we get here, the write was NOT rejected -- that's a failure of
        // the safety property this script exists to prove.
        await client.query("ROLLBACK");
        haltReason =
          "CREATE TABLE inside a read-only session SUCCEEDED -- read-only enforcement is not real. HALTING.";
        log(`Step 4 -- write-rejection probe: FAILED (write was not blocked)`);
      } catch (writeErr) {
        // Expected path: Postgres rejects the write. Roll back the aborted
        // transaction to leave the connection in a clean state.
        try {
          await client.query("ROLLBACK");
        } catch {
          // transaction may already be implicitly rolled back; ignore
        }
        const code = writeErr.code;
        const expectedCode = "25006"; // read_only_sql_transaction
        log(`Step 4 -- write-rejection probe: REJECTED AS EXPECTED`);
        log(`  Postgres error code: ${code}`);
        log(`  Postgres error message: ${writeErr.message}`);
        if (code !== expectedCode) {
          haltReason = `Write was rejected, but not with the expected SQLSTATE ${expectedCode} (read_only_sql_transaction) -- got "${code}" instead. Cannot confirm read-only enforcement is the real cause of rejection.`;
        }
      }
      log("");
    }
  } catch (err) {
    haltReason = `Connection or query error: ${err.message}`;
    log(`ERROR: ${err.message}`);
  } finally {
    try {
      await client.end();
      log(`Connection closed cleanly.`);
    } catch {
      // ignore close errors
    }
  }

  log("");
  if (haltReason) {
    log(`RESULT: HALT -- ${haltReason}`);
    fs.writeFileSync(OUT_FILE, lines.join("\n") + "\n", "utf8");
    console.error(`\nHALT: ${haltReason}`);
    process.exit(1);
  }

  log(
    `RESULT: PASS -- connection established, session forced to default_transaction_read_only=on, ` +
      `select 1 succeeded, and a real write attempt (CREATE TABLE) was rejected by Postgres with ` +
      `SQLSTATE 25006 (read_only_sql_transaction), proving the read-only property is enforced by ` +
      `the database engine, not merely by application-level discipline.`,
  );
  fs.writeFileSync(OUT_FILE, lines.join("\n") + "\n", "utf8");
  console.log(`\nWrote ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(`HALT: unexpected error: ${err.stack || err.message}`);
  process.exit(1);
});
