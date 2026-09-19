#!/usr/bin/env node
// Self-test for work-landed.mjs, per the standing discipline (see
// STANDING_DIRECTIVES.md, "self-test before shipping, both directions") that
// caught three gate bugs on 2026-09-17: never ship a gate without proving it
// both passes clean fixtures AND catches broken ones.
//
// Checks 1 and 2 (working tree, push status) are exercised against a REAL
// temporary git repo with a real bare "origin" remote - not string fixtures -
// so the actual git plumbing the gate shells out to is what gets proven.
//
// Check 3 (migration ledger drift) is exercised against real on-disk .sql
// fixture files plus a fixture array standing in for
// supabase_migrations.schema_migrations rows, using diffMigrationLedger()
// directly. The read path itself is not fixtured here - it is proven against
// the live ledger by running the gate, which on 2026-09-19 read 199 rows via
// the service_role fallback.
//
// CORRECTION (2026-09-19) to this file's original note: it claimed raw TCP to
// db.<ref>.supabase.co:5432 times out from this environment. It does not -
// the port answers and the server returns 28P01 (password authentication
// failed). The DATABASE_URL credential is wrong/rotated; the network is fine.
// That mattered, because "the port is blocked" is unfixable and "the password
// is wrong" is not, and the wrong diagnosis is part of why check 3 went nine
// queues without ever running.
//
// The matching fixtures below cover all three ledger-labelling conventions
// this project actually uses (whole stem, bare number, timestamp + task-id
// name), because matching on "the token before the first underscore" - the
// rule this gate originally shipped - fabricated 380 drift findings against
// the real ledger.
//
// Usage: node scripts/audit/forge-gates/work-landed.self-test.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  parseGitStatus,
  isAllowedException,
  findUnlandedFiles,
  diffPushStatus,
  diffMigrationLedger,
  listMigrationFiles,
} from "./work-landed.mjs";

let passCount = 0;
let catchCount = 0;
let failures = [];

function expectPass(label, condition) {
  if (condition) {
    passCount++;
    console.log(`PASS  (clean):   ${label}`);
  } else {
    failures.push(`EXPECTED CLEAN PASS but got a failure: ${label}`);
    console.error(`FAIL: ${label} - expected clean pass, did not get one`);
  }
}

function expectCatch(label, condition) {
  if (condition) {
    catchCount++;
    console.log(`CATCH (broken):  ${label}`);
  } else {
    failures.push(`EXPECTED CATCH but gate stayed silent: ${label}`);
    console.error(`FAIL: ${label} - expected this to be caught, it was not`);
  }
}

function sh(args, cwd) {
  return execFileSync(args[0], args.slice(1), { encoding: "utf8", cwd });
}

function shOrNull(args, cwd) {
  try {
    return sh(args, cwd);
  } catch (err) {
    return err.stdout ?? "";
  }
}

// ----------------------------------------------------------------------------
// Build the real git fixture: a work repo + a bare "origin" remote.
// ----------------------------------------------------------------------------

const tmpRoot = mkdtempSync(path.join(tmpdir(), "work-landed-selftest-"));
const bareRemote = path.join(tmpRoot, "origin.git");
const work = path.join(tmpRoot, "work");

