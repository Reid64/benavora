#!/usr/bin/env node
// ============================================================================
// PT-04-003 verifier — scoring.json hand-verification coverage
//
// Exits non-zero unless test-evidence/pt-04/scoring.json:
//   1. exists, is non-empty, parses as JSON.
//   2. carries all three required function blocks under `functions`:
//      draft_confidence, autoapply_eligibility, match_fit_scoring.
//   3. each function block records a source_file, function name, a
//      documented_formula, and a non-empty `scenarios` array.
//   4. EVERY scenario in EVERY function records a concrete `input`, a
//      hand-computed `expected`, the real function's `actual` output, and a
//      `delta` reconciling the two -- expected-vs-actual, not one or the
//      other alone.
//   5. every scenario's own `match` boolean is honestly reconcilable from
//      its own delta (catches a hand-typed "true" next to a nonzero delta).
//   6. each function records a non-empty `finding` string, and the
//      top-level `all_functions_verified` / `overall_finding` are honestly
//      consistent with whether every scenario in every function matched.
//
// This script does not re-run the scoring functions itself -- it only
// verifies the evidence file has the shape and internal consistency this
// audit step requires. Re-run scripts/audit/pt04-003-scoring.mjs to
// regenerate the evidence from the real, live source functions.
//
// Usage: node scripts/audit/verify-pt04-003.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");
const evidencePath = path.join(repoRoot, "test-evidence", "pt-04", "scoring.json");

const REQUIRED_FUNCTIONS = ["draft_confidence", "autoapply_eligibility", "match_fit_scoring"];

let failed = false;
function fail(reason) {
  console.error(`PT-04-003 FAIL: ${reason}`);
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

function hasOwn(obj, key) {
  return obj !== null && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key);
}

// Every scenario, regardless of function, must carry these four pieces at a
// minimum -- this is the literal "input/expected/actual/delta per function"
// requirement, checked at the per-scenario granularity within each function.
function checkScenarioShape(scenario, label) {
  if (!scenario || typeof scenario !== "object") {
    fail(`${label} is not an object`);
    return;
  }
  if (!isNonEmptyString(scenario.scenario)) fail(`${label}.scenario (description) missing`);
  if (!hasOwn(scenario, "input") || scenario.input === null || typeof scenario.input !== "object") {
    fail(`${label}.input missing or not an object`);
  }
  if (!hasOwn(scenario, "expected")) {
    fail(`${label}.expected missing`);
  }
  if (!hasOwn(scenario, "actual")) {
    fail(`${label}.actual missing -- must be the real function's own output, not omitted`);
  }
  if (!hasOwn(scenario, "delta") || scenario.delta === null || scenario.delta === undefined) {
    fail(`${label}.delta missing`);
  } else if (typeof scenario.delta !== "number" && typeof scenario.delta !== "object") {
    fail(`${label}.delta must be a number (simple scoring functions) or an object (multi-field results)`);
  }
  if (typeof scenario.match !== "boolean") {
    fail(`${label}.match missing/not a boolean`);
  }
  if (!isNonEmptyString(scenario.expected_reasoning)) {
    fail(`${label}.expected_reasoning missing -- expected value must be traceably hand-derived, not a bare number`);
  }
}

