// PT-09-003 gate: confirms test-evidence/pt-09/execution-batch2.json records real
// before/after row-delta counts and an assigned verdict for every one of the 23 real
// batch-2 agent entries from test-evidence/pt-09/agent-inventory.json's
// canonicalAgents[] (AG-22..AG-43 real-numbering range, per pt09-001), AND that the
// file's suspectDeepDive{} block carries a definitive, evidence-backed resolution for
// each of the 4 named suspects from pt09-001's watchList[] the task called out:
// rotated-API-key agents, the learning aggregator, the ROI optimizer, and the
// number-collision pairs. Exits non-zero on any failure. This script is written before
// (and independently of) the evidence file it checks, per the same design discipline
// verify-pt09-002.mjs already established for batch 1 -- it is not adjusted after the
// fact to make a weak result pass.
//
//   node scripts/audit/verify-pt09-003.mjs

import fs from "node:fs";
import path from "node:path";

const FILE = path.join("test-evidence", "pt-09", "execution-batch2.json");
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

// --- 1. The exact 23 real batch-2 canonicalNumber values, from
//        test-evidence/pt-09/agent-inventory.json's own canonicalAgents[] (AG-22..
//        AG-43 real-numbering range -- everything after batch 1's AG-01..AG-21 slice)
//        at the time this gate was authored.
// -----------------------------------------------------------------------

