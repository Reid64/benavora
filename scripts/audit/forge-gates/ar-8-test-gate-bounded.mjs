#!/usr/bin/env node
// FORGE gate - AR-8.2: the test gate must fit inside its own time budget.
//
// 2026-09-17: FORGE's test gate hit "TIMEOUT after 300s, process tree killed"
// on 156 spec files during AR-7.1 and burned a retry. The suite grows every
// phase. A gate that times out on healthy work is a false FAIL, the same defect
// class as a gate that passes broken work.
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };

// 1. Unit and integration must be separately runnable, so the default gate is
//    not dragged by DB-backed suites.
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
for (const s of ["test:unit", "test:integration"]) {
  if (!pkg.scripts?.[s]) fail(`package.json has no "${s}" script - the gate cannot run a bounded subset`);
}

// 2. The default `test` script must not pull in live-network or live-DB suites.
// Strip --exclude/--ignore clauses first: naming integration-live in order to
// EXCLUDE it is the correct state, and matching the raw string flagged it as a
// violation (2026-09-18 gate bug, caught in the fixture pass).
const dflt = (pkg.scripts.test ?? "")
  .replace(/--(exclude|ignore)(=|\s+)(['"][^'"]*['"]|\S+)/g, " ");
if (/integration-live/.test(dflt))
  fail(`package.json "test" RUNS integration-live suites - those need credentials and network and do not belong in a build gate`);

// 3. A recorded wall-clock budget must exist, so the ceiling is a decision and
//    not a surprise.
const BUDGET = "test-evidence/TEST_GATE_BUDGET.md";
if (!existsSync(BUDGET))
  fail(`${BUDGET} not found - record the measured suite runtime and the gate ceiling it must stay under`);
const b = readFileSync(BUDGET, "utf8");
if (!/\d+\s*s(ec)?/i.test(b)) fail(`${BUDGET} records no measured seconds - it must carry a real number, not prose`);
if (!/\b(300|600|900)\s*s?(ec)?\b/.test(b)) fail(`${BUDGET} does not name the FORGE gate ceiling it was measured against`);

// 4. Spec count, so growth is visible.
let n = "0";
try { n = execSync(`grep -rl --include=*.test.ts --include=*.test.tsx --include=*.spec.ts -e "" src tests e2e 2>/dev/null | wc -l`, { encoding: "utf8" }).trim(); } catch {}
console.log(`OK: unit/integration split present, default gate excludes live suites, budget recorded (${n} spec files)`);
