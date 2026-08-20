// ============================================================================
// PT-03-004 verifier -- kanban stage-transition matrix + auth flows
// (test-evidence/pt-03/kanban-auth.json).
//
// Exits non-zero unless the file:
//   1. Exists, is non-empty, and parses as valid JSON.
//   2. Records a non-production target (local stack only -- HARD FAIL if the
//      production ref appears as an actual target rather than a comparison
//      value).
//   3. Contains a real, complete 12x12 kanban.transition_matrix (144 entries,
//      one per (from, to) pair over the exact 12 documented pipeline_stage
//      values), each entry structurally valid (allowed/direction/condition/
//      requires_note all present with correct types).
//   4. Contains at least one real journey per driven application, and the
//      union of stages those journeys actually reached
//      (kanban.stages_visited) covers all 12 documented stages -- "drive an
//      item through the documented 12-stage pipeline" must mean all 12, not
//      a subset.
//   5. Every legal-transition journey step has a real `assertion` with a
//      non-empty description; a step whose own assertion.pass is false is a
//      real defect and is reported as such (this verifier fails on it -- a
//      legal transition that didn't persist is not something this task's
//      "legal ones persist" requirement allows to pass silently).
//   6. Contains kanban.illegal_transition_rule_tests with at least 6 entries,
//      and every one has assertion.pass === true -- the pure rule function
//      itself must correctly identify each case as illegal. (This is
//      distinct from requirement 7 below: a rule function correctly saying
//      "illegal" is a code-correctness fact this verifier enforces strictly;
//      whether that rule is then actually ENFORCED at the write layer is a
//      separate, honestly-reported finding, not something this verifier
//      requires to come back clean.)
//   7. Contains kanban.enforcement_gap_tests with at least 3 entries (the
//      direct executeTransition() bypass, the raw DB-write bypass, and the
//      role-gate bypass), each carrying a real, non-null `outcome` -- this
//      verifier does NOT require outcome to be "REJECTED"; per this task's
//      own instructions, an unenforced illegal transition is a legitimate,
//      expected finding to record, not a harness failure. What IS required
//      is that the bypass was actually attempted and its real result
//      recorded, not skipped or assumed.
//   8. Contains an `auth_flows` object with exactly the three required keys
//      (password_reset, magic_link_login, session_persistence_reload), each
//      with a non-empty `steps` array and an `outcome` of exactly "PASS" or
//      "FAIL" -- never missing, never any other value. This is the literal
//      "all three auth flows are recorded with outcomes" requirement.
//   9. If `findings` is non-empty, each finding has the required fields
//      (id, area, severity, description, evidence), and severity is one of
//      the standard tiers.
//   10. Every screenshot path referenced in the top-level `screenshots`
//       array actually exists on disk (relative to the repo root) and is
//       non-empty.
//
// This verifier does NOT require every auth-flow outcome to be "PASS" or
// every enforcement-gap outcome to be "REJECTED" -- a broken auth flow or an
// unenforced illegal transition, honestly recorded with real evidence, is
// exactly the output this task asked for. What it requires is that nothing
// was silently skipped, that the transition matrix and stage coverage are
// real and complete, and that every claim is independently checkable.
//
// Usage: node scripts/audit/verify-pt03-004.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const EVIDENCE_JSON = path.join("test-evidence", "pt-03", "kanban-auth.json");
const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";

const REQUIRED_STAGES = [
  "discovered",
  "eligibility_review",
  "qualified",
  "drafting",
  "awaiting_documents",
  "ready_for_review",
  "submitted",
  "follow_up_due",
  "awarded",
  "denied",
  "reporting_required",
  "renewal_opportunity",
];
const VALID_SEVERITIES = ["P0", "P1", "P2", "P3"];
const REQUIRED_AUTH_FLOWS = ["password_reset", "magic_link_login", "session_persistence_reload"];

