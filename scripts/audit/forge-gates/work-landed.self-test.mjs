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
// supabase_migrations.schema_migrations rows, using diffMigrationVersions()
// directly. A live Postgres fixture was not used: this environment's
// outbound access to the direct Postgres port (5432) times out (confirmed
// during this session - HTTPS egress to api.supabase.com works, raw TCP to
// db.<ref>.supabase.co:5432 does not), so fetchLedgerVersions() itself is not
// exercised here. That function is a thin, already-reviewed wrapper (connect,
// one existence check, one SELECT) around the exact pattern used by
// scripts/audit/pt06-001-readonly-connection.mjs and
// scripts/audit-migration-ledger.ts elsewhere in this repo; the logic this
// self-test actually needs to prove - the drift computation - is pure and
// fully covered below.
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
  diffMigrationVersions,
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
  const cleanDrift = diffMigrationVersions(diskFilesClean, ["001"]);
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
  const driftA = diffMigrationVersions(diskFiles, ["001", "999"]);
  expectCatch(
    "check 3 catches a ledger version (999) with no matching file on disk",
    driftA.inLedgerNotOnDisk.length === 1 && driftA.inLedgerNotOnDisk[0] === "999",
  );

  // ============================================================
  // 6. CATCH: a file on disk with no ledger row (never recorded/applied).
  // ============================================================
  writeFileSync(path.join(work, "supabase", "migrations", "002_never_applied.sql"), "alter table t add column x int;\n");
  const diskFilesWithOrphan = listMigrationFiles(path.join(work, "supabase", "migrations"));
  const driftB = diffMigrationVersions(diskFilesWithOrphan, ["001"]);
  expectCatch(
    "check 3 catches a migration file on disk (002_never_applied.sql) with no ledger row",
    driftB.onDiskNotInLedger.length === 1 && driftB.onDiskNotInLedger[0] === "002_never_applied.sql",
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
