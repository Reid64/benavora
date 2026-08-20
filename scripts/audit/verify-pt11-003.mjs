// PT-11-003 gate: confirms test-evidence/pt-11/suite-results-flaky.json records
// a real, dated re-execution of the three historically flaky/non-deterministic
// suite categories from PT-11-001's inventory -- visual-regression,
// cross-browser, and soak -- not a re-summarization of the 2026-08-13 /
// 2026-08-20 prior claims already on file. Per this gate's own premise, a
// suite that flaked or failed again is not a defect in the audit -- it's the
// audit doing its job. This script does NOT require any suite to pass; it
// requires each suite to have been RUN FOR REAL, with real captured output,
// and (for the two suites this task explicitly asked to be checked for
// persistence -- visual-regression and cross-browser) run at least twice so a
// one-off flake can be told apart from a persisting failure.
//
// Required per suite:
//   visual-regression:
//     - a real "baseline_generation" run record (log_path exists, non-empty,
//       real exit_code) -- proves a fresh baseline was actually generated
//       this session, not reused from disk.
//     - at least 2 "comparison" run records (log_path exists, non-empty, real
//       exit_code, numeric counts, a finding string) -- proves persistence
//       was actually checked, not inferred from a single run.
//   cross-browser:
//     - at least 2 run records, each with log_path/exit_code/counts covering
//       all three engines (chromium, firefox, webkit) by name somewhere in
//       the record (per-browser breakdown), plus a finding string.
//   soak:
//     - at least 1 run record with log_path/exit_code/counts and a finding
//       string that explicitly addresses whether the known rate-limiter
//       characteristic (documented in scripts/soak-test-autoapply-worker.ts's
//       own header, and in SOAK_TEST_AUTOAPPLY_RESULTS*.md) held this run.
//
//   node scripts/audit/verify-pt11-003.mjs

import fs from "node:fs";
import path from "node:path";

const RESULTS_FILE = path.join("test-evidence", "pt-11", "suite-results-flaky.json");
const failures = [];
const warnings = [];

function fail(msg) {
  failures.push(msg);
}
function warn(msg) {
  warnings.push(msg);
}

if (!fs.existsSync(RESULTS_FILE)) {
  console.error(`FATAL: ${RESULTS_FILE} does not exist.`);
  process.exit(1);
}

let results;
try {
  results = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8"));
} catch (err) {
  console.error(`FATAL: ${RESULTS_FILE} is not valid JSON: ${err.message}`);
  process.exit(1);
}

// --- helpers ----------------------------------------------------------------

function collectNumbers(obj) {
  const out = [];
  (function walk(o) {
    if (o === null || typeof o !== "object") return;
    for (const v of Object.values(o)) {
      if (typeof v === "number") out.push(v);
      else if (typeof v === "object" && v !== null) walk(v);
    }
  })(obj);
  return out;
}

function checkRunRecord(label, r, { requireCounts = true } = {}) {
  const errs = [];
  if (typeof r.run_command !== "string" || r.run_command.trim() === "") {
    errs.push(`${label}: missing or empty run_command.`);
  }
  if (typeof r.exit_code !== "number") {
    errs.push(`${label}: missing or non-numeric exit_code -- required proof the command actually ran to an OS-level completion.`);
  }
  if (typeof r.log_path !== "string" || r.log_path.trim() === "") {
    errs.push(`${label}: missing or empty log_path -- a run is not "real" without its raw captured output on disk.`);
  } else if (!fs.existsSync(r.log_path)) {
    errs.push(`${label}: log_path does not exist on disk: ${r.log_path}`);
  } else {
    const stat = fs.statSync(r.log_path);
    if (stat.size === 0) {
      errs.push(`${label}: log_path exists but is empty (0 bytes): ${r.log_path}`);
    } else {
      const logText = fs.readFileSync(r.log_path, "utf8");
      const exitMarker = `exit_code=${r.exit_code}`;
      const hasExitMarker = logText.includes(exitMarker);
      const hasPlaywrightSummary = /\d+ (passed|failed)/.test(logText);
      const hasSoakSummary = /MAX_RUN_MS|reached a terminal status|Report written to/.test(logText);
      if (!hasExitMarker && !hasPlaywrightSummary && !hasSoakSummary) {
        errs.push(
          `${label}: log_path does not contain a recognizable completion marker (neither "${exitMarker}", a Playwright pass/fail summary, nor a soak-script completion line): ${r.log_path}`,
        );
      }
    }
  }
  if (requireCounts) {
    if (typeof r.counts !== "object" || r.counts === null) {
      errs.push(`${label}: missing counts object.`);
    } else if (collectNumbers(r.counts).length === 0) {
      errs.push(`${label}: counts object contains no numeric values -- not a real recorded count.`);
    }
  }
  if (typeof r.finding !== "string" || r.finding.trim() === "") {
    errs.push(`${label}: missing finding -- every run must state what was found (including "none" / "matches prior claim"), per the task's own framing that persisting flakiness/failures are findings.`);
  }
  return errs;
}

// --- top-level shape ---------------------------------------------------------

