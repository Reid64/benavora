// ============================================================================
// PT-08-001 verifier — worker boot inventory (started vs. dead-code)
//
// Confirms test-evidence/pt-08/boot-inventory.json is real, non-empty
// evidence: it must be valid JSON, its "processors" array must be non-empty,
// and every entry must have a state drawn from the three-state taxonomy
// (STARTED / DEFINED-NOT-STARTED / REFERENCED-ONLY) plus a non-empty
// evidence array. Also cross-checks the summary counts against the actual
// array contents so a stale/hand-edited summary block can't silently drift
// from the real data. Exits non-zero on any failure.
//
// Usage: node scripts/audit/verify-pt08-001.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const TARGET = path.join("test-evidence", "pt-08", "boot-inventory.json");
const VALID_STATES = new Set(["STARTED", "DEFINED-NOT-STARTED", "REFERENCED-ONLY"]);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(TARGET)) {
  fail(`${TARGET} does not exist.`);
}

const raw = fs.readFileSync(TARGET, "utf8");
if (raw.trim().length === 0) {
  fail(`${TARGET} is empty.`);
}

let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  fail(`${TARGET} is not valid JSON: ${err.message}`);
}

if (!data || typeof data !== "object") {
  fail(`${TARGET} did not parse to an object.`);
}

if (!Array.isArray(data.processors) || data.processors.length === 0) {
  fail(`${TARGET}'s "processors" array is missing or empty — inventory contains no findings.`);
}

let structuralErrors = 0;
const stateCounts = {};

for (const [i, row] of data.processors.entries()) {
  const label = row.processor ?? `processors[${i}]`;

  if (typeof row.processor !== "string" || row.processor.length === 0) {
    console.error(`FAIL: processors[${i}] is missing a non-empty "processor" name.`);
    structuralErrors++;
  }
  if (typeof row.module !== "string" || row.module.length === 0) {
    console.error(`FAIL: ${label} is missing a non-empty "module" field.`);
    structuralErrors++;
  }
  if (typeof row.state !== "string" || !VALID_STATES.has(row.state)) {
    console.error(
      `FAIL: ${label}.state ("${row.state}") must be one of: ${[...VALID_STATES].join(", ")}.`,
    );
    structuralErrors++;
  } else {
    stateCounts[row.state] = (stateCounts[row.state] ?? 0) + 1;
  }
  if (!Array.isArray(row.evidence) || row.evidence.length === 0) {
    console.error(`FAIL: ${label}.evidence must be a non-empty array.`);
    structuralErrors++;
  } else {
    for (const [j, e] of row.evidence.entries()) {
      if (typeof e !== "string" || e.trim().length === 0) {
        console.error(`FAIL: ${label}.evidence[${j}] must be a non-empty string.`);
        structuralErrors++;
      }
    }
  }
  if (typeof row.registeredVia !== "string" || row.registeredVia.trim().length === 0) {
    console.error(`FAIL: ${label} is missing a non-empty "registeredVia" field.`);
    structuralErrors++;
  }
}

if (structuralErrors > 0) {
  fail(`${structuralErrors} structural error(s) found in "processors" rows.`);
}

// Cross-check the declared summary block (if present) against the actual
// array so a hand-edited summary can't silently drift from the real data.
if (data.summary && typeof data.summary === "object") {
  const declaredTotal = data.summary.totalProcessorsInventoried;
  if (typeof declaredTotal === "number" && declaredTotal !== data.processors.length) {
    fail(
      `summary.totalProcessorsInventoried (${declaredTotal}) does not match ` +
        `the actual processors[] length (${data.processors.length}).`,
    );
  }
  const declaredStarted = data.summary.started;
  if (typeof declaredStarted === "number" && declaredStarted !== (stateCounts.STARTED ?? 0)) {
    fail(
      `summary.started (${declaredStarted}) does not match the actual STARTED count ` +
        `(${stateCounts.STARTED ?? 0}).`,
    );
  }
  const declaredDefinedNotStarted = data.summary.definedNotStarted;
  if (
    typeof declaredDefinedNotStarted === "number" &&
    declaredDefinedNotStarted !== (stateCounts["DEFINED-NOT-STARTED"] ?? 0)
  ) {
    fail(
      `summary.definedNotStarted (${declaredDefinedNotStarted}) does not match the actual ` +
        `DEFINED-NOT-STARTED count (${stateCounts["DEFINED-NOT-STARTED"] ?? 0}).`,
    );
  }
  const declaredReferencedOnly = data.summary.referencedOnly;
  if (
    typeof declaredReferencedOnly === "number" &&
    declaredReferencedOnly !== (stateCounts["REFERENCED-ONLY"] ?? 0)
  ) {
    fail(
      `summary.referencedOnly (${declaredReferencedOnly}) does not match the actual ` +
        `REFERENCED-ONLY count (${stateCounts["REFERENCED-ONLY"] ?? 0}).`,
    );
  }
}

// Sanity: this audit exists specifically to catch the "built but never
// wired at boot" dead-code class documented repeatedly in this project's
// governance history (e.g. the EA-01..EA-10 corporate enrichment pipeline).
// If it reports zero DEFINED-NOT-STARTED entries, that's not necessarily
// wrong, but it is suspicious enough (given documented history) to require
// a human to have actually looked, not just trust an empty result — so this
// check requires at least the evidence files referenced by the boot-log
// reconciliation to exist, proving a live cross-check was actually done.
const evidenceFiles = data?.method?.evidenceFiles;
if (!Array.isArray(evidenceFiles) || evidenceFiles.length === 0) {
  fail(`method.evidenceFiles is missing or empty — no live-log reconciliation evidence declared.`);
}
for (const f of evidenceFiles) {
  if (!fs.existsSync(f)) {
    fail(`Declared evidence file does not exist on disk: ${f}`);
  }
  const stat = fs.statSync(f);
  if (stat.size === 0) {
    fail(`Declared evidence file is empty: ${f}`);
  }
}

console.log(`PASS: ${TARGET} is valid.`);
console.log(`  ${data.processors.length} processor(s) inventoried.`);
console.log(`  State breakdown: ${JSON.stringify(stateCounts)}`);
console.log(`  ${evidenceFiles.length} live-log evidence file(s) confirmed present and non-empty.`);

const deadCode = data.processors.filter((p) => p.state === "DEFINED-NOT-STARTED");
if (deadCode.length > 0) {
  console.log(`  ${deadCode.length} DEFINED-NOT-STARTED (dead-code class) finding(s):`);
  for (const p of deadCode) {
    console.log(`    - ${p.processor} (${p.module})`);
  }
}
process.exit(0);
