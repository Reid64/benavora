// PT-09-001 gate: confirms test-evidence/pt-09/agent-inventory.json is a real,
// complete AG-01..AG-43 reconciliation (registry vs code vs trigger), not a
// partial or placeholder file. Exits non-zero on any failure.
//
//   node scripts/audit/verify-pt09-001.mjs

import fs from "node:fs";
import path from "node:path";

const FILE = path.join("test-evidence", "pt-09", "agent-inventory.json");
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

if (!Array.isArray(data.canonicalAgents) || data.canonicalAgents.length === 0) {
  fail("canonicalAgents[] is missing or empty.");
}
if (!Array.isArray(data.watchList) || data.watchList.length === 0) {
  fail("watchList[] is missing or empty.");
}
if (!data.dependencies || !data.dependencies.pt00 || !data.dependencies.pt08) {
  fail("dependencies.pt00 / dependencies.pt08 confirmation block is missing.");
}
if (data.dependencies?.pt00?.present !== true) {
  fail("dependencies.pt00.present is not true — PT-00 artifacts not confirmed present.");
}
if (data.dependencies?.pt08?.present !== true) {
  fail("dependencies.pt08.present is not true — PT-08 artifacts not confirmed present.");
}

// --- 2. AG-01..AG-43 coverage ------------------------------------------------
// canonicalNumber values look like "AG-06", "AG-06 (non-canonical duplicate)",
// "AG-23 / AG-32", "AG-08 (on-disk collision, unregistered)", etc. Extract
// every literal AG-<N> token out of each entry's canonicalNumber and union
// them to confirm 1..43 are all represented at least once.

const agents = Array.isArray(data.canonicalAgents) ? data.canonicalAgents : [];
const seenNumbers = new Set();
const AG_TOKEN = /AG-(\d{1,2})\b/g;

for (const entry of agents) {
  const cn = String(entry.canonicalNumber ?? "");
  let m;
  AG_TOKEN.lastIndex = 0;
  while ((m = AG_TOKEN.exec(cn)) !== null) {
    seenNumbers.add(Number(m[1]));
  }
}

const missing = [];
for (let n = 1; n <= 43; n++) {
  if (!seenNumbers.has(n)) missing.push(n);
}
if (missing.length > 0) {
  fail(`Missing canonical agent numbers not represented anywhere in canonicalAgents[]: ${missing.map((n) => `AG-${String(n).padStart(2, "0")}`).join(", ")}`);
}

// --- 3. Per-entry required fields -------------------------------------------
// Every entry must carry a write-target field (writesTo, array — may be
// legitimately empty ONLY if triggerWiredVerdict says NO-CODE / NO-REGISTRY),
// a trigger-type field (registryTriggerType may be null for unregistered
// code, but the key must exist), and a non-empty triggerWiredVerdict string.

for (const [i, entry] of agents.entries()) {
  const label = entry.canonicalNumber ?? `entry[${i}]`;

  if (!("writesTo" in entry) || !Array.isArray(entry.writesTo)) {
    fail(`${label}: missing or non-array writesTo[] field.`);
  } else if (entry.writesTo.length === 0) {
    const verdict = String(entry.triggerWiredVerdict ?? "");
    const noCodeState = /NO-CODE|NO-REGISTRY-NO-CODE/.test(verdict);
    if (!noCodeState) {
      fail(`${label}: writesTo[] is empty but triggerWiredVerdict ("${verdict}") does not indicate a no-code state — an implemented agent with zero write target is suspicious.`);
    }
  }

  if (!("registryTriggerType" in entry)) {
    fail(`${label}: missing registryTriggerType field (may be null for unregistered code, but the key must be present).`);
  }

  if (!("triggerWiredVerdict" in entry) || typeof entry.triggerWiredVerdict !== "string" || entry.triggerWiredVerdict.trim() === "") {
    fail(`${label}: missing or empty triggerWiredVerdict.`);
  }

  if (!("codeExists" in entry) || typeof entry.codeExists !== "boolean") {
    fail(`${label}: missing or non-boolean codeExists field.`);
  }

  if (!("inRegistry" in entry) || typeof entry.inRegistry !== "boolean") {
    fail(`${label}: missing or non-boolean inRegistry field.`);
  }

  if (!Array.isArray(entry.evidence)) {
    fail(`${label}: missing evidence[] array.`);
  } else if (entry.evidence.length === 0 && entry.codeExists) {
    warnings.push(`${label}: codeExists=true but evidence[] is empty — no citation for a real-code claim.`);
  }
}

// --- 4. Watch-list must cover the four named suspect categories ------------
// Task step 4 explicitly names: agents blocked on the rotated API key, the
// unwired learning aggregator, the zero-row ROI optimizer, and number-
// collision pairs. Confirm each is represented (by id or by title/keyword
// match) rather than trusting a count alone.

const watchIds = new Set((data.watchList ?? []).map((w) => String(w.id ?? "")));
const watchBlobs = (data.watchList ?? []).map((w) => `${w.id ?? ""} ${w.title ?? ""} ${w.priorFinding ?? ""} ${w.thisSessionStatus ?? ""}`.toLowerCase());

function watchListCovers(re) {
  return watchBlobs.some((b) => re.test(b));
}

const requiredSuspects = [
  { name: "agents blocked on the rotated API key", re: /api.?key/i },
  { name: "unwired learning aggregator", re: /learning.?network|learning.?aggregator/i },
  { name: "zero-row ROI optimizer", re: /roi.?optimizer/i },
  { name: "number-collision pairs", re: /collision/i },
];

for (const s of requiredSuspects) {
  if (!watchListCovers(s.re)) {
    fail(`watchList[] does not appear to cover the required known-suspect category: "${s.name}".`);
  }
}

if (watchIds.size !== (data.watchList ?? []).length) {
  warnings.push("watchList[] has entries with duplicate or missing 'id' fields.");
}

// --- 5. Registry table sanity ------------------------------------------------

if (!data.registryTable || typeof data.registryTable.liveRowCount !== "number") {
  fail("registryTable.liveRowCount is missing — no evidence the live agent_registry table was actually queried.");
} else if (data.registryTable.liveRowCount <= 0) {
  fail(`registryTable.liveRowCount (${data.registryTable.liveRowCount}) is not a plausible positive count.`);
}

// --- Report -------------------------------------------------------------

console.log("=".repeat(78));
console.log("PT-09-001 verification: test-evidence/pt-09/agent-inventory.json");
console.log("=".repeat(78));
console.log(`canonicalAgents entries: ${agents.length}`);
console.log(`AG-01..AG-43 canonical numbers represented: ${43 - missing.length}/43`);
console.log(`watchList entries: ${(data.watchList ?? []).length}`);
console.log(`registryTable.liveRowCount: ${data.registryTable?.liveRowCount ?? "MISSING"}`);

if (warnings.length > 0) {
  console.log("\nWarnings (non-fatal):");
  for (const w of warnings) console.log(`  [WARN] ${w}`);
}

if (failures.length > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  [FAIL] ${f}`);
  console.log(`\n${failures.length} failure(s). PT-09-001 gate: FAIL.`);
  process.exit(1);
}

console.log("\nAll checks passed. PT-09-001 gate: PASS.");
process.exit(0);
