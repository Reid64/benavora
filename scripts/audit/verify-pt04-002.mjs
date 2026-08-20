#!/usr/bin/env node
// ============================================================================
// PT-04-002 verifier — budget-deadline.json hand-verification coverage
//
// Exits non-zero unless test-evidence/pt-04/budget-deadline.json:
//   1. exists, is non-empty, parses as JSON.
//   2. records a budget_reconciliation block with a concrete input (real
//      line_items + real expenses), a hand-computed "expected" result, the
//      system's real "actual" reconciliation report (with a real id and
//      generated_at, proving it's a real persisted row, not fabricated),
//      and a "delta" object reconciling the two field by field.
//   3. records a deadline_reminder_offset block with a concrete input (real
//      deadline rows, distinct scenarios), and a per_deadline array where
//      EVERY entry carries both expected_reminders_fired and
//      actual_reminders_fired (expected-vs-actual side by side), plus a
//      "match" boolean that is honestly reconcilable from the two arrays.
//   4. records a non-empty "finding" string for each check, stating the
//      result plainly.
//   5. records that cleanup left no residue (a real budget/deadline hand-
//      verification pass must not leave synthetic data behind in the real
//      database).
//
// This script does not re-run the seeding/HTTP calls itself -- it only
// verifies the evidence file has the shape and content this audit step
// requires, and independently re-derives a few of the recorded numbers from
// the recorded raw inputs to catch a dishonestly-computed delta/match.
//
// Usage: node scripts/audit/verify-pt04-002.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");
const evidencePath = path.join(repoRoot, "test-evidence", "pt-04", "budget-deadline.json");

let failed = false;
function fail(reason) {
  console.error(`PT-04-002 FAIL: ${reason}`);
  failed = true;
}

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`${label} does not exist at ${filePath}`);
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  if (raw.trim().length === 0) {
    fail(`${label} is empty`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`${label} is not valid JSON: ${err.message}`);
    return null;
  }
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Budget reconciliation checks
// ---------------------------------------------------------------------------
function checkBudget(evidence) {
  const b = evidence.budget_reconciliation;
  if (!b || typeof b !== "object") {
    fail("budget_reconciliation block missing or not an object");
    return;
  }

  if (!b.documented_formula || !isNonEmptyString(b.documented_formula.source_file)) {
    fail("budget_reconciliation.documented_formula.source_file missing");
  }

  const input = b.input;
  if (!input || typeof input !== "object") {
    fail("budget_reconciliation.input missing or not an object");
  } else {
    if (!Array.isArray(input.line_items) || input.line_items.length === 0) {
      fail("budget_reconciliation.input.line_items must be a non-empty array (a REAL budget, not a placeholder)");
    }
    if (!Array.isArray(input.expenses) || input.expenses.length === 0) {
      fail("budget_reconciliation.input.expenses must be a non-empty array (REAL expenses, not a placeholder)");
    }
  }

  const expected = b.expected;
  const actual = b.actual;
  if (!expected || typeof expected !== "object") {
    fail("budget_reconciliation.expected missing or not an object");
  } else {
    for (const key of ["total_budget", "total_spent", "variance"]) {
      if (!isFiniteNumber(expected[key])) fail(`budget_reconciliation.expected.${key} missing/not a number`);
    }
    if (!isNonEmptyString(expected.compliance_status)) {
      fail("budget_reconciliation.expected.compliance_status missing");
    }
  }
  if (!actual || typeof actual !== "object") {
    fail("budget_reconciliation.actual missing or not an object");
  } else {
    if (!isNonEmptyString(actual.id)) {
      fail("budget_reconciliation.actual.id missing -- must be a real persisted reconciliation report row, not fabricated");
    }
    if (!isNonEmptyString(actual.generated_at)) {
      fail("budget_reconciliation.actual.generated_at missing -- needed to prove this is a real system-generated timestamp");
    }
    for (const key of ["total_budget", "total_spent", "variance"]) {
      if (!isFiniteNumber(actual[key])) fail(`budget_reconciliation.actual.${key} missing/not a number`);
    }
    if (!isNonEmptyString(actual.compliance_status)) {
      fail("budget_reconciliation.actual.compliance_status missing");
    }
  }

  // Independently re-derive expected from the recorded raw input, to catch a
  // dishonestly hand-typed "expected" block that doesn't actually match the
  // line_items/expenses arrays it claims to summarize.
  if (input && Array.isArray(input.line_items) && Array.isArray(input.expenses) && expected) {
    const rederivedBudget = round2(
      input.line_items.reduce((s, i) => s + (Number(i.amount) || 0), 0),
    );
    const rederivedSpent = round2(
      input.expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0),
    );
    if (rederivedBudget !== expected.total_budget) {
      fail(
        `budget_reconciliation.expected.total_budget (${expected.total_budget}) does not equal sum(input.line_items.amount) (${rederivedBudget}) -- expected was not honestly hand-summed from the recorded input`,
      );
    }
    if (rederivedSpent !== expected.total_spent) {
      fail(
        `budget_reconciliation.expected.total_spent (${expected.total_spent}) does not equal sum(input.expenses.amount) (${rederivedSpent}) -- expected was not honestly hand-summed from the recorded input`,
      );
    }
  }

  const delta = b.delta;
  if (!delta || typeof delta !== "object") {
    fail("budget_reconciliation.delta missing or not an object");
  } else {
    for (const key of ["total_budget", "total_spent", "variance"]) {
      if (!isFiniteNumber(delta[key])) fail(`budget_reconciliation.delta.${key} missing/not a number`);
    }
    if (typeof delta.compliance_status_matches !== "boolean") {
      fail("budget_reconciliation.delta.compliance_status_matches missing/not a boolean");
    }
    // Cross-check delta actually equals actual - expected for each field.
    if (expected && actual) {
      for (const key of ["total_budget", "total_spent", "variance"]) {
        if (isFiniteNumber(expected[key]) && isFiniteNumber(actual[key]) && isFiniteNumber(delta[key])) {
          const recomputed = round2(actual[key] - expected[key]);
          if (recomputed !== delta[key]) {
            fail(
              `budget_reconciliation.delta.${key} (${delta[key]}) does not equal actual.${key} - expected.${key} (${recomputed}) -- delta was not honestly derived`,
            );
          }
        }
      }
      if (delta.compliance_status_matches !== (actual.compliance_status === expected.compliance_status)) {
        fail(
          "budget_reconciliation.delta.compliance_status_matches does not honestly reflect whether actual.compliance_status === expected.compliance_status",
        );
      }
    }
  }

  if (!isNonEmptyString(b.finding)) {
    fail("budget_reconciliation.finding missing -- must state plainly whether a mismatch was found");
  }
}

