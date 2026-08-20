#!/usr/bin/env node
/**
 * PT-14 verifier: fails unless test-evidence/pt-14/injection.json records
 * the injection sweep across all four required vector classes (SQLi, XSS,
 * CSRF, SSRF) with a real per-attempt verdict for every recorded attempt,
 * and the summary counts are internally consistent with the raw attempts
 * array (so a stale or hand-edited summary can't silently drift).
 *
 * Exit 0 = pass, exit 1 = fail (prints the reason).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const JSON_PATH = join(ROOT, "test-evidence", "pt-14", "injection.json");

const REQUIRED_VECTOR_CLASSES = ["sqli", "xss", "csrf", "ssrf"];

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(JSON_PATH)) {
  fail(`${JSON_PATH} does not exist. Run scripts/audit/pt14-002-live-tests.mjs first.`);
}

let data;
try {
  data = JSON.parse(readFileSync(JSON_PATH, "utf8"));
} catch (err) {
  fail(`injection.json is not valid JSON: ${err.message}`);
}

if (!data || typeof data !== "object") {
  fail("injection.json root is not an object.");
}

const { attempts, summary } = data;

if (!Array.isArray(attempts)) {
  fail("injection.json is missing an `attempts` array.");
}

if (attempts.length === 0) {
  fail("attempts array is empty -- the injection sweep did not record any attempts.");
}

if (!summary || typeof summary !== "object") {
  fail("injection.json is missing a `summary` object.");
}

// Every vector class must be present with at least one attempt.
const byClass = {};
for (const cls of REQUIRED_VECTOR_CLASSES) byClass[cls] = [];

let unknownClassCount = 0;
for (const a of attempts) {
  if (!a || typeof a !== "object") {
    fail("attempts array contains a non-object entry.");
  }
  if (!REQUIRED_VECTOR_CLASSES.includes(a.vectorClass)) {
    unknownClassCount++;
    continue;
  }
  byClass[a.vectorClass].push(a);
}

if (unknownClassCount > 0) {
  fail(`${unknownClassCount} attempt(s) have a vectorClass outside the required set (${REQUIRED_VECTOR_CLASSES.join(", ")}).`);
}

const missingClasses = REQUIRED_VECTOR_CLASSES.filter((cls) => byClass[cls].length === 0);
if (missingClasses.length > 0) {
  fail(`no attempts recorded for vector class(es): ${missingClasses.join(", ")}. All four vector classes are required.`);
}

// Every attempt must carry a real, non-empty verdict plus the minimum
// identifying/descriptive fields -- this is what makes an entry a genuine
// "attempt+result" record rather than a bare classification.
let missingVerdict = 0;
let missingId = 0;
let missingTarget = 0;
let missingDescription = 0;
let missingMethod = 0;

for (const a of attempts) {
  if (typeof a.verdict !== "string" || a.verdict.trim().length === 0) missingVerdict++;
  if (typeof a.id !== "string" || a.id.trim().length === 0) missingId++;
  if (typeof a.target !== "string" || a.target.trim().length === 0) missingTarget++;
  if (typeof a.description !== "string" || a.description.trim().length === 0) missingDescription++;
  if (typeof a.method !== "string" || a.method.trim().length === 0) missingMethod++;
}

if (missingVerdict > 0) {
  fail(`${missingVerdict} of ${attempts.length} attempts are missing a valid \`verdict\` field.`);
}
if (missingId > 0) {
  fail(`${missingId} of ${attempts.length} attempts are missing a valid \`id\` field.`);
}
if (missingTarget > 0) {
  fail(`${missingTarget} of ${attempts.length} attempts are missing a valid \`target\` field.`);
}
if (missingDescription > 0) {
  fail(`${missingDescription} of ${attempts.length} attempts are missing a valid \`description\` field.`);
}
if (missingMethod > 0) {
  fail(`${missingMethod} of ${attempts.length} attempts are missing a valid \`method\` field.`);
}

// Ids must be unique (a duplicate id would mean the same attempt was
// recorded twice rather than a distinct one being run).
const idCounts = new Map();
for (const a of attempts) idCounts.set(a.id, (idCounts.get(a.id) ?? 0) + 1);
const dupes = Array.from(idCounts.entries()).filter(([, count]) => count > 1);
if (dupes.length > 0) {
  fail(`duplicate attempt ids found: ${dupes.map(([id, count]) => `${id} (x${count})`).join(", ")}`);
}

// Each vector class needs at least one attempt that actually exercised a
// real target (live_prod_readonly / live_prod_testdata / live_local /
// direct_function_execution), not purely a static classification -- static
// alone does not satisfy "attempt+result".
const LIVE_METHODS = new Set(["live_prod_readonly", "live_prod_testdata", "live_local", "direct_function_execution"]);
const classesWithNoLiveAttempt = REQUIRED_VECTOR_CLASSES.filter(
  (cls) => !byClass[cls].some((a) => LIVE_METHODS.has(a.method)),
);
if (classesWithNoLiveAttempt.length > 0) {
  fail(
    `vector class(es) with no live (non-static) attempt recorded: ${classesWithNoLiveAttempt.join(", ")}. ` +
      `A static-only classification does not satisfy "attempt+result".`,
  );
}

// Cross-check summary counts against the actual attempts array.
const recomputed = {};
for (const cls of REQUIRED_VECTOR_CLASSES) {
  const clsAttempts = byClass[cls];
  recomputed[cls] = {
    totalAttempts: clsAttempts.length,
    vulnerable: clsAttempts.filter((a) => a.verdict === "VULNERABLE" || a.verdict === "NOT_BLOCKED" || a.verdict === "NOT_BLOCKED_UNEXPECTED").length,
  };
}

const mismatches = [];
for (const cls of REQUIRED_VECTOR_CLASSES) {
  if (!summary[cls] || typeof summary[cls] !== "object") {
    mismatches.push(`summary.${cls} is missing or not an object`);
    continue;
  }
  if (summary[cls].totalAttempts !== recomputed[cls].totalAttempts) {
    mismatches.push(
      `summary.${cls}.totalAttempts: summary says ${summary[cls].totalAttempts}, actual is ${recomputed[cls].totalAttempts}`,
    );
  }
  if (summary[cls].vulnerable !== recomputed[cls].vulnerable) {
    mismatches.push(
      `summary.${cls}.vulnerable: summary says ${summary[cls].vulnerable}, actual is ${recomputed[cls].vulnerable}`,
    );
  }
}
if (mismatches.length > 0) {
  fail(`summary counts do not match the attempts array:\n  ${mismatches.join("\n  ")}`);
}

// Any P0 severity finding must carry a non-empty description explaining why
// (a bare "P0" with no explanation isn't a usable finding).
let p0MissingDescription = 0;
const p0Findings = attempts.filter((a) => a.severity === "P0");
for (const a of p0Findings) {
  if (typeof a.description !== "string" || a.description.length < 20) p0MissingDescription++;
}
if (p0MissingDescription > 0) {
  fail(`${p0MissingDescription} P0 finding(s) have a missing or too-short description.`);
}

console.log("PASS: injection.json records the sweep across all four required vector classes.");
for (const cls of REQUIRED_VECTOR_CLASSES) {
  console.log(`  ${cls}: ${recomputed[cls].totalAttempts} attempts, ${recomputed[cls].vulnerable} vulnerable`);
}
console.log(`  Total P0 findings: ${p0Findings.length}`);
console.log(`  Total attempts: ${attempts.length}`);
process.exit(0);