function checkFunctionBlock(block, key, expectMinScenarios) {
  const label = `functions.${key}`;
  if (!block || typeof block !== "object") {
    fail(`${label} block missing or not an object`);
    return;
  }
  if (!isNonEmptyString(block.source_file)) fail(`${label}.source_file missing`);
  if (!isNonEmptyString(block.function)) fail(`${label}.function missing`);
  if (!block.documented_formula || typeof block.documented_formula !== "object") {
    fail(`${label}.documented_formula missing or not an object -- must quote the real thresholds/weights being verified against`);
  }
  if (!Array.isArray(block.scenarios) || block.scenarios.length < expectMinScenarios) {
    fail(`${label}.scenarios must be an array with at least ${expectMinScenarios} entries (found ${Array.isArray(block.scenarios) ? block.scenarios.length : "none"})`);
    return;
  }
  block.scenarios.forEach((s, i) => checkScenarioShape(s, `${label}.scenarios[${i}]`));

  if (typeof block.all_scenarios_match !== "boolean") {
    fail(`${label}.all_scenarios_match missing/not a boolean`);
  } else {
    // Cross-check: all_scenarios_match must honestly reflect every scenario's own match flag.
    const recomputed = block.scenarios.every((s) => s.match === true);
    if (recomputed !== block.all_scenarios_match) {
      fail(
        `${label}.all_scenarios_match (${block.all_scenarios_match}) does not honestly reflect its own scenarios' match flags (recomputed=${recomputed})`,
      );
    }
  }

  if (!isNonEmptyString(block.finding)) {
    fail(`${label}.finding missing -- must state plainly whether a mismatch was found`);
  } else {
    const claimsMatch = /^MATCH:/.test(block.finding.trim());
    const claimsMismatch = /^MISMATCH:/.test(block.finding.trim());
    if (!claimsMatch && !claimsMismatch) {
      fail(`${label}.finding does not start with "MATCH:" or "MISMATCH:" -- must state its conclusion unambiguously`);
    } else if (typeof block.all_scenarios_match === "boolean") {
      if (claimsMatch !== block.all_scenarios_match) {
        fail(
          `${label}.finding (starts "${block.finding.slice(0, 12)}") contradicts ${label}.all_scenarios_match (${block.all_scenarios_match})`,
        );
      }
    }
  }
}

// ----------------------------------------------------------------------------
// Function-specific delta sanity checks -- catch a dishonestly-typed delta
// that doesn't actually reconcile with the recorded expected/actual.
// ----------------------------------------------------------------------------

function checkDraftConfidenceDeltas(block) {
  if (!Array.isArray(block?.scenarios)) return;
  for (const [i, s] of block.scenarios.entries()) {
    const label = `functions.draft_confidence.scenarios[${i}]`;
    if (!isFiniteNumber(s.expected)) {
      fail(`${label}.expected must be a number`);
      continue;
    }
    if (!isFiniteNumber(s.actual)) {
      fail(`${label}.actual must be a number`);
      continue;
    }
    if (!isFiniteNumber(s.delta)) {
      fail(`${label}.delta must be a number`);
      continue;
    }
    const recomputed = s.actual - s.expected;
    if (recomputed !== s.delta) {
      fail(`${label}.delta (${s.delta}) != actual - expected (${recomputed})`);
    }
    const recomputedMatch = s.delta === 0;
    if (recomputedMatch !== s.match) {
      fail(`${label}.match (${s.match}) inconsistent with delta (${s.delta})`);
    }
    // clamp sanity: computeConfidence's documented range is [0,100] (or the
    // zero-KB branch's own [55,65] sub-range) -- a value outside [0,100] on
    // either side would itself indicate a real clamp bug.
    if (s.actual < 0 || s.actual > 100) {
      fail(`${label}.actual (${s.actual}) is outside the documented [0,100] clamp range`);
    }
  }
}