const REQUIRED_CANONICAL_NUMBERS = [
  "AG-22",
  "AG-23 / AG-32",
  "AG-24",
  "AG-25 (Disaster Response)",
  "AG-25 (Deadline Prediction, dual-use number)",
  "AG-26",
  "AG-27",
  "AG-28",
  "AG-29 (Knowledge Engine Indexer)",
  "AG-29 (Fundability Scorer, on-disk collision)",
  "AG-30",
  "AG-31",
  "AG-33",
  "AG-34",
  "AG-35",
  "AG-36",
  "AG-37",
  "AG-38",
  "AG-39",
  "AG-40",
  "AG-41",
  "AG-42",
  "AG-43 (beyond registered 1-42 range — NOT in registry)",
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
if (!data.suspectDeepDive || typeof data.suspectDeepDive !== "object") {
  fail("suspectDeepDive{} block is missing.");
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
  warnings.push(`Result entries present that are not in the required batch-2 list (not a failure, just noted): ${unexpected.join(", ")}`);
}

// --- 4. Per-entry required fields -------------------------------------------
// A PENDING-SCOPE entry is allowed for two distinct, legitimate reasons in this
// batch (unlike batch 1, which only ever meant "real code, deliberately not fired
// due to real outbound third-party side effects"): (a) that same outbound/external
// reason, or (b) the agent-inventory.json entry itself has codeExists:false -- there
// is no implementation file to trigger at all (AG-31, AG-33, AG-34). Both are
// legitimate; the warning below just makes sure the stated reason is one of the two,
// not a silent shortcut around real testing of code that does exist.

const NO_CODE_CANONICAL_NUMBERS = new Set(["AG-31", "AG-33", "AG-34"]);

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

  // PENDING-SCOPE is the one verdict allowed to have null before/after/rowDelta.
  // Every other verdict MUST carry real before/after counts and a rowDelta, per the
  // task's explicit requirement ("record ... the row-deltas").
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
    const reasoning = String(r.verdictReasoning ?? "");
    const mentionsOutbound = /outbound|external|comms|third.?part/i.test(reasoning);
    const mentionsNoCode = /no code|no implementation|codeExists\s*:?\s*false|not implemented|does not exist anywhere|zero implementation/i.test(reasoning);
    if (NO_CODE_CANONICAL_NUMBERS.has(cn.split(" ")[0])) {
      if (!mentionsNoCode) {
        warnings.push(`${label}: this is a codeExists:false agent per agent-inventory.json but PENDING-SCOPE verdictReasoning does not obviously say so -- double check this is genuinely "nothing to trigger," not a shortcut.`);
      }
    } else if (!mentionsOutbound && !mentionsNoCode) {
      warnings.push(`${label}: PENDING-SCOPE verdictReasoning does not obviously mention outbound/external/comms/third-party risk OR a no-code/no-implementation reason -- double check this is a genuine scope exclusion, not a shortcut.`);
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
// Same internal-consistency sanity check as verify-pt09-002.mjs (batch 1): a
// WIRED-NO-OUTPUT verdict against a registryPriorStatus that mentions BUILT/WIRED
// should be flagged as a false-pass casualty, not silently passed through.

const dangerousVerdicts = results.filter((r) => r.verdict === "WIRED-NO-OUTPUT" || r.verdict === "ERROR-SWALLOWED" || r.verdict === "TRIGGER-BROKEN");
for (const r of dangerousVerdicts) {
  if (r.verdict === "WIRED-NO-OUTPUT" && /BUILT|WIRED/i.test(String(r.registryPriorStatus ?? "")) && r.falsePassCasualty !== true) {
    fail(`${r.canonicalNumber}: verdict is WIRED-NO-OUTPUT and registryPriorStatus mentions BUILT/WIRED, but falsePassCasualty is not true -- this should be flagged as a false-pass casualty per the task's explicit instruction.`);
  }
}

// --- 6. suspectDeepDive{} -- 4 named suspects, each with a definitive,
//        evidence-backed resolution. -----------------------------------------

const REQUIRED_SUSPECTS = {
  rotatedApiKeyAgents: {
    title: "rotated-API-key agents",
    watchListRef: "wasBlockedOnRotatedApiKey",
  },
  learningAggregator: {
    title: "learning aggregator (AG-36)",
    watchListRef: "learningAggregatorNowWired_correctsStaleAssumption",
  },
  roiOptimizer: {
    title: "ROI optimizer (AG-39)",
    watchListRef: "roiOptimizerWiredButRowCountUnverified",
  },
  numberCollisionPairs: {
    title: "number-collision pairs",
    watchListRef: "numberCollisionPairs",
  },
};

const suspectDeepDive = data.suspectDeepDive && typeof data.suspectDeepDive === "object" ? data.suspectDeepDive : {};

for (const [key, meta] of Object.entries(REQUIRED_SUSPECTS)) {
  const entry = suspectDeepDive[key];
  const label = `suspectDeepDive.${key} (${meta.title})`;

  if (!entry || typeof entry !== "object") {
    fail(`${label}: missing entirely.`);
    continue;
  }

  if (!("verdict" in entry) || typeof entry.verdict !== "string" || entry.verdict.trim() === "") {
    fail(`${label}: missing or empty verdict.`);
  } else if (/^unresolved$|^unknown$|^tbd$|^pending$/i.test(entry.verdict.trim())) {
    fail(`${label}: verdict "${entry.verdict}" reads as unresolved, not a definitive verdict.`);
  }

  if (!("resolution" in entry) || typeof entry.resolution !== "string" || entry.resolution.trim().length < 100) {
    fail(`${label}: missing or implausibly short resolution (must be a real, substantive explanation, >= 100 chars).`);
  }

  if (!("evidenceRefs" in entry) || !Array.isArray(entry.evidenceRefs) || entry.evidenceRefs.length === 0) {
    fail(`${label}: missing or empty evidenceRefs[] -- a resolved verdict needs cited evidence, not just an assertion.`);
  }

  if (entry.watchListRef && entry.watchListRef !== meta.watchListRef) {
    warnings.push(`${label}: watchListRef "${entry.watchListRef}" does not match the expected pt09-001 watchList id "${meta.watchListRef}" -- confirm this is intentional.`);
  }
}

const unexpectedSuspects = Object.keys(suspectDeepDive).filter((k) => !(k in REQUIRED_SUSPECTS));
if (unexpectedSuspects.length > 0) {
  warnings.push(`suspectDeepDive has extra keys beyond the 4 required (not a failure, just noted): ${unexpectedSuspects.join(", ")}`);
}

// --- Report -------------------------------------------------------------

console.log("=".repeat(78));
console.log("PT-09-003 verification: test-evidence/pt-09/execution-batch2.json");
console.log("=".repeat(78));
console.log(`Result entries: ${results.length}`);
console.log(`Required canonical numbers covered: ${REQUIRED_CANONICAL_NUMBERS.length - missing.length}/${REQUIRED_CANONICAL_NUMBERS.length}`);
console.log(`WIRED-NO-OUTPUT / ERROR-SWALLOWED / TRIGGER-BROKEN entries (P1 findings): ${dangerousVerdicts.length}`);
if (dangerousVerdicts.length > 0) {
  for (const r of dangerousVerdicts) console.log(`  - ${r.canonicalNumber}: ${r.verdict}${r.falsePassCasualty ? " [FALSE-PASS CASUALTY]" : ""}`);
}
console.log(`Suspect deep-dive entries resolved: ${Object.keys(REQUIRED_SUSPECTS).filter((k) => suspectDeepDive[k]).length}/${Object.keys(REQUIRED_SUSPECTS).length}`);

if (warnings.length > 0) {
  console.log("\nWarnings (non-fatal):");
  for (const w of warnings) console.log(`  [WARN] ${w}`);
}

if (failures.length > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  [FAIL] ${f}`);
  console.log(`\n${failures.length} failure(s). PT-09-003 gate: FAIL.`);
  process.exit(1);
}

console.log("\nAll checks passed. PT-09-003 gate: PASS.");
process.exit(0);
