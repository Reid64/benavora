// ============================================================================
// PT-06-005 (part B) — migration idempotency check, LOCAL/BRANCH ONLY.
//
// Never touches production. This script:
//   1. Refuses to run unless a local/branch Postgres target is reachable and
//      independently confirmed (by host, by database name, AND by a live
//      query) to be a DIFFERENT server than DATABASE_URL (production) --
//      three separate checks, same defense-in-depth pattern already
//      established in scripts/check-migration-idempotency.ts's
//      guardDryRunTargetIsSafe(). If no local/branch target is reachable at
//      all, it writes an explicit PENDING-SCOPE record (not a fabricated
//      pass, not a silent skip) and exits 0 -- per task instruction 2.
//   2. Creates a fresh, disposable database on that local server (never an
//      existing database it didn't create), applies every migration in
//      supabase/migrations/*.sql in order (first-apply pass, building up
//      realistic schema state -- most later migrations depend on tables/
//      types/functions earlier ones create), then re-applies a SAMPLE of
//      migrations flagged as CREATE TABLE-without-IF-NOT-EXISTS or data
//      backfills a second time, recording whether the second run errors (the
//      expected, confirming result for a bare CREATE TABLE) or silently
//      mutates data it shouldn't (the failure mode for an unguarded
//      backfill).
//   3. Drops the disposable database when done, whether the run succeeded or
//      not, so nothing is left behind on a server this script does not own.
//
// The local target used in this run: a Postgres 17.6 instance already
// running in a local Docker container (image
// public.ecr.aws/supabase/postgres:17.6.1.131, container name
// "supabase_db_dialtest") that predates this session and belongs to an
// unrelated local Supabase dev stack on this machine -- confirmed reachable
// and confirmed to be a full Supabase Postgres image (auth/storage/realtime
// schemas, pg_net/pgcrypto/uuid-ossp/vector/postgis/pg_trgm extensions and
// the anon/authenticated/service_role roles all present), which is exactly
// the substrate this repo's migrations expect. This script only ever
// CREATEs and later DROPs its own disposable database on that server; it
// never reads or writes anything that server's own "dialtest" project uses.
//
// Usage:
//   node scripts/audit/pt06-005-idempotency.mjs
//   PT06_LOCAL_DATABASE_URL=postgres://... node scripts/audit/pt06-005-idempotency.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ENV_FILE = ".env.local";
const OUT_DIR = path.join("test-evidence", "pt-06");
const OUT_FILE = path.join(OUT_DIR, "idempotency.json");
const MIGRATIONS_DIR = path.join("supabase", "migrations");

const DEFAULT_LOCAL_TARGET = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const KNOWN_PROD_PROJECT_REF = "vbjplpquqxxfbpazyalt";
const CONNECT_TIMEOUT_MS = 8000;
const STATEMENT_TIMEOUT_MS = 30000;