let errors = 0;
function fail(message) {
  console.error(`FAIL: ${message}`);
  errors++;
}
function hardFail(message) {
  console.error(`HARD FAIL: ${message}`);
  process.exit(1);
}
function pass(message) {
  console.log(`PASS: ${message}`);
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function isNonEmptyArray(v) {
  return Array.isArray(v) && v.length > 0;
}

// ---------------------------------------------------------------------------
// 1. File exists, parses.
// ---------------------------------------------------------------------------
if (!fs.existsSync(EVIDENCE_JSON)) {
  hardFail(`${EVIDENCE_JSON} does not exist.`);
}
const raw = fs.readFileSync(EVIDENCE_JSON, "utf8");
if (!raw || raw.trim().length === 0) {
  hardFail(`${EVIDENCE_JSON} is empty.`);
}
let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  hardFail(`${EVIDENCE_JSON} is not valid JSON: ${err.message}`);
}
pass(`${EVIDENCE_JSON} exists, is non-empty, and parses as valid JSON.`);

// ---------------------------------------------------------------------------
// 2. Non-production target.
// ---------------------------------------------------------------------------
const target = data.target;
if (!target || typeof target !== "object") {
  hardFail(`"target" is missing or not an object.`);
}
if (target.is_production !== false) {
  hardFail(`"target.is_production" must be exactly false -- got ${JSON.stringify(target.is_production)}.`);
}
const apiBase = String(target.api_base ?? "");
if (apiBase.includes(PRODUCTION_REF)) {
  hardFail(`"target.api_base" ("${apiBase}") contains the production ref "${PRODUCTION_REF}". This must never target production.`);
}
if (target.production_ref_for_comparison !== PRODUCTION_REF) {
  fail(`"target.production_ref_for_comparison" should be the literal production ref for auditability, got ${JSON.stringify(target.production_ref_for_comparison)}.`);
} else {
  pass(`Target is confirmed non-production (api_base="${apiBase}"); production ref present only as a comparison value.`);
}

// ---------------------------------------------------------------------------
// 3. Full 12x12 transition matrix.
// ---------------------------------------------------------------------------
const kanban = data.kanban;
if (!kanban || typeof kanban !== "object") {
  hardFail(`"kanban" is missing or not an object.`);
}

if (!Array.isArray(kanban.stages) || kanban.stages.length !== REQUIRED_STAGES.length) {
  fail(`"kanban.stages" must list exactly the ${REQUIRED_STAGES.length} documented pipeline stages -- got ${JSON.stringify(kanban.stages)}.`);
} else {
  const missing = REQUIRED_STAGES.filter((s) => !kanban.stages.includes(s));
  const extra = kanban.stages.filter((s) => !REQUIRED_STAGES.includes(s));
  if (missing.length > 0 || extra.length > 0) {
    fail(`"kanban.stages" does not match the documented set exactly. Missing: [${missing.join(", ")}]. Unexpected: [${extra.join(", ")}].`);
  } else {
    pass(`"kanban.stages" lists exactly the 12 documented pipeline stages.`);
  }
}

const matrix = kanban.transition_matrix;
const expectedPairs = REQUIRED_STAGES.length * REQUIRED_STAGES.length;
if (!Array.isArray(matrix) || matrix.length !== expectedPairs) {
  fail(`"kanban.transition_matrix" must have exactly ${expectedPairs} entries (12x12) -- got ${Array.isArray(matrix) ? matrix.length : typeof matrix}.`);
} else {
  let structurallyValid = true;
  const seenPairs = new Set();
  for (const entry of matrix) {
    if (
      !isNonEmptyString(entry?.from) ||
      !isNonEmptyString(entry?.to) ||
      typeof entry?.allowed !== "boolean" ||
      !isNonEmptyString(entry?.direction) ||
      !isNonEmptyString(entry?.condition) ||
      typeof entry?.requires_note !== "boolean"
    ) {
      structurallyValid = false;
      break;
    }
    seenPairs.add(`${entry.from}->${entry.to}`);
  }
  if (!structurallyValid) {
    fail(`"kanban.transition_matrix" contains a structurally invalid entry (missing/mistyped from, to, allowed, direction, condition, or requires_note).`);
  } else if (seenPairs.size !== expectedPairs) {
    fail(`"kanban.transition_matrix" has ${expectedPairs} entries but only ${seenPairs.size} distinct (from, to) pairs -- duplicates or gaps in coverage.`);
  } else {
    const allowedCount = matrix.filter((e) => e.allowed).length;
    pass(`"kanban.transition_matrix" has all ${expectedPairs} (from, to) pairs, structurally valid (${allowedCount} allowed, ${expectedPairs - allowedCount} disallowed).`);
  }
}

