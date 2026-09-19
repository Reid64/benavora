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
// diffMigrationVersions) is exported so work-landed.self-test.mjs can prove
// both directions - clean fixture passes, broken fixture is caught - without
// depending on a live database connection, which is unreliable from some
// execution environments (see self-test file for the live-repo caveat this
// produced on 2026-09-19).

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

// Version convention matches the existing precedent in
// scripts/audit-migration-ledger.ts: version = filename token before the
// first underscore (e.g. "198_budget_period_start.sql" -> "198"). This
// project has a handful of duplicate-prefix filenames (e.g. two "022_*"
// files); when that happens they share one ledger version and cannot be
// individually distinguished by version alone. That is an existing, known
// limitation of this project's versioning scheme, not something this gate
// invents or can fix by itself.
export function versionOf(filename) {
  return filename.split("_")[0];
}

export function listMigrationFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

// diskFiles: array of filenames (e.g. from listMigrationFiles).
// ledgerVersions: array of version strings from schema_migrations.version.
// Returns { onDiskNotInLedger: [filenames], inLedgerNotOnDisk: [versions] }.
export function diffMigrationVersions(diskFiles, ledgerVersions) {
  const ledgerSet = new Set(ledgerVersions.map(String));
  const diskVersionSet = new Set(diskFiles.map(versionOf));

  const onDiskNotInLedger = diskFiles.filter((f) => !ledgerSet.has(versionOf(f)));
  const inLedgerNotOnDisk = [...ledgerSet].filter((v) => !diskVersionSet.has(v)).sort();

  return { onDiskNotInLedger, inLedgerNotOnDisk };
}

async function fetchLedgerVersions(databaseUrl) {
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
      return { exists: false, versions: null, error: null };
    }
    const rows = await client.query(`SELECT version FROM supabase_migrations.schema_migrations ORDER BY version`);
    return { exists: true, versions: rows.rows.map((r) => String(r.version)), error: null };
  } catch (err) {
    return { exists: null, versions: null, error: err.message };
  } finally {
    try {
      await client.end();
    } catch {
      // ignore close errors
    }
  }
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
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    failures.push(
      `CHECK 3 FAILED - DATABASE_URL not set (checked process.env and .env.local) - cannot verify migration ledger.\n` +
        `  -> Fix: set DATABASE_URL, then re-run this gate.`,
    );
  } else if (!existsSync(MIGRATIONS_DIR)) {
    failures.push(`CHECK 3 FAILED - ${MIGRATIONS_DIR} does not exist - cannot verify migration ledger.`);
  } else {
    const diskFiles = listMigrationFiles(MIGRATIONS_DIR);
    const ledger = await fetchLedgerVersions(databaseUrl);
    if (ledger.error) {
      failures.push(
        `CHECK 3 FAILED - could not query supabase_migrations.schema_migrations: ${ledger.error}\n` +
          `  -> Fix: confirm DATABASE_URL is reachable from this environment (see STANDING_DIRECTIVES.md ` +
          `for the known direct-connection-vs-pooler caveat), then re-run this gate. This is reported as a ` +
          `failure, not skipped, because an unverifiable ledger is exactly the condition this gate exists to ` +
          `never silently pass.`,
      );
    } else if (ledger.exists === false) {
      failures.push(
        `CHECK 3 FAILED - supabase_migrations.schema_migrations does not exist in production.\n` +
          `  -> Fix: this project's migration ledger was previously backfilled (see ` +
          `test-evidence/remediation/migration-drift/ledger-audit-post-apply.md, 2026-08-21). If it is gone, ` +
          `investigate before proceeding - do not re-create it blind.`,
      );
    } else {
      const { onDiskNotInLedger, inLedgerNotOnDisk } = diffMigrationVersions(diskFiles, ledger.versions);
      if (onDiskNotInLedger.length > 0) {
        failures.push(
          `CHECK 3 FAILED - ${onDiskNotInLedger.length} migration file(s) on disk have no ledger row ` +
            `(file never applied, OR applied by hand without recording it):\n` +
            onDiskNotInLedger.map((f) => `  ${MIGRATIONS_DIR}/${f}`).join("\n") +
            `\n  -> Fix: apply the migration and record it (supabase migration repair --status applied <version>), ` +
            `or if it is already live, just repair the ledger.`,
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

  console.log("OK: working tree clean, HEAD matches origin/main, migration files and ledger agree in both directions");
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((err) => {
    console.error(`HALT: unexpected error in work-landed gate: ${err.stack || err.message}`);
    process.exit(1);
  });
}
