#!/usr/bin/env node
// FORGE gate - AR-18.1: prove work LANDED, not just that the working tree was
// clean when a prior gate ran.
//
// Incident (2026-09-18, 04:59): ar-10-3-budget-teeth passed compile, test,
// file_exists and its own shell gate. Migration 198 was already applied to
// PRODUCTION - cost_budgets.period_start is live - while the migration file
// and the code calling its new RPC sat UNCOMMITTED. Four gates green,
// nothing shipped: production schema was ahead of source control, and the
// next agent reading the repo would have seen no period logic at all.
//
// Three checks, each a distinct way "green gates" can lie:
//   1. working tree clean under src/, worker/, supabase/migrations/  - proves
//      the code that produced the gate-passing behaviour is actually saved.
//   2. HEAD not behind/ahead of origin/main - proves it was pushed, not
//      merely committed to a local branch nobody else's agent can see.
//   3. supabase/migrations/*.sql on disk <-> supabase_migrations.schema_migrations
//      match in BOTH directions - proves the schema a later agent will read
//      from git matches the schema actually live in production. Drift either
//      way is dangerous: a ledger row with no file is exactly this incident
//      (something applied that the repo has no record of); a file with no
//      ledger row is the mirror defect (code assumes a schema that was never
//      applied).
//
// Interface is FROZEN: `node scripts/audit/forge-gates/work-landed.mjs`, no
// arguments, run from the project root, exit 0 pass / non-zero fail. 27+
// downstream queue prompts (AR-14 through AR-19) invoke this exact command
// as their last gate - do not change the invocation, only fix bugs here.
//
// Pure logic (parseGitStatus, isAllowedException, diffPushStatus,
// diffMigrationLedger) is exported so work-landed.self-test.mjs can prove
// both directions - clean fixture passes, broken fixture is caught - without
// depending on a live database connection.
//
// AR-18.2 recovery (2026-09-19): check 3 had never once made an assertion. It
// failed on `password authentication failed for user "postgres"` every run
// from 2026-09-17 onward, and behind that sat a second defect - the version
// matching below - that would have fabricated 380 drift findings the moment a
// connection did succeed. Both are fixed; see DIRECTIVE-020.
//
// AR-17.1 recovery (2026-09-19): with check 3 finally asserting, it began
// failing every downstream queue on one file - 170, which DIRECTIVE-020 rule 4
// explicitly forbids any agent from applying (it spends Anthropic budget per
// prospect row) and which is Reid's open decision. Rule 1 forbids softening the
// check; rule 4 forbids fixing the drift. DEFERRED_MIGRATIONS below resolves
// that deadlock by making the exception NAMED, AUDITED and LOUD rather than
// silent: the file is printed on every run, and the waiver itself fails the
// gate if it goes stale or if the migration is later applied.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import pg from "pg";

const SCOPED_PATHS = ["src", "worker", "supabase/migrations"];

// Named explicitly, per the task's requirement that exceptions be named, not
// pattern-guessed. src/docs/ is this repo's one real precedent (see
// src/docs/AUTOAPPLY_RUNBOOK.md) for documentation living inside a scoped
// tree; nothing else currently does.
const ALLOWED_EXCEPTION_PREFIXES = ["src/docs/"];

const MIGRATIONS_DIR = "supabase/migrations";

function sh(args, opts = {}) {
  return execFileSync(args[0], args.slice(1), {
    encoding: "utf8",
    ...opts,
  });
}

// ----------------------------------------------------------------------------
// Check 1: working tree clean under the scoped paths.
// ----------------------------------------------------------------------------

// Parses `git status --porcelain=v1 -- <paths>` output into {code, file}
// entries. Handles the "R  old -> new" rename form by reporting the new path
// (the one that matters for "is this landed") while keeping the raw line for
// operator-facing output.
export function parseGitStatus(porcelainText) {
  const entries = [];
  for (const rawLine of porcelainText.split("\n")) {
    if (!rawLine) continue;
    const code = rawLine.slice(0, 2);
    let rest = rawLine.slice(3);
    if (rest.includes(" -> ")) {
      rest = rest.split(" -> ")[1];
    }
    entries.push({ code, file: rest.replace(/^"|"$/g, ""), raw: rawLine });
  }
  return entries;
}

export function isAllowedException(file) {
  const normalized = file.split(path.sep).join("/");
  return ALLOWED_EXCEPTION_PREFIXES.some((p) => normalized.startsWith(p));
}

export function findUnlandedFiles(porcelainText) {
  return parseGitStatus(porcelainText).filter((e) => !isAllowedException(e.file));
}