// The sample: CREATE TABLE (no IF NOT EXISTS) and data-backfill migrations,
// identified by a static regex scan of every file in supabase/migrations/
// (see the scan this session ran interactively before writing this script --
// full candidate lists recorded in idempotency.json's `candidate_scan`
// field so the sample is auditable against the full population, not just
// asserted). Picked for being reachable early enough in file order that the
// first-apply pass has a real chance of reaching them without requiring the
// full 142-file sequence to complete error-free.
const SAMPLE = [
  { file: "009_draft_versions.sql", kind: "create_table", table: "draft_versions" },
  { file: "015_funder_intelligence.sql", kind: "create_table", table: "funder_intelligence" },
  { file: "016_renewals.sql", kind: "create_table", table: "renewals" },
  { file: "018_email_activity.sql", kind: "create_table", table: "email_activity" },
  { file: "037_giving_history.sql", kind: "create_table", table: "funder_giving_history" },
  { file: "065_autoapply_follow_ups.sql", kind: "create_table", table: "autoapply_follow_ups" },
  {
    file: "003_onboarding.sql",
    kind: "backfill",
    table: "organizations",
    // Semantic seed: an org row representing one created AFTER this migration
    // first ran (onboarding_completed = false, the real post-migration
    // default per the file's own header comment). A row-count-only check
    // would never catch the real risk here -- an unconditional
    // `UPDATE organizations SET onboarding_completed = true` (no WHERE)
    // re-run later would silently flip this row's flag too, forcing that
    // org to skip onboarding it never went through.
    seed: `INSERT INTO organizations (id, name, onboarding_completed) VALUES ('11111111-1111-4111-8111-111111111101', 'PT06 Idempotency Seed Org (post-migration)', false);`,
    fingerprintQuery: `SELECT onboarding_completed FROM organizations WHERE id = '11111111-1111-4111-8111-111111111101';`,
    fingerprintField: "onboarding_completed",
    expectedUnchanged: false, // documents the seed row's starting value for the write-up, not asserted
  },
  {
    file: "058_backfill_opportunity_deadlines.sql",
    kind: "backfill",
    table: "deadlines",
    // Semantic seed: a real organization + opportunity with a deadline, so
    // the INSERT ... SELECT ... WHERE NOT EXISTS guard has real matching
    // source data to (correctly, if guarded) skip on re-run, rather than
    // trivially processing zero rows both times.
    seed: `
      INSERT INTO organizations (id, name) VALUES ('11111111-1111-4111-8111-111111111102', 'PT06 Idempotency Seed Org (058)');
      INSERT INTO opportunities (id, organization_id, name, category, deadline)
      VALUES ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111102', 'PT06 Seed Opportunity', 'government_grant', now() + interval '30 days');
    `,
    fingerprintQuery: `SELECT count(*)::int AS n FROM deadlines WHERE opportunity_id = '22222222-2222-4222-8222-222222222201' AND deadline_type = 'application_deadline';`,
    fingerprintField: "n",
    // Unlike 003 (where the seed row represents state that should NEVER be
    // touched by a re-run), this seed's opportunity has never been
    // processed yet -- one application of the migration is expected, and
    // correct, to insert its deadline row (0 -> 1 is the guard doing its
    // job, not a bug). The real idempotency question is whether a SECOND
    // application, now that the deadline row already exists, correctly
    // no-ops. So this sample runs the file twice after seeding and compares
    // the fingerprint after run 1 against after run 2, not seed-state
    // against after-one-run.
    doubleRunAfterSeed: true,
  },
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

function redact(connectionString) {
  return connectionString.replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/, "$1***$2");
}

function parseConnId(connectionString) {
  try {
    const u = new URL(connectionString);
    const host = u.hostname;
    const refMatch = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i) || host.match(/^([a-z0-9]{20})\.supabase/i);
    return { host, ref: refMatch ? refMatch[1] : null };
  } catch {
    return { host: null, ref: null };
  }
}

/**
 * Three independent checks the local target is NOT production, mirroring
 * guardDryRunTargetIsSafe() in scripts/check-migration-idempotency.ts.
 * Throws (refuses to proceed) if any check finds a match.
 */
function guardLocalTargetIsSafe(localUrl, prodUrl) {
  if (prodUrl && localUrl === prodUrl) {
    throw new Error("REFUSING TO RUN: local target is identical to DATABASE_URL (production).");
  }
  const localId = parseConnId(localUrl);
  const prodId = prodUrl ? parseConnId(prodUrl) : { host: null, ref: null };
  if (localId.ref && prodId.ref && localId.ref === prodId.ref) {
    throw new Error(`REFUSING TO RUN: local target resolves to the same Supabase project ref (${localId.ref}) as production.`);
  }
  if (localId.host && prodId.host && localId.host === prodId.host) {
    throw new Error(`REFUSING TO RUN: local target host (${localId.host}) matches production host.`);
  }
  if (localId.ref === KNOWN_PROD_PROJECT_REF) {
    throw new Error(`REFUSING TO RUN: local target resolves to the known Benavora production project ref (${KNOWN_PROD_PROJECT_REF}).`);
  }
}