function checkAutoApplyEligibilityDeltas(block) {
  if (!Array.isArray(block?.scenarios)) return;
  for (const [i, s] of block.scenarios.entries()) {
    const label = `functions.autoapply_eligibility.scenarios[${i}]`;
    const exp = s.expected;
    const act = s.actual;
    const delta = s.delta;
    if (!exp || typeof exp !== "object" || !isFiniteNumber(exp.score) || typeof exp.ready !== "boolean") {
      fail(`${label}.expected must carry {ready: boolean, score: number, missing_required: [], missing_recommended: [], blockers: []}`);
      continue;
    }
    if (!act || typeof act !== "object" || !isFiniteNumber(act.score) || typeof act.ready !== "boolean") {
      fail(`${label}.actual must carry {ready: boolean, score: number, missing_required: [], missing_recommended: [], blockers: []}`);
      continue;
    }
    if (!delta || typeof delta !== "object") {
      fail(`${label}.delta missing shape`);
      continue;
    }
    if (delta.score_delta !== act.score - exp.score) {
      fail(`${label}.delta.score_delta (${delta.score_delta}) != actual.score - expected.score (${act.score - exp.score})`);
    }
    if (delta.ready_matches !== (act.ready === exp.ready)) {
      fail(`${label}.delta.ready_matches does not honestly reflect actual.ready === expected.ready`);
    }
    const arraysEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (delta.missing_required_matches !== arraysEq(act.missing_required, exp.missing_required)) {
      fail(`${label}.delta.missing_required_matches does not honestly reflect actual vs expected missing_required arrays`);
    }
    if (delta.missing_recommended_matches !== arraysEq(act.missing_recommended, exp.missing_recommended)) {
      fail(`${label}.delta.missing_recommended_matches does not honestly reflect actual vs expected missing_recommended arrays`);
    }
    if (delta.blockers_matches !== arraysEq(act.blockers, exp.blockers)) {
      fail(`${label}.delta.blockers_matches does not honestly reflect actual vs expected blockers arrays`);
    }
    const recomputedMatch =
      delta.score_delta === 0 &&
      delta.ready_matches === true &&
      delta.missing_required_matches === true &&
      delta.missing_recommended_matches === true &&
      delta.blockers_matches === true;
    if (recomputedMatch !== s.match) {
      fail(`${label}.match (${s.match}) inconsistent with its own delta sub-fields (recomputed=${recomputedMatch})`);
    }
    // score must be in [0,100] per the documented clamp.
    if (act.score < 0 || act.score > 100) {
      fail(`${label}.actual.score (${act.score}) is outside the documented [0,100] clamp range`);
    }
  }
}

function checkMatchFitScoringDeltas(block) {
  if (!Array.isArray(block?.scenarios)) return;
  for (const [i, s] of block.scenarios.entries()) {
    const label = `functions.match_fit_scoring.scenarios[${i}]`;
    const exp = s.expected;
    const act = s.actual;
    const delta = s.delta;
    if (!exp || typeof exp !== "object" || !isFiniteNumber(exp.score) || !Array.isArray(exp.factors)) {
      fail(`${label}.expected must carry {score, confidence, recommendation, factors: []}`);
      continue;
    }
    if (!act || typeof act !== "object" || !isFiniteNumber(act.score) || !Array.isArray(act.factors)) {
      fail(`${label}.actual must carry {score, confidence, recommendation, factors: []}`);
      continue;
    }
    if (!delta || typeof delta !== "object" || !Array.isArray(delta.per_factor) || delta.per_factor.length === 0) {
      fail(`${label}.delta must carry a non-empty per_factor array`);
      continue;
    }
    if (delta.score_delta !== act.score - exp.score) {
      fail(`${label}.delta.score_delta (${delta.score_delta}) != actual.score - expected.score (${act.score - exp.score})`);
    }
    if (delta.confidence_matches !== (act.confidence === exp.confidence)) {
      fail(`${label}.delta.confidence_matches does not honestly reflect actual.confidence === expected.confidence`);
    }
    if (delta.recommendation_matches !== (act.recommendation === exp.recommendation)) {
      fail(`${label}.delta.recommendation_matches does not honestly reflect actual.recommendation === expected.recommendation`);
    }
    // Recommendation thresholds must be internally consistent with the score
    // this scenario actually recorded (catches an inverted or off-by-one
    // comparator slipping past the per-field checks above).
    const expectedRec = exp.score >= 70 ? "apply" : exp.score >= 40 ? "consider" : "skip";
    if (expectedRec !== exp.recommendation) {
      fail(`${label}.expected.recommendation (${exp.recommendation}) is inconsistent with expected.score (${exp.score}) under the documented >=70/>=40 thresholds (recomputed=${expectedRec})`);
    }
    let recomputedMatch = delta.score_delta === 0 && delta.confidence_matches === true && delta.recommendation_matches === true;
    for (const pf of delta.per_factor) {
      if (!isNonEmptyString(pf.name)) {
        fail(`${label}.delta.per_factor entry missing name`);
        continue;
      }
      const expFactor = exp.factors.find((f) => f.name === pf.name);
      const actFactor = act.factors.find((f) => f.name === pf.name);
      if (!expFactor) {
        fail(`${label}.delta.per_factor references factor "${pf.name}" not present in expected.factors`);
        continue;
      }
      if (!actFactor) {
        fail(`${label}.delta.per_factor references factor "${pf.name}" not present in actual.factors`);
        continue;
      }
      if (pf.expected_value !== expFactor.value) {
        fail(`${label}.delta.per_factor["${pf.name}"].expected_value (${pf.expected_value}) != expected.factors["${pf.name}"].value (${expFactor.value})`);
      }
      if (pf.actual_value !== actFactor.value) {
        fail(`${label}.delta.per_factor["${pf.name}"].actual_value (${pf.actual_value}) != actual.factors["${pf.name}"].value (${actFactor.value})`);
      }
      if (pf.value_delta !== 0 || pf.contribution_delta !== 0) recomputedMatch = false;
    }
    if (recomputedMatch !== s.match) {
      fail(`${label}.match (${s.match}) inconsistent with its own delta (recomputed=${recomputedMatch})`);
    }
    if (act.score < 0 || act.score > 100) {
      fail(`${label}.actual.score (${act.score}) is outside the documented [0,100] clamp range`);
    }
  }
}