// ----------------------------------------------------------------------------
// Check 2: HEAD is exactly at origin/main (not ahead, not behind).
// ----------------------------------------------------------------------------

// `behind` = commits on origin/main missing from HEAD (HEAD is stale).
// `ahead`  = commits on HEAD missing from origin/main (HEAD is unpushed).
// Either non-zero means "not landed" - an ahead-only HEAD is exactly the
// "committed but never pushed" failure mode this gate exists to catch.
export function diffPushStatus(behind, ahead) {
  const problems = [];
  if (behind > 0) {
    problems.push(
      `HEAD is ${behind} commit(s) BEHIND origin/main - local branch is stale. Run: git pull --rebase origin main`,
    );
  }
  if (ahead > 0) {
    problems.push(
      `HEAD is ${ahead} commit(s) AHEAD of origin/main - committed but never pushed. Run: git push origin main`,
    );
  }
  return problems;
}

// ----------------------------------------------------------------------------
// Check 3: migration files on disk <-> supabase_migrations.schema_migrations.
// ----------------------------------------------------------------------------

// This project's ledger does NOT use one stable version convention, so
// matching on "the filename token before the first underscore" - the rule
// AR-18.1 shipped, copied from scripts/audit-migration-ledger.ts - does not
// work here. Live ledger, read 2026-09-19, contains all three of:
//
//   version "001_initial_schema"  name "001_initial_schema"   <- whole stem
//   version "162"                 name "162_pil_deferred_fks" <- bare number
//   version "20260917231636"      name "ar64_model_cost_reference"
//                                    ^ supabase timestamp, name recorded under
//                                      the FORGE task id; the file on disk is
//                                      192_model_cost_reference.sql
//
// Under the old rule every one of the 202 files on disk would have been
// reported as "no ledger row" and all 178 ledger rows as "no file" - 380
// fabricated drift findings. The rule below matches on version AND name, in
// two passes: exact labels first, then normalised ones, with each ledger row
// consumable by at most one file. Two-pass consumption is what keeps the
// duplicate-prefix filenames honest: 063_white_label.sql and
// 086_white_label.sql both normalise to "white_label", but each pairs with
// its own exact ledger row in pass 1 and never reaches the loose pass.
const NUMERIC_PREFIX = /^\d+[_-]/;
const TASK_PREFIX = /^ar\d+(?:[._-]\d+)*[_-]/i;

// ---- Named deferrals: migrations knowingly NOT applied, by human decision ----
//
// DIRECTIVE-020 rule 5 creates a deadlock this registry resolves without
// softening anything. Rule 4 forbids a session applying a behaviour-changing or
// money-spending migration it merely found; rule 1 forbids check 3 auto-passing
// on drift. For 170 both hold at once, so every one of the 27+ downstream FORGE
// queues that ends on this gate fails on a condition that is already decided,
// already documented, and that no agent is permitted to fix. A gate that is red
// for a reason nobody may act on stops being read - which is how the AR-10.3
// incident got four green gates in the first place.
//
// A deferral is NOT a suppression. It must name the file exactly, the decision
// that holds it open, and who owns that decision; the file is still printed on
// every run; and the registry is policed in both directions by
// partitionDeferred() below - a deferral whose file has vanished, or whose
// migration has since been applied, FAILS the gate. Waivers here rot loudly.
//
// Adding an entry is a governance act, not a gate fix. Anything not backed by a
// recorded decision in STANDING_DIRECTIVES.md does not belong in this list.
export const DEFERRED_MIGRATIONS = [
  {
    file: "170_pil_prospects_auto_research_run_trigger.sql",
    owner: "Reid",
    since: "2026-09-19",
    decision: "STANDING_DIRECTIVES.md DIRECTIVE-020, rules 4-5 and the AR-16.1 recovery update",
    reason:
      "Its AFTER INSERT trigger on pil_prospects creates a pil_research_runs row per prospect, and " +
      "/api/cron/pil-research polls those every 10 minutes and spends real Anthropic budget on each. " +
      "Applied once during AR-16.1 and fully reverted (trigger, function and ledger row dropped; zero " +
      "runs created in the interim). Nothing in src/ or worker/ reads the trigger, so leaving it " +
      "unapplied breaks no code path.",
  },
];

