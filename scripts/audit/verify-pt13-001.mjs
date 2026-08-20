#!/usr/bin/env node
/**
 * PT-13 verifier: fails unless test-evidence/pt-13/silent-catches.json
 * records the full try/catch + .catch() census with a file/line per entry,
 * plus a coherent summary (counts add up, severity/documented flags are
 * populated where expected).
 *
 * Exit 0 = pass, exit 1 = fail (prints the reason).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const JSON_PATH = join(ROOT, "test-evidence", "pt-13", "silent-catches.json");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(JSON_PATH)) {
  fail(`${JSON_PATH} does not exist. Run scripts/audit/census-silent-catches.mjs first.`);
}

let data;
try {
  data = JSON.parse(readFileSync(JSON_PATH, "utf8"));
} catch (err) {
  fail(`silent-catches.json is not valid JSON: ${err.message}`);
}

if (!data || typeof data !== "object") {
  fail("silent-catches.json root is not an object.");
}

const { summary, findings } = data;

if (!summary || typeof summary !== "object") {
  fail("silent-catches.json is missing a `summary` object.");
}

if (!Array.isArray(findings)) {
  fail("silent-catches.json is missing a `findings` array.");
}

if (findings.length === 0) {
  fail("findings array is empty -- the census did not record any catch sites.");
}

// Every single census entry must carry file + line, per PT-13 instructions.
let missingFileOrLine = 0;
let badLineType = 0;
let missingKind = 0;
let missingClassificationFields = 0;

for (const f of findings) {
  if (!f.file || typeof f.file !== "string") {
    missingFileOrLine++;
    continue;
  }
  if (typeof f.line !== "number" || !Number.isFinite(f.line) || f.line <= 0) {
    badLineType++;
    continue;
  }
  if (!f.kind || (f.kind !== "try/catch" && f.kind !== ".catch()")) {
    missingKind++;
  }
  if (
    typeof f.swallowed !== "boolean" ||
    typeof f.documented !== "boolean" ||
    typeof f.testFile !== "boolean" ||
    typeof f.onRealDataOrAgentPath !== "boolean"
  ) {
    missingClassificationFields++;
  }
}

if (missingFileOrLine > 0) {
  fail(`${missingFileOrLine} of ${findings.length} entries are missing a valid \`file\` field.`);
}
if (badLineType > 0) {
  fail(`${badLineType} of ${findings.length} entries are missing a valid \`line\` number.`);
}
if (missingKind > 0) {
  fail(`${missingKind} of ${findings.length} entries have an invalid/missing \`kind\` field.`);
}
if (missingClassificationFields > 0) {
  fail(
    `${missingClassificationFields} of ${findings.length} entries are missing required classification fields (swallowed/documented/testFile/onRealDataOrAgentPath).`
  );
}

// Cross-check summary counts against the actual findings array so a stale
// or hand-edited summary can't silently drift from the real census.
const recomputed = {
  totalCatchSites: findings.length,
  tryCatchSites: findings.filter((f) => f.kind === "try/catch").length,
  dotCatchSites: findings.filter((f) => f.kind === ".catch()").length,
  swallowedTotal: findings.filter((f) => f.swallowed).length,
  silentHolesNonTest: findings.filter((f) => f.swallowed && !f.documented && !f.testFile).length,
  documentedSwallowsNonTest: findings.filter((f) => f.swallowed && f.documented && !f.testFile).length,
  testFileCatchSites: findings.filter((f) => f.testFile).length,
  p1Count: findings.filter((f) => f.severity === "P1").length,
  p2Count: findings.filter((f) => f.severity === "P2").length,
  p3Count: findings.filter((f) => f.severity === "P3").length,
};

const mismatches = [];
for (const key of Object.keys(recomputed)) {
  if (summary[key] !== recomputed[key]) {
    mismatches.push(`${key}: summary says ${summary[key]}, actual is ${recomputed[key]}`);
  }
}
if (mismatches.length > 0) {
  fail(`summary counts do not match the findings array:\n  ${mismatches.join("\n  ")}`);
}

// Sanity floor: this codebase is known (per the manual scan that motivated
// this audit) to have well over 2000 catch sites across src/worker/scripts.
// A drastically smaller count means the scan silently under-scanned.
if (recomputed.totalCatchSites < 2000) {
  fail(
    `only ${recomputed.totalCatchSites} catch sites recorded -- expected 2000+. Census likely ran against a partial file set.`
  );
}

// Every P1/P2 finding must be traceable to a real file on disk at that path
// (catches an obviously-stale or hand-fabricated JSON).
let unresolvablePaths = 0;
for (const f of findings) {
  if (f.severity === "P1" || f.severity === "P2") {
    if (!existsSync(join(ROOT, f.file))) unresolvablePaths++;
  }
}
if (unresolvablePaths > 0) {
  fail(`${unresolvablePaths} P1/P2 findings reference a file that does not exist on disk.`);
}

console.log("PASS: silent-catches.json records a full census with file/line per entry.");
console.log(`  Total catch sites: ${summary.totalCatchSites}`);
console.log(`  P1 findings: ${summary.p1Count}`);
console.log(`  P2 findings: ${summary.p2Count}`);
console.log(`  Documented intentional swallows: ${summary.documentedSwallowsNonTest}`);
process.exit(0);
