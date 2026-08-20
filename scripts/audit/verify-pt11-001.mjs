// PT-11-001 gate: confirms test-evidence/pt-11/suite-inventory.json is a real,
// complete inventory of the repo's test suites -- not a partial or placeholder
// file. Specifically requires every suite record to carry a real run-command,
// and requires the six named categories from the task (unit, smoke, api,
// visual-regression, cross-browser, soak, migration) to each be represented by
// at least one suite. Exits non-zero on any failure.
//
//   node scripts/audit/verify-pt11-001.mjs

import fs from "node:fs";
import path from "node:path";

const FILE = path.join("test-evidence", "pt-11", "suite-inventory.json");
const failures = [];
const warnings = [];

function fail(msg) {
  failures.push(msg);
}

if (!fs.existsSync(FILE)) {
  console.error(`FATAL: ${FILE} does not exist.`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch (err) {
  console.error(`FATAL: ${FILE} is not valid JSON: ${err.message}`);
  process.exit(1);
}

// --- 1. Top-level shape -----------------------------------------------------

if (!Array.isArray(data.suites) || data.suites.length === 0) {
  fail("suites[] is missing or empty.");
}
if (typeof data.generated_at !== "string" || data.generated_at.trim() === "") {
  fail("generated_at is missing or empty.");
}

const suites = Array.isArray(data.suites) ? data.suites : [];
const VALID_COMPLETION = new Set([true, false, "unknown", "partial (file-by-file, never confirmed as one suite run)"]);

// --- 2. Per-suite required fields -------------------------------------------
// The task's own gate condition: every suite record must carry its
// run-command. Also require the other fields the task asked each record to
// have (file, framework, last-known status claim, whether it appears to have
// ever actually run to completion).

for (const [i, s] of suites.entries()) {
  const label = s.id ?? `suites[${i}]`;

  if (typeof s.id !== "string" || s.id.trim() === "") {
    fail(`${label}: missing or empty id.`);
  }

  if (typeof s.run_command !== "string" || s.run_command.trim() === "") {
    fail(`${label}: missing or empty run_command — this is the task's explicit gate condition.`);
  }

  if (typeof s.framework !== "string" || s.framework.trim() === "") {
    fail(`${label}: missing or empty framework.`);
  }

  if (typeof s.category !== "string" || s.category.trim() === "") {
    fail(`${label}: missing or empty category.`);
  }

  if (!Array.isArray(s.files) || s.files.length === 0) {
    fail(`${label}: missing or empty files[] — every suite must name at least one real file.`);
  } else {
    for (const f of s.files) {
      if (typeof f !== "string" || f.trim() === "") {
        fail(`${label}: files[] contains a non-string or empty entry.`);
        continue;
      }
      if (!fs.existsSync(f)) {
        fail(`${label}: listed file does not exist on disk: ${f}`);
      }
    }
  }

  if (typeof s.file_count !== "number") {
    fail(`${label}: missing or non-numeric file_count.`);
  } else if (Array.isArray(s.files) && s.file_count !== s.files.length) {
    fail(`${label}: file_count (${s.file_count}) does not match files[].length (${s.files.length}).`);
  }

  if (typeof s.last_known_status_claim !== "string" || s.last_known_status_claim.trim() === "") {
    fail(`${label}: missing or empty last_known_status_claim.`);
  }

  if (!("ran_to_completion" in s)) {
    fail(`${label}: missing ran_to_completion field.`);
  } else if (!VALID_COMPLETION.has(s.ran_to_completion)) {
    fail(`${label}: ran_to_completion has an unrecognized value: ${JSON.stringify(s.ran_to_completion)} (expected true, false, or "unknown"-style string).`);
  }

  if (typeof s.ran_to_completion_evidence !== "string" || s.ran_to_completion_evidence.trim() === "") {
    fail(`${label}: missing or empty ran_to_completion_evidence.`);
  }
}

// --- 3. Required category coverage ------------------------------------------
// Task step 2 explicitly names: unit, smoke, api, visual-regression.spec.ts,
// cross-browser, soak, migration tests. Confirm each is represented by at
// least one suite (by category text or run_command/file match), not just
// trusting a suite count.

const blobs = suites.map((s) =>
  `${s.category ?? ""} ${s.id ?? ""} ${s.run_command ?? ""} ${(s.files ?? []).join(" ")}`.toLowerCase()
);

function categoryCovered(re) {
  return blobs.some((b) => re.test(b));
}

const requiredCategories = [
  { name: "unit", re: /unit/ },
  { name: "smoke", re: /smoke/ },
  { name: "api", re: /\bapi\b/ },
  { name: "visual-regression.spec.ts", re: /visual-regression/ },
  { name: "cross-browser", re: /cross-browser|chromium.*firefox|firefox.*webkit/ },
  { name: "soak", re: /soak/ },
  { name: "migration tests", re: /migration/ },
];

for (const c of requiredCategories) {
  if (!categoryCovered(c.re)) {
    fail(`No suite record covers the required category: "${c.name}".`);
  }
}

// Explicitly confirm the exact file e2e/visual-regression.spec.ts is named
// somewhere, since the task calls it out by filename, not just by category.
if (!suites.some((s) => (s.files ?? []).includes("e2e/visual-regression.spec.ts"))) {
  fail('No suite record lists the exact file "e2e/visual-regression.spec.ts" in its files[].');
}

// --- 4. PT-00/PT-01 dependency confirmation ---------------------------------
// Task step 1: confirm PT-00/PT-01 artifacts exist before doing anything else.
// Re-check here so the gate itself fails if those artifacts have vanished.

const pt00Dir = path.join("test-evidence", "pt-00");
const pt01Dir = path.join("test-evidence", "pt-01");
if (!fs.existsSync(pt00Dir) || fs.readdirSync(pt00Dir).length === 0) {
  fail(`PT-00 artifacts not found or empty at ${pt00Dir} — required dependency per task step 1.`);
}
if (!fs.existsSync(pt01Dir) || fs.readdirSync(pt01Dir).length === 0) {
  fail(`PT-01 artifacts not found or empty at ${pt01Dir} — required dependency per task step 1.`);
}

// --- Report -------------------------------------------------------------

const withEvidence = suites.filter((s) => s.ran_to_completion === true).length;
const unknown = suites.filter((s) => s.ran_to_completion === "unknown").length;
const falseCount = suites.filter((s) => s.ran_to_completion === false).length;

console.log("=".repeat(78));
console.log("PT-11-001 verification: test-evidence/pt-11/suite-inventory.json");
console.log("=".repeat(78));
console.log(`suites recorded: ${suites.length}`);
console.log(`  ran_to_completion=true:    ${withEvidence}`);
console.log(`  ran_to_completion=false:   ${falseCount}`);
console.log(`  ran_to_completion=unknown/partial: ${suites.length - withEvidence - falseCount}`);
console.log(`required categories checked: ${requiredCategories.map((c) => c.name).join(", ")}`);

if (warnings.length > 0) {
  console.log("\nWarnings (non-fatal):");
  for (const w of warnings) console.log(`  [WARN] ${w}`);
}

if (failures.length > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  [FAIL] ${f}`);
  console.log(`\n${failures.length} failure(s). PT-11-001 gate: FAIL.`);
  process.exit(1);
}

console.log("\nAll checks passed. PT-11-001 gate: PASS.");
process.exit(0);