// Splits check 3's on-disk-not-in-ledger findings against the deferral registry,
// and audits the registry itself. Pure, so the self-test can prove every branch.
//
//   unexplained - real drift, still fails the gate
//   deferred    - matched a registry entry, reported but does not fail
//   stale       - registry entry naming a file that is no longer on disk
//   resolved    - registry entry whose migration IS now in the ledger
//
// stale and resolved both FAIL: a waiver that no longer describes reality is a
// blind spot, and the only way to clear it is to delete the entry deliberately.
export function partitionDeferred(onDiskNotInLedger, diskFiles, deferrals = DEFERRED_MIGRATIONS) {
  const drift = new Set(onDiskNotInLedger);
  const onDisk = new Set(diskFiles);
  const known = new Map(deferrals.map((d) => [d.file, d]));

  return {
    unexplained: onDiskNotInLedger.filter((f) => !known.has(f)),
    deferred: onDiskNotInLedger.filter((f) => known.has(f)).map((f) => known.get(f)),
    stale: deferrals.filter((d) => !onDisk.has(d.file)),
    resolved: deferrals.filter((d) => onDisk.has(d.file) && !drift.has(d.file)),
  };
}

export function stemOf(filename) {
  return filename.replace(/\.sql$/i, "");
}

// "192_model_cost_reference" -> "model_cost_reference"
// "ar64_model_cost_reference" -> "model_cost_reference"
export function bareLabel(label) {
  return String(label).toLowerCase().replace(NUMERIC_PREFIX, "").replace(TASK_PREFIX, "");
}

// "162_pil_deferred_fks" -> "162" (the bare-number ledger convention)
export function numericPrefixOf(label) {
  const m = /^(\d+)[_-]/.exec(String(label));
  return m ? m[1] : null;
}

export function listMigrationFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

// Accepts either {version, name} rows or bare version strings (the latter is
// what the pure fixtures in work-landed.self-test.mjs pass).
function normaliseLedgerRow(row) {
  if (typeof row === "string") return { version: row, name: null };
  return { version: String(row.version), name: row.name == null ? null : String(row.name) };
}

function keysOf(labels) {
  const exact = labels.map((l) => String(l).toLowerCase());
  const loose = [];
  for (const l of labels) {
    loose.push(bareLabel(l));
    const n = numericPrefixOf(l);
    if (n) loose.push(n);
  }
  return { exact, all: [...new Set([...exact, ...loose])].filter(Boolean) };
}

// diskFiles: array of filenames (e.g. from listMigrationFiles).
// ledgerRows: array of {version, name} (or version strings).
// Returns { onDiskNotInLedger: [filenames], inLedgerNotOnDisk: [labels] }.
export function diffMigrationLedger(diskFiles, ledgerRows) {
  const disk = diskFiles.map((f) => ({ file: f, keys: keysOf([stemOf(f)]), matched: false }));
  const ledger = ledgerRows.map((r) => {
    const row = normaliseLedgerRow(r);
    return { row, keys: keysOf([row.version, row.name].filter(Boolean)), matched: false };
  });

  for (const pass of ["exact", "all"]) {
    for (const d of disk) {
      if (d.matched) continue;
      const wanted = new Set(d.keys[pass]);
      const hit = ledger.find((l) => !l.matched && l.keys[pass].some((k) => wanted.has(k)));
      if (hit) {
        d.matched = true;
        hit.matched = true;
      }
    }
  }

  return {
    onDiskNotInLedger: disk.filter((d) => !d.matched).map((d) => d.file),
    inLedgerNotOnDisk: ledger
      .filter((l) => !l.matched)
      .map((l) => (l.row.name && l.row.name !== l.row.version ? `${l.row.version} (${l.row.name})` : l.row.version))
      .sort(),
  };
}

// ---- Two ways to read the ledger, because one of them is currently dead. ----
//
// DATABASE_URL is the direct connection and is the preferred path when it
// works. On 2026-09-19 it does not: the TCP connection succeeds (contradicting
// the "port 5432 is blocked from this environment" note in the self-test - it
// is not blocked, it answers) and the server rejects the password with 28P01.
// Both Management API PATs recorded in BLUEPRINT_v2.md return 401. The only
// live credential is SUPABASE_SERVICE_ROLE_KEY, and PostgREST exposes just
// public + graphql_public, so migration 201 adds a SECURITY DEFINER wrapper,
// public.forge_migration_ledger(), granted to service_role alone. That is the
// fallback. Nine consecutive queues reported this check unverifiable; a second
// read path is the fix, not relaxing what the check asserts.

async function fetchLedgerViaPostgres(databaseUrl) {
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  try {
    await client.connect();
    const tableCheck = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'`,
    );
    if ((tableCheck.rowCount ?? 0) === 0) {
      return { exists: false, rows: null, error: null };
    }
    const result = await client.query(`SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version`);
    return { exists: true, rows: result.rows, error: null };
  } catch (err) {
    return { exists: null, rows: null, error: err.message };
  } finally {
    try {
      await client.end();
    } catch {
      // ignore close errors
    }
  }
}

