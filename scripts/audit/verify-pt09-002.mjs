// PT-09-002 gate: confirms test-evidence/pt-09/execution-batch1.json records
// real before/after row-delta counts and an assigned verdict for every one
// of the 28 real batch-1 agent entries from test-evidence/pt-09/agent-
// inventory.json's canonicalAgents[] (AG-01..AG-21 canonical range,
// including on-disk collisions and non-canonical duplicates -- the "real
// numbering" the task asked to adjust to). Exits non-zero on any failure.
//
//   node scripts/audit/verify-pt09-002.mjs

import fs from "node:fs";
import path from "node:path";

const FILE = path.join("test-evidence", "pt-09", "execution-batch1.json");
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

// --- 1. The exact 28 real batch-1 canonicalNumber values, from
//        test-evidence/pt-09/agent-inventory.json's own canonicalAgents[]
//        (AG-01..AG-21 canonical range) at the time this gate was authored.
// -----------------------------------------------------------------------

const REQUIRED_CANONICAL_NUMBERS = [
  "AG-01",
  "AG-02",
  "AG-03",
  "AG-04",
  "AG-05",
  "AG-06",
  "AG-06 (non-canonical duplicate)",
  "AG-07",
  "AG-07 (non-canonical duplicate)",
  "AG-08",
  "AG-08 (on-disk collision, unregistered)",
  "AG-09",
  "AG-09 (on-disk collision, unregistered)",
  "AG-10",
  "AG-10 (on-disk collision, unregistered)",
  "AG-11",
  "AG-11 (on-disk collision, unregistered)",
  "AG-12",
  "AG-12 (on-disk collision, unregistered)",
  "AG-13",
  "AG-14",
  "AG-15",
  "AG-16",
  "AG-17",
  "AG-18",
  "AG-19",
  "AG-20",
  "AG-21",
];

const VALID_VERDICTS = new Set([
  "WORKS",
  "WIRED-NO-OUTPUT",
  "TRIGGER-BROKEN",
  "ERROR-SWALLOWED",
  "PENDING-SCOPE",
]);

// --- 2. Top-level shape -----------------------------------------------------

if (!Array.isArray(data.results) || data.results.length === 0) {
  fail("results[] is missing or empty.");
}
if (!data.method || typeof data.method !== "object") {
  fail("method{} block is missing.");
}
if (!data.summary || typeof data.summary !== "object") {
  fail("summary{} block is missing.");
}

const results = Array.isArray(data.results) ? data.results : [];

// --- 3. Coverage: every required canonicalNumber has exactly one entry ------

const seen = new Map();
for (const r of results) {
  const cn = String(r.canonicalNumber ?? "");
  if (seen.has(cn)) {
    fail(`Duplicate result entry for canonicalNumber "${cn}".`);
  }
  seen.set(cn, r);
}

const missing = REQUIRED_CANONICAL_NUMBERS.filter((cn) => !seen.has(cn));
if (missing.length > 0) {
  fail(`Missing result entries for: ${missing.join(", ")}`);
}

const unexpected = [...seen.keys()].filter((cn) => !REQUIRED_CANONICAL_NUMBERS.includes(cn));
if (unexpected.length > 0) {
  warnings.push(`Result entries present that are not in the required batch-1 list (not a failure, just noted): ${unexpected.join(", ")}`);
}

// --- 4. Per-entry required fields -------------------------------------------