try {
  sh(["git", "init", "--bare", "--initial-branch=main", bareRemote]);
  sh(["git", "-c", "init.defaultBranch=main", "init", work]);
  sh(["git", "config", "user.email", "forge-selftest@example.com"], work);
  sh(["git", "config", "user.name", "FORGE Self-Test"], work);

  mkdirSync(path.join(work, "src", "docs"), { recursive: true });
  mkdirSync(path.join(work, "worker"), { recursive: true });
  mkdirSync(path.join(work, "supabase", "migrations"), { recursive: true });
  writeFileSync(path.join(work, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(path.join(work, "worker", "b.ts"), "export const b = 2;\n");
  writeFileSync(path.join(work, "supabase", "migrations", "001_init.sql"), "create table t (id int);\n");

  sh(["git", "add", "-A"], work);
  sh(["git", "commit", "-m", "fixture: initial commit"], work);
  sh(["git", "remote", "add", "origin", bareRemote], work);
  sh(["git", "push", "-u", "origin", "main"], work);

  // ---- helper to compute check-1 result against the fixture repo ----
  function check1() {
    const porcelain = sh(["git", "status", "--porcelain=v1", "--", "src", "worker", "supabase/migrations"], work);
    return findUnlandedFiles(porcelain);
  }

  // ---- helper to compute check-2 result against the fixture repo ----
  function check2() {
    shOrNull(["git", "fetch", "origin", "main", "--quiet"], work);
    const counts = sh(["git", "rev-list", "--left-right", "--count", "origin/main...HEAD"], work)
      .trim()
      .split(/\s+/)
      .map(Number);
    return diffPushStatus(counts[0], counts[1]);
  }

  // ============================================================
  // 1. CLEAN FIXTURE - everything committed and pushed - must pass.
  // ============================================================
  expectPass("check 1 (working tree) on a freshly committed, pushed fixture", check1().length === 0);
  expectPass("check 2 (push status) on a freshly committed, pushed fixture", check2().length === 0);

  const diskFilesClean = listMigrationFiles(path.join(work, "supabase", "migrations"));
  const cleanDrift = diffMigrationLedger(diskFilesClean, ["001"]);
  expectPass(
    "check 3 (migration drift) when disk and ledger fixture agree",
    cleanDrift.onDiskNotInLedger.length === 0 && cleanDrift.inLedgerNotOnDisk.length === 0,
  );

  // ============================================================
  // 2. CATCH: allowed exception must NOT be flagged (src/docs/).
  // ============================================================
  writeFileSync(path.join(work, "src", "docs", "note.md"), "# fixture doc\n");
  expectPass(
    "check 1 does not flag an untracked file under the named exception src/docs/",
    check1().length === 0,
  );
  rmSync(path.join(work, "src", "docs", "note.md"));

  // ============================================================
  // 3. CATCH: uncommitted source file under a scoped path.
  // ============================================================
  writeFileSync(path.join(work, "src", "dirty.ts"), "export const dirty = true;\n");
  const dirtyResult = check1();
  expectCatch(
    "check 1 catches an uncommitted (untracked) file under src/",
    dirtyResult.length === 1 && dirtyResult[0].file === "src/dirty.ts",
  );
  rmSync(path.join(work, "src", "dirty.ts"));
  expectPass("check 1 is clean again after removing the fixture's dirty file", check1().length === 0);

  // ============================================================
  // 4. CATCH: unpushed commit (HEAD ahead of origin/main).
  // ============================================================
  writeFileSync(path.join(work, "worker", "b.ts"), "export const b = 3; // local-only change\n");
  sh(["git", "commit", "-am", "fixture: local-only change, never pushed"], work);
  const unpushedResult = check2();
  expectCatch(
    "check 2 catches HEAD ahead of origin/main (committed but not pushed)",
    unpushedResult.length === 1 && /AHEAD/.test(unpushedResult[0]),
  );

  // Push it so the fixture is clean again for anything after this point.
  sh(["git", "push", "origin", "main"], work);
  expectPass("check 2 is clean again after pushing the fixture's local commit", check2().length === 0);

  // ============================================================
  // 5. CATCH: a ledger version with no file on disk (AR-10.3's own defect
  //    shape - something applied to production with no committed file).
  // ============================================================
  const diskFiles = listMigrationFiles(path.join(work, "supabase", "migrations"));
  const driftA = diffMigrationLedger(diskFiles, ["001", "999"]);
  expectCatch(
    "check 3 catches a ledger version (999) with no matching file on disk",
    driftA.inLedgerNotOnDisk.length === 1 && driftA.inLedgerNotOnDisk[0] === "999",
  );

  // ============================================================
  // 6. CATCH: a file on disk with no ledger row (never recorded/applied).
  // ============================================================
  writeFileSync(path.join(work, "supabase", "migrations", "002_never_applied.sql"), "alter table t add column x int;\n");
  const diskFilesWithOrphan = listMigrationFiles(path.join(work, "supabase", "migrations"));
  const driftB = diffMigrationLedger(diskFilesWithOrphan, ["001"]);
  expectCatch(
    "check 3 catches a migration file on disk (002_never_applied.sql) with no ledger row",
    driftB.onDiskNotInLedger.length === 1 && driftB.onDiskNotInLedger[0] === "002_never_applied.sql",
  );

  // ============================================================
  // 7. CLEAN: the three real ledger-labelling conventions must all match,
  //    with no file on disk and no ledger row left over. Every one of these
  //    was a false "drift" finding under the original token-before-first-
  //    underscore rule.
  // ============================================================
  const realWorldFiles = [
    "001_initial_schema.sql", // ledger version IS the whole stem
    "162_pil_deferred_fks.sql", // ledger version is the bare number, name is the stem
    "192_model_cost_reference.sql", // ledger version is a timestamp, name is the FORGE task id
    "199_agent_run_status_skipped.sql", // ledger name dropped the file's number prefix
  ];
  const realWorldLedger = [
    { version: "001_initial_schema", name: "001_initial_schema" },
    { version: "162", name: "162_pil_deferred_fks" },
    { version: "20260917231636", name: "ar64_model_cost_reference" },
    { version: "20260918100836", name: "agent_run_status_skipped" },
  ];
  const realWorldDrift = diffMigrationLedger(realWorldFiles, realWorldLedger);
  expectPass(
    "check 3 matches all three real ledger conventions (stem, bare number, timestamp+task-id name)",
    realWorldDrift.onDiskNotInLedger.length === 0 && realWorldDrift.inLedgerNotOnDisk.length === 0,
  );

  // ============================================================
  // 8. CLEAN + CATCH: duplicate-prefix filenames. 063_white_label.sql and
  //    086_white_label.sql both normalise to "white_label"; each must pair
  //    with its OWN exact ledger row, and a genuinely missing one must still
  //    be caught rather than absorbed by its twin.
  // ============================================================
  const twins = ["063_white_label.sql", "086_white_label.sql"];
  const bothRecorded = diffMigrationLedger(twins, ["063_white_label", "086_white_label"]);
  expectPass(
    "check 3 pairs duplicate-name migrations with their own exact ledger rows",
    bothRecorded.onDiskNotInLedger.length === 0 && bothRecorded.inLedgerNotOnDisk.length === 0,
  );
  const oneRecorded = diffMigrationLedger(twins, ["063_white_label"]);
  expectCatch(
    "check 3 still catches the unrecorded twin (086_white_label.sql) instead of matching it loosely",
    oneRecorded.onDiskNotInLedger.length === 1 && oneRecorded.onDiskNotInLedger[0] === "086_white_label.sql",
  );

  // ============================================================
  // 9. CATCH: a ledger row identified only by its name (the timestamp-version
  //    shape) with no file on disk - the AR-10.3 defect in its modern form.
  // ============================================================
  const orphanNamed = diffMigrationLedger(["001_initial_schema.sql"], [
    { version: "001_initial_schema", name: "001_initial_schema" },
    { version: "20260918113008", name: "funder_delete_cancels_queue_items" },
  ]);
  expectCatch(
    "check 3 catches a timestamp-versioned ledger row whose file was never committed",
    orphanNamed.inLedgerNotOnDisk.length === 1 &&
      orphanNamed.inLedgerNotOnDisk[0] === "20260918113008 (funder_delete_cancels_queue_items)",
  );
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

console.log("");
console.log(`SELF-TEST SUMMARY: ${passCount} clean-pass case(s), ${catchCount} catch case(s), ${failures.length} unexpected result(s)`);
if (failures.length > 0) {
  console.error("\n" + failures.join("\n"));
  process.exit(1);
}
process.exit(0);