async function fetchLedgerViaRest(supabaseUrl, serviceRoleKey) {
  try {
    const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/forge_migration_ledger`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if (!res.ok) {
      const hint = text.includes("PGRST202")
        ? " - public.forge_migration_ledger() is missing; apply supabase/migrations/201_forge_migration_ledger_rpc.sql"
        : "";
      return { exists: null, rows: null, error: `HTTP ${res.status} ${text.slice(0, 200)}${hint}` };
    }
    const rows = JSON.parse(text);
    if (!Array.isArray(rows)) return { exists: null, rows: null, error: `unexpected RPC payload: ${text.slice(0, 200)}` };
    return { exists: true, rows, error: null };
  } catch (err) {
    return { exists: null, rows: null, error: err.message };
  }
}

// Tries every configured path and reports what each one did, so a failure
// names the reason per path instead of collapsing to "cannot check".
async function fetchLedger(env) {
  const attempts = [];

  if (env.DATABASE_URL) {
    const direct = await fetchLedgerViaPostgres(env.DATABASE_URL);
    if (direct.error === null) return { ...direct, source: "DATABASE_URL (direct postgres)", attempts };
    attempts.push(`DATABASE_URL (direct postgres): ${direct.error}`);
  } else {
    attempts.push("DATABASE_URL (direct postgres): not set");
  }

  const restUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const restKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (restUrl && restKey) {
    const rest = await fetchLedgerViaRest(restUrl, restKey);
    if (rest.error === null) return { ...rest, source: "service_role -> public.forge_migration_ledger()", attempts };
    attempts.push(`service_role -> public.forge_migration_ledger(): ${rest.error}`);
  } else {
    attempts.push("service_role -> public.forge_migration_ledger(): NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
  }

  return { exists: null, rows: null, error: "no read path to the migration ledger succeeded", source: null, attempts };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  const failures = [];

  // ---- Check 1: working tree ----
  let porcelain;
  try {
    porcelain = sh(["git", "status", "--porcelain=v1", "--", ...SCOPED_PATHS]);
  } catch (err) {
    console.error(`FAIL [work-landed/check-1]: could not run git status: ${err.message}`);
    process.exit(1);
  }
  const unlanded = findUnlandedFiles(porcelain);
  if (unlanded.length > 0) {
    failures.push(
      `CHECK 1 FAILED - working tree is not clean under ${SCOPED_PATHS.join(", ")}:\n` +
        unlanded.map((e) => `  ${e.raw}`).join("\n") +
        `\n  -> Fix: git add + commit (or discard) every file above, then re-run this gate.`,
    );
  }

  // ---- Check 2: pushed to origin/main ----
  try {
    sh(["git", "fetch", "origin", "main", "--quiet"]);
  } catch (err) {
    failures.push(
      `CHECK 2 FAILED - could not fetch origin/main, so push status cannot be verified: ${err.message}\n` +
        `  -> Fix: ensure network access to the git remote, then re-run this gate.`,
    );
  }
  if (!failures.some((f) => f.startsWith("CHECK 2"))) {
    let behind = 0;
    let ahead = 0;
    try {
      const counts = sh(["git", "rev-list", "--left-right", "--count", "origin/main...HEAD"]).trim().split(/\s+/);
      behind = parseInt(counts[0], 10);
      ahead = parseInt(counts[1], 10);
    } catch (err) {
      failures.push(`CHECK 2 FAILED - could not compare HEAD to origin/main: ${err.message}`);
    }
    const pushProblems = diffPushStatus(behind, ahead);
    if (pushProblems.length > 0) {
      failures.push(`CHECK 2 FAILED - HEAD and origin/main have diverged:\n` + pushProblems.map((p) => `  ${p}`).join("\n"));
    }
  }

  // ---- Check 3: migration ledger drift ----
  loadDotenv({ path: ".env.local" });
  if (!existsSync(MIGRATIONS_DIR)) {
    failures.push(`CHECK 3 FAILED - ${MIGRATIONS_DIR} does not exist - cannot verify migration ledger.`);
  } else {
    const diskFiles = listMigrationFiles(MIGRATIONS_DIR);
    const ledger = await fetchLedger(process.env);
    if (ledger.error) {
      failures.push(
        `CHECK 3 FAILED - could not read supabase_migrations.schema_migrations by any configured path:\n` +
          ledger.attempts.map((a) => `  ${a}`).join("\n") +
          `\n  -> Fix: restore one of the read paths above (see STANDING_DIRECTIVES.md DIRECTIVE-020), then ` +
          `re-run this gate. This is reported as a failure, not skipped, because an unverifiable ledger is ` +
          `exactly the condition this gate exists to never silently pass.`,
      );
    } else if (ledger.exists === false) {
      failures.push(
        `CHECK 3 FAILED - supabase_migrations.schema_migrations does not exist in production.\n` +
          `  -> Fix: this project's migration ledger was previously backfilled (see ` +
          `test-evidence/remediation/migration-drift/ledger-audit-post-apply.md, 2026-08-21). If it is gone, ` +
          `investigate before proceeding - do not re-create it blind.`,
      );
    } else {
      console.log(`work-landed/check-3: ledger read via ${ledger.source} (${ledger.rows.length} rows)`);
      const { onDiskNotInLedger, inLedgerNotOnDisk } = diffMigrationLedger(diskFiles, ledger.rows);
      const { unexplained, deferred, stale, resolved } = partitionDeferred(onDiskNotInLedger, diskFiles);

      // Deferrals are printed on every run, pass or fail - a known gap that
      // stops being visible is a known gap that stops being decided.
      for (const d of deferred) {
        console.log(
          `work-landed/check-3: DEFERRED (not applied, by decision) ${MIGRATIONS_DIR}/${d.file}\n` +
            `  owner: ${d.owner}, since ${d.since} - ${d.decision}\n` +
            `  ${d.reason}`,
        );
      }

      if (unexplained.length > 0) {
        failures.push(
          `CHECK 3 FAILED - ${unexplained.length} migration file(s) on disk have no ledger row ` +
            `(file never applied, OR applied by hand without recording it):\n` +
            unexplained.map((f) => `  ${MIGRATIONS_DIR}/${f}`).join("\n") +
            `\n  -> Fix: apply the migration and record it (supabase migration repair --status applied <version>), ` +
            `or if it is already live, just repair the ledger. If it is knowingly held unapplied by a recorded ` +
            `human decision, add it to DEFERRED_MIGRATIONS in this file with that decision named - see ` +
            `STANDING_DIRECTIVES.md DIRECTIVE-020 rule 6.`,
        );
      }
      if (stale.length > 0) {
        failures.push(
          `CHECK 3 FAILED - ${stale.length} DEFERRED_MIGRATIONS entr(ies) name a file that is no longer on disk:\n` +
            stale.map((d) => `  ${MIGRATIONS_DIR}/${d.file} (${d.decision})`).join("\n") +
            `\n  -> Fix: the deferral no longer describes anything. Delete the entry from DEFERRED_MIGRATIONS ` +
            `in ${path.posix.join("scripts/audit/forge-gates", "work-landed.mjs")}, and record why the file went away.`,
        );
      }
      if (resolved.length > 0) {
        failures.push(
          `CHECK 3 FAILED - ${resolved.length} DEFERRED_MIGRATIONS entr(ies) describe a migration that IS now ` +
            `recorded in the ledger:\n` +
            resolved.map((d) => `  ${MIGRATIONS_DIR}/${d.file} (${d.decision})`).join("\n") +
            `\n  -> Fix: the decision has been made and acted on. Delete the entry from DEFERRED_MIGRATIONS and ` +
            `update the directive that recorded it. A waiver left standing over an applied migration hides the ` +
            `next real drift on that file.`,
        );
      }
      if (inLedgerNotOnDisk.length > 0) {
        failures.push(
          `CHECK 3 FAILED - ${inLedgerNotOnDisk.length} ledger version(s) have no matching file on disk ` +
            `(applied to production with no corresponding migration file committed - this is the exact AR-10.3 ` +
            `incident: migration 198's period_start column was live with the file uncommitted):\n` +
            inLedgerNotOnDisk.map((v) => `  version ${v} (supabase_migrations.schema_migrations)`).join("\n") +
            `\n  -> Fix: commit the missing migration file for each version above, or if it should not exist, ` +
            `investigate why production has it before removing anything.`,
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error(`work-landed: ${failures.length} check(s) FAILED\n`);
    console.error(failures.join("\n\n"));
    process.exit(1);
  }

  const deferralNote =
    DEFERRED_MIGRATIONS.length > 0
      ? ` (${DEFERRED_MIGRATIONS.length} migration(s) knowingly deferred, listed above)`
      : "";
  console.log(
    `OK: working tree clean, HEAD matches origin/main, migration files and ledger agree in both directions${deferralNote}`,
  );
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((err) => {
    console.error(`HALT: unexpected error in work-landed gate: ${err.stack || err.message}`);
    process.exit(1);
  });
}