for (const cn of REQUIRED_CANONICAL_NUMBERS) {
  const r = seen.get(cn);
  if (!r) continue; // already reported as missing above

  const label = cn;

  if (!("verdict" in r) || typeof r.verdict !== "string" || r.verdict.trim() === "") {
    fail(`${label}: missing or empty verdict.`);
  } else if (!VALID_VERDICTS.has(r.verdict)) {
    fail(`${label}: verdict "${r.verdict}" is not one of the 5 valid taxonomy values (${[...VALID_VERDICTS].join(", ")}).`);
  }

  if (!("verdictReasoning" in r) || typeof r.verdictReasoning !== "string" || r.verdictReasoning.trim().length < 10) {
    fail(`${label}: missing or implausibly short verdictReasoning.`);
  }

  // PENDING-SCOPE is the one verdict allowed to have null before/after/rowDelta
  // (the agent was deliberately never fired). Every other verdict MUST carry
  // real before/after counts and a rowDelta, per the task's explicit
  // requirement ("record ... the row-deltas").
  if (r.verdict !== "PENDING-SCOPE") {
    if (!r.before || typeof r.before !== "object") {
      fail(`${label}: missing before{} row-count object (required for verdict "${r.verdict}").`);
    }
    if (!r.after || typeof r.after !== "object") {
      fail(`${label}: missing after{} row-count object (required for verdict "${r.verdict}").`);
    }
    if (!r.rowDelta || typeof r.rowDelta !== "object") {
      fail(`${label}: missing rowDelta{} object (required for verdict "${r.verdict}").`);
    } else if (r.before && r.after) {
      // Cross-check rowDelta actually equals after - before for every table key.
      for (const table of Object.keys(r.rowDelta)) {
        const b = r.before[table];
        const a = r.after[table];
        const d = r.rowDelta[table];
        if (typeof b === "number" && typeof a === "number" && typeof d === "number") {
          if (a - b !== d) {
            fail(`${label}: rowDelta.${table} (${d}) does not equal after.${table} - before.${table} (${a} - ${b} = ${a - b}).`);
          }
        }
      }
    }
    if (!("triggerLog" in r) || typeof r.triggerLog !== "string" || r.triggerLog.trim() === "") {
      fail(`${label}: missing or empty triggerLog.`);
    }
    if (!("triggerMethod" in r) || typeof r.triggerMethod !== "string" || r.triggerMethod.trim() === "") {
      fail(`${label}: missing or empty triggerMethod.`);
    }
  } else {
    if (!("verdictReasoning" in r) || !/outbound|external|comms|third.?part/i.test(r.verdictReasoning)) {
      warnings.push(`${label}: PENDING-SCOPE verdictReasoning does not obviously mention outbound/external/comms/third-party risk -- double check this is a genuine scope exclusion, not a shortcut.`);
    }
  }

  if (!("falsePassCasualty" in r) || typeof r.falsePassCasualty !== "boolean") {
    fail(`${label}: missing or non-boolean falsePassCasualty field.`);
  }

  if (!("writeTargetTables" in r) || !Array.isArray(r.writeTargetTables)) {
    fail(`${label}: missing or non-array writeTargetTables[].`);
  }

  if (!("implementingFile" in r) || typeof r.implementingFile !== "string" || r.implementingFile.trim() === "") {
    fail(`${label}: missing or empty implementingFile.`);
  }
}

// --- 5. WIRED-NO-OUTPUT / ERROR-SWALLOWED must be flagged as P1 findings ----
// Per the task: these verdicts are register findings (built but not
// functioning). Confirm each such entry is either flagged inline
// (falsePassCasualty computed correctly against registryPriorStatus) or at
// minimum has a non-trivial verdictReasoning explaining the gap. This gate
// does not require a specific external register file (that's a docs step),
// but it does sanity-check internal consistency.

const dangerousVerdicts = results.filter((r) => r.verdict === "WIRED-NO-OUTPUT" || r.verdict === "ERROR-SWALLOWED");
for (const r of dangerousVerdicts) {
  if (r.verdict === "WIRED-NO-OUTPUT" && /BUILT/i.test(String(r.registryPriorStatus ?? "")) && r.falsePassCasualty !== true) {
    fail(`${r.canonicalNumber}: verdict is WIRED-NO-OUTPUT and registryPriorStatus mentions BUILT, but falsePassCasualty is not true -- this should be flagged as a false-pass casualty per the task's explicit instruction.`);
  }
}

// --- Report -------------------------------------------------------------

console.log("=".repeat(78));
console.log("PT-09-002 verification: test-evidence/pt-09/execution-batch1.json");
console.log("=".repeat(78));
console.log(`Result entries: ${results.length}`);
console.log(`Required canonical numbers covered: ${REQUIRED_CANONICAL_NUMBERS.length - missing.length}/${REQUIRED_CANONICAL_NUMBERS.length}`);
console.log(`WIRED-NO-OUTPUT / ERROR-SWALLOWED entries (P1 findings): ${dangerousVerdicts.length}`);
if (dangerousVerdicts.length > 0) {
  for (const r of dangerousVerdicts) console.log(`  - ${r.canonicalNumber}: ${r.verdict}${r.falsePassCasualty ? " [FALSE-PASS CASUALTY]" : ""}`);
}

if (warnings.length > 0) {
  console.log("\nWarnings (non-fatal):");
  for (const w of warnings) console.log(`  [WARN] ${w}`);
}

if (failures.length > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  [FAIL] ${f}`);
  console.log(`\n${failures.length} failure(s). PT-09-002 gate: FAIL.`);
  process.exit(1);
}

console.log("\nAll checks passed. PT-09-002 gate: PASS.");
process.exit(0);