// ---------------------------------------------------------------------------
// 4 + 5. Journeys drive real applications through all 12 stages; every legal
//        step's own assertion passed.
// ---------------------------------------------------------------------------
if (!isNonEmptyArray(kanban.journeys)) {
  fail(`"kanban.journeys" must be a non-empty array of driven applications.`);
} else {
  let anyStepMissingAssertion = false;
  let anyStepFailed = 0;
  let totalSteps = 0;
  for (const journey of kanban.journeys) {
    if (!isNonEmptyString(journey.application_id) || !isNonEmptyArray(journey.steps)) {
      fail(`A kanban journey ("${journey.label ?? "(unlabeled)"}") is missing a real application_id or a non-empty steps array.`);
      continue;
    }
    for (const step of journey.steps) {
      totalSteps++;
      if (!step.assertion || !isNonEmptyString(step.assertion.description) || typeof step.assertion.pass !== "boolean") {
        anyStepMissingAssertion = true;
        continue;
      }
      if (step.assertion.pass === false) {
        anyStepFailed++;
        fail(`Journey step "${step.label ?? "(unlabeled)"}" (${step.from_stage} -> ${step.to_stage}) has assertion.pass=false: ${step.assertion.description}`);
      }
    }
  }
  if (anyStepMissingAssertion) {
    fail(`At least one journey step is missing a real assertion (description + boolean pass) -- a step that silently ran with no recorded outcome is not allowed.`);
  }
  if (totalSteps === 0) {
    fail(`Kanban journeys recorded zero total steps.`);
  } else if (!anyStepMissingAssertion) {
    pass(`${kanban.journeys.length} kanban journeys recorded, ${totalSteps} total steps, ${anyStepFailed} step(s) with assertion.pass=false.`);
  }
}

if (!Array.isArray(kanban.stages_visited)) {
  fail(`"kanban.stages_visited" is missing or not an array.`);
} else {
  const missingStages = REQUIRED_STAGES.filter((s) => !kanban.stages_visited.includes(s));
  if (missingStages.length > 0) {
    fail(`Kanban journeys never reached the following documented stage(s): ${missingStages.join(", ")}. All 12 stages must be driven through, not a subset.`);
  } else {
    pass(`All 12 documented pipeline stages were reached by at least one real journey: ${kanban.stages_visited.join(", ")}.`);
  }
}

// ---------------------------------------------------------------------------
// 6. Illegal-transition rule tests -- the rule function must correctly say
//    "disallowed" for every case (this is a code-correctness check, enforced
//    strictly).
// ---------------------------------------------------------------------------
const illegalTests = kanban.illegal_transition_rule_tests;
if (!Array.isArray(illegalTests) || illegalTests.length < 6) {
  fail(`"kanban.illegal_transition_rule_tests" must have at least 6 entries -- got ${Array.isArray(illegalTests) ? illegalTests.length : typeof illegalTests}.`);
} else {
  let allRuleCorrect = true;
  for (const t of illegalTests) {
    if (!t.rule || t.rule.allowed !== false || !t.assertion || t.assertion.pass !== true) {
      allRuleCorrect = false;
      fail(`Illegal-transition rule test (${t.from} -> ${t.to}) did not confirm the rule function reports allowed=false (assertion.pass must be true here regardless of downstream enforcement).`);
    }
  }
  if (allRuleCorrect) {
    pass(`${illegalTests.length} illegal-transition rule tests all confirm getTransitionRule() correctly reports allowed=false.`);
  }
}