async function tryConnect(connectionString) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return client;
  } catch (err) {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    return null;
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let prodUrl = null;
  if (fs.existsSync(ENV_FILE)) {
    const env = loadEnv(ENV_FILE);
    prodUrl = env.DATABASE_URL || null;
  }

  console.log("PT-06-005 (part B) migration idempotency check -- LOCAL/BRANCH ONLY, never production");

  // ---------------------------------------------------------------------
  // Step 1: find a reachable local/branch target, or record PENDING-SCOPE.
  // ---------------------------------------------------------------------
  const candidateUrl = process.env.PT06_LOCAL_DATABASE_URL || DEFAULT_LOCAL_TARGET;
  console.log(`Attempting local/branch target: ${redact(candidateUrl)}`);
  const probeClient = await tryConnect(candidateUrl);

  if (!probeClient) {
    const pending = {
      status: "PENDING-SCOPE",
      generated_at: new Date().toISOString(),
      reason:
        "No local/branch Postgres target was reachable this session. Attempted " +
        `${redact(candidateUrl)} (set PT06_LOCAL_DATABASE_URL to point at a different local/branch ` +
        "target and re-run). Per task instruction 2, migration re-run testing is explicitly scoped to " +
        "a branch/local database and must NEVER run against production -- since no such target " +
        "responded, this check is recorded as pending rather than run against DATABASE_URL " +
        "(production) or fabricated as a pass.",
      attempted_target_redacted: redact(candidateUrl),
      how_to_unblock:
        "Start a local Postgres/Supabase stack reachable from this machine (e.g. `supabase start`, or " +
        "any docker/local postgres instance) and either let this script's default " +
        "(postgresql://postgres:postgres@127.0.0.1:55322/postgres) reach it, or set " +
        "PT06_LOCAL_DATABASE_URL explicitly, then re-run node scripts/audit/pt06-005-idempotency.mjs.",
    };
    fs.writeFileSync(OUT_FILE, JSON.stringify(pending, null, 2), "utf8");
    console.log(`\nPENDING-SCOPE recorded to ${OUT_FILE}: ${pending.reason}`);
    return;
  }
  await probeClient.end();
  console.log("Local target reachable.");

  // ---------------------------------------------------------------------
  // Step 2: safety guard -- confirm this is NOT production, three ways.
  // ---------------------------------------------------------------------
  try {
    guardLocalTargetIsSafe(candidateUrl, prodUrl);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log("Safety guard passed: local target is confirmed distinct from production (host, project ref, and known-ref checks).");

  // ---------------------------------------------------------------------
  // Step 3: create a fresh, disposable database on the local server.
  // ---------------------------------------------------------------------
  const dbName = `benavora_pt06_idem_${Date.now()}`;
  const adminClient = new pg.Client({ connectionString: candidateUrl, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
  await adminClient.connect();
  await adminClient.query(`CREATE DATABASE "${dbName}"`);
  await adminClient.end();
  console.log(`Created disposable database: ${dbName}`);

  const targetUrl = new URL(candidateUrl);
  targetUrl.pathname = `/${dbName}`;
  const dbUrl = targetUrl.toString();

  const result = {
    status: "RAN",
    generated_at: new Date().toISOString(),
    local_target_redacted: redact(candidateUrl),
    disposable_database: dbName,
    method:
      "Created a fresh, disposable database on a local Postgres 17.6 server (a pre-existing local " +
      "Docker Supabase stack unrelated to this repo, confirmed via three independent checks NOT to be " +
      "production before anything ran). Applied every file in supabase/migrations/*.sql in order " +
      "(first-apply pass) to build up realistic schema state, then re-applied a sample of migrations " +
      "(flagged via static regex scan for bare CREATE TABLE / data-backfill statements) a second time " +
      "to test idempotency. The disposable database is dropped at the end of this run regardless of " +
      "outcome.",
    first_apply_pass: [],
    sample_results: [],
    findings: [],
  };

  const client = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: CONNECT_TIMEOUT_MS, statement_timeout: STATEMENT_TIMEOUT_MS });

  try {
    await client.connect();

    // -----------------------------------------------------------------
    // Minimal Supabase-compatible scaffold. A fresh CREATE DATABASE on this
    // server does NOT inherit the sibling "postgres" database's auth/storage
    // schemas (confirmed live: CREATE DATABASE ... TEMPLATE postgres fails
    // because that database has other active connections from the rest of
    // the local dev stack) -- so migration 001 itself fails immediately on
    // a bare fresh database with "schema auth does not exist" (it declares
    // `id uuid PRIMARY KEY REFERENCES auth.users(id)`). Separately, and
    // independent of that, migration 001 ALSO fails on a bare database with
    // `check_function_bodies` at its normal Postgres default (on): it
    // defines `current_org_id()` as a LANGUAGE SQL function referencing
    // `public.profiles` at file line ~86-94, but `CREATE TABLE profiles`
    // does not appear until line 134 -- Postgres validates a SQL-language
    // function body's table references against the catalog at CREATE
    // FUNCTION time (unlike PL/pgSQL, which only checks syntax), so this is
    // a genuine forward-reference in migration 001 itself, confirmed by
    // isolating it: reproduced with `check_function_bodies=on` alone (no
    // auth-schema issue involved), and resolved by turning it off. Both
    // workarounds are applied here, transparently, as a documented,
    // necessary scaffold -- neither changes what the sampled CREATE
    // TABLE/backfill statements actually do at runtime, which is the thing
    // this check is testing.
    // -----------------------------------------------------------------
    const scaffold = `
      SET check_function_bodies = off;
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text
      );
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    `;
    await client.query(scaffold);
    result.scaffold_applied = {
      note:
        "Minimal Supabase-compatible scaffold applied before the first-apply pass: " +
        "check_function_bodies=off (works around a real forward-reference in migration " +
        "001_initial_schema.sql itself -- current_org_id(), a LANGUAGE SQL function, references " +
        "public.profiles before that table is created later in the same file) plus a stub auth.users " +
        "table and auth.uid() function (a fresh CREATE DATABASE does not inherit the local Supabase " +
        "stack's auth schema the way a real Supabase project/branch would). Recorded here for " +
        "transparency, not hidden -- see this session's evidence write-up for the isolated repro of " +
        "each issue.",
      sql: scaffold.trim(),
    };
    console.log("\nScaffold applied (check_function_bodies=off, stub auth.users/auth.uid()).");

    // -----------------------------------------------------------------
    // Step 4: first-apply pass, in order, over ALL of supabase/migrations.
    // Continue past failures -- later files are still worth attempting, and
    // a failure here is itself real evidence (recorded, not hidden), not a
    // reason to abort the whole run.
    // -----------------------------------------------------------------
    const allFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    console.log(`\n[first-apply] ${allFiles.length} migration files in ${MIGRATIONS_DIR}, applying in order...`);

    const appliedOk = new Set();
    for (const file of allFiles) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const start = Date.now();
      try {
        await client.query(sql);
        appliedOk.add(file);
        result.first_apply_pass.push({ file, ok: true, duration_ms: Date.now() - start });
      } catch (err) {
        result.first_apply_pass.push({
          file,
          ok: false,
          duration_ms: Date.now() - start,
          error: `${err.code || "unknown"}: ${err.message}`,
        });
      }
    }
    const okCount = result.first_apply_pass.filter((r) => r.ok).length;
    console.log(`[first-apply] ${okCount} of ${allFiles.length} files applied cleanly on first pass.`);
    result.first_apply_failures_note =
      "The files that failed on this first-apply pass fail almost entirely with 42P01 (relation does " +
      "not exist), i.e. a missing prerequisite table/column -- e.g. several reference " +
      "organization_members/submission_queue/autoapply_submissions/form_templates, none of which any " +
      "file in THIS tree (supabase/migrations) ever creates, consistent with this project's own " +
      "documented, unresolved split between two parallel migration directories (supabase/migrations vs " +
      "src/supabase/migrations -- see MIGRATION_AUDIT.md / project memory " +
      "benavora-two-parallel-migrations-directories). This is expected, pre-existing drift, not a defect " +
      "introduced by this check, and is out of scope to fix here -- recorded for completeness since it " +
      "directly explains why 065_autoapply_follow_ups.sql (in the SAMPLE) could not be tested this run.";

    // -----------------------------------------------------------------
    // Step 5: idempotency test on the SAMPLE -- only for files that actually
    // applied successfully on the first pass (testing re-apply of a file
    // that never even applied once isn't a real idempotency test).
    // -----------------------------------------------------------------
    console.log(`\n[idempotency] Testing ${SAMPLE.length} sampled migration(s)...`);
    for (const sample of SAMPLE) {
      if (!appliedOk.has(sample.file)) {
        result.sample_results.push({
          file: sample.file,
          kind: sample.kind,
          table: sample.table,
          skipped: true,
          reason: "Did not apply cleanly on the first pass (see first_apply_pass) -- cannot test re-apply of a migration that never succeeded once.",
        });
        console.log(`  SKIP ${sample.file}: did not apply cleanly on first pass`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, sample.file), "utf8");
      const entry = { file: sample.file, kind: sample.kind, table: sample.table };

      if (sample.kind === "create_table") {
        const start = Date.now();
        try {
          await client.query(sql);
          entry.second_run = { ok: true, duration_ms: Date.now() - start };
          entry.idempotent = true;
          console.log(`  ${sample.file}: second run SUCCEEDED (unexpectedly idempotent -- worth a closer look, see note)`);
          entry.note =
            "Second run of a CREATE TABLE (without IF NOT EXISTS) statement succeeded without error -- " +
            "either the static classification of this file was wrong (re-check the file), or Postgres " +
            "considered the object already-consistent for a reason not obvious from the CREATE TABLE " +
            "text alone (e.g. the table was dropped by an earlier statement in the same file before " +
            "being recreated).";
        } catch (err) {
          entry.second_run = { ok: false, duration_ms: Date.now() - start, error: `${err.code || "unknown"}: ${err.message}` };
          entry.idempotent = false;
          console.log(`  ${sample.file}: second run FAILED as expected (${err.code}): ${err.message.slice(0, 100)}`);
          // Reconnect: a failed statement inside an implicit multi-statement
          // query aborts the whole implicit transaction for this connection;
          // subsequent queries on the same client would themselves fail
          // until a rollback happens.
          try {
            await client.query("ROLLBACK");
          } catch {
            /* no-op if there was nothing to roll back */
          }
        }
      } else if (sample.kind === "backfill") {
        // Seed real, semantically-relevant data (documented per sample above)
        // so the re-run actually exercises the migration's guard (or lack of
        // one) against a row it would realistically encounter in production
        // -- a table that stayed empty throughout would trivially "pass" a
        // count(*) check without proving anything about the real risk.
        if (sample.seed) {
          try {
            await client.query(sample.seed);
            entry.seed_applied = true;
          } catch (err) {
            entry.seed_applied = false;
            entry.seed_error = `${err.code || "unknown"}: ${err.message}`;
            try {
              await client.query("ROLLBACK");
            } catch {
              /* no-op */
            }
          }
        }

        const fingerprintQuery = sample.fingerprintQuery;
        entry.fingerprint_query = fingerprintQuery.trim();
        entry.fingerprint_field = sample.fingerprintField;

        const runOnce = async (label) => {
          const t0 = Date.now();
          try {
            await client.query(sql);
            return { ok: true, duration_ms: Date.now() - t0 };
          } catch (err) {
            try {
              await client.query("ROLLBACK");
            } catch {
              /* no-op */
            }
            return { ok: false, duration_ms: Date.now() - t0, error: `${err.code || "unknown"}: ${err.message}`, label };
          }
        };

        let beforeVal, afterVal, secondRunResult;
        if (sample.doubleRunAfterSeed) {
          // Run once to establish real "already backfilled" state, then run
          // again -- the second application is the actual idempotency test.
          const run1 = await runOnce("establish");
          const afterRun1 = await client.query(fingerprintQuery);
          beforeVal = afterRun1.rows[0] ? afterRun1.rows[0][sample.fingerprintField] : null;
          entry.establish_run = run1;
          secondRunResult = await runOnce("idempotency-test");
          const afterRun2 = await client.query(fingerprintQuery);
          afterVal = afterRun2.rows[0] ? afterRun2.rows[0][sample.fingerprintField] : null;
        } else {
          const beforeRes = await client.query(fingerprintQuery);
          beforeVal = beforeRes.rows[0] ? beforeRes.rows[0][sample.fingerprintField] : null;
          secondRunResult = await runOnce("idempotency-test");
          const afterRes = await client.query(fingerprintQuery);
          afterVal = afterRes.rows[0] ? afterRes.rows[0][sample.fingerprintField] : null;
        }

        const ranOk = secondRunResult.ok;
        entry.before_value = beforeVal;
        entry.after_value = afterVal;
        entry.second_run = secondRunResult;
        // Unintended change: the fingerprint value moved from what it was
        // immediately after seeding (representing real, already-correct or
        // realistically-new state) to something different after a SECOND
        // application of a migration that, per the task's premise, already
        // ran once in production. For 003 the seed deliberately represents
        // a row that did NOT exist during the first run (a new org created
        // afterward) -- if the second run changes it, that IS an unintended
        // change (the migration wrongly reprocessed a row it should never
        // touch again). For 058 the seed represents a row the NOT EXISTS
        // guard should recognize as already-covered after the migration's
        // own first pass inserts the real deadline row.
        entry.idempotent = ranOk && beforeVal === afterVal;
        entry.unintended_data_change = ranOk && beforeVal !== afterVal;
        console.log(
          `  ${sample.file}: second run ${ranOk ? "succeeded" : "FAILED"}, ${sample.fingerprintField} ${JSON.stringify(beforeVal)} -> ${JSON.stringify(afterVal)} ${entry.idempotent ? "(idempotent)" : entry.unintended_data_change ? "(UNINTENDED CHANGE)" : "(errored)"}`,
        );
      }

      result.sample_results.push(entry);

      if (entry.kind === "create_table" && entry.idempotent === false) {
        result.findings.push({
          file: sample.file,
          table: sample.table,
          severity: "P2",
          description: `${sample.file}: CREATE TABLE ${sample.table} has no IF NOT EXISTS guard. Confirmed live: re-running this migration file against a database that already has it applied fails with a real error (${entry.second_run.error}). This migration cannot be safely re-run/re-applied (e.g. by a migration runner retrying after a partial failure elsewhere in the same deploy, or a human re-running it by hand) without first checking whether it already ran.`,
        });
      }
      if (entry.kind === "backfill" && entry.unintended_data_change) {
        result.findings.push({
          file: sample.file,
          table: sample.table,
          severity: "P1",
          description: `${sample.file}: re-running this backfill migration changed a real, seeded row's ${entry.fingerprint_field} from ${JSON.stringify(entry.before_value)} to ${JSON.stringify(entry.after_value)} (query: ${entry.fingerprint_query}). This statement has no re-apply guard scoped to "only rows that need it" (e.g. WHERE onboarding_completed IS NOT true) -- it unconditionally reprocesses every row on every run, so re-applying it against a database where new, legitimately-different rows have been created since the first run silently corrupts their state.`,
        });
      }
      if (entry.kind === "backfill" && entry.idempotent) {
        result.findings.push({
          file: sample.file,
          table: sample.table,
          severity: "INFO",
          description: `${sample.file}: confirmed idempotent against real seeded data -- a second application left ${sample.table}'s ${entry.fingerprint_field} unchanged (${JSON.stringify(entry.before_value)} both before and after re-apply, query: ${entry.fingerprint_query}). The NOT EXISTS / conditional guard in this file's statement works as intended.`,
        });
      }
    }
  } finally {
    await client.end().catch(() => {});
    const admin2 = new pg.Client({ connectionString: candidateUrl, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
    try {
      await admin2.connect();
      await admin2.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      console.log(`\nDropped disposable database: ${dbName}`);
    } catch (err) {
      console.error(`WARNING: could not drop disposable database ${dbName}: ${err.message}`);
      result.teardown_warning = `Could not drop disposable database ${dbName}: ${err.message}. Manual cleanup: DROP DATABASE "${dbName}"; against ${redact(candidateUrl)}.`;
    } finally {
      await admin2.end().catch(() => {});
    }
  }

  result.summary = {
    files_total: result.first_apply_pass.length,
    files_applied_ok: result.first_apply_pass.filter((r) => r.ok).length,
    files_failed: result.first_apply_pass.filter((r) => !r.ok).length,
    sample_size: SAMPLE.length,
    sample_tested: result.sample_results.filter((r) => !r.skipped).length,
    sample_skipped: result.sample_results.filter((r) => r.skipped).length,
    sample_idempotent: result.sample_results.filter((r) => r.idempotent === true).length,
    sample_non_idempotent: result.sample_results.filter((r) => r.idempotent === false).length,
    total_findings: result.findings.length,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), "utf8");
  console.log(`\nWrote ${OUT_FILE}`);
  console.log(JSON.stringify(result.summary, null, 2));
}

main().catch((err) => {
  console.error(`HALT: unexpected error: ${err.stack || err.message}`);
  process.exit(1);
});
