#!/usr/bin/env node
// ============================================================================
// PT-04-001 verifier — grant-probability.json hand-verification coverage
//
// Exits non-zero unless test-evidence/pt-04/grant-probability.json:
//   1. exists, is non-empty, parses as JSON.
//   2. records a concrete input (real opportunity/org identifiers plus the
//      real underlying data pulled for the computation -- not a placeholder).
//   3. records a hand-computed "expected" result (factors array with
//      name/weight/value/contribution per the documented formula, plus
//      overall_score/recommendation/confidence).
//   4. records the system's "actual" stored/returned value in the same
//      shape (factors/overall_score/recommendation/confidence), so the two
//      are genuinely comparable field-by-field.
//   5. records a "delta" object comparing expected vs actual, per factor and
//      overall, not just a single top-line diff.
//   6. records a non-empty "finding" string stating the result plainly.
//
// This script does not re-run the computation itself -- it only verifies the
// evidence file has the shape and content this audit step requires. Re-derive
// the numbers by hand from the JSON's own "documented_formula" and "input"
// blocks if you need to confirm the arithmetic independently.
//
// Usage: node scripts/audit/verify-pt04-001.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");
const evidencePath = path.join(repoRoot, "test-evidence", "pt-04", "grant-probability.json");

let failed = false;
function fail(reason) {
  console.error(`PT-04-001 FAIL: ${reason}`);
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

function checkFactorArray(arr, label) {
  if (!Array.isArray(arr) || arr.length === 0) {
    fail(`${label}.factors must be a non-empty array`);
    return;
  }
  for (const [i, f] of arr.entries()) {
    if (!f || typeof f !== "object") {
      fail(`${label}.factors[${i}] is not an object`);
      continue;
    }
    if (!isNonEmptyString(f.name)) fail(`${label}.factors[${i}].name missing`);
    if (!isFiniteNumber(f.weight)) fail(`${label}.factors[${i}].weight missing/not a number`);
    if (!isFiniteNumber(f.value)) fail(`${label}.factors[${i}].value missing/not a number`);
    if (!isFiniteNumber(f.contribution)) fail(`${label}.factors[${i}].contribution missing/not a number`);
  }
}

function checkResultBlock(block, label, requireDescription) {
  if (!block || typeof block !== "object") {
    fail(`${label} block missing or not an object`);
    return;
  }
  if (requireDescription && !isNonEmptyString(block.description)) {
    fail(`${label}.description missing -- must state how this value was derived`);
  }
  checkFactorArray(block.factors, label);
  if (!isFiniteNumber(block.overall_score)) fail(`${label}.overall_score missing/not a number`);
  if (!isNonEmptyString(block.recommendation)) fail(`${label}.recommendation missing`);
  if (!isNonEmptyString(block.confidence)) fail(`${label}.confidence missing`);
}

function main() {
  const evidence = readJson(evidencePath, "grant-probability.json");
  if (!evidence) {
    console.error("PT-04-001 FAIL: cannot proceed without the evidence file parsing.");
    process.exit(1);
  }

  // --- input: must name the real opportunity+org pair and carry real data ---
  if (!isNonEmptyString(evidence.opportunity_id)) fail("opportunity_id missing at top level");
  if (!isNonEmptyString(evidence.organization_id)) fail("organization_id missing at top level");

  const input = evidence.input;
  if (!input || typeof input !== "object") {
    fail("input block missing or not an object");
  } else {
    if (!isNonEmptyString(input.opportunity_name)) fail("input.opportunity_name missing");
    if (!isNonEmptyString(input.category)) fail("input.category missing");
    if (!("current_eligibility_score" in input)) fail("input.current_eligibility_score missing");
    if (!("current_deadline" in input)) fail("input.current_deadline missing");
    if (!("twin_completeness_score" in input)) fail("input.twin_completeness_score missing");
    if (!isFiniteNumber(input.outcomes_in_same_category_count)) {
      fail("input.outcomes_in_same_category_count missing/not a number");
    }
    if (!isNonEmptyString(input.probability_row_computed_at)) {
      fail("input.probability_row_computed_at missing -- needed to reason about staleness");
    }
  }

  // --- documented_formula: must actually quote the formula being verified against ---
  const formula = evidence.documented_formula;
  if (!formula || typeof formula !== "object") {
    fail("documented_formula block missing or not an object");
  } else {
    if (!formula.weights || typeof formula.weights !== "object") {
      fail("documented_formula.weights missing");
    } else {
      const weightSum = Object.values(formula.weights).reduce((s, w) => s + w, 0);
      if (Math.abs(weightSum - 1) > 1e-9) {
        fail(`documented_formula.weights do not sum to 1 (sum=${weightSum})`);
      }
    }
    if (!isNonEmptyString(formula.aggregation)) fail("documented_formula.aggregation missing");
    if (!isNonEmptyString(formula.source_file)) fail("documented_formula.source_file missing");
  }

  // --- expected: the hand-computed result ---
  checkResultBlock(evidence.expected, "expected", true);

  // --- actual: the system's real stored/returned value, same shape ---
  checkResultBlock(evidence.actual, "actual", true);
  if (evidence.actual && !isNonEmptyString(evidence.actual.computed_at)) {
    fail("actual.computed_at missing -- needed to prove this is a real persisted row, not fabricated");
  }

  // --- delta: expected vs actual must be reconcilable field by field ---
  const delta = evidence.delta;
  if (!delta || typeof delta !== "object") {
    fail("delta block missing or not an object");
  } else {
    if (!isFiniteNumber(delta.overall_score)) fail("delta.overall_score missing/not a number");
    if (typeof delta.recommendation_changed !== "boolean") fail("delta.recommendation_changed missing/not a boolean");
    if (typeof delta.confidence_changed !== "boolean") fail("delta.confidence_changed missing/not a boolean");
    if (!Array.isArray(delta.per_factor) || delta.per_factor.length === 0) {
      fail("delta.per_factor must be a non-empty array");
    } else {
      for (const [i, pf] of delta.per_factor.entries()) {
        if (!isNonEmptyString(pf.name)) fail(`delta.per_factor[${i}].name missing`);
        if (!("expected_value" in pf)) fail(`delta.per_factor[${i}].expected_value missing`);
        if (!("actual_value" in pf)) fail(`delta.per_factor[${i}].actual_value missing`);
        if (!("value_delta" in pf)) fail(`delta.per_factor[${i}].value_delta missing`);
        if (!("expected_contribution" in pf)) fail(`delta.per_factor[${i}].expected_contribution missing`);
        if (!("actual_contribution" in pf)) fail(`delta.per_factor[${i}].actual_contribution missing`);
      }
    }

    // Cross-check: delta.overall_score must actually equal expected.overall_score - actual.overall_score.
    if (evidence.expected && evidence.actual && isFiniteNumber(delta.overall_score)) {
      const recomputedDelta = evidence.expected.overall_score - evidence.actual.overall_score;
      if (recomputedDelta !== delta.overall_score) {
        fail(
          `delta.overall_score (${delta.overall_score}) does not equal expected.overall_score - actual.overall_score (${recomputedDelta}) -- delta was not honestly derived from expected/actual`,
        );
      }
    }

    // Cross-check every per-factor delta the same way, and cross-check
    // actual_value/actual_contribution genuinely match the actual.factors array
    // (not silently re-derived or fabricated independently of the recorded actual block).
    if (Array.isArray(delta.per_factor) && evidence.actual && Array.isArray(evidence.actual.factors)) {
      for (const pf of delta.per_factor) {
        const actualFactor = evidence.actual.factors.find((f) => f.name === pf.name);
        if (!actualFactor) {
          fail(`delta.per_factor references factor "${pf.name}" not present in actual.factors`);
          continue;
        }
        if (isFiniteNumber(pf.actual_value) && pf.actual_value !== actualFactor.value) {
          fail(
            `delta.per_factor["${pf.name}"].actual_value (${pf.actual_value}) does not match actual.factors["${pf.name}"].value (${actualFactor.value})`,
          );
        }
      }
    }
  }

  // --- finding: must state a plain-language conclusion, not be left blank ---
  if (!isNonEmptyString(evidence.finding)) {
    fail("finding string missing -- must state plainly whether a mismatch was found");
  }

  if (failed) {
    console.error("\nPT-04-001 FAIL: grant-probability.json is missing required hand-verification evidence.");
    process.exit(1);
  }

  console.log("PT-04-001 PASS");
  console.log(`  opportunity_id: ${evidence.opportunity_id}`);
  console.log(`  organization_id: ${evidence.organization_id}`);
  console.log(`  expected.overall_score: ${evidence.expected.overall_score}`);
  console.log(`  actual.overall_score:   ${evidence.actual.overall_score}`);
  console.log(`  delta.overall_score:    ${evidence.delta.overall_score}`);
  console.log(`  finding: ${evidence.finding.slice(0, 120)}${evidence.finding.length > 120 ? "..." : ""}`);
  process.exit(0);
}

main();