// ---------------------------------------------------------------------------
// Deadline reminder-offset checks
// ---------------------------------------------------------------------------
function checkDeadlines(evidence) {
  const d = evidence.deadline_reminder_offset;
  if (!d || typeof d !== "object") {
    fail("deadline_reminder_offset block missing or not an object");
    return;
  }

  if (!d.documented_formula || !isNonEmptyString(d.documented_formula.source_file)) {
    fail("deadline_reminder_offset.documented_formula.source_file missing");
  }
  if (!Array.isArray(d.documented_formula?.thresholds_days) || d.documented_formula.thresholds_days.length === 0) {
    fail("deadline_reminder_offset.documented_formula.thresholds_days must be a non-empty array");
  }

  const perDeadline = d.per_deadline;
  if (!Array.isArray(perDeadline) || perDeadline.length === 0) {
    fail("deadline_reminder_offset.per_deadline must be a non-empty array");
    return;
  }

  // Require at least a few distinct scenarios -- "several deadline types",
  // not one row tested once.
  const distinctTypes = new Set(perDeadline.map((r) => r.deadline_type));
  if (distinctTypes.size < 3) {
    fail(
      `deadline_reminder_offset.per_deadline covers only ${distinctTypes.size} distinct deadline_type value(s) -- task requires verification across "several deadline types"`,
    );
  }

  let anyRecordedMismatch = false;
  for (const [i, row] of perDeadline.entries()) {
    const label = `deadline_reminder_offset.per_deadline[${i}]`;
    if (!isNonEmptyString(row.scenario)) fail(`${label}.scenario missing`);
    if (!isNonEmptyString(row.deadline_id)) fail(`${label}.deadline_id missing`);
    if (!isNonEmptyString(row.deadline_type)) fail(`${label}.deadline_type missing`);
    if (!isNonEmptyString(row.due_date)) fail(`${label}.due_date missing`);
    if (typeof row.expected_days_until !== "number") fail(`${label}.expected_days_until missing/not a number`);
    if (!Array.isArray(row.expected_reminders_fired)) fail(`${label}.expected_reminders_fired must be an array`);
    if (!Array.isArray(row.actual_reminders_fired)) fail(`${label}.actual_reminders_fired must be an array`);
    if (typeof row.match !== "boolean") fail(`${label}.match missing/not a boolean`);

    // Independently recompute "match" from the recorded expected/actual
    // arrays and days-until, to catch a dishonestly-recorded match flag.
    if (Array.isArray(row.expected_reminders_fired) && Array.isArray(row.actual_reminders_fired)) {
      const expectedSorted = [...row.expected_reminders_fired].sort((a, b2) => b2 - a);
      const actualSorted = [...row.actual_reminders_fired].sort((a, b2) => b2 - a);
      const arraysMatch = JSON.stringify(expectedSorted) === JSON.stringify(actualSorted);
      const daysMatch =
        row.actual_row_present_in_response === false
          ? row.expected_reminders_fired.length === 0
          : row.actual_days_until === row.expected_days_until;
      const recomputedMatch = arraysMatch && daysMatch;
      if (recomputedMatch !== row.match) {
        fail(
          `${label}.match (${row.match}) does not honestly reflect expected_reminders_fired vs actual_reminders_fired (recomputed=${recomputedMatch})`,
        );
      }
      if (!recomputedMatch) anyRecordedMismatch = true;
    }
  }

  if (!isNonEmptyString(d.finding)) {
    fail("deadline_reminder_offset.finding missing -- must state plainly whether a mismatch was found");
  }
  // If every row genuinely matched, the finding must not claim a mismatch,
  // and vice versa -- catches a finding string that contradicts the data.
  if (isNonEmptyString(d.finding)) {
    const findingClaimsMismatch = /^MISMATCH/.test(d.finding.trim());
    if (findingClaimsMismatch !== anyRecordedMismatch) {
      fail(
        `deadline_reminder_offset.finding (starts with "${d.finding.slice(0, 20)}...") is inconsistent with the per_deadline rows' own match flags (anyRecordedMismatch=${anyRecordedMismatch})`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Cleanup / no-residue-left-in-production check
// ---------------------------------------------------------------------------
function checkCleanup(evidence) {
  const cleanup = evidence.cleanup;
  if (!cleanup || typeof cleanup !== "object") {
    fail("cleanup block missing or not an object -- a real-database hand-verification pass must record that it cleaned up after itself");
    return;
  }
  const residue = cleanup.residue_check;
  if (!residue || typeof residue !== "object") {
    fail("cleanup.residue_check missing or not an object");
    return;
  }
  for (const key of [
    "grant_budgets_remaining",
    "grant_expenses_remaining",
    "grant_reconciliation_reports_remaining",
    "synthetic_deadlines_remaining",
  ]) {
    if (residue[key] !== 0) {
      fail(`cleanup.residue_check.${key} is ${residue[key]}, expected 0 -- synthetic test data was left behind in the real database`);
    }
  }
  if (residue.pre_existing_deadline_flags_reverted !== true) {
    fail("cleanup.residue_check.pre_existing_deadline_flags_reverted is not true -- the pre-existing real deadline's reminder flags were not restored");
  }
  if (Array.isArray(cleanup.errors) && cleanup.errors.length > 0) {
    fail(`cleanup.errors is non-empty: ${JSON.stringify(cleanup.errors)}`);
  }
}

function main() {
  const evidence = readJson(evidencePath, "budget-deadline.json");
  if (!evidence) {
    console.error("PT-04-002 FAIL: cannot proceed without the evidence file parsing.");
    process.exit(1);
  }

  if (!isNonEmptyString(evidence.organization_id)) fail("organization_id missing at top level");
  if (!isNonEmptyString(evidence.generated_at)) fail("generated_at missing at top level");

  checkBudget(evidence);
  checkDeadlines(evidence);
  checkCleanup(evidence);

  if (failed) {
    console.error("\nPT-04-002 FAIL: budget-deadline.json is missing required hand-verification evidence.");
    process.exit(1);
  }

  console.log("PT-04-002 PASS");
  console.log(`  organization_id: ${evidence.organization_id}`);
  if (evidence.budget_reconciliation) {
    const b = evidence.budget_reconciliation;
    console.log(`  budget: expected total_budget=${b.expected.total_budget} total_spent=${b.expected.total_spent} variance=${b.expected.variance}`);
    console.log(`  budget: actual   total_budget=${b.actual.total_budget} total_spent=${b.actual.total_spent} variance=${b.actual.variance}`);
    console.log(`  budget finding: ${b.finding.slice(0, 120)}${b.finding.length > 120 ? "..." : ""}`);
  }
  if (evidence.deadline_reminder_offset) {
    const d = evidence.deadline_reminder_offset;
    console.log(`  deadlines: ${d.per_deadline.length} scenarios checked, ${d.per_deadline.filter((r) => r.match).length} matched`);
    console.log(`  deadline finding: ${d.finding.slice(0, 120)}${d.finding.length > 120 ? "..." : ""}`);
  }
  process.exit(0);
}

main();
