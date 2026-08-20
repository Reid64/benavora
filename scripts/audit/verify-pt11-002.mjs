// PT-11-002 gate: confirms test-evidence/pt-11/suite-results-core.json records a
// real, dated execution of every unit/smoke/api/migration suite -- not a
// re-summarization of prior claims. Specifically requires, per suite:
//   - a real run_command
//   - a log_path that exists on disk and is non-empty (the raw captured output)
//   - a numeric exit_code
//   - a counts object with at least one real numeric count (not an empty object)
//   - a status string
// A suite that "cannot even start" is not exempt from this gate -- it still
// needs a log_path (the raw failure output) and an exit_code proving something
// really executed and failed, per the task's own framing that a suite that
// never ran is a higher-severity finding than one that ran and failed.
//
// Also requires the four named categories (unit, smoke, api, migration) to
// each be covered by at least one suite record, and requires every suite id
// present in test-evidence/pt-11/suite-inventory.json under those four
// categories to be accounted for either in `suites[]` (executed) or in
// `not_reexecuted_this_session[]` (explicitly, honestly deferred with a
// reason) -- so a suite cannot simply be dropped from this report silently.
//
//   node scripts/audit/verify-pt11-002.mjs

import fs from "node:fs";
import path from "node:path";

const RESULTS_FILE = path.join("test-evidence", "pt-11", "suite-results-core.json");
const INVENTORY_FILE = path.join("test-evidence", "pt-11", "suite-inventory.json");
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

if (!fs.existsSync(INVENTORY_FILE)) {
  fail(`${INVENTORY_FILE} does not exist -- PT-11-001's inventory is a required dependency for this gate.`);
}

// --- 1. Top-level shape -----------------------------------------------------

if (typeof results.generated_at !== "string" || results.generated_at.trim() === "") {
  fail("generated_at is missing or empty.");
}
if (!Array.isArray(results.suites) || results.suites.length === 0) {
  fail("suites[] is missing or empty.");
}

const suites = Array.isArray(results.suites) ? results.suites : [];
const deferred = Array.isArray(results.not_reexecuted_this_session)
  ? results.not_reexecuted_this_session
  : [];

// --- 2. Per-suite required fields: real run, real log, real counts ---------

for (const [i, s] of suites.entries()) {
  const label = s.id ?? `suites[${i}]`;

  if (typeof s.id !== "string" || s.id.trim() === "") {
    fail(`${label}: missing or empty id.`);
  }
  if (typeof s.category !== "string" || s.category.trim() === "") {
    fail(`${label}: missing or empty category.`);
  }
  if (typeof s.run_command !== "string" || s.run_command.trim() === "") {
    fail(`${label}: missing or empty run_command.`);
  }
  if (typeof s.status !== "string" || s.status.trim() === "") {
    fail(`${label}: missing or empty status.`);
  }
  if (typeof s.exit_code !== "number") {
    fail(`${label}: missing or non-numeric exit_code -- required proof the command actually ran to an OS-level completion.`);
  }

  // The log path is the load-bearing requirement: real raw output on disk.
  if (typeof s.log_path !== "string" || s.log_path.trim() === "") {
    fail(`${label}: missing or empty log_path -- a suite is not "real" without its raw captured output on disk.`);
  } else if (!fs.existsSync(s.log_path)) {
    fail(`${label}: log_path does not exist on disk: ${s.log_path}`);
  } else {
    const stat = fs.statSync(s.log_path);
    if (stat.size === 0) {
      fail(`${label}: log_path exists but is empty (0 bytes): ${s.log_path}`);
    }
    // The log must actually contain the exit_code marker this suite claims,
    // so a stale/copy-pasted log can't be silently substituted for a real one.
    const logText = fs.readFileSync(s.log_path, "utf8");
    const exitMarker = `exit_code=${s.exit_code}`;
    const hasExitMarker = logText.includes(exitMarker);
    const hasPlaywrightSummary = /\d+ (passed|failed)/.test(logText);
    if (!hasExitMarker && !hasPlaywrightSummary) {
      fail(`${label}: log_path does not contain a recognizable completion marker (neither "${exitMarker}" nor a Playwright pass/fail summary line): ${s.log_path}`);
    }
  }

  // A real counts object with at least one real numeric value -- this is the
  // task's explicit gate condition ("records real counts").
  if (typeof s.counts !== "object" || s.counts === null) {
    fail(`${label}: missing counts object.`);
  } else {
    const numericValues = [];
    (function collectNumbers(obj) {
      for (const v of Object.values(obj)) {
        if (typeof v === "number") numericValues.push(v);
        else if (typeof v === "object" && v !== null) collectNumbers(v);
      }
    })(s.counts);
    if (numericValues.length === 0) {
      fail(`${label}: counts object contains no numeric values -- not a real recorded count.`);
    }
  }

  if (typeof s.summary_line_verbatim !== "string" || s.summary_line_verbatim.trim() === "") {
    fail(`${label}: missing summary_line_verbatim -- the raw tool-reported summary this suite's counts were parsed from.`);
  }

  if (typeof s.finding !== "string" || s.finding.trim() === "") {
    fail(`${label}: missing finding -- every suite must state what was found (including "none"), per the task's own framing that failures are findings.`);
  }
}

