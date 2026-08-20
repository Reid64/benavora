#!/usr/bin/env node
/**
 * PT-13-002 verifier: fails unless test-evidence/pt-13/observability.json
 * records (1) a run-log completeness comparison against PT-09's real agent
 * executions, with at least one confirmed unlogged-execution finding, (2) an
 * error-surfacing path trace, with at least one confirmed absent-surfacing
 * finding, and (3) a monitoring/alerting reality check covering both what is
 * genuinely wired and what is dead/aspirational -- not a one-sided report.
 *
 * Exit 0 = pass, exit 1 = fail (prints the reason).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const JSON_PATH = join(ROOT, "test-evidence", "pt-13", "observability.json");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(JSON_PATH)) {
  fail(`${JSON_PATH} does not exist.`);
}

let data;
try {
  data = JSON.parse(readFileSync(JSON_PATH, "utf8"));
} catch (err) {
  fail(`observability.json is not valid JSON: ${err.message}`);
}

if (!data || typeof data !== "object") {
  fail("observability.json root is not an object.");
}

if (!data.generated_at || !data.method) {
  fail("observability.json is missing generated_at or method.");
}

// --- Part 1: run-log completeness comparison against PT-09 -----------------

const part1 = data.part1_runLogCompleteness;
if (!part1 || typeof part1 !== "object") {
  fail("observability.json is missing part1_runLogCompleteness.");
}
if (!Array.isArray(part1.findings) || part1.findings.length === 0) {
  fail("part1_runLogCompleteness.findings is missing or empty.");
}

// Must genuinely reference PT-09's evidence, not be fabricated in isolation
// -- this is the "compare against PT-09" requirement from the task itself.
const part1Text = JSON.stringify(part1);
if (!part1Text.includes("test-evidence/pt-09")) {
  fail("part1_runLogCompleteness does not cite any test-evidence/pt-09/ evidence file -- the comparison must be against PT-09's real execution proof, not asserted independently.");
}

const pt09Comparison = part1.pt09ExecutionComparison;
if (!pt09Comparison || typeof pt09Comparison !== "object") {
  fail("part1_runLogCompleteness.pt09ExecutionComparison is missing -- no explicit before/after comparison recorded.");
}
if (typeof pt09Comparison.totalCanonicalRowsInPt09Table !== "number") {
  fail("pt09ExecutionComparison.totalCanonicalRowsInPt09Table is missing or not a number.");
}

// The task's own instruction: "Unlogged executions ... are findings" --
// the report must have found at least one, not report a clean bill of health.
const part1UnloggedCount = part1.findings.filter((f) => f.unloggedExecution === true).length;
if (part1UnloggedCount === 0) {
  fail("part1_runLogCompleteness.findings contains zero unloggedExecution:true entries -- the task explicitly requires finding and flagging unlogged executions, not asserting full completeness.");
}

// --- Part 2: error-surfacing path trace -------------------------------------

const part2 = data.part2_errorSurfacing;
if (!part2 || typeof part2 !== "object") {
  fail("observability.json is missing part2_errorSurfacing.");
}
if (!Array.isArray(part2.findings) || part2.findings.length === 0) {
  fail("part2_errorSurfacing.findings is missing or empty.");
}

const part2AbsentCount = part2.findings.filter((f) => f.absentErrorSurfacing === true).length;
if (part2AbsentCount === 0) {
  fail("part2_errorSurfacing.findings contains zero absentErrorSurfacing:true entries -- the task explicitly requires finding and flagging absent error-surfacing, not asserting full coverage.");
}

// Must trace at least one genuinely surfaced (non-silent) path too, or the
// trace is one-sided and not a real comparison of silent vs. surfaced.
const part2SurfacedCount = part2.findings.filter((f) => f.absentErrorSurfacing === false).length;
if (part2SurfacedCount === 0) {
  fail("part2_errorSurfacing.findings has no absentErrorSurfacing:false entries -- a real trace must document at least one path that DOES reach a human/UI, for contrast.");
}

// --- Part 3: monitoring/alerting reality ------------------------------------

const part3 = data.part3_monitoringReality;
if (!part3 || typeof part3 !== "object") {
  fail("observability.json is missing part3_monitoringReality.");
}
if (!Array.isArray(part3.findings) || part3.findings.length === 0) {
  fail("part3_monitoringReality.findings is missing or empty.");
}
if (!Array.isArray(part3.existsAndWired) || part3.existsAndWired.length === 0) {
  fail("part3_monitoringReality.existsAndWired is missing or empty -- must document what genuinely works, not just what's broken.");
}
if (
  (!Array.isArray(part3.existsButDeadCode) || part3.existsButDeadCode.length === 0) &&
  (!Array.isArray(part3.aspirationalNeverBuilt) || part3.aspirationalNeverBuilt.length === 0)
) {
  fail("part3_monitoringReality has neither existsButDeadCode nor aspirationalNeverBuilt entries -- the task requires documenting monitoring reality (not assumed), which must include gaps between what's claimed and what's real.");
}

const monitoringStatuses = new Set(
  part3.findings.map((f) => f.monitoringStatus).filter(Boolean),
);
if (!monitoringStatuses.has("wired")) {
  fail("part3_monitoringReality.findings has no monitoringStatus:'wired' entry.");
}
const nonWiredStatuses = ["deadCode", "aspirational", "brokenMetric", "structuralGap"];
if (!nonWiredStatuses.some((s) => monitoringStatuses.has(s))) {
  fail("part3_monitoringReality.findings has no non-'wired' monitoringStatus entry -- report is one-sided.");
}

// --- Cross-cutting structural checks on every finding across all 3 parts ---

const allFindings = [
  ...part1.findings,
  ...part2.findings,
  ...part3.findings,
];

if (allFindings.length === 0) {
  fail("No findings recorded across all three parts.");
}

let missingRequiredFields = 0;
let unresolvablePaths = 0;
const seenIds = new Set();
let duplicateIds = 0;

for (const f of allFindings) {
  if (!f.id || typeof f.id !== "string") {
    missingRequiredFields++;
    continue;
  }
  if (seenIds.has(f.id)) duplicateIds++;
  seenIds.add(f.id);

  if (!f.category || typeof f.category !== "string") missingRequiredFields++;
  if (!f.file || typeof f.file !== "string") {
    missingRequiredFields++;
  } else if (!existsSync(join(ROOT, f.file))) {
    unresolvablePaths++;
  }
  if (!f.severity || !["P1", "P2", "P3"].includes(f.severity)) {
    missingRequiredFields++;
  }
  if (!f.description || typeof f.description !== "string" || f.description.length < 20) {
    missingRequiredFields++;
  }
  if (!f.evidence || typeof f.evidence !== "string") {
    missingRequiredFields++;
  }
}

if (missingRequiredFields > 0) {
  fail(`${missingRequiredFields} finding(s) are missing a required field (id/category/file/severity/description/evidence).`);
}
if (duplicateIds > 0) {
  fail(`${duplicateIds} duplicate finding id(s) found -- ids must be unique across the report.`);
}
if (unresolvablePaths > 0) {
  fail(`${unresolvablePaths} finding(s) cite a file that does not exist on disk -- citations must be verifiable.`);
}

// --- Summary cross-check: recompute from the findings arrays, don't trust
// hand-written totals to have stayed in sync with the data. -----------------

const summary = data.summary;
if (!summary || typeof summary !== "object") {
  fail("observability.json is missing a top-level `summary` object.");
}

const recomputed = {
  totalFindings: allFindings.length,
  part1FindingCount: part1.findings.length,
  part2FindingCount: part2.findings.length,
  part3FindingCount: part3.findings.length,
  unloggedExecutionCount: allFindings.filter((f) => f.unloggedExecution === true).length,
  absentErrorSurfacingCount: allFindings.filter((f) => f.absentErrorSurfacing === true).length,
  wiredMonitoringCount: allFindings.filter((f) => f.monitoringStatus === "wired").length,
  deadMonitoringCodeCount: allFindings.filter((f) => f.monitoringStatus === "deadCode").length,
  aspirationalMonitoringCount: allFindings.filter((f) => f.monitoringStatus === "aspirational").length,
  brokenMetricCount: allFindings.filter((f) => f.monitoringStatus === "brokenMetric").length,
  p1Count: allFindings.filter((f) => f.severity === "P1").length,
  p2Count: allFindings.filter((f) => f.severity === "P2").length,
  p3Count: allFindings.filter((f) => f.severity === "P3").length,
};

const mismatches = [];
for (const key of Object.keys(recomputed)) {
  if (summary[key] !== recomputed[key]) {
    mismatches.push(`${key}: summary says ${summary[key]}, actual is ${recomputed[key]}`);
  }
}
if (mismatches.length > 0) {
  fail(`summary counts do not match the findings arrays:\n  ${mismatches.join("\n  ")}`);
}

if (!summary.headline || typeof summary.headline !== "string" || summary.headline.length < 50) {
  fail("summary.headline is missing or too short to be a real synthesis.");
}

console.log("PASS: observability.json records the run-log completeness comparison + error-surfacing trace + monitoring reality, all cross-checked.");
console.log(`  Total findings: ${summary.totalFindings} (part1=${summary.part1FindingCount}, part2=${summary.part2FindingCount}, part3=${summary.part3FindingCount})`);
console.log(`  Unlogged-execution findings: ${summary.unloggedExecutionCount}`);
console.log(`  Absent-error-surfacing findings: ${summary.absentErrorSurfacingCount}`);
console.log(`  Monitoring: wired=${summary.wiredMonitoringCount} deadCode=${summary.deadMonitoringCodeCount} aspirational=${summary.aspirationalMonitoringCount} brokenMetric=${summary.brokenMetricCount}`);
console.log(`  Severity: P1=${summary.p1Count} P2=${summary.p2Count} P3=${summary.p3Count}`);
process.exit(0);