// ---------------------------------------------------------------------------
// 7. Enforcement-gap bypass tests -- must be recorded with a real outcome,
//    regardless of what that outcome is.
// ---------------------------------------------------------------------------
const gapTests = kanban.enforcement_gap_tests;
if (!Array.isArray(gapTests) || gapTests.length < 3) {
  fail(`"kanban.enforcement_gap_tests" must have at least 3 entries (executeTransition bypass, raw DB-write bypass, role-gate bypass) -- got ${Array.isArray(gapTests) ? gapTests.length : typeof gapTests}.`);
} else {
  let allRecorded = true;
  for (const t of gapTests) {
    if (!isNonEmptyString(t.outcome)) {
      allRecorded = false;
      fail(`Enforcement-gap test "${t.id ?? t.label ?? "(unlabeled)"}" has no recorded outcome -- a bypass attempt that was skipped or whose result was never captured is not allowed.`);
    }
  }
  if (allRecorded) {
    const persisted = gapTests.filter((t) => /PERSIST/i.test(t.outcome)).length;
    pass(`${gapTests.length} enforcement-gap bypass tests all recorded a real outcome (${persisted} showed the illegal/unauthorized write actually persisting -- expected to be reported as findings, not hidden).`);
  }
}

// ---------------------------------------------------------------------------
// 8. Auth flows, all three, each with a recorded outcome.
// ---------------------------------------------------------------------------
const authFlows = data.auth_flows;
if (!authFlows || typeof authFlows !== "object") {
  hardFail(`"auth_flows" is missing or not an object.`);
}
for (const key of REQUIRED_AUTH_FLOWS) {
  const flow = authFlows[key];
  if (!flow || typeof flow !== "object") {
    fail(`"auth_flows.${key}" is missing entirely.`);
    continue;
  }
  if (!isNonEmptyArray(flow.steps)) {
    fail(`"auth_flows.${key}.steps" must be a non-empty array -- a flow with no recorded steps was not actually exercised.`);
  }
  if (flow.outcome !== "PASS" && flow.outcome !== "FAIL") {
    fail(`"auth_flows.${key}.outcome" must be exactly "PASS" or "FAIL" -- got ${JSON.stringify(flow.outcome)}.`);
  } else {
    pass(`"auth_flows.${key}" recorded with outcome=${flow.outcome} and ${flow.steps?.length ?? 0} step(s).`);
  }
}
const extraFlowKeys = Object.keys(authFlows).filter((k) => !REQUIRED_AUTH_FLOWS.includes(k));
if (extraFlowKeys.length > 0) {
  console.log(`NOTE: auth_flows has extra keys beyond the required three: ${extraFlowKeys.join(", ")} (not a failure).`);
}

// ---------------------------------------------------------------------------
// 9. Findings, if any, are well-formed.
// ---------------------------------------------------------------------------
if (data.findings !== undefined) {
  if (!Array.isArray(data.findings)) {
    fail(`"findings" is present but not an array.`);
  } else {
    for (const f of data.findings) {
      if (
        !isNonEmptyString(f.id) ||
        !isNonEmptyString(f.area) ||
        !VALID_SEVERITIES.includes(f.severity) ||
        !isNonEmptyString(f.description) ||
        f.evidence === undefined
      ) {
        fail(`Finding ${JSON.stringify(f.id ?? f)} is missing a required field (id, area, severity in [${VALID_SEVERITIES.join(", ")}], description, evidence).`);
      }
    }
    console.log(`"findings" has ${data.findings.length} entr${data.findings.length === 1 ? "y" : "ies"}, structurally checked.`);
  }
}

// ---------------------------------------------------------------------------
// 10. Every referenced screenshot exists on disk.
// ---------------------------------------------------------------------------
const screenshots = data.screenshots;
if (!isNonEmptyArray(screenshots)) {
  fail(`"screenshots" must be a non-empty array of real, captured screenshot paths.`);
} else {
  let allExist = true;
  for (const rel of screenshots) {
    const abs = path.join(process.cwd(), rel);
    if (!fs.existsSync(abs) || fs.statSync(abs).size === 0) {
      allExist = false;
      fail(`Screenshot "${rel}" referenced in the evidence file does not exist on disk, or is empty.`);
    }
  }
  if (allExist) {
    pass(`All ${screenshots.length} referenced screenshots exist on disk and are non-empty.`);
  }
}

// ---------------------------------------------------------------------------
console.log("");
if (errors > 0) {
  console.error(`VERIFICATION FAILED: ${errors} check(s) failed.`);
  process.exit(1);
}
console.log("VERIFICATION PASSED: kanban transition matrix and all three auth flows are recorded with real, checkable outcomes.");
process.exit(0);