// --- 3. Deferred (not re-executed) suites must be explicit and reasoned ----

for (const [i, d] of deferred.entries()) {
  const label = d.id ?? `not_reexecuted_this_session[${i}]`;
  if (typeof d.id !== "string" || d.id.trim() === "") {
    fail(`${label}: missing or empty id.`);
  }
  if (typeof d.reason !== "string" || d.reason.trim() === "") {
    fail(`${label}: deferred suite must carry a real reason, not a silent omission.`);
  }
}

// --- 4. Required category coverage: unit, smoke, api, migration -----------

const executedBlobs = suites.map((s) => `${s.category ?? ""} ${s.id ?? ""}`.toLowerCase());
const deferredBlobs = deferred.map((d) => `${d.category ?? ""} ${d.id ?? ""}`.toLowerCase());
const allBlobs = [...executedBlobs, ...deferredBlobs];

const requiredCategories = [
  { name: "unit", re: /unit/ },
  { name: "smoke", re: /smoke/ },
  { name: "api", re: /\bapi\b/ },
  { name: "migration", re: /migration/ },
];

for (const c of requiredCategories) {
  if (!allBlobs.some((b) => c.re.test(b))) {
    fail(`No suite record (executed or deferred) covers the required category: "${c.name}".`);
  }
}

// unit/smoke/api specifically must have at least one EXECUTED (not merely
// deferred) suite -- migration is a single audit tool, unit/smoke/api each
// have multiple real application test files that must actually have run.
for (const name of ["unit", "smoke", "api"]) {
  if (!executedBlobs.some((b) => b.includes(name))) {
    fail(`Category "${name}" has no executed suite record (only deferred, if any) -- this category must have at least one real, freshly-run suite.`);
  }
}

// --- 5. Cross-check against suite-inventory.json: nothing silently dropped -

if (fs.existsSync(INVENTORY_FILE)) {
  let inventory;
  try {
    inventory = JSON.parse(fs.readFileSync(INVENTORY_FILE, "utf8"));
  } catch (err) {
    fail(`${INVENTORY_FILE} is not valid JSON: ${err.message}`);
    inventory = null;
  }

  if (inventory && Array.isArray(inventory.suites)) {
    const coreCategoryRe = /^(unit|unit \(lib\)|api|smoke)/i;
    const coreInventorySuites = inventory.suites.filter((s) => coreCategoryRe.test(s.category ?? ""));
    const migrationInventorySuites = inventory.suites.filter((s) => /migration/i.test(s.category ?? ""));
    const expectedIds = new Set([
      ...coreInventorySuites.map((s) => s.id),
      ...migrationInventorySuites.map((s) => s.id),
    ]);

    const accountedIds = new Set([
      ...suites.map((s) => s.id),
      ...deferred.map((d) => d.id),
    ]);

    for (const id of expectedIds) {
      if (!accountedIds.has(id)) {
        fail(`Inventory suite "${id}" (unit/smoke/api/migration category) is not accounted for in suite-results-core.json -- neither executed nor explicitly deferred.`);
      }
    }
  } else if (inventory) {
    warn("suite-inventory.json has no suites[] array -- cross-check against it was skipped.");
  }
}

// --- Report -------------------------------------------------------------

const totalExecuted = suites.length;
const withFailures = suites.filter((s) => (s.exit_code ?? 0) !== 0).length;

console.log("=".repeat(78));
console.log("PT-11-002 verification: test-evidence/pt-11/suite-results-core.json");
console.log("=".repeat(78));
console.log(`suites executed this session: ${totalExecuted}`);
console.log(`  exit_code == 0: ${totalExecuted - withFailures}`);
console.log(`  exit_code != 0 (real failures/findings): ${withFailures}`);
console.log(`suites explicitly deferred (not re-executed): ${deferred.length}`);
console.log(`required categories checked: ${requiredCategories.map((c) => c.name).join(", ")}`);

if (warnings.length > 0) {
  console.log("\nWarnings (non-fatal):");
  for (const w of warnings) console.log(`  [WARN] ${w}`);
}

if (failures.length > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  [FAIL] ${f}`);
  console.log(`\n${failures.length} failure(s). PT-11-002 gate: FAIL.`);
  process.exit(1);
}

console.log("\nAll checks passed. PT-11-002 gate: PASS.");
process.exit(0);