function main() {
  const evidence = readJson(evidencePath, "scoring.json");
  if (!evidence) {
    console.error("PT-04-003 FAIL: cannot proceed without the evidence file parsing.");
    process.exit(1);
  }

  if (!isNonEmptyString(evidence.generated_at)) fail("generated_at missing at top level");
  if (!isNonEmptyString(evidence.method)) fail("method missing at top level -- must state how actual/expected were each derived");

  const functions = evidence.functions;
  if (!functions || typeof functions !== "object") {
    fail("functions block missing or not an object");
  } else {
    for (const key of REQUIRED_FUNCTIONS) {
      if (!hasOwn(functions, key)) {
        fail(`functions.${key} missing -- all three scoring functions (draft confidence, AutoApply eligibility, match/fit) must be present`);
      }
    }
    checkFunctionBlock(functions.draft_confidence, "draft_confidence", 2);
    checkFunctionBlock(functions.autoapply_eligibility, "autoapply_eligibility", 2);
    checkFunctionBlock(functions.match_fit_scoring, "match_fit_scoring", 2);

    checkDraftConfidenceDeltas(functions.draft_confidence);
    checkAutoApplyEligibilityDeltas(functions.autoapply_eligibility);
    checkMatchFitScoringDeltas(functions.match_fit_scoring);
  }

  if (typeof evidence.all_functions_verified !== "boolean") {
    fail("all_functions_verified missing/not a boolean");
  } else if (functions) {
    const recomputed = REQUIRED_FUNCTIONS.every((k) => functions[k]?.all_scenarios_match === true);
    if (recomputed !== evidence.all_functions_verified) {
      fail(
        `all_functions_verified (${evidence.all_functions_verified}) does not honestly reflect the three functions' own all_scenarios_match flags (recomputed=${recomputed})`,
      );
    }
  }

  if (!isNonEmptyString(evidence.overall_finding)) {
    fail("overall_finding missing -- must state plainly whether any of the three scoring functions has a defect");
  }

  if (failed) {
    console.error("\nPT-04-003 FAIL: scoring.json is missing required expected-vs-actual hand-verification evidence for all three scoring functions.");
    process.exit(1);
  }

  console.log("PT-04-003 PASS");
  for (const key of REQUIRED_FUNCTIONS) {
    const block = functions[key];
    console.log(`  ${key}: ${block.scenarios.length} scenarios, all_scenarios_match=${block.all_scenarios_match}`);
  }
  console.log(`  all_functions_verified: ${evidence.all_functions_verified}`);
  process.exit(0);
}

main();