if (typeof results.generated_at !== "string" || results.generated_at.trim() === "") {
  fail("generated_at is missing or empty.");
}
if (!Array.isArray(results.suites) || results.suites.length === 0) {
  fail("suites[] is missing or empty.");
}
const suites = Array.isArray(results.suites) ? results.suites : [];
const byId = new Map(suites.map((s) => [s.id, s]));

// --- 1. visual-regression ----------------------------------------------------

const vr = byId.get("visual-regression");
if (!vr) {
  fail('No suite record with id "visual-regression".');
} else {
  const baseline = vr.baseline_generation;
  if (!baseline || typeof baseline !== "object") {
    fail('visual-regression: missing baseline_generation record -- required proof a FRESH baseline was generated this session, not reused from disk.');
  } else {
    for (const e of checkRunRecord("visual-regression.baseline_generation", baseline, { requireCounts: false })) fail(e);
    if (typeof baseline.exit_code === "number" && baseline.exit_code !== 0) {
      fail(`visual-regression.baseline_generation: exit_code=${baseline.exit_code} -- baseline generation itself must succeed (a failed --update-snapshots run produces no real baseline to compare against).`);
    }
  }

  const runs = Array.isArray(vr.comparison_runs) ? vr.comparison_runs : [];
  if (runs.length < 2) {
    fail(`visual-regression: only ${runs.length} comparison_runs recorded -- at least 2 are required to distinguish a persisting failure from a one-off flake, per this task's explicit instruction to check whether findings persist.`);
  }
  runs.forEach((r, i) => {
    for (const e of checkRunRecord(`visual-regression.comparison_runs[${i}]`, r)) fail(e);
  });

  if (typeof vr.persistence_finding !== "string" || vr.persistence_finding.trim() === "") {
    fail("visual-regression: missing persistence_finding -- must state explicitly whether any failure/diff reproduced across the comparison_runs or was a one-off.");
  }
}

// --- 2. cross-browser ---------------------------------------------------------

const cb = byId.get("cross-browser");
if (!cb) {
  fail('No suite record with id "cross-browser".');
} else {
  const runs = Array.isArray(cb.runs) ? cb.runs : [];
  if (runs.length < 2) {
    fail(`cross-browser: only ${runs.length} runs recorded -- at least 2 are required to check whether the known WebKit navigation race (and any other failure) persists, per this task's explicit instruction.`);
  }
  const requiredEngines = ["chromium", "firefox", "webkit"];
  runs.forEach((r, i) => {
    for (const e of checkRunRecord(`cross-browser.runs[${i}]`, r)) fail(e);
    const blob = JSON.stringify(r).toLowerCase();
    for (const engine of requiredEngines) {
      if (!blob.includes(engine)) {
        fail(`cross-browser.runs[${i}]: no mention of engine "${engine}" anywhere in the record -- per-browser breakdown is required, not just an aggregate pass/fail count.`);
      }
    }
  });

  if (typeof cb.persistence_finding !== "string" || cb.persistence_finding.trim() === "") {
    fail("cross-browser: missing persistence_finding -- must state explicitly whether the known WebKit navigation race (10/17 prior) reproduced this run, and the real current pass rate.");
  } else if (!/webkit/i.test(cb.persistence_finding)) {
    fail('cross-browser: persistence_finding does not mention "webkit" -- the task explicitly named the known WebKit navigation race as the thing to re-target and check.');
  }
}

// --- 3. soak -------------------------------------------------------------------

const soakSuites = suites.filter((s) => typeof s.id === "string" && /soak/i.test(s.id));
if (soakSuites.length === 0) {
  fail('No suite record with an id matching /soak/i.');
} else {
  for (const s of soakSuites) {
    for (const e of checkRunRecord(`${s.id}`, s)) fail(e);
    if (typeof s.rate_limiter_finding !== "string" || s.rate_limiter_finding.trim() === "") {
      fail(`${s.id}: missing rate_limiter_finding -- must explicitly state whether the previously-documented unconditional 60-120s waitBetweenSubmissions() rate limiter (worker/queue-processor.ts / worker/rate-limiter.ts) held over this run's duration, per the task's explicit instruction.`);
    }
  }
}

// --- Report -------------------------------------------------------------------

console.log("=".repeat(78));
console.log("PT-11-003 verification: test-evidence/pt-11/suite-results-flaky.json");
console.log("=".repeat(78));
console.log(`suite records present: ${suites.map((s) => s.id).join(", ")}`);
if (vr) {
  console.log(`  visual-regression: baseline=${vr.baseline_generation ? "recorded" : "MISSING"}, comparison_runs=${Array.isArray(vr.comparison_runs) ? vr.comparison_runs.length : 0}`);
}
if (cb) {
  console.log(`  cross-browser: runs=${Array.isArray(cb.runs) ? cb.runs.length : 0}`);
}
for (const s of soakSuites) {
  console.log(`  ${s.id}: exit_code=${s.exit_code}`);
}

if (warnings.length > 0) {
  console.log("\nWarnings (non-fatal):");
  for (const w of warnings) console.log(`  [WARN] ${w}`);
}

if (failures.length > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  [FAIL] ${f}`);
  console.log(`\n${failures.length} failure(s). PT-11-003 gate: FAIL.`);
  process.exit(1);
}

console.log("\nAll checks passed. PT-11-003 gate: PASS.");
process.exit(0);
